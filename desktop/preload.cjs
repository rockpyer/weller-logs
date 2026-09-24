const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('weller', {
  desktop: true,
  openLAS: () => ipcRenderer.invoke('open-las'),
  readFiles: (paths, base) => ipcRenderer.invoke('read-files', paths, base),
  openProject: () => ipcRenderer.invoke('open-project'),
  readProject: p => ipcRenderer.invoke('read-project', p),
  saveProject: (text, current, suggested) => ipcRenderer.invoke('save-project', text, current, suggested),
  saveBytes: (name, bytes) => ipcRenderer.invoke('save-bytes', name, bytes),
  lastSession: () => ipcRenderer.invoke('last-session'),
  relativePath: (from, to) => ipcRenderer.invoke('relative-path', from, to),
  onMenu: cb => ipcRenderer.on('menu', (_e, cmd, arg) => cb(cmd, arg)),
});
