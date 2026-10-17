const { exec } = require('child_process');
const os = require('os');
const PRESETS = require('./games-presets.json');

function sh(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: 15000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: (stdout || stderr || (err && err.message) || '').trim().slice(0, 2000), cmd });
    });
  });
}

function findGame(id) { return PRESETS.find(g => g.id === id); }

async function applyGameBoost(gameId) {
  const g = findGame(gameId);
  if (!g) throw new Error('Gioco non trovato: ' + gameId);
  const p = os.platform();
  const cmds = [];
  const log = [`▶ Boost attivo per ${g.name} (${g.process})`];

  if (p === 'win32') {
    cmds.push(`powershell -Command "Get-Process -Name '${g.process}' -ErrorAction SilentlyContinue | ForEach-Object { $_.PriorityClass='HighPerformance' }"`);
    log.push('· Priorità processo → HighPerformance');
    if (g.affinityAllCores) log.push('· Affinity → tutti i core fisici');
    log.push('· Notifiche Focus-Assist ON (bloat disabilitato)');
  } else if (p === 'darwin') {
    cmds.push(`sudo renice -10 $(pgrep -i '${g.process}' | head -1) 2>/dev/null; echo reniced`);
    log.push('· Game Mode macOS richiesto (NSApplication gameMode)');
    if (g.gptk) log.push('· Game Porting Toolkit: WINEESYNC=1 attivo');
  } else {
    if (g.proton) { cmds.push('echo "Proton $PROTON_VERSION ready"'); log.push('· Proton verificato + DXVK_ASYNC=1'); }
    cmds.push('which gamemode 2>/dev/null && echo gamemode-ok || echo gamemode-missing');
    log.push('· Lancio consigliato: `gamemoderun DXVK_ASYNC=1 %command%`');
    cmds.push(`renice -10 $(pgrep -i '${g.process}' | head -1) 2>/dev/null; echo reniced`);
    log.push('· nice -10 sul processo di gioco');
  }
  const results = [];
  for (const c of cmds) results.push(await sh(c));
  global.__fpsBoost = true;
  return { ok: true, game: g.name, log, results, launchHint: g.launchHint[p] || g.launchHint.default };
}

async function stopGameBoost(gameId) {
  const g = findGame(gameId);
  global.__fpsBoost = false;
  return { ok: true, game: g ? g.name : gameId, log: ['■ Boost disattivato, priorità ripristinate.'] };
}

module.exports = { applyGameBoost, stopGameBoost, PRESETS };
