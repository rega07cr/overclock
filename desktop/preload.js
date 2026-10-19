const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('overclock', {
  stats: () => ipcRenderer.invoke('sys:stats'),
  runSys: (action, mode) => ipcRenderer.invoke('sys:run', action, mode),
  previewSys: (action, mode) => ipcRenderer.invoke('sys:run', action + '-preview', mode),
  restoreSys: (action) => ipcRenderer.invoke('sys:run', action + '-restore'),
  previewTune: (action, mode) => ipcRenderer.invoke('tuning:run', action + '-preview', mode),
  gameList: () => ipcRenderer.invoke('game:list'),
  gameBoost: (id) => ipcRenderer.invoke('game:boost', id),
  gameMod: (id) => ipcRenderer.invoke('game:mod', id),
  gameStop: (id) => ipcRenderer.invoke('game:stop', id),
  hwProfile: () => ipcRenderer.invoke('hw:profile'),
  gameEstimate: (id) => ipcRenderer.invoke('game:estimate', id),
  tune: (action, arg) => ipcRenderer.invoke('tuning:run', action, arg),
  platform: process.platform
});
