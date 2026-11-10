/**
 * File open / save / save-as / import / drag-and-drop.
 * Electron uses native dialogs; the browser build falls back to
 * downloads and a hidden <input type=file>.
 */
import { getValue } from '../editor.js';
import { showToast } from '../toast.js';
import { $ } from '../core/dom.js';
import {
  addNewTab, getActiveFilePath, getActiveFileName, getActiveTab,
  markActiveTabSaved, updateActiveTab, tabText, isNotebookTab,
  getTabs, currentText, markTabSaved, revertTab, onTabsChanged,
} from './tabs.js';
import { getPrefs, setPrefs } from './session.js';

/** What Save writes for the active tab: the editor text, or a notebook's .ipynb. */
function activeText() {
  const tab = getActiveTab();
  return isNotebookTab(tab) ? tabText(tab) : getValue();
}

const savedListeners = new Set();
/** fn(filePath) after a file reached disk (Save, Save As, Save All, auto save). */
export function onFileSaved(fn) { savedListeners.add(fn); return () => savedListeners.delete(fn); }
const emitSaved = (p) => savedListeners.forEach((fn) => { try { fn(p); } catch (err) { console.error('[saved]', err); } });

let beforeSave = null;
/**
 * fn(code, fileName) → Promise<string|null> runs before a save (format on
 * save). Returning a string replaces the editor text and saves that.
 */
export function setBeforeSave(fn) { beforeSave = fn; }
import { clearUnsavedDot } from './autosave.js';

const OPENABLE = ['.py', '.pyw', '.txt', '.ipynb'];

/**
 * Save the active tab. Returns true when the content reached disk
 * (or was downloaded), false when the user cancelled or it failed.
 */
export async function saveToFile() {
  if (getActiveTab()?.readOnly) {
    showToast('Library files are read only', 'info', 2000);
    return false;
  }
  const notebook = isNotebookTab(getActiveTab());
  if (beforeSave && !notebook) {
    try { await beforeSave(getValue(), getActiveFileName()); } catch (_) { /* save anyway */ }
  }
  const code = activeText();
  if (!notebook && !code.trim()) {
    showToast('Nothing to save — write some code first', 'info', 2000);
    return false;
  }

  const fileName = getActiveFileName();
  const api = window.electronAPI;

  if (api?.saveFile) {
    const filePath = getActiveFilePath();
    if (!filePath) return saveAsFile();

    const result = await api.saveFile(filePath, code);
    if (result?.needsSaveAs) return saveAsFile();
    if (result?.error) {
      showToast(`Save failed: ${result.error}`, 'error', 3000);
      return false;
    }
    clearUnsavedDot();
    markActiveTabSaved();
    showToast(`Saved: ${fileName}`, 'save', 1800);
    emitSaved(filePath);
    return true;
  }

  // Browser fallback: download
  const finalName = /\.(py|ipynb)$/.test(fileName) ? fileName : `${fileName}.py`;
  const blob = new Blob([code], { type: finalName.endsWith('.ipynb') ? 'application/x-ipynb+json' : 'text/x-python;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = finalName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  updateActiveTab({ name: finalName, unsaved: false });
  showToast(`Downloaded: ${finalName}`, 'success', 2000);
  return true;
}

export async function saveAsFile() {
  const code = activeText();
  if (!isNotebookTab(getActiveTab()) && !code.trim()) {
    showToast('Nothing to save — write some code first', 'info', 2000);
    return false;
  }
  const api = window.electronAPI;
  if (!api?.saveFileAs) return saveToFile();

  const result = await api.saveFileAs(code, getActiveFileName());
  if (!result) return false; // cancelled
  if (result.error) {
    showToast(`Save failed: ${result.error}`, 'error', 3000);
    return false;
  }
  updateActiveTab({ filePath: result.filePath, name: result.fileName, unsaved: false });
  clearUnsavedDot();
  emitSaved(result.filePath);
  showToast(`Saved: ${result.fileName}`, 'save', 2000);
  return true;
}

export async function openFile() {
  const api = window.electronAPI;
  if (!api?.openFile) {
    $('import-file-input')?.click(); // browser fallback
    return;
  }
  const result = await api.openFile();
  if (!result) return; // cancelled
  if (result.error) {
    showToast(`Open failed: ${result.error}`, 'error', 3000);
    return;
  }
  addNewTab(result.fileName, result.content, result.filePath);
  showToast(`Opened: ${result.fileName}`, 'success', 2000);
}

function readIntoNewTab(file, verb) {
  const reader = new FileReader();
  reader.onload = (e) => {
    addNewTab(file.name, e.target.result, null);
    showToast(`${verb}: ${file.name}`, 'success', 2000);
  };
  reader.onerror = () => showToast('Failed to read file', 'error', 2000);
  reader.readAsText(file);
}

/** Wire the hidden import input (browser) and editor drag-and-drop. */
export function initFileInputs(dropTarget) {
  $('import-file-input')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) readIntoNewTab(file, 'Imported');
    e.target.value = '';
  });

  if (!dropTarget) return;
  dropTarget.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    dropTarget.classList.add('drag-over');
  });
  dropTarget.addEventListener('dragleave', () => dropTarget.classList.remove('drag-over'));
  dropTarget.addEventListener('drop', (e) => {
    e.preventDefault();
    dropTarget.classList.remove('drag-over');
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (OPENABLE.some((ext) => file.name.toLowerCase().endsWith(ext))) {
      readIntoNewTab(file, 'Dropped');
    } else {
      showToast('Only .py, .pyw, .txt and .ipynb files are supported', 'info', 2000);
    }
  });
}

// ── Save All, Revert, Auto Save ──────────────────────────────────

/**
 * Write every edited file that already has a place on disk.
 * @param {{ quiet?: boolean }} [opts]  quiet: no messages (auto save)
 * @returns {Promise<{ saved: number, untitled: number, failed: number }>}
 */
export async function saveAll({ quiet = false } = {}) {
  const api = window.electronAPI;
  const out = { saved: 0, untitled: 0, failed: 0 };
  if (!api?.saveFile) {
    if (!quiet) await saveToFile();
    return out;
  }
  for (const tab of getTabs()) {
    if (!tab.unsaved || tab.readOnly || tab.libraryUri) continue;
    if (!tab.filePath) { out.untitled++; continue; }
    const res = await api.saveFile(tab.filePath, currentText(tab.id));
    if (res?.error) { out.failed++; continue; }
    markTabSaved(tab.id);
    out.saved++;
    emitSaved(tab.filePath);
  }
  if (out.saved) clearUnsavedDot();
  if (!quiet) {
    const parts = [];
    parts.push(out.saved ? `Saved ${out.saved} file${out.saved === 1 ? '' : 's'}` : 'Nothing to save');
    if (out.untitled) parts.push(`${out.untitled} new file${out.untitled === 1 ? '' : 's'} need Save As`);
    if (out.failed) parts.push(`${out.failed} failed`);
    showToast(parts.join(' · '), out.failed ? 'error' : 'save', 2400);
  }
  return out;
}

/** Throw away the active file's edits and load it again from disk. */
export async function revertFile() {
  const tab = getActiveTab();
  const api = window.electronAPI;
  if (!tab?.filePath || !api?.readFile) {
    showToast('Only a file that is saved on disk can be reverted', 'info', 2200);
    return;
  }
  if (tab.unsaved && !window.confirm(`Discard your changes to "${tab.name}" and load it from disk again?`)) return;
  const res = await api.readFile(tab.filePath);
  if (!res?.ok) {
    showToast(`Could not read the file: ${res?.error || 'unknown error'}`, 'error', 3000);
    return;
  }
  revertTab(tab.id, res.value);
  clearUnsavedDot();
  showToast(`Reverted: ${tab.name}`, 'info', 1800);
}

// Auto Save: 'off' | 'delay' (a second after you stop typing) | 'focus' (when you leave the window)
const AUTO_SAVE_DELAY_MS = 1000;
let autoTimer = null;

export const getAutoSave = () => {
  const v = getPrefs().autoSave;
  return v === 'delay' || v === 'focus' ? v : 'off';
};

export function setAutoSave(mode) {
  setPrefs({ autoSave: mode === 'delay' || mode === 'focus' ? mode : 'off' });
  clearTimeout(autoTimer);
  if (mode === 'delay') scheduleAutoSave();
}

function scheduleAutoSave() {
  clearTimeout(autoTimer);
  if (!getTabs().some((t) => t.unsaved && t.filePath)) return;
  autoTimer = setTimeout(() => { saveAll({ quiet: true }); }, AUTO_SAVE_DELAY_MS);
}

export function initAutoSave() {
  onTabsChanged(() => { if (getAutoSave() === 'delay') scheduleAutoSave(); });
  window.addEventListener('blur', () => { if (getAutoSave() !== 'off') saveAll({ quiet: true }); });
}
