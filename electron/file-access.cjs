/**
 * THETA172 — File access allowlist (main process).
 *
 * The renderer may only write to files the user picked through a native
 * Open or Save dialog in this session. Without this, any script running in
 * the renderer (for example via injected HTML) could overwrite any file the
 * user can write to.
 */

'use strict';

const path = require('path');

class FileAccess {
  constructor(platform = process.platform) {
    this._caseInsensitive = platform === 'win32' || platform === 'darwin';
    this._allowed = new Set();
  }

  _key(filePath) {
    const resolved = path.resolve(filePath);
    return this._caseInsensitive ? resolved.toLowerCase() : resolved;
  }

  /** Record a path the user chose in a native dialog. */
  allow(filePath) {
    if (typeof filePath === 'string' && filePath.length > 0) {
      this._allowed.add(this._key(filePath));
    }
  }

  isAllowed(filePath) {
    if (typeof filePath !== 'string' || filePath.length === 0) return false;
    return this._allowed.has(this._key(filePath));
  }
}

module.exports = { FileAccess };
