/**
 * Settings dialog plus the status-bar FX switch.
 * Pixel effects: on/off (saved), and forced off while Windows
 * "Animation effects" is off (prefers-reduced-motion).
 */
import { getEditorTheme } from '../editor.js';
import { handleThemeToggle } from '../theme-manager.js';
import { showToast } from '../toast.js';
import { $ } from '../core/dom.js';
import { fx } from '../fx/moments.js';
import { state } from './state.js';
import { adjustFontSize } from './layout.js';

const FX_HINT = 'Small pixel animations when code runs, fails or a screen changes.';
const FX_HINT_REDUCED = 'Off because Windows animation effects are turned off (Settings › Accessibility › Visual effects).';

function renderFx() {
  const $switch = $('set-fx');
  const $hint = $('set-fx-hint');
  const $status = $('status-fx-text');
  $switch?.setAttribute('aria-checked', String(fx.enabled));
  if ($switch) $switch.disabled = fx.reducedMotion;
  if ($hint) $hint.textContent = fx.reducedMotion ? FX_HINT_REDUCED : FX_HINT;
  if ($status) $status.textContent = fx.enabled ? 'On' : 'Off';
}

function renderTheme() {
  const dark = getEditorTheme() !== 'light';
  $('set-theme-dark')?.setAttribute('aria-pressed', String(dark));
  $('set-theme-light')?.setAttribute('aria-pressed', String(!dark));
}

function renderFont() {
  const $v = $('set-font-value');
  if ($v) $v.textContent = `${state.fontSize} px`;
}

export function toggleFx() {
  if (fx.reducedMotion) {
    showToast('Pixel effects stay off while Windows animation effects are off', 'info', 3200);
    return;
  }
  fx.setUserEnabled(!fx.userEnabled);
  showToast(`Pixel effects ${fx.enabled ? 'on' : 'off'}`, 'info', 1400);
}

export function openSettings() {
  renderFx();
  renderTheme();
  renderFont();
  $('settings-modal')?.classList.remove('hidden');
  $('set-fx')?.focus();
}

export function closeSettings() {
  $('settings-modal')?.classList.add('hidden');
}

function setTheme(want) {
  if ((getEditorTheme() === 'light') !== (want === 'light')) handleThemeToggle();
  renderTheme();
}

export function initSettings() {
  fx.onChange(renderFx);
  renderFx();

  $('btn-settings')?.addEventListener('click', openSettings);
  $('close-settings')?.addEventListener('click', closeSettings);
  $('settings-modal')?.querySelector('.modal-backdrop')?.addEventListener('click', closeSettings);

  $('set-fx')?.addEventListener('click', toggleFx);
  $('status-fx')?.addEventListener('click', toggleFx);
  $('set-theme-dark')?.addEventListener('click', () => setTheme('dark'));
  $('set-theme-light')?.addEventListener('click', () => setTheme('light'));
  $('set-font-dec')?.addEventListener('click', () => { adjustFontSize(-1); renderFont(); });
  $('set-font-inc')?.addEventListener('click', () => { adjustFontSize(1); renderFont(); });
}
