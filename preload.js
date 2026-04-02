const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('snapmark', {
  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  // Capture
  captureRegion: () => ipcRenderer.invoke('capture-region'),
  captureFullscreen: () => ipcRenderer.invoke('capture-full'),

  // Selector
  closeSelector: () => ipcRenderer.invoke('close-selector'),

  // Image operations — from selector
  copyAndClose: (dataURL) => ipcRenderer.invoke('copy-and-close', dataURL),
  saveImage: (dataURL) => ipcRenderer.invoke('save-image', dataURL),
  quickSave: (dataURL) => ipcRenderer.invoke('quick-save', dataURL),
  copyClipboard: (dataURL) => ipcRenderer.invoke('copy-clipboard', dataURL),

  // Screenshots gallery
  getScreenshots: () => ipcRenderer.invoke('get-screenshots'),
  getScreenshotData: (filePath) => ipcRenderer.invoke('get-screenshot-data', filePath),
  deleteScreenshot: (filePath) => ipcRenderer.invoke('delete-screenshot', filePath),
  openScreenshotFolder: () => ipcRenderer.invoke('open-screenshot-folder'),
  copyScreenshotToClipboard: (filePath) => ipcRenderer.invoke('copy-screenshot-to-clipboard', filePath),
  saveScreenshotAs: (filePath) => ipcRenderer.invoke('save-screenshot-as', filePath),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  getScreenshotsDir: () => ipcRenderer.invoke('get-screenshots-dir'),

  // Events from main
  onInitSelector: (callback) => {
    ipcRenderer.on('init-selector', (_e, data) => callback(data));
  },
  onScreenshotsUpdated: (callback) => {
    ipcRenderer.on('screenshots-updated', () => callback());
  },
  onOpenSettings: (callback) => {
    ipcRenderer.on('open-settings', () => callback());
  },
});
