/**
 * File paths ↔ LSP document URIs.
 *
 * Uses the same form Pyright (and VS Code) use, e.g.
 *   D:\code drive\main.py  →  file:///d%3A/code%20drive/main.py
 * so URIs the language server sends back compare equal to ours.
 */

/** @param {string} filePath  an absolute Windows or POSIX path */
export function pathToUri(filePath) {
  let p = String(filePath).replace(/\\/g, '/');
  const drive = /^([A-Za-z]):(\/|$)/.exec(p);
  let prefix = '';
  if (drive) {
    prefix = `/${drive[1].toLowerCase()}%3A`;
    p = p.slice(2);
  }
  if (!p.startsWith('/')) p = `/${p}`;
  return `file://${prefix}${p.split('/').map((seg) => encodeURIComponent(seg)).join('/')}`;
}

/**
 * @param {string} uri  a file: URI
 * @param {boolean} [windows]  return a Windows path (default: guessed from the drive letter)
 * @returns {string|null}
 */
export function uriToPath(uri, windows) {
  if (typeof uri !== 'string' || !uri.startsWith('file://')) return null;
  let p;
  try {
    p = decodeURIComponent(uri.slice('file://'.length));
  } catch (_) {
    return null;
  }
  const drive = /^\/([A-Za-z]):/.exec(p);
  if (drive || windows) {
    p = p.replace(/^\/([A-Za-z]):/, (_, d) => `${d.toUpperCase()}:`);
    return p.replace(/\//g, '\\');
  }
  return p;
}

/** A comparable key for a URI (drive letter and escapes normalised; case-insensitive on Windows). */
export function uriKey(uri) {
  if (typeof uri !== 'string') return '';
  const path = uriToPath(uri);
  if (path === null) return uri;
  return /^[A-Za-z]:\\/.test(path) ? path.toLowerCase() : path;
}

export function sameUri(a, b) {
  return uriKey(a) === uriKey(b);
}

/** URI for a tab that has no file yet. */
export function untitledUri(tabId, name) {
  return `untitled:/${encodeURIComponent(tabId)}/${encodeURIComponent(name || 'untitled.py')}`;
}
