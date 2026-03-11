const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  // Window controls
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),

  // Startup
  startupCheck: () => ipcRenderer.invoke('startup-check'),

  // Config
  loadConfig: () => ipcRenderer.invoke('load-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),

  // Launcher actions
  fetchManifest: () => ipcRenderer.invoke('fetch-manifest'),
  syncAndLaunch: (opts) => ipcRenderer.invoke('sync-and-launch', opts),

  // Server ping
  pingServer: (opts) => ipcRenderer.invoke('ping-server', opts),

  // Utilities
  openFolder: (p) => ipcRenderer.invoke('open-folder', p),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
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
