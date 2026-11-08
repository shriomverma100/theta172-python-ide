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

  $('tab-terminal')?.classList.toggle('active', pane === 'terminal');
  $('tab-repl')?.classList.toggle('active', pane === 'repl');
  $('terminal-container')?.classList.toggle('hidden', pane !== 'terminal');
  $('repl-container')?.classList.toggle('hidden', pane !== 'repl');

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
}

/** Clear whichever output pane is visible. */
export function clearOutput() {
  if (state.activePane === 'repl' && state.replManager?.term) state.replManager.term.clear();
  else state.terminal?.clear();
}

export function adjustFontSize(delta) {
  state.fontSize = Math.max(MIN_FONT, Math.min(MAX_FONT, state.fontSize + delta));
  setFontSize(state.fontSize);
  showToast(`Font size: ${state.fontSize}px`, 'info', 1400);
}

/** Drag the gutter between editor and terminal to resize them. */
export function initGutter() {
  const $gutter = $('split-gutter');
  const $editorPane = $('editor-pane');
  const $editorHost = $('monaco-container');
  const $termHost = $('terminal-container');
  const ideBody = document.querySelector('.ide-body');
  if (!$gutter || !$editorPane || !ideBody) return;

  let dragging = false;
  let startX = 0;
  let startW = 0;
  let frame = 0;

  const relayout = () => {
    editorLayout();
    state.terminal?.fit();
  };

  $gutter.addEventListener('mousedown', (e) => {
    dragging = true;
    startX = e.clientX;
    startW = $editorPane.getBoundingClientRect().width;
    $gutter.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    // Stop panes from stealing mouse events mid-drag
    if ($editorHost) $editorHost.style.pointerEvents = 'none';
    if ($termHost) $termHost.style.pointerEvents = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const total = ideBody.getBoundingClientRect().width;
    const width = Math.max(MIN_PANE_PX, Math.min(startW + (e.clientX - startX), total - MIN_PANE_PX));
    $editorPane.style.width = `${(width / total) * 100}%`;
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
