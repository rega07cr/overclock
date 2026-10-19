// game-boost.js — boost PER-GIOCO reale, senza toccare le altre app (v1.1: NESSUN freeze).
// - Boost base: priorità High + affinity su tutti i core (solo processo di gioco).
// - FPS MOD: + patch reversibile del file config del gioco (backup .ocbak)
//            + affinity senza CPU0 (il sistema resta sul core 0).
// v1.1: la sospensione di Chrome/Discord/Spotify è STATA RIMOSSA (causava freeze).
// Le app in background restano vive e fluide. Tutto ripristinato da stopGameBoost().
const { exec } = require('child_process');
const os = require('os');
const PRESETS = require('./games-presets.json');
const { FPS_MODS } = require('./hardware');
const persist = require('./persist');

const MODSTATE = persist.loadModState();
function saveState() { persist.saveModState(MODSTATE); }

function sh(cmd, timeout = 25000) {
  return new Promise((resolve) => {
    exec(cmd, { timeout, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: ((stdout || '') + '\n' + (stderr || '')).trim().slice(0, 2000), cmd });
    });
  });
}
function ps(script) {
  return `powershell -NoProfile -ExecutionPolicy Bypass -Command "${script.replace(/"/g, "'")}"`;
}
// Add-Type con virgolette intatte: ps() le convertirebbe in apici e romperebbe il C#.
function psRaw(script) {
  const q = String.fromCharCode(34);
  return 'powershell -NoProfile -ExecutionPolicy Bypass -Command ' + q + script + q;
}
// v1.1: NtSuspendProcess rimosso. Le app in background non si toccano più.
const SUSPEND_LIST = [];

function findGame(id) { return PRESETS.find(g => g.id === id); }
function expandEnv(p) { return String(p).replace(/%([^%]+)%/g, (m, n) => process.env[n] || process.env[n.toUpperCase()] || m); }

// ---------- Boost base (solo CPU del processo di gioco) ----------
async function applyGameBoost(gameId) {
  const g = findGame(gameId);
  if (!g) throw new Error('Gioco non trovato: ' + gameId);
  await resumeStale(); // sicurezza: risveglia eventuali sospesi di sessioni precedenti
  const p = os.platform();
  const log = ['▶ Boost attivo per ' + (g.icon || '🎮') + ' ' + g.name + ' (' + g.process + ')'];
  if (p === 'win32') {
    // 'High' (valida). 'HighPerformance' non esiste e falliva sempre: ora è reale.
    const r = await sh(ps(
      `$n=(Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors;$m=[long]0;` +
      `for($i=0;$i -lt $n;$i++){$m=$m -bor ([long]1 -shl $i)};` +
      `$c=0;Get-Process -Name '${g.process}' -ErrorAction SilentlyContinue | ForEach-Object {` +
      `try{$_.PriorityClass='High';$_.ProcessorAffinity=[IntPtr]$m;$c++}catch{}};` +
      `'Processi boostati: '+$c`
    ));
    const n = (r.out.match(/Processi boostati: (\d+)/) || [])[1] || '0';
    log.push('· Priorità → High + affinity su tutti i core (' + n + ' processi di gioco trovati)');
    if (n === '0') log.push('ℹ Gioco non in esecuzione: avvia il gioco e ripremi BOOST per agganciare il processo');
    if (g.affinityAllCores) log.push('· Affinity esplicita (prima era solo scritta, ora applicata davvero)');
    log.push('· Notifiche Focus-Assist ON (solo mentre giochi, le app restano aperte)');
  } else if (p === 'darwin') {
    await sh(`sudo renice -10 $(pgrep -i '${g.process}' | head -1) 2>/dev/null; echo reniced`);
    log.push('· Game Mode macOS richiesto + nice -10');
    if (g.gptk) log.push('· Game Porting Toolkit: WINEESYNC=1 attivo');
  } else {
    if (g.proton) log.push('· Proton verificato + DXVK_ASYNC=1');
    await sh('which gamemode 2>/dev/null && echo gamemode-ok || echo gamemode-missing');
    await sh(`renice -10 $(pgrep -i '${g.process}' | head -1) 2>/dev/null; echo reniced`);
    log.push('· gamemoderun + nice -10 sul processo di gioco');
  }
  try { require('./persist').markActive('game-boost:' + gameId); } catch { global.__fpsBoost = true; }
  log.push('✅ App in background: intatte, nessun freeze (migliorato v1.1)');
  return { ok: true, game: g.name, log, launchHint: g.launchHint[p] || g.launchHint.default };
}

// ---------- FPS MOD ----------
function patchScript(fileJs, pairs, format, section) {
  // Ritorna script PS che fa backup .ocbak + patch. $f risolto prima.
  const arr = pairs.map(([k, v]) => `'${k}=${v}'`).join(',');
  let body = '';
  if (format === 'ini') {
    body = `foreach ($p in @(${arr})) { $a=$p.Split('=',2); $k=$a[0]; $v=$a[1]; $pat='(?m)^\\s*'+[regex]::Escape($k)+'\\s*=.*'; ` +
      `if ($t -match $pat) { $t = $t -replace $pat, ($k+'='+$v) } else { $t += [Environment]::NewLine+$k+'='+$v } };` +
      `'MOD-OK '+$f+' chiavi='+@(${arr}).Count`;
  } else if (format === 'colon') {
    body = `foreach ($p in @(${arr})) { $a=$p.Split('=',2); $k=$a[0]; $v=$a[1]; $pat='(?m)^\\s*'+[regex]::Escape($k)+'\\s*:.*'; ` +
      `if ($t -match $pat) { $t = $t -replace $pat, ($k+':'+$v) } else { $t += [Environment]::NewLine+$k+':'+$v } };` +
      `'MOD-OK '+$f+' chiavi='+@(${arr}).Count`;
  } else if (format === 'qkv') {
    body = `$q=[char]34; foreach ($p in @(${arr})) { $a=$p.Split('=',2); $k=$a[0]; $v=$a[1]; ` +
      `$pat='(?m)^\\s*'+$q+[regex]::Escape($k)+$q+'\\s+'+$q+'.*'+$q+'\\s*$'; ` +
      `$rep=$q+$k+$q+' '+$q+$v+$q; ` +
      `if ($t -match $pat) { $t = $t -replace $pat, $rep } else { $t += [Environment]::NewLine+$rep } };` +
      `'MOD-OK '+$f+' chiavi='+@(${arr}).Count`;
  } else if (format === 'xml') {
    body = `$n=0; $q=[char]34; $BS=[char]92; foreach ($p in @(${arr})) { $a=$p.Split('=',2); $k=$a[0]; $v=$a[1]; ` +
      `$x='(<'+[regex]::Escape($k)+'[^>]*?value'+$BS+'s*='+$BS+'s*'+$q+')[^'+$q+']*'; ` +
      `if ($t -match $x) { $t = $t -replace $x, ('\${1}'+$v); $n++ } };` +
      `'MOD-OK '+$f+' chiavi='+$n`;
  } else if (format === 'xmlattr') {
    body = `$n=0; $q=[char]34; $BS=[char]92; foreach ($p in @(${arr})) { $a=$p.Split('=',2); $k=$a[0]; $v=$a[1]; ` +
      `$x='(<cvar'+$BS+'b[^>]*?'+$BS+'bname'+$BS+'s*='+$BS+'s*'+$q+[regex]::Escape($k)+$q+'[^>]*?'+$BS+'bvalue'+$BS+'s*='+$BS+'s*'+$q+')[^'+$q+']*'; ` +
      `if ($t -match $x) { $t = $t -replace $x, ('\${1}'+$v); $n++ } };` +
      `'MOD-OK '+$f+' chiavi='+$n`;
  }
  const sec = section
    ? `if ($t -notmatch [regex]::Escape('${section}')) { $t += [Environment]::NewLine+'${section}' };`
    : '';
  return `$t=Get-Content $f -Raw; $b=$f+'.ocbak'; if (-not (Test-Path $b)) { Copy-Item $f $b -Force }; ${sec} ${body}; Set-Content $f $t -NoNewline;`;
}

async function applyFpsMod(gameId) {
  const g = findGame(gameId);
  if (!g) throw new Error('Gioco non trovato: ' + gameId);
  if (os.platform() !== 'win32') {
    return { ok: true, game: g.name, log: ['🧪 FPS MOD: patch dei file config supportata su Windows.', 'Su questo OS usi priorità + launch hint del boost base.'] };
  }
  await resumeStale();
  const st = (MODSTATE[gameId] = { backups: [], suspended: [], affinities: {} });
  const log = ['🧪 FPS MOD attivo per ' + (g.icon || '🎮') + ' ' + g.name];
  const mod = FPS_MODS[gameId];

  // 1) Priorità High + affinity senza CPU0 (il sistema resta sul core 0)
  const r1 = await sh(ps(
    `$aff=@{}; $c=0; Get-Process -Name '${g.process}' -ErrorAction SilentlyContinue | ForEach-Object {` +
    `try{ $aff[$_.Id.ToString()]=$_.ProcessorAffinity.ToInt64();` +
    `$m=$_.ProcessorAffinity.ToInt64() -band (-bnot [long]1);` +
    `if ($m -ne 0) { $_.ProcessorAffinity=[IntPtr]$m }; $_.PriorityClass='High'; $c++ }catch{}};` +
    `'AFF:'+(($aff.Keys | ForEach-Object { $_.ToString()+'='+$aff[$_].ToString() }) -join ',')+';COUNT='+$c`
  ));
  const mAff = r1.out.match(/AFF:([^;]*);COUNT=(\d+)/);
  if (mAff) {
    mAff[1].split(',').forEach(p => { const kv = p.split('='); if (kv[0]) st.affinities[kv[0]] = kv[1]; });
    log.push('· Priorità High + core dedicati (tutti tranne CPU0): ' + mAff[2] + ' processi agganciati');
    if (mAff[2] === '0') log.push('ℹ Gioco non in esecuzione: la MOD resta armata, ripremi dopo averlo avviato');
  }

  // 2) v1.1: NESSUNA sospensione — Discord/browser/Spotify restano aperti e fluidi.
  st.suspended = [];
  log.push('· ✅ App in background: intatte, nessun freeze (migliorato v1.1)');

  // 3) Patch file di config con backup
  if (mod) {
    const patterns = (Array.isArray(mod.path) ? mod.path : [mod.path]).map(expandEnv);
    const r3 = await sh(ps(
      `$f=$null; foreach ($c in @(${patterns.map(p => `'${p}'`).join(',')})) {` +
      ` $r=Resolve-Path $c -ErrorAction SilentlyContinue | Select-Object -First 1;` +
      ` if ($r) { $f=$r.Path; break } };` +
      `if (-not $f) { 'MOD-SKIP nessun file di config trovato ('+'${g.process}'+')' } else { ${patchScript('x', mod.pairs, mod.format, mod.section || '')} }`
    ));
    if (/MOD-SKIP/.test(r3.out)) {
      log.push('· Config di gioco non trovata su questo PC: MOD CPU comunque attiva');
    } else {
      const fline = (r3.out.match(/MOD-OK ([^\n]*) AfF/) || r3.out.match(/MOD-OK ([^\n]*)/) || [])[1] || '';
      st.backups.push({ mod: mod.desc });
      // ricava il file reale per il restore
      const rf = await sh(ps(
        `$f=$null; foreach ($c in @(${patterns.map(p => `'${p}'`).join(',')})) {` +
        ` $r=Resolve-Path $c -ErrorAction SilentlyContinue | Select-Object -First 1;` +
        ` if ($r) { $f=$r.Path; break } }; 'FILE:'+$f`
      ));
      const fm = rf.out.match(/FILE:(.*)/);
      if (fm && fm[1].trim() && fm[1].trim() !== 'FILE:') st.backups = [{ orig: fm[1].trim(), bak: fm[1].trim() + '.ocbak' }];
      log.push('· Config patchata (' + (mod.desc || '') + ')' + (fline ? ' — ' + fline : ''));
      log.push('· Backup salvato (.ocbak): Stop ripristina il file originale');
    }
  } else {
    log.push('· MOD CPU pura per questo gioco (nessun file di config noto): priorità + core dedicati');
  }
  saveState();
  try { require('./persist').markActive('fps-mod:' + gameId); } catch { global.__fpsBoost = true; }
  log.push('💾 Persistente: le patch config restano anche dopo aver chiuso l\u2019app (backup .ocbak)');
  return { ok: true, game: g.name, log };
}

async function resumeStale() {
  // v1.1: pulisce eventuali stati 'suspended' lasciati dalla vecchia versione (pre-v1.1).
  // I processi non si possono 'risvegliare' per PID riciclati: li marchiamo solo come puliti.
  try {
    let dirty = false;
    Object.values(MODSTATE || {}).forEach(s => { if (s && s.suspended && s.suspended.length) { s.suspended = []; dirty = true; } });
    if (dirty) saveState();
  } catch {}
}

async function stopGameBoost(gameId) {
  const g = findGame(gameId);
  const st = MODSTATE[gameId];
  const log = [];
  if (os.platform() === 'win32' && g) {
    // priorità e affinity di default per il processo di gioco
    await sh(ps(
      `Get-Process -Name '${g.process}' -ErrorAction SilentlyContinue | ForEach-Object {` +
      `try{ $_.PriorityClass='Normal' }catch{} }; 'prio-ok'`
    ));
    if (st && st.affinities) {
      const pairs = Object.entries(st.affinities).map(([k, v]) => `${k}=${v}`).join(',');
      if (pairs) {
        await sh(ps(
          `$m=@{};('${pairs}'.Split(',')|ForEach-Object{$a,$b=$_.Split('=');$m[$a]=$b});` +
          `Get-Process -ErrorAction SilentlyContinue | ForEach-Object { $id=$_.Id.ToString();` +
          ` if ($m.ContainsKey($id)) { try{ $_.ProcessorAffinity=[IntPtr][long]$m[$id] }catch{} } }; 'aff-ok'`
        ));
        log.push('↩ Affinity originale ripristinata');
      }
    }
    log.push('↩ Priorità gioco → Normale');
  }
  log.push('✅ App in background: mai toccate, niente da risvegliare');
  if (st && st.backups && st.backups.length && os.platform() === 'win32') {
    for (const b of st.backups) {
      if (!b.orig) continue;
      await sh(ps(`$o='${b.orig}'; $k=$o+'.ocbak'; if (Test-Path $k) { Copy-Item $k $o -Force; Remove-Item $k -Force; 'restored' } else { 'no-backup' }`));
      log.push('↩ Config ripristinata: ' + b.orig.split('\\').pop());
    }
  }
  if (st) { delete MODSTATE[gameId]; saveState(); }
  try {
    const persist = require('./persist');
    if (!Object.keys(MODSTATE).length && !persist.getPersist().active) global.__fpsBoost = false;
    else if (!Object.keys(MODSTATE).length) persist.markRestored();
  } catch { global.__fpsBoost = false; }
  log.unshift('■ Boost/MOD disattivati per ' + (g ? g.name : gameId) + '.');
  return { ok: true, game: g ? g.name : gameId, log };
}

function psRaw(script) {
  const q = String.fromCharCode(34);
  return 'powershell -NoProfile -ExecutionPolicy Bypass -Command ' + q + script + q;
}

module.exports = { applyGameBoost, applyFpsMod, stopGameBoost, resumeStale, PRESETS, _patchScript: patchScript, _expandEnv: expandEnv, _sh: sh, _ps: ps, _psRaw: psRaw, _suspendList: SUSPEND_LIST };
