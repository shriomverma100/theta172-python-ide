/**
 * Session: remembers the open tabs (and their unsaved text) so a restart
 * brings back exactly where you were. The last project folder is
 * remembered by the main process; files are re-read from disk, and a tab
 * with unsaved edits keeps its edited text.
 */
import { storageGet, storageSet } from '../core/storage.js';
import { snapshotTabs, restoreTabs, onTabsChanged } from './tabs.js';
import { reopenFolder } from './workspace.js';

const KEY = 'theta-session';
const PREFS_KEY = 'theta-prefs';
let timer = null;

/** Small persisted preferences shared by settings and start-up. */
export function getPrefs() {
  try {
    return { wrap: false, tabSize: 4, restore: true, ...JSON.parse(storageGet(PREFS_KEY) || '{}') };
  } catch (_) {
    return { wrap: false, tabSize: 4, restore: true };
  }
}

export function setPrefs(patch) {
  storageSet(PREFS_KEY, JSON.stringify({ ...getPrefs(), ...patch }));
}

export function saveSessionNow() {
  clearTimeout(timer);
  storageSet(KEY, JSON.stringify({ v: 1, ...snapshotTabs() }));
}

/** Debounced: called on every edit and tab change. */
export function saveSessionSoon() {
  clearTimeout(timer);
  timer = setTimeout(saveSessionNow, 700);
}

/**
 * Restore the folder and tabs from last time. Returns true when tabs were
 * restored (the caller then skips its own first-tab setup).
 */
export async function restoreSession() {
  if (!getPrefs().restore) return false;
  await reopenFolder();

  let saved;
  try { saved = JSON.parse(storageGet(KEY) || 'null'); } catch (_) { saved = null; }
  if (!saved?.tabs?.length) return false;

  const api = window.electronAPI;
  const list = [];
  for (const t of saved.tabs.slice(0, 30)) {
    if (t.filePath && !t.unsaved) {
      // Re-read from disk: the file may have changed since
      const res = await api?.readFile?.(t.filePath);
      if (res?.ok) list.push({ name: t.name, filePath: t.filePath, code: res.value, unsaved: false });
    } else if (typeof t.code === 'string') {
      list.push({ name: t.name, filePath: t.filePath || null, code: t.code, unsaved: !!t.unsaved });
    }
  }
  if (!list.length) return false;
  const activeName = saved.tabs[saved.active]?.name;
  const activeIdx = Math.max(0, list.findIndex((t) => t.name === activeName));
  restoreTabs(list, activeIdx);
  return true;
}

export function initSession() {
  onTabsChanged(saveSessionSoon);
  window.addEventListener('beforeunload', saveSessionNow);
}
