/**
 * App themes: "playground" (Bento x Sticker x Learn) and "pro" (quiet
 * precision). The theme is a data-theme attribute on <html>; all styling
 * reads CSS variables (src/styles/tokens.css). public/theme-init.js applies
 * the saved theme before first paint.
 *
 * Switching recolours the editor and terminals through onThemeChange
 * listeners, behind a pixel transition when effects are on.
 */
import { storageGet, storageSet } from '../core/storage.js';

export const THEMES = ['playground', 'pro'];
export const THEME_LABELS = { playground: 'Playground', pro: 'Pro' };
const KEY = 'theta-theme';

const listeners = new Set();

export function getTheme() {
  return document.documentElement.dataset.theme === 'pro' ? 'pro' : 'playground';
}

/** True once the user has picked a theme (on the first-launch screen or later). */
export function hasChosenTheme() {
  return THEMES.includes(storageGet(KEY));
}

/** @param {(theme: string) => void} fn @returns {() => void} unsubscribe */
export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function syncControls(theme) {
  document.querySelectorAll('[data-theme-choice]').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.themeChoice === theme));
  });
}

/** Apply a theme now (no animation) and remember it. */
export function applyTheme(name, { save = true } = {}) {
  const theme = THEMES.includes(name) ? name : 'playground';
  document.documentElement.dataset.theme = theme;
  if (save) storageSet(KEY, theme);
  syncControls(theme);
  listeners.forEach((fn) => {
    try { fn(theme); } catch (err) { console.error('[THETA] theme listener failed', err); }
  });
  return theme;
}

/**
 * Switch with a screen transition. `transition(onCovered)` comes from the
 * FX layer; it runs onCovered straight away when effects are off.
 */
export function switchTheme(name, transition = (fn) => fn()) {
  if (name === getTheme()) return;
  transition(() => applyTheme(name));
}

export function toggleTheme(transition) {
  switchTheme(getTheme() === 'pro' ? 'playground' : 'pro', transition);
}

/** Every [data-theme-choice] button anywhere switches the theme. */
export function initThemeControls(transition) {
  syncControls(getTheme());
  document.addEventListener('click', (e) => {
    const btn = e.target.closest?.('[data-theme-choice]');
    if (btn) switchTheme(btn.dataset.themeChoice, transition);
  });
}

/**
 * First launch: "Choose your environment". Resolves with the chosen theme.
 * @param {object} [o]
 * @param {(theme: string) => void} [o.onChosen] e.g. turn pixel effects off for Pro
 */
export function showThemePicker({ onChosen } = {}) {
  const $picker = document.getElementById('theme-picker');
  if (!$picker) return Promise.resolve(getTheme());

  return new Promise((resolve) => {
    $picker.classList.remove('hidden', 'chose-playground', 'chose-pro');
    const buttons = [...$picker.querySelectorAll('[data-pick]')];
    const current = buttons.find((b) => b.dataset.pick === getTheme()) || buttons[0];
    current?.focus();

    const onKey = (e) => {
      if (e.key !== 'Tab') return;
      // keep focus inside the two choices
      const i = buttons.indexOf(document.activeElement);
      e.preventDefault();
      buttons[(i + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
    };
    $picker.addEventListener('keydown', onKey);

    const pick = (theme) => {
      $picker.classList.add(`chose-${theme}`);
      buttons.forEach((b) => { b.disabled = true; });
      applyTheme(theme);
      onChosen?.(theme);
      setTimeout(() => {
        $picker.classList.add('hidden');
        $picker.removeEventListener('keydown', onKey);
        buttons.forEach((b) => { b.disabled = false; });
        resolve(theme);
      }, 380);
    };
    buttons.forEach((b) => { b.onclick = () => pick(b.dataset.pick); });
  });
}
