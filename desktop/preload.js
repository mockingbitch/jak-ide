const { contextBridge, ipcRenderer } = require('electron');

// Minimal, safe bridge. The IDE renderer doesn't need it; the prompt window does.
contextBridge.exposeInMainWorld('jakide', {
  platform: process.platform,
  isDesktop: true,
  // Native directory chooser for the in-app project switcher. Resolves to the
  // chosen absolute path, or null if cancelled.
  pickFolder: () => ipcRenderer.invoke('jakide:pick-folder'),
  promptSubmit: (value) => ipcRenderer.send('jakide:prompt-submit', value),
  promptCancel: () => ipcRenderer.send('jakide:prompt-cancel'),
});
