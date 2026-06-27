const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const DEV_URL = process.env.JAKIDE_DEV_URL || '';
const isDev = Boolean(DEV_URL);

let mainWindow = null;
let serverPort = null;

// ---------------------------------------------------------------------------
// Local config (project folder, API key, model) stored in the app's userData.
// ---------------------------------------------------------------------------
function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}
function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    return {};
  }
}
function writeConfig(patch) {
  const cfg = { ...readConfig(), ...patch };
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
  return cfg;
}
function defaultProjectRoot() {
  const dir = path.join(app.getPath('home'), 'JakIDE');
  try {
    fs.mkdirSync(dir, { recursive: true });
    const readme = path.join(dir, 'README.md');
    if (!fs.existsSync(readme)) {
      fs.writeFileSync(readme, '# JakIDE workspace\n\nUse File → Open Project Folder… to point JakIDE at any folder.\n');
    }
  } catch {
    /* ignore */
  }
  return dir;
}

// ---------------------------------------------------------------------------
// Embedded backend (packaged mode). In dev the backend runs separately (tsx).
// ---------------------------------------------------------------------------
async function startEmbeddedBackend() {
  const cfg = readConfig();
  process.env.PROJECT_ROOT = cfg.projectRoot || defaultProjectRoot();
  if (cfg.apiKey) process.env.ANTHROPIC_API_KEY = cfg.apiKey;
  if (cfg.model) process.env.ANTHROPIC_MODEL = cfg.model;
  process.env.PORT = '0';

  // Required lazily so the env vars above are in place before config.ts reads them.
  const { startServer } = require(path.join(__dirname, 'app', 'server.cjs'));
  const { port } = await startServer({ port: 0, staticDir: path.join(__dirname, 'app', 'renderer') });
  return port;
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    title: 'JakIDE',
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    await mainWindow.loadURL(DEV_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    try {
      serverPort = await startEmbeddedBackend();
      await mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);
    } catch (e) {
      dialog.showErrorBox('JakIDE failed to start', String((e && e.stack) || e));
      app.quit();
    }
  }
}

// ---------------------------------------------------------------------------
// Application menu
// ---------------------------------------------------------------------------
function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Open Project Folder…', accelerator: 'CmdOrCtrl+O', click: openFolder },
        { label: 'Set Anthropic API Key…', click: setApiKey },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [{ label: 'About / Project folder…', click: showInfo }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function openFolder() {
  if (isDev) {
    await dialog.showMessageBox(mainWindow, {
      message: 'In dev mode the project folder comes from backend/.env (PROJECT_ROOT). Open Project Folder applies to the packaged app.',
    });
    return;
  }
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (res.canceled || !res.filePaths[0]) return;
  writeConfig({ projectRoot: res.filePaths[0] });
  relaunch();
}

async function setApiKey() {
  const current = readConfig().apiKey || '';
  const value = await promptText({
    title: 'Anthropic API Key',
    label: "Enter ANTHROPIC_API_KEY (stored locally in this app's config):",
    value: current,
    password: true,
  });
  if (value == null) return;
  writeConfig({ apiKey: value.trim() });
  if (isDev) {
    await dialog.showMessageBox(mainWindow, {
      message: 'Saved for the packaged app. In dev mode the backend reads the key from backend/.env instead.',
    });
  } else {
    relaunch();
  }
}

function showInfo() {
  const cfg = readConfig();
  dialog.showMessageBox(mainWindow, {
    message: 'JakIDE',
    detail:
      `Mode: ${isDev ? 'development' : 'packaged'}\n` +
      `Project folder: ${cfg.projectRoot || defaultProjectRoot()}\n` +
      `Config file: ${configPath()}`,
  });
}

function relaunch() {
  app.relaunch();
  app.exit(0);
}

// A minimal modal text prompt (Electron has no built-in input dialog).
function promptText({ title, label, value = '', password = false }) {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 480,
      height: 210,
      parent: mainWindow,
      modal: true,
      show: false,
      title: title || 'Input',
      resizable: false,
      minimizable: false,
      maximizable: false,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
    });
    const params = new URLSearchParams({
      title: title || '',
      label: label || '',
      value,
      password: password ? '1' : '',
    });
    win.loadFile(path.join(__dirname, 'prompt.html'), { search: params.toString() });
    win.once('ready-to-show', () => win.show());

    let done = false;
    const onSubmit = (_e, v) => finish(typeof v === 'string' ? v : null);
    const onCancel = () => finish(null);
    function finish(v) {
      if (done) return;
      done = true;
      ipcMain.removeListener('jakide:prompt-submit', onSubmit);
      ipcMain.removeListener('jakide:prompt-cancel', onCancel);
      if (!win.isDestroyed()) win.close();
      resolve(v);
    }
    ipcMain.on('jakide:prompt-submit', onSubmit);
    ipcMain.on('jakide:prompt-cancel', onCancel);
    win.on('closed', () => finish(null));
  });
}

// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  buildMenu();
  createWindow();
});

// Native folder picker for the in-app project switcher. The renderer then calls
// POST /api/projects/open to switch live; we also persist the choice so the next
// cold start opens the same folder.
ipcMain.handle('jakide:pick-folder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (res.canceled || !res.filePaths[0]) return null;
  try {
    writeConfig({ projectRoot: res.filePaths[0] });
  } catch {
    /* ignore */
  }
  return res.filePaths[0];
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
