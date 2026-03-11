const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bootstrap', {
  retry: () => ipcRenderer.invoke('bootstrap-retry'),
  openLogs: () => ipcRenderer.invoke('bootstrap-open-logs'),
  on: (event, cb) => {
    const wrapped = (_, ...args) => cb(...args);
    ipcRenderer.on(event, wrapped);
    return () => ipcRenderer.removeListener(event, wrapped);
  },
});
