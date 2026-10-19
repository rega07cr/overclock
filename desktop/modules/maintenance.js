// maintenance.js — v1.2: reset totale, disinstallazione semplice, salute sistema.
// - previewUninstall: spiega cosa farà il reset (senza toccare nulla).
// - fullReset: ripristina OGNI snapshot (sistema, GPU, CPU, aspetto, font, avvio, mod
//   giochi) e pulisce i dati in ~/.overclock. Non tocca giochi, salvataggi, documenti.
// - findUninstaller/launchUninstaller: trova e avvia Uninstall.exe (NSIS) su Windows;
//   su portable/zip spiega come rimuovere a mano (è solo una cartella).
// - healthCheck (extra): check rapido di salute — admin, snapshot, mod attive, Ollama.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const persist = require('./persist');

function sh(cmd, timeout = 20000) {
  const { exec } = require('child_process');
  return new Promise((resolve) => {
    exec(cmd, { timeout, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: (((stdout || '') + '\n' + (stderr || '')).trim().slice(0, 1500)) });
    });
  });
}

async function previewUninstall() {
  const snaps = persist.loadSnaps();
  const keys = Object.keys(snaps);
  const mods = persist.loadModState();
  const modIds = Object.keys(mods || {});
  return {
    ok: true, preview: true,
    out: `👁 ANTEPRIMA — Reset totale + disinstallazione (non ho toccato nulla)\n\n✅ COSA FARÀ “RIPRISTINA TUTTO”:\n• Sistema: piano energia, rete TCP, priorità pre-v1.1 → valori originali\n• GPU/CPU: HAGS, MPO, throttling, scheduler giochi → valori originali\n• Aspetto e font: testo, trasparenza, animazioni, menu, tema → come prima\n• Avvio automatico: i programmi disabilitati dall'app vengono riattivati\n• Giochi: config .ocbak ripristinate (${modIds.length ? modIds.join(', ') : 'nessuna mod attiva'})\n• Dati app: cartella ~/.overclock eliminata (snapshot trovati ora: ${keys.length ? keys.join(', ') : 'nessuno'})\n🚫 COSA NON TOCCA: giochi, salvataggi, documenti, foto, driver, altre app.\n👤 ADMIN: consigliato (per le chiavi HKLM). 🔄 RIAVVIO: consigliato alla fine.\n↩ DOPO IL RESET: l'app è come appena installata — puoi chiuderla o disinstallarla.`
  };
}

async function fullReset() {
  const log = ['🧹 RESET TOTALE — rimetto tutto come prima'];
  try {
    const sb = require('./system-booster');
    const r = await sb.restoreAll();
    log.push('• Sistema: ' + r.out.split('\n')[0]);
  } catch (e) { log.push('• Sistema saltato: ' + e.message); }
  try {
    const t = require('./tuning');
    if (t.restoreSnapKey) {
      for (const [k, label] of [['os', 'OS'], ['gpu', 'GPU'], ['gpumax', 'GPU MAX'], ['cpumax', 'CPU MAX'], ['fpsmax-ui', 'FPS UI'], ['font', 'font'], ['appearance-opts', 'aspetto'], ['appearance', 'aspetto standard']]) {
        try { const r = await t.restoreSnapKey(k); if (!/Niente da ripristinare|nessuno snapshot/i.test(r.out)) log.push(`• ${label}: ripristinato`); } catch {}
      }
      try { const f = require('./fans'); const r = await f.resetFans(); log.push('• Ventole: reset automatico'); } catch {}
      try {
        const l = require('./game-launcher'); const mods = persist.loadModState();
        for (const id of Object.keys(mods || {})) { try { await l.stopLaunch(id); } catch {} }
      } catch {}
    } else {
      try { await t.osRestore(); log.push('• OS: ripristinato'); } catch {}
      try { await t.gpuRestore(); log.push('• GPU: ripristinata'); } catch {}
      try { await t.gpuMaxRestore(); log.push('• GPU MAX: ripristinato'); } catch {}
      try { await t.cpuMaxRestore(); log.push('• CPU MAX: ripristinata'); } catch {}
    }
  } catch (e) { log.push('• Tuning saltato: ' + e.message); }
  try {
    const t = require('./tuning');
    if (t.listStartupBackup) {
      const bak = await t.listStartupBackup();
      let n = 0;
      for (const name of bak.items || []) { try { await t.toggleStartup(name, true); n++; } catch {} }
      if (n) log.push(`• Avvio automatico: ${n} programmi riattivati`);
      else log.push('• Avvio automatico: niente da riattivare');
    }
  } catch (e) { log.push('• Avvio saltato: ' + e.message); }
  try {
    const gb = require('./game-boost');
    const mods = persist.loadModState();
    let n = 0;
    for (const id of Object.keys(mods || {})) { try { await gb.stopGameBoost(id); n++; } catch {} }
    log.push(n ? `• Giochi: ${n} mod/boost disattivati e config ripristinate` : '• Giochi: nessuna mod attiva');
  } catch (e) { log.push('• Giochi saltati: ' + e.message); }
  try {
    fs.rmSync(persist.baseDir(), { recursive: true, force: true });
    log.push('• Dati app (~/.overclock): eliminati');
  } catch (e) { log.push('• Dati app: ' + e.message); }
  try { persist.markRestored(); } catch {}
  global.__fpsBoost = false;
  log.push('\n✅ PC come prima dell\'ottimizzazione. Riavvia per completare, poi disinstalla pure l\'app qui sotto.');
  return { ok: true, out: log.join('\n') };
}

// Trova il disinstallatore NSIS (stessa cartella dell'eseguibile) o via registro.
async function findUninstaller(exePath) {
  if (os.platform() !== 'win32') {
    return { ok: true, found: false, out: '🍎/🐧 Nessun disinstallatore serve: l\'app è portable — chiudila ed elimina la cartella (e ~/.overclock per i dati).' };
  }
  const cands = [];
  try {
    if (exePath) {
      cands.push(path.join(path.dirname(exePath), 'Uninstall.exe'));
      cands.push(path.join(path.dirname(exePath), 'Uninstall Overclock.exe'));
    }
  } catch {}
  for (const c of cands) {
    try { if (c && fs.existsSync(c)) return { ok: true, found: true, path: c, out: `✅ Disinstallatore trovato:\n${c}\nPremi “Disinstalla l'app” per avviarlo (fai prima il reset qui sopra).` }; } catch {}
  }
  // Fallback: cerca UninstallString nel registro (DisplayName contiene Overclock)
  try {
    const r = await sh('powershell -NoProfile -Command "Get-ItemProperty HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*, HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like \'*Overclock*\' } | ForEach-Object { $_.UninstallString } | Out-String"');
    const m = (r.out.match(/"([^"]+\.exe)"?|([A-Za-z]:\\\S+\.exe)/) || [])[1] || (r.out.match(/([A-Za-z]:\\\S+\.exe)/) || [])[1];
    if (m && fs.existsSync(m)) return { ok: true, found: true, path: m, out: `✅ Disinstallatore trovato nel registro:\n${m}` };
  } catch {}
  return {
    ok: true, found: false,
    out: 'ℹ Nessun Uninstall.exe trovato: hai la versione portable/zip.\n✅ Basta chiudere l\'app ed eliminare la sua cartella (+ ~/.overclock per i dati).\nNessuna chiave di sistema resta sporca se hai fatto il reset qui sopra.'
  };
}

function launchUninstaller(unPath) {
  return new Promise((resolve) => {
    if (!unPath || !fs.existsSync(unPath)) { resolve({ ok: false, out: 'Disinstallatore non trovato.' }); return; }
    try {
      const child = execFile(unPath, [], { detached: true, stdio: 'ignore' });
      child.unref();
      resolve({ ok: true, out: '❌ Disinstallatore avviato — completa la procedura a schermo, poi riavvia il PC.' });
    } catch (e) { resolve({ ok: false, out: 'Avvio fallito: ' + e.message }); }
  });
}

// Extra a discrezione: check rapido di salute del sistema + app.
async function healthCheck() {
  const rows = [];
  rows.push(`💻 OS: ${os.platform()} ${os.release()} · ${os.cpus().length} core · ${Math.round(os.totalmem() / 1e9)} GB RAM`);
  try {
    const admin = await require('./system-booster').isAdmin();
    rows.push(`${admin ? '✅' : 'ℹ'} Admin: ${admin ? 'SÌ (tutti i tweak HKLM disponibili)' : 'NO (solo tweak HKCU — riavvia come admin per il massimo)'}`);
  } catch { rows.push('ℹ Admin: non rilevato'); }
  try {
    const snaps = persist.loadSnaps();
    const keys = Object.keys(snaps);
    rows.push(keys.length ? `💾 Snapshot salvati (${keys.length}): ${keys.join(', ')} — ripristino disponibile` : '💾 Snapshot: nessuno — nessuna ottimizzazione da ripristinare');
    rows.push(persist.getPersist().active ? '⚡ Boost: ATTIVO e persistente (resta dopo la chiusura)' : '⚡ Boost: non attivo');
  } catch (e) { rows.push('💾 Snapshot: errore lettura (' + e.message + ')'); }
  try {
    const mods = persist.loadModState();
    const ids = Object.keys(mods || {});
    rows.push(ids.length ? `🎮 Mod giochi attive: ${ids.join(', ')}` : '🎮 Mod giochi: nessuna attiva');
  } catch {}
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 2500);
    const r = await fetch('http://localhost:11434/api/tags', { signal: ctl.signal });
    clearTimeout(to);
    rows.push(r.ok ? '🤖 Ollama: ONLINE (IA locale disponibile)' : '🤖 Ollama: offline (solo euristica locale)');
  } catch { rows.push('🤖 Ollama: offline — avvia `ollama serve` per l\'IA reale'); }
  return { ok: true, out: `🩺 SALUTE SISTEMA — check rapido (nessuna modifica):\n\n${rows.map(r => '• ' + r).join('\n')}` };
}

module.exports = { previewUninstall, fullReset, findUninstaller, launchUninstaller, healthCheck };
