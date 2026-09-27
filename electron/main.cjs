const { app, BrowserWindow, shell, dialog, Tray, Menu, ipcMain } = require('electron');
const { join, resolve, dirname } = require('node:path');
const { existsSync } = require('node:fs');
const { LocalService } = require('./service.cjs');
const { chromiumUserAgent, allowChallengeStorage } = require('./browser-policy.cjs');
const { validLocale, readLocale, saveLocale, labels } = require('./locale.cjs');
let language = 'en';
let theme = 'dark';
const titleBarColors = {
  dark: { color: '#111315', symbolColor: '#e2e4e7', height: 31 },
  light: { color: '#faf9f7', symbolColor: '#292d30', height: 31 },
};
app.userAgentFallback = chromiumUserAgent(app.userAgentFallback);
const devUrl = process.env.SAKUYA_DEV_URL;
const port = Number(process.env.SAKUYA_PORT || 8120);
const serviceUrl = `http://127.0.0.1:${port}`;
const target = devUrl === 'http://127.0.0.1:5173' ? devUrl : serviceUrl;
let win, tray, service, starting, quitting = false;
let keepForBrowser = process.argv.includes('--web');
if (process.env.SAKUYA_DESKTOP_DATA) app.setPath('userData', process.env.SAKUYA_DESKTOP_DATA);

const { safeExternal } = require('./external.cjs');
async function ensureService() {
  // The explicit development launcher owns its API/worker separately.
  if (devUrl === 'http://127.0.0.1:5173') return;
  if (starting) return starting;
  const root = app.isPackaged ? resolve(dirname(process.execPath), '../..') : resolve(__dirname, '..');
  // Continue using this workspace's data when launched from its build output.
  // A copied/distributed application uses the user's writable app-data folder.
  const legacy = existsSync(join(root, 'backend/app/main.py')) && existsSync(join(root, '.data/workspace.sqlite'));
  const dataDir = process.env.SAKUYA_DATA_DIR || (legacy ? join(root, '.data') : join(app.getPath('userData'), 'workspace'));
  service = new LocalService({ port, dataDir,
    command: app.isPackaged ? join(process.resourcesPath, 'backend/sakuya-service.exe') : join(root, '.venv/Scripts/python.exe'),
    args: app.isPackaged ? [] : [join(root, 'backend/service.py')],
    webDir: app.isPackaged ? join(process.resourcesPath, 'web') : join(root, 'dist'),
    envFile: legacy ? join(root, '.env') : join(dataDir, '.env'),
  });
  starting = service.start();
  return starting;
}
function openWindow() {
  if (win && !win.isDestroyed()) { win.show(); if (win.isMinimized()) win.restore(); win.focus(); return; }
  win = new BrowserWindow({ width: 1440, height: 960, minWidth: 840, minHeight: 620, backgroundColor: titleBarColors[theme].color, title: 'Sakuya', icon: join(__dirname, 'sakuya.ico'), titleBarStyle: 'hidden', titleBarOverlay: titleBarColors[theme], autoHideMenuBar: true, show: !process.env.SAKUYA_TEST,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), additionalArguments: [`--sakuya-language=${language}`], nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
  win.on('page-title-updated', event => { event.preventDefault(); win.setTitle('Sakuya'); });
  win.webContents.session.setUserAgent(app.userAgentFallback);
  win.webContents.setUserAgent(app.userAgentFallback);
  win.webContents.setWindowOpenHandler(({ url }) => { if (safeExternal(url, target)) void shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== target) { event.preventDefault(); if (safeExternal(url, target)) void shell.openExternal(url); } });
  win.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(allowChallengeStorage(permission, details.requestingUrl, contents.getURL(), target));
  });
  win.webContents.session.setPermissionCheckHandler((contents, permission, requestingOrigin) => {
    return allowChallengeStorage(permission, requestingOrigin, contents?.getURL() || '', target);
  });
  win.on('closed', () => { win = null; });
  // Give startup visible feedback while the bundled interpreter starts.
  void win.loadFile(join(__dirname, 'starting.html'));
  return win;
}
async function openBrowser() { keepForBrowser = true; await ensureService(); await shell.openExternal(serviceUrl); }
async function launch(web) {
  try {
    if (web) await openBrowser();
    else {
      const window = openWindow();
      await ensureService();
      if (window && !window.isDestroyed()) {
        // Each launch must fetch the current HTML, including when upgrading an existing profile.
        const url = new URL(target);
        url.searchParams.set('sakuya_launch', require('node:crypto').randomUUID());
        await window.loadURL(url.toString(), { extraHeaders: 'Cache-Control: no-cache\nPragma: no-cache\n' });
      }
    }
  } catch (error) {
    if (process.env.SAKUYA_TEST) console.error(error.message);
    else dialog.showErrorBox(labels[language].error, error.message);
    app.quit();
  }
}

function updateTray() {
  if (!tray) return;
  const text = labels[language];
  tray.setToolTip(text.tooltip);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: text.desktop, click: () => void launch(false) },
    { label: text.web, click: () => void launch(true) },
    { type: 'separator' }, { label: text.quit, click: () => app.quit() },
  ]));
}
ipcMain.on('sakuya:set-theme', (event, value, family = 'sakuya') => {
  if (!['sakuya', 'a', 'notion'].includes(family)) return;
  if ((value !== 'dark' && value !== 'light') || !win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) return;
  try { if (new URL(event.senderFrame.url).origin !== target) return; } catch { return; }
  theme = value;
  const palettes = { a: { dark: ['#262624', '#ece9e1'], light: ['#faf9f5', '#34332e'] }, notion: { dark: ['#191919', '#eeeeec'], light: ['#ffffff', '#37352f'] } };
  const pair = palettes[family]?.[theme];
  const colors = pair ? { color: pair[0], symbolColor: pair[1], height: 31 } : titleBarColors[theme];
  win.setTitleBarOverlay(colors);
  win.setBackgroundColor(colors.color);
});
ipcMain.on('sakuya:set-language', (event, value) => {
  if (!validLocale(value) || !win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) return;
  try { if (new URL(event.senderFrame.url).origin !== target) return; } catch { return; }
  language = value;
  saveLocale(app.getPath('userData'), language);
  updateTray();
});

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_event, args) => { void app.whenReady().then(() => launch(args.includes('--web'))); });
  app.whenReady().then(async () => {
    language = readLocale(app.getPath('userData'), app.getLocale());
    tray = new Tray(join(__dirname, 'sakuya.ico'));
    updateTray();
    tray.on('double-click', () => void launch(false));
    await launch(keepForBrowser);
  });
  app.on('window-all-closed', () => { if (!keepForBrowser) app.quit(); });
  app.on('before-quit', event => {
    if (quitting) return;
    event.preventDefault(); quitting = true;
    void (service?.stop() || Promise.resolve()).finally(() => { tray?.destroy(); app.quit(); });
  });
}
