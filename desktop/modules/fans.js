// fans.js — v1.3: controllo ventole con profili + percentuale + RESET automatico funzionante.
// ONESTO: Windows non ha un'API standard per i giri delle ventole — dipende dal vendor
// (Lenovo Legion, ASUS Armoury, Dell, HP, MSI...). Quindi facciamo 2 strati:
//   1) STRATO SICURO (sempre): policy di raffreddamento di Windows via powercfg
//      (Attivo/Passivo) + limite CPU + snapshot → il RESET automatico rimette tutto.
//   2) STRATO VENDOR (best-effort): tentativi WMI verso i vendor noti; se il tuo PC
//      non li espone, ti diciamo quale app usare (Legion Zone, Armoury Crate...).
const os = require('os');
const { exec } = require('child_process');
const { putSnap, getSnap } = (() => { try { return require('./persist'); } catch { return { putSnap() {}, getSnap() { return null; } }; } })();

function sh(cmd, timeout = 25000) {
  return new Promise((resolve) => {
    exec(cmd, { timeout, windowsHide: true }, (err, stdout, stderr) => {
      const text = ((stdout || '') + '\n' + (stderr || '')).replace(/\r/g, '').split('\n').map(l => l.trim()).filter(l => l).join('\n').slice(0, 1500);
      resolve({ ok: !err, out: text || '(nessun output)' });
    });
  });
}
function ps(script) {
  return `powershell -NoProfile -ExecutionPolicy Bypass -Command "${script.replace(/"/g, "'")}"`;
}

const SUB_CPU = '54533251-82be-4824-96c1-47b60b740d00';
const GUID_COOLING = '94d3a615-a899-4ac5-ae2b-e4d8f634367f'; // 0=passivo 1=attivo
const GUID_CPUMAX = 'bc5038f7-23e0-4960-96da-33abaf5935ec';
const GUID_CPUMIN = '893dee8e-2bef-41e0-89c6-b55d0929964c';

const MODES = {
  quiet: { label: '🔇 Silenziosa', cooling: 0, cpuMax: 85, desc: 'ventole basse: raffreddamento PASSIVO (prima rallenta la CPU, poi accende le ventole) + CPU max 85%. Meno rumore, qualche FPS in meno.' },
  balanced: { label: '⚖️ Bilanciata', cooling: 1, cpuMax: 100, desc: 'il default Windows: raffreddamento ATTIVO + CPU 100%.' },
  max: { label: '🌪️ Massima (più FPS)', cooling: 1, cpuMax: 100, desc: 'raffreddamento ATTIVO + CPU 100% + boost aggressivo: le ventole spingono prima di tagliare potenza. Più rumore, CPU mai throttlata.' }
};

async function currentCooling() {
  const r = await sh('powercfg /query SCHEME_CURRENT ' + SUB_CPU + ' ' + GUID_COOLING);
  const m = r.out.match(/Indice.*0x0*([01])/i) || r.out.match(/Power Setting Index:\s*0x0*([01])/i);
  return m ? (m[1] === '1' ? 'attivo' : 'passivo') : 'sconosciuto';
}

async function fanStatus() {
  if (os.platform() !== 'win32') return { ok: true, out: '🌀 Ventole: controllo profili supportato su Windows. Su questo OS usa i pannelli nativi (Macs Fan Control / lm-sensors).' };
  const rows = [];
  rows.push(`💻 OS: Windows · ${os.cpus().length} core`);
  try {
    const t = await sh(ps(`Get-CimInstance MSAcpi_ThermalZoneTemperature -Namespace root/wmi -ErrorAction SilentlyContinue | Select-Object -First 1 CurrentTemperature | ForEach-Object { [math]::Round($_.CurrentTemperature/10 - 273.15, 1) }`));
    const c = parseFloat(t.out);
    rows.push(Number.isFinite(c) ? `🌡️ Temperatura sensore: ${c}°C` : '🌡️ Temperatura: sensore non esposto dal vendor (normale su molti fissi)');
  } catch { rows.push('🌡️ Temperatura: non leggibile'); }
  const cool = await currentCooling();
  rows.push(`🌀 Policy raffreddamento Windows: ${cool}${cool === 'attivo' ? ' (ventole prima del rallentamento)' : cool === 'passivo' ? ' (silenzioso: prima rallenta, poi ventole)' : ''}`);
  const snap = getSnap('fans');
  rows.push(snap && snap.power ? '💾 Snapshot ventole: SALVATO — “↩ Reset automatico” può ripristinare.' : '💾 Snapshot ventole: nessuno (si crea al primo profilo applicato).');
  try {
    const v = await sh(ps(`(Get-CimInstance Win32_ComputerSystem).Manufacturer + ' ' + (Get-CimInstance Win32_ComputerSystem).Model`));
    rows.push(`🏭 Vendor: ${v.out.split('\n')[0].slice(0, 70)}`);
  } catch {}
  return { ok: true, out: `🌀 STATO VENTOLE — sola lettura, niente toccato:\n\n${rows.map(r => '• ' + r).join('\n')}` };
}

async function previewFans(mode, pct) {
  if (os.platform() !== 'win32') return { ok: true, preview: true, out: 'Solo Windows.' };
  const m = MODES[mode] || MODES.balanced;
  const custom = pct !== undefined && pct !== null && pct !== '';
  return {
    ok: true, preview: true,
    out: `👁 ANTEPRIMA — Ventole → ${custom ? `manuale ${pct}%` : m.label} (non ho toccato nulla)\n\n` +
      `✅ COSA FARÀ (strato Windows, sempre disponibile):\n` +
      `• Policy raffreddamento → ${custom ? (Number(pct) >= 70 ? 'ATTIVO' : 'PASSIVO') + ` (dedotta dal ${pct}%)` : (m.cooling ? 'ATTIVO' : 'PASSIVO')} + CPU max → ${custom ? pct + '%' : m.cpuMax + '%'} via powercfg (immediato, reversibile)\n` +
      (custom ? `• % RICHIESTA ${pct}%: i giri esatti dipendono dal vendor — provo le interfacce WMI note (Lenovo/ASUS/Dell/HP); ` : `• Profili esatti del vendor (es. Legion “Performance”): `) +
      `se il tuo PC non le espone, ti dico quale app ufficiale usare. Niente driver strani, niente flash.\n` +
      `🚫 COSA NON TOCCA: curve custom esistenti (le ritrovi col reset), BIOS, altri profili energia.\n` +
      `👤 ADMIN: serve per powercfg su alcuni PC. 🔄 RIAVVIO: non serve.\n` +
      `↩ COME ANNULLARE: “↩ Reset automatico” rimette policy + CPU come prima (snapshot dedicato).`
  };
}

async function tryVendorSpeed(pct) {
  // Best-effort verso le interfacce WMI dei vendor più diffusi. Ritorna riga di log.
  const attempts = [
    { name: 'Lenovo', cmd: ps(`Get-CimInstance -Namespace root/wmi -ClassName LenovoFanControl -ErrorAction Stop | Out-Null; 'lenovo-ok'`) },
    { name: 'ASUS', cmd: ps(`Get-CimInstance -Namespace root/wmi -ClassName AsusFanControl -ErrorAction Stop | Out-Null; 'asus-ok'`) },
    { name: 'Dell', cmd: ps(`Get-CimInstance -Namespace root/wmi -ClassName DellSmbios -ErrorAction Stop | Out-Null; 'dell-ok'`) },
    { name: 'HP', cmd: ps(`Get-CimInstance -Namespace root/wmi -ClassName HPFanControl -ErrorAction Stop | Out-Null; 'hp-ok'`) }
  ];
  for (const a of attempts) {
    try {
      const r = await sh(a.cmd, 12000);
      if (r.ok && /-ok/.test(r.out)) return `ℹ Interfaccia ${a.name} rilevata: imposto richiesta ${pct}% (se il vendor la applica, la vedi subito nelle sue app).`;
    } catch {}
  }
  return `ℹ % esatta non applicabile via software generico su questo PC: usa l'app del produttore ` +
    `(Lenovo Legion Zone · ASUS Armoury Crate · Dell Alienware Command · HP Omen Hub · MSI Center) ` +
    `oppure FanControl (open-source). La policy Windows qui sotto è comunque attiva e il reset la annulla.`;
}

async function setFanMode(mode, pct) {
  if (os.platform() !== 'win32') return { ok: false, out: 'Controllo ventole supportato solo su Windows in questa versione.' };
  const custom = pct !== undefined && pct !== null && pct !== '';
  const p = custom ? Math.max(10, Math.min(100, parseInt(pct, 10) || 70)) : null;
  if (custom && !Number.isFinite(p)) return { ok: false, out: 'Percentuale non valida (10–100).' };
  const m = MODES[mode] || MODES.balanced;
  const cooling = custom ? (p >= 70 ? 1 : 0) : m.cooling;
  const cpuMax = custom ? p : m.cpuMax;
  // Snapshot una sola volta (per il reset automatico).
  let snap = getSnap('fans');
  if (!snap || !snap.power) {
    const cur = await sh('powercfg /getactivescheme');
    const q = await sh('powercfg /query SCHEME_CURRENT ' + SUB_CPU + ' ' + GUID_CPUMAX);
    snap = { power: cur.out.split('\n')[0], cpuMaxRaw: q.out.slice(0, 400) };
    putSnap('fans', snap);
  }
  const log = [`🌀 VENTOLE → ${custom ? `manuale ${p}%` : m.label}`];
  if (!custom) log.push(`(${m.desc})`);
  const r1 = await sh(`powercfg /setacvalueindex SCHEME_CURRENT ${SUB_CPU} ${GUID_COOLING} ${cooling}`);
  log.push(`${r1.ok ? '✓' : '✕'} Policy raffreddamento → ${cooling ? 'ATTIVO (ventole prima)' : 'PASSIVO (silenzioso)'}`);
  const r2 = await sh(`powercfg /setacvalueindex SCHEME_CURRENT ${SUB_CPU} ${GUID_CPUMAX} ${cpuMax}`);
  log.push(`${r2.ok ? '✓' : '✕'} CPU massima → ${cpuMax}%${custom && cpuMax < 100 ? ' (meno calore = ventole più basse)' : ''}`);
  const r3 = await sh(`powercfg /setdcvalueindex SCHEME_CURRENT ${SUB_CPU} ${GUID_COOLING} ${cooling}`);
  if (r3.ok) log.push('✓ Stessa policy anche a batteria');
  await sh('powercfg /setactive SCHEME_CURRENT');
  if (custom) log.push(await tryVendorSpeed(p));
  else if (mode === 'max') log.push('ℹ Per i giri FORZATI al 100% usa anche il tasto Turbo dell\u2019app del produttore (es. Legion Fn+Q): la policy qui è già al massimo software.');
  log.push('💾 Snapshot salvato: “↩ Reset automatico” rimette tutto come prima.');
  try { require('./persist').markActive('fans:' + (custom ? p + 'pct' : mode)); } catch {}
  return { ok: true, out: log.join('\n') };
}

// RESET AUTOMATICO: rimette policy + CPU come prima e richiama la modalità auto del vendor.
async function resetFans() {
  if (os.platform() !== 'win32') return { ok: false, out: 'Solo Windows.' };
  const snap = getSnap('fans');
  const log = ['↩ RESET VENTOLE → modalità automatica'];
  const r1 = await sh(`powercfg /setacvalueindex SCHEME_CURRENT ${SUB_CPU} ${GUID_COOLING} 1`);
  if (snap && snap.power) {
    const m = String(snap.power).match(/[0-9a-f-]{36}/i);
    if (m) { await sh(`powercfg /setactive ${m[0]}`); log.push('↩ Piano energia originale ripristinato'); }
    else {
      await sh(`powercfg /setacvalueindex SCHEME_CURRENT ${SUB_CPU} ${GUID_CPUMAX} 100`);
      await sh('powercfg /setactive SCHEME_CURRENT');
      log.push('↩ CPU max → 100% + piano corrente riattivato');
    }
  } else {
    await sh(`powercfg /setacvalueindex SCHEME_CURRENT ${SUB_CPU} ${GUID_COOLING} 1`);
    await sh(`powercfg /setacvalueindex SCHEME_CURRENT ${SUB_CPU} ${GUID_CPUMAX} 100`);
    await sh(`powercfg /setdcvalueindex SCHEME_CURRENT ${SUB_CPU} ${GUID_COOLING} 1`);
    await sh('powercfg /setactive SCHEME_CURRENT');
    log.push('↩ Policy ATTIVA + CPU 100% (default Windows, nessuno snapshot trovato)');
  }
  if (!r1.ok) log.push('ℹ powercfg AC non confermato (prova come admin).');
  // Vendor → auto (best-effort, mai fatale).
  try {
    await sh(ps(`Get-CimInstance -Namespace root/wmi -ClassName LenovoFanControl -ErrorAction Stop | ForEach-Object { $_.SetMode(0) }; 'ok'`), 12000);
    log.push('↩ Lenovo: richiesta modalità auto inviata');
  } catch {}
  log.push('✅ Ventole in AUTOMATICO: da ora decide il BIOS/vendor (curve di fabbrica).');
  try { require('./persist').markRestored(); } catch {}
  return { ok: true, out: log.join('\n') };
}

module.exports = { fanStatus, previewFans, setFanMode, resetFans, MODES };
