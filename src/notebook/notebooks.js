/**
 * Notebooks as editor tabs: a tab whose file ends in .ipynb shows a
 * NotebookView instead of the code editor. Run and Stop in the toolbar act
 * on the notebook's selected cell; Save writes .ipynb.
 */
import { NotebookView } from './notebook-view.js';
import { parseNotebook } from './model.js';
import { registerNotebookKind, getActiveTab, markTabUnsaved, addNewTab, getTabs } from '../app/tabs.js';
import { showToast } from '../toast.js';

const views = new Map(); // tab id -> NotebookView

export const isNotebookName = (name) => /\.ipynb$/i.test(name || '');

function viewFor(tab) {
  let view = views.get(tab.id);
  if (!view) {
    view = new NotebookView({
      text: tab.code,
      filePath: () => tab.filePath,
      onDirty: () => markTabUnsaved(tab.id),
      notify: (msg, kind = 'info') => showToast(msg, kind, kind === 'error' ? 4000 : 2400),
    });
    views.set(tab.id, view);
  }
  return view;
}

/** The notebook in the focused group, or null. */
export function activeNotebook() {
  const tab = getActiveTab();
  return tab?.kind === 'notebook' ? viewFor(tab) : null;
}

/** Run (toolbar / Ctrl+Enter outside a cell): the selected cell. */
export function runActiveNotebookCell() {
  const nb = activeNotebook();
  if (!nb) return false;
  nb.runCell(nb.selected);
  return true;
}

export function interruptActiveNotebook() {
  const nb = activeNotebook();
  if (!nb) return false;
  nb.interrupt();
  return true;
}

/** A new, untitled notebook tab. */
export function newNotebook() {
  const used = new Set(getTabs().map((t) => t.name));
  let n = 1;
  while (used.has(`notebook-${n}.ipynb`)) n++;
  addNewTab(`notebook-${n}.ipynb`, '');
  activeNotebook()?.editCell();
}

export function initNotebooks() {
  registerNotebookKind({
    /** .ipynb files that parse open as notebooks; broken ones open as text so nothing is lost. */
    matches(name, code) {
      if (!isNotebookName(name)) return false;
      try {
        parseNotebook(code);
        return true;
      } catch (err) {
        showToast(`${name} opened as text: ${err.message}`, 'info', 4000);
        return false;
      }
    },
    mount: (tab, container) => viewFor(tab).mount(container),
    unmount: (tab) => views.get(tab.id)?.unmount(),
    focus: (tab) => views.get(tab.id)?.focus(),
    text: (tab) => views.get(tab.id)?.serialize() ?? tab.code,
    reload(tab, text) {
      const view = views.get(tab.id);
      if (!view) return;
      try { view.load(text); } catch (_) { /* keep what is shown */ }
    },
    dispose(tab) {
      views.get(tab.id)?.dispose();
      views.delete(tab.id);
    },
  });
}
