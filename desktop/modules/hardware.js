// hardware.js — rilevamento automatico componenti PC + stima FPS per gioco.
// Tutto read-only: nessun comando modifica il sistema.
const os = require('os');
const { exec } = require('child_process');
const PRESETS = require('./games-presets.json');

function sh(cmd, timeout = 25000) {
  return new Promise((resolve) => {
    exec(cmd, { timeout, windowsHide: true }, (err, stdout, stderr) => {
      resolve((((stdout || '') + '\n' + (stderr || '')).trim()));
    });
  });
}
function ps(script) {
  return `powershell -NoProfile -ExecutionPolicy Bypass -Command "${script.replace(/"/g, "'")}"`;
}

let cache = null;

async function hardwareProfile(force = false) {
  if (cache && !force) return cache;
  const p = os.platform();
  const hw = {
    platform: p, cpu: '', cores: 0, threads: 0,
    ramGB: 0, gpus: [], discrete: false, gpuLabel: '',
    os: '', admin: false
  };
  try {
    if (p === 'win32') {
      const out = await sh(ps(
        `$c=Get-CimInstance Win32_Processor | Select-Object -First 1 Name,NumberOfCores,NumberOfLogicalProcessors;` +
        `$m=(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory;` +
        `$g=Get-CimInstance Win32_VideoController | ForEach-Object {$_.Name};` +
        `$o=(Get-CimInstance Win32_OperatingSystem).Caption;` +
        `'CPU='+$c.Name+';CORES='+$c.NumberOfCores+';THREADS='+$c.NumberOfLogicalProcessors+';RAM='+$m+';GPU='+($g -join '|')+';OS='+$o`
      ));
      const get = (k) => out.split(';').map(s => s.trim()).filter(s => s.indexOf(k + '=') === 0).map(s => s.slice(k.length + 1).trim())[0] || '';
      hw.cpu = get('CPU').trim();
      hw.cores = parseInt(get('CORES'), 10) || 0;
      hw.threads = parseInt(get('THREADS'), 10) || 0;
      hw.ramGB = Math.round(((parseInt(get('RAM'), 10) || os.totalmem()) / 1e9) * 10) / 10;
      hw.gpus = get('GPU').split('|').map(s => s.trim()).filter(Boolean);
      hw.os = get('OS').trim();
      try {
        hw.admin = /true/i.test(await sh(ps(
          `([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)`
        ), 10000));
      } catch { /* non-admin o errore: resta false */ }
    } else if (p === 'darwin') {
      hw.cpu = (await sh('sysctl -n machdep.cpu.brand_string')).split('\n')[0];
      hw.cores = parseInt((await sh('sysctl -n hw.physicalcpu')), 10) || 0;
      hw.threads = parseInt((await sh('sysctl -n hw.logicalcpu')), 10) || 0;
      hw.ramGB = Math.round((parseInt((await sh('sysctl -n hw.memsize')), 10) || os.totalmem()) / 1e9 * 10) / 10;
      const sp = await sh('system_profiler SPDisplaysDataType | grep "Chipset Model" | head -4');
      hw.gpus = sp.split('\n').map(l => l.split(':')[1] || '').map(s => s.trim()).filter(Boolean);
      hw.os = (await sh('sw_vers -productName')).split('\n')[0] + ' ' + (await sh('sw_vers -productVersion')).split('\n')[0];
      hw.admin = process.getuid && process.getuid() === 0;
    } else {
      const cpuinfo = await sh('grep -m1 "model name" /proc/cpuinfo | cut -d: -f2');
      hw.cpu = cpuinfo.split('\n')[0].trim();
      hw.cores = parseInt((await sh('nproc')), 10) || 0;
      hw.threads = hw.cores;
      const mem = await sh('grep MemTotal /proc/meminfo | awk "{print $2}"');
      hw.ramGB = Math.round(((parseInt(mem, 10) * 1024) || os.totalmem()) / 1e9 * 10) / 10;
      const vga = await sh('lspci 2>/dev/null | grep -i "vga\\|3d\\|display" | head -4');
      hw.gpus = vga.split('\n').map(l => (l.split(': ')[1] || l).trim()).filter(Boolean);
      hw.os = (await sh('lsb_release -ds 2>/dev/null || cat /etc/os-release 2>/dev/null | grep -m1 PRETTY_NAME | cut -d= -f2')).split('\n')[0].replace(/"/g, '');
      hw.admin = process.getuid && process.getuid() === 0;
    }
  } catch { /* fallback sotto */ }
  if (!hw.cores) { hw.cores = os.cpus().length; hw.threads = hw.cores; }
  if (!hw.ramGB) hw.ramGB = Math.round(os.totalmem() / 1e9 * 10) / 10;
  if (!hw.cpu) { try { hw.cpu = (os.cpus()[0] || {}).model || ''; } catch {} }
  hw.discrete = hw.gpus.some(g =>
    /nvidia|geforce|rtx|gtx|quadro|tesla/i.test(g) ||
    /radeon\s*(rx|pro|vii)/i.test(g) || /\brx\s?[567]\d{2,3}\b/i.test(g) ||
    /intel\s*arc/i.test(g));
  hw.gpuLabel = hw.gpus[0] || 'GPU non rilevata';
  hw.tier = pcTier(hw).tier;
  cache = hw;
  return hw;
}

// Fascia PC: più è bassa, più il boost si sente (colli CPU/RAM da liberare).
function pcTier(hw) {
  let score = 0;
  const why = [];
  if (hw.cores >= 8) { score += 2; why.push(hw.cores + ' core fisici'); }
  else if (hw.cores >= 6) { score += 1; why.push(hw.cores + ' core fisici'); }
  else { score -= 1; why.push('solo ' + hw.cores + ' core → il boost CPU conta di più'); }
  if (hw.ramGB >= 32) { score += 2; why.push(hw.ramGB + ' GB RAM'); }
  else if (hw.ramGB >= 16) { score += 1; why.push(hw.ramGB + ' GB RAM'); }
  else { score -= 1; why.push('solo ' + hw.ramGB + ' GB RAM → liberare memoria conta molto'); }
  if (hw.discrete) { score += 2; why.push('GPU dedicata (' + shortGpu(hw.gpuLabel) + ')'); }
  else { score -= 1; why.push('grafica integrata → il gioco è CPU-bound, il boost aiuta di più'); }
  const tier = score >= 5 ? 'alta' : score >= 2 ? 'media' : 'bassa';
  return { tier, score, why };
}

function shortGpu(n) {
  const m = String(n).match(/(RTX|GTX|RX|Radeon|Arc|UHD|Iris|Vega)[^|,(]*/i);
  return (m ? m[0] : String(n)).trim().slice(0, 34);
}
function shortCpu(n) {
  return String(n).replace(/\(R\)|\(TM\)|@.*/g, '').replace(/\s+/g, ' ').trim().slice(0, 42);
}

// Generi CPU-bound (competitivi): il boost di priorità/affinity rende di più.
const CPU_BOUND = /shooter|battle royale|moba|hero|sportivo|sandbox|fps|tattico|co-op/i;
const GPU_HEAVY = /open-world|rpg|soulslike|survival|action/i;

// FPS MOD per gioco: patch reversibili dei file di configurazione (backup .ocbak).
// path: supporta %VAR% e wildcard * (SteamID, GUID). pairs: [[chiave, valore]].
const FPS_MODS = {
  fortnite: { format: 'ini', path: '%LOCALAPPDATA%/FortniteGame/Saved/Config/WindowsClient/GameUserSettings.ini', pairs: [['sg.ResolutionQuality', '70'], ['sg.ViewDistanceQuality', '1'], ['sg.ShadowQuality', '0'], ['sg.PostProcessQuality', '0'], ['sg.EffectsQuality', '1'], ['bUseVSync', 'False']], desc: 'Risoluzione 70% + ombre/post-produzione off + VSync off' },
  apex: { format: 'qkv', path: '%USERPROFILE%/Saved Games/Respawn/Apex/local/videoconfig.txt', pairs: [['setting.mat_antialias_mode', '0'], ['setting.mat_vsync_mode', '0'], ['setting.csm_enabled', '0']], desc: 'Anti-alias + VSync + ombre dinamiche off' },
  cs2: { format: 'qkv', path: ['%PROGRAMFILES%/Steam/userdata/*/730/local/cfg/cs2_video.txt', '%PROGRAMFILES(X86)%/Steam/userdata/*/730/local/cfg/cs2_video.txt'], pairs: [['setting.cpu_level', '1'], ['setting.gpu_level', '1'], ['setting.mat_antialias', '0'], ['setting.mat_vsync', '0']], desc: 'Dettagli CPU/GPU bassi + AA/VSync off' },
  valorant: { format: 'ini', path: '%LOCALAPPDATA%/VALORANT/Saved/Config/*/Windows/GameUserSettings.ini', pairs: [['sg.ResolutionQuality', '75'], ['sg.ShadowQuality', '0'], ['sg.PostProcessQuality', '0'], ['sg.AntiAliasingQuality', '0'], ['bUseVSync', 'False']], desc: 'Risoluzione 75% + ombre/AA/post off + VSync off' },
  minecraft: { format: 'colon', path: '%APPDATA%/.minecraft/options.txt', pairs: [['graphics', '0'], ['renderDistance', '8'], ['maxFps', '260'], ['particles', '1'], ['enableVsync', 'false']], desc: 'Grafica veloce + chunk 8 + FPS 260 + VSync off' },
  gta: { format: 'xml', path: '%USERPROFILE%/Documents/Rockstar Games/GTA V/settings.xml', pairs: [['ShadowQuality', '0'], ['ReflectionQuality', '0'], ['MSAA', '0']], desc: 'Ombre/riflessi/MSAA al minimo' },
  pubg: { format: 'ini', path: '%LOCALAPPDATA%/TslGame/Saved/Config/WindowsNoEditor/GameUserSettings.ini', pairs: [['sg.ResolutionQuality', '70'], ['sg.ShadowQuality', '0'], ['sg.PostProcessQuality', '0']], desc: 'Risoluzione 70% + ombre/post off' },
  dota2: { format: 'qkv', path: ['%PROGRAMFILES%/Steam/userdata/*/570/remote/cfg/video.txt', '%PROGRAMFILES(X86)%/Steam/userdata/*/570/remote/cfg/video.txt'], pairs: [['setting.cpu_level', '1'], ['setting.gpu_level', '1'], ['setting.mat_antialias', '0'], ['setting.mat_vsync', '0']], desc: 'Dettagli bassi + AA/VSync off' },
  tf2: { format: 'qkv', path: ['%PROGRAMFILES%/Steam/userdata/*/440/remote/cfg/video.txt', '%PROGRAMFILES(X86)%/Steam/userdata/*/440/remote/cfg/video.txt'], pairs: [['setting.cpu_level', '1'], ['setting.gpu_level', '1'], ['setting.mat_antialias', '0'], ['setting.mat_vsync', '0']], desc: 'Dettagli bassi + AA/VSync off (+ mastercomfig nei launch hint)' },
  destiny2: { format: 'xmlattr', path: '%APPDATA%/Bungie/DestinyPC/prefs/cvars.xml', pairs: [['framerate_cap_enabled', '1'], ['framerate_cap', '144'], ['low_latency_mode', '1']], desc: 'Cap 144 FPS + bassa latenza (Reflex)' },
  wukong: { format: 'ini', path: '%LOCALAPPDATA%/b1/Saved/Config/Windows/Engine.ini', section: '[SystemSettings]', pairs: [['r.ScreenPercentage', '75'], ['r.DefaultFeature.MotionBlur', '0']], desc: 'Risoluzione interna 75% + motion blur off' },
  'marvel-rivals': { format: 'ini', path: '%LOCALAPPDATA%/Marvel/Saved/Config/Windows/GameUserSettings.ini', pairs: [['sg.ResolutionQuality', '75'], ['sg.ShadowQuality', '0'], ['sg.PostProcessQuality', '0']], desc: 'Risoluzione 75% + ombre/post off' }
};

function estimateFps(gameId, hw) {
  const g = PRESETS.find(x => x.id === gameId);
  if (!g) throw new Error('Gioco non trovato: ' + gameId);
  hw = hw || {};
  const tier = hw.tier || pcTier(hw).tier;
  let base = tier === 'bassa' ? [25, 40] : tier === 'media' ? [12, 22] : [5, 12];
  let [min, max] = base;
  const genre = g.genre || '';
  if (CPU_BOUND.test(genre)) { min += 6; max += 6; }
  if (GPU_HEAVY.test(genre)) { min -= 2; max -= 2; }
  if (!hw.discrete && CPU_BOUND.test(genre)) { min += 4; max += 4; }
  if (hw.ramGB && hw.ramGB <= 8) { min += 2; max += 3; }
  min = Math.max(3, Math.round(min)); max = Math.max(min + 2, Math.round(max));
  if (max > 45) { max = 45; min = Math.min(min, 35); }

  const p = hw.platform || os.platform();
  const why = [];
  if (p === 'win32') {
    why.push('⬆ Priorità processo di gioco al massimo (HighPerformance)');
    if (g.affinityAllCores) why.push('🧠 Affinity su tutti i ' + (hw.cores || 'N') + ' core disponibili');
    why.push('🔕 Focus-Assist: niente notifiche mentre giochi');
  } else if (p === 'darwin') {
    why.push('🎮 Game Mode macOS richiesto per il processo di gioco');
    if (g.gptk) why.push('🍷 Game Porting Toolkit (WINEESYNC=1)');
  } else {
    if (g.proton) why.push('🍷 Proton verificato + DXVK_ASYNC=1');
    why.push('⚙ Gamemode + nice -10 sul processo di gioco');
  }
  why.push('💡 Avvio consigliato: ' + (g.launchHint[p] || g.launchHint.default));
  if (hw.ramGB && hw.ramGB <= 8) why.push('⚠ Con ' + hw.ramGB + ' GB RAM chiudi browser/Discord prima di giocare: vale più del boost stesso');
  if (!hw.discrete) why.push('ℹ Grafica integrata: abbassa risoluzione/effetti, il boost CPU fa il resto');

  const t = pcTier(hw);
  const mod = FPS_MODS[gameId] || null;
  const bonus = mod ? [8, 12] : [4, 8];
  const modLine = mod
    ? `🧪 FPS MOD disponibile (${mod.desc}): stima extra +${bonus[0]}–${bonus[1]}% oltre al boost base — file di config con backup, tutto ripristinabile.`
    : `🧪 FPS MOD CPU disponibile (priorità + core dedicati + app pesanti sospese): stima extra +${bonus[0]}–${bonus[1]}%.`; 
  return {
    ok: true, game: g.name, icon: g.icon || '🎮',
    min, max, tier, mod: !!mod, modLine,
    title: `📈 Boost stimato su questo PC: +${min}–${max}% FPS (fascia ${tier})`,
    note: 'Stima indicativa su colli CPU/RAM/sistema, non garantita: non tocca i settaggi grafici del gioco.',
    tierWhy: 'Il tuo PC è fascia ' + tier + ': ' + t.why.join(' · '),
    why
  };
}

module.exports = { hardwareProfile, pcTier, estimateFps, shortCpu, shortGpu, FPS_MODS };
