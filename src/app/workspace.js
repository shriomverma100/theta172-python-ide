/**
 * Workspace explorer: the project folder as a file tree.
 * Open a folder, browse it, open files in tabs, create / rename / move
 * (drag and drop) / delete (to the Recycle Bin), and see Git status.
 * Every path is checked again in the main process (electron/workspace.cjs).
 */
import { showToast } from '../toast.js';
import { $ } from '../core/dom.js';
import {
  openFileTab, retargetTabs, detachTabs, findTabByPath, reloadTab, getActiveFilePath, closeTabsUnder,
} from './tabs.js';

const ws = {
  root: null,          // absolute path of the open folder
  name: '',
  expanded: new Set(), // folder paths that are open in the tree
  children: new Map(), // folder path -> entries
  git: null,           // { branch, files: { rel: code } }
};
const listeners = new Set();

const api = () => window.electronAPI;
const SEP = () => (ws.root && ws.root.includes('\\') ? '\\' : '/');
const isWin = () => SEP() === '\\';
const norm = (p) => (isWin() ? p.toLowerCase() : p);

export function getWorkspaceRoot() { return ws.root; }
export function onWorkspaceChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const fileListeners = new Set();
/** fn(paths) for files changed on disk inside the project (the language server listens). */
export function onFilesChanged(fn) { fileListeners.add(fn); return () => fileListeners.delete(fn); }
function emit() { listeners.forEach((fn) => fn({ root: ws.root, name: ws.name })); }

/** True when `p` is inside the open folder. */
export function isInWorkspace(p) {
  if (!ws.root || !p) return false;
  const r = norm(ws.root), q = norm(p);
  return q === r || q.startsWith(r + SEP());
}

/** Path relative to the project folder (for tracebacks and labels). */
export function relativePath(p) {
  return isInWorkspace(p) ? p.slice(ws.root.length + 1) : p;
}

async function call(method, ...args) {
  const res = await api()?.[method]?.(...args);
  if (!res) return { ok: false, error: 'Not available in the browser version.' };
  return res;
}

// ── Open / close ────────────────────────────────────────────────
async function setOpened(info) {
  ws.root = info.root;
  ws.name = info.name;
  ws.expanded = new Set([info.root]);
  ws.children.clear();
  await loadDir(info.root);
  render();
  refreshGit();
  emit();
}

export async function openFolder() {
  const res = await call('wsOpenFolder');
  if (!res.ok) { showToast(res.error, 'error', 3000); return false; }
  if (!res.value) return false; // cancelled
  await setOpened(res.value);
  showToast(`Opened ${res.value.name}`, 'success', 1800);
  return true;
}

/** Reopen last session's folder (the main process remembers which). */
export async function reopenFolder() {
  const res = await call('wsReopen');
  if (res.ok && res.value) await setOpened(res.value);
  return !!(res.ok && res.value);
}

/** Close the project folder and its tabs. Returns false if the user cancelled. */
export async function closeFolder() {
  if (!ws.root) return true;
  if (!closeTabsUnder(ws.root)) return false;
  const name = ws.name;
  await call('wsClose');
  ws.root = null;
  ws.children.clear();
  ws.git = null;
  ws.expanded = new Set();
  render();
  emit();
  showToast(`Closed ${name}`, 'info', 1600);
  return true;
}

// ── Tree data ───────────────────────────────────────────────────
async function loadDir(dir) {
  const res = await call('wsList', dir);
  if (res.ok) ws.children.set(dir, res.value);
  else ws.children.delete(dir);
}

/** Reload every open folder (after a change on disk). */
export async function refreshTree() {
  if (!ws.root) return;
  for (const dir of [...ws.expanded]) {
    if (dir === ws.root || isInWorkspace(dir)) await loadDir(dir);
  }
  for (const dir of [...ws.expanded]) if (!ws.children.has(dir)) ws.expanded.delete(dir);
  render();
}

let gitTimer = null;
export function refreshGit() {
  clearTimeout(gitTimer);
  gitTimer = setTimeout(async () => {
    const res = await call('wsGit');
    ws.git = res.ok ? res.value : null;
    renderGit();
    render();
  }, 120);
}

// ── Rendering ───────────────────────────────────────────────────
const CHEVRON = '<svg class="ws-row__chev" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5 8 6l-3.5 3.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function iconClass(entry) {
  if (entry.type === 'dir') return 'is-dir';
  const ext = entry.name.split('.').pop().toLowerCase();
  if (ext === 'py' || ext === 'pyw') return 'is-py';
  if (ext === 'ipynb') return 'is-nb';
  if (['csv', 'json', 'tsv', 'xlsx', 'parquet', 'txt'].includes(ext)) return 'is-data';
  return '';
}

function gitCode(entry) {
  const files = ws.git?.files;
  if (!files) return '';
  const rel = relativePath(entry.path);
  if (entry.type === 'file') return files[rel] || '';
  // A folder shows "•" when something inside it changed
  const prefix = rel + SEP();
  return Object.keys(files).some((f) => f.startsWith(prefix)) ? '•' : '';
}

function renderGit() {
  const $git = $('ws-git');
  if (!$git) return;
  if (!ws.git?.branch) { $git.classList.add('hidden'); return; }
  const changed = Object.keys(ws.git.files).length;
  $git.textContent = `⎇ ${ws.git.branch}${changed ? ` · ${changed} changed` : ''}`;
  $git.classList.remove('hidden');
}

function rowFor(entry, depth) {
  const li = document.createElement('li');
  li.setAttribute('role', 'none');

  const row = document.createElement('div');
  row.className = 'ws-row';
  row.setAttribute('role', 'treeitem');
  row.tabIndex = -1;
  row.dataset.path = entry.path;
  row.dataset.type = entry.type;
  row.style.paddingLeft = `${8 + depth * 14}px`;
  row.draggable = true;
  if (entry.heavy) row.classList.add('is-heavy');
  if (entry.type === 'dir') row.setAttribute('aria-expanded', String(ws.expanded.has(entry.path)));
  const active = getActiveFilePath();
  if (entry.type === 'file' && active && norm(active) === norm(entry.path)) row.classList.add('is-open');

  if (entry.type === 'dir') row.insertAdjacentHTML('beforeend', CHEVRON);
  else { const pad = document.createElement('span'); pad.style.width = '12px'; pad.style.flex = 'none'; row.appendChild(pad); }
  const icon = document.createElement('span');
  icon.className = `ws-row__icon ${iconClass(entry)}`;
  const name = document.createElement('span');
  name.className = 'ws-row__name';
  name.textContent = entry.name;
  const git = document.createElement('span');
  const code = gitCode(entry);
  git.className = `ws-row__git ${code === '•' ? 'M' : code}`;
  git.textContent = code;
  if (code && code !== '•') git.title = { M: 'Modified', U: 'New, not tracked by Git', A: 'Added', D: 'Deleted', R: 'Renamed' }[code] || '';
  row.append(icon, name, git);
  li.appendChild(row);

  if (entry.type === 'dir' && ws.expanded.has(entry.path)) {
    const kids = ws.children.get(entry.path) || [];
    const ul = document.createElement('ul');
    ul.setAttribute('role', 'group');
    kids.forEach((k) => ul.appendChild(rowFor(k, depth + 1)));
    li.appendChild(ul);
  }
  return li;
}

export function render() {
  const $tree = $('ws-tree');
  const $empty = $('ws-empty');
  const $project = $('ws-project');
  if (!$tree) return;
  const focused = document.activeElement?.closest?.('.ws-row')?.dataset.path;

  $empty?.classList.toggle('hidden', !!ws.root);
  $project?.classList.toggle('hidden', !ws.root);
  const $name = $('ws-project-name');
  if ($name) { $name.textContent = ws.name; $name.title = ws.root || ''; }
  $tree.replaceChildren(...(ws.root ? (ws.children.get(ws.root) || []).map((e) => rowFor(e, 0)) : []));

  // Keep keyboard focus where it was
  const rows = [...$tree.querySelectorAll('.ws-row')];
  const target = rows.find((r) => r.dataset.path === focused) || rows.find((r) => r.classList.contains('is-open')) || rows[0];
  if (target) target.tabIndex = 0;
  if (focused && target?.dataset.path === focused) target.focus();
}

// ── Actions ─────────────────────────────────────────────────────
export async function openPath(path, line) {
  const open = findTabByPath(path);
  if (open) { openFileTab(path, null, line); render(); return; }
  const res = await call('wsRead', path);
  if (!res.ok) { showToast(res.error, 'error', 3000); return; }
  openFileTab(path, res.value, line);
  render();
}

async function toggleDir(path) {
  if (ws.expanded.has(path)) ws.expanded.delete(path);
  else {
    ws.expanded.add(path);
    if (!ws.children.has(path)) await loadDir(path);
  }
  render();
}

export function collapseAll() {
  ws.expanded = new Set([ws.root]);
  render();
}

const parentOf = (p) => p.slice(0, p.lastIndexOf(SEP()));

/** Where "New file" goes: the selected folder, the selected file's folder, or the root. */
function targetDir() {
  const row = document.querySelector('#ws-tree .ws-row:focus') || document.querySelector('#ws-tree .ws-row[tabindex="0"]');
  if (!row) return ws.root;
  return row.dataset.type === 'dir' ? row.dataset.path : parentOf(row.dataset.path);
}

/** Show an inline name box in the tree; resolves with the typed name or null. */
function askName({ dir, initial = '', afterPath = null }) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.className = 'ws-rename';
    input.value = initial;
    input.setAttribute('aria-label', 'Name');
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      input.remove();
      resolve(value && value.trim() ? value.trim() : null);
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(input.value);
      else if (e.key === 'Escape') finish(null);
    });
    input.addEventListener('blur', () => finish(input.value));

    if (afterPath) {
      // Rename in place: swap the row's name for the input
      const row = document.querySelector(`#ws-tree .ws-row[data-path="${CSS.escape(afterPath)}"]`);
      const nameEl = row?.querySelector('.ws-row__name');
      if (!nameEl) return finish(null);
      nameEl.replaceWith(input);
    } else {
      // New item: a temporary row at the top of the folder
      const host = dir === ws.root ? $('ws-tree') : document.querySelector(`#ws-tree .ws-row[data-path="${CSS.escape(dir)}"]`)?.parentElement?.querySelector('ul');
      const li = document.createElement('li');
      const row = document.createElement('div');
      row.className = 'ws-row';
      row.style.paddingLeft = '22px';
      row.appendChild(input);
      li.appendChild(row);
      (host || $('ws-tree')).prepend(li);
      input.addEventListener('blur', () => li.remove(), { once: true });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') li.remove(); });
    }
    input.focus();
    const dot = initial.lastIndexOf('.');
    input.setSelectionRange(0, dot > 0 ? dot : initial.length);
  });
}

export async function createItem(type) {
  if (!ws.root) { await openFolder(); if (!ws.root) return; }
  const dir = targetDir();
  if (!ws.expanded.has(dir)) { ws.expanded.add(dir); await loadDir(dir); render(); }
  const name = await askName({ dir, initial: type === 'file' ? 'new_file.py' : 'new_folder' });
  if (!name) return;
  const res = await call('wsCreate', dir, name, type);
  if (!res.ok) { showToast(res.error, 'error', 3000); return; }
  await loadDir(dir);
  render();
  refreshGit();
  if (type === 'file') openPath(res.value);
}

async function renameItem(path) {
  const oldName = path.slice(path.lastIndexOf(SEP()) + 1);
  const name = await askName({ initial: oldName, afterPath: path });
  if (!name || name === oldName) { render(); return; }
  const res = await call('wsRename', path, name);
  if (!res.ok) { showToast(res.error, 'error', 3000); render(); return; }
  retargetTabs(path, res.value);
  remapExpanded(path, res.value);
  await refreshTree();
  refreshGit();
}

async function deleteItem(path, type) {
  const name = path.slice(path.lastIndexOf(SEP()) + 1);
  const what = type === 'dir' ? `the folder "${name}" and everything in it` : `"${name}"`;
  if (!window.confirm(`Move ${what} to the Recycle Bin?`)) return;
  const res = await call('wsDelete', path);
  if (!res.ok) { showToast(res.error, 'error', 3000); return; }
  detachTabs(path);
  ws.expanded.delete(path);
  await refreshTree();
  refreshGit();
  showToast(`Moved ${name} to the Recycle Bin`, 'info', 2200);
}

async function moveItem(path, destDir) {
  const res = await call('wsMove', path, destDir);
  if (!res.ok) { showToast(res.error, 'error', 3000); return; }
  if (res.value === path) return;
  retargetTabs(path, res.value);
  remapExpanded(path, res.value);
  ws.expanded.add(destDir);
  await loadDir(destDir);
  await refreshTree();
  refreshGit();
}

function remapExpanded(from, to) {
  const next = new Set();
  for (const p of ws.expanded) {
    if (norm(p) === norm(from)) next.add(to);
    else if (norm(p).startsWith(norm(from) + SEP())) next.add(to + p.slice(from.length));
    else next.add(p);
  }
  ws.expanded = next;
}

// ── Context menu ────────────────────────────────────────────────
let menu = null;
function closeMenu() { menu?.remove(); menu = null; }

function showMenu(x, y, row) {
  closeMenu();
  const path = row?.dataset.path || ws.root;
  const type = row?.dataset.type || 'dir';
  const items = [
    ['New file', () => { row?.focus(); createItem('file'); }],
    ['New folder', () => { row?.focus(); createItem('dir'); }],
    null,
    ...(row ? [
      ['Rename', () => renameItem(path), 'F2'],
      ['Delete', () => deleteItem(path, type), 'Del'],
      null,
    ] : []),
    ['Copy path', () => navigator.clipboard.writeText(path)],
    ['Copy relative path', () => navigator.clipboard.writeText(relativePath(path) || '.')],
    ['Show in File Explorer', () => call('wsReveal', path)],
    null,
    ['Close folder', () => closeFolder()],
  ];
  menu = document.createElement('div');
  menu.className = 'theta-context-menu visible';
  menu.setAttribute('role', 'menu');
  for (const it of items) {
    if (!it) { const sep = document.createElement('div'); sep.className = 'ctx-separator'; menu.appendChild(sep); continue; }
    const [label, fn, key] = it;
    const el = document.createElement('div');
    el.className = 'ctx-item';
    el.setAttribute('role', 'menuitem');
    el.tabIndex = -1;
    const span = document.createElement('span');
    span.textContent = label;
    el.appendChild(span);
    if (key) { const k = document.createElement('span'); k.className = 'ctx-shortcut'; k.textContent = key; el.appendChild(k); }
    el.addEventListener('click', () => { closeMenu(); fn(); });
    menu.appendChild(el);
  }
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - r.width - 8)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - r.height - 8)}px`;
}

// ── Wiring ──────────────────────────────────────────────────────
export function initWorkspace() {
  const $tree = $('ws-tree');
  $('ws-open')?.addEventListener('click', openFolder);
  $('ws-close')?.addEventListener('click', closeFolder);
  $('ws-new-file')?.addEventListener('click', () => createItem('file'));
  $('ws-new-folder')?.addEventListener('click', () => createItem('dir'));
  $('ws-refresh')?.addEventListener('click', () => { refreshTree(); refreshGit(); });
  $('ws-collapse')?.addEventListener('click', collapseAll);
  document.addEventListener('click', (e) => { if (menu && !menu.contains(e.target)) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  if (!$tree) return;

  $tree.addEventListener('click', (e) => {
    const row = e.target.closest('.ws-row');
    if (!row?.dataset.path || e.target.closest('.ws-rename')) return;
    $tree.querySelectorAll('.ws-row').forEach((r) => { r.tabIndex = -1; });
    row.tabIndex = 0;
    row.focus();
    if (row.dataset.type === 'dir') toggleDir(row.dataset.path);
    else openPath(row.dataset.path);
  });

  $tree.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const row = e.target.closest('.ws-row');
    if (row) row.focus();
    if (ws.root) showMenu(e.clientX, e.clientY, row?.dataset.path ? row : null);
  });

  // Keyboard: ↑/↓ move, → open folder, ← close folder, Enter open, F2 rename, Delete
  $tree.addEventListener('keydown', (e) => {
    const row = e.target.closest('.ws-row');
    if (!row || e.target.closest('.ws-rename')) return;
    const rows = [...$tree.querySelectorAll('.ws-row[data-path]')];
    const i = rows.indexOf(row);
    const move = (j) => { const r = rows[Math.max(0, Math.min(rows.length - 1, j))]; rows.forEach((x) => { x.tabIndex = -1; }); r.tabIndex = 0; r.focus(); };
    const path = row.dataset.path;
    const isDir = row.dataset.type === 'dir';
    if (e.key === 'ArrowDown') { e.preventDefault(); move(i + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(i - 1); }
    else if (e.key === 'ArrowRight' && isDir && !ws.expanded.has(path)) { e.preventDefault(); toggleDir(path); }
    else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (isDir && ws.expanded.has(path)) toggleDir(path);
      else { const parent = rows.find((r) => r.dataset.path === parentOf(path)); if (parent) move(rows.indexOf(parent)); }
    }
    else if (e.key === 'Enter') { e.preventDefault(); if (isDir) toggleDir(path); else openPath(path); }
    else if (e.key === 'F2') { e.preventDefault(); renameItem(path); }
    else if (e.key === 'Delete') { e.preventDefault(); deleteItem(path, row.dataset.type); }
  });

  // Drag a row onto a folder (or empty space = the project folder) to move it
  let dragged = null;
  $tree.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.ws-row');
    dragged = row?.dataset.path || null;
    if (dragged) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragged); }
  });
  const dropDir = (e) => {
    const row = e.target.closest('.ws-row[data-path]');
    if (!row) return ws.root;
    return row.dataset.type === 'dir' ? row.dataset.path : parentOf(row.dataset.path);
  };
  $tree.addEventListener('dragover', (e) => {
    if (!dragged) return;
    e.preventDefault();
    $tree.querySelectorAll('.drop-target').forEach((r) => r.classList.remove('drop-target'));
    const dir = dropDir(e);
    document.querySelector(`#ws-tree .ws-row[data-path="${CSS.escape(dir)}"]`)?.classList.add('drop-target');
  });
  $tree.addEventListener('dragleave', (e) => { if (!$tree.contains(e.relatedTarget)) $tree.querySelectorAll('.drop-target').forEach((r) => r.classList.remove('drop-target')); });
  $tree.addEventListener('drop', (e) => {
    e.preventDefault();
    $tree.querySelectorAll('.drop-target').forEach((r) => r.classList.remove('drop-target'));
    const from = dragged;
    dragged = null;
    if (from) moveItem(from, dropDir(e));
  });
  $tree.addEventListener('dragend', () => { dragged = null; });

  // Changes on disk (other programs, git, our own saves)
  let timer = null;
  api()?.onWsChanged?.(async (paths) => {
    fileListeners.forEach((fn) => fn(paths || []));
    clearTimeout(timer);
    timer = setTimeout(async () => {
      await refreshTree();
      refreshGit();
      // Files changed outside the editor: reload open tabs that have no unsaved edits
      for (const p of paths || []) {
        const tab = findTabByPath(p);
        if (tab && !tab.unsaved) {
          const res = await call('wsRead', p);
          if (res.ok) reloadTab(p, res.value);
        }
      }
    }, 150);
  });
}
