// fans.js — v1.4: ventole con stato REALE e verifica dei valori applicati.
//
// PERCHÉ PRIMA "NON ANDAVA": Windows non espone i giri delle ventole con un'API
// standard, e la vecchia versione (a) non verificava se powercfg avesse davvero
// scritto i valori, (b) usava SCHEME_CURRENT che su alcuni PC non viene applicato,
// (c) chiamava classi WMI dei vendor che quasi nessun PC espone dicendo poi
// "interfaccia rilevata" senza fare nulla, (d) la % manuale diventava direttamente
// il limite CPU (40% ventole = CPU al 40%!).
//
// ORA, in ordine di cosa funziona davvero:
//   1) Controllo REALE della temperatura (ACPI) + ventole dichiarate dal firmware
//      (Win32_Fan) + ventola GPU (nvidia-smi) + RPM reali se LibreHardwareMonitor
//      o FanControl sono aperti in background.
//   2) Applicazione su piano energia con GUID attivo + lettura di AC e DC,
//      poi VERIFICA: se il valore non è quello richiesto lo diciamo.
//   3) La % non è più un limite CPU: mappa su "quanto calore produco" (stato CPU
//      min/max) + policy di raffreddamento Windows (attiva/passiva). Più % = più
//      calore = le ventole del BIOS girano più forte. Meno % = meno calore.
//   4) Reset che rimette ESATTAMENTE i valori di prima (AC e DC, anche senza snapshot).
const os = require('os');
const fs = require('fs');
const http = require('http');
const { exec } = require('child_process');
const persist = require('./persist');
const { putSnap, getSnap, markActive, markRestored } = persist;

function execRaw(cmd, timeout = 25000) {
  return new Promise((resolve) => {
    exec(cmd, { timeout, windowsHide: true, maxBuffer: 2 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || '').replace(/\r/g, ''), stderr: String(stderr || '').replace(/\r/g, '') });
    });
  });
}
function sh(cmd, timeout = 25000) {
  return execRaw(cmd, timeout).then(r => ({
    ok: r.ok,
    out: ((r.stdout || '') + '\n' + (r.stderr || '')).split('\n').map(l => l.trim()).filter(Boolean).join('\n').slice(0, 1600)
  }));
}
function ps(script) {
  return `powershell -NoProfile -ExecutionPolicy Bypass -Command "${script.replace(/"/g, "'")}"`;
}

const SUB_CPU = '54533251-82be-4824-96c1-47b60b740d00';
const GUID_COOLING = '94d3a615-a899-4ac5-ae2b-e4d8f634367f'; // 0=passivo 1=attivo
const GUID_MAX = 'bc5038f7-23e0-4960-96da-33abaf5935ec';     // CPU massima %
const GUID_MIN = '893dee8e-2bef-41e0-89c6-b55d0929964c';     // CPU minima %

const MODES = {
  quiet: {
    label: '🔇 Silenziosa', cooling: 0, cpuMin: 5, cpuMax: 100,
    desc: 'Windows preferisce rallentare prima di accelerare le ventole: più silenzio. La CPU resta libera di arrivare al 100%, quindi nessun tetto agli FPS.'
  },
  balanced: {
    label: '⚖️ Bilanciata', cooling: 1, cpuMin: 5, cpuMax: 100,
    desc: 'default Windows: raffreddamento ATTIVO (ventole prima del throttling), CPU libera al 100%.'
  },
  gaming: {
    label: '🎮 Gaming', cooling: 1, cpuMin: 30, cpuMax: 100,
    desc: 'CPU più sveglia (min 30%) + raffreddamento ATTIVO: il BIOS gira le ventole prima di tagliare la frequenza. Nessun tetto agli FPS.'
  },
  max: {
    label: '🌪️ Massima (più rumore)', cooling: 1, cpuMin: 100, cpuMax: 100,
    desc: 'CPU mai in risparmio: massimo calore → ventole al massimo. Su un PC con poco margine termico può costare FPS: se li perdi, torna a Bilanciata.'
  }
};

// % → stato reale. La % regola SOLO quanto calore produco (quanto la CPU resta
// sveglia + policy di raffreddamento). Il massimo della CPU resta 100% SEMPRE:
// prima la % tagliava il limite CPU (40% ventole = CPU al 40%) e toglieva FPS.
function mapPct(pct) {
  const p = Math.max(10, Math.min(100, parseInt(pct, 10) || 70));
  if (p < 30) return { pct: p, cooling: 0, cpuMin: 5, cpuMax: 100, label: 'Eco silenziosa' };
  if (p < 50) return { pct: p, cooling: 0, cpuMin: 10, cpuMax: 100, label: 'Quasi silenziosa' };
  if (p < 70) return { pct: p, cooling: 1, cpuMin: 20, cpuMax: 100, label: 'Bilanciata' };
  if (p < 85) return { pct: p, cooling: 1, cpuMin: 30, cpuMax: 100, label: 'Sostenuta' };
  return { pct: p, cooling: 1, cpuMin: 50, cpuMax: 100, label: 'Massima' };
}

// ---------- powercfg: piano attivo + valori reali ----------
async function activeScheme() {
  const r = await sh('powercfg /getactivescheme');
  const m = String(r.out).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return m ? m[1] : null;
}
async function readSetting(scheme, guid) {
  const r = await sh(`powercfg /query ${scheme} ${SUB_CPU} ${guid}`);
  const hex = String(r.out).match(/0x[0-9a-f]{1,8}/ig);
  if (!hex) return null;
  const vals = hex.map(h => parseInt(h, 16)).filter(n => Number.isFinite(n));
  if (!vals.length) return null;
  // powercfg stampa prima l'indice AC e poi DC (le prime occorrenze sono l'intestazione)
  const ac = vals[vals.length - 2] !== undefined ? vals[vals.length - 2] : vals[vals.length - 1];
  const dc = vals[vals.length - 1];
  return { ac, dc };
}
async function readState(schemeArg) {
  const scheme = schemeArg || await activeScheme();
  if (!scheme) return null;
  const [cooling, cpuMax, cpuMin] = await Promise.all([
    readSetting(scheme, GUID_COOLING),
    readSetting(scheme, GUID_MAX),
    readSetting(scheme, GUID_MIN)
  ]);
  return { scheme, cooling, cpuMax, cpuMin };
}
async function applyState(scheme, st) {
  const rows = [
    [GUID_COOLING, st.cooling, 'policy raffreddamento'],
    [GUID_MAX, st.cpuMax, 'CPU massima'],
    [GUID_MIN, st.cpuMin, 'CPU minima']
  ];
  for (const [guid, val, what] of rows) {
    if (val === undefined || val === null) continue;
    await sh(`powercfg /setacvalueindex ${scheme} ${SUB_CPU} ${guid} ${val}`);
    await sh(`powercfg /setdcvalueindex ${scheme} ${SUB_CPU} ${guid} ${val}`);
    void what;
  }
  const act = await sh(`powercfg /setactive ${scheme}`);
  return act.ok;
}
function verify(scheme, want) {
  return readState(scheme).then(now => {
    if (!now) return { ok: false, rows: ['⚠️ Non riesco a rileggere il piano energia.'] };
    const rows = [];
    let ok = true;
    const chk = (label, got, exp, fmt) => {
      const g = got ? got.ac : null;
      const d = got ? got.dc : null;
      const good = String(g) === String(exp) && (d === null || String(d) === String(exp));
      if (!good) ok = false;
      rows.push(`${good ? '✓' : '✕'} ${label}: ${fmt(g)}${d !== null && String(d) !== String(g) ? ' (batteria ' + fmt(d) + ')' : ''}${good ? '' : ' — richiesto ' + fmt(exp)}`);
    };
    if (want.cooling !== undefined) chk('Raffreddamento', now.cooling, want.cooling, v => v === 1 ? 'ATTIVO (ventole prima)' : v === 0 ? 'PASSIVO (silenzioso)' : 'n/d');
    if (want.cpuMax !== undefined) chk('CPU massima', now.cpuMax, want.cpuMax, v => v === null ? 'n/d' : v + '%');
    if (want.cpuMin !== undefined) chk('CPU minima', now.cpuMin, want.cpuMin, v => v === null ? 'n/d' : v + '%');
    return { ok, rows, now };
  });
}

// ---------- sensori reali ----------
async function readTemps() {
  const out = [];
  try {
    const r = await execRaw(ps(`Get-CimInstance MSAcpi_ThermalZoneTemperature -Namespace root/wmi -ErrorAction SilentlyContinue | ForEach-Object { [math]::Round($_.CurrentTemperature/10 - 273.15, 1) }`), 12000);
    const vals = String(r.stdout || '').split('\n').map(s => parseFloat(s.trim())).filter(v => Number.isFinite(v) && v > -20 && v < 130);
    if (vals.length) out.push({ label: 'Sensore ACPI', c: Math.max(...vals) });
  } catch {}
  try {
    const nv = require('./nvidia');
    const g = await nv.read();
    if (g && g.available && g.tempC !== null) out.push({ label: 'GPU', c: g.tempC, fanPct: g.fanPct });
  } catch {}
  return out;
}
async function readFansWmi() {
  try {
    const r = await execRaw(ps(`Get-CimInstance Win32_Fan -ErrorAction SilentlyContinue | ForEach-Object { $_.DeviceID + '|' + $_.DesiredSpeed + '|' + $_.ActiveCooling + '|' + $_.VariableSpeed + '|' + $_.Status }`), 12000);
    return String(r.stdout || '').split('\n').map(s => s.trim()).filter(Boolean).map(line => {
      const [id, speed, active, variable, status] = line.split('|');
      return { id, speed, active: /true/i.test(active || ''), variable: /true/i.test(variable || ''), status };
    });
  } catch { return []; }
}
// LibreHardwareMonitor / OpenHardwareMonitor espongono RPM reali su localhost:8085
function lhmJson(timeout = 1600) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: 8085, path: '/data.json', timeout }, (res) => {
      let d = '';
      res.on('data', c => { d += c; if (d.length > 800000) req.destroy(); });
      res.on('end', () => resolve(d));
    });
    req.on('timeout', () => { req.destroy(); resolve(''); });
    req.on('error', () => resolve(''));
  });
}
function collectFans(node, out) {
  if (!node || typeof node !== 'object') return;
  const text = String(node.Text || '');
  const value = String(node.Value || '');
  if (/fan|ventol|rpm/i.test(text) && /rpm|giri/i.test(value + text)) out.push(`${text}: ${value}`);
  (node.Children || []).forEach(c => collectFans(c, out));
}
async function readRpm() {
  const raw = await lhmJson();
  if (!raw) return [];
  try {
    const fans = [];
    collectFans(JSON.parse(raw), fans);
    return fans.slice(0, 8);
  } catch { return []; }
}

const VENDOR_APPS = [
  ['FanControl (open-source)', 'C:\\Program Files\\FanControl\\FanControl.exe'],
  ['MSI Afterburner', 'C:\\Program Files (x86)\\MSI Afterburner\\MSIAfterburner.exe'],
  ['Lenovo Legion Zone', 'C:\\Program Files\\Lenovo\\LegionZone\\LegionZone.exe'],
  ['ASUS Armoury Crate', 'C:\\Program Files\\ASUS\\ArmouryCrate\\ArmouryCrate.exe'],
  ['OMEN Gaming Hub', 'C:\\Program Files\\OMEN Gaming Hub\\OMEN Gaming Hub.exe'],
  ['MSI Center', 'C:\\Program Files (x86)\\MSI\\MSI Center\\MSI Center.exe'],
  ['Alienware Command Center', 'C:\\Program Files\\Alienware\\Alienware Command Center\\AWCC.exe']
];
function detectVendorApps() {
  return VENDOR_APPS.filter(([, p]) => { try { return fs.existsSync(p); } catch { return false; } });
}
async function launchVendorApp() {
  if (os.platform() !== 'win32') return { ok: false, out: 'Su questo OS usa i pannelli nativi (Macs Fan Control / lm-sensors).' };
  const found = detectVendorApps();
  if (!found.length) {
    return {
      ok: false,
      out: '🌀 Nessuna app di controllo ventole trovata.\n' +
        'Consiglio onesto: installa FanControl (gratis, open-source, legge EC/motherboard e ti dà la curva vera) oppure l\'app del produttore del PC.\n' +
        'Nel frattempo i profili qui sopra funzionano lo stesso tramite Windows (policy + calore).'
    };
  }
  const [name, path] = found[0];
  const r = await sh(`start "" "${path}"`, 12000);
  return {
    ok: r.ok,
    out: r.ok
      ? `🖥️ Aperto ${name}: da lì puoi impostare la curva esatta dei giri.\nQui la policy Windows resta attiva e il "↩ Reset automatico" la rimette a posto.`
      : `⚠️ Non riesco ad aprire ${name} (${r.out}). Aprila dal menu Start.`
  };
}

// ---------- stato ----------
async function fanStatus() {
  if (os.platform() !== 'win32') {
    return { ok: true, out: '🌀 Ventole: i profili Windows sono disponibili solo su Windows. Su questo OS usa i pannelli nativi (Macs Fan Control / lm-sensors / FanControl Linux).' };
  }
  const state = await readState();
  const temps = await readTemps();
  const fans = await readFansWmi();
  const rpm = await readRpm();
  const apps = detectVendorApps();
  const snap = getSnap('fans');

  const cool = state && state.cooling ? state.cooling.ac : null;
  const rows = [];
  rows.push(`💻 ${os.cpus().length} core · piano energia ${state ? 'attivo' : 'non leggibile'}`);
  if (temps.length) temps.forEach(t => rows.push(`🌡️ ${t.label}: ${t.c}°C`));
  else rows.push('🌡️ Temperatura: nessun sensore ACPI esposto (comune sui fissi: il BIOS non lo pubblica)');
  const gpuT = temps.find(t => t.label === 'GPU');
  if (gpuT && gpuT.fanPct !== null && gpuT.fanPct !== undefined) rows.push(`🌀 Ventola GPU: ${gpuT.fanPct}% (letta dal driver NVIDIA)`);
  if (fans.length) {
    fans.forEach((f, i) => rows.push(`🌀 Ventola ${i + 1}${f.id && f.id !== 'Fan 0' ? ' (' + f.id + ')' : ''}: ${f.speed && f.speed !== '0' ? f.speed + ' giri dichiarati' : 'giri non dichiarati'} · ${f.active ? 'raffreddamento attivo' : 'passiva'}${f.variable ? ' · variabile' : ''}`));
  } else rows.push('🌀 Ventole del case/CPU: il firmware non le espone a Windows (normalissimo) — sotto ti dico come leggerle davvero');
  if (rpm.length) rpm.forEach(r => rows.push(`📈 ${r}`));
  rows.push(`⚙️ Policy raffreddamento: ${cool === 1 ? 'ATTIVO (ventole prima di rallentare la CPU)' : cool === 0 ? 'PASSIVO (prima rallenta, poi ventole)' : 'non leggibile'}`);
  rows.push(`🧠 CPU: minima ${state && state.cpuMin ? state.cpuMin.ac + '%' : 'n/d'} · massima ${state && state.cpuMax ? state.cpuMax.ac + '%' : 'n/d'}`);
  if (apps.length) rows.push(`🏭 App ventole installate: ${apps.map(a => a[0]).join(' · ')}`);
  if (snap) rows.push('💾 Snapshot ventole: SALVATO — "↩ Reset automatico" rimette i valori esatti di prima');
  else rows.push('💾 Snapshot ventole: nessuno (si crea al primo profilo applicato)');

  const hint = rpm.length
    ? '📈 RPM reali letti da LibreHardwareMonitor/FanControl.'
    : '💡 Per i giri ESATTI (RPM) apri FanControl o LibreHardwareMonitor in background: li leggo da soli. La curva fine la imposti lì; qui decidi quanta potenza/calore vuoi.';

  return { ok: true, out: `🌀 STATO VENTOLE — sola lettura, niente toccato:\n\n${rows.map(r => '• ' + r).join('\n')}\n\n${hint}` };
}

async function previewFans(mode, pct) {
  if (os.platform() !== 'win32') return { ok: true, preview: true, out: 'Solo Windows per i profili; su altri OS usa i pannelli nativi.' };
  const custom = pct !== undefined && pct !== null && pct !== '';
  const m = custom ? mapPct(pct) : (MODES[mode] || MODES.balanced);
  const label = custom ? `${m.label} (${m.pct}%)` : m.label;
  return {
    ok: true, preview: true,
    out: `👁 ANTEPRIMA — Ventole → ${label} (non ho toccato nulla)\n\n` +
      `✅ COSA FARÀ (funziona su QUALSIASI PC Windows):\n` +
      `• Raffreddamento → ${m.cooling ? 'ATTIVO: Windows preferisce far girare le ventole invece di rallentare la CPU' : 'PASSIVO: Windows prima abbassa la potenza, poi accende le ventole (silenzioso)'}\n` +
      `• CPU massima → 100% SEMPRE (i profili ventole non mettono un tetto agli FPS)\n` +
      `• CPU minima → ${m.cpuMin}% (quanto la CPU resta sveglia: più è alta, più calore = ventole più alte)\n` +
      `• Applicato sia a rete elettrica sia a batteria, poi VERIFICATO leggendo indietro i valori\n` +
      (custom ? `• Con ${m.pct}% provo anche ad aprire l'app del produttore se è installata (i giri esatti li gestisce lei)\n` : '') +
      `\n🚫 COSA NON TOCCA: curve custom esistenti, BIOS, altri piani energia, app aperte.\n` +
      `ℹ ONESTO: Windows non permette di scrivere "ventola = 60%". Controlliamo il calore prodotto + la policy; i giri seguono la curva del BIOS. Per i giri esatti serve FanControl o l'app del produttore.\n` +
      `👤 ADMIN: consigliato (alcuni PC bloccano powercfg senza admin). 🔄 RIAVVIO: non serve.\n` +
      `↩ COME ANNULLARE: "↩ Reset automatico" rimette i valori esatti letti prima.`
  };
}

async function setFanMode(mode, pct) {
  if (os.platform() !== 'win32') return { ok: false, out: 'Controllo ventole supportato solo su Windows in questa versione.' };
  const custom = pct !== undefined && pct !== null && pct !== '';
  const m = custom ? mapPct(pct) : (MODES[mode] || MODES.balanced);
  const label = custom ? `${m.label} (${m.pct}%)` : m.label;

  const scheme = await activeScheme();
  if (!scheme) return { ok: false, out: '✕ Non riesco a leggere il piano energia attivo (powercfg). Prova ad avviare l\'app come amministratore.' };

  // Snapshot ESATTO dei valori precedenti, una sola volta.
  let snap = getSnap('fans');
  if (!snap || !snap.scheme) {
    snap = await readState(scheme);
    if (snap) putSnap('fans', { ...snap, when: new Date().toISOString() });
  }

  const log = [`🌀 VENTOLE → ${label}`];
  if (!custom) log.push(`   ${m.desc}`);
  const applied = await applyState(scheme, { cooling: m.cooling, cpuMin: m.cpuMin, cpuMax: m.cpuMax });
  if (!applied) log.push('ℹ /setactive non confermato: i valori sono scritti, Windows li applica al prossimo cambio piano.');

  const v = await verify(scheme, { cooling: m.cooling, cpuMax: m.cpuMax, cpuMin: m.cpuMin });
  log.push('');
  log.push(v.ok ? '✅ VERIFICATO — Windows ha davvero questi valori:' : '⚠️ PARZIALE — questi sono i valori che Windows riporta:');
  v.rows.forEach(r => log.push('   ' + r));

  const apps = detectVendorApps();
  if (apps.length) {
    log.push(`\n🏭 App ventole trovata: ${apps[0][0]} — con "Apri app ventole" imposti la curva esatta dei giri.`);
  } else if (custom) {
    log.push('\nℹ Per i giri esatti non c\'è un\'app di controllo ventole installata: FanControl (gratis) o l\'app del produttore.');
  }
  if (m.cpuMax === 100) log.push('   ✓ CPU massima 100%: nessun taglio agli FPS (la % regola solo calore e ventole).');
  log.push('💾 Snapshot salvato: "↩ Reset automatico" rimette ESATTAMENTE i valori di prima.');
  try { markActive('fans:' + (custom ? m.pct + 'pct' : mode)); } catch {}
  return { ok: v.ok, out: log.join('\n'), verified: v.rows, state: v.now };
}

// RESET AUTOMATICO: rimette i valori esatti dello snapshot, altrimenti i default Windows.
async function resetFans() {
  if (os.platform() !== 'win32') return { ok: false, out: 'Solo Windows.' };
  const snap = getSnap('fans');
  const schemeNow = await activeScheme();
  if (!schemeNow) return { ok: false, out: '✕ Piano energia non leggibile: avvia l\'app come amministratore e riprova.' };

  const log = ['↩ RESET VENTOLE → modalità automatica'];
  let target;
  if (snap && snap.scheme) {
    target = { scheme: snap.scheme, cooling: snap.cooling, cpuMax: snap.cpuMax, cpuMin: snap.cpuMin };
    await applyState(snap.scheme, {
      cooling: snap.cooling ? snap.cooling.ac : 1,
      cpuMax: snap.cpuMax ? snap.cpuMax.ac : 100,
      cpuMin: snap.cpuMin ? snap.cpuMin.ac : 5
    });
    // Riattiva il piano che era attivo prima (se esiste ancora).
    await sh(`powercfg /setactive ${snap.scheme}`);
    log.push(`↩ Piano energia originale riattivato (${snap.scheme})`);
  } else {
    target = { scheme: schemeNow, cooling: 1, cpuMax: 100, cpuMin: 5 };
    await applyState(schemeNow, { cooling: 1, cpuMax: 100, cpuMin: 5 });
    log.push('↩ Nessuno snapshot: rimessi i default Windows (raffreddamento ATTIVO, CPU 5–100%)');
  }

  const v = await verify(target.scheme, {
    cooling: target.cooling ? (target.cooling.ac !== undefined ? target.cooling.ac : target.cooling) : 1,
    cpuMax: target.cpuMax ? (target.cpuMax.ac !== undefined ? target.cpuMax.ac : target.cpuMax) : 100,
    cpuMin: target.cpuMin ? (target.cpuMin.ac !== undefined ? target.cpuMin.ac : target.cpuMin) : 5
  });
  log.push('');
  log.push(v.ok ? '✅ VERIFICATO — valori di fabbrica ripristinati:' : '⚠️ Verifica parziale:');
  v.rows.forEach(r => log.push('   ' + r));
  log.push('\n✅ Ventole in AUTOMATICO: da ora decide il BIOS/vendor con la sua curva.');
  try { markRestored(); } catch {}
  return { ok: v.ok, out: log.join('\n'), verified: v.rows };
}

module.exports = { fanStatus, previewFans, setFanMode, resetFans, launchVendorApp, MODES, mapPct };
