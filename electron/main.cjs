/**
 * THETA172 — Electron Main Process (Production-Hardened)
 * Frameless window, COEP/COOP headers for SharedArrayBuffer,
 * native window controls via IPC, local Python execution, crash recovery.
 */

const { app, BrowserWindow, ipcMain, session, shell, Menu, dialog, screen, safeStorage } = require('electron');
const { execFile, spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const isDev = process.env.NODE_ENV === 'development';
// Windows pauses rendering in windows it thinks are covered; test windows are often covered
if (process.env.THETA_SMOKE === '1') app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

const { ClassroomServer } = require('./classroom-server.cjs');
const { ClassroomDiscovery } = require('./classroom-discovery.cjs');
const { validRelayUrl, parseInvite } = require('./classroom-relay.cjs');
const { PackageCache } = require('./package-mesh.cjs');
const { GpuPool } = require('./gpu-pool.cjs');
const { TestRunner, registerTestIpc } = require('./test-runner.cjs');
const { registerPluginIpc } = require('./plugin-host.cjs');
const { registerRelaySetupIpc } = require('./relay-setup.cjs');
const { PythonRunner } = require('./python-runner.cjs');
const { FileAccess } = require('./file-access.cjs');
const { registerUpdater } = require('./updater.cjs');
const { createGate } = require('./gate.cjs');
const { registerWorkspaceIpc } = require('./workspace-ipc.cjs');
const { registerPythonIpc, bundledPaths } = require('./python-ipc.cjs');
const { registerLspIpc } = require('./lsp-ipc.cjs');
const { registerDebugIpc } = require('./debug-ipc.cjs');
const { registerStudyWindow } = require('./study-window.cjs');
const { registerGitIpc } = require('./git-ipc.cjs');
const { registerNotebookIpc } = require('./kernel.cjs');

const classroomServer = new ClassroomServer();
const classroomDiscovery = new ClassroomDiscovery();
const pythonRunner = new PythonRunner({ spawn, fs, tmpDir: os.tmpdir() });
const fileAccess = new FileAccess();
let workspaceIpc = null; // set in app.whenReady (needs userData)
let pythonIpc = null;    // set in app.whenReady (needs userData)
let lspIpc = null;       // set in app.whenReady
let debugIpc = null;     // set in app.whenReady
let studyWindow = null;  // set in app.whenReady
let notebookIpc = null;  // set in app.whenReady
let packageCache = null; // class package folder (teacher), set in app.whenReady
let gpuPool = null;      // class GPU pool (teacher), set in app.whenReady
let testRunner = null;   // pytest, set in app.whenReady
let relaySetup = null;   // "set up your own relay", set in app.whenReady
let gate = null;         // the owner's remote gate (license / kill switch), set in app.whenReady
let locked = false;      // true once the gate has locked this copy

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

/** Show the owner's lock screen in place of the app. Once locked, it stays locked. */
function loadLockScreen(decision) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  locked = true;
  const data = JSON.stringify({ id: gate?.id || '', message: decision?.message || '', contact: decision?.contact || '' });
  const fill = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    // Fill the lock screen from the main process (the page carries no script of its own)
    mainWindow.webContents.executeJavaScript(`(function(d){
      if (d.message) document.getElementById('msg').textContent = d.message;
      if (d.contact) { var c = document.getElementById('contact'), s = String(d.contact).replace(/[<>]/g,'');
        if (/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(s)) { c.textContent = 'Contact '; var a = document.createElement('a'); a.href = 'mailto:' + s; a.textContent = s; c.appendChild(a); }
        else c.textContent = s; c.hidden = false; }
      if (d.id) document.getElementById('id').textContent = 'Device ' + d.id.slice(0,8).toUpperCase();
      document.addEventListener('keydown', function(e){ if (e.key==='F12' || (e.ctrlKey&&e.shiftKey&&/[IJC]/.test(e.key))) e.preventDefault(); });
      document.addEventListener('contextmenu', function(e){ e.preventDefault(); });
    })(${data});`).catch(() => {});
  };
  mainWindow.webContents.once('did-finish-load', fill);
  mainWindow.loadFile(path.join(__dirname, 'lock.html'));
}

/** Check the gate in the background; if the owner has locked this copy, swap to the lock screen. */
function startGateWatch() {
  if (!gate || !gate.active) return;
  const run = () => gate.check().then((d) => {
    if (d.locked && !locked) { console.log('[gate] locked:', d.reason); loadLockScreen(d); }
  }).catch(() => {});
  setTimeout(run, 4000);
  const timer = setInterval(run, gate.CHECK_INTERVAL_MS);
  timer.unref?.();
}

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
    // Windows needs a bitmap icon (the installed app also has it in its .exe)
    icon:            [path.join(__dirname, '../build-assets/icon.png'), path.join(process.resourcesPath || '', 'icon.png')].find((f) => fs.existsSync(f)),
    webPreferences: {
      preload:             path.join(__dirname, 'preload.cjs'),
      contextIsolation:    true,
      nodeIntegration:     false,
      sandbox:             false,
      webSecurity:         true,
      // Test runs open behind other windows: keep animations and timers running there
      backgroundThrottling: process.env.THETA_SMOKE !== '1',
    },
  });

  // The owner's gate decides what loads. An already-cached "disabled" locks at
  // once (even offline); otherwise the app loads and the gate checks in the
  // background, locking only if the owner has turned this copy off.
  const startDecision = gate ? gate.cachedDecision() : { locked: false };
  if (startDecision.locked) {
    loadLockScreen(startDecision);
  } else if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    // THETA_SHOW_WELCOME=1 opens straight into the first-start welcome (for previews)
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'), process.env.THETA_SHOW_WELCOME === '1' ? { query: { welcome: '1' } } : undefined);
  }
  if (!startDecision.locked) startGateWatch();

  mainWindow.once('ready-to-show', () => {
    // Test runs open without taking focus: typing elsewhere must not land in
    // the test window (an Enter on the theme picker would "choose" a theme)
    if (process.env.THETA_SMOKE === '1') {
      mainWindow.showInactive();
      // and clicks pass through it to whatever is underneath
      mainWindow.setIgnoreMouseEvents(true);
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
    // "STEP …" lines from the probe are printed as they happen (to see where a run stops)
    if (String(message).startsWith('STEP ')) { process.stdout.write(`${message}
`); return; }
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
  console.log('STEP section start ' + Math.round(performance.now() / 1000) + 's');
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

  console.log('STEP section ctx ' + Math.round(performance.now() / 1000) + 's');
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

  // "+" opens a menu: a Python file or a notebook
  window.__newPyTab = async () => {
    document.getElementById('btn-new-tab').click();
    await sleep(120);
    [...document.querySelectorAll('#context-menu.visible .ctx-item')].find((i) => i.textContent.startsWith('New Python file'))?.click();
    await sleep(200);
  };
  document.getElementById('btn-new-tab').click();
  await sleep(120);
  info.newMenu = [...document.querySelectorAll('#context-menu.visible .ctx-item')].map((i) => i.textContent);
  checks.newMenuOffersNotebook = info.newMenu.some((t) => t.startsWith('New notebook'));
  document.body.click(); // close it
  await window.__newPyTab();
  checks.newTab = document.querySelectorAll('.editor-tab').length === 2;

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, shiftKey: true, bubbles: true }));
  await sleep(200);
  checks.paletteOpens = !document.getElementById('cmd-palette').classList.contains('hidden');
  info.paletteItems = document.querySelectorAll('#cmd-results .cmd-result-item').length;
  checks.paletteHasItems = info.paletteItems > 10;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

  console.log('STEP section p3 ' + Math.round(performance.now() / 1000) + 's');
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
  info.cv2Run = { state: runState(), status: document.getElementById('run-status-text')?.textContent, code: window.__thetaTest.code(), out: (window.__thetaTest.terminalText() || '').trim().slice(-160) };
  checks.missingModuleFix = !document.getElementById('fix-bar').classList.contains('hidden') && /^Install opencv-python/.test(info.fixBar || '');
  document.getElementById('fix-bar-close').click();

  console.log('STEP section p2 ' + Math.round(performance.now() / 1000) + 's');
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

  // Editor groups (Phase 7): the same file in both groups mirrors edits
  const viewText = (sel) => document.querySelector(sel + ' .cm-content')?.textContent || '';
  const original = window.__thetaTest.code();
  window.__thetaTest.setCode(original + '# mirrored\\n');
  await sleep(150);
  checks.groupsMirror = viewText('#monaco-container').includes('# mirrored') && viewText('#monaco-split').includes('# mirrored');
  window.__thetaTest.setCode(original);
  // A different file in the right group (the focused one): left keeps main.py
  const row = (name) => [...document.querySelectorAll('#ws-tree .ws-row')].find((r) => r.dataset.path.endsWith(name));
  row('src')?.click();
  for (let i = 0; i < 30 && !row('helpers.py'); i++) await sleep(100);
  row('helpers.py')?.click();
  for (let i = 0; i < 30 && !viewText('#monaco-split').includes('def add'); i++) await sleep(100);
  const activeIn = (sel) => document.querySelector(sel + ' .editor-tab.active .editor-tab__name')?.textContent || '';
  info.groups = { left: activeIn('#editor-tabs'), right: activeIn('#editor-tabs-2') };
  checks.groupsTwoFiles = info.groups.left.startsWith('main.py') && info.groups.right === 'helpers.py'
    && viewText('#monaco-split').includes('def add') && viewText('#monaco-container').includes('IMPORT_OK');
  // Ctrl+Alt+Left moves helpers.py to the left group (main.py stays on the right)
  const names = (sel) => [...document.querySelectorAll(sel + ' .editor-tab__name')].map((e) => e.textContent);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', ctrlKey: true, altKey: true, bubbles: true }));
  await sleep(300);
  info.groupsAfterMove = { left: names('#editor-tabs'), right: names('#editor-tabs-2') };
  checks.groupsMoveBack = info.groupsAfterMove.left.includes('helpers.py') && !info.groupsAfterMove.right.includes('helpers.py');
  // Closing the right group keeps its files open on the left
  document.getElementById('group-2-close').click();
  await sleep(300);
  checks.groupsClose = document.getElementById('group-2').classList.contains('hidden')
    && names('#editor-tabs').includes('helpers.py') && names('#editor-tabs').some((n) => n.startsWith('main.py'));

  console.log('STEP section notebooks ' + Math.round(performance.now() / 1000) + 's');
  // Notebooks (Phase 8): .ipynb opens as a notebook, cells run in a kernel, Save writes .ipynb
  row('analysis.ipynb')?.click();
  for (let i = 0; i < 30 && !document.querySelector('#monaco-container .nb'); i++) await sleep(100);
  const nbEl = document.querySelector('#monaco-container .nb');
  info.nbCells = nbEl ? nbEl.querySelectorAll('.nb-cell').length : 0;
  checks.notebookOpens = !!nbEl && info.nbCells === 3 && !!nbEl.querySelector('.nb-cell--rendered h1');
  nbEl?.querySelector('.nb-btn--primary')?.click(); // Run all
  const nbCounts = () => [...(nbEl?.querySelectorAll('.nb-cell--code .nb-cell__count') || [])].map((e) => e.textContent);
  for (let i = 0; i < 200 && nbCounts().join() !== '[1],[2]'; i++) await sleep(100);
  info.nbCounts = nbCounts();
  info.nbOut = [...(nbEl?.querySelectorAll('.nb-cell__outputs') || [])].map((e) => e.textContent.trim()).filter(Boolean);
  checks.notebookRuns = info.nbCounts.join() === '[1],[2]' && info.nbOut.some((t) => t.includes('NB_OK 42')) && info.nbOut.includes('43');
  // An error shows under its cell
  const nbView = window.__thetaTest.notebook();
  if (nbView) {
    const errCell = nbView.insertAt(nbView.nb.cells.length, 'code', false);
    nbView.cellViews.get(errCell.id).editor.dispatch({ changes: { from: 0, insert: '1/0' } });
    nbView.runCell(errCell.id);
  }
  for (let i = 0; i < 50 && !nbEl?.querySelector('.nb-out--error'); i++) await sleep(100);
  info.nbError = nbEl?.querySelector('.nb-out--error .nb-out__ename')?.textContent;
  checks.notebookError = /^ZeroDivisionError/.test(info.nbError || '');
  checks.notebookUnsaved = !!document.querySelector('.editor-tab.active .editor-tab__dot.unsaved');
  // Ctrl+S writes standard .ipynb with the outputs
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
  for (let i = 0; i < 30 && document.querySelector('.editor-tab.active .editor-tab__dot.unsaved'); i++) await sleep(100);
  const nbSaved = await window.electronAPI.wsRead(row('analysis.ipynb')?.dataset.path || '');
  let savedNb = null;
  try { savedNb = JSON.parse(nbSaved.value); } catch (_) { savedNb = null; }
  info.nbSaved = savedNb ? savedNb.cells.map((c) => c.cell_type + ':' + (c.outputs || []).map((o) => o.output_type).join('+')) : String(nbSaved?.error);
  checks.notebookSaves = !!savedNb && savedNb.nbformat === 4 && savedNb.cells.length === 4
    && savedNb.cells[1].outputs.some((o) => o.output_type === 'stream' && o.text.join('').includes('NB_OK 42'))
    && savedNb.cells[3].outputs[0]?.ename === 'ZeroDivisionError';
  // Closing the tab removes the notebook (and stops its kernel)
  document.querySelector('.editor-tab.active .editor-tab__close')?.click();
  await sleep(250);
  checks.notebookCloses = !document.querySelector('.nb');

  console.log('STEP section tests ' + Math.round(performance.now() / 1000) + 's');
  // Tests and tasks (Phase 11): the built-in Python has no pytest, so the view offers to install it
  window.__thetaTest.action('show-tests');
  for (let i = 0; i < 80 && !document.querySelector('#tests-view .tv-empty, #tests-view .tv-row'); i++) await sleep(100);
  info.testsView = (document.getElementById('tests-view')?.textContent || '').slice(0, 120);
  checks.testsView = /pytest is not installed|No tests found|passed/.test(info.testsView);
  const toolPaths = await window.electronAPI.toolPaths();
  checks.taskTools = !!toolPaths.ruff && !!toolPaths.shell;
  document.getElementById('view-files').click();

  // Real system terminal
  document.getElementById('tab-shell').click();
  for (let i = 0; i < 60 && !/PS |\\$ |> /.test(window.__thetaTest?.shellText() || ''); i++) await sleep(100);
  info.shellTail = (window.__thetaTest?.shellText() || '').trim().slice(-60);
  checks.shellStarts = /PS |\\$ |> /.test(window.__thetaTest?.shellText() || '');
  document.getElementById('tab-terminal').click();

  console.log('STEP section p4 ' + Math.round(performance.now() / 1000) + 's');
  info.pickerTrail = (info.pickerTrail || '') + 'p4:' + (document.getElementById('theme-picker').classList.contains('hidden') ? 'H ' : 'V ');
  // Language intelligence (Phase 4), on main.py of the sample project
  const t4 = window.__thetaTest;
  // The project's file (its tab title is the path), not the untitled starter tab of the same name
  const clickTab = async (name) => {
    // Two tabs with one name are labelled "main.py · folder"
    const label = (t) => t.querySelector('.editor-tab__name')?.textContent || '';
    const all = [...document.querySelectorAll('.editor-tab')].filter((t) => label(t) === name || label(t).startsWith(name + ' · '));
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
  console.log('STEP section p5 ' + Math.round(performance.now() / 1000) + 's');
  info.pickerTrail = (info.pickerTrail || '') + 'p5:' + (document.getElementById('theme-picker').classList.contains('hidden') ? 'H ' : 'V ');
  // Debugger (Phase 5): an unsaved tab with input(), a breakpoint, stepping, evaluate
  const ds = () => t4.debugState();
  await window.__newPyTab();
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

  console.log('STEP git start');
  // Git (Phase 7): initialize the sample project, commit (asking for name and email once), diff, branch
  document.getElementById('view-git').click();
  for (let i = 0; i < 40 && !/Not a Git repository/.test(document.getElementById('git-state')?.textContent || ''); i++) await sleep(100);
  checks.gitNotRepoState = /Not a Git repository/.test(document.getElementById('git-state').textContent);
  document.querySelector('#git-state .git-primary')?.click();
  for (let i = 0; i < 60 && !document.querySelector('#git-lists .git-file'); i++) await sleep(100);
  info.gitChanges = [...document.querySelectorAll('#git-lists .git-file__name')].map((e) => e.textContent);
  checks.gitInitShowsChanges = info.gitChanges.includes('main.py') && info.gitChanges.includes('helpers.py');
  const fillBox = async (value) => {
    for (let i = 0; i < 40 && !document.querySelector('.quick-pick .cmd-input'); i++) await sleep(100);
    const box = document.querySelector('.quick-pick .cmd-input');
    if (!box) return false;
    box.value = value;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await sleep(150);
    return true;
  };
  console.log('STEP git commit');
  document.getElementById('git-message').value = 'First version';
  document.getElementById('git-commit').click();
  info.gitIdentityAsked = await fillBox('Smoke Test');
  if (info.gitIdentityAsked) await fillBox('smoke@example.com');
  // Done when the list says everything is committed (slow machines: up to 20 s)
  for (let i = 0; i < 200 && !document.querySelector('#git-lists .git-clean'); i++) await sleep(100);
  console.log('STEP git history');
  document.getElementById('git-history-toggle').click();
  for (let i = 0; i < 40 && !document.querySelector('#git-history-list .git-commit-row'); i++) await sleep(100);
  info.gitHistory = [...document.querySelectorAll('#git-history-list .git-commit-row__subject')].map((e) => e.textContent);
  checks.gitCommit = info.gitHistory[0] === 'First version';
  console.log('STEP git gutter');
  // main.py has unsaved edits from the checks above: the gutter marks them, the diff shows them after saving
  await clickTab('main.py');
  for (let i = 0; i < 40 && !document.querySelector('.cm-git-mark'); i++) await sleep(100);
  checks.gitGutterMarks = !!document.querySelector('.cm-git-mark--modified, .cm-git-mark--added, .cm-git-mark--deleted');
  console.log('STEP git save');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
  for (let i = 0; i < 60 && !document.querySelector('#git-lists .git-file'); i++) await sleep(100);
  [...document.querySelectorAll('#git-lists .git-file__open')].find((b) => b.textContent.startsWith('main.py'))?.click();
  for (let i = 0; i < 40 && !document.querySelector('#diff-body .cm-mergeView'); i++) await sleep(100);
  checks.gitDiffView = !!document.querySelector('#diff-body .cm-mergeView') && !document.getElementById('diff-view').classList.contains('hidden');
  console.log('STEP git diff close');
  document.getElementById('diff-close').click();
  await sleep(150);
  document.getElementById('git-branch').click();
  for (let i = 0; i < 30 && !document.querySelector('.quick-pick .qp-item'); i++) await sleep(100);
  document.querySelector('.quick-pick .qp-item')?.click(); // "+ Create a new branch…"
  await fillBox('feature-x');
  for (let i = 0; i < 40 && document.getElementById('git-branch-name').textContent !== 'feature-x'; i++) await sleep(100);
  console.log('STEP git branch done');
  checks.gitNewBranch = document.getElementById('git-branch-name').textContent === 'feature-x';
  document.getElementById('view-files').click();

  window.confirm = () => true; // closing the sample project discards these edits

  console.log('STEP section close ' + Math.round(performance.now() / 1000) + 's');
  info.pickerTrail = (info.pickerTrail || '') + 'close:' + (document.getElementById('theme-picker').classList.contains('hidden') ? 'H ' : 'V ');
  // Close folder: the tree empties and the project's tabs close
  document.getElementById('ws-close').click();
  await sleep(400);
  checks.closeFolder = !document.querySelector('#ws-tree .ws-row')
    && !document.getElementById('ws-empty').classList.contains('hidden')
    && ![...document.querySelectorAll('.editor-tab')].some((t) => (t.textContent || '').includes('main.py') && t.title.includes('theta-smoke-project'));

  console.log('STEP section themes ' + Math.round(performance.now() / 1000) + 's');
  info.pickerTrail = (info.pickerTrail || '') + 'themes:' + (document.getElementById('theme-picker').classList.contains('hidden') ? 'H ' : 'V ');
  console.log('STEP themes');
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
  checks.proEditorColours = info.proEditorBg === 'rgb(27, 29, 34)';
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

/** Title and file types for Save As, from the suggested name. */
function saveDialogKind(name = '') {
  const all = { name: 'All Files', extensions: ['*'] };
  if (/\.ipynb$/i.test(name)) return { title: 'Save Notebook', filters: [{ name: 'Jupyter Notebooks', extensions: ['ipynb'] }, all] };
  if (/\.html?$/i.test(name)) return { title: 'Save Report', filters: [{ name: 'Web Page', extensions: ['html'] }, all] };
  return { title: 'Save Python File', filters: [{ name: 'Python Files', extensions: ['py'] }, all] };
}

// Open file dialog → returns { filePath, content, fileName } or null
ipcMain.handle('file-open', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Python File',
    filters: [
      { name: 'Python Files', extensions: ['py', 'pyw', 'ipynb'] },
      { name: 'Jupyter Notebooks', extensions: ['ipynb'] },
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
    ...saveDialogKind(defaultName),
    defaultPath: defaultName || 'main.py',
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

/** Send an event to the window (if it is still open). */
const toWindow = (channel, ...args) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args);
};

/** The internet relay to use: the one set in Settings, else THETA_RELAY_URL, else none. */
const relayUrlFor = (fromSettings) => {
  const url = typeof fromSettings === 'string' && fromSettings.trim() ? fromSettings.trim() : process.env.THETA_RELAY_URL || '';
  return validRelayUrl(url) ? url : '';
};

ipcMain.handle('classroom-start-server', async (_, teacherName, opts = {}) => {
  classroomServer.onStudentJoin = (info) => { toWindow('classroom-student-joined', info); sendCaps(info.id); };
  classroomServer.onStudentLeave = (info) => { toWindow('classroom-student-left', info); gpuPool?.studentLeft(info.id); };
  classroomServer.onStudentStatus = (info) => toWindow('classroom-student-status', info);
  classroomServer.onRelayStatus = (info) => toWindow('classroom-relay-status', info);
  classroomServer.onHelpRequest = (info) => toWindow('classroom-help-request', info);
  classroomServer.onStudentCode = (info) => toWindow('classroom-student-code', info);
  classroomServer.onStudentCodeLive = (info) => toWindow('classroom-student-code-live', info);
  classroomServer.onStudentOutputLive = (info) => toWindow('classroom-student-output-live', info);
  classroomServer.onEditGrant = (info) => toWindow('classroom-edit-grant', info);
  classroomServer.onEditRevoke = (info) => toWindow('classroom-edit-revoke', info);
  classroomServer.onChatMessage = (info) => toWindow('classroom-chat-message-received', info);
  classroomServer.onStudentEvent = (who, msg) => {
    // GPU jobs are handled here (they run in this process); the rest is for the window
    if (msg.type === 'gpu-job') { gpuPool?.submit(who, msg); return; }
    if (msg.type === 'gpu-cancel') { gpuPool?.cancelFromStudent(who.id, String(msg.jobId || '')); return; }
    toWindow('classroom-student-event', who, msg);
  };
  const result = await classroomServer.start(teacherName, { relayUrl: relayUrlFor(opts?.relayUrl) });
  // Share the class package folder on this network
  if (result.success && result.lan) {
    try { await packageCache?.serve(); } catch (err) { console.error('[CLASSROOM] package server:', err.message); }
  }
  return result;
});

/** Tell students what this class shares: packages (local network) and the GPU. */
function sendCaps(target = '*') {
  if (!classroomServer.running) return;
  const files = packageCache?.port ? packageCache.list().length : 0;
  classroomServer.sendEvent(target, {
    type: 'class-caps',
    packages: packageCache?.port && files ? { port: packageCache.port } : null,
    gpu: gpuPool?.caps() || null,
  }, 'caps');
}

// ── Class packages (teacher) ──
ipcMain.handle('class-packages-summary', () => packageCache?.summary() || null);
ipcMain.handle('class-packages-prepare', async (_e, specs) => {
  if (!packageCache || !Array.isArray(specs) || specs.length > 50) throw new Error('Invalid package list.');
  const code = await packageCache.prepare(specs.map(String), (t) => toWindow('class-packages-log', t));
  sendCaps();
  return { code, summary: packageCache.summary() };
});
ipcMain.handle('class-packages-clear', () => { packageCache?.clear(); sendCaps(); return packageCache?.summary() || null; });

// ── Class GPU pool (teacher) ──
ipcMain.handle('gpu-share', async (_e, on, opts = {}) => {
  const caps = await gpuPool?.setSharing(!!on, {
    autoAccept: typeof opts?.autoAccept === 'boolean' ? opts.autoAccept : undefined,
    limitMin: Number.isInteger(opts?.limitMin) ? opts.limitMin : undefined,
  });
  sendCaps();
  return { caps, state: gpuPool?.state() };
});
ipcMain.handle('gpu-state', () => gpuPool?.state() || null);
ipcMain.on('gpu-accept', (_e, id) => { if (typeof id === 'string') gpuPool?.accept(id); });
ipcMain.on('gpu-decline', (_e, id) => { if (typeof id === 'string') gpuPool?.decline(id); });
ipcMain.on('gpu-stop', (_e, id) => { if (typeof id === 'string') gpuPool?.stop(id); });

ipcMain.handle('classroom-status', () => (classroomServer.running ? classroomServer.getStatus() : classroomDiscovery.getStatus()));

/** Teacher → one student or everyone ('*'): pulse, help routing, predictions … */
ipcMain.on('classroom-send-event', (_, target, msg, key) => {
  if (!classroomServer.running || !msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
  if (typeof target !== 'string' || (key !== undefined && typeof key !== 'string')) return;
  classroomServer.sendEvent(target, msg, key);
});

ipcMain.handle('classroom-stop-server', () => {
  gpuPool?.dispose();
  packageCache?.stop();
  testRunner?.stop();
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

ipcMain.on('classroom-start-discovery', (_, name, roll, opts = {}) => {
  const d = classroomDiscovery;
  d.onTeacherFound = (info) => toWindow('classroom-teacher-found', info);
  d.onConnected = (info) => toWindow('classroom-connected', info);
  d.onDisconnected = () => toWindow('classroom-disconnected');
  d.onLinkStatus = (info) => toWindow('classroom-link-status', info);
  d.onJoinError = (message) => toWindow('classroom-join-error', message);
  d.onCodeSync = (data) => toWindow('classroom-code-sync', data);
  d.onCodeChange = (data) => toWindow('classroom-code-change', data);
  d.onTerminal = (data) => toWindow('classroom-terminal', data);
  d.onCursor = (data) => toWindow('classroom-cursor', data);
  d.onSelection = (data) => toWindow('classroom-selection', data);
  d.onViewRequest = () => toWindow('classroom-view-request');
  d.onEditRequest = () => toWindow('classroom-edit-request');
  d.onEditCode = (data) => toWindow('classroom-edit-code', data);
  d.onEditLive = (data) => toWindow('classroom-edit-live', data);
  d.onSessionEnd = () => toWindow('classroom-session-end');
  d.onChatMessage = (data) => toWindow('classroom-chat-message-received', data);
  d.onClassEvent = (msg) => toWindow('classroom-class-event', msg);
  // "K7M-4QX @ theta172-relay.school.workers.dev": the invite carries the school's relay
  const invite = parseInvite(opts?.code);
  const relayUrl = invite ? invite.relayUrl : relayUrlFor(opts?.relayUrl);
  const code = invite ? invite.code : opts?.code;
  d.startDiscovery(name, roll, { code, relayUrl });
  // A bare code needs the school's relay; without one only this network is searched
  if (code && !relayUrl) {
    toWindow('classroom-join-error', 'To join from another network, paste the whole invite your teacher shared (it looks like K7M-4QX @ something). With only the code, the class is found on the teacher\'s Wi-Fi.');
  }
});

/** Student: what the teacher shares (packages mirror, GPU). */
ipcMain.handle('classroom-caps', () => ({ ...(classroomDiscovery.caps || {}), mirror: classroomDiscovery.getPackageMirror() }));

/** Student → teacher: run results, predictions, mastery … (`key` = latest wins) */
ipcMain.on('classroom-student-send-event', (_, msg, key) => {
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
  if (key !== undefined && typeof key !== 'string') return;
  classroomDiscovery.sendEvent(msg, key);
});

ipcMain.on('classroom-stop-discovery', () => {
  classroomDiscovery.stopDiscovery();
});

ipcMain.on('classroom-send-help', (_, message, error) => {
  classroomDiscovery.sendHelpRequest(message, error && typeof error === 'object' ? error : null);
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
  // The owner's gate: before anything, decide whether this copy may open
  gate = createGate({ app, userData: app.getPath('userData') });
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
  packageCache = new PackageCache({
    dir: path.join(app.getPath('userData'), 'class-packages'),
    spawn,
    getPython: () => tools.python || pythonIpc?.active?.path || null, // the bundled Python has pip
  });
  gpuPool = new GpuPool({
    spawn, execFile,
    getPython: () => pythonIpc?.active?.path || null,
    getEnv: (base) => pythonIpc?.shellEnv(base) ?? base,
    sendTo: (studentId, msg) => classroomServer.sendEvent(studentId, msg),
    onState: (state) => toWindow('gpu-state-changed', state),
  });
  testRunner = new TestRunner({
    spawn,
    getPython: () => pythonIpc?.active?.path || null,
    getEnv: (base) => pythonIpc?.shellEnv(base) ?? base,
    getRoot: () => workspaceIpc?.workspace.root || null,
    onEvent: (ev) => toWindow('test-event', ev),
  });
  registerTestIpc({ ipcMain, runner: testRunner });
  // Plugins: the store lives here; their code runs in isolated workers in the window
  registerPluginIpc({ ipcMain, dialog, shell, getWindow: () => mainWindow, userData: app.getPath('userData') });
  // Classroom: set up the school's own relay (Cloudflare, Docker, or this computer)
  relaySetup = registerRelaySetupIpc({ ipcMain, shell, safeStorage, userData: app.getPath('userData'), toWindow });
  // Tasks call the bundled tools by path; the Shell is PowerShell on Windows
  ipcMain.handle('tool-paths', () => ({
    python: pythonIpc?.active?.path || null, ruff: tools.ruff || null, uv: tools.uv || null,
    shell: process.platform === 'win32' ? 'powershell' : 'posix',
  }));
  // Students in a class that shares packages install from the teacher first
  pythonIpc.envs.getMirror = () => classroomDiscovery.getPackageMirror();
  notebookIpc = registerNotebookIpc({
    ipcMain, spawn,
    getWindow: () => mainWindow,
    getPython: () => pythonIpc?.active?.path || null,
    getEnv: () => pythonIpc.shellEnv(process.env),
    getWorkspace: () => workspaceIpc?.workspace || null,
    tmpDir: os.tmpdir(),
  });
  studyWindow = registerStudyWindow({ ipcMain, screen, getWindow: () => mainWindow });
  registerGitIpc({ ipcMain, execFile, shell, getRoot: () => workspaceIpc?.workspace.root || null });
  Menu.setApplicationMenu(null);
  createWindow();
  // Updates: checked and downloaded in the background; the window asks when it is a good moment
  registerUpdater({ ipcMain, app, getWindow: () => mainWindow, userData: app.getPath('userData') });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  relaySetup?.dispose();
  workspaceIpc?.dispose();
  lspIpc?.dispose();
  debugIpc?.dispose();
  notebookIpc?.dispose();
  gpuPool?.dispose();
  packageCache?.stop();
  pythonRunner.dispose();
  if (replProcess) { try { replProcess.kill('SIGTERM'); } catch (_) {} }
  classroomServer.stop();
  classroomDiscovery.stopDiscovery();
  if (!isDev) app.releaseSingleInstanceLock();
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception in main process:', err);
});
