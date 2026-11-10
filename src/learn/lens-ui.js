/**
 * Chain Lens, the visible part: the data after each step of a chain.
 *  - In a notebook it uses the notebook's own kernel (its variables as they are).
 *  - In a .py file it runs the code above the chain in a temporary Python,
 *    then looks at each step, and closes that Python again.
 */
import { chainAt, describeChange } from './chain.js';
import { KernelSession, kernelsAvailable } from '../notebook/kernel-client.js';
import { showToast } from '../toast.js';

const LENS_TIMEOUT_MS = 25_000;
let counter = 0;

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const sizeText = (s) => {
  if (s.shape) return s.shape.join(' × ');
  if (s.groups != null) return `${s.groups} groups`;
  if (s.len != null) return `${s.len} item${s.len === 1 ? '' : 's'}`;
  return '';
};

/**
 * Draw the steps into `container`.
 * @param {HTMLElement} container
 * @param {{ steps: object[], error: object|null, expr: string }} result
 * @param {() => void} [onClose]
 */
export function renderLens(container, { steps, error, expr }, onClose) {
  container.replaceChildren();
  container.classList.add('lens');
  const head = el('div', 'lens__head');
  head.append(el('span', 'lens__title', 'Chain Lens'), el('code', 'lens__expr', expr));
  if (onClose) {
    const close = el('button', 'lens__close', '×');
    close.type = 'button';
    close.title = 'Close';
    close.setAttribute('aria-label', 'Close Chain Lens');
    close.addEventListener('click', onClose);
    head.append(close);
  }
  container.append(head);
  // Modules and plain functions (pd, np, len) are not data: skip those steps
  const shown = steps.filter((s) => s.module !== '' || !['module', 'function', 'builtin_function_or_method', 'type'].includes(s.type))
    .filter((s) => !s.callable || s.shape);
  let prev = null;
  const list = el('ol', 'lens__steps');
  shown.forEach((s, i) => {
    const li = el('li', 'lens__step');
    const top = el('div', 'lens__row');
    const label = i === 0 ? s.expr : s.expr.slice(shown[i - 1].expr.length) || s.expr;
    top.append(el('code', 'lens__op', label), el('span', 'lens__type', s.module && s.module !== 'builtins' ? `${s.type}` : s.type));
    const size = sizeText(s);
    if (size) top.append(el('span', 'lens__size', size));
    const change = describeChange(prev, s);
    if (change) top.append(el('span', `lens__change${/−/.test(change) ? ' is-less' : /\+/.test(change) ? ' is-more' : ''}`, change));
    li.append(top);
    if (s.columns?.length && (!prev?.columns || prev.columns.join() !== s.columns.join())) {
      li.append(el('div', 'lens__cols', `columns: ${s.columns.slice(0, 12).join(', ')}${s.columns.length > 12 ? ' …' : ''}`));
    }
    if (s.preview) {
      const det = el('details', 'lens__preview');
      if (i === shown.length - 1) det.open = true;
      det.append(el('summary', '', 'preview'), el('pre', '', s.preview));
      li.append(det);
    }
    list.append(li);
    prev = s;
  });
  container.append(list);
  if (error) {
    container.append(el('div', 'lens__error', `${error.expr ? `${error.expr}: ` : ''}${error.ename}${error.evalue ? `: ${error.evalue}` : ''}`));
  }
  if (!shown.length && !error) container.append(el('div', 'lens__note', 'Nothing to show for this line.'));
}

/** Ask a kernel for the steps; resolves with { steps, error }. `listen` hooks lens-result messages. */
export function askKernel(kernel, steps, listen) {
  const runId = `lens${++counter}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => { stop(); kernel.interrupt(); resolve({ steps: [], error: { expr: '', ename: 'Timeout', evalue: 'The chain took too long to evaluate.' } }); }, LENS_TIMEOUT_MS);
    const stop = listen((msg) => {
      if (msg.type === 'lens-result' && msg.id === runId) {
        clearTimeout(timer);
        stop();
        resolve({ steps: Array.isArray(msg.steps) ? msg.steps : [], error: msg.error || null });
      }
    });
    Promise.resolve(kernel.lens(runId, steps)).catch((err) => {
      clearTimeout(timer);
      stop();
      resolve({ steps: [], error: { expr: '', ename: 'Error', evalue: String(err?.message || err) } });
    });
  });
}

// ── .py files ──────────────────────────────────────────────────────

function lensCard() {
  let c = document.getElementById('lens-card');
  if (!c) {
    c = el('section', 'lens-card hidden');
    c.id = 'lens-card';
    c.setAttribute('aria-live', 'polite');
    const well = document.querySelector('.terminal-well');
    well?.parentElement?.insertBefore(c, well);
  }
  return c;
}

/**
 * Chain Lens on a .py file at a line.
 * @param {{ code: string, line: number, filePath: string|null }} opts
 */
export async function lensInFile({ code, line, filePath }) {
  const at = chainAt(code, line);
  if (!at) {
    showToast('Put the cursor on a chain like df.dropna().groupby("x").mean()', 'info', 2600);
    return;
  }
  if (at.indent > 0) {
    showToast('Chain Lens on a .py file works on lines that are not inside a function or loop', 'info', 3000);
    return;
  }
  if (!kernelsAvailable()) {
    showToast('Chain Lens needs the desktop app with Python', 'info', 2400);
    return;
  }
  const card = lensCard();
  card.classList.remove('hidden');
  card.replaceChildren(el('div', 'lens__note', 'Running the code above this line…'));
  const listeners = new Set();
  const kernel = new KernelSession({
    onMessage: (msg) => listeners.forEach((fn) => fn(msg)),
    onExit: () => {},
  });
  const listen = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  try {
    await kernel.start(filePath);
    const prefix = code.split('\n').slice(0, at.from - 1).join('\n');
    if (prefix.trim()) {
      const runId = `lensrun${++counter}`;
      const result = await new Promise((resolve) => {
        const timer = setTimeout(() => { kernel.interrupt(); }, LENS_TIMEOUT_MS);
        let failed = null;
        const stop = listen((msg) => {
          if (msg.id !== runId) return;
          if (msg.type === 'input_request') { kernel.interrupt(); failed = { ename: 'Input', evalue: 'The code above asks for input(), so Chain Lens cannot run it on its own.' }; }
          if (msg.type === 'error' && !failed) failed = { ename: msg.ename, evalue: msg.evalue };
          if (msg.type === 'done') { clearTimeout(timer); stop(); resolve(failed); }
        });
        kernel.execute(runId, prefix);
      });
      if (result) {
        renderLens(card, { steps: [], error: { expr: '', ename: result.ename, evalue: `the code above line ${at.from} stopped: ${result.evalue}` }, expr: at.expr }, () => card.classList.add('hidden'));
        return;
      }
    }
    const res = await askKernel(kernel, at.steps, listen);
    renderLens(card, { ...res, expr: at.expr }, () => card.classList.add('hidden'));
  } catch (err) {
    renderLens(card, { steps: [], error: { expr: '', ename: 'Error', evalue: String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }, expr: at.expr }, () => card.classList.add('hidden'));
  } finally {
    kernel.dispose();
  }
}
