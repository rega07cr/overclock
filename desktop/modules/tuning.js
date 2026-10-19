// tuning.js — GPU Driver Boost (NVIDIA/AMD) + Overclock intero sistema (PC vecchi).
// Solo tweak sicuri e reversibili. Le chiavi scritte vengono salvate per il ripristino.
const os = require('os');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

function sh(cmd, opts = {}) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: opts.timeout || 20000, windowsHide: true }, (err, stdout, stderr) => {
      const text = ((stdout || '') + '\n' + (stderr || '')).replace(/\r/g, '').split('\n')
        .map(l => l.trim()).filter(l => l).join('\n').slice(0, 900);
      resolve({ ok: !err, out: text || '(nessun output)' });
    });
  });
}
function ps(script) {
  return `powershell -NoProfile -ExecutionPolicy Bypass -Command "${script.replace(/"/g, "'")}"`;
}

// ---------- GPU ----------
async function gpuInfo() {
  const p = os.platform();
  if (p !== 'win32') {
    const r = await sh(p === 'darwin' ? 'system_profiler SPDisplaysDataType | head -8' : 'lspci 2>/dev/null | grep -i vga | head -4');
    return { vendor: /nvidia/i.test(r.out) ? 'nvidia' : /amd|radeon/i.test(r.out) ? 'amd' : 'other', detail: r.out };
  }
  const r = await sh(ps(`Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion | Format-List`));
  const out = r.out;
  const vendor = /nvidia/i.test(out) ? 'nvidia' : /amd|radeon/i.test(out) ? 'amd' : /intel/i.test(out) ? 'intel' : 'other';
  let smi = '';
  if (vendor === 'nvidia') {
    const s = await sh('nvidia-smi --query-gpu=name,driver_version --format=csv,noheader 2>&1');
    if (s.ok && /[0-9]/.test(s.out)) smi = '\nnvidia-smi: ' + s.out.split('\n')[0];
  }
  return { vendor, detail: out + smi };
}

function normMode(m) { m = String(m || 'media').toLowerCase(); return ['base', 'media', 'potente'].includes(m) ? m : 'media'; }
const MODE_LABEL = { base: 'Base 🟢 (sicura)', media: 'Media 🟡 (consigliata)', potente: 'Potente 🔴 (spinta)' };

async function previewGpu(mode) {
  mode = normMode(mode);
  const info = await gpuInfo();
  const admin = os.platform() === 'win32' ? await require('./system-booster').isAdmin() : false;
  const shader = mode === 'base' ? 'NON toccata (livello Base)' : `${info.vendor === 'nvidia' ? 'NVIDIA (GLCache+DxCache)' : info.vendor === 'amd' ? 'AMD (DxCache)' : '(generica)'}: file contati e rimossi (si rigenerano da soli al prossimo gioco)`;
  const hags = mode !== 'potente' ? 'SALTATO (solo livello Potente)' : (admin ? 'VERRÀ applicato (sei admin, serve riavvio)' : 'SALTATO (serve avvio come amministratore)');
  return {
    ok: true, preview: true,
    out: `👁 ANTEPRIMA — GPU Boost [${MODE_LABEL[mode]}] (${info.vendor.toUpperCase()}, non ho toccato nulla)\n\n✅ COSA FA:\n• Game Mode ON + fullscreen esclusivo (HKCU, immediato)\n• Cache shader: ${shader}\n• HAGS (HKLM HwSchMode=2): ${hags}\n🚫 COSA NON TOCCA: driver, giochi, salvataggi, altre app.\n👤 ADMIN: serve solo per HAGS. 🔄 RIAVVIO: serve solo per HAGS.\n↩ COME ANNULLARE: valori salvati, "↩ Ripristina" rimette tutto (anche dopo il riavvio).`
  };
}

async function previewOs(mode) {
  mode = normMode(mode);
  const cur = os.platform() === 'win32' ? await sh('powercfg /getactivescheme') : { out: '' };
  const plan = mode !== 'potente' ? 'NON toccato (solo livello Potente)' : (os.platform() === 'win32' ? 'ora "' + cur.out.split('\n')[0] + '" \u2192 Prestazioni elevate (' + PERF_GUID + ')' : 'solo Windows');
  const regs = mode === 'base'
    ? 'GameDVR_Enabled=0, GameDVR_AppCaptureEnabled=0, AllowAutoGameMode=1'
    : 'GameDVR off + GameMode on + EnableTransparency=0, TaskbarAnimations=0, MenuShowDelay=0' + (mode === 'potente' ? ', VisualFXSetting=3 (Custom) + ClearType preservato (FontSmoothing=2, Type=2, Gamma=1400)' : '');
  return {
    ok: true, preview: true,
    out: `👁 ANTEPRIMA — Overclock OS [${MODE_LABEL[mode]}] (non ho toccato nulla)\n\n✅ COSA FA:\n• Piano energia: ${plan}\n• Registro HKCU: ${regs}\n🚫 COSA NON TOCCA: file, giochi, altre app. 👤 ADMIN: serve solo per il piano energia.\n🔄 RIAVVIO: consigliato (o riavvia Explorer) per l\u2019effetto pieno.\n↩ COME ANNULLARE: piano + valori salvati, "↩ Ripristina" rimette tutto.`
  };
}

// Snapshot persistenti in ~/.overclock (sopravvivono a chiusura app + riavvio)
const persist = require('./persist');
const { putSnap, getSnap } = persist;

async function gpuBoost(mode) {
  mode = normMode(mode);
  // Applica preset sicuri. Ritorna snapshot per gpuRestore().
  const info = await gpuInfo();
  const snap = { vendor: info.vendor, regs: [] };
  const log = [`GPU rilevata: ${info.vendor.toUpperCase()}`];
  if (os.platform() !== 'win32') {
    log.push('Su macOS/Linux usa i pannelli nativi (vedi hint gioco).');
    return { ok: true, out: log.join('\n'), snap };
  }
  const admin = await require('./system-booster').isAdmin();
  const set = async (path, name, value, kind = 'DWord') => {
    const prev = await readReg(path, name);
    snap.regs.push({ path, name, prev: prev.prev, prevKind: prev.kind, val: value });
    const r = await sh(ps(`if (-not (Test-Path '${path}')) { New-Item -Path '${path}' -Force | Out-Null }; Set-ItemProperty -Path '${path}' -Name ${name} -Value ${value} -Type ${kind}; '${name}=${value}'`));
    log.push(`${r.ok ? '✓' : '✕'} ${name} → ${value}`);
    return r.ok;
  };
  // Game Mode ON + FSE: HKCU, niente admin, effetto immediato.
  await set('HKCU:\\Software\\Microsoft\\GameBar', 'AllowAutoGameMode', 1);
  await set('HKCU:\\Software\\Microsoft\\GameBar', 'AutoGameModeEnabled', 1);
  await set('HKCU:\\System\\GameConfigStore', 'GameDVR_FSEBehaviorMode', 2);
  await set('HKCU:\\System\\GameConfigStore', 'GameDVR_HonorUserFSEBehaviorMode', 1);
  // Pulizia cache shader vendor-specific (sicura: vengono rigenerate). Solo Media/Potente.
  if (mode !== 'base' && info.vendor === 'nvidia') {
    const c = await sh(ps(`$g=Join-Path $env:LOCALAPPDATA 'NVIDIA\\GLCache';$d=Join-Path $env:LOCALAPPDATA 'NVIDIA\\DxCache';`
      + `$n=(Get-ChildItem $g,$d -Recurse -Force -ErrorAction SilentlyContinue|Measure-Object).Count;`
      + `Get-ChildItem $g,$d -Recurse -Force -ErrorAction SilentlyContinue|Remove-Item -Recurse -Force -ErrorAction SilentlyContinue;'Shader cache NVIDIA: ' + $n + ' file rimossi (rigenerati al prossimo avvio gioco)'`));
    log.push((c.ok ? '✓ ' : '✕ ') + c.out.split('\n')[0]);
  }
  if (mode !== 'base' && info.vendor === 'amd') {
    const c = await sh(ps(`$g=Join-Path $env:LOCALAPPDATA 'AMD\\DxCache';`
      + `$n=(Get-ChildItem $g -Recurse -Force -ErrorAction SilentlyContinue|Measure-Object).Count;`
      + `Get-ChildItem $g -Recurse -Force -ErrorAction SilentlyContinue|Remove-Item -Recurse -Force -ErrorAction SilentlyContinue;'Shader cache AMD: ' + $n + ' file rimossi'`));
    log.push((c.ok ? '✓ ' : '✕ ') + c.out.split('\n')[0]);
  }
  // HAGS (scheduling GPU hardware): solo Potente + HKLM, serve admin + riavvio.
  if (mode === 'potente' && admin) {
    await set('HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers', 'HwSchMode', 2);
    log.push('ℹ HAGS attivato: riavvia il PC per effetto completo.');
  } else log.push(mode !== 'potente' ? 'ℹ HAGS saltato (solo livello Potente).' : 'ℹ HAGS saltato (richiede avvio come amministratore).');
  log.push('ℹ Per "Prestazioni massime" apri il pannello del vendor col pulsante dedicato.');
  putSnap('gpu', snap);
  return { ok: true, out: log.join('\n') + '\n↩ Snapshot salvato: "↩ Ripristina" riporta tutto come prima (anche dopo il riavvio).', snap };
}

async function gpuRestore(snapArg) {
  const snap = (snapArg && snapArg.regs) ? snapArg : (getSnap('gpu') || snapArg);
  const log = [];
  for (const { path, name, prev, prevKind } of (snap && snap.regs) || []) {
    if (prev === null) {
      await sh(ps(`Remove-ItemProperty -Path '${path}' -Name ${name} -ErrorAction SilentlyContinue; 'ok'`));
      log.push(`↩ ${name} rimosso (default)`);
    } else {
      // BUGFIX v1.1: prima il tipo registro veniva ignorato e il ripristino falliva
      // su String vs DWord. Ora riusa il tipo originale salvato.
      const type = ({String:'String',ExpandString:'ExpandString',DWord:'DWord',QWord:'QWord'})[prevKind] || (/^[0-9]+$/.test(prev || '') ? 'DWord' : 'String');
      await sh(ps(`Set-ItemProperty -Path '${path}' -Name ${name} -Value ${prev} -Type ${type}; 'ok'`));
      log.push(`↩ ${name} → ${prev}`);
    }
  }
  try { require('./persist').markRestored(); } catch {}
  return { ok: true, out: log.join('\n') || 'Niente da ripristinare.' };
}

function openVendorPanel(vendor) {
  const targets = {
    nvidia: ['nvcplui.exe', 'nvidia-smi'],
    amd: ['RadeonSoftware.exe', 'AMDRSSrcExt.exe'],
    intel: ['igfxEM.exe']
  };
  const [main] = targets[vendor] || [];
  if (!main) return Promise.resolve({ ok: false, out: 'Vendor sconosciuto' });
  return sh(`start "" "${main}" 2>&1 || echo "Apri manualmente il pannello ${vendor}"`);
}

// ---------- Overclock OS (PC vecchi) ----------
// [path, name, valueOn] — tutti HKCU, reversibili. Aggressività per livello.
const OC_BASE = [
  ['HKCU:\\System\\GameConfigStore', 'GameDVR_Enabled', 0],
  ['HKCU:\\System\\GameConfigStore', 'GameDVR_AppCaptureEnabled', 0],
  ['HKCU:\\Software\\Microsoft\\GameBar', 'AllowAutoGameMode', 1]
];
const OC_MEDIA = [
  ['HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', 'EnableTransparency', 0],
  ['HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced', 'TaskbarAnimations', 0],
  ['HKCU:\\Control Panel\\Desktop', 'MenuShowDelay', '0']
];
const OC_POWER = [
  // VisualFXSetting=3 (Custom): NON 2 (Best performance) che al riavvio spegne lo smoothing font.
  ['HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects', 'VisualFXSetting', 3],
  // ClearType completo: FontSmoothing="2" (REG_SZ) + Type=2 (DWORD) + Gamma default 1400 + orientamento RGB=1.
  ['HKCU:\\Control Panel\\Desktop', 'FontSmoothing', '2'],
  ['HKCU:\\Control Panel\\Desktop', 'FontSmoothingType', 2],
  ['HKCU:\\Control Panel\\Desktop', 'FontSmoothingGamma', 1400],
  ['HKCU:\\Control Panel\\Desktop', 'FontSmoothingOrientation', 1]
];
const PERF_GUID = '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c'; // Prestazioni elevate

async function readReg(path, name) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const get = await sh(ps(`$v=Get-ItemPropertyValue -Path '${path}' -Name '${name}' -ErrorAction SilentlyContinue; $k=try{(Get-Item -Path '${path}' -ErrorAction Stop).GetValueKind('${name}')}catch{'NONE'}; 'VAL='+$v+'|KIND='+$k`));
    const raw = get.ok ? get.out : '';
    const via = raw.indexOf('VAL='), ki = raw.indexOf('|KIND=');
    if (via >= 0 && ki > via) {
      const kind = raw.slice(ki + 6).trim().split(' ')[0];
      if (kind === 'NONE') {
        if (attempt < 2) { await new Promise(r => setTimeout(r, 600 * (attempt + 1))); continue; }
        return { prev: null, kind: null };
      }
      return { prev: raw.slice(via + 4, ki), kind };
    }
    if (attempt < 2) { await new Promise(r => setTimeout(r, 600 * (attempt + 1))); continue; }
    return { prev: null, kind: null };
  }
  return { prev: null, kind: null };
}

// Riattiva i font nitidi (ClearType) subito e in modo persistente tramite
// l'API documentata SystemParametersInfo (è lei a scrivere UserPreferencesMask:
// niente flip manuali del bitmask). Così VisualFXSetting=3 (Custom) non
// spegne lo smoothing al riavvio.
async function applyFontSmoothingLive(enable = true, type = 2, contrast = 1400, orientation = 1) {
  if (os.platform() !== 'win32') return { ok: true, out: 'Solo Windows.' };
  const on = !!enable;
  const ps1 = [
    'Add-Type @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class OcWin32 {',
    '  [DllImport("user32.dll", SetLastError = true)]',
    '  public static extern bool SystemParametersInfo(uint uiAction, uint uiParam, IntPtr pvParam, uint fWinIni);',
    '}',
    '"@',
    '$SPIF = 0x03',
    on
      ? '[OcWin32]::SystemParametersInfo(0x004B, 1, [IntPtr]::Zero, $SPIF) | Out-Null'
      : '[OcWin32]::SystemParametersInfo(0x004B, 0, [IntPtr]::Zero, $SPIF) | Out-Null',
    ...(on ? [
      `[OcWin32]::SystemParametersInfo(0x200B, ${type}, [IntPtr]::Zero, $SPIF) | Out-Null`,
      `[OcWin32]::SystemParametersInfo(0x200D, ${contrast}, [IntPtr]::Zero, $SPIF) | Out-Null`,
      `[OcWin32]::SystemParametersInfo(0x2013, ${orientation}, [IntPtr]::Zero, $SPIF) | Out-Null`,
    ] : []),
    `'fontsmooth-live-ok'`,
  ].join('\r\n');
  const tmp = path.join(os.tmpdir(), 'oc-fontsmooth.ps1');
  try { fs.writeFileSync(tmp, ps1, 'utf8'); }
  catch (e) { return { ok: false, out: 'tmp write fail: ' + e.message }; }
  const r = await sh(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmp}"`);
  try { fs.unlinkSync(tmp); } catch {}
  return r;
}

async function osOverclock(mode) {
  mode = normMode(mode);
  if (os.platform() !== 'win32') return { ok: false, out: 'Overclock OS supportato solo su Windows in questa versione.' };
  const snap = { regs: [], power: null };
  const log = [`⚡ OVERCLOCK SISTEMA ATTIVO [${mode}]`];
  const keys = mode === 'base' ? OC_BASE : mode === 'media' ? [...OC_BASE, ...OC_MEDIA] : [...OC_BASE, ...OC_MEDIA, ...OC_POWER];
  if (mode === 'potente') {
    const cur = await sh('powercfg /getactivescheme');
    snap.power = cur.out.split('\n')[0];
    const p = await sh(`powercfg /setactive ${PERF_GUID}`);
    log.push(`${p.ok ? '✓' : '✕'} Piano energia → Prestazioni elevate`);
  } else log.push('ℹ Piano energia invariato (solo livello Potente lo cambia).');
  for (const [path, name, val] of keys) {
    const snapRd = await readReg(path, name);
    let prev = snapRd.prev, prevKind = snapRd.kind;
    snap.regs.push({ path, name, prev, prevKind, val });
    const type = typeof val === 'number' ? 'DWord' : 'String';
    const r = await sh(ps(`if (-not (Test-Path '${path}')) { New-Item -Path '${path}' -Force | Out-Null }; Set-ItemProperty -Path '${path}' -Name ${name} -Value ${val} -Type ${type}; 'ok'`));
    const verify = await readReg(path, name);
    const realOk = r.ok && verify.prev !== null && String(verify.prev) === String(val);
    log.push(`${realOk ? '✓' : '✕'} ${name} → ${val}${realOk ? '' : ' (verifica fallita: valore non confermato)'}`);
  }
  if (mode === 'potente') {
    const fs1 = await applyFontSmoothingLive(true, 2, 1400, 1);
    log.push(`${fs1.ok ? '✓' : 'ℹ'} Font nitidi preservati (ClearType attivo subito${fs1.ok ? '' : ', verifica al riavvio'})`);
  }
  log.push('ℹ Trasparenza/animazioni/GameDVR off. Riavvia Explorer o il PC per l\u2019effetto pieno.');
  try { require('./persist').markActive('os-overclock:' + mode); } catch { global.__fpsBoost = true; }
  putSnap('os', snap);
  return { ok: true, out: log.join('\n') + '\n↩ Snapshot salvato: "↩ Ripristina" riporta tutto come prima (anche dopo il riavvio).', snap };
}

async function osRestore(snapArg) {
  const snap = (snapArg && (snapArg.regs || snapArg.power)) ? snapArg : (getSnap('os') || snapArg);
  const log = [];
  if (snap && snap.power) {
    const m = snap.power.match(/[0-9a-f-]{36}/i);
    if (m) { await sh(`powercfg /setactive ${m[0]}`); log.push(`↩ Piano energia ripristinato`); }
  }
  for (const { path, name, prev, prevKind, val } of (snap && snap.regs) || []) {
    if (prev === null) {
      const cur = await readReg(path, name);
      if (cur.prev === null) log.push(`↩ ${name} già assente`);
      else if (val !== undefined && String(cur.prev) !== String(val)) log.push(`↩ ${name} mantenuto (modificato dopo il buff)`);
      else { await sh(ps(`Remove-ItemProperty -Path '${path}' -Name ${name} -ErrorAction SilentlyContinue; 'ok'`)); log.push(`↩ ${name} rimosso (default ripristinato)`); }
    }
    else {
      const type = ({String:'String',ExpandString:'ExpandString',DWord:'DWord',QWord:'QWord'})[prevKind] || (/^[0-9]+$/.test(prev || '') ? 'DWord' : 'String');
      await sh(ps(`Set-ItemProperty -Path '${path}' -Name ${name} -Value ${prev} -Type ${type}; 'ok'`));
      log.push(`↩ ${name} ripristinato`);
    }
  }
  try {
    const curS = await readReg('HKCU:\\Control Panel\\Desktop', 'FontSmoothing');
    const curT = await readReg('HKCU:\\Control Panel\\Desktop', 'FontSmoothingType');
    if (curS.prev === '2') {
      const t = parseInt(curT.prev, 10);
      await applyFontSmoothingLive(true, t === 1 ? 1 : 2, 1400, 1);
      log.push('↩ ClearType riattivato subito');
    } else if (curS.prev === '0') {
      await applyFontSmoothingLive(false);
      log.push('↩ Smoothing ripristinato (off, come prima)');
    }
  } catch {}
  try { require('./persist').markRestored(); } catch { global.__fpsBoost = false; }
  return { ok: true, out: log.join('\n') || 'Niente da ripristinare.' };
}

async function listStartup() {
  if (os.platform() !== 'win32') return { ok: true, items: [], out: 'Solo Windows.' };
  const r = await sh(ps(`Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -ErrorAction SilentlyContinue | Get-Member -MemberType NoteProperty | Select-Object -ExpandProperty Name`));
  const items = r.out === '(nessun output)' ? [] : r.out.split('\n').filter(n => n && !/^PS/.test(n));
  return { ok: true, items, out: items.length ? items.join('\n') : 'Nessun programma in avvio automatico (HKCU).' };
}

async function toggleStartup(name, enable) {
  const src = enable ? 'RunBackup' : 'Run';
  const dst = enable ? 'Run' : 'RunBackup';
  const base = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion';
  const r = await sh(ps(`$v=(Get-ItemProperty '${base}\\${src}' -Name '${name}' -ErrorAction Stop).'${name}';`
    + `New-Item -Path '${base}\\${dst}' -Force | Out-Null; Set-ItemProperty -Path '${base}\\${dst}' -Name '${name}' -Value $v;`
    + `Remove-ItemProperty -Path '${base}\\${src}' -Name '${name}'; '${enable ? 'riattivato' : 'disabilitato'}: ${name}'`));
  return r;
}

// ---------- Helper snapshot: scrive una chiave salvando il valore precedente ----------
async function snapWrite(snap, log, p, name, val, kind) {
  const prev = await readReg(p, name);
  snap.regs.push({ path: p, name, prev: prev.prev, prevKind: prev.kind, val });
  const r = await sh(ps(`if (-not (Test-Path '${p}')) { New-Item -Path '${p}' -Force | Out-Null }; Set-ItemProperty -Path '${p}' -Name ${name} -Value ${val} -Type ${kind}; 'ok'`));
  const verify = await readReg(p, name);
  const ok = r.ok && verify.prev !== null && String(verify.prev) === String(val);
  log.push(`${ok ? '✓' : '✕'} ${name} → ${val}${ok ? '' : ' (verifica fallita)'}`);
  return ok;
}
async function snapDelete(snap, log, p, name) {
  const prev = await readReg(p, name);
  snap.regs.push({ path: p, name, prev: prev.prev, prevKind: prev.kind });
  if (prev.prev === null) { log.push(`ℹ ${name} già assente (default)`); return true; }
  await sh(ps(`Remove-ItemProperty -Path '${p}' -Name ${name} -ErrorAction SilentlyContinue; 'ok'`));
  const verify = await readReg(p, name);
  const ok = verify.prev === null;
  log.push(`${ok ? '↩' : '✕'} ${name} rimosso (default Windows)${ok ? '' : ' (verifica fallita)'}`);
  return ok;
}

// ---------- Finestra Aspetto: testo a scelta (Standard / ClearType) ----------
const FONT_MODES = {
  cleartype: { label: 'ClearType nitido (consigliato)', smoothing: '2', type: 2 },
  standard: { label: 'Standard classico', smoothing: '2', type: 1 },
  off: { label: 'Smoothing disattivato', smoothing: '0', type: 1 }
};
async function setFontMode(mode) {
  if (os.platform() !== 'win32') return { ok: false, out: 'Solo Windows.' };
  if (!FONT_MODES[mode]) mode = 'cleartype';
  const m = FONT_MODES[mode];
  const snap = { regs: [] };
  const log = [`🔤 Testo Windows → ${m.label}`];
  const DP = 'HKCU:\\Control Panel\\Desktop';
  await snapWrite(snap, log, DP, 'FontSmoothing', m.smoothing, 'String');
  await snapWrite(snap, log, DP, 'FontSmoothingType', m.type, 'DWord');
  if (mode !== 'off') {
    await snapWrite(snap, log, DP, 'FontSmoothingGamma', 1400, 'DWord');
    await snapWrite(snap, log, DP, 'FontSmoothingOrientation', 1, 'DWord');
  }
  const live = mode === 'off' ? await applyFontSmoothingLive(false) : await applyFontSmoothingLive(true, m.type, 1400, 1);
  log.push(`${live.ok ? '✓' : 'ℹ'} Effetto immediato${live.ok ? '' : ' (vedrai il cambio al riavvio)'}`);
  putSnap('font', snap);
  return { ok: true, out: log.join('\n') + '\n↩ Snapshot salvato: "↩ Ripristina" rimette il testo di prima.', snap };
}

// ---------- Finestra Aspetto: animazioni standard Windows ("torna normale") ----------
async function restoreAppearance() {
  if (os.platform() !== 'win32') return { ok: false, out: 'Solo Windows.' };
  const snap = { regs: [] };
  const log = ['↩ Aspetto Windows standard (come appena installato)'];
  const VE = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects';
  await snapDelete(snap, log, VE, 'VisualFXSetting'); // default = "Decide Windows"
  await snapWrite(snap, log, 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', 'EnableTransparency', 1, 'DWord');
  await snapWrite(snap, log, 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced', 'TaskbarAnimations', 1, 'DWord');
  await snapWrite(snap, log, 'HKCU:\\Control Panel\\Desktop', 'MenuShowDelay', '400', 'String');
  const DP = 'HKCU:\\Control Panel\\Desktop';
  await snapWrite(snap, log, DP, 'FontSmoothing', '2', 'String');
  await snapWrite(snap, log, DP, 'FontSmoothingType', 2, 'DWord');
  await snapWrite(snap, log, DP, 'FontSmoothingGamma', 1400, 'DWord');
  await snapWrite(snap, log, DP, 'FontSmoothingOrientation', 1, 'DWord');
  const live = await applyFontSmoothingLive(true, 2, 1400, 1);
  log.push(`${live.ok ? '✓' : 'ℹ'} Testo nitido riattivato subito`);
  log.push('ℹ Chiudi e riapri le app (o riavvia) per vedere ogni animazione come prima.');
  putSnap('appearance', snap);
  return { ok: true, out: log.join('\n'), snap };
}
async function previewAppearance() {
  if (os.platform() !== 'win32') return { ok: true, preview: true, out: 'Solo Windows.' };
  const keys = [
    ['HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects', 'VisualFXSetting', 'Effetti visivi (assente = Decide Windows)'],
    ['HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', 'EnableTransparency', 'Trasparenza finestre (1 = ON)'],
    ['HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced', 'TaskbarAnimations', 'Animazioni barra (1 = ON)'],
    ['HKCU:\\Control Panel\\Desktop', 'MenuShowDelay', 'Velocità menu in ms (400 = normale, 0 = istantaneo)'],
    ['HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', 'AppsUseLightTheme', 'Tema app (1 = chiaro, 0 = scuro)'],
    ['HKCU:\\Control Panel\\Desktop', 'FontSmoothing', 'Testo smussato (2 = ON)'],
    ['HKCU:\\Control Panel\\Desktop', 'FontSmoothingType', 'Tipo testo (2 = ClearType nitido, 1 = Standard)']
  ];
  const rows = [];
  for (const [p, n, what] of keys) { const r = await readReg(p, n); rows.push(`• ${n} = ${r.prev === null ? '(assente/default)' : r.prev} — ${what}`); }
  return { ok: true, preview: true, out: `👁 ANTEPRIMA — Aspetto standard (non ho toccato nulla)\n\n📊 VALORI ATTUALI SUL TUO PC:\n${rows.join('\n')}\n\n✅ COSA FARÀ “Torna tutto normale”: VisualFX default, trasparenza ON, animazioni ON, menu 400ms, tema chiaro, ClearType nitido.\n🚫 COSA NON TOCCA: file, giochi, app. 👤 ADMIN: non serve. 🔄 RIAVVIO: basta chiudere/riaprire le app.\n↩ COME ANNULLARE: snapshot dedicato, ogni singola opzione sotto è comunque separata.` };
}
async function previewFont() {
  if (os.platform() !== 'win32') return { ok: true, preview: true, out: 'Solo Windows.' };
  const DP = 'HKCU:\\Control Panel\\Desktop';
  const s = await readReg(DP, 'FontSmoothing');
  const t = await readReg(DP, 'FontSmoothingType');
  const g = await readReg(DP, 'FontSmoothingGamma');
  const cur = s.prev === '2' ? (String(t.prev) === '1' ? 'Standard classico' : 'ClearType nitido') : s.prev === '0' ? 'Smoothing OFF' : 'sconosciuto/default';
  return { ok: true, preview: true, out: `👁 ANTEPRIMA — Testo di Windows (non ho toccato nulla)\n\n📊 ORA HAI: ${cur} (FontSmoothing=${s.prev}, Type=${t.prev}, Gamma=${g.prev}).\n\n✅ COSA FA LA SCELTA:\n• ✨ ClearType nitido (consigliato): caratteri pieni e definiti, ideale su schermi moderni.\n• 📝 Standard classico: resa più leggera stile Windows classico.\n• ⬜ Smoothing OFF: testo secco, solo se sai cosa fai.\n🚫 NON TOCCA: nient\u2019altro — solo 2-4 chiavi font. 👤 ADMIN: non serve. 🔄 EFFETTO: immediato + resta dopo il riavvio.\n↩ COME ANNULLARE: snapshot dedicato, “↩ Torna tutto normale” rimette ClearType.` };
}
// ---------- Aspetto esteso v1.1: singole opzioni ----------
async function setLookOption(opt, val) {
  if (os.platform() !== 'win32') return { ok: false, out: 'Solo Windows.' };
  const snap = getSnap('appearance-opts') || { regs: [] };
  const log = [];
  const P = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize';
  const A = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced';
  const D = 'HKCU:\\Control Panel\\Desktop';
  if (opt === 'transparency') await snapWrite(snap, log, P, 'EnableTransparency', val ? 1 : 0, 'DWord');
  else if (opt === 'animations') { await snapWrite(snap, log, A, 'TaskbarAnimations', val ? 1 : 0, 'DWord'); if (!val) await snapWrite(snap, log, P, 'EnableTransparency', 0, 'DWord'); }
  else if (opt === 'menudelay') await snapWrite(snap, log, D, 'MenuShowDelay', String(val), 'String');
  else if (opt === 'theme') await snapWrite(snap, log, P, 'AppsUseLightTheme', val === 'light' ? 1 : 0, 'DWord');
  else return { ok: false, out: 'Opzione sconosciuta: ' + opt };
  putSnap('appearance-opts', snap);
  try { require('./persist').markActive('aspetto:' + opt); } catch {}
  const labels = { transparency: 'Trasparenza → ' + (val ? 'ON' : 'OFF'), animations: 'Animazioni → ' + (val ? 'ON' : 'OFF'), menudelay: 'Velocità menu → ' + val + 'ms' + (String(val) === '0' ? ' (istantaneo)' : String(val) === '400' ? ' (normale)' : ''), theme: 'Tema app → ' + val };
  return { ok: true, out: (log.join('\n') || labels[opt]) + '\n💾 Resta anche dopo aver chiuso l\u2019app. ↩ “Torna tutto normale” annulla tutto.', snap };
}

// ---------- GPU MAX: massimi tweak in base alla scheda rilevata ----------
async function resolveExePath(proc) {
  if (!proc) return null;
  const r = await sh(ps(`(Get-Process -Name '${proc}' -ErrorAction SilentlyContinue | Select-Object -First 1).Path`));
  const line = (r.ok ? r.out.split('\n')[0] : '').trim();
  return /\.exe$/i.test(line) ? line : null;
}
async function previewGpuMax(arg) {
  const info = await gpuInfo();
  const admin = os.platform() === 'win32' ? await require('./system-booster').isAdmin() : false;
  const proc = arg && (arg.process || arg);
  const hk = (txt) => admin ? `VERRÀ applicato (sei admin, serve riavvio) — ${txt}` : `SALTATO (serve avvio come amministratore) — ${txt}`;
  return { ok: true, preview: true, out:
    `👁 ANTEPRIMA — GPU MAX [${info.vendor.toUpperCase()}] (non ho toccato nulla)\n\n✅ COSA FA (solo più FPS, niente freeze alle altre app):\n` +
    `• GameDVR OFF + Game Mode ON (HKCU, immediato): Windows smette di registrare in background\n` +
    `• Cache shader pulita (${info.vendor === 'nvidia' ? 'NVIDIA GLCache+DxCache' : info.vendor === 'amd' ? 'AMD DxCache' : 'generica'}): micro-stutter via, si rigenera da sola\n` +
    `• HAGS (HwSchMode=2, HKLM): ${hk('la GPU gestisce la memoria da sola = più FPS stabili')}\n` +
    `• MPO off anti-stutter (OverlayTestMode=5, HKLM): ${hk('via gli scattini su 144Hz+/multi-monitor')}\n` +
    `• Power Throttling off (HKLM): ${hk('la GPU non viene più rallentata in background')}\n` +
    `• Preferenza “alte prestazioni” per ${proc || '(nessun gioco indicato — avvia il gioco e scrivi il processo, es. cs2)'} (HKCU, immediata)\n` +
    `🚫 COSA NON TOCCA: driver, giochi, salvataggi, Discord/browser (restano fluidi).\n↩ COME ANNULLARE: snapshot dedicato, “↩ Ripristina” rimette tutto.` };
}
async function previewCpuMax() {
  const admin = os.platform() === 'win32' ? await require('./system-booster').isAdmin() : false;
  const hk = (txt) => admin ? `VERRÀ applicato (sei admin, serve riavvio) — ${txt}` : `SALTATO (serve avvio come amministratore) — ${txt}`;
  return { ok: true, preview: true, out:
    `👁 ANTEPRIMA — CPU MAX (non ho toccato nulla)\n\n✅ COSA FA (solo più FPS, la CPU spinge il gioco):\n` +
    `• Piano energia → Prestazioni elevate (immediato): niente più risparmi mentre giochi\n` +
    `• Power Throttling off (HKLM): ${hk('niente più cali quando il gioco va in background un secondo')}\n` +
    `• Priorità giochi del Multimedia Scheduler (HKLM): SystemResponsiveness=10 + Games=High — ${hk('Windows dà più CPU al gioco che a tutto il resto')}\n` +
    `• Foreground boost Win32PrioritySeparation=38 (HKCU, immediato): la finestra in primo piano risponde prima\n` +
    `🚫 COSA NON TOCCA: file, altre app (non vengono chiuse né sospese), overclock hardware reale (no voltage).\n↩ COME ANNULLARE: snapshot dedicato, “↩ Ripristina” rimette piano energia + registro.` };
}
async function previewFpsMax(arg) {
  const g = await previewGpuMax(arg);
  const c = await previewCpuMax();
  return { ok: true, preview: true, out: `👁 ANTEPRIMA — 🚀 FPS MAX = GPU MAX + CPU MAX (non ho toccato nulla)\n\nL\u2019unico obiettivo è alzare gli FPS. Le app in background restano intatte.\n\n────────── GPU ──────────\n${g.out}\n\n────────── CPU ──────────\n${c.out}` };
}
async function cleanShaderCache(info, log) {
  // Pulizia cache shader: via gli stutter, i file si rigenerano al prossimo avvio gioco.
  try {
    if (info.vendor === 'nvidia') {
      const c = await sh(ps(`$g=Join-Path $env:LOCALAPPDATA 'NVIDIA\\GLCache';$d=Join-Path $env:LOCALAPPDATA 'NVIDIA\\DxCache';` +
        `$n=(Get-ChildItem $g,$d -Recurse -Force -ErrorAction SilentlyContinue|Measure-Object).Count;` +
        `Get-ChildItem $g,$d -Recurse -Force -ErrorAction SilentlyContinue|Remove-Item -Recurse -Force -ErrorAction SilentlyContinue;'Shader cache NVIDIA: '+$n+' file rimossi'`));
      log.push((c.ok ? '✓ ' : '✕ ') + c.out.split('\n')[0]);
    } else if (info.vendor === 'amd') {
      const c = await sh(ps(`$g=Join-Path $env:LOCALAPPDATA 'AMD\\DxCache';` +
        `$n=(Get-ChildItem $g -Recurse -Force -ErrorAction SilentlyContinue|Measure-Object).Count;` +
        `Get-ChildItem $g -Recurse -Force -ErrorAction SilentlyContinue|Remove-Item -Recurse -Force -ErrorAction SilentlyContinue;'Shader cache AMD: '+$n+' file rimossi'`));
      log.push((c.ok ? '✓ ' : '✕ ') + c.out.split('\n')[0]);
    } else {
      const c = await sh(ps(`$d=Join-Path $env:LOCALAPPDATA 'D3DSCache';` +
        `$n=(Get-ChildItem $d -Recurse -Force -ErrorAction SilentlyContinue|Measure-Object).Count;` +
        `Get-ChildItem $d -Recurse -Force -ErrorAction SilentlyContinue|Remove-Item -Recurse -Force -ErrorAction SilentlyContinue;'Cache DirectX: '+$n+' file rimossi'`));
      log.push((c.ok ? '✓ ' : '✕ ') + c.out.split('\n')[0]);
    }
  } catch (e) { log.push('ℹ Cache shader saltata: ' + e.message); }
}
async function gpuMax(arg) {
  if (os.platform() !== 'win32') return { ok: false, out: 'GPU MAX supportato solo su Windows in questa versione.' };
  const proc = arg && (arg.process || (typeof arg === 'string' ? arg : null));
  const info = await gpuInfo();
  const admin = await require('./system-booster').isAdmin();
  const snap = { vendor: info.vendor, regs: [] };
  const log = [`🎨 GPU MAX ATTIVO [${info.vendor.toUpperCase()}]${admin ? '' : ' (senza admin: solo tweak HKCU — riavvia come admin per il massimo)'}`];
  // Parte immediata HKCU: GameDVR off (smette di registrare) + Game Mode on + FSE.
  await snapWrite(snap, log, 'HKCU:\\System\\GameConfigStore', 'GameDVR_Enabled', 0, 'DWord');
  await snapWrite(snap, log, 'HKCU:\\System\\GameConfigStore', 'GameDVR_AppCaptureEnabled', 0, 'DWord');
  await snapWrite(snap, log, 'HKCU:\\Software\\Microsoft\\GameBar', 'AllowAutoGameMode', 1, 'DWord');
  await snapWrite(snap, log, 'HKCU:\\Software\\Microsoft\\GameBar', 'AutoGameModeEnabled', 1, 'DWord');
  await snapWrite(snap, log, 'HKCU:\\System\\GameConfigStore', 'GameDVR_FSEBehaviorMode', 2, 'DWord');
  await cleanShaderCache(info, log);
  if (admin) {
    await snapWrite(snap, log, 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers', 'HwSchMode', 2, 'DWord');
    await snapWrite(snap, log, 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\Dwm', 'OverlayTestMode', 5, 'DWord');
    await snapWrite(snap, log, 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Power\\PowerThrottling', 'PowerThrottlingOff', 1, 'DWord');
    log.push('🔄 MPO off + HAGS + throttling off: RIAVVIA il PC per l\u2019effetto pieno.');
  } else log.push('ℹ HKLM saltato (HAGS/MPO/throttling richiedono avvio come amministratore) — il resto è già attivo.');
  const exe = await resolveExePath(proc);
  if (exe) {
    await snapWrite(snap, log, 'HKCU:\\SOFTWARE\\Microsoft\\DirectX\\UserGpuPreferences', exe, 'GpuPreference=2;', 'String');
    log.push(`✓ ${exe.split('\\').pop()} → GPU alte prestazioni dedicata`);
  } else log.push(`ℹ Preferenza GPU saltata: avvia il gioco${proc ? ` (${proc})` : ''} e ripremi GPU MAX.`);
  log.push('✅ App in background: intatte, nessun freeze.');
  log.push('💾 Resta anche dopo aver chiuso l\u2019app (registro + snapshot in ~/.overclock).');
  try { require('./persist').markActive('gpu-max'); } catch { global.__fpsBoost = true; }
  putSnap('gpumax', snap);
  return { ok: true, out: log.join('\n') + '\n↩ Snapshot salvato: ripristino dedicato rimette tutto come prima.', snap };
}
// ---------- CPU MAX v1.1: la CPU spinge solo il gioco ----------
const PERF_GUID_FPS = '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c';
async function cpuMax() {
  if (os.platform() !== 'win32') return { ok: false, out: 'CPU MAX supportato solo su Windows in questa versione.' };
  const admin = await require('./system-booster').isAdmin();
  const snap = { regs: [], power: null };
  const log = ['🧠 CPU MAX ATTIVO — la CPU lavora per il gioco, le altre app restano vive'];
  const cur = await sh('powercfg /getactivescheme');
  snap.power = cur.out.split('\n')[0];
  const p = await sh(`powercfg /setactive ${PERF_GUID_FPS}`);
  log.push(`${p.ok ? '✓' : '✕'} Piano energia → Prestazioni elevate (niente più risparmi mentre giochi)`);
  await snapWrite(snap, log, 'HKCU:\\Control Panel\\Desktop', 'ForegroundLockTimeout', 0, 'DWord');
  await snapWrite(snap, log, 'HKCU:\\Control Panel\\Desktop', 'Win32PrioritySeparation', 38, 'DWord');
  if (admin) {
    await snapWrite(snap, log, 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Power\\PowerThrottling', 'PowerThrottlingOff', 1, 'DWord');
    await snapWrite(snap, log, 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile', 'SystemResponsiveness', 10, 'DWord');
    await snapWrite(snap, log, 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games', 'GPU Priority', 8, 'DWord');
    await snapWrite(snap, log, 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games', 'Priority', 6, 'DWord');
    await snapWrite(snap, log, 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games', 'Scheduling Category', 'High', 'String');
    log.push('🔄 Throttling off + scheduler giochi: RIAVVIA il PC per l\u2019effetto pieno.');
  } else log.push('ℹ Scheduler giochi saltato (serve admin) — piano energia + foreground boost già attivi.');
  log.push('✅ App in background: intatte, nessun freeze. 💾 Resta dopo la chiusura dell\u2019app.');
  try { require('./persist').markActive('cpu-max'); } catch { global.__fpsBoost = true; }
  putSnap('cpumax', snap);
  return { ok: true, out: log.join('\n') + '\n↩ Snapshot salvato: ripristino dedicato rimette tutto come prima.', snap };
}
async function restoreRegs(key, fallbackMsg) {
  const snap = getSnap(key);
  const log = [];
  if (snap && snap.power) {
    const m = String(snap.power).match(/[0-9a-f-]{36}/i);
    if (m) { await sh(`powercfg /setactive ${m[0]}`); log.push('↩ Piano energia ripristinato'); }
  }
  for (const { path, name, prev, prevKind } of ((snap && snap.regs) || [])) {
    if (prev === null) {
      await sh(ps(`Remove-ItemProperty -Path '${path}' -Name ${name} -ErrorAction SilentlyContinue; 'ok'`));
      log.push(`↩ ${name} rimosso (default)`);
    } else {
      const type = ({String:'String',ExpandString:'ExpandString',DWord:'DWord',QWord:'QWord'})[prevKind] || (/^[0-9]+$/.test(prev || '') ? 'DWord' : 'String');
      await sh(ps(`Set-ItemProperty -Path '${path}' -Name ${name} -Value ${prev} -Type ${type}; 'ok'`));
      log.push(`↩ ${name} → ${prev}`);
    }
  }
  try { require('./persist').markRestored(); } catch {}
  return { ok: true, out: log.join('\n') || fallbackMsg };
}
async function cpuMaxRestore() { return restoreRegs('cpumax', 'Niente da ripristinare (CPU MAX mai applicato).'); }
// ---------- 🚀 FPS MAX v1.1: GPU MAX + CPU MAX in un click (solo più FPS) ----------
async function fpsMax(arg) {
  if (os.platform() !== 'win32') return { ok: false, out: 'FPS MAX supportato solo su Windows in questa versione.' };
  const g = await gpuMax(arg);
  const c = await cpuMax();
  const ok = g.ok && c.ok;
  try { require('./persist').markActive('fps-max'); } catch {}
  return { ok, out: `🚀 FPS MAX ${ok ? 'ATTIVO' : 'PARZIALE'} — unico obiettivo: più FPS (app in background intatte)\n\n────────── GPU ──────────\n${g.out}\n\n────────── CPU ──────────\n${c.out}`, snap: { gpu: g.snap, cpu: c.snap } };
}
async function fpsMaxRestore() {
  const g = await restoreRegs('gpumax', 'GPU: niente da ripristinare.');
  const c = await restoreRegs('cpumax', 'CPU: niente da ripristinare.');
  return { ok: true, out: `↩ FPS MAX ripristinato:\n\n── GPU ──\n${g.out}\n\n── CPU ──\n${c.out}` };
}
async function gpuMaxRestore(snapArg) {
  const snap = (snapArg && snapArg.regs) ? snapArg : (getSnap('gpumax') || snapArg);
  const log = [];
  for (const { path, name, prev, prevKind } of (snap && snap.regs) || []) {
    if (prev === null) {
      await sh(ps(`Remove-ItemProperty -Path '${path}' -Name ${name} -ErrorAction SilentlyContinue; 'ok'`));
      log.push(`↩ ${name} rimosso (default)`);
    } else {
      const type = ({String:'String',ExpandString:'ExpandString',DWord:'DWord',QWord:'QWord'})[prevKind] || (/^[0-9]+$/.test(prev || '') ? 'DWord' : 'String');
      await sh(ps(`Set-ItemProperty -Path '${path}' -Name ${name} -Value ${prev} -Type ${type}; 'ok'`));
      log.push(`↩ ${name} → ${prev}`);
    }
  }
  return { ok: true, out: log.join('\n') || 'Niente da ripristinare (GPU MAX mai applicato).' };
}

module.exports = { gpuInfo, gpuBoost, gpuRestore, openVendorPanel, osOverclock, osRestore, listStartup, toggleStartup, previewGpu, previewOs, applyFontSmoothingLive, setFontMode, restoreAppearance, previewAppearance, previewFont, setLookOption, previewGpuMax, previewCpuMax, previewFpsMax, gpuMax, gpuMaxRestore, cpuMax, cpuMaxRestore, fpsMax, fpsMaxRestore };
