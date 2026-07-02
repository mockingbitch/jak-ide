const { app, dialog } = require('electron');

const RELEASES_URL = 'https://github.com/mockingbitch/jakide/releases';

let autoUpdater = null;
let mainWindowRef = null;
let userInitiated = false;

// electron-updater's Linux support only knows how to update an AppImage (it
// downloads a fresh one and swaps it in on quit) — a .deb install is managed
// by the system package manager instead. `process.env.APPIMAGE` is the same
// env var electron-builder's own AppImage launcher sets, so it doubles as a
// reliable "are we actually running as one" check. Skip the feature entirely
// outside that case rather than let electron-updater throw trying to locate
// an AppImage that was never there.
function updatable() {
  return app.isPackaged && process.platform === 'linux' && !!process.env.APPIMAGE;
}

function getAutoUpdater() {
  if (autoUpdater) return autoUpdater;
  ({ autoUpdater } = require('electron-updater'));
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  wireEvents(autoUpdater);
  return autoUpdater;
}

function wireEvents(updater) {
  updater.on('error', (err) => {
    console.error('[updater]', (err && err.stack) || err);
    if (userInitiated) {
      userInitiated = false;
      dialog.showMessageBox(mainWindowRef, {
        type: 'error',
        message: 'Update check failed',
        detail: String((err && err.message) || err),
      });
    }
  });

  updater.on('update-available', (info) => {
    userInitiated = false;
    dialog
      .showMessageBox(mainWindowRef, {
        type: 'info',
        title: 'Update available',
        message: `JakIDE ${info.version} is available (you have ${app.getVersion()}).`,
        detail: 'Download it now? JakIDE will offer to restart once it’s ready to install.',
        buttons: ['Download', 'Later'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) updater.downloadUpdate();
      });
  });

  updater.on('update-not-available', () => {
    if (!userInitiated) return;
    userInitiated = false;
    dialog.showMessageBox(mainWindowRef, { message: `You're up to date (v${app.getVersion()}).` });
  });

  updater.on('download-progress', (p) => {
    try {
      mainWindowRef?.setProgressBar(p.percent / 100);
    } catch {
      /* progress bar unsupported on this desktop environment — non-fatal */
    }
  });

  updater.on('update-downloaded', (info) => {
    try {
      mainWindowRef?.setProgressBar(-1);
    } catch {
      /* ignore */
    }
    dialog
      .showMessageBox(mainWindowRef, {
        type: 'info',
        title: 'Update ready',
        message: `JakIDE ${info.version} has been downloaded.`,
        detail: 'Restart now to install it?',
        buttons: ['Restart now', 'Later'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) updater.quitAndInstall();
      });
  });
}

/** Silent background check on startup — only speaks up when something's actually new. */
function checkOnStartup(mainWindow) {
  mainWindowRef = mainWindow;
  if (!updatable()) return;
  userInitiated = false;
  getAutoUpdater()
    .checkForUpdates()
    .catch((e) => console.error('[updater] startup check failed', e));
}

/** User-initiated check (hamburger menu → "Check for Updates…") — always replies. */
function checkNow(mainWindow) {
  mainWindowRef = mainWindow;
  if (!updatable()) {
    dialog.showMessageBox(mainWindow, {
      message: 'Automatic updates are only available in the AppImage build.',
      detail: `Grab the latest release from ${RELEASES_URL}.`,
    });
    return;
  }
  userInitiated = true;
  getAutoUpdater()
    .checkForUpdates()
    .catch(() => {
      /* the 'error' listener above already reports this to the user */
    });
}

module.exports = { checkOnStartup, checkNow };
