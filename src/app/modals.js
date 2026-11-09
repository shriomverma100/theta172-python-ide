/**
 * Examples and Keyboard Shortcuts modals.
 */
import { setValue, focusEditor } from '../editor.js';
import { EXAMPLES } from '../examples.js';
import { showToast } from '../toast.js';
import { $ } from '../core/dom.js';
import { renderShortcutsModal, cancelRecording, resetShortcuts } from './shortcuts.js';

const ARROW_ICON = '<svg class="example-item__arrow" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M3 7H11M11 7L7.5 3.5M11 7L7.5 10.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function openExamples() {
  $('examples-modal')?.classList.remove('hidden');
}

export function closeExamples() {
  $('examples-modal')?.classList.add('hidden');
}

export function openShortcuts() {
  renderShortcutsModal();
  $('shortcuts-modal')?.classList.remove('hidden');
}

export function closeShortcuts() {
  cancelRecording();
  $('shortcuts-modal')?.classList.add('hidden');
}

export function closeAllModals() {
  closeExamples();
  closeShortcuts();
}

function renderExamples() {
  const $list = $('examples-list');
  if (!$list) return;
  for (const ex of EXAMPLES) {
    const item = document.createElement('div');
    item.className = 'example-item';
    item.setAttribute('role', 'button');
    item.tabIndex = 0;

    const info = document.createElement('div');
    info.className = 'example-item__info';
    const name = document.createElement('div');
    name.className = 'example-item__name';
    name.textContent = ex.name;
    const desc = document.createElement('div');
    desc.className = 'example-item__desc';
    desc.textContent = ex.desc;
    info.append(name, desc);

    item.appendChild(info);
    item.insertAdjacentHTML('beforeend', ARROW_ICON);

    const load = () => {
      setValue(ex.code);
      closeExamples();
      focusEditor();
      showToast(`Loaded: ${ex.name}`, 'success', 1800);
    };
    item.addEventListener('click', load);
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        load();
      }
    });
    $list.appendChild(item);
  }
}

export function initModals() {
  renderExamples();
  $('btn-examples')?.addEventListener('click', openExamples);
  $('close-examples')?.addEventListener('click', closeExamples);
  $('examples-modal')?.querySelector('.modal-backdrop')?.addEventListener('click', closeExamples);

  $('btn-shortcuts')?.addEventListener('click', openShortcuts);
  $('close-shortcuts')?.addEventListener('click', closeShortcuts);
  $('shortcuts-modal')?.querySelector('.modal-backdrop')?.addEventListener('click', closeShortcuts);
  $('reset-shortcuts')?.addEventListener('click', resetShortcuts);
}
