/**
 * Editable keyboard shortcuts: defaults, persistence, matching,
 * the "Keyboard Shortcuts" modal and the global keydown handler.
 */
import { showToast } from '../toast.js';
import { $ } from '../core/dom.js';
import { storageGet, storageSet } from '../core/storage.js';

export const DEFAULT_SHORTCUTS = {
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
  'open-folder':    { ctrl: true, shift: true,  alt: false, key: 'o' },
  'search-files':   { ctrl: true, shift: true,  alt: false, key: 'f' },
  'toggle-sidebar': { ctrl: true, shift: false, alt: false, key: 'b' },
  'toggle-split':   { ctrl: true, shift: false, alt: false, key: '\\' },
  'open-shell':     { ctrl: true, shift: false, alt: false, key: '`' },
  // Language intelligence (Phase 4)
  'go-definition':    { ctrl: false, shift: false, alt: false, key: 'F12' },
  'find-references':  { ctrl: false, shift: true,  alt: false, key: 'F12' },
  'rename-symbol':    { ctrl: false, shift: false, alt: false, key: 'F2' },
  'format-document':  { ctrl: false, shift: true,  alt: true,  key: 'f' },
  'go-symbol':        { ctrl: true,  shift: false, alt: false, key: 'r' },
  'workspace-symbol': { ctrl: true,  shift: true,  alt: false, key: 'r' },
  'show-problems':    { ctrl: true,  shift: true,  alt: false, key: 'm' },
  // Debugger (Phase 5)
  'debug-start':       { ctrl: false, shift: false, alt: false, key: 'F5' },
  'debug-stop':        { ctrl: false, shift: true,  alt: false, key: 'F5' },
  'debug-restart':     { ctrl: true,  shift: true,  alt: false, key: 'F5' },
  'debug-pause':       { ctrl: false, shift: false, alt: false, key: 'F6' },
  'step-over':         { ctrl: false, shift: false, alt: false, key: 'F10' },
  'step-into':         { ctrl: false, shift: false, alt: false, key: 'F11' },
  'step-out':          { ctrl: false, shift: true,  alt: false, key: 'F11' },
  'toggle-breakpoint': { ctrl: false, shift: false, alt: false, key: 'F9' },
  'study-mode':        { ctrl: true,  shift: true,  alt: false, key: 'l' },
  'source-control':    { ctrl: true,  shift: true,  alt: false, key: 'g' },
  // Editor groups (Phase 7)
  'move-editor-right': { ctrl: true,  shift: false, alt: true,  key: 'ArrowRight' },
  'move-editor-left':  { ctrl: true,  shift: false, alt: true,  key: 'ArrowLeft' },
  'focus-other-group': { ctrl: true,  shift: false, alt: false, key: 'k' },
  // Files and tabs
  'save-all':          { ctrl: true,  shift: false, alt: true,  key: 's' },
  'close-editor':      { ctrl: true,  shift: false, alt: false, key: 'w' },
  'reopen-closed':     { ctrl: true,  shift: true,  alt: false, key: 't' },
  'next-tab':          { ctrl: true,  shift: false, alt: false, key: 'Tab' },
  'prev-tab':          { ctrl: true,  shift: true,  alt: false, key: 'Tab' },
  'go-to-line':        { ctrl: true,  shift: false, alt: false, key: 'g' },
};

export const SHORTCUT_LABELS = {
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
  'open-folder':    'Open Folder',
  'search-files':   'Search in Project',
  'toggle-sidebar': 'Show / Hide Sidebar',
  'toggle-split':   'Split Editor',
  'open-shell':     'Open Terminal',
  'go-definition':    'Go to Definition',
  'find-references':  'Find All References',
  'rename-symbol':    'Rename Symbol',
  'format-document':  'Format Document',
  'go-symbol':        'Go to Symbol in File',
  'workspace-symbol': 'Go to Symbol in Project',
  'show-problems':    'Show Problems',
  'debug-start':       'Start Debugging / Continue',
  'debug-stop':        'Stop Debugging',
  'debug-restart':     'Restart Debugging',
  'debug-pause':       'Pause',
  'step-over':         'Step Over',
  'step-into':         'Step Into',
  'step-out':          'Step Out',
  'toggle-breakpoint': 'Toggle Breakpoint',
  'study-mode':        'Study Mode',
  'source-control':    'Source Control (Git)',
  'move-editor-right': 'Move Editor to the Right Group',
  'move-editor-left':  'Move Editor to the Left Group',
  'focus-other-group': 'Focus the Other Editor Group',
  'save-all':          'Save All',
  'close-editor':      'Close Editor',
  'reopen-closed':     'Reopen Closed Editor',
  'next-tab':          'Next Tab',
  'prev-tab':          'Previous Tab',
  'go-to-line':        'Go to Line',
};

const KEY_NAMES = {
  ' ': 'Space',
  Escape: 'Esc',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

/** Ctrl+C / V / X / A / Z / Y keep their native meaning inside editors. */
const NATIVE_EDIT_KEYS = ['c', 'v', 'x', 'a', 'z', 'y'];

const clone = (obj) => JSON.parse(JSON.stringify(obj));

function loadBindings() {
  try {
    const saved = storageGet('theta-shortcuts');
    if (saved) return { ...clone(DEFAULT_SHORTCUTS), ...JSON.parse(saved) };
  } catch (_) { /* corrupt storage: use defaults */ }
  return clone(DEFAULT_SHORTCUTS);
}

let bindings = loadBindings();
let recordingId = null;

function persist() {
  storageSet('theta-shortcuts', JSON.stringify(bindings));
}

export function getBindingLabel(id) {
  return bindingToString(bindings[id]);
}

export function bindingToString(b) {
  if (!b) return '';
  const parts = [];
  if (b.ctrl) parts.push('Ctrl');
  if (b.shift) parts.push('Shift');
  if (b.alt) parts.push('Alt');
  let key = KEY_NAMES[b.key] ?? b.key;
  if (key.length === 1) key = key.toUpperCase();
  parts.push(key);
  return parts.join('+');
}

export function eventMatchesBinding(e, binding) {
  if (!binding) return false;
  const ctrlOrCmd = e.ctrlKey || e.metaKey; // Cmd maps to Ctrl on macOS
  return (
    ctrlOrCmd === binding.ctrl &&
    e.shiftKey === binding.shift &&
    e.altKey === binding.alt &&
    e.key.toLowerCase() === binding.key.toLowerCase()
  );
}

export function resetShortcuts() {
  bindings = clone(DEFAULT_SHORTCUTS);
  persist();
  renderShortcutsModal();
  showToast('Shortcuts reset to defaults', 'info', 2000);
}

export function cancelRecording() {
  recordingId = null;
  renderShortcutsModal();
}

function startRecording(id) {
  recordingId = id;
  renderShortcutsModal();
}

function recordBinding(e) {
  e.preventDefault();
  e.stopPropagation();
  if (e.key === 'Escape') return cancelRecording();
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return; // wait for the real key

  const next = { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey, key: e.key };
  bindings[recordingId] = next;

  const label = bindingToString(next);
  const conflicts = Object.entries(bindings)
    .filter(([id, b]) => id !== recordingId && b.ctrl === next.ctrl && b.shift === next.shift &&
      b.alt === next.alt && b.key.toLowerCase() === next.key.toLowerCase())
    .map(([id]) => SHORTCUT_LABELS[id] || id);

  persist();
  if (conflicts.length) showToast(`Conflict: ${label} clashes with: ${conflicts.join(', ')}`, 'error', 4000);
  else showToast(`Shortcut updated: ${label}`, 'success', 2000);

  recordingId = null;
  renderShortcutsModal();
}

export function renderShortcutsModal() {
  const $list = $('shortcuts-list');
  if (!$list) return;
  $list.innerHTML = '';

  for (const [id, label] of Object.entries(SHORTCUT_LABELS)) {
    const item = document.createElement('div');
    item.className = 'shortcut-item';

    const labelEl = document.createElement('span');
    labelEl.className = 'shortcut-item__label';
    labelEl.textContent = label;

    const right = document.createElement('div');
    right.className = 'shortcut-item__right';

    const keysEl = document.createElement('div');
    keysEl.className = 'shortcut-keys';
    keysEl.title = 'Click to edit';

    if (recordingId === id) {
      keysEl.classList.add('recording');
      const hint = document.createElement('span');
      hint.className = 'shortcut-recording-hint';
      hint.textContent = 'Press keys...';
      keysEl.appendChild(hint);
    } else {
      bindingToString(bindings[id]).split('+').forEach((k) => {
        const kbd = document.createElement('kbd');
        kbd.textContent = k;
        keysEl.appendChild(kbd);
      });
    }
    keysEl.addEventListener('click', () => startRecording(id));

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'shortcut-edit-btn';
    editBtn.title = 'Edit shortcut';
    editBtn.setAttribute('aria-label', `Edit shortcut for ${label}`);
    editBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M7.5 2.5L9.5 4.5M2 8L1.5 10.5L4 10L9.5 4.5L7.5 2.5L2 8Z" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/></svg>';
    editBtn.addEventListener('click', () => startRecording(id));

    right.append(keysEl, editBtn);
    item.append(labelEl, right);
    $list.appendChild(item);
  }
}

/**
 * Global keydown handler.
 * @param {Record<string, Function>} actions  shortcut id -> action
 * @param {object} opts
 * @param {() => boolean} opts.isRunning     code is executing (Ctrl+C stops it)
 * @param {(e: KeyboardEvent) => void} opts.onEscape
 */
export function initShortcuts(actions, { isRunning, onEscape }) {
  const $ide = $('ide');

  document.addEventListener('keydown', (e) => {
    if (recordingId) return recordBinding(e);
    if ($ide?.classList.contains('hidden')) return;

    const active = document.activeElement;
    const inEditor = !!active?.closest?.('.cm-editor');
    const inTextInput = active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA' ||
      active?.getAttribute?.('contenteditable') === 'true';
    const editable = inEditor || inTextInput;

    for (const [id, binding] of Object.entries(bindings)) {
      if (!eventMatchesBinding(e, binding)) continue;

      // Keep native copy/paste/undo in editable areas, except Ctrl+C
      // while code runs (it stops the program, like a real terminal).
      if (editable && binding.ctrl && !binding.alt && NATIVE_EDIT_KEYS.includes(binding.key.toLowerCase())) {
        if (id === 'stop' && isRunning()) {
          e.preventDefault();
          actions[id]?.();
        }
        return;
      }

      e.preventDefault();
      actions[id]?.();
      return;
    }

    if (e.key === 'Escape') onEscape(e);
  });
}
