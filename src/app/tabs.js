/**
 * Editor tabs and editor groups.
 *
 * Every open document is a tab (its code, file path and editor state, so
 * undo history survives tab switches). Tabs live in one or two editor
 * groups side by side; each group has its own tab strip and active tab.
 * The focused group is "the editor": Run, Save, language features and the
 * debugger all act on its active tab. A file can be open in both groups at
 * once (Split): the two views then mirror each other's edits.
 *
 * Phase 2: one tab per file, follows renames and moves, closes safely when
 * unsaved, reports changes for session restore.
 * Phase 4: listeners hear before/after a tab is shown; library files open
 * read-only; background tabs can be edited (rename across files).
 * Phase 7: editor groups.
 */
import {
  setEditorState, focusEditor, gotoLine, setReadOnly, freshState, loadIntoView,
  getGroupView, setActiveGroup, onActiveGroupChange, openGroupView, closeGroupView, setMirror,
} from '../editor.js';
import { $ } from '../core/dom.js';

let tabs = [];
let tabCounter = 0;
/** groups[g] = { ids: tab ids in strip order, active: id shown in the group } */
let groups = [{ ids: [], active: null }, { ids: [], active: null }];
let focused = 0; // the group the user is working in
const changeListeners = new Set();
const showListeners = new Set();

const CLOSE_ICON = '<svg width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden="true"><path d="M1 1L8 8M8 1L1 8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
const DRAG_TYPE = 'application/x-theta-tab';

const samePath = (a, b) => !!a && !!b && (navigator.platform?.startsWith('Win') || /windows/i.test(navigator.userAgent)
  ? a.toLowerCase() === b.toLowerCase()
  : a === b);

const baseName = (p) => p.split(/[\\/]/).pop();
const tabById = (id) => tabs.find((t) => t.id === id) || null;
const rightOpen = () => !!getGroupView(1);
const groupCount = () => (rightOpen() ? 2 : 1);

function createTabData(name = 'untitled.py', code = '', filePath = null, extra = {}) {
  const id = `tab-${tabCounter++}`;
  return { id, name, code, filePath, unsaved: false, editorState: null, readOnly: false, libraryUri: null, ...extra };
}

/**
 * fn({ phase: 'before' | 'after', tab }) runs around every change of a
 * shown document ('before' with tab null, 'after' with the new tab). The
 * editor's active group is the one changing while it runs.
 */
export function onTabShow(fn) {
  showListeners.add(fn);
  return () => showListeners.delete(fn);
}

/** Called after any change to the set of tabs, their files or saved state. */
export function onTabsChanged(fn) {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}
function emitChange() { changeListeners.forEach((fn) => fn()); }

// ── Where tabs are shown ─────────────────────────────────────────

/** Groups (0, 1) currently showing the tab. */
function groupsShowing(id) {
  const out = [];
  for (let g = 0; g < groupCount(); g++) if (groups[g].active === id) out.push(g);
  return out;
}

/** The group that has the tab in its strip (the focused one first), or -1. */
function groupHolding(id) {
  if (groups[focused].ids.includes(id)) return focused;
  const other = 1 - focused;
  if (other < groupCount() && groups[other].ids.includes(id)) return other;
  return -1;
}

/** The editor view showing the tab (the focused group's first), or null. */
function viewOf(tab) {
  const shown = groupsShowing(tab.id);
  if (!shown.length) return null;
  return getGroupView(shown.includes(focused) ? focused : shown[0]);
}

/** Every shown tab with its view (for change markers and the like). */
export function visibleTabs() {
  const out = [];
  for (let g = 0; g < groupCount(); g++) {
    const tab = tabById(groups[g].active);
    if (tab) out.push({ tab, view: getGroupView(g), group: g });
  }
  return out;
}

/** Keep the tab's stored text and state in step with the group's view. */
function storeGroup(g) {
  const tab = tabById(groups[g].active);
  const view = getGroupView(g);
  if (tab && view) {
    tab.code = view.state.doc.toString();
    tab.editorState = view.state;
  }
}

function updateMirror() {
  setMirror(rightOpen() && !!groups[0].active && groups[0].active === groups[1].active);
}

/** Show a tab's document in group g, telling listeners before and after. */
function display(g, tab) {
  setActiveGroup(g);
  setMirror(false); // loading a document must not copy into the other group
  showListeners.forEach((fn) => fn({ phase: 'before', tab: null }));
  const other = 1 - g;
  const sameInOther = other < groupCount() && groups[other].active === tab.id;
  // Same file in the other group: start from its live state; otherwise this tab's own
  setEditorState(sameInOther ? getGroupView(other).state : tab.editorState || freshState(tab.code));
  setReadOnly(!!tab.readOnly);
  showListeners.forEach((fn) => fn({ phase: 'after', tab }));
  updateMirror();
  if (g === focused) setFileName(tab.name);
  // The editor's active group follows the user's focus, not this load
  if (g !== focused) setActiveGroup(focused);
}

// ── Reading ──────────────────────────────────────────────────────

export function getTabs() { return tabs.slice(); }

export function getActiveTab() {
  return tabById(groups[focused].active);
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

/** True when the tab is the one shown in the focused group. */
export function isActiveTab(tabId) { return tabId === groups[focused].active; }

export const getFocusedGroup = () => focused;
export const isSplit = () => rightOpen();

/** A snapshot of every tab for the session file. Untitled or unsaved tabs keep their text. */
export function snapshotTabs() {
  storeGroup(0);
  if (rightOpen()) storeGroup(1);
  const saved = tabs.filter((t) => !t.libraryUri);
  return {
    active: saved.findIndex((t) => t.id === getActiveTab()?.id),
    tabs: saved.map((t) => ({
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

// ── Start-up ─────────────────────────────────────────────────────

/** Create the first tab. Called once after the editor exists. */
export function initTabs(initialCode) {
  const tab = createTabData('main.py', initialCode, null);
  tabs = [tab];
  groups = [{ ids: [tab.id], active: tab.id }, { ids: [], active: null }];
  onActiveGroupChange((g) => {
    if (g === focused) return;
    focused = g;
    setFileName(getActiveTab()?.name || '');
    renderTabs();
    emitChange();
  });
  initDropTargets();
  $('group-2-close')?.addEventListener('click', () => closeRightGroup());
  renderTabs();
}

/** Replace all tabs with restored ones (session restore). Everything opens in the left group. */
export function restoreTabs(list, activeIndex = 0) {
  if (!list.length) return;
  if (rightOpen()) closeRightGroup();
  tabs = list.map((t) => ({ ...createTabData(t.name, t.code ?? '', t.filePath ?? null), unsaved: !!t.unsaved }));
  const active = tabs[Math.max(0, Math.min(activeIndex, tabs.length - 1))];
  groups[0] = { ids: tabs.map((t) => t.id), active: active.id };
  focused = 0;
  display(0, active);
  renderTabs();
}

// ── Tab strips ───────────────────────────────────────────────────

/** Tab label: the file name, plus its folder when two open files share a name. */
function labelFor(tab) {
  if (!tab.filePath) return tab.name;
  const dupes = tabs.filter((t) => t !== tab && t.name === tab.name);
  if (!dupes.length) return tab.name;
  const parts = tab.filePath.split(/[\\/]/);
  return `${tab.name} · ${parts[parts.length - 2] || ''}`;
}

function tabElement(tab, g) {
  const el = document.createElement('div');
  const active = groups[g].active === tab.id;
  el.className = `editor-tab${active ? ' active' : ''}`;
  el.dataset.tabId = tab.id;
  el.dataset.group = String(g);
  el.setAttribute('role', 'tab');
  el.setAttribute('aria-selected', String(active));
  el.draggable = true;
  if (tab.filePath) el.title = tab.filePath;
  if (tab.libraryUri) {
    el.classList.add('editor-tab--readonly');
    el.title = `${decodeURIComponent(tab.libraryUri.replace(/^file:\/\/\/?/, ''))}\nLibrary file (read only)`;
  }
  const nameSpan = document.createElement('span');
  nameSpan.className = 'editor-tab__name';
  nameSpan.textContent = labelFor(tab);
  const dot = document.createElement('span');
  dot.className = `editor-tab__dot${tab.unsaved ? ' unsaved' : ''}`;
  if (tab.unsaved) dot.title = 'Unsaved changes';
  el.append(nameSpan, dot);

  const closable = tabs.length > 1 || groupCount() > 1;
  if (closable) {
    const close = document.createElement('span');
    close.className = 'editor-tab__close';
    close.setAttribute('aria-label', `Close ${tab.name}`);
    close.innerHTML = CLOSE_ICON;
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(tab.id, g);
    });
    el.appendChild(close);
  }
  el.addEventListener('click', () => switchTab(tab.id, g));
  el.addEventListener('auxclick', (e) => { if (e.button === 1 && closable) closeTab(tab.id, g); }); // middle click
  // Keyboard: Tab to a file tab, Enter/Space opens it, Delete closes it
  el.tabIndex = 0;
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchTab(tab.id, g); }
    else if (e.key === 'Delete' && closable) { e.preventDefault(); closeTab(tab.id, g); }
  });
  el.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ id: tab.id, from: g }));
    e.dataTransfer.effectAllowed = 'move';
    document.documentElement.classList.add('dragging-tab');
  });
  el.addEventListener('dragend', () => document.documentElement.classList.remove('dragging-tab'));
  return el;
}

export function renderTabs() {
  const strips = [$('editor-tabs'), $('editor-tabs-2')];
  for (let g = 0; g < 2; g++) {
    const $bar = strips[g];
    if (!$bar) continue;
    $bar.querySelectorAll('.editor-tab').forEach((el) => el.remove());
    if (g === 1 && !rightOpen()) continue;
    const $before = $bar.querySelector('.editor-tab-add');
    for (const id of groups[g].ids) {
      const tab = tabById(id);
      if (tab) $bar.insertBefore(tabElement(tab, g), $before);
    }
    // A long strip scrolls so its active tab is always visible
    $bar.querySelector('.editor-tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  // The focused group is marked; with one group nothing is
  const two = rightOpen();
  $('monaco-container')?.classList.toggle('group-focused', two && focused === 0);
  $('group-2')?.classList.toggle('group-focused', two && focused === 1);
  $('editor-tabs')?.classList.toggle('group-dim', two && focused === 1);
  $('btn-split')?.setAttribute('aria-pressed', String(two));
}

/** Drop a dragged tab on a group's strip (or the right edge of the editor) to move it there. */
function initDropTargets() {
  const targets = [[$('editor-tabs'), 0], [$('editor-tabs-2'), 1], [$('group-drop-right'), 1]];
  for (const [el, g] of targets) {
    if (!el) continue;
    el.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      el.classList.add('drop-over');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-over'));
    el.addEventListener('drop', (e) => {
      el.classList.remove('drop-over');
      document.documentElement.classList.remove('dragging-tab');
      let data;
      try { data = JSON.parse(e.dataTransfer.getData(DRAG_TYPE)); } catch (_) { return; }
      e.preventDefault();
      if (data.from === g) return;
      moveTabToGroup(data.id, g, data.from);
    });
  }
}

// ── Switching and opening ────────────────────────────────────────

/** Move keyboard focus (and "the editor") to group g. */
export function focusGroup(g) {
  if (g >= groupCount()) return;
  setActiveGroup(g);
  getGroupView(g)?.focus();
}

/**
 * Show a tab. Without a group: where it already is (the focused group
 * first), otherwise in the focused group.
 */
export function switchTab(tabId, g) {
  const tab = tabById(tabId);
  if (!tab) return;
  if (g === undefined || g >= groupCount()) {
    const holding = groupHolding(tabId);
    g = holding >= 0 ? holding : focused;
  }
  if (!groups[g].ids.includes(tabId)) groups[g].ids.push(tabId);
  if (groups[g].active !== tabId) {
    storeGroup(g);
    groups[g].active = tabId;
    focused = g;
    display(g, tab);
  } else if (focused !== g) {
    focused = g;
    setActiveGroup(g);
    setFileName(tab.name);
  }
  renderTabs();
  focusGroup(g);
  emitChange();
}

export function addNewTab(name = null, code = '', filePath = null, extra = {}) {
  const tab = createTabData(name || `untitled-${tabs.length + 1}.py`, code, filePath, extra);
  tabs.push(tab);
  const g = focused;
  storeGroup(g);
  groups[g].ids.push(tab.id);
  groups[g].active = tab.id;
  display(g, tab);
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
    const only = tabs.length === 1 && groupCount() === 1 ? tabs[0] : null;
    const replaceable = only && !only.filePath && !only.unsaved && only.name.startsWith('untitled');
    addNewTab(baseName(filePath), content, filePath);
    if (replaceable) {
      tabs = tabs.filter((t) => t !== only);
      groups[0].ids = groups[0].ids.filter((id) => id !== only.id);
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

/** Open a file in a tab without showing it (multi-file rename). */
export function addBackgroundTab(name, code, filePath) {
  const tab = createTabData(name, code, filePath);
  tabs.push(tab);
  groups[focused].ids.push(tab.id);
  renderTabs();
  emitChange();
  return tab;
}

// ── Groups ───────────────────────────────────────────────────────

function openRightGroup(firstTab) {
  const $host = $('group-2');
  const $container = $('monaco-split');
  if (!$host || !$container) return false;
  $host.classList.remove('hidden');
  groups[1] = { ids: [firstTab.id], active: null };
  openGroupView($container, freshState(''));
  groups[1].active = firstTab.id;
  display(1, firstTab);
  return true;
}

/**
 * Split: open the focused tab in the right group as well (both views stay
 * in step), or focus the right group when it is open.
 */
export function splitEditor() {
  if (rightOpen()) { focusGroup(1); return; }
  const tab = getActiveTab();
  if (!tab) return;
  storeGroup(0);
  if (!openRightGroup(tab)) return;
  focused = 1;
  setActiveGroup(1);
  renderTabs();
  focusGroup(1);
  emitChange();
}

/** Close the right group; its tabs move to the left strip (nothing is closed). */
export function closeRightGroup() {
  if (!rightOpen()) return;
  storeGroup(1);
  const leftActive = groups[0].active;
  for (const id of groups[1].ids) if (!groups[0].ids.includes(id)) groups[0].ids.push(id);
  const keep = groups[1].active;
  groups[1] = { ids: [], active: null };
  closeGroupView();
  setMirror(false);
  $('group-2')?.classList.add('hidden');
  focused = 0;
  setActiveGroup(0);
  // Left group empty (everything had moved right): show what the right group showed
  if (!leftActive && keep) {
    groups[0].active = keep;
    display(0, tabById(keep));
  }
  renderTabs();
  focusGroup(0);
  emitChange();
}

/** Move a tab to group `to` (opening the right group when needed). */
export function moveTabToGroup(tabId, to, from = groupHolding(tabId)) {
  const tab = tabById(tabId);
  if (!tab || from < 0 || from === to) return;
  if (from === 0 && groups[0].ids.length === 1 && !rightOpen()) return; // nothing would be left behind
  storeGroup(from);
  // Take it out of the source group first
  const src = groups[from];
  const idx = src.ids.indexOf(tabId);
  src.ids.splice(idx, 1);
  const wasShown = src.active === tabId;
  if (to === 1 && !rightOpen()) {
    if (wasShown) {
      src.active = src.ids[Math.min(idx, src.ids.length - 1)] ?? null;
      if (src.active) display(from, tabById(src.active));
    }
    openRightGroup(tab);
  } else {
    if (!groups[to].ids.includes(tabId)) groups[to].ids.push(tabId);
    if (wasShown) {
      src.active = src.ids[Math.min(idx, src.ids.length - 1)] ?? null;
      if (src.active) display(from, tabById(src.active));
    }
    storeGroup(to);
    groups[to].active = tabId;
    display(to, tab);
  }
  focused = to;
  setActiveGroup(to);
  // An empty right group closes; an empty left group takes over the right one
  if (!groups[1].ids.length && rightOpen()) closeRightGroup();
  else if (!groups[0].ids.length && rightOpen()) closeRightGroup();
  renderTabs();
  focusGroup(focused);
  emitChange();
}

/** Keyboard: move the focused tab to the other side. */
export function moveActiveTab(direction) {
  const tab = getActiveTab();
  if (!tab) return;
  const to = direction === 'right' ? 1 : 0;
  if (to === focused) return;
  moveTabToGroup(tab.id, to, focused);
}

// ── Editing any tab ──────────────────────────────────────────────

/**
 * Change the text of any tab. `makeChanges(doc)` returns CodeMirror change
 * specs for that tab's current document. A shown tab is edited in its view
 * (undoable); others are edited in their stored state.
 * @returns {boolean} whether the tab was found and editable
 */
export function editTab(tabId, makeChanges) {
  const tab = tabById(tabId);
  if (!tab || tab.readOnly) return false;
  const view = viewOf(tab);
  if (view) {
    view.dispatch({ changes: makeChanges(view.state.doc), userEvent: 'input.rename' });
    return true;
  }
  const base = tab.editorState || freshState(tab.code);
  const next = base.update({ changes: makeChanges(base.doc) }).state;
  if (tab.editorState) tab.editorState = next;
  tab.code = next.doc.toString();
  tab.unsaved = true;
  renderTabs();
  emitChange();
  return true;
}

/**
 * Apply a transaction spec without text changes (effects such as breakpoints)
 * to any tab: in every view showing it, or in its stored state.
 */
export function updateTabState(tabId, spec) {
  const tab = tabById(tabId);
  if (!tab) return false;
  const shown = groupsShowing(tabId);
  if (shown.length) for (const g of shown) getGroupView(g).dispatch(spec);
  else if (tab.editorState) tab.editorState = tab.editorState.update(spec).state;
  else return false;
  return true;
}

/** The editor state of any tab (the live one when shown), or null. */
export function getTabState(tabId) {
  const tab = tabById(tabId);
  if (!tab) return null;
  return viewOf(tab)?.state ?? tab.editorState;
}

// ── Closing ──────────────────────────────────────────────────────

/** Close a tab in a group. The document closes (asking if unsaved) when no group shows it any more. */
export function closeTab(tabId, g = groupHolding(tabId)) {
  const tab = tabById(tabId);
  if (!tab || g < 0) return;
  const other = 1 - g;
  const elsewhere = other < groupCount() && groups[other].ids.includes(tabId);
  if (!elsewhere && tabs.length <= 1 && groupCount() === 1) return; // always keep one tab
  if (groups[g].active === tabId) storeGroup(g);
  if (!elsewhere && tab.unsaved && !window.confirm(`"${tab.name}" has unsaved changes. Close it anyway and lose them?`)) return;

  const group = groups[g];
  const idx = group.ids.indexOf(tabId);
  group.ids.splice(idx, 1);
  if (!elsewhere) tabs = tabs.filter((t) => t !== tab);

  if (!group.ids.length) {
    if (g === 1) { group.active = null; closeRightGroup(); return; }
    if (rightOpen()) { group.active = null; closeRightGroup(); return; }
  } else if (group.active === tabId) {
    group.active = group.ids[Math.min(idx, group.ids.length - 1)];
    display(g, tabById(group.active));
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

// ── Files changing on disk ───────────────────────────────────────

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
      const shown = groupsShowing(t.id);
      if (shown.length) storeGroup(shown[0]);
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
  storeGroup(0);
  if (rightOpen()) storeGroup(1);
  const inside = (t) => t.filePath && (samePath(t.filePath, folder) || samePath(t.filePath.slice(0, folder.length + 1), folder + sep));
  const closing = tabs.filter(inside);
  if (!closing.length) return true;
  const unsaved = closing.filter((t) => t.unsaved);
  if (unsaved.length && !window.confirm(
    `Close the folder? ${unsaved.length} file${unsaved.length === 1 ? ' has' : 's have'} unsaved changes that will be lost:\n\n${unsaved.map((t) => t.name).join('\n')}`,
  )) return false;

  const gone = new Set(closing.map((t) => t.id));
  tabs = tabs.filter((t) => !gone.has(t.id));
  if (rightOpen()) closeRightGroup();
  groups[0].ids = groups[0].ids.filter((id) => !gone.has(id));
  if (!tabs.length) {
    const fresh = createTabData('main.py', '', null);
    tabs = [fresh];
    groups[0].ids = [fresh.id];
  }
  if (!groups[0].ids.includes(groups[0].active)) {
    groups[0].active = groups[0].ids[0];
    display(0, tabById(groups[0].active));
  }
  renderTabs();
  emitChange();
  return true;
}

/** A file changed on disk (search & replace): reload clean tabs showing it. */
export function reloadTab(filePath, content) {
  const tab = findTabByPath(filePath);
  if (!tab || tab.unsaved) return;
  const view = viewOf(tab);
  // Our own save also fires a change event: nothing to do when the text is the same
  const current = view ? view.state.doc.toString() : tab.code;
  if (current === content) return;
  tab.code = content;
  tab.editorState = null;
  if (view) loadIntoView(view, content); // mirrored into the other group when it shows the same file
}
