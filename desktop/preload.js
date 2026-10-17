const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('overclock', {
  stats: () => ipcRenderer.invoke('sys:stats'),
  runSys: (action) => ipcRenderer.invoke('sys:run', action),
  gameBoost: (id) => ipcRenderer.invoke('game:boost', id),
  gameStop: (id) => ipcRenderer.invoke('game:stop', id),
  tune: (action, arg) => ipcRenderer.invoke('tuning:run', action, arg),
  platform: process.platform
});
