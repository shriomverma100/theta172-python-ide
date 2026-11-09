/**
 * Frameless window controls and the "unsaved changes" close flow.
 */
import { $ } from '../core/dom.js';

const RESTORE_ICON = '<rect x=".5" y="2.5" width="7" height="7" stroke="currentColor" fill="none" stroke-width="1"/><rect x="2.5" y=".5" width="7" height="7" stroke="currentColor" fill="none" stroke-width="1"/>';
const MAX_ICON = '<rect x=".5" y=".5" width="9" height="9" stroke="currentColor" fill="none" stroke-width="1"/>';

export function initWindowControls() {
  const api = window.electronAPI;
  if (!api) {
    // Browser build: the OS draws the window, hide our buttons
    document.querySelectorAll('.wc-btn').forEach((b) => { b.style.display = 'none'; });
    return;
  }

  $('btn-wc-min')?.addEventListener('click', () => api.minimize());
  $('btn-wc-max')?.addEventListener('click', () => api.maximize());
  $('btn-wc-close')?.addEventListener('click', () => api.close());

  const setIcon = (isMax) => {
    const $icon = $('wc-max-icon');
    if ($icon) $icon.innerHTML = isMax ? RESTORE_ICON : MAX_ICON;
  };
  api.onMaximizeChange(setIcon);
  api.isMaximized().then(setIcon);
}

const DIALOG_HTML = `
  <div class="unsaved-dialog" role="alertdialog" aria-modal="true" aria-labelledby="unsaved-title" aria-describedby="unsaved-desc">
    <div class="unsaved-dialog__header">
      <span class="unsaved-dialog__graphic" aria-hidden="true"></span>
      <div class="unsaved-dialog__title-group">
        <h3 class="unsaved-dialog__title" id="unsaved-title">Unsaved changes</h3>
        <p class="unsaved-dialog__subtitle" id="unsaved-desc">Your edits will be lost if you close without saving.</p>
      </div>
    </div>
    <div class="unsaved-dialog__divider"></div>
    <div class="unsaved-dialog__actions">
      <button type="button" class="unsaved-btn unsaved-btn--cancel" data-choice="cancel">Cancel</button>
      <button type="button" class="unsaved-btn unsaved-btn--discard" data-choice="discard">Don't save</button>
      <button type="button" class="unsaved-btn unsaved-btn--save" data-choice="save">Save</button>
    </div>
  </div>`;

/**
 * @param {object} opts
 * @param {() => boolean} opts.hasUnsaved
 * @param {() => Promise<boolean>} opts.save  resolves true when saved
 */
export function initUnsavedHandling({ hasUnsaved, save }) {
  const api = window.electronAPI;
  if (!api) return;

  api.onCheckUnsaved(() => api.sendUnsavedStatus(hasUnsaved()));

  // "Save" chosen in the dialog: only close once the save really happened.
  // If the user cancels the Save As dialog, the window stays open.
  api.onSaveAndClose(async () => {
    let saved = false;
    try { saved = await save(); } catch (_) { saved = false; }
    if (saved) api.sendCloseConfirmed();
  });

  const overlay = document.createElement('div');
  overlay.className = 'unsaved-dialog-overlay';
  overlay.id = 'unsaved-dialog';
  overlay.innerHTML = DIALOG_HTML;
  document.body.appendChild(overlay);

  const respond = (choice) => {
    overlay.classList.remove('visible');
    api.sendUnsavedDialogResponse(choice);
  };

  api.onShowUnsavedDialog(() => {
    overlay.classList.add('visible');
    overlay.querySelector('[data-choice="save"]')?.focus();
  });

  overlay.querySelectorAll('[data-choice]').forEach((btn) => {
    btn.addEventListener('click', () => respond(btn.dataset.choice));
  });
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') respond('cancel');
  });
}
