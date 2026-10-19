// game-launcher.js — v1.3: LANCIA GIOCO OTTIMIZZATO.
// Idea: ogni avvio parte DALL'APP. Prima del lancio applichiamo le mod temporanee
// (FPS MOD = config patch con backup .ocbak + priorità High + affinity), poi avviamo
// il gioco (Steam via rungameid o .exe diretto con argomenti FPS), agganciamo il
// processo vero e quando chiudi il gioco RIPRISTINIAMO tutto da soli.
// Niente resta sporco: chiudi il gioco = PC come prima. Rilancia dall'app = di nuovo boostato.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { exec, spawn } = require('child_process');
const PRESETS = require('./games-presets.json');
const { FPS_MODS } = require('./hardware');

function sh(cmd, timeout = 25000) {
  return new Promise((resolve) => {
    exec(cmd, { timeout, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: (((stdout || '') + '\n' + (stderr || '')).trim().slice(0, 2000)) });
    });
  });
}
function ps(script) {
  return `powershell -NoProfile -ExecutionPolicy Bypass -Command "${script.replace(/"/g, "'")}"`;
}
function findGame(id) { return PRESETS.find(g => g.id === id); }

// Steam AppID dei giochi presenti nei preset (per avvio via steam://rungameid/).
const STEAM_IDS = {
  cs2: 730, dota2: 570, tf2: 440, apex: 1172470, pubg: 578080, gta: 271590,
  rdr2: 1174180, eldenring: 1245620, wukong: 2358720, bg3: 1086940,
  cyberpunk: 1091500, witcher3: 292030, rust: 252490, starfield: 1716740,
  helldivers2: 553850, 'marvel-rivals': 2767030, 'mh-wilds': 2246340,
  destiny2: 1085660, overwatch2: 2357570, r6siege: 359550, 'rocket-league': 252950,
  'lost-ark': 1599340, eso: 306130, ffxiv: 39210, poe: 238960
};
// Argomenti FPS sicuri per-gioco (solo flag ufficiali di avvio, niente hack).
const LAUNCH_ARGS = {
  cs2: ['-high', '-novid', '+fps_max', '400'],
  dota2: ['-high', '-map', 'dota', '+fps_max', '240'],
  tf2: ['-high', '-novid', '+fps_max', '243'],
  apex: ['+fps_max', '190'],
  fortnite: ['-USEALLAVAILABLECORES'],
  overwatch2: ['--tank_WorkerThreadCount', String(Math.max(4, (os.cpus() || []).length || 8))],
  warzone: ['-high'],
  r6siege: ['-high']
};

function stateFile() {
  try { return path.join(require('./persist').baseDir(), 'launch-state.json'); }
  catch { return path.join(os.homedir(), '.overclock', 'launch-state.json'); }
}
function loadState() {
  try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch { return {}; }
}
function saveState(s) {
  try { fs.mkdirSync(path.dirname(stateFile()), { recursive: true }); fs.writeFileSync(stateFile(), JSON.stringify(s, null, 1)); } catch {}
}

// Risolve come avviare il gioco: steam:// URL oppure percorso .exe reale.
async function resolveTarget(gameId) {
  const g = findGame(gameId);
  if (!g) throw new Error('Gioco non trovato: ' + gameId);
  const steamId = STEAM_IDS[gameId];
  if (os.platform() !== 'win32') {
    return steamId
      ? { method: 'steam-url', url: `steam://rungameid/${steamId}`, detail: 'Apertura via client Steam (stesso boost priorità dopo l\u2019avvio).' }
      : { method: 'manual', detail: `Avvia ${g.name} a mano, poi premi BOOST nella sezione 🎮 (su questo OS il lancio diretto non è supportato).` };
  }
  // Windows: 1) processo già in esecuzione? → riuso percorso reale.
  const r = await sh(ps(`(Get-Process -Name '${g.process}' -ErrorAction SilentlyContinue | Select-Object -First 1).Path`));
  const running = (r.ok ? r.out.split('\n')[0] : '').trim();
  if (/\.exe$/i.test(running)) return { method: 'exe', exe: running, alreadyRunning: true, detail: 'Gioco già aperto: lo aggancio e lo boosto senza rilanciarlo.' };
  // 2) Steam installato? → rungameid (il client sa dov'è il gioco).
  if (steamId) {
    const st = await sh(ps(`Get-ItemProperty 'HKCU:\\Software\\Valve\\Steam' -Name SteamExe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty SteamExe`));
    const steamExe = (st.ok ? st.out.split('\n')[0] : '').trim();
    if (steamExe || st.ok) return { method: 'steam-url', url: `steam://rungameid/${steamId}`, detail: 'Avvio via client Steam con argomenti FPS.' };
  }
  // 3) Cerca l'.exe nei percorsi tipici (Steam library, Epic, Riot, cartelle gioco).
  const guesses = [];
  const pf = [process.env['PROGRAMFILES'] || 'C:\\Program Files', process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)'];
  for (const base of pf) {
    guesses.push(`${base}\\Steam\\steamapps\\common`, `${base}\\Epic Games`, `${base}\\Riot Games`);
  }
  guesses.push('C:\\Games', path.join(os.homedir(), 'AppData', 'Local'));
  const found = await sh(ps(
    `$dirs=@(${guesses.map(d => `'${d}'`).join(',')});` +
    `$f=$null; foreach ($d in $dirs) { if (-not $d) { continue };` +
    ` $r=Get-ChildItem $d -Recurse -Filter '${g.process}.exe' -ErrorAction SilentlyContinue | Select-Object -First 1;` +
    ` if ($r) { $f=$r.FullName; break } }; if ($f) { $f } else { 'NOT-FOUND' }`
  ));
  const exe = (found.ok ? found.out.split('\n')[0] : '').trim();
  if (exe && exe !== 'NOT-FOUND' && /\.exe$/i.test(exe)) return { method: 'exe', exe, detail: 'Trovato sul disco, lo avvio con argomenti FPS.' };
  return {
    method: 'manual',
    detail: `${g.name} non trovato in automatico. Apri il gioco a mano (o incolla il percorso .exe la prossima volta), poi premi LANCIA: applichiamo comunque mod temporanee + boost al processo.`
  };
}

async function previewLaunch(gameId) {
  const g = findGame(gameId);
  if (!g) throw new Error('Gioco non trovato: ' + gameId);
  const t = await resolveTarget(gameId);
  const mod = FPS_MODS[gameId];
  const args = LAUNCH_ARGS[gameId] || [];
  return {
    ok: true, preview: true,
    out: `👁 ANTEPRIMA — 🚀 LANCIA ${g.name} OTTIMIZZATO (non ho toccato nulla)\n\n` +
      `✅ COSA FARÀ “LANCIA GIOCO”:\n` +
      `• 1) Mod temporanee PRIMA dell'avvio: ${mod ? mod.desc + ' (backup .ocbak automatico)' : 'priorità + core dedicati (nessun file noto per questo gioco)'}\n` +
      `• 2) Avvio: ${t.method === 'steam-url' ? 'via client Steam (' + t.url + ')' : t.method === 'exe' ? t.exe + (t.alreadyRunning ? ' (già aperto → solo boost)' : '') : 'manuale (lo avvii tu)'}\n` +
      (args.length ? `• 3) Argomenti FPS: ${args.join(' ')}\n` : '') +
      `• 4) Dopo l'avvio: priorità High + affinity su tutti i core al processo vero\n` +
      `• 5) Quando CHIUDI il gioco: ripristino AUTOMATICO (config originale + priorità normale) — tieni l'app aperta\n` +
      `🚫 COSA NON TOCCA: salvataggi, altre app, driver. Ogni avvio va fatto DA QUI, altrimenti niente mod temporanee.\n` +
      `↩ COME ANNULLARE: chiudi il gioco (auto) oppure “■ Stop / Ripristina” qui sotto.`
  };
}

async function boostPids(gameId) {
  // Aggancia TUTTI i processi del gioco e li spinge: priorità High + tutti i core.
  const g = findGame(gameId);
  const r = await sh(ps(
    `$n=(Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors;$m=[long]0;` +
    `for($i=0;$i -lt $n;$i++){$m=$m -bor ([long]1 -shl $i)};` +
    `$ids=@();Get-Process -Name '${g.process}' -ErrorAction SilentlyContinue | ForEach-Object {` +
    `try{$_.PriorityClass='High';$_.ProcessorAffinity=[IntPtr]$m;$ids+=$_.Id}catch{}};` +
    `'PIDS:'+($ids -join ',')`
  ));
  const m = r.out.match(/PIDS:([\d,]*)/);
  return m && m[1] ? m[1].split(',').filter(Boolean).map(Number) : [];
}

let watcher = null;
function startWatcher() {
  if (watcher || os.platform() !== 'win32') return;
  watcher = setInterval(async () => {
    const st = loadState();
    const ids = Object.keys(st);
    if (!ids.length) return;
    const gb = require('./game-boost');
    for (const id of ids) {
      try {
        const g = findGame(id);
        if (!g) { delete st[id]; continue; }
        const r = await sh(ps(`Get-Process -Name '${g.process}' -ErrorAction SilentlyContinue | Measure-Object | Select-Object -ExpandProperty Count`));
        if (/^\s*0\s*$/.test(r.out)) {
          try { await gb.stopGameBoost(id); } catch {}
          delete st[id];
        }
      } catch {}
    }
    saveState(st);
  }, 15000);
  if (watcher.unref) watcher.unref();
}

async function launchGame(gameId) {
  const g = findGame(gameId);
  if (!g) throw new Error('Gioco non trovato: ' + gameId);
  const log = [`🚀 LANCIO OTTIMIZZATO — ${(g.icon || '🎮')} ${g.name}`];
  const gb = require('./game-boost');
  // 1) Mod temporanee PRIMA dell'avvio (config patch + priorità template).
  try {
    const mod = await gb.applyFpsMod(gameId);
    log.push(...mod.log.map(l => `• (temp) ${l}`));
  } catch (e) { log.push(`• (temp) FPS MOD saltata: ${e.message}`); }
  const t = await resolveTarget(gameId);
  const args = LAUNCH_ARGS[gameId] || [];
  // 2) Avvio.
  if (t.method === 'steam-url' && !t.alreadyRunning) {
    if (os.platform() === 'win32') await sh(`start "" "${t.url}"`);
    else { const { shell } = require('electron'); shell.openExternal(t.url); }
    log.push(`• Avvio via Steam (${t.url})${args.length ? ' — imposta gli argomenti una volta nel client: ' + args.join(' ') : ''}`);
    log.push('  ⏳ Attendo ~25s che il gioco parta, poi aggancio il processo…');
    await new Promise(r => setTimeout(r, 25000));
  } else if (t.method === 'exe' && !t.alreadyRunning) {
    log.push(`• Avvio ${t.exe}${args.length ? ' con ' + args.join(' ') : ''}`);
    try {
      const child = spawn(t.exe, args, { detached: true, stdio: 'ignore', cwd: path.dirname(t.exe) });
      child.unref();
      log.push('  ⏳ Attendo ~20s che il gioco parta, poi aggancio il processo…');
      await new Promise(r => setTimeout(r, 20000));
    } catch (e) { log.push('  ✕ Avvio fallito: ' + e.message + ' — avvia il gioco a mano, il boost sotto lo aggancia comunque.'); }
  } else {
    log.push(`• ${t.detail}`);
  }
  // 3) Aggancio processo vero (anche se l'hai avviato tu a mano).
  let pids = [];
  if (os.platform() === 'win32') {
    pids = await boostPids(gameId);
    if (pids.length) log.push(`✓ Processo agganciato: priorità High + tutti i core (${pids.length} processi)`);
    else log.push('ℹ Processo non ancora visibile: premi di nuovo LANCIA dopo che il gioco è aperto (le mod temporanee restano armate).');
  } else {
    try { await gb.applyGameBoost(gameId); log.push('✓ Boost OS applicato (priorità/nice via game-boost).'); } catch (e) { log.push('ℹ Boost OS: ' + e.message); }
  }
  const st = loadState();
  st[gameId] = { pids, at: Date.now(), method: t.method };
  saveState(st);
  startWatcher();
  try { require('./persist').markActive('launch:' + gameId); } catch {}
  log.push('👀 Tieni l\u2019app aperta: quando chiudi il gioco ripristino TUTTO da solo (config + priorità).');
  log.push('↩ “■ Stop / Ripristina” annulla subito le mod temporanee.');
  return { ok: true, game: g.name, log, pids };
}

async function stopLaunch(gameId) {
  const gb = require('./game-boost');
  const r = await gb.stopGameBoost(gameId);
  const st = loadState();
  delete st[gameId];
  saveState(st);
  return { ok: true, game: findGame(gameId) ? findGame(gameId).name : gameId, log: ['■ Lancio ottimizzato chiuso: ' + (findGame(gameId) || {}).name, ...r.log] };
}

module.exports = { launchGame, previewLaunch, stopLaunch, resolveTarget, STEAM_IDS, LAUNCH_ARGS };
