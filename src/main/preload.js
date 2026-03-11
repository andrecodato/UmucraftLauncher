const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  // Window controls
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),

  // Config
  loadConfig: () => ipcRenderer.invoke('load-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),

  // Launcher actions
  fetchManifest: () => ipcRenderer.invoke('fetch-manifest'),
  syncAndLaunch: (opts) => ipcRenderer.invoke('sync-and-launch', opts),

  // Utilities
  openFolder: (p) => ipcRenderer.invoke('open-folder', p),
  browseMinecraftDir: () => ipcRenderer.invoke('browse-minecraft-dir'),
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),

  // Events from main process
  on: (event, cb) => {
    const wrapped = (_, ...args) => cb(...args);
    ipcRenderer.on(event, wrapped);
    return () => ipcRenderer.removeListener(event, wrapped);
  },
  once: (event, cb) => {
    ipcRenderer.once(event, (_, ...args) => cb(...args));
  },
});
