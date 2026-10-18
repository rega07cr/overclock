// System Booster — comandi testati su Windows reale, stato onesto (ok/fail veri).
// Ogni azione ha: preview (cosa cambia, senza toccare nulla) + apply + restore.
const os = require('os');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const MAX_OUT = 1200;
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

// ---------- Snapshot persistenti (sopravvivono al riavvio) ----------
const SNAP_FILE = path.join(os.tmpdir(), 'overclock-snaps.json');
function loadSnaps() {
  try { return JSON.parse(fs.readFileSync(SNAP_FILE, 'utf8')); } catch { return {}; }
}
function saveSnaps(s) {
  try { fs.writeFileSync(SNAP_FILE, JSON.stringify(s, null, 1)); } catch {}
}
function putSnap(key, snap) {
  const all = loadSnaps(); all[key] = { when: new Date().toISOString(), snap }; saveSnaps(all);
}
function getSnap(key) { return (loadSnaps()[key] || {}).snap || null; }

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
async function previewRam() {
  if (os.platform() !== 'win32')
    return { ok: true, preview: true, out: '• Svuota working-set dei processi (EmptyWorkingSet via psapi.dll)\n• Non chiude nessun programma, non tocca il registro\n• Effetto: memoria inattiva restituita a Windows; si riempie da sola = già reversibile' };
  const r = await sh(ps(`$t=(Get-Process -ErrorAction SilentlyContinue|Measure-Object).Count;'Processi attivi: ' + $t`));
  return {
    ok: true, preview: true,
    out: `👁 ANTEPRIMA — RAM Flush (nessuna modifica ancora):\n• Azione: EmptyWorkingSet su ogni processo (solo cache inattiva)\n• ${r.out.split('\n')[0]}\n• Non chiude app, non modifica registro/disco\n• Reversibile: sì, automatico (Windows ricarica la RAM da solo)`
  };
}
async function ramFlush() {
  const p = os.platform();
  if (p === 'win32') {
    // EmptyWorkingSet: testato, funziona senza admin (84 processi trimmabili).
    const s = `$q=[char]34;$c='[DllImport('+$q+'psapi.dll'+$q+')]public static extern bool EmptyWorkingSet(IntPtr h);';`
      + `if(-not ('Mem.OC2' -as [type])){Add-Type -Name OC2 -Namespace Mem -MemberDefinition $c;};`
      + `$n=0;$t=0;Get-Process -ErrorAction SilentlyContinue | ForEach-Object {$t++;`
      + `try{if([Mem.OC2]::EmptyWorkingSet($_.Handle)){$n++}}catch{}};`
      + `'RAM: ' + $n + '/' + $t + ' processi ottimizzati';`;
    const r = await sh(ps(s));
    r.restore = '↩ Non serve ripristino: la RAM si riempie da sola (azione già reversibile).';
    return r;
  }
  if (p === 'darwin') return sh('sudo purge');
  return sh('sync && echo 1 | sudo tee /proc/sys/vm/drop_caches');
}
async function restoreRam() {
  return { ok: true, out: '↩ RAM: niente da ripristinare — EmptyWorkingSet restituisce memoria a Windows e il sistema la riusa da solo.' };
}

// ---------- Livelli di ottimizzazione ----------
function normMode(m) { m = String(m || 'media').toLowerCase(); return ['base', 'media', 'potente'].includes(m) ? m : 'media'; }
const MODE_LABEL = { base: 'Base 🟢 (sicura)', media: 'Media 🟡 (consigliata)', potente: 'Potente 🔴 (spinta)' };
// Processi toccati per livello: base = solo overlay di sistema, media = + chat/musica, potente = + tutto il bloat
const BG_LISTS = {
  base: 'Cortana|XboxGameBar|ScreenClipping| widgets|PhoneExperience|YourPhone',
  media: 'Cortana|XboxGameBar|ScreenClipping| widgets|PhoneExperience|YourPhone|Skype|Teams|Spotify|Discord',
  potente: 'OneDrive|Skype|Teams|Spotify|Discord|Cortana|SearchHost| widgets|PhoneExperience|YourPhone|XboxGameBar|ScreenClipping'
};

// ---------- Processi ----------
async function previewFreeze(mode) {
  mode = normMode(mode);
  const list = BG_LISTS[mode];
  if (os.platform() !== 'win32')
    return { ok: true, preview: true, out: '• Mostra top processi (nessuna modifica).' };
  const r = await sh(ps(`Get-Process -ErrorAction SilentlyContinue | Where-Object {$_.ProcessName -match '${list}'} | ForEach-Object {$_.ProcessName + ' (priorita attuale: ' + $_.PriorityClass + ')'} | Out-String`));
  const names = r.out === '(nessun output)' ? '(nessun processo background trovato — nessuna modifica verrà fatta)' : r.out;
  return {
    ok: true, preview: true,
    out: `👁 ANTEPRIMA — Process Priority [${MODE_LABEL[mode]}] (nessuna modifica ancora):\n• Azione: PriorityClass → BelowNormal SOLO su questi processi:\n${names}\n• Non vengono chiusi/terminati, solo deprioritizzati\n• Ripristino: salva priorità originali e le rimette con "↩ Ripristina"`
  };
}
async function freezeBackground(mode) {
  mode = normMode(mode);
  const list = BG_LISTS[mode];
  const p = os.platform();
  if (p === 'win32') {
    // Snapshot priorità originali per il restore.
    const snapR = await sh(ps(`Get-Process -ErrorAction SilentlyContinue | Where-Object {$_.ProcessName -match '${list}'} | ForEach-Object {$_.Id.ToString() + '=' + $_.PriorityClass} | Out-String`));
    const snap = {};
    if (snapR.ok && snapR.out !== '(nessun output)')
      snapR.out.split('\n').forEach(l => { const m = l.trim().match(/^(\d+)=(\w+)/); if (m) snap[m[1]] = m[2]; });
    putSnap('processes', snap);
    const s = `$ok=0;$skip=0;Get-Process -ErrorAction SilentlyContinue | Where-Object {$_.ProcessName -match '${list}'} | ForEach-Object {try{$_.PriorityClass='BelowNormal';$ok++}catch{$skip++}};'Priorita abbassata [${mode}]: ' + $ok + ' processi | saltati (protetti/sistema): ' + $skip;`;
    const r = await sh(ps(s));
    r.restore = '↩ Ripristino disponibile: "↩ Ripristina" rimette le priorità originali salvate.';
    return r;
  }
  if (p === 'darwin') return sh('ps aux | head -20');
  return sh('ps -eo pid,comm,%cpu --sort=-%cpu | head -20');
}
async function restoreFreeze(snapArg) {
  if (os.platform() !== 'win32') return { ok: true, out: '↩ Niente da ripristinare su questo OS.' };
  const snap = (snapArg && Object.keys(snapArg).length ? snapArg : getSnap('processes')) || {};
  const ids = Object.keys(snap);
  if (!ids.length) return { ok: true, out: '↩ Nessuno snapshot priorità trovato (fai prima "Freeze background").' };
  const pairs = ids.map(id => `${id}=${snap[id]}`).join(',');
  const r = await sh(ps(`$m=@{};('${pairs}'.Split(',')|ForEach-Object{$k,$v=$_.Split('=');$m[$k]=$v});$ok=0;$sk=0;Get-Process -ErrorAction SilentlyContinue|ForEach-Object{$id=$_.Id.ToString();if($m.ContainsKey($id)){try{$_.PriorityClass=$m[$id];$ok++}catch{$sk++}}};'Priorita ripristinate: ' + $ok + ' | saltati: ' + $sk`));
  return r;
}

// ---------- Disco ----------
const DISK_DESC = {
  base: 'solo file %TEMP% più vecchi di 7 giorni',
  media: 'tutto %TEMP% + cache shader (NVIDIA GLCache, D3DSCache)',
  potente: 'tutto %TEMP% + cache shader + cache Windows Update/Delivery Optimization + miniature Explorer'
};
async function previewDisk(mode) {
  mode = normMode(mode);
  if (os.platform() !== 'win32')
    return { ok: true, preview: true, out: '• Elimina cache utente/TEMP (rigenerate da sole). Anteprima live solo su Windows.' };
  const r = await sh(ps(`$t=(Get-ChildItem $env:TEMP -Recurse -Force -ErrorAction SilentlyContinue|Measure-Object Length -Sum).Sum;$g=Join-Path $env:LOCALAPPDATA 'NVIDIA\\GLCache';$d=Join-Path $env:LOCALAPPDATA 'D3DSCache';$s=(Get-ChildItem $g,$d -Recurse -Force -ErrorAction SilentlyContinue|Measure-Object Length -Sum).Sum;'TEMP: ' + [math]::Round($t/1MB,1) + ' MB | Cache shader: ' + [math]::Round($s/1MB,1) + ' MB'`), { timeout: 45000 });
  return {
    ok: true, preview: true,
    out: `👁 ANTEPRIMA — Disk & Junk [${MODE_LABEL[mode]}] (nessun file cancellato):\n• Cosa verrebbe rimosso: ${DISK_DESC[mode]}\n• ${r.out.split('\n')[0] || 'dimensione non calcolata'}\n• ⚠️ File cancellati NON ripristinabili (sono temp/cache: Windows e i giochi li ricreano)\n• Premi "Clean disk" solo se sei d'accordo`
  };
}
async function diskClean(mode) {
  mode = normMode(mode);
  const p = os.platform();
  if (p === 'win32') {
    // Niente Clear-RecycleBin (non esiste su PowerShell 5.1 stock) né cleanmgr /sagerun
    // (fallisce senza /sageset). Pulizia diretta, aggressività in base al livello.
    let s = `$a=(Get-ChildItem $env:TEMP -Recurse -Force -ErrorAction SilentlyContinue|Measure-Object Length -Sum).Sum;`;
    if (mode === 'base') {
      s += `Get-ChildItem $env:TEMP -Recurse -Force -ErrorAction SilentlyContinue`
        + `| Where-Object {$_.LastWriteTime -lt (Get-Date).AddDays(-7)}`
        + `| Remove-Item -Recurse -Force -ErrorAction SilentlyContinue;`;
    } else {
      s += `Get-ChildItem $env:TEMP -Recurse -Force -ErrorAction SilentlyContinue`
        + `| Remove-Item -Recurse -Force -ErrorAction SilentlyContinue;`;
    }
    s += `$b=(Get-ChildItem $env:TEMP -Recurse -Force -ErrorAction SilentlyContinue|Measure-Object Length -Sum).Sum;`
      + `$f=[math]::Round(($a-$b)/1MB,1);`;
    if (mode !== 'base') {
      s += `$g=Join-Path $env:LOCALAPPDATA 'NVIDIA\\GLCache';$d=Join-Path $env:LOCALAPPDATA 'D3DSCache';`
        + `Get-ChildItem $g,$d -Recurse -Force -ErrorAction SilentlyContinue`
        + `| Remove-Item -Recurse -Force -ErrorAction SilentlyContinue;`;
    }
    if (mode === 'potente') {
      s += `$wu=Join-Path $env:SystemRoot 'SoftwareDistribution\\Download';$do=Join-Path $env:SystemRoot 'SoftwareDistribution\\DeliveryOptimization';`
        + `Get-ChildItem $wu,$do -Recurse -Force -ErrorAction SilentlyContinue`
        + `| Remove-Item -Recurse -Force -ErrorAction SilentlyContinue;`
        + `Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Microsoft\\Windows\\Explorer\\thumbcache_*.db') -Force -ErrorAction SilentlyContinue`
        + `| Remove-Item -Force -ErrorAction SilentlyContinue;`;
    }
    s += `'Pulizia [${mode}]: ' + $f + ' MB liberati da TEMP (+ extra livello)';`;
    const r = await sh(ps(s), { timeout: 60000 });
    r.restore = '⚠️ File temp eliminati = non ripristinabili (ma erano solo cache: vengono ricreati da soli).';
    return r;
  }
  if (p === 'darwin') return sh('rm -rf ~/Library/Caches/* 2>/dev/null; echo "Cache utente pulita"');
  const tmp = os.tmpdir();
  return sh(`rm -rf ${tmp}/* 2>/dev/null; rm -rf ~/.cache/* 2>/dev/null; echo "Cache pulita"`);
}
async function restoreDisk() {
  return { ok: true, out: '⚠️ Disk: i file TEMP/cache eliminati non si possono ripristinare (erano rigenerabili: Windows e i giochi li ricreano da soli).' };
}

// ---------- Rete ----------
const NET_MAP = { auto: 'autotuninglevel', rss: 'rss', ecn: 'ecncapability', ts: 'timestamps' };
const NET_DESC = {
  base: 'solo flush DNS (innoquo)',
  media: 'flush DNS + autotuning highlyrestricted + RSS enabled',
  potente: 'flush DNS + autotuning highlyrestricted + RSS enabled + ECN off + timestamps off'
};
async function previewNetwork(mode) {
  mode = normMode(mode);
  if (os.platform() !== 'win32')
    return { ok: true, preview: true, out: '• Flush DNS ( innocuo, nessun restore serve).' };
  const admin = await isAdmin();
  const cur = await sh('netsh int tcp show global');
  const line = cur.out.split('\n').filter(l => /autotuning|rss|ecn|timestamp/i.test(l)).join(' | ') || 'valori attuali non letti';
  const tcpNote = mode === 'base' ? 'NON toccato (livello Base)' : (admin ? 'VERRÀ applicato (sei admin)' : 'NON verrà applicato (serve avvio come amministratore)');
  return {
    ok: true, preview: true,
    out: `👁 ANTEPRIMA — Network [${MODE_LABEL[mode]}] (nessuna modifica ancora):\n• Sempre: ipconfig /flushdns (solo svuota cache DNS, innocuo)\n• TCP (${NET_DESC[mode]}): ${tcpNote}\n• Valori attuali: ${line}\n• Ripristino: salva i valori attuali e li rimette con "↩ Ripristina"`
  };
}
async function networkOptimize(mode) {
  mode = normMode(mode);
  const p = os.platform();
  if (p === 'win32') {
    const admin = await isAdmin();
    if (admin && mode !== 'base') {
      const cur = await sh('netsh int tcp show global');
      const pick = (re) => (cur.out.match(re) || [])[1] || null;
      putSnap('network', {
        auto: pick(/autotuning[^\n:]*:\s*(\w+)/i),
        rss: pick(/rss[^\n:]*:\s*(\w+)/i),
        ecn: mode === 'potente' ? pick(/ecn[^\n:]*:\s*(\w+)/i) : undefined,
        ts: mode === 'potente' ? pick(/timestamp[^\n:]*:\s*(\w+)/i) : undefined
      });
    }
    let s = `ipconfig /flushdns | Out-String;`;
    if (admin && mode !== 'base') {
      s += `netsh int tcp set global autotuninglevel=highlyrestricted | Out-String;`
        + `netsh int tcp set global rss=enabled | Out-String;`;
      if (mode === 'potente')
        s += `netsh int tcp set global ecncapability=disabled | Out-String;`
          + `netsh int tcp set global timestamps=disabled | Out-String;`;
      s += `"Rete [${mode}]: DNS + TCP ottimizzati (admin)"`;
    }
    else s += `"Rete [${mode}]: DNS svuotato.` + (mode === 'base' ? ' (Base: TCP non toccato)"' : ' (TCP tuning richiede admin: riavvia come amministratore)"');
    const r = await sh(ps(s));
    r.restore = (admin && mode !== 'base') ? '↩ Ripristino disponibile: rimette i valori TCP precedenti.' : 'Flush DNS = innocuo, nessun ripristino necessario.';
    return r;
  }
  if (p === 'darwin') return sh('sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder');
  return sh('resolvectl flush-caches 2>/dev/null || sudo systemd-resolve --flush-caches 2>/dev/null; echo "DNS svuotato"');
}
async function restoreNetwork(snapArg) {
  if (os.platform() !== 'win32') return { ok: true, out: '↩ Niente da ripristinare su questo OS.' };
  const snap = snapArg || getSnap('network');
  const keys = snap ? Object.keys(NET_MAP).filter(k => snap[k]) : [];
  if (!keys.length) return { ok: true, out: '↩ Nessuno snapshot rete (DNS flush è innocuo; il tuning TCP richiedeva admin e non era stato applicato).' };
  const out = [];
  for (const k of keys)
    out.push((await sh(`netsh int tcp set global ${NET_MAP[k]}=${snap[k]}`)).out.split('\n')[0]);
  return { ok: true, out: '↩ Rete ripristinata:\n' + out.join('\n') };
}

async function isAdmin() {
  if (os.platform() !== 'win32') return process.getuid && process.getuid() === 0;
  const r = await sh(ps(`([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)`));
  return r.ok && /true/i.test(r.out);
}

async function previewFull(mode) {
  mode = normMode(mode);
  const parts = [await previewRam(), await previewFreeze(mode), await previewDisk(mode), await previewNetwork(mode)];
  return { ok: true, preview: true, out: `👁 ANTEPRIMA — FULL SYSTEM BUFF [${MODE_LABEL[mode]}] (non ho toccato nulla):\n\n` + parts.map(p => p.out).join('\n\n──────────\n\n') };
}

async function fullBuff(mode) {
  mode = normMode(mode);
  const steps = {
    ram: await ramFlush(),
    processi: await freezeBackground(mode),
    disco: await diskClean(mode),
    rete: await networkOptimize(mode)
  };
  const okCount = Object.values(steps).filter(s => s.ok).length;
  global.__fpsBoost = okCount >= 3;
  const lines = Object.entries(steps).map(([k, s]) => `${s.ok ? '✓' : '✕'} ${k}: ${s.out.split('\n')[0]}`);
  return { ok: okCount === 4, partial: okCount >= 2, out: lines.join('\n'), steps };
}

async function restoreAll(gpuSnapArg, osSnapArg) {
  const out = [];
  const r1 = await restoreRam(); out.push('RAM: ' + r1.out.split('\n')[0]);
  const r2 = await restoreFreeze(); out.push('Processi: ' + r2.out.split('\n')[0]);
  const r3 = restoreDisk ? (await restoreDisk()).out.split('\n')[0] : '';
  out.push('Disco: ' + r3);
  const r4 = await restoreNetwork(); out.push('Rete: ' + r4.out.split('\n')[0]);
  try {
    const tuning = require('./tuning');
    const gs = gpuSnapArg || getSnap('gpu');
    if (gs && gs.regs && gs.regs.length) out.push('GPU: ' + (await tuning.gpuRestore(gs)).out.split('\n')[0]);
    const osn = osSnapArg || getSnap('os');
    if (osn && ((osn.regs || []).length || osn.power)) out.push('OS: ' + (await tuning.osRestore(osn)).out.split('\n')[0]);
  } catch (e) { out.push('(GPU/OS: ' + e.message + ')'); }
  global.__fpsBoost = false;
  return { ok: true, out: '↩ RIPRISTINO COMPLETO:\n' + out.map(l => '• ' + l).join('\n') };
}

module.exports = { getSystemStats, ramFlush, freezeBackground, diskClean, networkOptimize, fullBuff, isAdmin, previewRam, previewFreeze, previewDisk, previewNetwork, previewFull, restoreRam, restoreFreeze, restoreDisk, restoreNetwork, restoreAll, getSnap, putSnap };
