/**
 * Editor tabs. Each tab keeps its code, file path and full editor state
 * (so undo history survives tab switches). The active tab's filePath is
 * the single source of truth for "where does Save write".
 */
import { getValue, setValue, getEditorState, setEditorState, focusEditor } from '../editor.js';
import { $ } from '../core/dom.js';
import { state } from './state.js';

let tabs = [];
let activeTabId = null;
let tabCounter = 0;

const CLOSE_ICON = '<svg width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden="true"><path d="M1 1L8 8M8 1L1 8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';

function createTabData(name = 'untitled.py', code = '', filePath = null) {
  const id = `tab-${tabCounter++}`;
  return { id, name, code, filePath, unsaved: false, editorState: null };
}

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

function storeActiveEditorState() {
  const current = getActiveTab();
  if (current && state.editor) {
    current.code = getValue();
    current.editorState = getEditorState();
  }
}

function showTab(tab) {
  if (tab.editorState) setEditorState(tab.editorState); // keeps undo history
  else setValue(tab.code);
  setFileName(tab.name);
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

    const nameSpan = document.createElement('span');
    nameSpan.className = 'editor-tab__name';
    nameSpan.textContent = tab.name;

    const dot = document.createElement('span');
    dot.className = 'editor-tab__dot' + (tab.unsaved ? ' unsaved' : '');

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
}

export function addNewTab(name = null, code = '', filePath = null) {
  storeActiveEditorState();

  const tab = createTabData(name || `untitled-${tabs.length + 1}.py`, code, filePath);
  tabs.push(tab);
  activeTabId = tab.id;

  setValue(code);
  setFileName(tab.name);
  renderTabs();
  focusEditor();
  return tab;
}

export function closeTab(tabId) {
  if (tabs.length <= 1) return;
  const idx = tabs.findIndex((t) => t.id === tabId);
  if (idx === -1) return;

  tabs.splice(idx, 1);

  if (activeTabId === tabId) {
    const next = tabs[Math.min(idx, tabs.length - 1)];
    activeTabId = next.id;
    showTab(next);
  }
  renderTabs();
}

/** Update fields of the active tab (e.g. after Save As) and re-render. */
export function updateActiveTab(fields) {
  const tab = getActiveTab();
  if (!tab) return;
  Object.assign(tab, fields);
  if (fields.name) setFileName(fields.name);
  renderTabs();
}

export function markActiveTabUnsaved() {
  const tab = getActiveTab();
  if (tab && !tab.unsaved) {
    tab.unsaved = true;
    renderTabs();
  }
}

export function markActiveTabSaved() {
  updateActiveTab({ unsaved: false });
}
