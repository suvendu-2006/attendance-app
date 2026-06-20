const { app, BrowserWindow, shell, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

const isDev = process.env.NODE_ENV !== 'production';
const BACKEND_PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 5001;
const FRONTEND_DEV_URL = 'http://localhost:5173';

let mainWindow = null;
let backendProcess = null;

function startBackend() {
  let backendPath;
  if (isDev) {
    backendPath = path.join(__dirname, '..', '..', '..', 'backend', 'server.js');
  } else {
    backendPath = path.join(process.resourcesPath, 'backend', 'server.js');
  }

  backendProcess = spawn('node', [backendPath], {
    cwd: path.dirname(backendPath),
    env: { ...process.env, NODE_ENV: isDev ? 'development' : 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  backendProcess.stdout.on('data', (d) => console.log(`[backend] ${d.toString().trim()}`));
  backendProcess.stderr.on('data', (d) => console.error(`[backend:err] ${d.toString().trim()}`));
  backendProcess.on('exit', (code) => { console.log(`[backend] exited with code ${code}`); backendProcess = null; });
  backendProcess.on('error', (err) => { console.error('[backend] Failed to start:', err); backendProcess = null; });
}

function waitForBackend(retries = 60, intervalMs = 500) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      const req = http.get(`http://localhost:${BACKEND_PORT}/api/health`, (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve();
        res.resume();
        retry();
      });
      req.on('error', retry);
      req.setTimeout(800, () => { req.destroy(); retry(); });

      function retry() {
        attempts++;
        if (attempts >= retries) {
          return reject(new Error('Backend did not become healthy in time'));
        }
        setTimeout(check, intervalMs);
      }
    };
    check();
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800, minWidth: 800, minHeight: 600,
    titleBarStyle: 'hiddenInset', backgroundColor: '#0f172a',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
    icon: path.join(__dirname, '..', 'public', 'pwa-192x192.png'), show: false,
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') shell.openExternal(url);
    } catch { console.warn('[electron] Blocked external URL:', url); }
    return { action: 'deny' };
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  if (isDev) {
    await mainWindow.loadURL(FRONTEND_DEV_URL);
    mainWindow.webContents.openDevTools();
  } else {
    await mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  console.log('[electron] Starting backend...');
  startBackend();

  console.log('[electron] Waiting for backend to be ready...');
  try {
    await waitForBackend();
  } catch (e) {
    console.error('[electron]', e.message);
    dialog.showErrorBox('Backend failed to start', 'The attendance backend did not become healthy. Check the logs and try again.');
    app.quit();
    return;
  }

  console.log('[electron] Opening window...');
  await createWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

app.on('before-quit', () => {
  if (backendProcess) {
    if (process.platform === 'win32') {
      require('child_process').exec('taskkill /pid ' + backendProcess.pid + ' /T /F');
    } else {
      backendProcess.kill('SIGTERM');
    }
  }
});
