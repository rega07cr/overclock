const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('overclock', {
  stats: () => ipcRenderer.invoke('sys:stats'),
  runSys: (action, mode) => ipcRenderer.invoke('sys:run', action, mode),
  previewSys: (action, mode) => ipcRenderer.invoke('sys:run', action + '-preview', mode),
  restoreSys: (action) => ipcRenderer.invoke('sys:run', action + '-restore'),
  previewTune: (action, mode) => ipcRenderer.invoke('tuning:run', action + '-preview', mode),
  gameBoost: (id) => ipcRenderer.invoke('game:boost', id),
  gameStop: (id) => ipcRenderer.invoke('game:stop', id),
  tune: (action, arg) => ipcRenderer.invoke('tuning:run', action, arg),
  platform: process.platform
});
