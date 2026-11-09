/**
 * Layout: Terminal/REPL pane switching, the editor/terminal split gutter,
 * clearing output and editor font size.
 */
import { layout as editorLayout, setFontSize } from '../editor.js';
import { showToast } from '../toast.js';
import { $ } from '../core/dom.js';
import { state } from './state.js';

const MIN_FONT = 10;
const MAX_FONT = 24;
const MIN_PANE_PX = 220;

export function switchPane(pane) {
  if (pane === state.activePane) return;
  state.activePane = pane;

  for (const p of ['terminal', 'repl', 'shell', 'problems']) {
    $(`tab-${p}`)?.classList.toggle('active', pane === p);
    $(`${p}-container`)?.classList.toggle('hidden', pane !== p);
  }

  if (pane === 'problems') return;
  if (pane === 'shell') {
    setTimeout(() => state.shell?.open(), 30);
    return;
  }

  if (pane === 'repl') {
    const repl = state.replManager;
    if (repl && !repl.started) {
      repl.start(state.useLocalPython ? 'local' : 'pyodide', state.workerManager?.worker || null);
    }
    setTimeout(() => repl?.fit(), 50);
  } else {
    setTimeout(() => state.terminal?.fit(), 50);
  }
}

export function initPaneTabs() {
  $('tab-terminal')?.addEventListener('click', () => switchPane('terminal'));
  $('tab-repl')?.addEventListener('click', () => switchPane('repl'));
  $('tab-shell')?.addEventListener('click', () => switchPane('shell'));
  $('tab-problems')?.addEventListener('click', () => switchPane('problems'));
  $('status-problems')?.addEventListener('click', () => switchPane('problems'));
}

/** Clear whichever output pane is visible. */
export function clearOutput() {
  if (state.activePane === 'repl' && state.replManager?.term) state.replManager.term.clear();
  else if (state.activePane === 'shell') state.shell?.clear();
  else state.terminal?.clear();
}

export function adjustFontSize(delta) {
  state.fontSize = Math.max(MIN_FONT, Math.min(MAX_FONT, state.fontSize + delta));
  setFontSize(state.fontSize);
  showToast(`Font size: ${state.fontSize}px`, 'info', 1400);
}

/**
 * Drag the gutter to resize the output.
 * Playground: the output tile is on the right, so drag left/right (--side-w).
 * Pro: the output panel is at the bottom, so drag up/down (--panel-h).
 */
export function initGutter() {
  const $gutter = $('split-gutter');
  const $editorHost = $('monaco-container');
  const $termHost = $('terminal-container');
  const ideBody = document.querySelector('.ide-body');
  if (!$gutter || !ideBody) return;

  let dragging = false;
  let frame = 0;
  const isPro = () => document.documentElement.dataset.theme === 'pro';

  const relayout = () => {
    editorLayout();
    state.terminal?.fit();
    state.replManager?.fit();
    state.shell?.fit();
  };

  $gutter.addEventListener('mousedown', (e) => {
    if (window.matchMedia('(max-width: 900px)').matches) return; // stacked layout
    e.preventDefault();
    dragging = true;
    $gutter.classList.add('dragging');
    document.body.style.cursor = isPro() ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';
    // Stop the editor and terminal from stealing mouse events mid-drag
    if ($editorHost) $editorHost.style.pointerEvents = 'none';
    if ($termHost) $termHost.style.pointerEvents = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const box = ideBody.getBoundingClientRect();
    if (isPro()) {
      const h = Math.max(120, Math.min(box.bottom - e.clientY, box.height - MIN_PANE_PX));
      ideBody.style.setProperty('--panel-h', `${Math.round(h)}px`);
    } else {
      const w = Math.max(300, Math.min(box.right - 18 - e.clientX, box.width - MIN_PANE_PX - 60));
      ideBody.style.setProperty('--side-w', `${Math.round(w)}px`);
    }
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(relayout);
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    $gutter.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    if ($editorHost) $editorHost.style.pointerEvents = '';
    if ($termHost) $termHost.style.pointerEvents = '';
    relayout();
  });
}
