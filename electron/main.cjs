/**
 * THETA172 — Electron Main Process (Production-Hardened)
 * Frameless window, COEP/COOP headers for SharedArrayBuffer,
 * native window controls via IPC, local Python execution, crash recovery.
 */

const { app, BrowserWindow, ipcMain, session, shell, Menu, dialog } = require('electron');
const { execFile, spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const isDev = process.env.NODE_ENV === 'development';

// Enable SharedArrayBuffer (required for Pyodide Atomics)
app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer');

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

let mainWindow = null;
let pythonPath = null;
let pythonProcess = null;
let tmpFile = null;

function createWindow() {
  // Set COEP/COOP headers before any request
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Cross-Origin-Opener-Policy':   ['same-origin'],
        'Cross-Origin-Embedder-Policy': ['require-corp'],
      },
    });
  });

  const isMac = process.platform === 'darwin';

  mainWindow = new BrowserWindow({
    width:           1280,
    height:          820,
    minWidth:        800,
    minHeight:       540,
    frame:           isMac,  // macOS uses native traffic-light controls
    titleBarStyle:   isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: isMac ? { x: 14, y: 14 } : undefined,
    backgroundColor: '#EAEAE8',
    show:            false,
    icon:            path.join(__dirname, '../public/favicon.svg'),
    webPreferences: {
      preload:             path.join(__dirname, 'preload.cjs'),
      contextIsolation:    true,
      nodeIntegration:     false,
      sandbox:             false,
      webSecurity:         true,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on('maximize',   () => mainWindow.webContents.send('window-maximized', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window-maximized', false));
  mainWindow.on('enter-full-screen', () => mainWindow.webContents.send('window-maximized', true));
  mainWindow.on('leave-full-screen', () => mainWindow.webContents.send('window-maximized', false));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('Renderer crashed:', details.reason);
    if (details.reason !== 'clean-exit') {
      dialog.showErrorBox('THETA. crashed', 'The app encountered an error and needs to reload.');
      mainWindow.reload();
    }
  });

  mainWindow.on('unresponsive', () => {
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      title: 'THETA. is not responding',
      message: 'The application is not responding. Would you like to wait or reload?',
      buttons: ['Wait', 'Reload'],
      defaultId: 0,
    });
    if (choice === 1) mainWindow.reload();
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── IPC: Window Controls ────────────────────────────────────────
ipcMain.on('window-minimize',  () => mainWindow?.minimize());
ipcMain.on('window-maximize',  () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window-close',     () => mainWindow?.close());
ipcMain.handle('window-is-maximized', () => mainWindow?.isMaximized() ?? false);

// ── IPC: Local Python ───────────────────────────────────────────

// Detect Python installation
ipcMain.handle('python-detect', async () => {
  const candidates = process.platform === 'win32'
    ? ['python', 'python3', 'py']
    : ['python3', 'python'];

  for (const cmd of candidates) {
    try {
      const result = await new Promise((resolve, reject) => {
        execFile(cmd, ['--version'], { timeout: 5000 }, (err, stdout, stderr) => {
          if (err) return reject(err);
          resolve((stdout || stderr).trim());
        });
      });
      pythonPath = cmd;
      return { found: true, path: cmd, version: result };
    } catch (_) {
      continue;
    }
  }
  return { found: false };
});

// Run Python code via local interpreter
ipcMain.on('python-run', (event, code) => {
  if (!pythonPath) {
    event.sender.send('python-stderr', 'Python not found on system.\n');
    event.sender.send('python-done', 1);
    return;
  }

  // Kill any existing process
  if (pythonProcess) {
    pythonProcess.kill('SIGTERM');
    pythonProcess = null;
  }

  // Write code to temp file (avoids shell escaping issues)
  tmpFile = path.join(os.tmpdir(), `theta_run_${Date.now()}.py`);
  fs.writeFileSync(tmpFile, code, 'utf8');

  pythonProcess = spawn(pythonPath, ['-u', tmpFile], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
  });

  pythonProcess.stdout.on('data', (data) => {
    event.sender.send('python-stdout', data.toString());
  });

  pythonProcess.stderr.on('data', (data) => {
    event.sender.send('python-stderr', data.toString());
  });

  pythonProcess.on('close', (code) => {
    pythonProcess = null;
    try { if (tmpFile) fs.unlinkSync(tmpFile); } catch (_) {}
    tmpFile = null;
    event.sender.send('python-done', code ?? 0);
  });

  pythonProcess.on('error', (err) => {
    event.sender.send('python-stderr', `Failed to start Python: ${err.message}\n`);
    event.sender.send('python-done', 1);
  });
});

// Send stdin to running Python process
ipcMain.on('python-input', (_, text) => {
  if (pythonProcess?.stdin?.writable) {
    pythonProcess.stdin.write(text + '\n');
  }
});

// Kill running Python process
ipcMain.on('python-kill', () => {
  if (pythonProcess) {
    pythonProcess.kill('SIGTERM');
    setTimeout(() => {
      if (pythonProcess) {
        try { pythonProcess.kill('SIGKILL'); } catch (_) {}
      }
    }, 1000);
  }
});

// Install package via real pip
ipcMain.on('pip-install', (event, pkg) => {
  if (!pythonPath) {
    event.sender.send('pip-stdout', 'Python not found on system.\n');
    event.sender.send('pip-done', 1, pkg);
    return;
  }

  const pip = spawn(pythonPath, ['-m', 'pip', 'install', pkg], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });

  pip.stdout.on('data', (data) => {
    event.sender.send('pip-stdout', data.toString());
  });

  pip.stderr.on('data', (data) => {
    event.sender.send('pip-stdout', data.toString());
  });

  pip.on('close', (code) => {
    event.sender.send('pip-done', code ?? 0, pkg);
  });

  pip.on('error', (err) => {
    event.sender.send('pip-stdout', `pip error: ${err.message}\n`);
    event.sender.send('pip-done', 1, pkg);
  });
});

// ── IPC: File System ────────────────────────────────────────────

// Open file dialog → returns { filePath, content, fileName } or null
ipcMain.handle('file-open', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Python File',
    filters: [
      { name: 'Python Files', extensions: ['py', 'pyw'] },
      { name: 'Text Files', extensions: ['txt'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });

  if (result.canceled || !result.filePaths.length) return null;

  const filePath = result.filePaths[0];
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const fileName = path.basename(filePath);
    // Update window title
    mainWindow?.setTitle(`${fileName} — Python by THETA172`);
    return { filePath, content, fileName };
  } catch (err) {
    return { error: err.message };
  }
});

// Save file to known path
ipcMain.handle('file-save', async (_, filePath, content) => {
  try {
    fs.writeFileSync(filePath, content, 'utf8');
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

// Save-As dialog → returns { filePath, fileName } or null
ipcMain.handle('file-save-as', async (_, content, defaultName) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Python File',
    defaultPath: defaultName || 'main.py',
    filters: [
      { name: 'Python Files', extensions: ['py'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (result.canceled || !result.filePath) return null;

  try {
    fs.writeFileSync(result.filePath, content, 'utf8');
    const fileName = path.basename(result.filePath);
    mainWindow?.setTitle(`${fileName} — Python by THETA172`);
    return { filePath: result.filePath, fileName };
  } catch (err) {
    return { error: err.message };
  }
});

// Update window title
ipcMain.on('set-title', (_, title) => {
  mainWindow?.setTitle(title);
});

// ── App Lifecycle ───────────────────────────────────────────────
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  if (pythonProcess) pythonProcess.kill('SIGTERM');
  try { if (tmpFile) fs.unlinkSync(tmpFile); } catch (_) {}
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception in main process:', err);
});
