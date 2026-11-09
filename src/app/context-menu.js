/**
 * Right-click menu for the code editor.
 */

let menu = null;

function hide() {
  menu?.classList.remove('visible');
}

/** The shared menu element (created on first use). */
function ensureMenu() {
  if (menu) return menu;
  menu = document.createElement('div');
  menu.className = 'theta-context-menu';
  menu.id = 'context-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Actions');
  document.body.appendChild(menu);
  document.addEventListener('click', hide);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  window.addEventListener('blur', hide);
  return menu;
}

/** Show a menu of { label, shortcut?, action } (or { type: 'separator' }) at x, y. */
export function showMenu(items, x, y) {
  ensureMenu();
  show(items, x, y);
}

function show(items, x, y) {
  menu.innerHTML = '';
  for (const item of items) {
    if (item.type === 'separator') {
      const sep = document.createElement('div');
      sep.className = 'ctx-separator';
      sep.setAttribute('role', 'separator');
      menu.appendChild(sep);
      continue;
    }
    const el = document.createElement('div');
    el.className = 'ctx-item';
    el.setAttribute('role', 'menuitem');
    el.setAttribute('tabindex', '-1');

    const label = document.createElement('span');
    label.textContent = item.label;
    el.appendChild(label);

    if (item.shortcut) {
      const key = document.createElement('span');
      key.className = 'ctx-shortcut';
      key.textContent = item.shortcut;
      el.appendChild(key);
    }

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      hide();
      item.action();
    });
    menu.appendChild(el);
  }

  menu.classList.add('visible');
  const maxX = window.innerWidth - menu.offsetWidth - 10;
  const maxY = window.innerHeight - menu.offsetHeight - 10;
  menu.style.left = `${Math.max(0, Math.min(x, maxX))}px`;
  menu.style.top = `${Math.max(0, Math.min(y, maxY))}px`;
}

/**
 * Attach to the element that hosts the editor. Must be called after the
 * editor exists (the old code queried .cm-editor too early and never
 * attached).
 * @param {HTMLElement} host
 * @param {{ runCode: Function, openFindReplace: Function }} actions
 */
export function initContextMenu(host, { runCode, openFindReplace }) {
  if (!host || host.dataset.ctxMenu) return;
  host.dataset.ctxMenu = '1';
  ensureMenu();

  const items = [
    { label: 'Cut', shortcut: 'Ctrl+X', action: () => document.execCommand('cut') },
    { label: 'Copy', shortcut: 'Ctrl+C', action: () => document.execCommand('copy') },
    {
      label: 'Paste', shortcut: 'Ctrl+V', action: async () => {
        try {
          document.execCommand('insertText', false, await navigator.clipboard.readText());
        } catch (_) {
          document.execCommand('paste');
        }
      },
    },
    { type: 'separator' },
    { label: 'Select All', shortcut: 'Ctrl+A', action: () => document.execCommand('selectAll') },
    { type: 'separator' },
    { label: 'Find & Replace', shortcut: 'Ctrl+F', action: openFindReplace },
    { label: 'Run Code', shortcut: 'Ctrl+Enter', action: runCode },
  ];

  host.addEventListener('contextmenu', (e) => {
    if (!e.target.closest?.('.cm-editor')) return;
    e.preventDefault();
    show(items, e.clientX, e.clientY);
  });
}
