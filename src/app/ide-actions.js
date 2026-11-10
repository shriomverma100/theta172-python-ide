/**
 * Everyday IDE actions behind the menus and shortcuts: Save All, Revert,
 * close / reopen editors, tab cycling, Go to Line, Reveal, Copy Path,
 * the Edit commands, Open Recent and Auto Save. main.js merges them into
 * its action map (shortcuts, command palette and menus share it).
 */
import { undo, redo, selectAll, toggleComment } from '@codemirror/commands';
import { getView, gotoLine, focusEditor } from '../editor.js';
import { showToast } from '../toast.js';
import {
  getActiveTab, closeActiveTab, closeAllTabs, popClosedTab, cycleTab, openFileTab, addNewTab, findTabByPath,
} from './tabs.js';
import { saveAll, revertFile, getAutoSave, setAutoSave } from './files.js';
import { openInputBox } from './quick-pick.js';
import { getWorkspaceRoot, relativePath, openPath, openRecentFolder } from './workspace.js';

const api = () => window.electronAPI;

/** Run a CodeMirror command on the focused editor (not inside a notebook). */
function onEditor(command) {
  const view = getView();
  if (!view) return;
  if (getActiveTab()?.kind === 'notebook') {
    showToast('Use the cell editors in the notebook for this', 'info', 1800);
    return;
  }
  view.focus();
  command(view);
}

/** Cut / Copy / Paste on whatever has focus (editor, cell, input box). */
async function clipboardCommand(kind) {
  if (kind === 'paste') {
    try {
      const text = await navigator.clipboard.readText();
      if (!document.execCommand('insertText', false, text)) throw new Error('not editable');
    } catch (_) {
      document.execCommand('paste');
    }
    return;
  }
  document.execCommand(kind);
}

async function goToLine() {
  if (getActiveTab()?.kind === 'notebook') { showToast('Go to Line works in code files', 'info', 1800); return; }
  const view = getView();
  const lines = view?.state.doc.lines || 1;
  const value = await openInputBox({
    title: `Go to line (1 – ${lines})`,
    validate: (v) => (/^\s*\d+\s*$/.test(v) && Number(v) >= 1 && Number(v) <= lines ? null : `Type a line number from 1 to ${lines}`),
  });
  if (value == null) return;
  gotoLine(Number(value));
  focusEditor();
}

async function reopenClosed() {
  const t = popClosedTab();
  if (!t) { showToast('No closed editors to reopen', 'info', 1600); return; }
  if (t.filePath && findTabByPath(t.filePath)) { openFileTab(t.filePath, null); return; }
  if (t.filePath && t.code === null) {
    const root = getWorkspaceRoot();
    if (root && t.filePath.toLowerCase().startsWith(root.toLowerCase())) { await openPath(t.filePath); return; }
    const res = await api()?.readFile?.(t.filePath);
    if (res?.ok) { openFileTab(t.filePath, res.value); return; }
    showToast(`Could not reopen ${t.name}`, 'error', 2400);
    return;
  }
  // An untitled or unsaved file: its text was kept
  addNewTab(t.name, t.code ?? '', null);
}

function activePath() {
  const p = getActiveTab()?.filePath;
  if (!p) showToast('This file is not saved yet', 'info', 1800);
  return p || null;
}

async function copyPath(relative) {
  const p = activePath();
  if (!p) return;
  const root = getWorkspaceRoot();
  const text = relative && root && p.toLowerCase().startsWith(root.toLowerCase()) ? relativePath(p) : p;
  try {
    await navigator.clipboard.writeText(text);
    showToast(`Copied: ${text}`, 'success', 1800);
  } catch (_) {
    showToast('Could not copy', 'error', 1800);
  }
}

async function revealFile() {
  const p = activePath();
  if (!p) return;
  const res = await api()?.fileReveal?.(p);
  if (res && !res.ok) showToast(res.error, 'error', 2400);
}

/** File → Open Recent: folders, then files. */
export async function recentItems() {
  const res = await api()?.wsRecent?.();
  const folders = res?.ok ? res.value.folders : [];
  const files = res?.ok ? res.value.files : [];
  // "name   …\parent\folder" keeps long paths readable
  const short = (p) => {
    const parts = p.split(/[\\/]/).filter(Boolean);
    const name = parts.pop() || p;
    const where = parts.length > 2 ? `…\\${parts.slice(-2).join('\\')}` : parts.join('\\');
    return where ? `${name}   ${where}` : name;
  };
  const items = [];
  for (const f of folders) items.push({ label: `Folder: ${short(f)}`, run: () => openRecentFolder(f) });
  if (folders.length && files.length) items.push({ separator: true });
  for (const f of files) {
    items.push({
      label: short(f),
      run: async () => {
        if (findTabByPath(f)) { openFileTab(f, null); return; }
        const r = await api()?.readFile?.(f);
        if (r?.ok) openFileTab(f, r.value);
        else showToast(r?.error || 'Could not open the file', 'error', 2400);
      },
    });
  }
  if (!items.length) items.push({ label: 'Nothing opened yet', run: () => {}, disabled: () => true });
  items.push({ separator: true }, { label: 'Reopen Closed Editor', action: 'reopen-closed', shortcut: 'reopen-closed' });
  return items;
}

export const autoSaveItems = () => [
  { label: 'Off', checked: () => getAutoSave() === 'off', run: () => { setAutoSave('off'); showToast('Auto Save is off', 'info', 1600); } },
  { label: 'After a second of not typing', checked: () => getAutoSave() === 'delay', run: () => { setAutoSave('delay'); showToast('Auto Save: a second after you stop typing', 'info', 2000); } },
  { label: 'When leaving the window', checked: () => getAutoSave() === 'focus', run: () => { setAutoSave('focus'); showToast('Auto Save: when you switch to another window', 'info', 2000); } },
];

/** Actions by id (merged into main.js's action map). */
export const ideActions = {
  'save-all': () => saveAll(),
  'revert-file': revertFile,
  'close-editor': closeActiveTab,
  'close-all': closeAllTabs,
  'reopen-closed': reopenClosed,
  'next-tab': () => cycleTab(1),
  'prev-tab': () => cycleTab(-1),
  'go-to-line': goToLine,
  'reveal-file': revealFile,
  'copy-path': () => copyPath(false),
  'copy-relative-path': () => copyPath(true),
  'undo': () => onEditor(undo),
  'redo': () => onEditor(redo),
  'select-all-text': () => {
    const active = document.activeElement;
    if (active?.closest?.('.cm-editor') || !getView()) document.execCommand('selectAll');
    else onEditor(selectAll);
  },
  'toggle-comment': () => onEditor(toggleComment),
  'cut': () => clipboardCommand('cut'),
  'copy-selection': () => clipboardCommand('copy'),
  'paste': () => clipboardCommand('paste'),
  'exit': () => api()?.close?.(),
  'auto-save-toggle': () => {
    const next = getAutoSave() === 'off' ? 'delay' : 'off';
    setAutoSave(next);
    showToast(next === 'off' ? 'Auto Save is off' : 'Auto Save is on: files save a second after you stop typing', 'info', 2200);
  },
};
