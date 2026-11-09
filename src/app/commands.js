/**
 * Command palette (Ctrl+Shift+P): searchable list of IDE actions.
 */
import { focusEditor } from '../editor.js';
import { $ } from '../core/dom.js';
import { getBindingLabel } from './shortcuts.js';

/** id must match an action key (and a shortcut id when it has one). */
const COMMANDS = [
  { id: 'run',            name: 'Run Code',               icon: '<path d="M4 2.5L12 7L4 11.5V2.5Z" fill="currentColor"/>' },
  { id: 'stop',           name: 'Stop Execution',         icon: '<rect x="3" y="3" width="8" height="8" fill="currentColor"/>' },
  { id: 'clear',          name: 'Clear Terminal',         icon: '<path d="M3 12L12 3M3 3L12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' },
  { id: 'copy',           name: 'Copy Code',              icon: '<rect x="3.5" y="3.5" width="7" height="7" stroke="currentColor" stroke-width="1.2"/><path d="M3.5 3.5V2A1 1 0 012 1H1V8A1 1 0 002 9H3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>' },
  { id: 'save',           name: 'Save File',              icon: '<path d="M2 3H9L12 6V13H2V3Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><rect x="4" y="8" width="6" height="5" stroke="currentColor" stroke-width="1.1"/>' },
  { id: 'save-as',        name: 'Save As...',             icon: '<path d="M2 3H9L12 6V13H2V3Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M7 1V5M5 3H9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>' },
  { id: 'open-file',      name: 'Open File...',           icon: '<path d="M2 4H5L7 2H12V12H2V4Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>' },
  { id: 'find-replace',   name: 'Find & Replace',         icon: '<circle cx="6" cy="6" r="4" stroke="currentColor" stroke-width="1.2"/><path d="M9 9L13 13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' },
  { id: 'examples',       name: 'Browse Examples',        icon: '<rect x="2" y="2" width="10" height="10" stroke="currentColor" stroke-width="1.2"/><path d="M5 5H9M5 7H7M5 9H8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>' },
  { id: 'new-tab',        name: 'New Tab',                icon: '<path d="M7 3V11M3 7H11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' },
  { id: 'fix-code',       name: 'Fix Code (AI)',          icon: '<path d="M2 2L5 6L2 10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 6H11" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><circle cx="10" cy="2" r="1.2" stroke="currentColor" stroke-width="0.8" fill="none"/>' },
  { id: 'focus-editor',   name: 'Focus Editor',           icon: '<path d="M2.5 4L5.5 7L2.5 10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 10H10.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' },
  { id: 'focus-terminal', name: 'Focus Terminal',         icon: '<rect x="1" y="1" width="12" height="12" stroke="currentColor" stroke-width="1.2"/><path d="M3.5 4.5L6 7L3.5 9.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>' },
  { id: 'font-inc',       name: 'Increase Font Size',     icon: '<path d="M3 2.5H8M5.5 2.5V7.5M3 10H8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>' },
  { id: 'font-dec',       name: 'Decrease Font Size',     icon: '<path d="M3 5H8M3 9H8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>' },
  { id: 'reset-code',     name: 'Reset to Starter Code',  icon: '<path d="M2 7C2 4.2 4.2 2 7 2s5 2.2 5 5-2.2 5-5 5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M2 4V7H5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>' },
  { id: 'toggle-theme',   name: 'Toggle Editor Theme',    icon: '<circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.2"/><path d="M7 2A5 5 0 017 12V2Z" fill="currentColor"/>' },
  { id: 'open-folder',    name: 'Open Folder…',           icon: '<path d="M1.5 3.5h4l1.5 1.5h5.5v7h-11Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>' },
  { id: 'close-folder',   name: 'Close Folder',           icon: '<path d="M1.5 3.5h4l1.5 1.5h5.5v7h-11Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M5.5 7.5l3 3m0-3-3 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>' },
  { id: 'new-file',       name: 'New File in Project',    icon: '<path d="M3 1.5h5l3 3v8H3Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M7 6.5v4M5 8.5h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>' },
  { id: 'search-files',   name: 'Search in Project',      icon: '<circle cx="6" cy="6" r="4" stroke="currentColor" stroke-width="1.2"/><path d="M9 9l3.5 3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M4 6h4" stroke="currentColor" stroke-width="1.2"/>' },
  { id: 'toggle-sidebar', name: 'Show / Hide Sidebar',    icon: '<rect x="1.5" y="2.5" width="11" height="9" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M5 2.5v9" stroke="currentColor" stroke-width="1.2"/>' },
  { id: 'toggle-split',   name: 'Split Editor',           icon: '<rect x="1.5" y="2.5" width="11" height="9" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M7 2.5v9" stroke="currentColor" stroke-width="1.2"/>' },
  { id: 'open-shell',     name: 'Open Terminal (Shell)',  icon: '<rect x="1" y="2" width="12" height="10" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M3.5 5.5 5.5 7.5 3.5 9.5M7 9.5h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>' },
  { id: 'switch-theme',   name: 'Switch Theme (Playground / Pro)', icon: '<rect x="1.5" y="2.5" width="11" height="9" rx="2" stroke="currentColor" stroke-width="1.2"/><path d="M7 2.5v9" stroke="currentColor" stroke-width="1.2"/><path d="M2 3h5v8H2Z" fill="currentColor" opacity=".4"/>' },
  { id: 'toggle-fx',      name: 'Toggle Pixel Effects',   icon: '<rect x="2" y="2" width="4" height="4" fill="currentColor"/><rect x="8" y="8" width="4" height="4" fill="currentColor"/><rect x="8" y="2" width="4" height="4" stroke="currentColor" stroke-width="1"/>' },
  { id: 'settings',       name: 'Open Settings',          icon: '<path d="M2 4H8M11 4H12M2 10H4M7 10H12" stroke="currentColor" stroke-width="1.2"/><rect x="8" y="2.5" width="3" height="3" stroke="currentColor" stroke-width="1.1"/><rect x="4" y="8.5" width="3" height="3" stroke="currentColor" stroke-width="1.1"/>' },
  { id: 'cmd-palette',    name: 'Command Palette',       icon: '<circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.2"/><path d="M10.5 10.5L13 13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' },
];

let actions = {};
let filtered = [...COMMANDS];
let selected = 0;

export function filterCommands(query) {
  const q = query.trim().toLowerCase();
  return q ? COMMANDS.filter((c) => c.name.toLowerCase().includes(q)) : [...COMMANDS];
}

export function isPaletteOpen() {
  return !$('cmd-palette')?.classList.contains('hidden');
}

export function openCommandPalette() {
  const $input = $('cmd-input');
  $('cmd-palette')?.classList.remove('hidden');
  if (!$input) return;
  $input.value = '';
  filtered = filterCommands('');
  selected = 0;
  render();
  setTimeout(() => $input.focus(), 50);
}

export function closeCommandPalette() {
  $('cmd-palette')?.classList.add('hidden');
  focusEditor();
}

export function toggleCommandPalette() {
  if (isPaletteOpen()) closeCommandPalette();
  else openCommandPalette();
}

function execute(cmd) {
  closeCommandPalette();
  actions[cmd.id]?.();
}

function render() {
  const $results = $('cmd-results');
  if (!$results) return;
  $results.innerHTML = '';

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'cmd-empty';
    empty.textContent = 'No commands found';
    $results.appendChild(empty);
    return;
  }

  filtered.forEach((cmd, i) => {
    const el = document.createElement('div');
    el.className = 'cmd-result-item' + (i === selected ? ' active' : '');
    el.setAttribute('role', 'option');
    el.setAttribute('aria-selected', String(i === selected));

    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('class', 'cmd-result-icon');
    icon.setAttribute('width', '14');
    icon.setAttribute('height', '14');
    icon.setAttribute('viewBox', '0 0 14 14');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = cmd.icon; // trusted constant

    const name = document.createElement('span');
    name.className = 'cmd-result-name';
    name.textContent = cmd.name;
    el.append(icon, name);

    const key = getBindingLabel(cmd.id);
    if (key) {
      const keyEl = document.createElement('span');
      keyEl.className = 'cmd-result-key';
      keyEl.textContent = key;
      el.appendChild(keyEl);
    }

    el.addEventListener('click', () => execute(cmd));
    el.addEventListener('mouseenter', () => {
      if (selected === i) return;
      selected = i;
      render();
    });
    $results.appendChild(el);
  });
}

export function initCommandPalette(actionMap) {
  actions = actionMap;
  const $input = $('cmd-input');
  $('cmd-results')?.setAttribute('role', 'listbox');

  $input?.addEventListener('input', (e) => {
    filtered = filterCommands(e.target.value);
    selected = 0;
    render();
  });

  $input?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') return closeCommandPalette();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      selected = Math.max(0, Math.min(filtered.length - 1, selected + step));
      render();
      return;
    }
    if (e.key === 'Enter' && filtered[selected]) execute(filtered[selected]);
  });

  document.querySelector('#cmd-palette .cmd-palette-backdrop')?.addEventListener('click', closeCommandPalette);
}
