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
const { PythonRunner } = require('./python-runner.cjs');
const { FileAccess } = require('./file-access.cjs');
const { isValidPackageSpec } = require('./validate.cjs');
const { initAutoUpdates } = require('./updater.cjs');

const classroomServer = new ClassroomServer();
const classroomDiscovery = new ClassroomDiscovery();
const pythonRunner = new PythonRunner({ spawn, fs, tmpDir: os.tmpdir() });
const fileAccess = new FileAccess();

// Smoke tests use a throwaway profile so they never touch real saved code.
if (process.env.THETA_SMOKE === '1') {
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'theta-smoke-')));
  // Screenshot reviews at Windows scaling levels (125% = 1.25)
  if (process.env.THETA_SCALE) app.commandLine.appendSwitch('force-device-scale-factor', process.env.THETA_SCALE);
  // Simulate Windows 'Animation effects: off' (pixel effects must step aside)
  if (process.env.THETA_REDUCED_MOTION === '1') app.commandLine.appendSwitch('force-prefers-reduced-motion');
}

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

function createWindow() {
  // Set COEP/COOP + CSP headers before any request
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval' https://cdn.jsdelivr.net",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
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
    backgroundColor: '#000000',
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

  if (process.env.THETA_SMOKE === '1') {
    if (process.env.THETA_SHOTS) require('./dev-shots.cjs').attachShots(mainWindow, process.env.THETA_SHOTS);
    else attachSmokeTest(mainWindow);
  }

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

// ── Smoke test (npm run test:smoke) ─────────────────────────────
// Loads the real app, collects renderer errors for a few seconds,
// prints a JSON report and exits non-zero if anything failed.
function attachSmokeTest(win) {
  const errors = [];
  win.webContents.on('console-message', (...args) => {
    // Electron >= 35 passes one details object; older versions pass (event, level, message).
    const details = args[0] && typeof args[0] === 'object' && 'message' in args[0] ? args[0] : null;
    const level = details ? details.level : args[1];
    const message = details ? details.message : args[2];
    if (level === 'error' || level === 3) errors.push(String(message));
  });
  win.webContents.on('render-process-gone', (_e, d) => errors.push(`renderer gone: ${d.reason}`));
  win.webContents.on('did-fail-load', (_e, code, desc) => errors.push(`load failed: ${code} ${desc}`));
  win.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      let probe = {};
      try {
        probe = await win.webContents.executeJavaScript(SMOKE_PROBE);
      } catch (err) { errors.push(`probe failed: ${err.message}`); }
      const ok = errors.length === 0 && Object.values(probe.checks || {}).every(Boolean);
      console.log('THETA_SMOKE_RESULT ' + JSON.stringify({ ok, probe, errors }));
      app.exit(ok ? 0 : 1);
    }, Number(process.env.THETA_SMOKE_WAIT_MS) || 6000);
  });
}

// Drives the real UI: types code, runs it, opens a tab and the palette.
const SMOKE_PROBE = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const checks = {};
  const runState = () => document.getElementById('run-status').className.replace('run-status run-status--', '');
  const info = {};
  checks.editor = !!document.querySelector('.cm-editor');
  checks.terminal = !!document.querySelector('.xterm');
  checks.oneTab = document.querySelectorAll('.editor-tab').length === 1;

  // Replace the editor text through the real input path
  const content = document.querySelector('.cm-content');
  content.focus();
  document.execCommand('selectAll');
  document.execCommand('insertText', false, 'print(6 * 7)');
  await sleep(300);

  info.runtime = document.getElementById('runtime-type')?.textContent;
  for (let i = 0; i < 40 && runState() !== 'ready'; i++) await sleep(250);
  document.getElementById('btn-run').click();
  for (let i = 0; i < 40 && !/done|error/.test(runState()); i++) await sleep(250);
  info.runStatus = document.getElementById('run-status-text')?.textContent;
  const out = window.__thetaTest?.terminalText() || '';
  checks.runPrinted42 = /^42$/m.test(out);
  checks.runDone = runState() === 'done' && /^Done in /.test(info.runStatus);
  checks.runInHistory = /ok/.test(document.querySelector('#run-history li')?.className || '');
  checks.mascotHappy = document.documentElement.dataset.runState === 'done';

  // Right-click menu on the editor (was never attached before Phase 0)
  content.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 200, clientY: 200 }));
  await sleep(100);
  checks.contextMenu = !!document.querySelector('#context-menu.visible');
  document.body.click();

  // Stop a long-running program: status returns to Ready and the timer stops
  content.focus();
  document.execCommand('selectAll');
  document.execCommand('insertText', false, 'import time\\ntime.sleep(30)');
  await sleep(300);
  document.getElementById('btn-run').click();
  await sleep(1500);
  checks.longRunIsRunning = runState() === 'running';
  document.getElementById('btn-run').click(); // acts as Stop while running
  await sleep(1500);
  info.afterStop = runState();
  checks.stopReturnsToReady = info.afterStop === 'idle';
  const t1 = document.getElementById('exec-time')?.textContent;
  await sleep(400);
  checks.timerStopped = document.getElementById('exec-time')?.textContent === t1;

  document.getElementById('btn-new-tab').click();
  await sleep(200);
  checks.newTab = document.querySelectorAll('.editor-tab').length === 2;

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, shiftKey: true, bubbles: true }));
  await sleep(200);
  checks.paletteOpens = !document.getElementById('cmd-palette').classList.contains('hidden');
  info.paletteItems = document.querySelectorAll('#cmd-results .cmd-result-item').length;
  checks.paletteHasItems = info.paletteItems > 10;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

  // Themes: a fresh profile shows the picker; both layouts work
  const picker = document.getElementById('theme-picker');
  checks.pickerOnFirstLaunch = !picker.classList.contains('hidden');
  picker.querySelector('[data-pick="playground"]').click();
  await sleep(500);
  const shown = (sel) => getComputedStyle(document.querySelector(sel)).display !== 'none';
  checks.playgroundLayout = document.documentElement.dataset.theme === 'playground'
    && picker.classList.contains('hidden') && shown('.ide-runbar') && !shown('.ide-rail');
  document.querySelector('.ide-topbar [data-theme-choice="pro"]').click();
  for (let i = 0; i < 20 && document.documentElement.dataset.theme !== 'pro'; i++) await sleep(100);
  await sleep(300);
  checks.proLayout = document.documentElement.dataset.theme === 'pro'
    && shown('.ide-rail') && shown('.ide-statusbar') && !shown('.ide-runbar')
    && getComputedStyle(document.querySelector('.ide-topbar .btn-run')).display !== 'none';
  info.proEditorBg = getComputedStyle(document.querySelector('.cm-editor')).backgroundColor;
  checks.proEditorColours = info.proEditorBg === 'rgb(14, 15, 17)';
  checks.themeRemembered = localStorage.getItem('theta-theme') === 'pro';

  // Start-up screen is gone and pixel effects stayed inside their frame budget
  checks.bootScreenGone = document.getElementById('loading-overlay').classList.contains('hidden');
  const fx = await window.__thetaTest?.fxStats?.();
  info.fx = fx;
  // Main thread: starting an effect must stay under 2 ms (nothing per frame).
  // Worker: draws at 30 fps on its own thread; 5 ms per drawn frame keeps
  // all pixel effects under ~15% of one CPU core.
  checks.fxMainUnderBudget = !!fx && fx.main.maxMs < 2;
  checks.fxWorkerKeepsUp = !!fx && (!fx.worker || fx.worker.frames === 0 || fx.worker.avgMs < 5);

  return { checks, info };
})()`;

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
      pythonRunner.setPython(cmd);
      return { found: true, path: cmd, version: result };
    } catch (_) {
      continue;
    }
  }
  return { found: false };
});

// Run Python code via local interpreter (see python-runner.cjs)
ipcMain.on('python-run', (event, code) => pythonRunner.run(code, event.sender));
ipcMain.on('python-input', (_, text) => pythonRunner.input(text));
ipcMain.on('python-kill', () => pythonRunner.kill());

// Install package via real pip
ipcMain.on('pip-install', (event, pkg) => {
  if (!pythonPath) {
    if (!event.sender.isDestroyed()) event.sender.send('pip-stdout', 'Python not found on system.\n');
    if (!event.sender.isDestroyed()) event.sender.send('pip-done', 1, pkg);
    return;
  }

  // Validate in the main process too: the renderer is not trusted.
  if (!isValidPackageSpec(pkg)) {
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
    fileAccess.allow(filePath);
    const fileName = path.basename(filePath);
    // Update window title
    mainWindow?.setTitle(`${fileName} — Python by THETA172`);
    return { filePath, content, fileName };
  } catch (err) {
    return { error: err.message };
  }
});

// Save file to a path the user already chose in an Open/Save dialog
ipcMain.handle('file-save', async (_, filePath, content) => {
  if (!fileAccess.isAllowed(filePath)) {
    return { error: 'This file was not opened or saved in this session. Use Save As.', needsSaveAs: true };
  }
  if (typeof content !== 'string') return { error: 'Invalid content.' };
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
  if (typeof content !== 'string') return { error: 'Invalid content.' };

  try {
    fs.writeFileSync(result.filePath, content, 'utf8');
    fileAccess.allow(result.filePath);
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
  if (!isDev && app.isPackaged) initAutoUpdates(() => mainWindow);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  pythonRunner.dispose();
  if (replProcess) { try { replProcess.kill('SIGTERM'); } catch (_) {} }
  classroomServer.stop();
  classroomDiscovery.stopDiscovery();
  if (!isDev) app.releaseSingleInstanceLock();
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception in main process:', err);
});
