/**
 * Live code stats and local auto-save (crash safety, not file save).
 */
import { getValue, getLineCount, getCharCount } from '../editor.js';
import { storageSet } from '../core/storage.js';
import { $ } from '../core/dom.js';
import { state } from './state.js';

const AUTOSAVE_DELAY_MS = 1800;
let saveTimer = null;

export function updateCodeStats() {
  if (!state.editor) return;
  const lines = getLineCount();
  const chars = getCharCount();
  const $lines = $('line-count');
  const $chars = $('char-count');
  if ($lines) $lines.textContent = `${lines} ${lines === 1 ? 'line' : 'lines'}`;
  if ($chars) $chars.textContent = `${chars} ${chars === 1 ? 'char' : 'chars'}`;
}

export function markUnsaved() {
  $('save-dot')?.classList.add('visible');
}

export function clearUnsavedDot() {
  $('save-dot')?.classList.remove('visible');
}

export function scheduleAutoSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveCode, AUTOSAVE_DELAY_MS);
}

/** Store the current editor content locally so it survives a restart. */
export function saveCode() {
  if (!state.editor) return;
  storageSet('theta-code', getValue());
  clearUnsavedDot();
}
