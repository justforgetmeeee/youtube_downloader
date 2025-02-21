const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    downloadVideo: (url, format) => ipcRenderer.invoke('download-video', { url, format }),
    getHistory: () => ipcRenderer.invoke('get-history'),
    deleteHistoryItem: (url) => ipcRenderer.invoke('delete-history-item', url),
    openFolder: (path) => ipcRenderer.invoke('open-folder', path),
});