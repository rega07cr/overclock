// persist.js — snapshot e stato persistenti (sopravvivono a chiusura app e riavvio).
// Prima gli snapshot stavano in os.tmpdir() (pulizia automatica di Windows): ora in ~/.overclock
const fs = require('fs');
const os = require('os');
const path = require('path');

function baseDir() {
  const d = path.join(os.homedir(), '.overclock');
  try { fs.mkdirSync(d, { recursive: true }); } catch {}
  return d;
}
const SNAP_FILE = path.join(baseDir(), 'overclock-snaps.json');
const STATE_FILE = path.join(baseDir(), 'ocmod-state.json');
const PERSIST_FILE = path.join(baseDir(), 'persist.json');

function readJson(f, fb) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } }
function writeJson(f, o) { try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 1)); } catch {} }

// Migra i vecchi file tmpdir -> nuova home persistente (una tantum, senza perdere snapshot).
function migrateOnce() {
  try {
    const oldSnap = path.join(os.tmpdir(), 'overclock-snaps.json');
    const oldState = path.join(os.tmpdir(), 'ocmod-state.json');
    const cur = readJson(SNAP_FILE, null);
    if (!cur || !Object.keys(cur).length) {
      const old = readJson(oldSnap, null);
      if (old && Object.keys(old).length) writeJson(SNAP_FILE, old);
    }
    const curS = readJson(STATE_FILE, null);
    if (!curS || !Object.keys(curS).length) {
      const oldS = readJson(oldState, null);
      if (oldS && Object.keys(oldS).length) writeJson(STATE_FILE, oldS);
    }
  } catch {}
}
migrateOnce();

function loadSnaps() { return readJson(SNAP_FILE, {}); }
function saveSnaps(s) { writeJson(SNAP_FILE, s); }
function putSnap(key, snap) { const all = loadSnaps(); all[key] = { when: new Date().toISOString(), snap }; saveSnaps(all); }
function getSnap(key) { return (loadSnaps()[key] || {}).snap || null; }

function loadModState() { return readJson(STATE_FILE, {}); }
function saveModState(s) { writeJson(STATE_FILE, s); }

function getPersist() { return readJson(PERSIST_FILE, { active: false }); }
function setPersist(p) { const cur = getPersist(); writeJson(PERSIST_FILE, { ...cur, ...p, updated: new Date().toISOString() }); }

function markActive(label) { setPersist({ active: true, lastBoost: label || 'boost' }); global.__fpsBoost = true; }
function markRestored() { setPersist({ active: false }); global.__fpsBoost = false; }
function reapplyFlag() {
  // L'ottimizzazione registro è già persistente di suo; qui ripristiniamo solo il flag
  // così lo [Status] resta ON anche dopo aver chiuso e riaperto l'app.
  const p = getPersist();
  global.__fpsBoost = !!p.active;
  return p;
}

module.exports = { baseDir, SNAP_FILE, STATE_FILE, PERSIST_FILE, loadSnaps, saveSnaps, putSnap, getSnap, loadModState, saveModState, getPersist, setPersist, markActive, markRestored, reapplyFlag };
