/**
 * THETA. — File Manager
 * Handles file open, save, save-as operations for both Electron and browser.
 */

import { getValue } from './editor.js';
import { showToast } from './toast.js';

let currentFilePath = null;

export function getCurrentFilePath() {
  return currentFilePath;
}

export function setCurrentFilePath(path) {
  currentFilePath = path;
}

export function setFileName(name) {
  const $fn = document.getElementById('file-name');
  if ($fn) $fn.textContent = name;
}

export async function saveToFile({ $saveDot, markActiveTabSaved }) {
  const code = getValue();
  if (!code.trim()) {
    showToast('Nothing to save — write some code first', 'info', 2000);
    return;
  }

  const fileName = document.getElementById('file-name')?.textContent?.trim() || 'main.py';

  // Electron native save
  if (window.electronAPI?.saveFile) {
    if (currentFilePath) {
      const result = await window.electronAPI.saveFile(currentFilePath, code);
      if (result?.error) {
        showToast(`Save failed: ${result.error}`, 'error', 3000);
      } else {
        $saveDot?.classList.remove('visible');
        markActiveTabSaved?.();
        showToast(`Saved: ${fileName}`, 'save', 1800);
      }
      return;
    }

    // No path yet — show Save As dialog
    await saveAsFile({ $saveDot, onSaved: null });
    return;
  }

  // Fallback: browser download
  const finalName = fileName.endsWith('.py') ? fileName : fileName + '.py';
  const blob = new Blob([code], { type: 'text/x-python;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = finalName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  setFileName(finalName);
  showToast(`Downloaded: ${finalName}`, 'success', 2000);
}

export async function saveAsFile({ $saveDot, tabs, activeTabId, renderTabs }) {
  const code = getValue();
  if (!code.trim()) {
    showToast('Nothing to save — write some code first', 'info', 2000);
    return;
  }

  const defaultName = document.getElementById('file-name')?.textContent?.trim() || 'main.py';

  if (window.electronAPI?.saveFileAs) {
    const result = await window.electronAPI.saveFileAs(code, defaultName);
    if (!result) return; // Cancelled
    if (result.error) {
      showToast(`Save failed: ${result.error}`, 'error', 3000);
      return;
    }
    currentFilePath = result.filePath;
    setFileName(result.fileName);
    // Update current tab
    const tab = tabs?.find(t => t.id === activeTabId);
    if (tab) { tab.filePath = result.filePath; tab.name = result.fileName; tab.unsaved = false; }
    $saveDot?.classList.remove('visible');
    renderTabs?.();
    showToast(`Saved: ${result.fileName}`, 'save', 2000);
  }
}

export async function openFile({ addNewTab }) {
  if (!window.electronAPI?.openFile) {
    document.getElementById('import-file-input')?.click();
    return;
  }

  const result = await window.electronAPI.openFile();
  if (!result) return;
  if (result.error) {
    showToast(`Open failed: ${result.error}`, 'error', 3000);
    return;
  }

  addNewTab?.(result.fileName, result.content, result.filePath);
  showToast(`Opened: ${result.fileName}`, 'success', 2000);
}

export function importFromFile(file, { addNewTab }) {
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const code = e.target.result;
    addNewTab?.(file.name, code, null);
    showToast(`Imported: ${file.name}`, 'success', 2000);
  };
  reader.onerror = () => {
    showToast('Failed to read file', 'error', 2000);
  };
  reader.readAsText(file);
}
