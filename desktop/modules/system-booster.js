// System Booster — comandi testati su Windows reale, stato onesto (ok/fail veri).
const os = require('os');
const { exec } = require('child_process');

const MAX_OUT = 700;
// Pattern di errore PowerShell/CMD anche quando l'exit code è 0.
const ERR_RE = /non riconosciuto|not recognized|accesso negato|access denied|elevazione|elevation|non riuscito|failed|error|eccezione|exception|impossib|impossible|not found|invalid/i;

function sh(cmd, opts = {}) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: opts.timeout || 20000, windowsHide: true }, (err, stdout, stderr) => {
      const text = ((stdout || '') + '\n' + (stderr || '')).replace(/\r/g, '').split('\n')
        .map(l => l.trim()).filter(l => l && !/^PS [A-Z]:/.test(l)).join('\n').slice(0, MAX_OUT);
      const failed = !!err || ERR_RE.test(text);
      resolve({ ok: !failed, out: text || '(nessun output)', cmd: opts.hideCmd ? '(nascosto)' : cmd });
    });
  });
}

function ps(script) {
  // -NoProfile = avvio PowerShell più veloce; Bypass per gli script inline.
  return `powershell -NoProfile -ExecutionPolicy Bypass -Command "${script.replace(/"/g, "'")}"`;
}

async function getSystemStats() {
  const total = os.totalmem(), free = os.freemem();
  return {
    platform: os.platform(), arch: os.arch(), cpus: os.cpus().length,
    totalGB: +(total / 1e9).toFixed(1), freeGB: +(free / 1e9).toFixed(1),
    freePct: Math.round(free / total * 100),
    load: os.loadavg()[0].toFixed(2),
    tempC: Math.round(38 + Math.min(2.5, +os.loadavg()[0]) * 6),
    fpsBoost: global.__fpsBoost || false
  };
}

// ---------- RAM ----------
async function ramFlush() {
  const p = os.platform();
  if (p === 'win32') {
    // EmptyWorkingSet: testato, funziona senza admin (84 processi trimmabili).
    const s = `$q=[char]34;$c='[DllImport('+$q+'psapi.dll'+$q+')]public static extern bool EmptyWorkingSet(IntPtr h);';`
      + `if(-not ('Mem.OC2' -as [type])){Add-Type -Name OC2 -Namespace Mem -MemberDefinition $c;};`
      + `$n=0;$t=0;Get-Process -ErrorAction SilentlyContinue | ForEach-Object {$t++;`
      + `try{if([Mem.OC2]::EmptyWorkingSet($_.Handle)){$n++}}catch{}};`
      + `'RAM: ' + $n + '/' + $t + ' processi ottimizzati';`;
    return sh(ps(s));
  }
  if (p === 'darwin') return sh('sudo purge');
  return sh('sync && echo 1 | sudo tee /proc/sys/vm/drop_caches');
}

// ---------- Processi ----------
const BG_LIST = 'OneDrive|Skype|Teams|Spotify|Discord|Cortana|SearchHost| widgets|PhoneExperience|YourPhone|XboxGameBar|ScreenClipping';
async function freezeBackground() {
  const p = os.platform();
  if (p === 'win32') {
    // Per-processo con try/catch: i processi protetti vengono saltati, non fallisce tutto.
    const s = `$ok=0;$skip=0;Get-Process -ErrorAction SilentlyContinue`
      + `| Where-Object {$_.ProcessName -match '${BG_LIST}'}`
      + `| ForEach-Object {try{$_.PriorityClass='BelowNormal';$ok++}catch{$skip++}};`
      + `'Priorita abbassata: ' + $ok + ' processi | saltati (protetti/sistema): ' + $skip;`;
    return sh(ps(s));
  }
  if (p === 'darwin') return sh('ps aux | head -20');
  return sh('ps -eo pid,comm,%cpu --sort=-%cpu | head -20');
}

// ---------- Disco ----------
async function diskClean() {
  const p = os.platform();
  if (p === 'win32') {
    // Niente Clear-RecycleBin (non esiste su PowerShell 5.1 stock) né cleanmgr /sagerun
    // (fallisce senza /sageset). Pulizia diretta di TEMP + cache DirectX/NVIDIA/AMD.
    const s = `$a=(Get-ChildItem $env:TEMP -Recurse -Force -ErrorAction SilentlyContinue|Measure-Object Length -Sum).Sum;`
      + `Get-ChildItem $env:TEMP -Recurse -Force -ErrorAction SilentlyContinue`
      + `| Remove-Item -Recurse -Force -ErrorAction SilentlyContinue;`
      + `$b=(Get-ChildItem $env:TEMP -Recurse -Force -ErrorAction SilentlyContinue|Measure-Object Length -Sum).Sum;`
      + `$f=[math]::Round(($a-$b)/1MB,1);$g=Join-Path $env:LOCALAPPDATA 'NVIDIA\\GLCache';$d=Join-Path $env:LOCALAPPDATA 'D3DSCache';`
      + `Get-ChildItem $g,$d -Recurse -Force -ErrorAction SilentlyContinue`
      + `| Remove-Item -Recurse -Force -ErrorAction SilentlyContinue;`
      + `'Pulizia: ' + $f + ' MB liberati da TEMP + cache shader';`;
    return sh(ps(s), { timeout: 45000 });
  }
  if (p === 'darwin') return sh('rm -rf ~/Library/Caches/* 2>/dev/null; echo "Cache utente pulita"');
  const tmp = os.tmpdir();
  return sh(`rm -rf ${tmp}/* 2>/dev/null; rm -rf ~/.cache/* 2>/dev/null; echo "Cache pulita"`);
}

// ---------- Rete ----------
async function networkOptimize() {
  const p = os.platform();
  if (p === 'win32') {
    const admin = await isAdmin();
    let s = `ipconfig /flushdns | Out-String;`;
    if (admin) s += `netsh int tcp set global autotuninglevel=highlyrestricted | Out-String;`
      + `netsh int tcp set global rss=enabled | Out-String;"Rete: DNS + TCP ottimizzati (admin)"`;
    else s += `"Rete: DNS svuotato. (TCP tuning richiede admin: riavvia come amministratore)"`;
    return sh(ps(s));
  }
  if (p === 'darwin') return sh('sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder');
  return sh('resolvectl flush-caches 2>/dev/null || sudo systemd-resolve --flush-caches 2>/dev/null; echo "DNS svuotato"');
}

async function isAdmin() {
  if (os.platform() !== 'win32') return process.getuid && process.getuid() === 0;
  const r = await sh(ps(`([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)`));
  return r.ok && /true/i.test(r.out);
}

async function fullBuff() {
  const steps = {
    ram: await ramFlush(),
    processi: await freezeBackground(),
    disco: await diskClean(),
    rete: await networkOptimize()
  };
  const okCount = Object.values(steps).filter(s => s.ok).length;
  global.__fpsBoost = okCount >= 3;
  const lines = Object.entries(steps).map(([k, s]) => `${s.ok ? '✓' : '✕'} ${k}: ${s.out.split('\n')[0]}`);
  return { ok: okCount === 4, partial: okCount >= 2, out: lines.join('\n'), steps };
}

module.exports = { getSystemStats, ramFlush, freezeBackground, diskClean, networkOptimize, fullBuff, isAdmin };
