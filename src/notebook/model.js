/**
 * Jupyter notebooks (.ipynb, nbformat 4): reading, writing and turning
 * kernel messages into outputs. Pure functions, no DOM.
 *
 * In memory a notebook is
 *   { metadata, nbformat, nbformat_minor, cells: Cell[] }
 * and a cell is
 *   { id, type: 'code' | 'markdown' | 'raw', source: string, outputs: Output[],
 *     count: number | null, metadata, attachments? }
 * Outputs keep the nbformat shape (output_type, data, text, …) with every
 * multi-line value joined into one string.
 */

export const NBFORMAT = 4;
export const NBFORMAT_MINOR = 5;

const DEFAULT_METADATA = {
  kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
  language_info: { name: 'python' },
};

export class NotebookError extends Error {}

/** A random cell id (nbformat 4.5: 1–64 letters, digits, - and _). */
export function newCellId() {
  const bytes = new Uint8Array(4);
  (globalThis.crypto || { getRandomValues: (a) => a.map(() => Math.floor(Math.random() * 256)) }).getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function newCell(type = 'code', source = '') {
  const cell = { id: newCellId(), type, source, outputs: [], count: null, metadata: {} };
  return cell;
}

export function newNotebook() {
  return {
    metadata: structuredClone(DEFAULT_METADATA),
    nbformat: NBFORMAT,
    nbformat_minor: NBFORMAT_MINOR,
    cells: [newCell('code', '')],
  };
}

/** nbformat stores text as a string or a list of lines. */
const joinText = (v) => (Array.isArray(v) ? v.join('') : typeof v === 'string' ? v : v == null ? '' : String(v));

/** Split text into lines that keep their "\n" (how Jupyter writes it). */
export function splitLines(text) {
  if (!text) return [];
  const out = text.split(/(?<=\n)/);
  return out;
}

function readOutput(o) {
  if (!o || typeof o !== 'object') return null;
  switch (o.output_type) {
    case 'stream':
      return { output_type: 'stream', name: o.name === 'stderr' ? 'stderr' : 'stdout', text: joinText(o.text) };
    case 'display_data':
    case 'execute_result': {
      const data = {};
      for (const [mime, v] of Object.entries(o.data || {})) {
        data[mime] = mime.endsWith('json') && typeof v === 'object' && !Array.isArray(v) ? v : joinText(v);
      }
      const out = { output_type: o.output_type, data, metadata: o.metadata || {} };
      if (o.output_type === 'execute_result') out.execution_count = Number.isInteger(o.execution_count) ? o.execution_count : null;
      return out;
    }
    case 'error':
      return {
        output_type: 'error',
        ename: String(o.ename ?? 'Error'),
        evalue: String(o.evalue ?? ''),
        traceback: Array.isArray(o.traceback) ? o.traceback.map(String) : [],
      };
    default:
      return null;
  }
}

/**
 * Read .ipynb text. An empty file is a new notebook.
 * @throws {NotebookError} when the text is not a notebook this app can open
 */
export function parseNotebook(text) {
  if (!text || !text.trim()) return newNotebook();
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (_) {
    throw new NotebookError('This file is not valid notebook JSON.');
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.cells)) {
    throw new NotebookError(raw?.worksheets ? 'This notebook uses the old format 3. Open it in Jupyter and save it again to upgrade it.' : 'This file is not a Jupyter notebook.');
  }
  if (raw.nbformat !== undefined && raw.nbformat < 4) {
    throw new NotebookError('This notebook uses an old format. Open it in Jupyter and save it again to upgrade it.');
  }
  const seen = new Set();
  const cells = raw.cells.map((c) => {
    const type = c?.cell_type === 'markdown' || c?.cell_type === 'raw' ? c.cell_type : 'code';
    let id = typeof c?.id === 'string' && /^[\w-]{1,64}$/.test(c.id) ? c.id : newCellId();
    while (seen.has(id)) id = newCellId();
    seen.add(id);
    const cell = { id, type, source: joinText(c?.source), outputs: [], count: null, metadata: c?.metadata && typeof c.metadata === 'object' ? c.metadata : {} };
    if (type === 'code') {
      cell.outputs = (Array.isArray(c.outputs) ? c.outputs : []).map(readOutput).filter(Boolean);
      cell.count = Number.isInteger(c.execution_count) ? c.execution_count : null;
    }
    if (c?.attachments && type !== 'code') cell.attachments = c.attachments;
    return cell;
  });
  return {
    metadata: raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : structuredClone(DEFAULT_METADATA),
    nbformat: NBFORMAT,
    nbformat_minor: Math.max(NBFORMAT_MINOR, Number.isInteger(raw.nbformat_minor) && raw.nbformat === 4 ? raw.nbformat_minor : 0),
    cells: cells.length ? cells : [newCell('code', '')],
  };
}

/** Binary data (images) stays one string; text is a list of lines. */
const writeMime = (mime, v) => {
  if (typeof v !== 'string') return v;
  if (/^image\/(png|jpeg|gif|webp)$/.test(mime)) return v;
  return splitLines(v);
};

function writeOutput(o) {
  switch (o.output_type) {
    case 'stream':
      return { name: o.name, output_type: 'stream', text: splitLines(o.text) };
    case 'display_data':
    case 'execute_result': {
      const data = {};
      for (const [mime, v] of Object.entries(o.data || {})) data[mime] = writeMime(mime, v);
      const out = { data, metadata: o.metadata || {}, output_type: o.output_type };
      if (o.output_type === 'execute_result') out.execution_count = o.execution_count ?? null;
      return out;
    }
    case 'error':
      return { ename: o.ename, evalue: o.evalue, output_type: 'error', traceback: o.traceback };
    default:
      return null;
  }
}

/** Write a notebook the way Jupyter does (1-space indent, keys sorted per cell, newline at the end). */
export function serializeNotebook(nb, { pythonVersion } = {}) {
  const metadata = { ...nb.metadata };
  if (pythonVersion) metadata.language_info = { ...(metadata.language_info || {}), name: 'python', version: pythonVersion };
  if (!metadata.kernelspec) metadata.kernelspec = structuredClone(DEFAULT_METADATA.kernelspec);
  const cells = nb.cells.map((c) => {
    const out = { cell_type: c.type, id: c.id, metadata: c.metadata || {}, source: splitLines(c.source) };
    if (c.type === 'code') {
      out.execution_count = c.count ?? null;
      out.outputs = c.outputs.map(writeOutput).filter(Boolean);
    } else if (c.attachments) {
      out.attachments = c.attachments;
    }
    return sortKeys(out);
  });
  const doc = { cells, metadata, nbformat: NBFORMAT, nbformat_minor: nb.nbformat_minor ?? NBFORMAT_MINOR };
  return `${JSON.stringify(doc, null, 1)}\n`;
}

function sortKeys(obj) {
  const out = {};
  for (const k of Object.keys(obj).sort()) out[k] = obj[k];
  return out;
}

// ── Kernel messages → outputs ────────────────────────────────────

/** Most text a single stream output keeps (a runaway print loop must not freeze the app). */
export const MAX_STREAM_CHARS = 200_000;

/**
 * Apply carriage returns and backspaces the way a terminal shows them
 * (progress bars rewrite their line with "\r").
 */
export function applyControlChars(text) {
  if (!/[\r\b]/.test(text)) return text;
  const lines = text.split('\n');
  return lines.map((line) => {
    let buf = '';
    let col = 0;
    // "\r\n" endings already lost their \n in split; a trailing \r alone moves to column 0
    for (const ch of line) {
      if (ch === '\r') col = 0;
      else if (ch === '\b') col = Math.max(0, col - 1);
      else {
        buf = buf.slice(0, col) + ch + buf.slice(col + 1);
        col++;
      }
    }
    return buf;
  }).join('\n');
}

/**
 * Add a kernel message to a cell's outputs (mutates `outputs`).
 * @returns {boolean} whether the outputs changed
 */
export function addMessage(outputs, msg) {
  switch (msg.type) {
    case 'stream': {
      const name = msg.name === 'stderr' ? 'stderr' : 'stdout';
      const last = outputs[outputs.length - 1];
      if (last?.output_type === 'stream' && last.name === name) {
        last.text = trimStream(applyControlChars(last.text + msg.text));
      } else {
        outputs.push({ output_type: 'stream', name, text: trimStream(applyControlChars(String(msg.text ?? ''))) });
      }
      return true;
    }
    case 'display':
      outputs.push({ output_type: 'display_data', data: msg.data || {}, metadata: {} });
      return true;
    case 'result':
      outputs.push({ output_type: 'execute_result', data: msg.data || {}, metadata: {}, execution_count: msg.count ?? null });
      return true;
    case 'error':
      outputs.push({
        output_type: 'error',
        ename: String(msg.ename ?? 'Error'),
        evalue: String(msg.evalue ?? ''),
        traceback: String(msg.traceback ?? '').replace(/\n$/, '').split('\n'),
      });
      return true;
    default:
      return false;
  }
}

function trimStream(text) {
  if (text.length <= MAX_STREAM_CHARS) return text;
  return `[… earlier output hidden …]\n${text.slice(text.length - MAX_STREAM_CHARS)}`;
}

/** Text with ANSI colour codes removed (tracebacks from Jupyter contain them). */
export function stripAnsi(text) {
  return String(text).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
}

/** The best way to show a display bundle: the first MIME type the app can render. */
export const MIME_ORDER = ['text/html', 'image/svg+xml', 'image/png', 'image/jpeg', 'image/gif', 'text/markdown', 'text/latex', 'application/json', 'text/plain'];

export function pickMime(data) {
  return MIME_ORDER.find((m) => data?.[m] !== undefined && data[m] !== '') || null;
}

/** Python source of the notebook's code cells (export as a script). */
export function toPythonScript(nb) {
  const parts = nb.cells.map((c) => {
    if (c.type === 'code') return `# %%\n${c.source.replace(/\s+$/, '')}\n`;
    if (c.type === 'markdown') return `# %% [markdown]\n${c.source.replace(/\s+$/, '').split('\n').map((l) => (l ? `# ${l}` : '#')).join('\n')}\n`;
    return '';
  });
  return parts.filter(Boolean).join('\n');
}
