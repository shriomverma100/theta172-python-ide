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
  $('landing-wc-min')?.addEventListener('click', () => api.minimize());
  $('landing-wc-max')?.addEventListener('click', () => api.maximize());
  $('landing-wc-close')?.addEventListener('click', () => api.close());

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
      <svg class="unsaved-dialog__graphic" width="44" height="44" viewBox="0 0 44 44" fill="none" aria-hidden="true">
        <rect x="6" y="3" width="22" height="30" rx="2" stroke="#3a3a38" stroke-width="1.5" fill="#1e1e1c"/>
        <rect x="10" y="9" width="14" height="1.5" rx=".75" fill="#3a3a38"/>
        <rect x="10" y="13.5" width="10" height="1.5" rx=".75" fill="#3a3a38"/>
        <rect x="10" y="18" width="12" height="1.5" rx=".75" fill="#3a3a38"/>
        <rect x="10" y="22.5" width="8" height="1.5" rx=".75" fill="#3a3a38"/>
        <circle cx="32" cy="30" r="9" fill="#1a1a18" stroke="#2e2e2c" stroke-width="1.5"/>
        <circle cx="32" cy="30" r="5.5" fill="none" stroke="#ff3300" stroke-width="1.4" stroke-dasharray="3.5 2"/>
        <circle cx="32" cy="30" r="2" fill="#ff3300" class="unsaved-pulse"/>
      </svg>
      <div class="unsaved-dialog__title-group">
        <h3 class="unsaved-dialog__title" id="unsaved-title">Unsaved changes</h3>
        <p class="unsaved-dialog__subtitle" id="unsaved-desc">Your edits will be lost if you close without saving.</p>
      </div>
    </div>
    <div class="unsaved-dialog__divider"></div>
    <div class="unsaved-dialog__actions">
      <button type="button" class="unsaved-btn unsaved-btn--save" data-choice="save">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2 2.5C2 2.22 2.22 2 2.5 2H8.29L12 5.71V11.5C12 11.78 11.78 12 11.5 12H2.5C2.22 12 2 11.78 2 11.5V2.5Z" stroke="currentColor" stroke-width="1.2"/><rect x="4" y="7.5" width="6" height="4" stroke="currentColor" stroke-width="1"/></svg>
        Save
      </button>
      <button type="button" class="unsaved-btn unsaved-btn--discard" data-choice="discard">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M3 3.5H11L10.3 12H3.7L3 3.5Z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/><path d="M2 3.5H12" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M5 2H9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
        Discard
      </button>
      <button type="button" class="unsaved-btn unsaved-btn--cancel" data-choice="cancel">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M4 4L10 10M10 4L4 10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
        Cancel
      </button>
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
