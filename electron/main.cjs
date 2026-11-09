/**
 * THETA172 — Electron Main Process (Production-Hardened)
 * Frameless window, COEP/COOP headers for SharedArrayBuffer,
 * native window controls via IPC, local Python execution, crash recovery.
 */

const { app, BrowserWindow, ipcMain, session, shell, Menu, dialog, screen } = require('electron');
const { execFile, spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const isDev = process.env.NODE_ENV === 'development';

const { ClassroomServer } = require('./classroom-server.cjs');
const { ClassroomDiscovery } = require('./classroom-discovery.cjs');
const { PythonRunner } = require('./python-runner.cjs');
const { FileAccess } = require('./file-access.cjs');
const { initAutoUpdates } = require('./updater.cjs');
const { registerWorkspaceIpc } = require('./workspace-ipc.cjs');
const { registerPythonIpc, bundledPaths } = require('./python-ipc.cjs');
const { registerLspIpc } = require('./lsp-ipc.cjs');
const { registerDebugIpc } = require('./debug-ipc.cjs');
const { registerStudyWindow } = require('./study-window.cjs');

const classroomServer = new ClassroomServer();
const classroomDiscovery = new ClassroomDiscovery();
const pythonRunner = new PythonRunner({ spawn, fs, tmpDir: os.tmpdir() });
const fileAccess = new FileAccess();
let workspaceIpc = null; // set in app.whenReady (needs userData)
let pythonIpc = null;    // set in app.whenReady (needs userData)
let lspIpc = null;       // set in app.whenReady
let debugIpc = null;     // set in app.whenReady
let studyWindow = null;  // set in app.whenReady

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
    // Test runs open without taking focus: typing elsewhere must not land in
    // the test window (an Enter on the theme picker would "choose" a theme)
    if (process.env.THETA_SMOKE === '1') {
      mainWindow.showInactive();
      return;
    }
    mainWindow.show();
    mainWindow.focus();
  });

  if (process.env.THETA_SMOKE === '1') {
    if (process.env.THETA_SHOTS) require('./dev-shots.cjs').attachShots(mainWindow, process.env.THETA_SHOTS);
    else attachSmokeTest(mainWindow);
  }

  studyWindow?.attach(mainWindow);
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
  info.pickerTrail = (info.pickerTrail || '') + 'start:' + (document.getElementById('theme-picker').classList.contains('hidden') ? 'H ' : 'V ');
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

  info.pickerTrail = (info.pickerTrail || '') + 'ctx:' + (document.getElementById('theme-picker').classList.contains('hidden') ? 'H ' : 'V ');
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

  info.pickerTrail = (info.pickerTrail || '') + 'p3:' + (document.getElementById('theme-picker').classList.contains('hidden') ? 'H ' : 'V ');
  // Python engine (Phase 3): the default environment made from the built-in Python
  info.interpreter = document.getElementById('python-version')?.textContent + ' / ' + document.getElementById('runtime-type')?.textContent;
  checks.defaultEnvFromBundled = /^3\\.12\\.\\d+ \\/ THETA172 env$/.test(info.interpreter);

  document.querySelector('.ide-statusbar [data-interpreter], #runbar-runtime').click();
  for (let i = 0; i < 30 && !document.querySelector('.quick-pick .qp-item'); i++) await sleep(100);
  info.pickerItems = [...document.querySelectorAll('.quick-pick .qp-item')].map((e) => e.querySelector('.cmd-result-name').textContent + (e.querySelector('.qp-check').textContent ? ' ✓' : ''));
  checks.interpreterPicker = info.pickerItems.some((t) => / ✓$/.test(t));
  document.querySelector('.quick-pick .cmd-input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(100);
  checks.pickerCloses = !document.querySelector('.quick-pick');

  document.getElementById('pip-list-btn').click();
  for (let i = 0; i < 50 && !document.querySelector('#pip-packages-list .pip-package-item'); i++) await sleep(100);
  info.packages = [...document.querySelectorAll('#pip-packages-list .pip-package-item__name')].map((e) => e.textContent);
  checks.packagesListReal = info.packages.includes('pip');
  document.getElementById('pip-packages-close').click();

  // A missing package: the fix bar names the right one to install
  content.focus();
  document.execCommand('selectAll');
  document.execCommand('insertText', false, 'import cv2');
  await sleep(300);
  document.getElementById('btn-run').click();
  for (let i = 0; i < 40 && !/done|error/.test(runState()); i++) await sleep(250);
  await sleep(200);
  info.fixBar = document.getElementById('fix-bar-install')?.textContent;
  checks.missingModuleFix = !document.getElementById('fix-bar').classList.contains('hidden') && /^Install opencv-python/.test(info.fixBar || '');
  document.getElementById('fix-bar-close').click();

  info.pickerTrail = (info.pickerTrail || '') + 'p2:' + (document.getElementById('theme-picker').classList.contains('hidden') ? 'H ' : 'V ');
  // Workspace (Phase 2): the sample project from scripts/smoke.cjs is open
  for (let i = 0; i < 30 && !document.querySelector('#ws-tree .ws-row'); i++) await sleep(100);
  info.treeRows = [...document.querySelectorAll('#ws-tree .ws-row__name')].map((e) => e.textContent);
  checks.workspaceOpened = info.treeRows.includes('main.py') && info.treeRows.includes('src');

  // Open main.py from the tree: a clean tab, not marked unsaved
  [...document.querySelectorAll('#ws-tree .ws-row')].find((r) => r.dataset.path.endsWith('main.py'))?.click();
  const activeTab = () => document.querySelector('.editor-tab.active');
  for (let i = 0; i < 20 && !(activeTab()?.textContent || '').includes('main.py'); i++) await sleep(100);
  await sleep(200);
  checks.fileOpensCleanTab = (activeTab()?.textContent || '').includes('main.py')
    && !activeTab()?.querySelector('.editor-tab__dot.unsaved');

  // It imports src/helpers.py: works only when run in place from the project folder
  document.getElementById('btn-run').click();
  for (let i = 0; i < 40 && !/done|error/.test(runState()); i++) await sleep(250);
  info.projectRun = runState();
  checks.projectImportsWork = (window.__thetaTest?.terminalText() || '').includes('IMPORT_OK 42');

  // Search across the project
  document.getElementById('view-search').click();
  const searchBox = document.getElementById('search-input');
  searchBox.value = 'add';
  searchBox.dispatchEvent(new Event('input', { bubbles: true }));
  for (let i = 0; i < 30 && !document.querySelector('#search-results .sr-line'); i++) await sleep(100);
  info.searchLines = document.querySelectorAll('#search-results .sr-line').length;
  checks.projectSearch = info.searchLines >= 3;
  document.getElementById('view-files').click();

  // Split editor shows the same file
  document.getElementById('btn-split').click();
  await sleep(250);
  checks.splitEditor = (document.querySelector('#monaco-split .cm-content')?.textContent || '').includes('IMPORT_OK');
  document.getElementById('btn-split').click();

  // Real system terminal
  document.getElementById('tab-shell').click();
  for (let i = 0; i < 60 && !/PS |\\$ |> /.test(window.__thetaTest?.shellText() || ''); i++) await sleep(100);
  info.shellTail = (window.__thetaTest?.shellText() || '').trim().slice(-60);
  checks.shellStarts = /PS |\\$ |> /.test(window.__thetaTest?.shellText() || '');
  document.getElementById('tab-terminal').click();

  info.pickerTrail = (info.pickerTrail || '') + 'p4:' + (document.getElementById('theme-picker').classList.contains('hidden') ? 'H ' : 'V ');
  // Language intelligence (Phase 4), on main.py of the sample project
  const t4 = window.__thetaTest;
  // The project's file (its tab title is the path), not the untitled starter tab of the same name
  const clickTab = async (name) => {
    const all = [...document.querySelectorAll('.editor-tab')].filter((t) => (t.querySelector('.editor-tab__name')?.textContent || '') === name);
    (all.find((t) => (t.title || '').includes('theta-smoke-project')) || all[0])?.click();
    await sleep(200);
  };
  for (let i = 0; i < 150 && !t4.lspReady(); i++) await sleep(100);
  checks.lspStarts = t4.lspReady();
  await clickTab('main.py');
  t4.setCode('from src.helpers import add\\n\\nprint("IMPORT_OK", add(40, 2))\\nprint(undefined_name)\\nimport os\\nos.pa\\n');
  for (let i = 0; i < 100 && !t4.problems().files.some((f) => f.items.some((d) => d.message.includes('undefined_name'))); i++) await sleep(100);
  await sleep(300); // the Problems view updates a moment after the server reports
  const probs = t4.problems();
  info.problems = probs.files.map((f) => f.name + ': ' + f.items.map((d) => d.message.split('\\n')[0]).join(' | '));
  checks.lspDiagnostics = info.problems.some((t) => t.includes('"undefined_name" is not defined'));
  checks.problemsStatusBar = probs.errors > 0 && document.querySelector('#status-problems [data-errors]')?.textContent === String(probs.errors);
  document.getElementById('tab-problems').click();
  await sleep(200);
  checks.problemsPane = !!document.querySelector('#problems-list .problem--error');
  document.getElementById('tab-terminal').click();

  // Completions come from the language server: os.pa -> path
  t4.cursorTo('os.pa\\n', 5);
  t4.complete();
  for (let i = 0; i < 80 && !document.querySelector('.cm-tooltip-autocomplete li'); i++) await sleep(100);
  info.completions = [...document.querySelectorAll('.cm-tooltip-autocomplete li')].slice(0, 5).map((li) => li.textContent);
  checks.lspCompletion = info.completions.some((t) => t.includes('path'));
  document.querySelector('.cm-content').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(100);

  // F12 on add() opens src/helpers.py; F12 on print() opens builtins.pyi read-only
  t4.cursorTo('add(40', 1);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F12', bubbles: true }));
  for (let i = 0; i < 60 && t4.activeTab() !== 'helpers.py'; i++) await sleep(100);
  checks.goToDefinitionFile = t4.activeTab() === 'helpers.py';
  await clickTab('main.py');
  t4.cursorTo('print("IMPORT', 2);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F12', bubbles: true }));
  for (let i = 0; i < 60 && !/builtins/.test(t4.activeTab() || ''); i++) await sleep(100);
  info.libraryTab = t4.activeTab();
  checks.goToDefinitionLibrary = t4.tabs().some((t) => t.readOnly && /^builtins\\.pyi$/.test(t.name));

  // F2 renames add -> plus in main.py and src/helpers.py
  await clickTab('main.py');
  t4.cursorTo('add(40', 1);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
  for (let i = 0; i < 40 && !document.querySelector('.quick-pick .cmd-input'); i++) await sleep(100);
  const renameBox = document.querySelector('.quick-pick .cmd-input');
  if (renameBox) {
    renameBox.value = 'plus';
    renameBox.dispatchEvent(new Event('input', { bubbles: true }));
    renameBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }
  for (let i = 0; i < 60 && !t4.code().includes('plus(40'); i++) await sleep(100);
  await sleep(200);
  info.tabsAfterRename = t4.tabs().map((t) => t.name + (t.unsaved ? '*' : '') + (t.readOnly ? ' (ro)' : ''));
  checks.renameAcrossFiles = t4.code().includes('import plus') && t4.code().includes('plus(40') && t4.tabs().some((t) => t.name === 'helpers.py' && t.unsaved);

  // Shift+Alt+F formats with Ruff
  t4.setCode('x=1\\nprint( x )\\n');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F', shiftKey: true, altKey: true, bubbles: true }));
  for (let i = 0; i < 50 && t4.code() !== 'x = 1\\nprint(x)\\n'; i++) await sleep(100);
  checks.formatWithRuff = t4.code() === 'x = 1\\nprint(x)\\n';
  info.pickerTrail = (info.pickerTrail || '') + 'p5:' + (document.getElementById('theme-picker').classList.contains('hidden') ? 'H ' : 'V ');
  // Debugger (Phase 5): an unsaved tab with input(), a breakpoint, stepping, evaluate
  const ds = () => t4.debugState();
  document.getElementById('btn-new-tab').click();
  await sleep(200);
  t4.setCode('name = input("Name? ")\\ntotal = 0\\nfor i in range(3):\\n    total += i\\nprint("hi", name, total)\\n');
  t4.toggleBreakpointLine(4);
  await sleep(100);
  checks.breakpointGutter = !!document.querySelector('.cm-bp-dot');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F5', bubbles: true }));
  for (let i = 0; i < 100 && !/Name\\?/.test(t4.terminalText()); i++) await sleep(100);
  t4.submitInput('Ada');
  for (let i = 0; i < 80 && ds().pausedLine !== 4; i++) await sleep(100);
  await sleep(400);
  info.debugPaused = ds();
  info.debugVars = [...document.querySelectorAll('#dbg-variables .dbg-var')].map((r) => r.textContent.replace(/\\s+/g, ' ').trim()).slice(0, 6);
  checks.debugStopsAtBreakpoint = info.debugPaused.pausedLine === 4 && /line 4/.test(info.debugPaused.status);
  const flat = info.debugVars.map((t) => t.replace(/ /g, ''));
  checks.debugVariables = flat.some((t) => t.startsWith("name='Ada'")) && flat.some((t) => t.startsWith('total=0'));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', bubbles: true }));
  for (let i = 0; i < 40 && ds().pausedLine !== 3; i++) await sleep(100);
  checks.debugStepOver = ds().pausedLine === 3;
  const evalBox = document.getElementById('dbg-eval-input');
  evalBox.value = 'total + 100';
  evalBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  for (let i = 0; i < 30 && !document.querySelector('#dbg-eval-log .dbg-eval-a'); i++) await sleep(100);
  info.debugEval = document.querySelector('#dbg-eval-log .dbg-eval-a')?.textContent;
  checks.debugEvaluate = info.debugEval === '100';
  t4.toggleBreakpointLine(4); // remove it, then run to the end
  await sleep(200);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F5', bubbles: true }));
  for (let i = 0; i < 80 && ds().active; i++) await sleep(100);
  checks.debugRunsToEnd = !ds().active && /hi Ada 3/.test(t4.terminalText());
  // An uncaught exception pauses with its message
  t4.setCode('def ratio(a, b):\\n    return a / b\\n\\nprint(ratio(4, 0))\\n');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F5', bubbles: true }));
  for (let i = 0; i < 100 && !/ZeroDivisionError/.test(document.getElementById('dbg-exception')?.textContent || ''); i++) await sleep(100);
  info.debugException = document.getElementById('dbg-exception')?.textContent;
  checks.debugException = /ZeroDivisionError/.test(info.debugException || '') && ds().pausedLine === 2;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F5', shiftKey: true, bubbles: true }));
  for (let i = 0; i < 60 && ds().active; i++) await sleep(100);
  checks.debugStops = !ds().active;

  window.confirm = () => true; // closing the sample project discards these edits

  info.pickerTrail = (info.pickerTrail || '') + 'close:' + (document.getElementById('theme-picker').classList.contains('hidden') ? 'H ' : 'V ');
  // Close folder: the tree empties and the project's tabs close
  document.getElementById('ws-close').click();
  await sleep(400);
  checks.closeFolder = !document.querySelector('#ws-tree .ws-row')
    && !document.getElementById('ws-empty').classList.contains('hidden')
    && ![...document.querySelectorAll('.editor-tab')].some((t) => (t.textContent || '').includes('main.py') && t.title.includes('theta-smoke-project'));

  info.pickerTrail = (info.pickerTrail || '') + 'themes:' + (document.getElementById('theme-picker').classList.contains('hidden') ? 'H ' : 'V ');
  // Themes: a fresh profile shows the picker; both layouts work
  const picker = document.getElementById('theme-picker');
  for (let i = 0; i < 50 && picker.classList.contains('hidden'); i++) await sleep(100);
  checks.pickerOnFirstLaunch = !picker.classList.contains('hidden');
  picker.querySelector('[data-pick="playground"]').click();
  await sleep(500);
  const shown = (sel) => getComputedStyle(document.querySelector(sel)).display !== 'none';
  checks.playgroundLayout = document.documentElement.dataset.theme === 'playground'
    && picker.classList.contains('hidden') && shown('.ide-runbar') && !shown('.ide-rail');

  // Spotlight (Playground): heading for Output makes it grow; back to the code shrinks it
  const ideBody = document.querySelector('.ide-body');
  const outTile = document.querySelector('.ide-pane--terminal');
  const before = outTile.getBoundingClientRect().width;
  outTile.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false }));
  await sleep(800);
  info.spotWidths = [Math.round(before), Math.round(outTile.getBoundingClientRect().width)];
  checks.spotlightGrows = ideBody.dataset.spot === 'output' && info.spotWidths[1] > before + 80;
  document.getElementById('editor-pane').dispatchEvent(new PointerEvent('pointerenter', { bubbles: false }));
  await sleep(900);
  checks.spotlightReturns = !ideBody.dataset.spot && Math.abs(outTile.getBoundingClientRect().width - before) < 4;

  // Study mode: Half puts the window on half the screen with code over output
  const w0 = window.outerWidth;
  await window.__thetaTest.study('half', 'right');
  for (let i = 0; i < 30 && Math.abs(window.outerWidth - screen.availWidth / 2) > 24; i++) await sleep(100);
  await sleep(300);
  info.study = { w0, half: window.outerWidth, screen: screen.availWidth };
  const edBox = document.getElementById('editor-pane').getBoundingClientRect();
  const outBox = outTile.getBoundingClientRect();
  checks.studyHalf = document.documentElement.dataset.study === 'half' && Math.abs(window.outerWidth - screen.availWidth / 2) <= 24
    && !shown('.sidebar') && !shown('.class-tile') && outBox.top >= edBox.bottom - 2 && !document.getElementById('study-bar').classList.contains('hidden');
  await window.__thetaTest.study(null);
  for (let i = 0; i < 30 && Math.abs(window.outerWidth - w0) > 8; i++) await sleep(100);
  checks.studyExitRestores = !document.documentElement.dataset.study && Math.abs(window.outerWidth - w0) <= 8;
  document.querySelector('.ide-topbar [data-theme-choice="pro"]').click();
  for (let i = 0; i < 20 && document.documentElement.dataset.theme !== 'pro'; i++) await sleep(100);
  await sleep(300);
  checks.proLayout = document.documentElement.dataset.theme === 'pro'
    && shown('.ide-rail') && shown('.ide-statusbar') && !shown('.ide-runbar')
    && getComputedStyle(document.querySelector('.ide-topbar .btn-run')).display !== 'none';
  const editorBg = () => getComputedStyle(document.querySelector('#monaco-container .cm-editor')).backgroundColor;
  for (let i = 0; i < 10 && editorBg() !== 'rgb(14, 15, 17)'; i++) await sleep(100);
  info.proEditorBg = editorBg();
  checks.proEditorColours = info.proEditorBg === 'rgb(14, 15, 17)';
  checks.themeRemembered = localStorage.getItem('theta-theme') === 'pro';

  // Start-up screen is gone and pixel effects stayed inside their frame budget
  checks.bootScreenGone = document.getElementById('loading-overlay').classList.contains('hidden');
  const fx = await window.__thetaTest?.fxStats?.();
  info.fx = fx;
  // Main thread: starting an effect typically costs under 2 ms (median; nothing per frame).
  // Worker: draws at 30 fps on its own thread; 5 ms per drawn frame keeps
  // all pixel effects under ~15% of one CPU core.
  checks.fxMainUnderBudget = !!fx && fx.main.medianMs < 2 && fx.main.maxMs < 16; // typical call under budget, never a dropped frame
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

// Run Python code via local interpreter (see python-runner.cjs)
// A saved file inside the open project runs in place from the project folder
// (so imports between project files work); anything else runs from a temp file.
ipcMain.on('python-run', (event, code, opts = {}) => {
  const ws = workspaceIpc?.workspace;
  const root = ws?.root || undefined;
  const filePath = typeof opts?.filePath === 'string' && ws?.contains(opts.filePath) && /\.pyw?$/i.test(opts.filePath)
    ? path.resolve(opts.filePath)
    : undefined;
  pythonRunner.run(code, event.sender, { filePath, cwd: root });
});
ipcMain.on('python-input', (_, text) => pythonRunner.input(text));
ipcMain.on('python-kill', () => pythonRunner.kill());

// ── IPC: Interactive REPL ───────────────────────────────────────
let replProcess = null;

ipcMain.on('repl-start', (event) => {
  const python = pythonIpc?.active?.path;
  if (!python) {
    event.sender.send('repl-stderr', 'No Python selected.\r\n');
    return;
  }

  // Kill existing REPL if any
  if (replProcess) {
    try { replProcess.kill('SIGTERM'); } catch (_) {}
    replProcess = null;
  }

  replProcess = spawn(python, ['-i', '-u'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: workspaceIpc?.workspace.root || undefined,
    env: {
      ...pythonIpc.shellEnv(process.env),
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8',
      PYTHONSTARTUP: '',
    },
  });
  replProcess.stdin.on('error', () => {}); // a write after the process exited fails with EPIPE; the exit handler reports the end

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
    workspaceIpc?.rememberFile(filePath);
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
  // Files picked in a dialog, or any file inside the open project folder
  if (!fileAccess.isAllowed(filePath) && !workspaceIpc?.workspace.contains(filePath)) {
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
    workspaceIpc?.rememberFile(result.filePath);
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
  workspaceIpc = registerWorkspaceIpc({
    ipcMain, dialog, shell, app, execFile, getWindow: () => mainWindow, fileAccess,
    shellEnv: (base) => pythonIpc?.shellEnv(base) ?? base,
  });
  pythonIpc = registerPythonIpc({
    ipcMain, app, execFile, spawn,
    getWindow: () => mainWindow,
    getRoot: () => workspaceIpc?.workspace.root || null,
    onActiveChange: (info) => {
      pythonRunner.setPython(info?.path || null, info ? pythonIpc?.shellEnv(process.env) : null);
      lspIpc?.configurationChanged(); // the language server resolves imports from the new env
    },
  });
  lspIpc = registerLspIpc({
    ipcMain, spawn,
    getWindow: () => mainWindow,
    getRoot: () => workspaceIpc?.workspace.root || null,
    getPython: () => pythonIpc?.active?.path || null,
    ruffPath: bundledPaths(app).ruff,
    onLog: isDev ? (t) => process.stderr.write(`[lsp] ${t}`) : null,
  });
  const tools = bundledPaths(app);
  debugIpc = registerDebugIpc({
    ipcMain, spawn,
    getWindow: () => mainWindow,
    getWorkspace: () => workspaceIpc?.workspace || null,
    getPython: () => pythonIpc?.active?.path || null,
    getEnv: () => pythonIpc.shellEnv(process.env),
    // The adapter runs on the built-in Python; the program runs on the chosen one
    getAdapterPython: () => tools.python || pythonIpc?.active?.path || null,
    debugpyDir: tools.debugpy,
    onLog: isDev ? (t) => process.stderr.write(`[debug] ${t}`) : null,
  });
  studyWindow = registerStudyWindow({ ipcMain, screen, getWindow: () => mainWindow });
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
  workspaceIpc?.dispose();
  lspIpc?.dispose();
  debugIpc?.dispose();
  pythonRunner.dispose();
  if (replProcess) { try { replProcess.kill('SIGTERM'); } catch (_) {} }
  classroomServer.stop();
  classroomDiscovery.stopDiscovery();
  if (!isDev) app.releaseSingleInstanceLock();
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception in main process:', err);
});
