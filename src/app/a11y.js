/**
 * Accessibility wiring for static markup: dialog roles, button labels,
 * modal focus traps and a skip link.
 */
import { $ } from '../core/dom.js';

function markDialog(el, label) {
  el?.setAttribute('role', 'dialog');
  el?.setAttribute('aria-modal', 'true');
  el?.setAttribute('aria-label', label);
}

/** Keep Tab focus inside an open modal. */
function trapFocus(modal) {
  modal?.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const focusable = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
}

export function initAccessibility() {
  const $examples = $('examples-modal');
  const $shortcuts = $('shortcuts-modal');
  const $palette = $('cmd-palette');

  markDialog($examples, 'Code Examples');
  markDialog($shortcuts, 'Keyboard Shortcuts');
  markDialog($palette, 'Command Palette');
  [$examples, $shortcuts, $palette].forEach(trapFocus);

  // Icon-only buttons need a name for screen readers
  document.querySelectorAll('[id^="btn-"]').forEach((btn) => {
    if (!btn.getAttribute('aria-label')) {
      const text = btn.textContent?.trim() || btn.id.replace('btn-', '').replace(/-/g, ' ');
      btn.setAttribute('aria-label', text);
    }
  });

  const $tabBar = $('editor-tabs');
  $tabBar?.setAttribute('role', 'tablist');
  $tabBar?.setAttribute('aria-label', 'Open files');

  const skip = document.createElement('a');
  skip.href = '#monaco-container';
  skip.className = 'skip-link';
  skip.textContent = 'Skip to editor';
  document.body.insertBefore(skip, document.body.firstChild);
}
