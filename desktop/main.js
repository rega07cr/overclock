const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { getSystemStats } = require('./modules/system-booster');
const { applyGameBoost, applyFpsMod, stopGameBoost } = require('./modules/game-boost');

let win = null;
function createWindow() {
  // Avvio veloce: finestra mostrata subito, niente attesa, niente animazioni di troppo.
  win = new BrowserWindow({
    width: 1240, height: 800, minWidth: 1024, minHeight: 680,
    title: 'OVERCLOCK DESKTOP ENGINE v1.0',
    backgroundColor: '#07070f',
    autoHideMenuBar: true,
    show: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.handle('sys:stats', async () => getSystemStats());
ipcMain.handle('sys:run', async (_e, action, mode) => {
  const booster = require('./modules/system-booster');
  const map = {
    'ram': () => booster.ramFlush(),
    'processes': () => booster.freezeBackground(mode),
    'disk': () => booster.diskClean(mode),
    'network': () => booster.networkOptimize(mode),
    'full': () => booster.fullBuff(mode),
    'ram-preview': () => booster.previewRam(),
    'processes-preview': () => booster.previewFreeze(mode),
    'disk-preview': () => booster.previewDisk(mode),
    'network-preview': () => booster.previewNetwork(mode),
    'full-preview': () => booster.previewFull(mode),
    'ram-restore': () => booster.restoreRam(),
    'processes-restore': () => booster.restoreFreeze(),
    'disk-restore': () => booster.restoreDisk(),
    'network-restore': () => booster.restoreNetwork(),
    'full-restore': () => booster.restoreAll()
  };
  if (!map[action]) throw new Error('unknown action');
  return map[action]();
});
ipcMain.handle('tuning:run', async (_e, action, arg) => {
  const tuning = require('./modules/tuning');
  const map = {
    'gpu-info': () => tuning.gpuInfo(),
    'gpu-boost': () => tuning.gpuBoost(typeof arg === 'string' ? arg : undefined),
    'gpu-restore': () => tuning.gpuRestore(arg),
    'gpu-panel': () => tuning.openVendorPanel((arg && arg.vendor) || 'nvidia'),
    'os-oc': () => tuning.osOverclock(typeof arg === 'string' ? arg : undefined),
    'os-restore': () => tuning.osRestore(arg),
    'gpu-preview': () => tuning.previewGpu(typeof arg === 'string' ? arg : undefined),
    'os-preview': () => tuning.previewOs(typeof arg === 'string' ? arg : undefined),
    'font-mode': () => tuning.setFontMode(typeof arg === 'string' ? arg : 'cleartype'),
    'appearance-restore': () => tuning.restoreAppearance(),
    'appearance-preview': () => tuning.previewAppearance(),
    'gpu-max': () => tuning.gpuMax(arg),
    'gpu-max-restore': () => tuning.gpuMaxRestore(arg),
    'gpumax-preview': () => tuning.previewGpuMax(arg),
    'startup-list': () => tuning.listStartup(),
    'startup-toggle': () => tuning.toggleStartup(arg.name, arg.enable),
    'is-admin': () => require('./modules/system-booster').isAdmin().then(v => ({ admin: v }))
  };
  if (!map[action]) throw new Error('unknown tuning action');
  return map[action]();
});
ipcMain.handle('game:boost', async (_e, gameId) => applyGameBoost(gameId));
ipcMain.handle('game:mod', async (_e, gameId) => applyFpsMod(gameId));
ipcMain.handle('game:stop', async (_e, gameId) => stopGameBoost(gameId));
ipcMain.handle('hw:profile', async () => require('./modules/hardware').hardwareProfile());
ipcMain.handle('game:estimate', async (_e, gameId) => {
  const h = require('./modules/hardware');
  return h.estimateFps(gameId, await h.hardwareProfile());
});
ipcMain.handle('shell:open', async (_e, url) => shell.openExternal(url));
