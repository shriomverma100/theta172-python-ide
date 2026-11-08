/**
 * THETA. — Theme Manager
 * Handles light/dark theme toggling for the editor pane.
 */

import { toggleEditorTheme } from './editor.js';
import { showToast } from './toast.js';

const SUN_ICON = `<circle cx="7" cy="7" r="3.5" stroke="currentColor" stroke-width="1.3"/><path d="M7 1.5V3M7 11V12.5M1.5 7H3M11 7H12.5M3.1 3.1L4.2 4.2M9.8 9.8L10.9 10.9M3.1 10.9L4.2 9.8M9.8 4.2L10.9 3.1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>`;
const MOON_ICON = `<path d="M10.5 7A5 5 0 114.5 3.5 3.5 3.5 0 0010.5 7Z" stroke="currentColor" stroke-width="1.3" fill="none"/>`;

let _elements = {};

export function handleThemeToggle() {
  const { $editorPane, $themeIcon, $themeLabel, $statusThemeText } = _elements;
  const newTheme = toggleEditorTheme();
  const isLight = newTheme === 'light';

  if (isLight) {
    $editorPane?.classList.remove('theme-dark');
  } else {
    $editorPane?.classList.add('theme-dark');
  }

  if ($themeIcon) $themeIcon.innerHTML = isLight ? SUN_ICON : MOON_ICON;
  if ($themeLabel) $themeLabel.textContent = isLight ? 'Light' : 'Dark';
  if ($statusThemeText) $statusThemeText.textContent = isLight ? 'Light' : 'Dark';

  showToast(`Editor theme: ${isLight ? 'Light' : 'Dark'}`, 'info', 1400);
}

export function initTheme(elements) {
  _elements = elements;
  const { $themeBtn, $statusTheme } = elements;
  $themeBtn?.addEventListener('click', handleThemeToggle);
  $statusTheme?.addEventListener('click', handleThemeToggle);
}

export { SUN_ICON, MOON_ICON };
