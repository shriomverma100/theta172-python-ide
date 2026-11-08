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

const { ClassroomServer } = require('./classroom-server.cjs');
const { ClassroomDiscovery } = require('./classroom-discovery.cjs');

const classroomServer = new ClassroomServer();
const classroomDiscovery = new ClassroomDiscovery();

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

// ── IPC: Classroom (Teacher) ────────────────────────────────────

ipcMain.handle('classroom-start-server', (_, teacherName) => {
  const result = classroomServer.start(teacherName);

  if (result.success) {
    classroomServer.onStudentJoin = (info) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('classroom-student-joined', info);
      }
    };
    classroomServer.onStudentLeave = (info) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('classroom-student-left', info);
      }
    };
    classroomServer.onHelpRequest = (info) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('classroom-help-request', info);
      }
    };
    classroomServer.onStudentCode = (info) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('classroom-student-code', info);
      }
    };
    classroomServer.onStudentCodeLive = (info) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('classroom-student-code-live', info);
      }
    };
    classroomServer.onStudentOutputLive = (info) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('classroom-student-output-live', info);
      }
    };
    classroomServer.onEditGrant = (info) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('classroom-edit-grant', info);
      }
    };
    classroomServer.onEditRevoke = (info) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('classroom-edit-revoke', info);
      }
    };
    classroomServer.onChatMessage = (info) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('classroom-chat-message-received', info);
      }
    };
  }

  return result;
});

ipcMain.handle('classroom-stop-server', () => {
  classroomServer.stop();
  return { success: true };
});

ipcMain.on('classroom-broadcast-code', (_, code, cursor, fileName) => {
  classroomServer.broadcastCode(code, cursor, fileName);
});

ipcMain.on('classroom-broadcast-terminal', (_, text, stream) => {
  classroomServer.broadcastTerminal(text, stream);
});

ipcMain.on('classroom-broadcast-cursor', (_, line, col) => {
  classroomServer.broadcastCursor(line, col);
});

ipcMain.on('classroom-broadcast-selection', (_, ranges) => {
  classroomServer.broadcastSelection(ranges);
});

ipcMain.on('classroom-broadcast-change', (_, from, to, insert) => {
  classroomServer.broadcastChange(from, to, insert);
});

ipcMain.on('classroom-request-student-code', (_, studentId) => {
  classroomServer.requestStudentCode(studentId);
});

ipcMain.on('classroom-request-edit', (_, studentId) => {
  classroomServer.requestEditPermission(studentId);
});

ipcMain.on('classroom-send-edit', (_, studentId, code) => {
  classroomServer.sendEditToStudent(studentId, code);
});

ipcMain.on('classroom-send-live-edit', (_, studentId, from, to, insert) => {
  classroomServer.sendLiveEdit(studentId, from, to, insert);
});

ipcMain.on('classroom-clear-help', (_, studentId) => {
  classroomServer.clearHelp(studentId);
});

ipcMain.handle('classroom-get-students', () => {
  return classroomServer.getStudents();
});

ipcMain.on('classroom-send-chat-message', (_, text, target, senderName) => {
  if (classroomServer.running) {
    classroomServer.sendChatMessage(text, target, senderName);
  } else if (classroomDiscovery.connected) {
    classroomDiscovery.sendChatMessage(text, target);
  }
});

// ── IPC: Classroom (Student) ────────────────────────────────────

ipcMain.on('classroom-start-discovery', (_, name, roll) => {
  classroomDiscovery.onTeacherFound = (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('classroom-teacher-found', info);
    }
  };
  classroomDiscovery.onConnected = (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('classroom-connected', info);
    }
  };
  classroomDiscovery.onDisconnected = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('classroom-disconnected');
    }
  };
  classroomDiscovery.onCodeSync = (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('classroom-code-sync', data);
    }
  };
  classroomDiscovery.onCodeChange = (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('classroom-code-change', data);
    }
  };
  classroomDiscovery.onTerminal = (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('classroom-terminal', data);
    }
  };
  classroomDiscovery.onCursor = (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('classroom-cursor', data);
    }
  };
  classroomDiscovery.onSelection = (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('classroom-selection', data);
    }
  };
  classroomDiscovery.onViewRequest = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('classroom-view-request');
    }
  };
  classroomDiscovery.onEditRequest = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('classroom-edit-request');
    }
  };
  classroomDiscovery.onEditCode = (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('classroom-edit-code', data);
    }
  };
  classroomDiscovery.onEditLive = (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('classroom-edit-live', data);
    }
  };
  classroomDiscovery.onSessionEnd = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('classroom-session-end');
    }
  };
  classroomDiscovery.onChatMessage = (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('classroom-chat-message-received', data);
    }
  };

  classroomDiscovery.startDiscovery(name, roll);
});

ipcMain.on('classroom-stop-discovery', () => {
  classroomDiscovery.stopDiscovery();
});

ipcMain.on('classroom-send-help', (_, message) => {
  classroomDiscovery.sendHelpRequest(message);
});

ipcMain.on('classroom-send-code', (_, code, fileName) => {
  classroomDiscovery.sendCode(code, fileName);
});

ipcMain.on('classroom-send-code-live', (_, code, fileName) => {
  classroomDiscovery.sendCodeLive(code, fileName);
});

ipcMain.on('classroom-send-output-live', (_, text, stream) => {
  classroomDiscovery.sendOutputLive(text, stream);
});

ipcMain.on('classroom-grant-edit', (_, granted) => {
  classroomDiscovery.grantEditPermission(granted);
});

ipcMain.on('classroom-revoke-edit', () => {
  classroomDiscovery.revokeEditPermission();
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
  if (pythonProcess) { try { pythonProcess.kill('SIGTERM'); } catch (_) {} }
  if (replProcess) { try { replProcess.kill('SIGTERM'); } catch (_) {} }
  try { if (tmpFile) fs.unlinkSync(tmpFile); } catch (_) {}
  classroomServer.stop();
  classroomDiscovery.stopDiscovery();
  if (!isDev) app.releaseSingleInstanceLock();
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception in main process:', err);
});
