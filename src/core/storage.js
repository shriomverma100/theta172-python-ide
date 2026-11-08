/**
 * Safe localStorage helpers: never throw (private mode, quota, sandbox).
 */
export function storageGet(key, fallback = null) {
  try { return localStorage.getItem(key) ?? fallback; } catch (_) { return fallback; }
}

export function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch (_) { /* ignore */ }
}

export function storageRemove(key) {
  try { localStorage.removeItem(key); } catch (_) { /* ignore */ }
}
