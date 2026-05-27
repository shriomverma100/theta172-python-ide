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
const { CollabServer } = require('./collab-server.cjs');
const { CollabDiscovery } = require('./collab-discovery.cjs');

// Enable SharedArrayBuffer (required for Pyodide Atomics)
app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer');

// Prevent multiple instances (skip in dev so restarts work)
if (!isDev) {
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
}

let mainWindow = null;
let pythonPath = null;
let pythonProcess = null;
let tmpFile = null;

function createWindow() {
  // Set COEP/COOP + CSP headers before any request
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval' https://cdn.jsdelivr.net",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "connect-src 'self' ws: wss: https://api.groq.com https://cdn.jsdelivr.net https://files.pythonhosted.org https://pypi.org",
      "img-src 'self' data: blob:",
      "worker-src 'self' blob:",
    ].join('; ');

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Cross-Origin-Opener-Policy':   ['same-origin'],
        'Cross-Origin-Embedder-Policy': ['require-corp'],
        'Content-Security-Policy':      [csp],
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

  // Block DevTools in production to protect stored API keys
  if (!isDev) {
    mainWindow.webContents.on('devtools-opened', () => {
      mainWindow.webContents.closeDevTools();
    });
  }

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

  // Unsaved changes confirmation on close
  let forceClose = false;
  mainWindow.on('close', (e) => {
    if (forceClose) return; // already confirmed

    e.preventDefault();
    mainWindow.webContents.send('check-unsaved');
  });

  ipcMain.on('unsaved-status', (_, hasUnsaved) => {
    if (!mainWindow) return;

    if (!hasUnsaved) {
      forceClose = true;
      mainWindow.close();
      return;
    }

    // Show custom in-app dialog instead of native OS dialog
    mainWindow.webContents.send('show-unsaved-dialog');
  });

  ipcMain.on('unsaved-dialog-response', (_, choice) => {
    if (!mainWindow) return;
    if (choice === 'save') {
      mainWindow.webContents.send('save-and-close');
    } else if (choice === 'discard') {
      forceClose = true;
      mainWindow.close();
    }
    // 'cancel' → do nothing
  });

  ipcMain.on('close-confirmed', () => {
    if (!mainWindow) return;
    forceClose = true;
    mainWindow.close();
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
    if (!event.sender.isDestroyed()) event.sender.send('python-stderr', 'Python not found on system.\n');
    if (!event.sender.isDestroyed()) event.sender.send('python-done', 1);
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
    if (!event.sender.isDestroyed()) event.sender.send('python-stdout', data.toString());
  });

  pythonProcess.stderr.on('data', (data) => {
    if (!event.sender.isDestroyed()) event.sender.send('python-stderr', data.toString());
  });

  pythonProcess.on('close', (code) => {
    pythonProcess = null;
    try { if (tmpFile) fs.unlinkSync(tmpFile); } catch (_) {}
    tmpFile = null;
    if (!event.sender.isDestroyed()) event.sender.send('python-done', code ?? 0);
  });

  pythonProcess.on('error', (err) => {
    if (!event.sender.isDestroyed()) event.sender.send('python-stderr', `Failed to start Python: ${err.message}\n`);
    if (!event.sender.isDestroyed()) event.sender.send('python-done', 1);
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
    if (!event.sender.isDestroyed()) event.sender.send('pip-stdout', 'Python not found on system.\n');
    if (!event.sender.isDestroyed()) event.sender.send('pip-done', 1, pkg);
    return;
  }

  // Validate package name server-side as well
  const VALID_PKG = /^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?(([><=!~]=?|===?)[a-zA-Z0-9.*]+)?$/;
  if (!VALID_PKG.test(pkg) || pkg.startsWith('-')) {
    if (!event.sender.isDestroyed()) event.sender.send('pip-stdout', 'Invalid package name.\n');
    if (!event.sender.isDestroyed()) event.sender.send('pip-done', 1, pkg);
    return;
  }

  const pip = spawn(pythonPath, ['-m', 'pip', 'install', pkg], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });

  pip.stdout.on('data', (data) => {
    if (!event.sender.isDestroyed()) event.sender.send('pip-stdout', data.toString());
  });

  pip.stderr.on('data', (data) => {
    if (!event.sender.isDestroyed()) event.sender.send('pip-stdout', data.toString());
  });

  pip.on('close', (code) => {
    if (!event.sender.isDestroyed()) event.sender.send('pip-done', code ?? 0, pkg);
  });

  pip.on('error', (err) => {
    if (!event.sender.isDestroyed()) event.sender.send('pip-stdout', `pip error: ${err.message}\n`);
    if (!event.sender.isDestroyed()) event.sender.send('pip-done', 1, pkg);
  });
});

// ── IPC: Interactive REPL ───────────────────────────────────────
let replProcess = null;

ipcMain.on('repl-start', (event) => {
  if (!pythonPath) {
    event.sender.send('repl-stderr', 'Python not found on system.\r\n');
    return;
  }

  // Kill existing REPL if any
  if (replProcess) {
    try { replProcess.kill('SIGTERM'); } catch (_) {}
    replProcess = null;
  }

  replProcess = spawn(pythonPath, ['-i', '-u'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8',
      PYTHONSTARTUP: '',
    },
  });

  replProcess.stdout.on('data', (data) => {
    if (!event.sender.isDestroyed()) event.sender.send('repl-stdout', data.toString());
  });

  replProcess.stderr.on('data', (data) => {
    if (!event.sender.isDestroyed()) event.sender.send('repl-stderr', data.toString());
  });

  replProcess.on('close', (code) => {
    replProcess = null;
    if (!event.sender.isDestroyed()) event.sender.send('repl-exit', code ?? 0);
  });

  replProcess.on('error', (err) => {
    if (!event.sender.isDestroyed()) event.sender.send('repl-stderr', `REPL error: ${err.message}\r\n`);
    replProcess = null;
  });
});

ipcMain.on('repl-input', (_, text) => {
  if (replProcess?.stdin?.writable) {
    replProcess.stdin.write(text + '\n');
  }
});

ipcMain.on('repl-kill', () => {
  if (replProcess) {
    try { replProcess.kill('SIGTERM'); } catch (_) {}
    replProcess = null;
  }
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

// ── IPC: Collab WebSocket Server ────────────────────────────────
const collabServer = new CollabServer();
const collabDiscovery = new CollabDiscovery();

// Start collab server (sharer clicks Go Live)
ipcMain.handle('collab-start-server', async (event, options) => {
  try {
    const result = await collabServer.start(options);

    // Wire viewer change notifications to renderer
    collabServer.onViewerChange = (viewers) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('collab-viewers-changed', viewers);
      }
    };

    // Wire highlight requests to renderer
    collabServer.onHighlightRequest = (highlight) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('collab-highlight-request', highlight);
      }
    };

    // Wire errors to renderer
    collabServer.onError = (errMsg) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('collab-server-error', errMsg);
      }
    };

    // Wire student state forwarding to renderer (teacher dashboard)
    collabServer.onStudentState = (data) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('collab-student-state', data);
      }
    };

    // Wire interaction forwarding from viewer to teacher
    collabServer.onInteraction = (data) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('collab-interaction', data);
      }
    };

    // Wire chat forwarding from viewer to teacher
    collabServer.onChat = (data) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('collab-chat', data);
      }
    };

    // Wire CRDT sync forwarding from viewer to teacher
    collabServer.onCrdtSync = (data) => {
      if (!event.sender.isDestroyed()) {
        if (data.isAwareness) {
          event.sender.send('collab-crdt-awareness', data);
        } else {
          event.sender.send('collab-crdt-sync', data);
        }
      }
    };

    // Auto-publish via mDNS so nearby devices discover us
    collabDiscovery.publish({
      port: result.port,
      roomKey: options.roomKey,
      hostName: options.hostName,
      hostId: options.hostId,
    });

    return { success: true, ...result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Stop collab server (sharer clicks Stop Sharing)
ipcMain.handle('collab-stop-server', async () => {
  // Unpublish mDNS service
  collabDiscovery.unpublish();
  collabServer.stop();
  return { success: true };
});

// Get server info (port, addresses, viewer count)
ipcMain.handle('collab-server-info', async () => {
  return collabServer.getServerInfo();
});

// Update full IDE state (sharer sends periodic snapshots)
ipcMain.on('collab-state-full', (_, state) => {
  collabServer.updateFullState(state);
});

// Send state delta (sharer sends incremental changes)
ipcMain.on('collab-state-delta', (_, delta) => {
  collabServer.broadcastStateDelta(delta);
});

// Send highlight to all viewers
ipcMain.on('collab-highlight', (_, highlight) => {
  collabServer.broadcastHighlight(highlight);
});

// Send interaction from teacher to all viewers
ipcMain.on('collab-interaction-send', (_, interaction) => {
  collabServer.broadcastInteraction(interaction);
});

// Send chat message from teacher to all viewers
ipcMain.on('collab-chat-send', (_, chatMsg) => {
  collabServer.broadcastChat(chatMsg);
});

// Send CRDT sync from teacher to all viewers
ipcMain.on('collab-crdt-send', (_, crdtData) => {
  collabServer.broadcastCrdt(crdtData);
});

// Send CRDT awareness from teacher to all viewers
ipcMain.on('collab-awareness-send', (_, awarenessData) => {
  collabServer.broadcastAwareness(awarenessData);
});

// Send collab mode change from teacher to all viewers
ipcMain.on('collab-mode-send', (_, modeData) => {
  collabServer.broadcastCollabMode(modeData);
});

// ── IPC: Collab mDNS Discovery ─────────────────────────────────

// Start browsing for nearby collab services
ipcMain.handle('collab-browse-start', async (event) => {
  collabDiscovery.onDevicesChanged = (devices) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send('collab-nearby-devices', devices);
    }
  };
  collabDiscovery.startBrowsing();
  return { success: true };
});

// Stop browsing
ipcMain.handle('collab-browse-stop', async () => {
  collabDiscovery.stopBrowsing();
  return { success: true };
});

// Get current nearby devices
ipcMain.handle('collab-nearby-list', async () => {
  return collabDiscovery.getDeviceList();
});

// Look up a room key in the shared local registry (cross-instance fallback)
ipcMain.handle('collab-registry-lookup', async (_, roomKey) => {
  try {
    const reg = collabDiscovery._readRegistry();
    for (const [key, svc] of Object.entries(reg)) {
      if (svc.roomKey === roomKey && (Date.now() - svc.timestamp < 3600000)) {
        return {
          found: true,
          host: svc.host || '127.0.0.1',
          addresses: svc.addresses || [svc.host || '127.0.0.1'],
          port: svc.port,
          name: svc.name,
          roomKey: svc.roomKey,
        };
      }
    }
  } catch (_) {}
  return { found: false };
});

// ── App Lifecycle ───────────────────────────────────────────────
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  // Init mDNS discovery
  collabDiscovery.init();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  // Stop collab server and discovery gracefully
  collabDiscovery.destroy();
  collabServer.stop();
  if (pythonProcess) { try { pythonProcess.kill('SIGTERM'); } catch (_) {} }
  if (replProcess) { try { replProcess.kill('SIGTERM'); } catch (_) {} }
  try { if (tmpFile) fs.unlinkSync(tmpFile); } catch (_) {}
  if (!isDev) app.releaseSingleInstanceLock();
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception in main process:', err);
});
