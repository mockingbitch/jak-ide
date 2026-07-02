const { contextBridge, ipcRenderer } = require('electron');

// Minimal, safe bridge. The IDE renderer doesn't need it; the prompt window does.
contextBridge.exposeInMainWorld('jakide', {
  platform: process.platform,
  isDesktop: true,
  // Native directory chooser for the in-app project switcher. Resolves to the
  // chosen absolute path, or null if cancelled.
  pickFolder: () => ipcRenderer.invoke('jakide:pick-folder'),
  // Hamburger-menu actions that replace the old native File/View menu.
  setApiKey: () => ipcRenderer.invoke('jakide:set-api-key'),
  toggleDevTools: () => ipcRenderer.invoke('jakide:toggle-devtools'),
  promptSubmit: (value) => ipcRenderer.send('jakide:prompt-submit', value),
  promptCancel: () => ipcRenderer.send('jakide:prompt-cancel'),
  // Custom titlebar window controls (the OS frame is disabled).
  winIsMaximized: () => ipcRenderer.invoke('jakide:win-is-maximized'),
  winMinimize: () => ipcRenderer.invoke('jakide:win-minimize'),
  winToggleMaximize: () => ipcRenderer.invoke('jakide:win-toggle-maximize'),
  winClose: () => ipcRenderer.invoke('jakide:win-close'),
  onWinStateChange: (cb) => {
    const listener = (_e, state) => cb(state);
    ipcRenderer.on('jakide:win-state', listener);
    return () => ipcRenderer.removeListener('jakide:win-state', listener);
  },
  // Secret encryption for saved DB/SSH connection passwords (Electron safeStorage).
  encryptSecret: (plain) => ipcRenderer.invoke('jakide:secret-encrypt', plain),
  decryptSecret: (encoded) => ipcRenderer.invoke('jakide:secret-decrypt', encoded),
});
