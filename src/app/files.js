/**
 * File open / save / save-as / import / drag-and-drop.
 * Electron uses native dialogs; the browser build falls back to
 * downloads and a hidden <input type=file>.
 */
import { getValue } from '../editor.js';
import { showToast } from '../toast.js';
import { $ } from '../core/dom.js';
import {
  addNewTab, getActiveFilePath, getActiveFileName,
  markActiveTabSaved, updateActiveTab,
} from './tabs.js';
import { clearUnsavedDot } from './autosave.js';

const OPENABLE = ['.py', '.pyw', '.txt'];

/**
 * Save the active tab. Returns true when the content reached disk
 * (or was downloaded), false when the user cancelled or it failed.
 */
export async function saveToFile() {
  const code = getValue();
  if (!code.trim()) {
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
    return true;
  }

  // Browser fallback: download
  const finalName = fileName.endsWith('.py') ? fileName : `${fileName}.py`;
  const blob = new Blob([code], { type: 'text/x-python;charset=utf-8' });
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
  const code = getValue();
  if (!code.trim()) {
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
      showToast('Only .py, .pyw and .txt files are supported', 'info', 2000);
    }
  });
}
