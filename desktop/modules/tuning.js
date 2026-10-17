// tuning.js — GPU Driver Boost (NVIDIA/AMD) + Overclock intero sistema (PC vecchi).
// Solo tweak sicuri e reversibili. Le chiavi scritte vengono salvate per il ripristino.
const os = require('os');
const { exec } = require('child_process');
const { isAdmin } = require('./system-booster');

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

async function gpuBoost() {
  // Applica preset sicuri. Ritorna snapshot per gpuRestore().
  const info = await gpuInfo();
  const snap = { vendor: info.vendor, regs: [] };
  const log = [`GPU rilevata: ${info.vendor.toUpperCase()}`];
  if (os.platform() !== 'win32') {
    log.push('Su macOS/Linux usa i pannelli nativi (vedi hint gioco).');
    return { ok: true, out: log.join('\n'), snap };
  }
  const admin = await isAdmin();
  const set = async (path, name, value, kind = 'DWord') => {
    const get = await sh(ps(`(Get-ItemProperty -Path '${path}' -Name ${name} -ErrorAction SilentlyContinue).${name}`));
    const prev = get.ok && get.out !== '(nessun output)' ? get.out.split('\n')[0] : null;
    snap.regs.push({ path, name, prev });
    const r = await sh(ps(`New-Item -Path '${path}' -Force | Out-Null; Set-ItemProperty -Path '${path}' -Name ${name} -Value ${value} -Type ${kind}; '${name}=${value}'`));
    log.push(`${r.ok ? '✓' : '✕'} ${name} → ${value}`);
    return r.ok;
  };
  // Game Mode ON + FSE: HKCU, niente admin, effetto immediato.
  await set('HKCU:\\Software\\Microsoft\\GameBar', 'AllowAutoGameMode', 1);
  await set('HKCU:\\Software\\Microsoft\\GameBar', 'AutoGameModeEnabled', 1);
  await set('HKCU:\\System\\GameConfigStore', 'GameDVR_FSEBehaviorMode', 2);
  await set('HKCU:\\System\\GameConfigStore', 'GameDVR_HonorUserFSEBehaviorMode', 1);
  // Pulizia cache shader vendor-specific (sicura: vengono rigenerate).
  if (info.vendor === 'nvidia') {
    const c = await sh(ps(`$g=Join-Path $env:LOCALAPPDATA 'NVIDIA\\GLCache';$d=Join-Path $env:LOCALAPPDATA 'NVIDIA\\DxCache';`
      + `$n=(Get-ChildItem $g,$d -Recurse -Force -ErrorAction SilentlyContinue|Measure-Object).Count;`
      + `Get-ChildItem $g,$d -Recurse -Force -ErrorAction SilentlyContinue|Remove-Item -Recurse -Force -ErrorAction SilentlyContinue;'Shader cache NVIDIA: ' + $n + ' file rimossi (rigenerati al prossimo avvio gioco)'`));
    log.push((c.ok ? '✓ ' : '✕ ') + c.out.split('\n')[0]);
  }
  if (info.vendor === 'amd') {
    const c = await sh(ps(`$g=Join-Path $env:LOCALAPPDATA 'AMD\\DxCache';`
      + `$n=(Get-ChildItem $g -Recurse -Force -ErrorAction SilentlyContinue|Measure-Object).Count;`
      + `Get-ChildItem $g -Recurse -Force -ErrorAction SilentlyContinue|Remove-Item -Recurse -Force -ErrorAction SilentlyContinue;'Shader cache AMD: ' + $n + ' file rimossi'`));
    log.push((c.ok ? '✓ ' : '✕ ') + c.out.split('\n')[0]);
  }
  // HAGS (scheduling GPU hardware): HKLM, serve admin + riavvio.
  if (admin) {
    await set('HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers', 'HwSchMode', 2);
    log.push('ℹ HAGS attivato: riavvia il PC per effetto completo.');
  } else log.push('ℹ HAGS saltato (richiede avvio come amministratore).');
  log.push('ℹ Per "Prestazioni massime" apri il pannello del vendor col pulsante dedicato.');
  return { ok: true, out: log.join('\n'), snap };
}

async function gpuRestore(snap) {
  const log = [];
  for (const { path, name, prev } of (snap && snap.regs) || []) {
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
const OC_KEYS = [
  // [path, name, valueOn] — tutti HKCU, reversibili
  ['HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', 'EnableTransparency', 0],
  ['HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced', 'TaskbarAnimations', 0],
  ['HKCU:\\Control Panel\\Desktop', 'MenuShowDelay', '0'],
  ['HKCU:\\System\\GameConfigStore', 'GameDVR_Enabled', 0],
  ['HKCU:\\System\\GameConfigStore', 'GameDVR_AppCaptureEnabled', 0],
  ['HKCU:\\Software\\Microsoft\\GameBar', 'AllowAutoGameMode', 1],
  ['HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects', 'VisualFXSetting', 2]
];
const PERF_GUID = '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c'; // Prestazioni elevate

async function osOverclock() {
  if (os.platform() !== 'win32') return { ok: false, out: 'Overclock OS supportato solo su Windows in questa versione.' };
  const snap = { regs: [], power: null };
  const log = ['⚡ OVERCLOCK SISTEMA ATTIVO'];
  const cur = await sh('powercfg /getactivescheme');
  snap.power = cur.out.split('\n')[0];
  const p = await sh(`powercfg /setactive ${PERF_GUID}`);
  log.push(`${p.ok ? '✓' : '✕'} Piano energia → Prestazioni elevate`);
  for (const [path, name, val] of OC_KEYS) {
    const get = await sh(ps(`(Get-ItemProperty -Path '${path}' -Name ${name} -ErrorAction SilentlyContinue).${name}`));
    const prev = get.ok && get.out !== '(nessun output)' ? get.out.split('\n')[0] : null;
    snap.regs.push({ path, name, prev });
    const type = typeof val === 'number' ? 'DWord' : 'String';
    const r = await sh(ps(`New-Item -Path '${path}' -Force | Out-Null; Set-ItemProperty -Path '${path}' -Name ${name} -Value ${val} -Type ${type}; 'ok'`));
    log.push(`${r.ok ? '✓' : '✕'} ${name} → ${val}`);
  }
  log.push('ℹ Trasparenza/animazioni/GameDVR off. Riavvia Explorer o il PC per l\u2019effetto pieno.');
  global.__fpsBoost = true;
  return { ok: true, out: log.join('\n'), snap };
}

async function osRestore(snap) {
  const log = [];
  if (snap && snap.power) {
    const m = snap.power.match(/[0-9a-f-]{36}/i);
    if (m) { await sh(`powercfg /setactive ${m[0]}`); log.push(`↩ Piano energia ripristinato`); }
  }
  for (const { path, name, prev } of (snap && snap.regs) || []) {
    if (prev === null) await sh(ps(`Remove-ItemProperty -Path '${path}' -Name ${name} -ErrorAction SilentlyContinue; 'ok'`));
    else {
      const type = /^\d+$/.test(prev) ? 'DWord' : 'String';
      await sh(ps(`Set-ItemProperty -Path '${path}' -Name ${name} -Value ${prev} -Type ${type}; 'ok'`));
    }
    log.push(`↩ ${name} ripristinato`);
  }
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

module.exports = { gpuInfo, gpuBoost, gpuRestore, openVendorPanel, osOverclock, osRestore, listStartup, toggleStartup, isAdmin };
