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
  const shader = mode === 'base' ? 'NON toccata (livello Base)' : `${info.vendor === 'nvidia' ? 'NVIDIA (GLCache+DxCache)' : info.vendor === 'amd' ? 'AMD (DxCache)' : '(generica)'}: file contati e rimossi (rigenerati al prossimo avvio gioco)`;
  const hags = mode !== 'potente' ? 'SALTATO (solo livello Potente)' : (admin ? 'VERRÀ applicato (sei admin, serve riavvio)' : 'SALTATO (serve avvio come amministratore)');
  return {
    ok: true, preview: true,
    out: `👁 ANTEPRIMA — GPU Boost [${MODE_LABEL[mode]}] (${info.vendor.toUpperCase()}, nessuna modifica ancora):\n\u2022 Registro: HKCU GameBar AllowAutoGameMode=1, AutoGameModeEnabled=1 + GameConfigStore FSE=2 (HKCU, effetto immediato)\n\u2022 Cache shader: ${shader}\n\u2022 HAGS (HKLM HwSchMode=2): ${hags}\n\u2022 Ripristino: valori precedenti salvati, "\u21a9 Ripristina" li rimette`
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
    out: `👁 ANTEPRIMA — Overclock OS [${MODE_LABEL[mode]}] (nessuna modifica ancora):\n\u2022 Piano energia: ${plan}\n\u2022 Registro HKCU: ${regs}\n\u2022 Explorer/riavvio consigliato per effetto pieno\n\u2022 Ripristino: piano energia + valori precedenti salvati, "\u21a9 Ripristina" li rimette`
  };
}

function putSnap(key, snap) {
  try {
    const f = path.join(os.tmpdir(), 'overclock-snaps.json');
    let all = {}; try { all = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
    all[key] = { when: new Date().toISOString(), snap }; fs.writeFileSync(f, JSON.stringify(all, null, 1));
  } catch {}
}
function getSnap(key) {
  try {
    const f = path.join(os.tmpdir(), 'overclock-snaps.json');
    return (JSON.parse(fs.readFileSync(f, 'utf8'))[key] || {}).snap || null;
  } catch { return null; }
}

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
    const get = await sh(ps(`(Get-ItemProperty -Path '${path}' -Name ${name} -ErrorAction SilentlyContinue).${name}`));
    const prev = get.ok && get.out !== '(nessun output)' ? get.out.split('\n')[0] : null;
    snap.regs.push({ path, name, prev });
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
      await sh(ps(`Set-ItemProperty -Path '${path}' -Name ${name} -Value ${prev}; 'ok'`));
      log.push(`↩ ${name} → ${prev}`);
    }
  }
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
    const get = await sh(ps(`$v=(Get-ItemProperty -Path '${path}' -Name ${name} -ErrorAction SilentlyContinue).${name}; $k=try{(Get-Item -Path '${path}' -ErrorAction Stop).GetValueKind('${name}')}catch{'NONE'}; 'VAL='+$v+'|KIND='+$k`));
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
  global.__fpsBoost = true;
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
    }
    log.push(`↩ ${name} ripristinato`);
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
  global.__fpsBoost = false;
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

module.exports = { gpuInfo, gpuBoost, gpuRestore, openVendorPanel, osOverclock, osRestore, listStartup, toggleStartup, previewGpu, previewOs, applyFontSmoothingLive };
