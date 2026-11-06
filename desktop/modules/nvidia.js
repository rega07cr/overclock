// nvidia.js — v1.4 "NVIDIA MAX": spreme la GeForce con strumenti ufficiali.
//
// ONESTO: il pannello NVIDIA (le impostazioni 3D tipo "Preferisci prestazioni massime",
// Low Latency, VSync, filtro texture) vive nel database del driver e NON ha un'API
// pubblica/scriptabile. Quello che qui facciamo DAVVERO, in modo reversibile:
//   1) nvidia-smi: persistence mode, power limit al massimo, clock GPU bloccato al massimo
//   2) registro: PowerMizer forzato su "massime prestazioni" per l'adattatore NVIDIA
//   3) guida guidata + apertura del pannello NVIDIA con i valori esatti da mettere
// Tutto viene salvato in uno snapshot: "↩ Reset NVIDIA" rimette tutto come prima.
const os = require('os');
const { exec } = require('child_process');
const { putSnap, getSnap } = require('./persist');

function execRaw(cmd, timeout = 20000) {
  return new Promise((resolve) => {
    exec(cmd, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || '').replace(/\r/g, ''), stderr: String(stderr || '').replace(/\r/g, '') });
    });
  });
}
function sh(cmd, timeout = 20000) {
  return execRaw(cmd, timeout).then(r => ({
    ok: r.ok,
    out: ((r.stdout || '') + '\n' + (r.stderr || '')).split('\n').map(l => l.trim()).filter(Boolean).join('\n').slice(0, 1800)
  }));
}
function ps(script) {
  return `powershell -NoProfile -ExecutionPolicy Bypass -Command "${script.replace(/"/g, "'")}"`;
}

const SMI_CANDIDATES = [
  'nvidia-smi',
  'C:\\Windows\\System32\\nvidia-smi.exe',
  'C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe'
];
let smiCmd = null;
async function smi(args, timeout = 15000) {
  const list = smiCmd ? [smiCmd, ...SMI_CANDIDATES] : SMI_CANDIDATES;
  let last = '';
  for (const c of list) {
    const r = await execRaw(`"${c}" ${args}`, timeout);
    if (r.ok && !/non riconosciut|not recognized|No such file/i.test(r.stderr || '')) {
      smiCmd = c;
      return { ok: true, out: r.stdout.trim() };
    }
    last = (r.stderr || r.stdout || '').trim();
  }
  return { ok: false, out: last.slice(0, 400) || 'nvidia-smi non trovato' };
}

const Q = 'name,driver_version,temperature.gpu,fan.speed,power.draw,power.limit,power.max_limit,power.default_limit,clocks.current.graphics,clocks.max.graphics,utilization.gpu,memory.used,memory.total,persistence_mode';

let _cache = { at: 0, data: null };
async function read(force) {
  if (!force && Date.now() - _cache.at < 2000 && _cache.data) return _cache.data;
  if (!['win32', 'linux'].includes(os.platform())) {
    return { available: false, reason: 'NVIDIA MAX è pensato per Windows/Linux con driver NVIDIA.' };
  }
  const r = await smi(`--query-gpu=${Q} --format=csv,noheader,nounits`);
  if (!r.ok) {
    const out = { available: false, reason: r.out };
    _cache = { at: Date.now(), data: out };
    return out;
  }
  const cols = String(r.out).split('\n')[0].split(',').map(s => s.trim());
  const num = (v) => {
    const n = parseFloat(String(v).replace(/[^\d.\-]/g, ''));
    return Number.isFinite(n) ? n : null;
  };
  const data = {
    available: true,
    name: cols[0] || 'NVIDIA GPU',
    driver: cols[1] || '?',
    tempC: num(cols[2]),
    fanPct: num(cols[3]),
    powerW: num(cols[4]),
    powerLimitW: num(cols[5]),
    powerMaxW: num(cols[6]),
    powerDefaultW: num(cols[7]),
    clockMHz: num(cols[8]),
    clockMaxMHz: num(cols[9]),
    utilPct: num(cols[10]),
    memUsedMB: num(cols[11]),
    memTotalMB: num(cols[12]),
    persistence: /enabled/i.test(cols[13] || '') ? 1 : 0
  };
  _cache = { at: Date.now(), data };
  return data;
}

function fmt(v, unit = '') { return v === null || v === undefined ? 'n/d' : `${v}${unit}`; }

async function status() {
  const g = await read(true);
  if (!g.available) {
    return {
      ok: false,
      out: `⚠️ NVIDIA MAX non disponibile su questo PC.\n${g.reason}\n\n` +
        `Se hai una GeForce: reinstalla/aggiorna il driver NVIDIA (include nvidia-smi) e riprova.\n` +
        `Se hai AMD/Intel: usa GPU MAX + il pannello del produttore (Radeon Software / Intel Arc Control).`
    };
  }
  const rows = [
    `🎮 Scheda: ${g.name} · driver ${g.driver}`,
    `🌡️ Temperatura: ${fmt(g.tempC, '°C')} · utilizzo GPU: ${fmt(g.utilPct, '%')}`,
    `🌀 Ventola GPU: ${g.fanPct === null ? 'non leggibile (laptop o curva fissa)' : g.fanPct + '%'}`,
    `⚡ Potenza: ${fmt(g.powerW, ' W')} su limite ${fmt(g.powerLimitW, ' W')} (max consentito ${fmt(g.powerMaxW, ' W')})`,
    `⏱️ Clock grafico: ${fmt(g.clockMHz, ' MHz')} · massimo ${fmt(g.clockMaxMHz, ' MHz')}`,
    `💾 VRAM: ${g.memUsedMB === null ? 'n/d' : Math.round(g.memUsedMB) + '/' + Math.round(g.memTotalMB) + ' MB'}`,
    `📌 Persistence mode: ${g.persistence ? 'ON (driver sempre caricato)' : 'OFF (default)'}`
  ];
  const pode = g.powerMaxW !== null && g.powerLimitW !== null && g.powerMaxW > g.powerLimitW + 0.5;
  return {
    ok: true, gpu: g,
    out: `🎮 STATO NVIDIA — sola lettura, niente toccato:\n\n${rows.map(r => '• ' + r).join('\n')}\n\n` +
      `${pode ? '💡 C\'è margine sul power limit: NVIDIA MAX può alzarlo fino a ' + Math.floor(g.powerMaxW) + ' W.' : '💡 Power limit già al massimo consentito.'}`
  };
}

// ---------- registro: PowerMizer "massime prestazioni" ----------
const NVIDIA_CLASS = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}';
const PM_VALUES = [
  ['PowerMizerEnable', 1, 'DWord'],
  ['PowerMizerLevel', 1, 'DWord'],
  ['PowerMizerLevelAC', 1, 'DWord'],
  ['PerfLevelSrc', 8738, 'DWord'] // 0x2222
];

async function adapterKeys() {
  const r = await execRaw(ps(`$b='${NVIDIA_CLASS}'; Get-ChildItem $b -ErrorAction SilentlyContinue | ForEach-Object { $p=Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue; if ($p.DriverDesc -like '*NVIDIA*') { $_.PSChildName } }`));
  return String(r.stdout || '').split('\n').map(s => s.trim()).filter(s => /^\d{4}$/.test(s));
}
async function regGet(p, n) {
  const r = await execRaw(ps(`$v=(Get-ItemProperty -Path '${p}' -Name '${n}' -ErrorAction SilentlyContinue).'${n}'; if ($null -ne $v) { [string]$v } else { '__NULL__' }`));
  const line = String(r.stdout || '').split('\n').map(s => s.trim()).filter(Boolean).pop() || '__NULL__';
  if (line === '__NULL__') return { prev: null, kind: null };
  return { prev: line, kind: /^-?\d+$/.test(line) ? 'DWord' : 'String' };
}
async function regSet(p, n, v, kind = 'DWord') {
  const r = await sh(ps(`if (-not (Test-Path '${p}')) { New-Item -Path '${p}' -Force | Out-Null }; New-ItemProperty -Path '${p}' -Name '${n}' -Value ${v} -PropertyType ${kind} -Force | Out-Null; 'ok'`));
  if (!r.ok) return false;
  const after = await regGet(p, n);
  return after.prev !== null && String(after.prev) === String(v);
}

async function applyMax(opts = {}) {
  const g = await read(true);
  if (!g.available) {
    return { ok: false, out: `⚠️ NVIDIA MAX non disponibile: ${g.reason}` };
  }
  const snap = {
    powerLimitW: g.powerLimitW,
    persistence: g.persistence,
    regs: [],
    when: new Date().toISOString(),
    gpu: g.name
  };
  const log = [`🎮 NVIDIA MAX — ${g.name} (driver ${g.driver})`];

  // 1) persistence mode: il driver non si scarica a ogni cambio gioco/app
  const pm = await smi('-pm 1');
  log.push(`${pm.ok ? '✓' : '✕'} Persistence mode ON${pm.ok ? ' (meno stutter quando il gioco parte)' : ' (serve avvio come amministratore)'}`);

  // 2) power limit al massimo consentito (reale aumento di margine sulle GPU che lo permettono)
  if (g.tempC !== null && g.tempC >= 80) {
    log.push(`ℹ Power limit NON alzato: GPU a ${g.tempC}°C — alzarlo ora aggiunge calore e quindi throttling (meno FPS).`);
  } else if (g.powerMaxW !== null && g.powerLimitW !== null && g.powerMaxW > g.powerLimitW + 0.5) {
    const target = Math.floor(g.powerMaxW);
    const pl = await smi(`-pl ${target}`);
    log.push(pl.ok
      ? `✓ Power limit ${Math.round(g.powerLimitW)} W → ${target} W (la scheda può spingere più a lungo)`
      : `ℹ Power limit non modificabile (serve admin, oppure GPU bloccata dal produttore).`);
  } else {
    log.push(`ℹ Power limit già al massimo (${fmt(g.powerLimitW, ' W')}).`);
  }

  // 3) clock bloccato al massimo: niente cali di frequenza nei picchi
  // v1.4.1: il blocco del clock è OPT-IN (solo se richiesto esplicitamente).
  // Su laptop tipo MX450 tenere il clock fisso al massimo scalda e fa perdere FPS.
  if (opts.lockClocks === true && g.clockMaxMHz) {
    if (g.tempC !== null && g.tempC >= 78) {
      log.push(`ℹ Clock lock saltato: GPU a ${g.tempC}°C — raffreddala un attimo e riprova.`);
    } else {
      const lc = await smi(`-lgc ${Math.round(g.clockMaxMHz)}`);
      log.push(lc.ok
        ? `✓ Clock GPU bloccato al massimo (${Math.round(g.clockMaxMHz)} MHz): niente throttling software`
        : `ℹ Clock lock non supportato su questa GPU (normale su molte laptop).`);
    }
  }

  // 4) PowerMizer forzato su max prestazioni (registro, Windows)
  if (os.platform() === 'win32') {
    const keys = await adapterKeys();
    if (!keys.length) log.push('ℹ Adattatore NVIDIA non trovato nel registro: PowerMizer saltato.');
    for (const k of keys) {
      const key = `${NVIDIA_CLASS}\\${k}`;
      let okCount = 0;
      for (const [name, val, kind] of PM_VALUES) {
        const prev = await regGet(key, name);
        snap.regs.push({ path: key, name, prev: prev.prev, prevKind: prev.kind, val });
        if (await regSet(key, name, val, kind)) okCount++;
      }
      log.push(`${okCount >= 3 ? '✓' : 'ℹ'} PowerMizer "massime prestazioni" ${okCount >= 3 ? 'forzato' : 'parziale (serve admin)'} — effetto pieno al riavvio`);
    }
  }

  // 5) verifica reale di cosa è cambiato
  const after = await read(true);
  const changed = [];
  if (after.powerLimitW !== null && g.powerLimitW !== null && Math.round(after.powerLimitW) !== Math.round(g.powerLimitW)) {
    changed.push(`power limit ${Math.round(g.powerLimitW)} W → ${Math.round(after.powerLimitW)} W`);
  }
  if (after.persistence !== g.persistence) changed.push(`persistence ${g.persistence ? 'ON' : 'OFF'} → ${after.persistence ? 'ON' : 'OFF'}`);
  log.push(changed.length ? `🔎 Verificato dal driver: ${changed.join(' · ')}` : '🔎 Verifica: valori GPU invariati (driver/produttore non li espone).');

  // Salva lo snapshot SOLO la prima volta: se FPS MAX lo richiama, l'originale resta quello vero.
  if (!getSnap('nvidia')) putSnap('nvidia', snap);
  log.push('💾 Snapshot salvato: "↩ Reset NVIDIA" rimette power limit, clock e registro come prima.');
  log.push('ℹ Le impostazioni 3D del pannello NVIDIA non sono scriptabili: usa "📋 Guida pannello" e "Apri pannello" — 2 minuti, +5/15% FPS nei giochi GPU-bound.');
  return { ok: true, out: log.join('\n'), snap, gpu: after };
}

async function restore() {
  const snap = getSnap('nvidia');
  const log = ['↩ RESET NVIDIA → valori di fabbrica'];
  const g = await read(true);
  if (!g.available) log.push(`⚠️ nvidia-smi non disponibile: ripristino solo registro.`);

  const rgc = await smi('-rgc');
  log.push(rgc.ok ? '↩ Clock GPU sbloccato (torna la gestione automatica del driver)' : 'ℹ Clock GPU: niente da sbloccare.');
  const rmc = await smi('-rmc');
  if (rmc.ok) log.push('↩ Clock memoria sbloccato');

  if (snap && snap.powerLimitW !== null && snap.powerLimitW !== undefined) {
    const pl = await smi(`-pl ${Math.floor(snap.powerLimitW)}`);
    log.push(pl.ok ? `↩ Power limit → ${Math.floor(snap.powerLimitW)} W (come prima)` : `ℹ Power limit non ripristinabile senza admin.`);
  }
  if (snap && snap.persistence !== undefined) {
    const pm = await smi(`-pm ${snap.persistence ? 1 : 0}`);
    if (pm.ok) log.push(`↩ Persistence mode → ${snap.persistence ? 'ON' : 'OFF (default)'}`);
  }

  for (const { path, name, prev, prevKind } of (snap && snap.regs) || []) {
    if (prev === null) {
      await sh(ps(`Remove-ItemProperty -Path '${path}' -Name '${name}' -ErrorAction SilentlyContinue; 'ok'`));
      log.push(`↩ ${name} rimosso (default)`);
    } else {
      const type = ({ String: 'String', ExpandString: 'ExpandString', DWord: 'DWord', QWord: 'QWord' })[prevKind] || (/^-?\d+$/.test(prev || '') ? 'DWord' : 'String');
      await sh(ps(`Set-ItemProperty -Path '${path}' -Name '${name}' -Value ${prev} -Type ${type}; 'ok'`));
      log.push(`↩ ${name} → ${prev}`);
    }
  }
  if (!snap) log.push('ℹ Nessuno snapshot NVIDIA: ho solo sbloccato i clock.');
  log.push('✅ GPU in AUTOMATICO: decide di nuovo il driver (curve e boost di fabbrica).');
  putSnap('nvidia', null); // la prossima volta registriamo di nuovo i valori originali
  try { require('./persist').markRestored(); } catch {}
  return { ok: true, out: log.join('\n') };
}

async function guide() {
  const g = await read();
  const head = g.available
    ? `🎮 ${g.name} · ${fmt(g.tempC, '°C')} · ventola ${g.fanPct === null ? 'n/d' : g.fanPct + '%'}`
    : '⚠️ nvidia-smi non trovato: la guida vale comunque, ma non posso leggere i valori.';
  return {
    ok: true,
    out: `${head}\n\n` + require('./nvprofile').checklist()
  };
}

async function openPanel() {
  if (os.platform() !== 'win32') {
    return { ok: false, out: 'Apri il pannello NVIDIA dal sistema: su Linux usa `nvidia-settings`, su macOS Preferenze di Sistema → Monitor.' };
  }
  const r = await sh(ps(`$a = Get-StartApps | Where-Object { $_.Name -like '*NVIDIA*' } | Select-Object -First 1; if ($a) { Start-Process ('shell:AppsFolder\\' + $a.AppID); 'aperto: ' + $a.Name } else { Start-Process 'nvcplui.exe'; 'aperto pannello NVIDIA' }`), 20000);
  if (r.ok) return { ok: true, out: `🖥️ ${r.out}\nSegui la guida (📋 Guida pannello) e torna qui: il reset è sempre disponibile.` };
  return { ok: false, out: `⚠️ Non sono riuscito ad aprire il pannello NVIDIA.\nApri manualmente: tasto destro sul desktop → "NVIDIA Control Panel", oppure Microsoft Store → NVIDIA Control Panel.\nDettaglio: ${r.out}` };
}

module.exports = { read, status, applyMax, restore, guide, openPanel };
