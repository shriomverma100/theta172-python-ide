/**
 * Helpers for Python tracebacks shown in the terminal.
 */

// Local runs execute a temp copy (theta_run_<uuid>.py); show the tab's name instead.
const TEMP_RUN_FILE = /File "[^"\n]*theta_run_[0-9a-f-]+\.py"/gi;

/**
 * @param {string} text      stderr from Python
 * @param {string} fileName  shown instead of the runner's temp file
 * @param {string} [root]    the project folder: its paths become relative
 */
export function tidyTraceback(text, fileName, root) {
  let out = text.replace(TEMP_RUN_FILE, () => `File "${fileName}"`);
  if (root) {
    const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, (ch) => `\\${ch}`);
    const flags = root.includes('\\') ? 'gi' : 'g'; // Windows paths ignore case
    out = out.replace(new RegExp(`File "${escaped}[\\\\/]`, flags), 'File "');
  }
  return out;
}

/**
 * The line to highlight for a traceback: the innermost frame that is in the
 * user's own file (local runs: the tab name; Pyodide: "<exec>"). Frames in
 * libraries are skipped. Falls back to a bare "line N" (syntax errors).
 */
export function errorLineInUserCode(text, fileName) {
  const frames = [...text.matchAll(/File "([^"\n]*)", line (\d+)/g)]
    .filter(([, file]) => file === fileName || file === '<exec>' || file === '<string>');
  if (frames.length) return parseInt(frames[frames.length - 1][2], 10);
  if (/File "/.test(text)) return null; // only library frames in this chunk
  const bare = text.match(/line\s+(\d+)/i);
  return bare ? parseInt(bare[1], 10) : null;
}
