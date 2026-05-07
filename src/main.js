/**
 * THETA. — Main Application
 * Orchestrates everything: landing, IDE, editor, terminal, worker,
 * toasts, ripple, command palette, auto-save, live stats, theme toggle.
 */

import { createEditor, STARTER_CODE, toggleEditorTheme, getEditorTheme,
         getValue, setValue, focusEditor, setFontSize, getCursorPosition,
         getLineCount, getCharCount, layout as editorLayout,
         onContentChange, onCursorChange,
         highlightErrorLine, clearErrorHighlights, gotoLine,
         getEditorState, setEditorState } from './editor.js';
import { TerminalManager } from './terminal.js';
import { WorkerManager } from './worker-manager.js';
import { EXAMPLES } from './examples.js';
import { showToast } from './toast.js';
import { addRipple } from './ripple.js';
import { initSmoothEngine } from './smooth.js';
import gsap from 'gsap';

// ── DOM ────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

const $landing         = $('landing');
const $ide             = $('ide');
const $launchMain      = $('launch-ide-main');
const $launchNav       = $('launch-ide-nav');
const $backBtn         = $('back-to-landing');
const $runBtn          = $('btn-run');
const $runBtnText      = $('run-btn-text');
const $runIconPlay     = document.querySelector('.run-icon-play');
const $runIconStop     = document.querySelector('.run-icon-stop');
const $clearBtn        = $('btn-clear');
const $copyBtn         = $('btn-copy-code');
const $fontIncBtn      = $('btn-font-inc');
const $fontDecBtn      = $('btn-font-dec');
const $examplesBtn     = $('btn-examples');
const $shortcutsBtn    = $('btn-shortcuts');
const $paletteBtn      = $('btn-palette');
const $examplesModal   = $('examples-modal');
const $shortcutsModal  = $('shortcuts-modal');
const $cmdPalette      = $('cmd-palette');
const $cmdInput        = $('cmd-input');
const $cmdResults      = $('cmd-results');
const $closeExamples   = $('close-examples');
const $closeShortcuts  = $('close-shortcuts');
const $examplesList    = $('examples-list');
const $loadingOverlay  = $('loading-overlay');
const $monacoContainer = $('monaco-container');
const $termContainer   = $('terminal-container');
const $runStatus       = $('run-status');
const $runStatusText   = $('run-status-text');
const $pyodideStatus   = $('pyodide-status');
const $execTime        = $('exec-time');
const $gutter          = $('split-gutter');
const $editorPane      = $('editor-pane');
const $saveDot         = $('save-dot');
const $cursorPos       = $('cursor-pos');
const $lineCount       = $('line-count');
const $charCount       = $('char-count');
const $progressBar     = $('run-progress-bar');
const $lstep0          = $('lstep-0');
const $lstep1          = $('lstep-1');
const $lstep2          = $('lstep-2');
const $lstep3          = $('lstep-3');
const $lstep4          = $('lstep-4');
const $themeBtn        = $('btn-theme');
const $themeLabel      = $('theme-label');
const $themeIcon       = $('theme-icon');
const $statusTheme     = $('status-theme');
const $statusThemeText = $('status-theme-text');
const $particles       = $('landing-particles');
const $pipInput        = $('pip-input');
const $pipBtn          = $('pip-install-btn');
const $pipStatus       = $('pip-status');

// ── State ──────────────────────────────────────────────────────
let editor        = null;
let terminal      = null;
let workerManager = null;
let ideInitialized = false;
let fontSize      = 15;
let isRunning     = false;
let saveTimer     = null;
let execTimer     = null;
let execStart     = 0;
let useLocalPython = false;
let localPythonInfo = null;

// ── Tab System ─────────────────────────────────────────────────
let tabs = [];
let activeTabId = null;
let tabCounter = 0;

function createTabData(name = 'untitled.py', code = '', filePath = null) {
  const id = `tab-${tabCounter++}`;
  return { id, name, code, filePath, unsaved: false };
}

function renderTabs() {
  const $tabBar = document.getElementById('editor-tabs');
  if (!$tabBar) return;

  // Remove all tabs except the + button
  $tabBar.querySelectorAll('.editor-tab').forEach(el => el.remove());

  const $addBtn = $tabBar.querySelector('.editor-tab-add');

  tabs.forEach(tab => {
    const el = document.createElement('div');
    el.className = 'editor-tab' + (tab.id === activeTabId ? ' active' : '');
    el.dataset.tabId = tab.id;

    const nameSpan = document.createElement('span');
    nameSpan.className = 'editor-tab__name';
    nameSpan.textContent = tab.name;

    const dot = document.createElement('span');
    dot.className = 'editor-tab__dot' + (tab.unsaved ? ' unsaved' : '');

    el.appendChild(nameSpan);
    el.appendChild(dot);

    // Close button (only if more than 1 tab)
    if (tabs.length > 1) {
      const close = document.createElement('span');
      close.className = 'editor-tab__close';
      close.innerHTML = '×';
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        closeTab(tab.id);
      });
      el.appendChild(close);
    }

    el.addEventListener('click', () => switchTab(tab.id));
    $tabBar.insertBefore(el, $addBtn);
  });
}

function switchTab(tabId) {
  if (tabId === activeTabId) return;

  // Save current tab's full editor state (preserves undo history)
  const currentTab = tabs.find(t => t.id === activeTabId);
  if (currentTab && editor) {
    currentTab.code = getValue();
    currentTab.editorState = getEditorState();
  }

  // Switch
  activeTabId = tabId;
  const newTab = tabs.find(t => t.id === tabId);
  if (newTab) {
    if (newTab.editorState) {
      setEditorState(newTab.editorState); // Restore with undo history
    } else {
      setValue(newTab.code);
    }
    setFileName(newTab.name);
    currentFilePath = newTab.filePath;
  }

  renderTabs();
  focusEditor();
}

function addNewTab(name = null, code = '', filePath = null) {
  // Save current tab state
  const currentTab = tabs.find(t => t.id === activeTabId);
  if (currentTab && editor) {
    currentTab.code = getValue();
    currentTab.editorState = getEditorState();
  }

  const tabName = name || `untitled-${tabs.length + 1}.py`;
  const tab = createTabData(tabName, code, filePath);
  tabs.push(tab);
  activeTabId = tab.id;

  setValue(code);
  setFileName(tabName);
  currentFilePath = filePath;
  renderTabs();
  focusEditor();
  return tab;
}

function closeTab(tabId) {
  if (tabs.length <= 1) return;

  const idx = tabs.findIndex(t => t.id === tabId);
  if (idx === -1) return;

  tabs.splice(idx, 1);

  if (activeTabId === tabId) {
    const newIdx = Math.min(idx, tabs.length - 1);
    activeTabId = tabs[newIdx].id;
    const newTab = tabs[newIdx];
    if (newTab.editorState) {
      setEditorState(newTab.editorState);
    } else {
      setValue(newTab.code);
    }
    setFileName(newTab.name);
    currentFilePath = newTab.filePath;
  }

  renderTabs();
}

function markActiveTabUnsaved() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab) tab.unsaved = true;
  renderTabs();
}

function markActiveTabSaved() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab) tab.unsaved = false;
  renderTabs();
}

// ── Default Shortcut Bindings ──────────────────────────────────
const DEFAULT_SHORTCUTS = {
  'run':            { ctrl: true, shift: false, alt: false, key: 'Enter' },
  'stop':           { ctrl: true, shift: false, alt: false, key: 'c' },
  'clear':          { ctrl: true, shift: false, alt: false, key: 'l' },
  'copy':           { ctrl: true, shift: true,  alt: false, key: 'c' },
  'save':           { ctrl: true, shift: false, alt: false, key: 's' },
  'focus-editor':   { ctrl: true, shift: false, alt: false, key: '1' },
  'focus-terminal': { ctrl: true, shift: false, alt: false, key: '2' },
  'toggle-theme':   { ctrl: true, shift: false, alt: false, key: 't' },
  'cmd-palette':    { ctrl: true, shift: true,  alt: false, key: 'p' },
};

// Load saved shortcuts or use defaults
function loadShortcuts() {
  try {
    const saved = localStorage.getItem('theta-shortcuts');
    if (saved) return JSON.parse(saved);
  } catch (_) {}
  return JSON.parse(JSON.stringify(DEFAULT_SHORTCUTS));
}

function saveShortcuts() {
  localStorage.setItem('theta-shortcuts', JSON.stringify(shortcutBindings));
}

let shortcutBindings = loadShortcuts();

function bindingToString(b) {
  if (!b) return '';
  const parts = [];
  if (b.ctrl) parts.push('Ctrl');
  if (b.shift) parts.push('Shift');
  if (b.alt) parts.push('Alt');
  let keyLabel = b.key;
  if (keyLabel === ' ') keyLabel = 'Space';
  else if (keyLabel === 'Enter') keyLabel = 'Enter';
  else if (keyLabel === 'Escape') keyLabel = 'Esc';
  else if (keyLabel === 'ArrowUp') keyLabel = '↑';
  else if (keyLabel === 'ArrowDown') keyLabel = '↓';
  else if (keyLabel === 'ArrowLeft') keyLabel = '←';
  else if (keyLabel === 'ArrowRight') keyLabel = '→';
  else if (keyLabel.length === 1) keyLabel = keyLabel.toUpperCase();
  parts.push(keyLabel);
  return parts.join('+');
}

function eventMatchesBinding(e, binding) {
  if (!binding) return false;
  // On macOS, Cmd (metaKey) maps to Ctrl shortcuts
  const ctrlOrCmd = e.ctrlKey || e.metaKey;
  return (
    ctrlOrCmd === binding.ctrl &&
    e.shiftKey === binding.shift &&
    e.altKey === binding.alt &&
    e.key.toLowerCase() === binding.key.toLowerCase()
  );
}

// ── Command Registry ───────────────────────────────────────────
const COMMANDS = [
  {
    id: 'run',
    name: 'Run Code',
    get key() { return bindingToString(shortcutBindings['run']); },
    icon: `<path d="M4 2.5L12 7L4 11.5V2.5Z" fill="currentColor"/>`,
    action: () => runCode(),
  },
  {
    id: 'stop',
    name: 'Stop Execution',
    get key() { return bindingToString(shortcutBindings['stop']); },
    icon: `<rect x="3" y="3" width="8" height="8" fill="currentColor"/>`,
    action: () => { stopCode(); },
  },
  {
    id: 'clear',
    name: 'Clear Terminal',
    get key() { return bindingToString(shortcutBindings['clear']); },
    icon: `<path d="M3 12L12 3M3 3L12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
    action: () => terminal?.clear(),
  },
  {
    id: 'copy',
    name: 'Copy Code',
    get key() { return bindingToString(shortcutBindings['copy']); },
    icon: `<rect x="3.5" y="3.5" width="7" height="7" stroke="currentColor" stroke-width="1.2"/><path d="M3.5 3.5V2A1 1 0 012 1H1V8A1 1 0 002 9H3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>`,
    action: copyCode,
  },
  {
    id: 'save',
    name: 'Save File',
    get key() { return bindingToString(shortcutBindings['save']); },
    icon: `<path d="M2 3H9L12 6V13H2V3Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><rect x="4" y="8" width="6" height="5" stroke="currentColor" stroke-width="1.1"/>`,
    action: () => { saveCode(); saveToFile(); },
  },
  {
    id: 'save-as',
    name: 'Save As...',
    key: 'Ctrl+Shift+S',
    icon: `<path d="M2 3H9L12 6V13H2V3Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M7 1V5M5 3H9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>`,
    action: () => saveAsFile(),
  },
  {
    id: 'open-file',
    name: 'Open File...',
    key: 'Ctrl+O',
    icon: `<path d="M2 4H5L7 2H12V12H2V4Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>`,
    action: () => openFile(),
  },
  {
    id: 'examples',
    name: 'Browse Examples',
    key: '',
    icon: `<rect x="2" y="2" width="10" height="10" stroke="currentColor" stroke-width="1.2"/><path d="M5 5H9M5 7H7M5 9H8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>`,
    action: () => $examplesModal?.classList.remove('hidden'),
  },
  {
    id: 'focus-editor',
    name: 'Focus Editor',
    get key() { return bindingToString(shortcutBindings['focus-editor']); },
    icon: `<path d="M2.5 4L5.5 7L2.5 10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 10H10.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>`,
    action: () => focusEditor(),
  },
  {
    id: 'focus-terminal',
    name: 'Focus Terminal',
    get key() { return bindingToString(shortcutBindings['focus-terminal']); },
    icon: `<rect x="1" y="1" width="12" height="12" stroke="currentColor" stroke-width="1.2"/><path d="M3.5 4.5L6 7L3.5 9.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>`,
    action: () => terminal?.focus(),
  },
  {
    id: 'font-inc',
    name: 'Increase Font Size',
    key: '',
    icon: `<path d="M3 2.5H8M5.5 2.5V7.5M3 10H8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>`,
    action: () => { fontSize = Math.min(fontSize + 1, 24); setFontSize(fontSize); showToast(`Font size: ${fontSize}px`, 'info', 1400); },
  },
  {
    id: 'font-dec',
    name: 'Decrease Font Size',
    key: '',
    icon: `<path d="M3 5H8M3 9H8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>`,
    action: () => { fontSize = Math.max(fontSize - 1, 10); setFontSize(fontSize); showToast(`Font size: ${fontSize}px`, 'info', 1400); },
  },
  {
    id: 'reset-code',
    name: 'Reset to Starter Code',
    key: '',
    icon: `<path d="M2 7C2 4.2 4.2 2 7 2s5 2.2 5 5-2.2 5-5 5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M2 4V7H5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>`,
    action: () => { setValue(STARTER_CODE); showToast('Code reset to starter template', 'info'); },
  },
  {
    id: 'toggle-theme',
    name: 'Toggle Editor Theme',
    get key() { return bindingToString(shortcutBindings['toggle-theme']); },
    icon: `<circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.2"/><path d="M7 2A5 5 0 017 12V2Z" fill="currentColor"/>`,
    action: handleThemeToggle,
  },
  {
    id: 'cmd-palette',
    name: 'Command Palette',
    get key() { return bindingToString(shortcutBindings['cmd-palette']); },
    icon: `<circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.2"/><path d="M10.5 10.5L13 13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>`,
    action: () => openCommandPalette(),
  },
  {
    id: 'home',
    name: 'Go to Home / Landing',
    key: '',
    icon: `<path d="M2 7L7 2L12 7V13H8.5V9.5H5.5V13H2V7Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>`,
    action: goToLanding,
  },
];

// ── Landing (GSAP-powered transitions) ────────────────────────
function launchIDE() {
  const tl = gsap.timeline();
  tl.to($landing, {
    opacity: 0, scale: 0.985, y: -12,
    duration: 0.35, ease: 'power2.in',
    onComplete: () => {
      $landing.classList.add('hidden');
      gsap.set($landing, { clearProps: 'all' });
      $ide.classList.remove('hidden');
      gsap.fromTo($ide,
        { opacity: 0, scale: 0.985, y: 14 },
        { opacity: 1, scale: 1, y: 0, duration: 0.45, ease: 'power3.out' }
      );
      if (!ideInitialized) {
        ideInitialized = true;
        initIDE();
      } else {
        terminal?.focus();
      }
    }
  });
}

function goToLanding() {
  const tl = gsap.timeline();
  tl.to($ide, {
    opacity: 0, scale: 0.985, y: -12,
    duration: 0.35, ease: 'power2.in',
    onComplete: () => {
      $ide.classList.add('hidden');
      gsap.set($ide, { clearProps: 'all' });
      $landing.classList.remove('hidden');
      gsap.fromTo($landing,
        { opacity: 0, scale: 0.985, y: 14 },
        { opacity: 1, scale: 1, y: 0, duration: 0.45, ease: 'power3.out' }
      );
    }
  });
}

$launchMain?.addEventListener('click', launchIDE);
$launchNav?.addEventListener('click', launchIDE);
$backBtn?.addEventListener('click', goToLanding);

// ── IDE Init ───────────────────────────────────────────────────
async function initIDE() {
  // Animate loading steps
  animateLoadingSteps();

  // Show editor loading step
  $lstep0?.classList.add('active');

  // Restore saved code
  const savedCode = localStorage.getItem('theta-code');

  // Init editor
  editor = await createEditor($monacoContainer);

  // Editor loaded
  $lstep0?.classList.replace('active', 'done');

  // Initialize tab system
  const initialCode = savedCode || STARTER_CODE;
  const initialTab = createTabData('main.py', initialCode, null);
  tabs.push(initialTab);
  activeTabId = initialTab.id;
  tabCounter = 1;

  if (savedCode) {
    setValue(savedCode);
    showToast('Code restored from last session', 'save', 2000);
  }

  renderTabs();

  // Wire the + tab button
  document.getElementById('btn-new-tab')?.addEventListener('click', () => {
    addNewTab(null, '# New file\n');
  });

  // Live cursor position
  const cursorPoll = setInterval(() => {
    const pos = getCursorPosition();
    if ($cursorPos) $cursorPos.textContent = `Ln ${pos.lineNumber}, Col ${pos.column}`;
  }, 200);

  // Live code stats + auto-save + tab unsaved indicator
  let lastDocLen = getCharCount();
  const docObserver = setInterval(() => {
    const newLen = getCharCount();
    if (newLen !== lastDocLen) {
      lastDocLen = newLen;
      updateCodeStats();
      markUnsaved();
      markActiveTabUnsaved();
      scheduleAutoSave();
    }
  }, 300);

  updateCodeStats();

  // Init terminal
  terminal = new TerminalManager($termContainer);
  terminal.init();

  terminal.onInputSubmit = (value) => {
    if (value === null) {
      workerManager?.kill();
      setRunState('idle');
      return;
    }
    workerManager?.provideInput(value);
  };

  // Init gutter
  initGutter();

  // Init examples
  initExamples();

  // Init buttons
  initButtons();

  // Init command palette
  initCommandPalette();

  // Init keyboard shortcuts
  initShortcuts();

  // Add ripple to all buttons
  setTimeout(() => {
    $$('button').forEach(addRipple);
  }, 100);

  // Init ultra-smooth 120fps interaction engine
  setTimeout(() => {
    initSmoothEngine();
  }, 200);

  // ── Drag-and-drop .py files onto editor ──
  const $dropTarget = $monacoContainer || document.querySelector('.ide-body');
  if ($dropTarget) {
    $dropTarget.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      $dropTarget.classList.add('drag-over');
    });
    $dropTarget.addEventListener('dragleave', () => {
      $dropTarget.classList.remove('drag-over');
    });
    $dropTarget.addEventListener('drop', (e) => {
      e.preventDefault();
      $dropTarget.classList.remove('drag-over');
      const file = e.dataTransfer.files?.[0];
      if (file && (file.name.endsWith('.py') || file.name.endsWith('.pyw') || file.name.endsWith('.txt'))) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          addNewTab(file.name, ev.target.result, null);
          showToast(`Dropped: ${file.name}`, 'success', 2000);
        };
        reader.readAsText(file);
      } else if (file) {
        showToast('Only .py, .pyw, and .txt files are supported', 'info', 2000);
      }
    });
  }

  // ── Detect local Python first, fallback to Pyodide ──
  if (window.electronAPI?.detectPython) {
    try {
      const result = await window.electronAPI.detectPython();
      if (result.found) {
        useLocalPython = true;
        localPythonInfo = result;
        if ($pyodideStatus) $pyodideStatus.textContent = 'Runtime ready (local)';
        const $pyVer = document.getElementById('python-version');
        const $rtType = document.getElementById('runtime-type');
        if ($pyVer) $pyVer.textContent = result.version.replace('Python ', '');
        if ($rtType) $rtType.textContent = 'Local · Native';
        if ($loadingOverlay) {
          $lstep4?.classList.add('active');
          setTimeout(() => {
            $loadingOverlay.classList.add('fade-out');
            setTimeout(() => $loadingOverlay.classList.add('hidden'), 420);
          }, 400);
        }
        setRunState('ready');
        showToast(`Local ${result.version} detected`, 'success', 2500);

        // Set up local Python event listeners
        setupLocalPythonListeners();
        terminal?.focus();
        return; // Skip Pyodide
      }
    } catch (_) {
      // Detection failed — fall through to Pyodide
    }
  }

  // Fallback: Start Pyodide worker
  initWorker();
}

// ── Local Python Event Listeners ──────────────────────────────
function setupLocalPythonListeners() {
  const api = window.electronAPI;

  api.onPythonStdout((data) => {
    terminal?.writeOutput(data);
    // Detect input() prompt — line doesn't end with \n
    if (data && !data.endsWith('\n')) {
      terminal?.enterInputMode('');
      terminal.onInputSubmit = (value) => {
        if (value === null) {
          api.killPython();
          setRunState('idle');
          isRunning = false;
          return;
        }
        api.sendPythonInput(value);
      };
    }
  });

  api.onPythonStderr((data) => {
    terminal?.writeError(data);
    // Parse Python traceback for line numbers
    const lineMatch = data.match(/line\s+(\d+)/i);
    if (lineMatch) {
      const lineNum = parseInt(lineMatch[1], 10);
      highlightErrorLine(lineNum);
    }
  });

  api.onPythonDone((exitCode) => {
    stopExecTimer();
    terminal?.exitInputMode();
    const durationMs = performance.now() - execStart;
    terminal?.writeDoneSeparator(durationMs);
    if ($execTime) {
      $execTime.textContent = (durationMs / 1000).toFixed(3) + 's';
      $execTime.classList.remove('running');
    }
    finishProgressBar(exitCode !== 0);
    setRunState(exitCode === 0 ? 'done' : 'error');
    isRunning = false;
    if (exitCode === 0) {
      showToast(`Done in ${(durationMs / 1000).toFixed(3)}s`, 'success', 2000);
    } else {
      showToast('Execution error', 'error', 2400);
    }
  });

  // Pip install via local pip
  api.onPipStdout((data) => {
    terminal?.writeSystem(data);
  });

  api.onPipDone((exitCode, pkg) => {
    if (exitCode === 0) {
      if ($pipStatus) {
        $pipStatus.textContent = `✓ ${pkg} installed`;
        $pipStatus.className = 'pip-bar__status success';
        setTimeout(() => { $pipStatus.textContent = ''; $pipStatus.className = 'pip-bar__status'; }, 4000);
      }
      showToast(`${pkg} installed`, 'success', 2500);
    } else {
      if ($pipStatus) {
        $pipStatus.textContent = `✗ Failed`;
        $pipStatus.className = 'pip-bar__status error';
        setTimeout(() => { $pipStatus.textContent = ''; $pipStatus.className = 'pip-bar__status'; }, 5000);
      }
      showToast(`Failed to install ${pkg}`, 'error', 3000);
    }
  });
}

// ── Code Stats ─────────────────────────────────────────────────
function updateCodeStats() {
  if (!editor) return;
  const lines = getLineCount();
  const chars = getCharCount();
  if ($lineCount) $lineCount.textContent = `${lines} ${lines === 1 ? 'line' : 'lines'}`;
  if ($charCount) $charCount.textContent = `${chars} ${chars === 1 ? 'char' : 'chars'}`;
}

// ── Auto-Save ──────────────────────────────────────────────────
function markUnsaved() {
  $saveDot?.classList.add('visible');
}

function scheduleAutoSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveCode, 1800);
}

function saveCode() {
  if (!editor) return;
  const code = getValue();
  localStorage.setItem('theta-code', code);
  $saveDot?.classList.remove('visible');
}

// ── Worker ─────────────────────────────────────────────────────
function initWorker() {
  workerManager = new WorkerManager();

  workerManager.onStatus = (text) => {
    if ($pyodideStatus) $pyodideStatus.textContent = text;
  };

  workerManager.onReady = () => {
    // Dismiss loading overlay
    $lstep4?.classList.add('active');
    setTimeout(() => {
      $loadingOverlay?.classList.add('fade-out');
      setTimeout(() => $loadingOverlay?.classList.add('hidden'), 420);
    }, 600);

    if ($pyodideStatus) $pyodideStatus.textContent = 'Runtime ready';
    // Update status bar for Pyodide runtime
    const $pyVer = document.getElementById('python-version');
    const $rtType = document.getElementById('runtime-type');
    if ($pyVer) $pyVer.textContent = '3.11';
    if ($rtType) $rtType.textContent = 'Pyodide · WASM';
    setRunState('ready');
    terminal?.focus();
  };

  workerManager.onStdout = (text) => terminal?.writeOutput(text);
  workerManager.onStderr = (text) => {
    terminal?.writeError(text);
    const lineMatch = text.match(/line\s+(\d+)/i);
    if (lineMatch) {
      const lineNum = parseInt(lineMatch[1], 10);
      highlightErrorLine(lineNum);
    }
  };

  workerManager.onInputRequest = (prompt) => terminal?.enterInputMode(prompt);

  workerManager.onDone = (durationMs) => {
    stopExecTimer();
    terminal?.exitInputMode();
    terminal?.writeDoneSeparator(durationMs);
    if ($execTime) {
      $execTime.textContent = (durationMs / 1000).toFixed(3) + 's';
      $execTime.classList.remove('running');
    }
    finishProgressBar();
    setRunState('done');
    isRunning = false;
    showToast(`Done in ${(durationMs / 1000).toFixed(3)}s`, 'success', 2000);
  };

  workerManager.onError = (message, durationMs) => {
    stopExecTimer();
    terminal?.exitInputMode();
    terminal?.writeError('\n' + message + '\n');
    if (durationMs !== undefined) {
      terminal?.writeDoneSeparator(durationMs);
      if ($execTime) {
        $execTime.textContent = (durationMs / 1000).toFixed(3) + 's';
        $execTime.classList.remove('running');
      }
    }
    finishProgressBar(true);
    setRunState('error');
    isRunning = false;
    showToast('Execution error', 'error', 2400);
  };

  workerManager.onInterrupted = () => {
    stopExecTimer();
    terminal?.exitInputMode();
    terminal?.writeInterrupted();
    finishProgressBar(true);
    setRunState('idle');
    isRunning = false;
    showToast('Execution stopped', 'info', 1600);
  };

  workerManager.init();

  // Timeout — if Pyodide doesn't load in 45s, show retry
  const loadTimeout = setTimeout(() => {
    if (!workerManager.isReady) {
      if ($pyodideStatus) $pyodideStatus.textContent = 'Load timed out';
      showToast('Python runtime is taking too long. Check your connection.', 'error', 5000);
      // Show a retry hint in loading overlay
      const retryHint = document.createElement('button');
      retryHint.textContent = 'Retry';
      retryHint.style.cssText = 'margin-top:16px;padding:8px 24px;background:#FF2D00;color:#fff;border:none;font-family:var(--font-ui);font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;cursor:pointer;';
      retryHint.onclick = () => {
        retryHint.remove();
        workerManager.init();
        if ($pyodideStatus) $pyodideStatus.textContent = 'Retrying...';
        showToast('Retrying Python runtime load...', 'info', 2000);
      };
      document.querySelector('.loading-content')?.appendChild(retryHint);
    }
  }, 45000);

  // Clear timeout when ready
  const origOnReady = workerManager.onReady;
  workerManager.onReady = () => {
    clearTimeout(loadTimeout);
    origOnReady();
  };

  // ── Pip Install Callbacks ──
  workerManager.onInstallStart = (pkg) => {
    if ($pipStatus) {
      $pipStatus.textContent = `Installing ${pkg}...`;
      $pipStatus.className = 'pip-bar__status installing';
    }
  };

  workerManager.onInstallDone = (pkg) => {
    if ($pipStatus) {
      $pipStatus.textContent = `✓ ${pkg} installed`;
      $pipStatus.className = 'pip-bar__status success';
      setTimeout(() => { $pipStatus.textContent = ''; $pipStatus.className = 'pip-bar__status'; }, 4000);
    }
    terminal?.writeSystem(`[pip] ✓ ${pkg} installed\n`);
    showToast(`${pkg} installed`, 'success', 2500);
  };

  workerManager.onInstallError = (pkg, msg) => {
    if ($pipStatus) {
      $pipStatus.textContent = `✗ Failed`;
      $pipStatus.className = 'pip-bar__status error';
      setTimeout(() => { $pipStatus.textContent = ''; $pipStatus.className = 'pip-bar__status'; }, 5000);
    }
    terminal?.writeError(`[pip] ✗ ${pkg} — ${msg}\n`);
    showToast(`Failed to install ${pkg}`, 'error', 3000);
  };
}

// ── Execution Timer ────────────────────────────────────────────
function startExecTimer() {
  execStart = performance.now();
  if ($execTime) $execTime.classList.add('running');
  execTimer = setInterval(() => {
    const elapsed = (performance.now() - execStart) / 1000;
    if ($execTime) $execTime.textContent = elapsed.toFixed(1) + 's';
  }, 100);
}

function stopExecTimer() {
  clearInterval(execTimer);
  execTimer = null;
}

// ── Progress Bar ───────────────────────────────────────────────
function startProgressBar() {
  if (!$progressBar) return;
  $progressBar.className = 'run-progress-bar indeterminate';
}

function finishProgressBar(isError = false) {
  if (!$progressBar) return;
  $progressBar.className = 'run-progress-bar done';
  setTimeout(() => { $progressBar.className = 'run-progress-bar'; }, 500);
}

// ── Loading Steps Animation ────────────────────────────────────
function animateLoadingSteps() {
  const steps = [$lstep1, $lstep2, $lstep3];
  steps.forEach((s, i) => {
    setTimeout(() => {
      if (i > 0) steps[i - 1]?.classList.replace('active', 'done');
      s?.classList.add('active');
    }, 400 + i * 700);
  });
}

// ── Run State ──────────────────────────────────────────────────
function setRunState(state) {
  if ($runStatus) $runStatus.className = 'run-status run-status--' + state;
  const labels = { idle: 'Ready', ready: 'Ready', running: 'Running', done: 'Done', error: 'Error' };
  if ($runStatusText) $runStatusText.textContent = labels[state] || state;

  if (state === 'running') {
    $runBtn?.classList.add('running');
    if ($runBtnText) $runBtnText.textContent = 'Stop';
    $runIconPlay?.classList.add('hidden');
    $runIconStop?.classList.remove('hidden');
  } else {
    $runBtn?.classList.remove('running');
    if ($runBtnText) $runBtnText.textContent = 'Run';
    $runIconPlay?.classList.remove('hidden');
    $runIconStop?.classList.add('hidden');
  }
}

// ── Run / Stop ─────────────────────────────────────────────────
function runCode() {
  clearErrorHighlights();
  const runtimeReady = useLocalPython || workerManager?.isReady;
  if (!runtimeReady) {
    showToast('Runtime is still loading…', 'info', 1800);
    return;
  }

  if (isRunning) {
    stopCode();
    return;
  }

  const code = getValue();
  if (!code.trim()) {
    showToast('Nothing to run — write some Python first', 'info', 2000);
    return;
  }

  // Save before running
  saveCode();

  isRunning = true;
  setRunState('running');
  if ($execTime) $execTime.textContent = '';
  terminal?.exitInputMode();
  terminal?.writeRunSeparator();
  startProgressBar();
  startExecTimer();

  if (useLocalPython) {
    window.electronAPI.runPython(code);
  } else {
    workerManager.run(code);
  }
}

function stopCode() {
  if (useLocalPython) {
    window.electronAPI.killPython();
  } else {
    workerManager?.kill();
  }
  setRunState('idle');
  isRunning = false;
}

// ── Copy Code ─────────────────────────────────────────────────
function copyCode() {
  const code = getValue();
  navigator.clipboard.writeText(code).then(() => {
    showToast('Code copied to clipboard', 'success', 2000);
  }).catch(() => {
    showToast('Failed to copy', 'error', 2000);
  });
}

// ── Save to .py File ──────────────────────────────────────────
let currentFilePath = null; // Track the on-disk file path

function setFileName(name) {
  const $fn = document.getElementById('file-name');
  if ($fn) $fn.textContent = name;
}

async function saveToFile() {
  const code = getValue();
  if (!code.trim()) {
    showToast('Nothing to save — write some code first', 'info', 2000);
    return;
  }

  const fileName = document.getElementById('file-name')?.textContent?.trim() || 'main.py';

  // Electron native save
  if (window.electronAPI?.saveFile) {
    // If we already have a file path, save directly
    if (currentFilePath) {
      const result = await window.electronAPI.saveFile(currentFilePath, code);
      if (result?.error) {
        showToast(`Save failed: ${result.error}`, 'error', 3000);
      } else {
        $saveDot?.classList.remove('visible');
        markActiveTabSaved();
        showToast(`Saved: ${fileName}`, 'save', 1800);
      }
      return;
    }

    // No path yet — show Save As dialog
    await saveAsFile();
    return;
  }

  // Fallback: browser download
  const finalName = fileName.endsWith('.py') ? fileName : fileName + '.py';
  const blob = new Blob([code], { type: 'text/x-python;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = finalName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  setFileName(finalName);
  showToast(`Downloaded: ${finalName}`, 'success', 2000);
}

async function saveAsFile() {
  const code = getValue();
  if (!code.trim()) {
    showToast('Nothing to save — write some code first', 'info', 2000);
    return;
  }

  const defaultName = document.getElementById('file-name')?.textContent?.trim() || 'main.py';

  if (window.electronAPI?.saveFileAs) {
    const result = await window.electronAPI.saveFileAs(code, defaultName);
    if (!result) return; // Cancelled
    if (result.error) {
      showToast(`Save failed: ${result.error}`, 'error', 3000);
      return;
    }
    currentFilePath = result.filePath;
    setFileName(result.fileName);
    // Update current tab
    const tab = tabs.find(t => t.id === activeTabId);
    if (tab) { tab.filePath = result.filePath; tab.name = result.fileName; tab.unsaved = false; }
    $saveDot?.classList.remove('visible');
    renderTabs();
    showToast(`Saved: ${result.fileName}`, 'save', 2000);
  }
}

async function openFile() {
  if (!window.electronAPI?.openFile) {
    // Fallback to file input for browser mode
    document.getElementById('import-file-input')?.click();
    return;
  }

  const result = await window.electronAPI.openFile();
  if (!result) return; // Cancelled
  if (result.error) {
    showToast(`Open failed: ${result.error}`, 'error', 3000);
    return;
  }

  // Open in a new tab
  addNewTab(result.fileName, result.content, result.filePath);
  showToast(`Opened: ${result.fileName}`, 'success', 2000);
}

// ── Import .py File (browser fallback) ────────────────────────
function importFromFile(file) {
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const code = e.target.result;
    addNewTab(file.name, code, null);
    showToast(`Imported: ${file.name}`, 'success', 2000);
  };
  reader.onerror = () => {
    showToast('Failed to read file', 'error', 2000);
  };
  reader.readAsText(file);
}

// ── Buttons ────────────────────────────────────────────────────
function initButtons() {
  $runBtn?.addEventListener('click', runCode);
  $clearBtn?.addEventListener('click', () => terminal?.clear());
  $copyBtn?.addEventListener('click', copyCode);

  // Save to .py file (Ctrl+S saves to current path, or Save As if new)
  const $saveFileBtn = $('btn-save-file');
  $saveFileBtn?.addEventListener('click', saveToFile);

  // Open / Import .py file
  const $importBtn = $('btn-import-file');
  const $importInput = $('import-file-input');
  $importBtn?.addEventListener('click', () => openFile());
  $importInput?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) importFromFile(file);
    e.target.value = '';
  });

  $fontIncBtn?.addEventListener('click', () => {
    fontSize = Math.min(fontSize + 1, 24);
    setFontSize(fontSize);
    showToast(`Font: ${fontSize}px`, 'info', 1200);
  });

  $fontDecBtn?.addEventListener('click', () => {
    fontSize = Math.max(fontSize - 1, 10);
    setFontSize(fontSize);
    showToast(`Font: ${fontSize}px`, 'info', 1200);
  });

  $examplesBtn?.addEventListener('click', () => $examplesModal?.classList.remove('hidden'));
  $shortcutsBtn?.addEventListener('click', () => { renderShortcutsModal(); $shortcutsModal?.classList.remove('hidden'); });
  $paletteBtn?.addEventListener('click', openCommandPalette);
  $closeExamples?.addEventListener('click', () => $examplesModal?.classList.add('hidden'));
  $closeShortcuts?.addEventListener('click', () => { cancelRecording(); $shortcutsModal?.classList.add('hidden'); });

  // Reset shortcuts button
  const $resetShortcuts = $('reset-shortcuts');
  $resetShortcuts?.addEventListener('click', () => {
    shortcutBindings = JSON.parse(JSON.stringify(DEFAULT_SHORTCUTS));
    saveShortcuts();
    renderShortcutsModal();
    showToast('Shortcuts reset to defaults', 'info', 2000);
  });

  // Backdrop close
  $examplesModal?.querySelector('.modal-backdrop')?.addEventListener('click', () => $examplesModal.classList.add('hidden'));
  $shortcutsModal?.querySelector('.modal-backdrop')?.addEventListener('click', () => { cancelRecording(); $shortcutsModal.classList.add('hidden'); });
  $cmdPalette?.querySelector('.cmd-palette-backdrop')?.addEventListener('click', closeCommandPalette);
}

// ── Command Palette ────────────────────────────────────────────
let cmdQuery = '';
let selectedCmd = 0;
let filteredCmds = [...COMMANDS];

function openCommandPalette() {
  $cmdPalette?.classList.remove('hidden');
  if ($cmdInput) {
    $cmdInput.value = '';
    cmdQuery = '';
    filteredCmds = [...COMMANDS];
    selectedCmd = 0;
    renderCmdResults();
    setTimeout(() => $cmdInput.focus(), 50);
  }
}

function closeCommandPalette() {
  $cmdPalette?.classList.add('hidden');
  focusEditor();
}

function renderCmdResults() {
  if (!$cmdResults) return;
  $cmdResults.innerHTML = '';

  if (filteredCmds.length === 0) {
    $cmdResults.innerHTML = `<div class="cmd-empty">No commands found</div>`;
    return;
  }

  filteredCmds.forEach((cmd, i) => {
    const el = document.createElement('div');
    el.className = 'cmd-result-item' + (i === selectedCmd ? ' active' : '');
    el.innerHTML = `
      <svg class="cmd-result-icon" width="14" height="14" viewBox="0 0 14 14" fill="none">${cmd.icon}</svg>
      <span class="cmd-result-name">${cmd.name}</span>
      ${cmd.key ? `<span class="cmd-result-key">${cmd.key}</span>` : ''}
    `;
    el.addEventListener('click', () => {
      closeCommandPalette();
      cmd.action();
    });
    el.addEventListener('mouseenter', () => {
      selectedCmd = i;
      renderCmdResults();
    });
    $cmdResults.appendChild(el);
  });
}

function initCommandPalette() {
  $cmdInput?.addEventListener('input', (e) => {
    cmdQuery = e.target.value.toLowerCase();
    filteredCmds = COMMANDS.filter(c => c.name.toLowerCase().includes(cmdQuery));
    selectedCmd = 0;
    renderCmdResults();
  });

  $cmdInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeCommandPalette(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedCmd = Math.min(selectedCmd + 1, filteredCmds.length - 1);
      renderCmdResults();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedCmd = Math.max(selectedCmd - 1, 0);
      renderCmdResults();
      return;
    }
    if (e.key === 'Enter') {
      const cmd = filteredCmds[selectedCmd];
      if (cmd) { closeCommandPalette(); cmd.action(); }
    }
  });
}

// ── Keyboard Shortcuts (Editable System) ──────────────────────
let recordingShortcutId = null;

const SHORTCUT_ACTIONS = {
  'run':            () => runCode(),
  'stop':           () => stopCode(),
  'clear':          () => terminal?.clear(),
  'copy':           () => copyCode(),
  'save':           () => { saveCode(); saveToFile(); },
  'focus-editor':   () => focusEditor(),
  'focus-terminal': () => terminal?.focus(),
  'toggle-theme':   () => handleThemeToggle(),
  'cmd-palette':    () => {
    $cmdPalette?.classList.contains('hidden') ? openCommandPalette() : closeCommandPalette();
  },
};

const SHORTCUT_LABELS = {
  'run':            'Run Code',
  'stop':           'Stop Execution',
  'clear':          'Clear Terminal',
  'copy':           'Copy Code',
  'save':           'Save',
  'focus-editor':   'Focus Editor',
  'focus-terminal': 'Focus Terminal',
  'toggle-theme':   'Toggle Theme',
  'cmd-palette':    'Command Palette',
};

function initShortcuts() {
  document.addEventListener('keydown', (e) => {
    // If we're recording a new shortcut, handle that instead
    if (recordingShortcutId) {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        cancelRecording();
        return;
      }

      // Ignore standalone modifier keys
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

      // Record the binding
      const newBinding = {
        ctrl: e.ctrlKey,
        shift: e.shiftKey,
        alt: e.altKey,
        key: e.key,
      };
      shortcutBindings[recordingShortcutId] = newBinding;

      // Check for conflicts with other shortcuts
      const label = bindingToString(newBinding);
      const conflicts = Object.entries(shortcutBindings)
        .filter(([id, b]) =>
          id !== recordingShortcutId &&
          b.ctrl === newBinding.ctrl &&
          b.shift === newBinding.shift &&
          b.alt === newBinding.alt &&
          b.key.toLowerCase() === newBinding.key.toLowerCase()
        )
        .map(([id]) => {
          return SHORTCUT_LABELS[id] || id;
        });

      saveShortcuts();

      if (conflicts.length > 0) {
        showToast(`⚠ ${label} conflicts with: ${conflicts.join(', ')}`, 'error', 4000);
      } else {
        showToast(`Shortcut updated: ${label}`, 'success', 2000);
      }

      recordingShortcutId = null;
      renderShortcutsModal();
      return;
    }

    if ($ide.classList.contains('hidden')) return;

    // ── Guard: don't steal native editing shortcuts from editor / inputs ──
    // Check if focus is inside Monaco editor, a text input, or textarea
    const active = document.activeElement;
    const isInEditor = active?.closest('.cm-editor') ||
                       active?.closest('.cm-content');
    const isInTextInput = active?.tagName === 'INPUT' ||
                          active?.tagName === 'TEXTAREA' ||
                          active?.getAttribute?.('contenteditable') === 'true';
    const isEditable = isInEditor || isInTextInput;

    // Native editing keys that must never be intercepted inside editable areas
    const NATIVE_EDIT_KEYS = ['c', 'v', 'x', 'a', 'z', 'y'];

    // Match against all editable shortcut bindings
    for (const [id, binding] of Object.entries(shortcutBindings)) {
      if (eventMatchesBinding(e, binding)) {
        // If focus is in an editable area and this is a native editing combo
        // (Ctrl+C/V/X/A/Z/Y without extra modifiers), let the browser handle it
        if (isEditable && binding.ctrl && !binding.alt &&
            NATIVE_EDIT_KEYS.includes(binding.key.toLowerCase())) {
          // Exception: 'stop' fires Ctrl+C even in editor, but ONLY when running
          if (id === 'stop' && isRunning) {
            e.preventDefault();
            SHORTCUT_ACTIONS[id]?.();
            return;
          }
          // Otherwise let native copy/paste/cut/undo/redo work
          return;
        }

        e.preventDefault();
        SHORTCUT_ACTIONS[id]?.();
        return;
      }
    }

    // Escape closes modals
    if (e.key === 'Escape') {
      $examplesModal?.classList.add('hidden');
      $shortcutsModal?.classList.add('hidden');
      if (!$cmdPalette?.classList.contains('hidden')) closeCommandPalette();
    }
  });
}

// ── Editable Shortcuts Modal ──────────────────────────────────
function renderShortcutsModal() {
  const $list = $('shortcuts-list');
  if (!$list) return;
  $list.innerHTML = '';

  for (const [id, label] of Object.entries(SHORTCUT_LABELS)) {
    const binding = shortcutBindings[id];
    const bindStr = bindingToString(binding);
    const keys = bindStr.split('+');

    const item = document.createElement('div');
    item.className = 'shortcut-item';

    const labelEl = document.createElement('span');
    labelEl.className = 'shortcut-item__label';
    labelEl.textContent = label;

    const rightEl = document.createElement('div');
    rightEl.className = 'shortcut-item__right';

    const keysEl = document.createElement('div');
    keysEl.className = 'shortcut-keys';
    keysEl.title = 'Click to edit';

    if (recordingShortcutId === id) {
      keysEl.classList.add('recording');
      const hint = document.createElement('span');
      hint.className = 'shortcut-recording-hint';
      hint.textContent = 'Press keys...';
      keysEl.appendChild(hint);
    } else {
      keys.forEach(k => {
        const kbd = document.createElement('kbd');
        kbd.textContent = k;
        keysEl.appendChild(kbd);
      });
    }

    keysEl.addEventListener('click', () => {
      recordingShortcutId = id;
      renderShortcutsModal();
    });

    const editBtn = document.createElement('button');
    editBtn.className = 'shortcut-edit-btn';
    editBtn.title = 'Edit shortcut';
    editBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M7.5 2.5L9.5 4.5M2 8L1.5 10.5L4 10L9.5 4.5L7.5 2.5L2 8Z" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/>
    </svg>`;
    editBtn.addEventListener('click', () => {
      recordingShortcutId = id;
      renderShortcutsModal();
    });

    rightEl.appendChild(keysEl);
    rightEl.appendChild(editBtn);
    item.appendChild(labelEl);
    item.appendChild(rightEl);
    $list.appendChild(item);
  }
}

function cancelRecording() {
  recordingShortcutId = null;
  renderShortcutsModal();
}

// ── Examples ──────────────────────────────────────────────────
function initExamples() {
  if (!$examplesList) return;
  EXAMPLES.forEach((ex) => {
    const item = document.createElement('div');
    item.className = 'example-item';
    item.innerHTML = `
      <div class="example-item__info">
        <div class="example-item__name">${ex.name}</div>
        <div class="example-item__desc">${ex.desc}</div>
      </div>
      <svg class="example-item__arrow" width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M3 7H11M11 7L7.5 3.5M11 7L7.5 10.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `;
    item.addEventListener('click', () => {
      setValue(ex.code);
      $examplesModal?.classList.add('hidden');
      focusEditor();
      showToast(`Loaded: ${ex.name}`, 'success', 1800);
    });
    $examplesList.appendChild(item);
    addRipple(item);
  });
}

// ── Gutter / Panel Resize ──────────────────────────────────────
function initGutter() {
  let isDragging = false;
  let startX = 0;
  let startW = 0;
  const ideBody = document.querySelector('.ide-body');

  $gutter?.addEventListener('mousedown', (e) => {
    isDragging = true;
    startX = e.clientX;
    startW = $editorPane.getBoundingClientRect().width;
    $gutter?.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    // Disable pointer events on panes during drag (prevents iframe stealing)
    $monacoContainer.style.pointerEvents = 'none';
    $termContainer.style.pointerEvents = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const total = ideBody.getBoundingClientRect().width;
    const newW = Math.max(220, Math.min(startW + dx, total - 220));
    $editorPane.style.width = (newW / total * 100) + '%';
    // Throttle layout updates with RAF
    requestAnimationFrame(() => {
      editorLayout();
      terminal?.fit();
    });
  });

  document.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    $gutter?.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    $monacoContainer.style.pointerEvents = '';
    $termContainer.style.pointerEvents = '';
    editorLayout();
    terminal?.fit();
  });
}

// ── Window Controls (Electron) ────────────────────────────────
if (window.electronAPI) {
  const $wcMin   = $('btn-wc-min');
  const $wcMax   = $('btn-wc-max');
  const $wcClose = $('btn-wc-close');
  const $wcMaxIcon = $('wc-max-icon');

  $wcMin?.addEventListener('click',   () => window.electronAPI.minimize());
  $wcMax?.addEventListener('click',   () => window.electronAPI.maximize());
  $wcClose?.addEventListener('click', () => window.electronAPI.close());

  // Landing page window controls
  $('landing-wc-min')?.addEventListener('click',   () => window.electronAPI.minimize());
  $('landing-wc-max')?.addEventListener('click',   () => window.electronAPI.maximize());
  $('landing-wc-close')?.addEventListener('click', () => window.electronAPI.close());

  // Update maximize icon when window state changes
  const RESTORE_ICON = '<rect x=".5" y="2.5" width="7" height="7" stroke="currentColor" fill="none" stroke-width="1"/><rect x="2.5" y=".5" width="7" height="7" stroke="currentColor" fill="none" stroke-width="1"/>';
  const MAX_ICON     = '<rect x=".5" y=".5" width="9" height="9" stroke="currentColor" fill="none" stroke-width="1"/>';

  window.electronAPI.onMaximizeChange((isMax) => {
    if ($wcMaxIcon) $wcMaxIcon.innerHTML = isMax ? RESTORE_ICON : MAX_ICON;
  });

  window.electronAPI.isMaximized().then((isMax) => {
    if ($wcMaxIcon) $wcMaxIcon.innerHTML = isMax ? RESTORE_ICON : MAX_ICON;
  });
} else {
  // Running in browser — hide window controls
  document.querySelectorAll('.wc-btn').forEach(b => b.style.display = 'none');
}

// ── Landing ripples ────────────────────────────────────────────
document.querySelectorAll('.btn-launch-main, .btn-launch-small').forEach(addRipple);

// ── Theme Toggle ──────────────────────────────────────────────
const SUN_ICON = `<circle cx="7" cy="7" r="3.5" stroke="currentColor" stroke-width="1.3"/><path d="M7 1.5V3M7 11V12.5M1.5 7H3M11 7H12.5M3.1 3.1L4.2 4.2M9.8 9.8L10.9 10.9M3.1 10.9L4.2 9.8M9.8 4.2L10.9 3.1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>`;
const MOON_ICON = `<path d="M10.5 7A5 5 0 114.5 3.5 3.5 3.5 0 0010.5 7Z" stroke="currentColor" stroke-width="1.3" fill="none"/>`;

function handleThemeToggle() {
  const newTheme = toggleEditorTheme();
  const isLight = newTheme === 'light';

  // Update editor pane background
  if (isLight) {
    $editorPane?.classList.remove('theme-dark');
  } else {
    $editorPane?.classList.add('theme-dark');
  }

  // Update topbar button
  if ($themeIcon) $themeIcon.innerHTML = isLight ? SUN_ICON : MOON_ICON;
  if ($themeLabel) $themeLabel.textContent = isLight ? 'Light' : 'Dark';

  // Update status bar
  if ($statusThemeText) $statusThemeText.textContent = isLight ? 'Light' : 'Dark';

  showToast(`Editor theme: ${isLight ? 'Light' : 'Dark'}`, 'info', 1400);
}

$themeBtn?.addEventListener('click', handleThemeToggle);
$statusTheme?.addEventListener('click', handleThemeToggle);

// ── Floating Particles (Landing) ──────────────────────────────
function createParticles() {
  if (!$particles) return;
  for (let i = 0; i < 12; i++) {
    const p = document.createElement('div');
    p.className = 'landing-particle';
    p.style.left = Math.random() * 100 + '%';
    p.style.top = Math.random() * 100 + '%';
    p.style.setProperty('--dur', (4 + Math.random() * 6) + 's');
    p.style.setProperty('--delay', (Math.random() * 4) + 's');
    p.style.setProperty('--dx', (Math.random() * 40 - 20) + 'px');
    p.style.setProperty('--dy', (Math.random() * 30 - 15) + 'px');
    p.style.setProperty('--opa', (0.08 + Math.random() * 0.2).toFixed(2));
    const size = 2 + Math.random() * 3;
    p.style.width = size + 'px';
    p.style.height = size + 'px';
    $particles.appendChild(p);
  }
}

createParticles();

// ── GSAP Landing Entrance Animation ───────────────────────────
function animateLandingEntrance() {
  const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

  // Nav fade down
  tl.fromTo('.landing-nav',
    { opacity: 0, y: -20 },
    { opacity: 1, y: 0, duration: 0.5 }
  );

  // Label tag
  tl.fromTo('.label-tag',
    { opacity: 0, x: -20 },
    { opacity: 1, x: 0, duration: 0.4 },
    '-=0.2'
  );

  // Hero title lines — staggered
  tl.fromTo('.title-line--thin',
    { opacity: 0, x: -30 },
    { opacity: 1, x: 0, duration: 0.6 },
    '-=0.15'
  );

  tl.fromTo('.title-line--bold',
    { opacity: 0, x: -30 },
    { opacity: 1, x: 0, duration: 0.6 },
    '-=0.3'
  );

  // Subtitle
  tl.fromTo('.landing-hero__sub',
    { opacity: 0, y: 12 },
    { opacity: 1, y: 0, duration: 0.45 },
    '-=0.25'
  );

  // CTA button
  tl.fromTo('.btn-launch-main',
    { opacity: 0, y: 12 },
    { opacity: 1, y: 0, duration: 0.45 },
    '-=0.2'
  );

  // Meta items — staggered
  tl.fromTo('.meta-item',
    { opacity: 0, y: 10 },
    { opacity: 1, y: 0, duration: 0.35, stagger: 0.08 },
    '-=0.2'
  );

  // Right side — accent block
  tl.fromTo('.landing-accent-block',
    { opacity: 0, x: 40 },
    { opacity: 1, x: 0, duration: 0.55 },
    '-=0.4'
  );

  // Code preview
  tl.fromTo('.landing-code-preview',
    { opacity: 0, x: 40, scale: 0.97 },
    { opacity: 1, x: 0, scale: 1, duration: 0.55,
      onComplete: () => startTypewriter()
    },
    '-=0.35'
  );

  // Footer
  tl.fromTo('.landing-footer',
    { opacity: 0, y: 10 },
    { opacity: 1, y: 0, duration: 0.35 },
    '-=0.2'
  );
}

// Kill CSS landing animations (GSAP takes over)
document.querySelectorAll('.landing-nav, .label-tag, .title-line--thin, .title-line--bold, .landing-hero__sub, .btn-launch-main, .landing-hero__meta, .landing-accent-block, .landing-code-preview, .landing-footer').forEach(el => {
  el.style.animation = 'none';
  el.style.opacity = '0';
});

// Fire after fonts are loaded for correct layout
document.fonts?.ready?.then(() => {
  animateLandingEntrance();
}) || animateLandingEntrance();

// ── Typewriter Animation (Landing Code Preview) ───────────────
const TYPEWRITER_CODE = [
  { text: 'def ', cls: 'cp-keyword' },
  { text: 'fibonacci', cls: 'cp-fn' },
  { text: '(n):\n' },
  { text: '    a, b = ' },
  { text: '0', cls: 'cp-num' },
  { text: ', ' },
  { text: '1', cls: 'cp-num' },
  { text: '\n    ' },
  { text: 'for', cls: 'cp-keyword' },
  { text: ' _ ' },
  { text: 'in', cls: 'cp-keyword' },
  { text: ' ' },
  { text: 'range', cls: 'cp-builtin' },
  { text: '(n):\n' },
  { text: '        ' },
  { text: 'print', cls: 'cp-builtin' },
  { text: '(a, end=' },
  { text: '" "', cls: 'cp-str' },
  { text: ')\n' },
  { text: '        a, b = b, a + b\n\n' },
  { text: 'name = ' },
  { text: 'input', cls: 'cp-builtin' },
  { text: '(' },
  { text: '"Your name: "', cls: 'cp-str' },
  { text: ')\n' },
  { text: 'print', cls: 'cp-builtin' },
  { text: '(' },
  { text: 'f"Hello, ', cls: 'cp-str' },
  { text: '{name}', cls: 'cp-interp' },
  { text: '!"', cls: 'cp-str' },
  { text: ')\n' },
  { text: 'fibonacci(', },
  { text: '10', cls: 'cp-num' },
  { text: ')' },
];

const TYPEWRITER_TERMINAL = [
  { text: 'Your name: ', cls: 'term-prompt', delay: 300 },
  { text: 'Theta', cls: 'term-input', delay: 80, charByChar: true },
  { text: '\n', delay: 400 },
  { text: 'Hello, Theta!', cls: 'term-output', delay: 100 },
  { text: '\n', delay: 200 },
  { text: '0 1 1 2 3 5 8 13 21 34', cls: 'term-output', delay: 50 },
];

function startTypewriter() {
  const codeEl = document.getElementById('typing-code');
  const termEl = document.getElementById('typing-terminal');
  if (!codeEl || !termEl) return;

  let codeIndex = 0;
  let charIndex = 0;
  const cursor = document.createElement('span');
  cursor.className = 'term-cursor';
  cursor.innerHTML = '&nbsp;';

  function typeNextCode() {
    if (codeIndex >= TYPEWRITER_CODE.length) {
      // Code done — start terminal output
      setTimeout(() => typeTerminal(0), 500);
      return;
    }
    const chunk = TYPEWRITER_CODE[codeIndex];
    const char = chunk.text[charIndex];

    if (char === '\n') {
      codeEl.appendChild(document.createTextNode('\n'));
    } else {
      if (chunk.cls) {
        // Find or create the current span
        let span = codeEl.querySelector(`[data-chunk="${codeIndex}"]`);
        if (!span) {
          span = document.createElement('span');
          span.className = chunk.cls;
          span.dataset.chunk = codeIndex;
          codeEl.appendChild(span);
        }
        span.textContent += char;
      } else {
        // Plain text — append to last text node or create one
        const last = codeEl.lastChild;
        if (last && last.nodeType === 3 && !codeEl.querySelector(`[data-chunk="${codeIndex}"]`)) {
          last.textContent += char;
        } else {
          let tn = codeEl.querySelector(`[data-tchunk="${codeIndex}"]`);
          if (!tn) {
            tn = document.createElement('span');
            tn.dataset.tchunk = codeIndex;
            codeEl.appendChild(tn);
          }
          tn.textContent += char;
        }
      }
    }

    charIndex++;
    if (charIndex >= chunk.text.length) {
      codeIndex++;
      charIndex = 0;
    }

    const speed = 18 + Math.random() * 22;
    setTimeout(typeNextCode, speed);
  }

  function typeTerminal(idx) {
    if (idx >= TYPEWRITER_TERMINAL.length) return;
    const item = TYPEWRITER_TERMINAL[idx];

    if (item.text === '\n') {
      termEl.appendChild(document.createElement('br'));
      setTimeout(() => typeTerminal(idx + 1), item.delay || 100);
      return;
    }

    const span = document.createElement('span');
    if (item.cls) span.className = item.cls;
    termEl.appendChild(span);

    if (item.charByChar) {
      let ci = 0;
      function typeChar() {
        if (ci >= item.text.length) {
          setTimeout(() => typeTerminal(idx + 1), item.delay || 100);
          return;
        }
        span.textContent += item.text[ci];
        ci++;
        setTimeout(typeChar, 60 + Math.random() * 40);
      }
      typeChar();
    } else {
      gsap.fromTo(span,
        { opacity: 0 },
        { opacity: 1, duration: 0.2, ease: 'power2.out',
          onComplete: () => setTimeout(() => typeTerminal(idx + 1), item.delay || 100)
        }
      );
      span.textContent = item.text;
    }
  }

  typeNextCode();
}

// Theme toggle shortcut is now handled by the editable shortcut system

// ── Pip Install Handler ───────────────────────────────────────
const installedPackages = []; // { name, version }

function handlePipInstall() {
  const pkg = $pipInput?.value?.trim();
  if (!pkg) return;

  if (useLocalPython) {
    $pipInput.value = '';
    if ($pipStatus) {
      $pipStatus.textContent = `Installing ${pkg}...`;
      $pipStatus.className = 'pip-bar__status installing';
    }
    terminal?.writeSystem(`\n[pip] Installing "${pkg}"...\n`);
    window.electronAPI.pipInstall(pkg);
    // Track the package (version unknown for local)
    addInstalledPackage(pkg, 'local');
    return;
  }

  if (!workerManager?.isReady) {
    showToast('Python runtime not ready yet', 'error', 2000);
    return;
  }
  $pipInput.value = '';
  workerManager.installPackage(pkg);
  // Track the package
  addInstalledPackage(pkg, 'latest');
}

function addInstalledPackage(name, version) {
  const existing = installedPackages.findIndex(p => p.name.toLowerCase() === name.toLowerCase());
  if (existing >= 0) {
    installedPackages[existing].version = version;
  } else {
    installedPackages.push({ name, version });
  }
  renderPackagesList();
}

function removeInstalledPackage(name) {
  const idx = installedPackages.findIndex(p => p.name.toLowerCase() === name.toLowerCase());
  if (idx >= 0) {
    installedPackages.splice(idx, 1);
    renderPackagesList();
    showToast(`Removed: ${name}`, 'info', 1800);
  }
}

function renderPackagesList() {
  const $list = document.getElementById('pip-packages-list');
  if (!$list) return;

  if (installedPackages.length === 0) {
    $list.innerHTML = '<span class="pip-packages-empty">No packages installed yet</span>';
    return;
  }

  $list.innerHTML = '';
  installedPackages.forEach(pkg => {
    const item = document.createElement('div');
    item.className = 'pip-package-item';

    const left = document.createElement('span');
    left.innerHTML = `<span class="pip-package-item__name">${pkg.name}</span><span class="pip-package-item__version">${pkg.version}</span>`;

    const unBtn = document.createElement('button');
    unBtn.className = 'pip-package-item__uninstall';
    unBtn.textContent = 'remove';
    unBtn.addEventListener('click', () => removeInstalledPackage(pkg.name));

    item.appendChild(left);
    item.appendChild(unBtn);
    $list.appendChild(item);
  });
}

// List button toggle
const $pipListBtn = $('pip-list-btn');
const $pipPanel = $('pip-packages-panel');
const $pipPanelClose = $('pip-packages-close');

$pipListBtn?.addEventListener('click', () => {
  $pipPanel?.classList.toggle('hidden');
});

$pipPanelClose?.addEventListener('click', () => {
  $pipPanel?.classList.add('hidden');
});

$pipInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    handlePipInstall();
  }
});

$pipBtn?.addEventListener('click', handlePipInstall);
