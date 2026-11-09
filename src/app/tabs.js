/**
 * Editor tabs. Each tab keeps its code, file path and full editor state
 * (so undo history survives tab switches). The active tab's filePath is
 * the single source of truth for "where does Save write".
 *
 * Phase 2: tabs open project files (one tab per file), follow renames and
 * moves in the explorer, close safely when unsaved, and report changes so
 * the session (open tabs) can be restored after a restart.
 *
 * Phase 4: tabs tell listeners before and after a tab is shown (the language
 * client follows the visible file), library files open read-only, and
 * background tabs can be edited (multi-file rename).
 */
import { getValue, loadValue, getEditorState, setEditorState, focusEditor, gotoLine, setReadOnly, getView } from '../editor.js';
import { $ } from '../core/dom.js';
import { state } from './state.js';

let tabs = [];
let activeTabId = null;
let tabCounter = 0;
const changeListeners = new Set();
const showListeners = new Set();

const CLOSE_ICON = '<svg width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden="true"><path d="M1 1L8 8M8 1L1 8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';

const samePath = (a, b) => !!a && !!b && (navigator.platform?.startsWith('Win') || /windows/i.test(navigator.userAgent)
  ? a.toLowerCase() === b.toLowerCase()
  : a === b);

const baseName = (p) => p.split(/[\\/]/).pop();

function createTabData(name = 'untitled.py', code = '', filePath = null, extra = {}) {
  const id = `tab-${tabCounter++}`;
  return { id, name, code, filePath, unsaved: false, editorState: null, readOnly: false, libraryUri: null, ...extra };
}

/**
 * fn({ phase: 'before' | 'after', tab }) runs around every change of the
 * visible document ('before' with the tab being left, 'after' with the new one).
 */
export function onTabShow(fn) {
  showListeners.add(fn);
  return () => showListeners.delete(fn);
}

/** Show a tab's document in the editor, telling listeners before and after. */
function display(tab, load) {
  showListeners.forEach((fn) => fn({ phase: 'before', tab: null }));
  load();
  setReadOnly(!!tab.readOnly);
  showListeners.forEach((fn) => fn({ phase: 'after', tab }));
}

export function getTabs() { return tabs.slice(); }

/** Called after any change to the set of tabs, their files or saved state. */
export function onTabsChanged(fn) {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}
function emitChange() { changeListeners.forEach((fn) => fn()); }

export function getActiveTab() {
  return tabs.find((t) => t.id === activeTabId) || null;
}

export function getActiveFilePath() {
  return getActiveTab()?.filePath ?? null;
}

export function getActiveFileName() {
  return getActiveTab()?.name || 'main.py';
}

export function hasUnsavedTabs() {
  return tabs.some((t) => t.unsaved);
}

export function findTabByPath(filePath) {
  return tabs.find((t) => samePath(t.filePath, filePath)) || null;
}

/** Paths of open files with unsaved edits (project replace skips these). */
export function getUnsavedPaths() {
  return tabs.filter((t) => t.unsaved && t.filePath).map((t) => t.filePath);
}

/** A snapshot of every tab for the session file. Untitled or unsaved tabs keep their text. */
export function snapshotTabs() {
  storeActiveEditorState();
  return {
    active: tabs.filter((t) => !t.libraryUri).findIndex((t) => t.id === activeTabId),
    tabs: tabs.filter((t) => !t.libraryUri).map((t) => ({
      name: t.name,
      filePath: t.filePath,
      unsaved: t.unsaved,
      code: t.filePath && !t.unsaved ? undefined : t.code,
    })),
  };
}

export function setFileName(name) {
  const $fn = $('file-name');
  if ($fn) $fn.textContent = name;
}

/** Create the first tab. Called once after the editor exists. */
export function initTabs(initialCode) {
  const tab = createTabData('main.py', initialCode, null);
  tabs = [tab];
  activeTabId = tab.id;
  renderTabs();
}

/** Replace all tabs with restored ones (session restore). */
export function restoreTabs(list, activeIndex = 0) {
  if (!list.length) return;
  tabs = list.map((t) => ({ ...createTabData(t.name, t.code ?? '', t.filePath ?? null), unsaved: !!t.unsaved }));
  const active = tabs[Math.max(0, Math.min(activeIndex, tabs.length - 1))];
  activeTabId = active.id;
  showTab(active);
  renderTabs();
}

function storeActiveEditorState() {
  const current = getActiveTab();
  if (current && state.editor) {
    current.code = getValue();
    current.editorState = getEditorState();
  }
}

function showTab(tab) {
  display(tab, () => {
    if (tab.editorState) setEditorState(tab.editorState); // keeps undo history
    else loadValue(tab.code);
  });
  setFileName(tab.name);
}

/** Tab label: the file name, plus its folder when two open files share a name. */
function labelFor(tab) {
  if (!tab.filePath) return tab.name;
  const dupes = tabs.filter((t) => t !== tab && t.name === tab.name);
  if (!dupes.length) return tab.name;
  const parts = tab.filePath.split(/[\\/]/);
  return `${tab.name} · ${parts[parts.length - 2] || ''}`;
}

export function renderTabs() {
  const $tabBar = $('editor-tabs');
  if (!$tabBar) return;

  $tabBar.querySelectorAll('.editor-tab').forEach((el) => el.remove());
  const $addBtn = $tabBar.querySelector('.editor-tab-add');

  tabs.forEach((tab) => {
    const el = document.createElement('div');
    el.className = 'editor-tab' + (tab.id === activeTabId ? ' active' : '');
    el.dataset.tabId = tab.id;
    el.setAttribute('role', 'tab');
    el.setAttribute('aria-selected', String(tab.id === activeTabId));
    if (tab.filePath) el.title = tab.filePath;
    if (tab.libraryUri) {
      el.classList.add('editor-tab--readonly');
      el.title = `${decodeURIComponent(tab.libraryUri.replace(/^file:\/\/\/?/, ''))}\nLibrary file (read only)`;
    }

    const nameSpan = document.createElement('span');
    nameSpan.className = 'editor-tab__name';
    nameSpan.textContent = labelFor(tab);

    const dot = document.createElement('span');
    dot.className = 'editor-tab__dot' + (tab.unsaved ? ' unsaved' : '');
    if (tab.unsaved) dot.title = 'Unsaved changes';

    el.append(nameSpan, dot);

    if (tabs.length > 1) {
      const close = document.createElement('span');
      close.className = 'editor-tab__close';
      close.setAttribute('aria-label', `Close ${tab.name}`);
      close.innerHTML = CLOSE_ICON;
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        closeTab(tab.id);
      });
      el.appendChild(close);
    }

    el.addEventListener('click', () => switchTab(tab.id));
    el.addEventListener('auxclick', (e) => { if (e.button === 1) closeTab(tab.id); }); // middle click
    // Keyboard: Tab to a file tab, Enter/Space opens it, Delete closes it
    el.tabIndex = 0;
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchTab(tab.id); }
      else if (e.key === 'Delete' && tabs.length > 1) { e.preventDefault(); closeTab(tab.id); }
    });
    $tabBar.insertBefore(el, $addBtn);
  });
}

export function switchTab(tabId) {
  if (tabId === activeTabId) return;
  const next = tabs.find((t) => t.id === tabId);
  if (!next) return;

  storeActiveEditorState();
  activeTabId = tabId;
  showTab(next);
  renderTabs();
  focusEditor();
  emitChange();
}

export function addNewTab(name = null, code = '', filePath = null, extra = {}) {
  storeActiveEditorState();

  const tab = createTabData(name || `untitled-${tabs.length + 1}.py`, code, filePath, extra);
  tabs.push(tab);
  activeTabId = tab.id;

  display(tab, () => loadValue(code));
  setFileName(tab.name);
  renderTabs();
  focusEditor();
  emitChange();
  return tab;
}

/**
 * Open a file in a tab, or switch to it if it is already open.
 * A fresh untitled starter tab that was never edited is replaced.
 */
export function openFileTab(filePath, content, line) {
  const existing = findTabByPath(filePath);
  if (existing) {
    switchTab(existing.id);
  } else {
    const only = tabs.length === 1 ? tabs[0] : null;
    const replaceable = only && !only.filePath && !only.unsaved && only.name.startsWith('untitled');
    addNewTab(baseName(filePath), content, filePath);
    if (replaceable) {
      tabs = tabs.filter((t) => t !== only);
      renderTabs();
    }
  }
  if (line) gotoLine(line);
}

/**
 * Show a library file (site-packages, type stubs) read-only, e.g. after
 * "Go to Definition". One tab per file.
 */
export function openLibraryTab(uri, name, content) {
  const existing = tabs.find((t) => t.libraryUri === uri);
  if (existing) switchTab(existing.id);
  else addNewTab(name, content, null, { readOnly: true, libraryUri: uri });
  return getActiveTab();
}

/**
 * Change the text of any tab. `makeChanges(doc)` returns CodeMirror change
 * specs for that tab's current document. The active tab is edited in the
 * editor (undoable); others are edited in their stored state.
 * @returns {boolean} whether the tab was found and editable
 */
export function editTab(tabId, makeChanges) {
  const tab = tabs.find((t) => t.id === tabId);
  if (!tab || tab.readOnly) return false;
  if (tab.id === activeTabId) {
    const view = getView();
    view.dispatch({ changes: makeChanges(view.state.doc), userEvent: 'input.rename' });
    return true;
  }
  if (tab.editorState) {
    tab.editorState = tab.editorState.update({ changes: makeChanges(tab.editorState.doc) }).state;
    tab.code = tab.editorState.doc.toString();
  } else {
    // No stored state yet: apply the edits to the plain text
    const view = getView();
    const tmp = view.state.update({ changes: { from: 0, to: view.state.doc.length, insert: tab.code } }).state;
    tab.code = tmp.update({ changes: makeChanges(tmp.doc) }).state.doc.toString();
  }
  tab.unsaved = true;
  renderTabs();
  emitChange();
  return true;
}

/** Open a file in a tab without showing it (multi-file rename). */
export function addBackgroundTab(name, code, filePath) {
  const tab = createTabData(name, code, filePath);
  tabs.push(tab);
  renderTabs();
  emitChange();
  return tab;
}

/** Ask before closing a tab with unsaved changes. */
export function closeTab(tabId) {
  if (tabs.length <= 1) return;
  const idx = tabs.findIndex((t) => t.id === tabId);
  if (idx === -1) return;
  const tab = tabs[idx];
  if (tabId === activeTabId) storeActiveEditorState();
  if (tab.unsaved && !window.confirm(`"${tab.name}" has unsaved changes. Close it anyway and lose them?`)) return;

  tabs.splice(idx, 1);

  if (activeTabId === tabId) {
    const next = tabs[Math.min(idx, tabs.length - 1)];
    activeTabId = next.id;
    showTab(next);
  }
  renderTabs();
  emitChange();
}

/** Update fields of the active tab (e.g. after Save As) and re-render. */
export function updateActiveTab(fields) {
  const tab = getActiveTab();
  if (!tab) return;
  Object.assign(tab, fields);
  if (fields.name) setFileName(fields.name);
  renderTabs();
  emitChange();
}

export function markActiveTabUnsaved() {
  const tab = getActiveTab();
  if (tab && !tab.unsaved) {
    tab.unsaved = true;
    renderTabs();
  }
  emitChange();
}

export function markActiveTabSaved() {
  updateActiveTab({ unsaved: false });
}

/**
 * The explorer renamed or moved `oldPath` to `newPath` (a file or a folder):
 * point every affected tab at its new location.
 */
export function retargetTabs(oldPath, newPath) {
  const sep = oldPath.includes('\\') ? '\\' : '/';
  let touched = false;
  for (const t of tabs) {
    if (!t.filePath) continue;
    if (samePath(t.filePath, oldPath)) {
      t.filePath = newPath;
    } else if (samePath(t.filePath.slice(0, oldPath.length + 1), oldPath + sep)) {
      t.filePath = newPath + t.filePath.slice(oldPath.length);
    } else continue;
    t.name = baseName(t.filePath);
    touched = true;
  }
  if (touched) {
    setFileName(getActiveTab()?.name || '');
    renderTabs();
    emitChange();
  }
}

/** The explorer deleted `path`: its tabs keep their text but become unsaved, untitled copies. */
export function detachTabs(path) {
  const sep = path.includes('\\') ? '\\' : '/';
  let touched = false;
  for (const t of tabs) {
    if (t.filePath && (samePath(t.filePath, path) || samePath(t.filePath.slice(0, path.length + 1), path + sep))) {
      if (t.id === activeTabId) storeActiveEditorState();
      t.filePath = null;
      t.unsaved = true;
      touched = true;
    }
  }
  if (touched) { renderTabs(); emitChange(); }
}

/**
 * Close every tab whose file is inside `folder` (closing a project).
 * Asks once when any of them has unsaved changes. Returns false if the
 * user cancelled. A fresh untitled tab is left when nothing else remains.
 */
export function closeTabsUnder(folder) {
  const sep = folder.includes('\\') ? '\\' : '/';
  storeActiveEditorState();
  const inside = (t) => t.filePath && (samePath(t.filePath, folder) || samePath(t.filePath.slice(0, folder.length + 1), folder + sep));
  const closing = tabs.filter(inside);
  if (!closing.length) return true;
  const unsaved = closing.filter((t) => t.unsaved);
  if (unsaved.length && !window.confirm(
    `Close the folder? ${unsaved.length} file${unsaved.length === 1 ? ' has' : 's have'} unsaved changes that will be lost:\n\n${unsaved.map((t) => t.name).join('\n')}`,
  )) return false;

  tabs = tabs.filter((t) => !inside(t));
  if (!tabs.length) tabs = [createTabData('main.py', '', null)];
  if (!tabs.some((t) => t.id === activeTabId)) {
    activeTabId = tabs[0].id;
    showTab(tabs[0]);
  }
  renderTabs();
  emitChange();
  return true;
}

/** A file changed on disk (search & replace): reload clean tabs showing it. */
export function reloadTab(filePath, content) {
  const tab = findTabByPath(filePath);
  if (!tab || tab.unsaved) return;
  // Our own save also fires a change event: nothing to do when the text is the same
  const current = tab.id === activeTabId ? getValue() : tab.code;
  if (current === content) return;
  tab.code = content;
  tab.editorState = null;
  if (tab.id === activeTabId) loadValue(content);
}

/** True when the tab is the one shown in the editor. */
export function isActiveTab(tabId) { return tabId === activeTabId; }
