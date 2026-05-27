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
         getEditorState, setEditorState, openFindReplace } from './editor.js';
import { TerminalManager } from './terminal.js';
import { WorkerManager } from './worker-manager.js';
import { ReplManager } from './repl.js';
import { EXAMPLES } from './examples.js';
import { showToast } from './toast.js';
import { addRipple } from './ripple.js';
import { initSmoothEngine } from './smooth.js';
import { handleThemeToggle, initTheme } from './theme-manager.js';
import { PipManager } from './pip-manager.js';
import { FileSystemService } from './services/FileSystemService.js';
import { initLanding } from './landing.js';
import gsap from 'gsap';
import { initCollabPanel, openCollabPanel, closeCollabPanel,
         toggleCollabPanel, isCollabPanelOpen, isSharing,
         handleCollabKeydown, getStateCapture } from './collab/collab.js';

// ————————————————————————————————————————————————————————————————————————————
// Catches uncaught exceptions and unhandled promise rejections
// so the app doesn't silently break.
window.onerror = (message, source, line, col, error) => {
  console.error('[THETA] Uncaught error:', { message, source, line, col, error });
  try { showToast(`Error: ${message}`, 'error', 4000); } catch (_) {}
  return true; // prevent default browser error handling
};

window.onunhandledrejection = (event) => {
  const msg = event.reason?.message || String(event.reason);
  console.error('[THETA] Unhandled rejection:', event.reason);
  try { showToast(`Error: ${msg}`, 'error', 4000); } catch (_) {}
};

// â”€â”€ Safe localStorage helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Prevents crashes in private browsing or quota-exceeded scenarios
function storageGet(key, fallback = null) {
  try { return localStorage.getItem(key) ?? fallback; } catch (_) { return fallback; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch (_) {}
}
function storageRemove(key) {
  try { localStorage.removeItem(key); } catch (_) {}
}

// â”€â”€ DOM â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€ State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let editor        = null;
let terminal      = null;
let workerManager = null;
let replManager   = null;
let pipManager    = null;
let ideInitialized = false;
let fontSize      = 15;
let isRunning     = false;
let saveTimer     = null;
let execTimer     = null;
let execStart     = 0;
let useLocalPython = false;
let localPythonInfo = null;
let activePane    = 'terminal'; // 'terminal' | 'repl'

// â”€â”€ Tab System â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
      close.innerHTML = '<svg width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M1 1L8 8M8 1L1 8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
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

// â”€â”€ Default Shortcut Bindings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const DEFAULT_SHORTCUTS = {
  'run':            { ctrl: true, shift: false, alt: false, key: 'Enter' },
  'stop':           { ctrl: true, shift: false, alt: false, key: 'c' },
  'clear':          { ctrl: true, shift: false, alt: false, key: 'l' },
  'copy':           { ctrl: true, shift: true,  alt: false, key: 'c' },
  'save':           { ctrl: true, shift: false, alt: false, key: 's' },
  'save-as':        { ctrl: true, shift: true,  alt: false, key: 's' },
  'open-file':      { ctrl: true, shift: false, alt: false, key: 'o' },
  'new-tab':        { ctrl: true, shift: false, alt: false, key: 'n' },
  'find-replace':   { ctrl: true, shift: false, alt: false, key: 'f' },
  'fix-code':       { ctrl: true, shift: false, alt: false, key: 'i' },
  'font-inc':       { ctrl: true, shift: false, alt: false, key: '=' },
  'font-dec':       { ctrl: true, shift: false, alt: false, key: '-' },
  'focus-editor':   { ctrl: true, shift: false, alt: false, key: '1' },
  'focus-terminal': { ctrl: true, shift: false, alt: false, key: '2' },
  'toggle-theme':   { ctrl: true, shift: false, alt: false, key: 't' },
  'cmd-palette':    { ctrl: true, shift: true,  alt: false, key: 'p' },
  'collab':          { ctrl: true, shift: true,  alt: false, key: 'l' },
};

// Load saved shortcuts or use defaults (merges so new shortcuts appear)
function loadShortcuts() {
  try {
    const saved = storageGet('theta-shortcuts');
    if (saved) {
      const parsed = JSON.parse(saved);
      // Merge: defaults provide any new shortcuts, saved overrides existing ones
      return { ...JSON.parse(JSON.stringify(DEFAULT_SHORTCUTS)), ...parsed };
    }
  } catch (_) {}
  return JSON.parse(JSON.stringify(DEFAULT_SHORTCUTS));
}

function saveShortcuts() {
  storageSet('theta-shortcuts', JSON.stringify(shortcutBindings));
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
  else if (keyLabel === 'ArrowUp') keyLabel = 'â†‘';
  else if (keyLabel === 'ArrowDown') keyLabel = 'â†“';
  else if (keyLabel === 'ArrowLeft') keyLabel = 'â†';
  else if (keyLabel === 'ArrowRight') keyLabel = 'â†’';
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

// â”€â”€ Command Registry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    get key() { return bindingToString(shortcutBindings['save-as']); },
    icon: `<path d="M2 3H9L12 6V13H2V3Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M7 1V5M5 3H9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>`,
    action: () => saveAsFile(),
  },
  {
    id: 'open-file',
    name: 'Open File...',
    get key() { return bindingToString(shortcutBindings['open-file']); },
    icon: `<path d="M2 4H5L7 2H12V12H2V4Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>`,
    action: () => openFile(),
  },
  {
    id: 'find-replace',
    name: 'Find & Replace',
    get key() { return bindingToString(shortcutBindings['find-replace']); },
    icon: `<circle cx="6" cy="6" r="4" stroke="currentColor" stroke-width="1.2"/><path d="M9 9L13 13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>`,
    action: () => openFindReplace(),
  },
  {
    id: 'examples',
    name: 'Browse Examples',
    key: '',
    icon: `<rect x="2" y="2" width="10" height="10" stroke="currentColor" stroke-width="1.2"/><path d="M5 5H9M5 7H7M5 9H8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>`,
    action: () => $examplesModal?.classList.remove('hidden'),
  },
  {
    id: 'new-tab',
    name: 'New Tab',
    get key() { return bindingToString(shortcutBindings['new-tab']); },
    icon: `<path d="M7 3V11M3 7H11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>`,
    action: () => addNewTab(null, '# New file\n'),
  },
  {
    id: 'fix-code',
    name: 'Fix Code (AI)',
    get key() { return bindingToString(shortcutBindings['fix-code']); },
    icon: `<path d="M2 2L5 6L2 10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 6H11" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><circle cx="10" cy="2" r="1.2" stroke="currentColor" stroke-width="0.8" fill="none"/>`,
    action: () => fixCode(),
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
    get key() { return bindingToString(shortcutBindings['font-inc']); },
    icon: `<path d="M3 2.5H8M5.5 2.5V7.5M3 10H8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>`,
    action: () => { fontSize = Math.min(fontSize + 1, 24); setFontSize(fontSize); showToast(`Font size: ${fontSize}px`, 'info', 1400); },
  },
  {
    id: 'font-dec',
    name: 'Decrease Font Size',
    get key() { return bindingToString(shortcutBindings['font-dec']); },
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
    id: 'collab',
    name: 'Open Collab Panel',
    get key() { return bindingToString(shortcutBindings['collab']); },
    icon: `<circle cx="7" cy="7" r="3" stroke="currentColor" stroke-width="1.2"/><path d="M3 3a7 7 0 0 1 8 0" stroke="currentColor" stroke-width="1" stroke-linecap="round"/><path d="M11 11a7 7 0 0 1-8 0" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>`,
    action: () => toggleCollabPanel(),
  },
];

// ── Direct IDE Boot (no landing page) ──────────────────────────────
function launchIDE() {
  if (!ideInitialized) {
    ideInitialized = true;
    initIDE();
  }
}

function goToLanding() {
  // Repurposed: now opens collab panel
  openCollabPanel();
}

// Auto-boot the IDE
launchIDE();

// ── IDE Init ──────────────────────────────────────────────────────────────────
async function initIDE() {
  // Animate loading steps
  animateLoadingSteps();

  // Show editor loading step
  $lstep0?.classList.add('active');

  // Restore saved code
  const savedCode = storageGet('theta-code');

  // Groq API key should be set via Settings UI, not hardcoded
  // if (!storageGet('theta-groq-api-key')) {
  //   storageSet('theta-groq-api-key', 'YOUR_KEY_HERE');
  // }

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

  // Live cursor position — event-driven, no polling
  onCursorChange((pos) => {
    if ($cursorPos) $cursorPos.textContent = `Ln ${pos.lineNumber}, Col ${pos.column}`;
    // Stream cursor to viewers if sharing
    const sc = getStateCapture();
    if (sc) sc.onCursorMove();
  });

  // Live code stats + auto-save + tab unsaved indicator — event-driven
  let _contentChangeDebounce = null;
  onContentChange(() => {
    // Debounce to avoid rebuilding tabs on every keystroke
    clearTimeout(_contentChangeDebounce);
    _contentChangeDebounce = setTimeout(() => {
      updateCodeStats();
      markUnsaved();
      markActiveTabUnsaved();
      scheduleAutoSave();
      // Stream code changes to viewers if sharing
      const sc = getStateCapture();
      if (sc) sc.onCodeChange();
    }, 150);
  });

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

  // Init REPL (lazy — created now, started on tab click)
  const $replContainer = $('repl-container');
  replManager = new ReplManager();
  replManager.init($replContainer);

  // Init pane tabs (Terminal / REPL)
  initPaneTabs();

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

  // Init collab panel
  initCollabPanel({
    onLiveChange: (isLive) => {
      // Show/hide LIVE indicator on the Θ logo button
      const logoBtn = document.getElementById('back-to-landing');
      if (logoBtn) {
        if (isLive) {
          logoBtn.classList.add('collab-live');
        } else {
          logoBtn.classList.remove('collab-live');
        }
      }
    },
    editorGetters: {
      getCode: () => getValue() || '',
      getCursor: () => {
        const pos = getCursorPosition();
        return { line: pos?.lineNumber || 1, col: pos?.column || 1 };
      },
      getSelection: () => null,
      getFileName: () => {
        const activeTab = tabs.find((t) => t.id === activeTabId);
        return activeTab?.name || 'main.py';
      },
      getTabs: () => tabs.map((t) => ({ name: t.name, active: t.id === activeTabId })),
      getErrors: () => [],
      getIsRunning: () => isRunning,
      getFontSize: () => fontSize,
      getTheme: () => getEditorTheme(),
    },
  });

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

// ── Local Python Event Listeners ──────────────────────────────────────────────
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
        $pipStatus.textContent = `[OK] ${pkg} installed`;
        $pipStatus.className = 'pip-bar__status success';
        setTimeout(() => { $pipStatus.textContent = ''; $pipStatus.className = 'pip-bar__status'; }, 4000);
      }
      showToast(`${pkg} installed`, 'success', 2500);
    } else {
      if ($pipStatus) {
        $pipStatus.textContent = `[FAIL] Failed`;
        $pipStatus.className = 'pip-bar__status error';
        setTimeout(() => { $pipStatus.textContent = ''; $pipStatus.className = 'pip-bar__status'; }, 5000);
      }
      showToast(`Failed to install ${pkg}`, 'error', 3000);
    }
  });

  // ── Unsaved Changes Handlers ──
  api.onCheckUnsaved(() => {
    const hasUnsaved = tabs.some(t => t.unsaved);
    api.sendUnsavedStatus(hasUnsaved);
  });

  api.onSaveAndClose(async () => {
    try {
      await saveToFile();
    } catch (_) {}
    api.sendCloseConfirmed();
  });
}

// ── Code Stats ────────────────────────────────────────────────────────────────
function updateCodeStats() {
  if (!editor) return;
  const lines = getLineCount();
  const chars = getCharCount();
  if ($lineCount) $lineCount.textContent = `${lines} ${lines === 1 ? 'line' : 'lines'}`;
  if ($charCount) $charCount.textContent = `${chars} ${chars === 1 ? 'char' : 'chars'}`;
}

// ── Auto-Save ─────────────────────────────────────────────────────────────────
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
  storageSet('theta-code', code);
  $saveDot?.classList.remove('visible');
}

// ── Worker ────────────────────────────────────────────────────────────────────
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
      $pipStatus.textContent = `[OK] ${pkg} installed`;
      $pipStatus.className = 'pip-bar__status success';
      setTimeout(() => { $pipStatus.textContent = ''; $pipStatus.className = 'pip-bar__status'; }, 4000);
    }
    terminal?.writeSystem(`[pip] ${pkg} installed successfully\n`);
    showToast(`${pkg} installed`, 'success', 2500);
  };

  workerManager.onInstallError = (pkg, msg) => {
    if ($pipStatus) {
      $pipStatus.textContent = `[FAIL] Failed`;
      $pipStatus.className = 'pip-bar__status error';
      setTimeout(() => { $pipStatus.textContent = ''; $pipStatus.className = 'pip-bar__status'; }, 5000);
    }
    terminal?.writeError(`[pip] ${pkg} failed -- ${msg}\n`);
    showToast(`Failed to install ${pkg}`, 'error', 3000);
  };

  // Pyodide failed to load (offline, CDN down, timeout)
  workerManager.onLoadError = (msg) => {
    console.error('[THETA] Pyodide load error:', msg);
    if ($loadingOverlay) {
      $loadingOverlay.classList.add('hidden');
    }
    showToast(`Python runtime failed: ${msg}`, 'error', 6000);
    terminal?.writeError(`[runtime] ${msg}\n`);
  };
}

// ── Execution Timer ──────────────────────────────────────────────────────────
function startExecTimer() {
  execStart = performance.now();
  if ($execTime) $execTime.classList.add('running');
  // Use rAF instead of setInterval for jank-free timer updates
  function tick() {
    const elapsed = (performance.now() - execStart) / 1000;
    if ($execTime) $execTime.textContent = elapsed.toFixed(1) + 's';
    execTimer = requestAnimationFrame(tick);
  }
  execTimer = requestAnimationFrame(tick);
}

function stopExecTimer() {
  cancelAnimationFrame(execTimer);
  execTimer = null;
}

// ── Progress Bar ─────────────────────────────────────────────────────────────
function startProgressBar() {
  if (!$progressBar) return;
  $progressBar.className = 'run-progress-bar indeterminate';
}

function finishProgressBar(isError = false) {
  if (!$progressBar) return;
  $progressBar.className = 'run-progress-bar done';
  setTimeout(() => { $progressBar.className = 'run-progress-bar'; }, 500);
}

// ── Loading Steps Animation ──────────────────────────────────────────────────
function animateLoadingSteps() {
  const steps = [$lstep1, $lstep2, $lstep3];
  steps.forEach((s, i) => {
    setTimeout(() => {
      if (i > 0) steps[i - 1]?.classList.replace('active', 'done');
      s?.classList.add('active');
    }, 400 + i * 700);
  });
}

// ── Run State ────────────────────────────────────────────────────────────────
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

// ── Run / Stop ───────────────────────────────────────────────────────────────
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

  // Auto-switch to terminal tab so user sees the output
  if (activePane !== 'terminal') {
    switchPane('terminal');
  }

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

// ── Copy Code ────────────────────────────────────────────────────────────────
function copyCode() {
  const code = getValue();
  navigator.clipboard.writeText(code).then(() => {
    showToast('Code copied to clipboard', 'success', 2000);
  }).catch(() => {
    showToast('Failed to copy', 'error', 2000);
  });
}

// ── Fix Code (Groq AI) ───────────────────────────────────────────────────────
// API key is stored in localStorage — never in source code.
// On first use, the user is prompted to enter their key.
const GROQ_STORAGE_KEY = 'theta-groq-api-key';
let isFixingCode = false;

function getGroqApiKey() {
  let key = storageGet(GROQ_STORAGE_KEY);
  if (key) return key;

  // Prompt the user for their API key
  const input = prompt(
    'Enter your Groq API key to enable AI code fixing.\n' +
    'Get one free at https://console.groq.com/keys\n\n' +
    'Your key is stored locally and never sent anywhere except Groq.'
  );
  if (input && input.trim().startsWith('gsk_')) {
    storageSet(GROQ_STORAGE_KEY, input.trim());
    return input.trim();
  }
  return null;
}

async function fixCode() {
  if (isFixingCode) return;

  const code = getValue();
  if (!code.trim()) {
    showToast('Nothing to fix — write some code first', 'info', 2000);
    return;
  }

  const apiKey = getGroqApiKey();
  if (!apiKey) {
    showToast('API key required — click Fix Code again to set it', 'info', 3000);
    return;
  }

  const $btn = $('btn-fix-indent');
  isFixingCode = true;
  if ($btn) {
    $btn.classList.add('loading');
    $btn.setAttribute('disabled', '');
  }
  showToast('Fixing code...', 'info', 1500);

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          {
            role: 'system',
            content: `You are a Python code fixer. You receive Python code and return the corrected version.

RULES:
1. Fix ALL bugs: syntax errors, indentation, logic errors, typos in keywords/builtins, missing colons, wrong operators, unclosed brackets/strings, incorrect function calls.
2. PRESERVE the user's exact coding style, approach, structure, and variable names. Do NOT refactor or restructure.
3. Do NOT add any comments the user did not write. Do NOT remove any comments the user wrote.
4. Do NOT add extra functionality, imports, or code the user did not write.
5. Do NOT change the user's algorithm or approach — only fix what is broken.
6. Keep the same blank lines, spacing style, and formatting the user used.
7. Return ONLY the corrected Python code. No markdown, no explanations, no code fences, no backticks. Raw code only.`
          },
          {
            role: 'user',
            content: code
          }
        ],
        temperature: 0,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error?.message || `API error: ${response.status}`);
    }

    const data = await response.json();
    let fixedCode = data.choices?.[0]?.message?.content;

    if (!fixedCode || !fixedCode.trim()) {
      throw new Error('Empty response from AI');
    }

    // Strip any markdown code fences the model might add
    fixedCode = fixedCode.replace(/^```(?:python)?\n?/i, '').replace(/\n?```$/i, '').trim();

    // Only update if the code actually changed
    if (fixedCode !== code.trim()) {
      setValue(fixedCode + '\n');
      markActiveTabUnsaved();
      scheduleAutoSave();
      showToast('Code fixed successfully', 'success', 2000);
    } else {
      showToast('Code looks good — no fixes needed', 'info', 2000);
    }

  } catch (err) {
    console.error('Fix code error:', err);
    showToast(`Fix failed: ${err.message}`, 'error', 3500);
  } finally {
    isFixingCode = false;
    if ($btn) {
      $btn.classList.remove('loading');
      $btn.removeAttribute('disabled');
    }
  }
}

// ── Save to .py File ──────────────────────────────────────────────────────────
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

  if (currentFilePath) {
    const result = await FileSystemService.saveFile(currentFilePath, code);
    if (result && !result.error) {
      $saveDot?.classList.remove('visible');
      markActiveTabSaved();
      showToast(`Saved: ${fileName}`, 'save', 1800);
    } else {
      showToast(`Save failed: ${result?.error}`, 'error', 3000);
    }
    return;
  }

  // No path yet — show Save As dialog
  await saveAsFile();
}

async function saveAsFile() {
  const code = getValue();
  if (!code.trim()) {
    showToast('Nothing to save — write some code first', 'info', 2000);
    return;
  }

  const defaultName = document.getElementById('file-name')?.textContent?.trim() || 'main.py';
  const result = await FileSystemService.saveFileAs(code, defaultName);

  if (result.canceled) return;
  if (!result.success) {
    showToast(`Save failed: ${result.error}`, 'error', 3000);
    return;
  }

  // If it's a native path (not web fallback)
  if (result.filePath && window.electronAPI) {
    currentFilePath = result.filePath;
    setFileName(result.fileName || result.filePath.split('\\').pop().split('/').pop());
    
    // Update current tab
    const tab = tabs.find(t => t.id === activeTabId);
    if (tab) { 
      tab.filePath = result.filePath; 
      tab.name = result.fileName || result.filePath.split('\\').pop().split('/').pop(); 
      tab.unsaved = false; 
    }
    $saveDot?.classList.remove('visible');
    renderTabs();
    showToast(`Saved: ${tab?.name || 'File'}`, 'save', 2000);
  }
}

async function openFile() {
  const result = await FileSystemService.openFile();
  if (result.canceled) return;
  
  if (!result.success) {
    showToast(`Open failed: ${result.error}`, 'error', 3000);
    return;
  }

  // Extract filename safely
  let name = result.fileName;
  if (!name && result.filePath) {
    name = result.filePath.split('\\').pop().split('/').pop();
  }

  // Open in a new tab
  addNewTab(name || 'Untitled', result.content, result.filePath || null);
  showToast(`Opened: ${name || 'File'}`, 'success', 2000);
}

// ── Import .py File (browser fallback) ────────────────────────────────────────
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

// ── Terminal/REPL Pane Tabs ───────────────────────────────────────────────────
function switchPane(pane) {
  if (pane === activePane) return;
  activePane = pane;

  const $tabTerminal = $('tab-terminal');
  const $tabRepl = $('tab-repl');
  const $termC = $('terminal-container');
  const $replC = $('repl-container');

  // Toggle tab active state
  $tabTerminal?.classList.toggle('active', pane === 'terminal');
  $tabRepl?.classList.toggle('active', pane === 'repl');

  // Toggle container visibility
  $termC?.classList.toggle('hidden', pane !== 'terminal');
  $replC?.classList.toggle('hidden', pane !== 'repl');

  if (pane === 'repl') {
    // Start REPL on first activation (or if it was destroyed)
    if (replManager && !replManager.started) {
      const mode = useLocalPython ? 'local' : 'pyodide';
      const worker = workerManager?.worker || null;
      replManager.start(mode, worker);
    }
    // Fit REPL terminal
    setTimeout(() => replManager?.fit(), 50);
  } else {
    // Fit main terminal when switching back
    setTimeout(() => terminal?.fit(), 50);
  }
}

function initPaneTabs() {
  $('tab-terminal')?.addEventListener('click', () => switchPane('terminal'));
  $('tab-repl')?.addEventListener('click', () => switchPane('repl'));
}

// ── Buttons ───────────────────────────────────────────────────────────────────
function initButtons() {
  $runBtn?.addEventListener('click', runCode);
  $clearBtn?.addEventListener('click', () => {
    if (activePane === 'repl' && replManager?.term) {
      replManager.term.clear();
    } else {
      terminal?.clear();
    }
  });
  $copyBtn?.addEventListener('click', copyCode);
  $('btn-fix-indent')?.addEventListener('click', fixCode);

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
  $backBtn?.addEventListener('click', () => openCollabPanel());
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

// ── Command Palette ──────────────────────────────────────────────────────────
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

// ── Keyboard Shortcuts (Editable System) ──────────────────────────────────────
let recordingShortcutId = null;

const SHORTCUT_ACTIONS = {
  'run':            () => runCode(),
  'stop':           () => stopCode(),
  'clear':          () => { if (activePane === 'repl' && replManager?.term) replManager.term.clear(); else terminal?.clear(); },
  'copy':           () => copyCode(),
  'save':           () => { saveCode(); saveToFile(); },
  'save-as':        () => saveAsFile(),
  'open-file':      () => openFile(),
  'new-tab':        () => addNewTab(null, '# New file\n'),
  'find-replace':   () => openFindReplace(),
  'fix-code':       () => fixCode(),
  'font-inc':       () => { fontSize = Math.min(fontSize + 1, 24); setFontSize(fontSize); showToast(`Font size: ${fontSize}px`, 'info', 1400); },
  'font-dec':       () => { fontSize = Math.max(fontSize - 1, 10); setFontSize(fontSize); showToast(`Font size: ${fontSize}px`, 'info', 1400); },
  'focus-editor':   () => focusEditor(),
  'focus-terminal': () => terminal?.focus(),
  'toggle-theme':   () => handleThemeToggle(),
  'cmd-palette':    () => {
    $cmdPalette?.classList.contains('hidden') ? openCommandPalette() : closeCommandPalette();
  },
  'collab':          () => toggleCollabPanel(),
};

const SHORTCUT_LABELS = {
  'run':            'Run Code',
  'stop':           'Stop Execution',
  'clear':          'Clear Terminal',
  'copy':           'Copy Code',
  'save':           'Save',
  'save-as':        'Save As...',
  'open-file':      'Open File',
  'new-tab':        'New Tab',
  'find-replace':   'Find & Replace',
  'fix-code':       'Fix Code (AI)',
  'font-inc':       'Increase Font Size',
  'font-dec':       'Decrease Font Size',
  'focus-editor':   'Focus Editor',
  'focus-terminal': 'Focus Terminal',
  'toggle-theme':   'Toggle Theme',
  'cmd-palette':    'Command Palette',
  'collab':          'Collab Panel',
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
        showToast(`Conflict: ${label} clashes with: ${conflicts.join(', ')}`, 'error', 4000);
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

    // Escape closes modals (collab panel first, then others)
    if (e.key === 'Escape') {
      if (handleCollabKeydown(e)) return;
      $examplesModal?.classList.add('hidden');
      $shortcutsModal?.classList.add('hidden');
      if (!$cmdPalette?.classList.contains('hidden')) closeCommandPalette();
    }
  });
}

// ── Editable Shortcuts Modal ──────────────────────────────────────────────────
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

// ── Examples ──────────────────────────────────────────────────────────────────
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

// ── Gutter / Panel Resize ─────────────────────────────────────────────────────
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

// ── Unsaved Changes Dialog (Custom Themed) ────────────────────
if (window.electronAPI) {
  // Check if there are unsaved tabs
  window.electronAPI.onCheckUnsaved(() => {
    const hasUnsaved = tabs.some(t => t.unsaved);
    window.electronAPI.sendUnsavedStatus(hasUnsaved);
  });

  // Save then close
  window.electronAPI.onSaveAndClose(async () => {
    saveCode();
    await saveToFile();
    window.electronAPI.sendCloseConfirmed();
  });

  // Build custom unsaved dialog modal
  const unsavedOverlay = document.createElement('div');
  unsavedOverlay.className = 'unsaved-dialog-overlay';
  unsavedOverlay.id = 'unsaved-dialog';
  unsavedOverlay.innerHTML = `
    <div class="unsaved-dialog" role="alertdialog" aria-modal="true" aria-label="Unsaved Changes">
      <div class="unsaved-dialog__header">
        <svg class="unsaved-dialog__graphic" width="44" height="44" viewBox="0 0 44 44" fill="none">
          <rect x="6" y="3" width="22" height="30" rx="2" stroke="#3a3a38" stroke-width="1.5" fill="#1e1e1c"/>
          <rect x="10" y="9" width="14" height="1.5" rx=".75" fill="#3a3a38"/>
          <rect x="10" y="13.5" width="10" height="1.5" rx=".75" fill="#3a3a38"/>
          <rect x="10" y="18" width="12" height="1.5" rx=".75" fill="#3a3a38"/>
          <rect x="10" y="22.5" width="8" height="1.5" rx=".75" fill="#3a3a38"/>
          <circle cx="32" cy="30" r="9" fill="#1a1a18" stroke="#2e2e2c" stroke-width="1.5"/>
          <circle cx="32" cy="30" r="5.5" fill="none" stroke="#ff3300" stroke-width="1.4" stroke-dasharray="3.5 2"/>
          <circle cx="32" cy="30" r="2" fill="#ff3300" class="unsaved-pulse"/>
        </svg>
        <div class="unsaved-dialog__title-group">
          <h3 class="unsaved-dialog__title">Unsaved changes</h3>
          <p class="unsaved-dialog__subtitle">Your edits will be lost if you close without saving.</p>
        </div>
      </div>
      <div class="unsaved-dialog__divider"></div>
      <div class="unsaved-dialog__actions">
        <button class="unsaved-btn unsaved-btn--save" id="unsaved-btn-save">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2.5C2 2.22 2.22 2 2.5 2H8.29L12 5.71V11.5C12 11.78 11.78 12 11.5 12H2.5C2.22 12 2 11.78 2 11.5V2.5Z" stroke="currentColor" stroke-width="1.2"/><rect x="4" y="7.5" width="6" height="4" stroke="currentColor" stroke-width="1"/></svg>
          Save
        </button>
        <button class="unsaved-btn unsaved-btn--discard" id="unsaved-btn-discard">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 3.5H11L10.3 12H3.7L3 3.5Z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/><path d="M2 3.5H12" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M5 2H9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
          Discard
        </button>
        <button class="unsaved-btn unsaved-btn--cancel" id="unsaved-btn-cancel">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M4 4L10 10M10 4L4 10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
          Cancel
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(unsavedOverlay);

  // Show dialog when main process requests
  window.electronAPI.onShowUnsavedDialog(() => {
    unsavedOverlay.classList.add('visible');
    document.getElementById('unsaved-btn-save')?.focus();
  });

  // Button handlers
  document.getElementById('unsaved-btn-save')?.addEventListener('click', () => {
    unsavedOverlay.classList.remove('visible');
    window.electronAPI.sendUnsavedDialogResponse('save');
  });

  document.getElementById('unsaved-btn-discard')?.addEventListener('click', () => {
    unsavedOverlay.classList.remove('visible');
    window.electronAPI.sendUnsavedDialogResponse('discard');
  });

  document.getElementById('unsaved-btn-cancel')?.addEventListener('click', () => {
    unsavedOverlay.classList.remove('visible');
    window.electronAPI.sendUnsavedDialogResponse('cancel');
  });

  // Escape key cancels
  unsavedOverlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      unsavedOverlay.classList.remove('visible');
      window.electronAPI.sendUnsavedDialogResponse('cancel');
    }
  });
}

// ── Landing ripples ──────────────────────────────────────────
document.querySelectorAll('.btn-launch-main, .btn-launch-small').forEach(addRipple);


// ── Theme (now handled by theme-manager.js) ───────────────────
const themeElements = {
  $editorPane: $editorPane,
  $themeIcon: $themeIcon,
  $themeLabel: $themeLabel,
  $statusThemeText: $statusThemeText,
  $themeBtn: $themeBtn,
  $statusTheme: $statusTheme,
};
initTheme(themeElements);

// ── Landing (disabled — direct IDE boot) ───────────────────────
// initLanding($particles);

// ── Pip Manager (now handled by pip-manager.js) ───────────────
pipManager = new PipManager();
pipManager.init();
pipManager.useLocalPython = useLocalPython;
pipManager.terminal = terminal;
pipManager.workerManager = workerManager;

// ── Right-Click Context Menu ─────────────────────────────────
const contextMenu = document.createElement('div');
contextMenu.className = 'theta-context-menu';
contextMenu.id = 'context-menu';
contextMenu.setAttribute('role', 'menu');
contextMenu.setAttribute('aria-label', 'Context menu');
document.body.appendChild(contextMenu);

const CONTEXT_ITEMS = [
  { label: 'Cut', shortcut: 'Ctrl+X', action: () => document.execCommand('cut') },
  { label: 'Copy', shortcut: 'Ctrl+C', action: () => document.execCommand('copy') },
  { label: 'Paste', shortcut: 'Ctrl+V', action: async () => {
    try {
      const text = await navigator.clipboard.readText();
      document.execCommand('insertText', false, text);
    } catch (_) { document.execCommand('paste'); }
  }},
  { type: 'separator' },
  { label: 'Select All', shortcut: 'Ctrl+A', action: () => document.execCommand('selectAll') },
  { type: 'separator' },
  { label: 'Find & Replace', shortcut: 'Ctrl+F', action: () => openFindReplace() },
  { label: 'Run Code', shortcut: 'Ctrl+Enter', action: () => runCode() },
];

function showContextMenu(x, y) {
  contextMenu.innerHTML = '';
  CONTEXT_ITEMS.forEach((item, i) => {
    if (item.type === 'separator') {
      const sep = document.createElement('div');
      sep.className = 'ctx-separator';
      sep.setAttribute('role', 'separator');
      contextMenu.appendChild(sep);
      return;
    }
    const el = document.createElement('div');
    el.className = 'ctx-item';
    el.setAttribute('role', 'menuitem');
    el.setAttribute('tabindex', '-1');

    const label = document.createElement('span');
    label.textContent = item.label;
    el.appendChild(label);

    if (item.shortcut) {
      const key = document.createElement('span');
      key.className = 'ctx-shortcut';
      key.textContent = item.shortcut;
      el.appendChild(key);
    }

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      hideContextMenu();
      item.action();
    });
    contextMenu.appendChild(el);
  });

  // Position
  const maxX = window.innerWidth - 200;
  const maxY = window.innerHeight - contextMenu.offsetHeight - 10;
  contextMenu.style.left = Math.min(x, maxX) + 'px';
  contextMenu.style.top = Math.min(y, maxY) + 'px';
  contextMenu.classList.add('visible');
}

function hideContextMenu() {
  contextMenu.classList.remove('visible');
}

document.querySelector('.cm-editor')?.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  showContextMenu(e.clientX, e.clientY);
});

document.addEventListener('click', hideContextMenu);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideContextMenu();
});

// ── ARIA Accessibility ───────────────────────────────────────
// Add roles and labels to interactive elements
// ($examplesModal, $shortcutsModal, $cmdPalette already declared at top)

$examplesModal?.setAttribute('role', 'dialog');
$examplesModal?.setAttribute('aria-modal', 'true');
$examplesModal?.setAttribute('aria-label', 'Code Examples');

$shortcutsModal?.setAttribute('role', 'dialog');
$shortcutsModal?.setAttribute('aria-modal', 'true');
$shortcutsModal?.setAttribute('aria-label', 'Keyboard Shortcuts');

$cmdPalette?.setAttribute('role', 'dialog');
$cmdPalette?.setAttribute('aria-modal', 'true');
$cmdPalette?.setAttribute('aria-label', 'Command Palette');

// Label icon-only buttons
document.querySelectorAll('[id^="btn-"]').forEach(btn => {
  if (!btn.getAttribute('aria-label')) {
    const text = btn.textContent?.trim() || btn.id.replace('btn-', '').replace(/-/g, ' ');
    btn.setAttribute('aria-label', text);
  }
});

// Make editor tab bar accessible
const $tabBar = document.getElementById('editor-tabs');
$tabBar?.setAttribute('role', 'tablist');
$tabBar?.setAttribute('aria-label', 'Open files');

// Add keyboard navigation to modals (focus trap)
function trapFocus(modal) {
  modal?.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const focusable = modal.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
}

trapFocus($examplesModal);
trapFocus($shortcutsModal);
trapFocus($cmdPalette);

// Skip to editor link (screen readers)
const skipLink = document.createElement('a');
skipLink.href = '#editor-container';
skipLink.className = 'skip-link';
skipLink.textContent = 'Skip to editor';
skipLink.setAttribute('aria-label', 'Skip to code editor');
document.body.insertBefore(skipLink, document.body.firstChild);

