/**
 * The app menu: File, Edit, View, Run, Help.
 *
 * Pro shows a menu bar (like other desktop IDEs); Playground shows one
 * "Menu" button with the same menus, to keep its top bar calm. Menus open on
 * click, move between each other on hover once one is open, and work fully
 * from the keyboard (arrows, Enter, Esc). Items do not take focus away from
 * the editor, so Cut / Copy / Paste act on what you had selected.
 *
 * Item: { label, action?: string (an app action id), run?: fn, shortcut?: id,
 *         when?: () => boolean, checked?: () => boolean, submenu?: () => items | Promise<items> }
 * or { separator: true }.
 */
import { getBindingLabel } from './shortcuts.js';

let menus = [];
let runAction = () => {};
let $bar = null;
let openMenu = null; // { index, el, button, returnFocus }

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/**
 * @param {object} opts
 * @param {Array<{ label: string, items: object[] }>} opts.menus
 * @param {(id: string) => void} opts.run  runs an app action by id
 */
export function initMenubar({ menus: defs, run }) {
  menus = defs;
  runAction = run;
  $bar = document.getElementById('menubar');
  if (!$bar) return;
  $bar.replaceChildren();
  $bar.setAttribute('role', 'menubar');

  // Playground: one button holding every menu
  const all = el('button', 'menubar__all');
  all.type = 'button';
  all.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2 3.5h10M2 7h10M2 10.5h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg><span>Menu</span>';
  all.setAttribute('aria-haspopup', 'menu');
  all.setAttribute('aria-expanded', 'false');
  all.title = 'Menu: File, Edit, View, Run, Help';
  all.addEventListener('mousedown', (e) => e.preventDefault());
  all.addEventListener('click', () => toggle(-1, all));
  $bar.append(all);

  // Pro: one button per menu
  menus.forEach((m, i) => {
    const b = el('button', 'menubar__item', m.label);
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.setAttribute('aria-haspopup', 'menu');
    b.setAttribute('aria-expanded', 'false');
    b.addEventListener('mousedown', (e) => e.preventDefault()); // keep the editor's focus and selection
    b.addEventListener('click', () => toggle(i, b));
    b.addEventListener('mouseenter', () => { if (openMenu && openMenu.index >= 0 && openMenu.index !== i) show(i, b); });
    b.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(i, b, true); }
    });
    $bar.append(b);
  });

  document.addEventListener('mousedown', (e) => {
    if (openMenu && !e.target.closest('.app-menu, #menubar')) close();
  }, true);
  window.addEventListener('blur', () => close());
  window.addEventListener('resize', () => close());
}

function toggle(i, button) {
  if (openMenu && openMenu.button === button) close();
  else show(i, button);
}

export function close({ refocus = false } = {}) {
  if (!openMenu) return;
  document.querySelectorAll('.app-menu').forEach((m) => m.remove());
  openMenu.button.setAttribute('aria-expanded', 'false');
  openMenu.button.classList.remove('is-open');
  const back = openMenu.returnFocus;
  openMenu = null;
  if (refocus && back?.isConnected) back.focus();
}

/** Open menu i (-1: the all-in-one menu) under `button`. */
function show(i, button, keyboard = false) {
  const returnFocus = openMenu?.returnFocus || document.activeElement;
  close();
  const items = i < 0 ? menus.map((m) => ({ label: m.label, submenu: () => m.items })) : menus[i].items;
  const r = button.getBoundingClientRect();
  const menu = buildMenu(items, r.left, r.bottom + 4, 0);
  openMenu = { index: i, el: menu, button, returnFocus };
  button.setAttribute('aria-expanded', 'true');
  button.classList.add('is-open');
  if (keyboard) focusItem(menu, 0);
  else menu.focus({ preventScroll: true });
}

function buildMenu(items, x, y, depth, anchorLeft = x) {
  const menu = el('div', 'app-menu');
  menu.setAttribute('role', 'menu');
  menu.tabIndex = -1;
  menu.dataset.depth = String(depth);
  for (const item of items) {
    if (item.when && !item.when()) continue;
    if (item.separator) {
      menu.append(el('div', 'app-menu__sep'));
      continue;
    }
    const row = el('button', 'app-menu__item');
    row.type = 'button';
    row.setAttribute('role', item.checked ? 'menuitemradio' : 'menuitem');
    const check = el('span', 'app-menu__check', item.checked?.() ? '✓' : '');
    const label = el('span', 'app-menu__label', item.label);
    const key = el('span', 'app-menu__key', item.submenu ? '›' : item.shortcut ? getBindingLabel(item.shortcut) : (item.keys || ''));
    row.append(check, label, key);
    if (item.checked) row.setAttribute('aria-checked', String(!!item.checked()));
    if (item.disabled?.()) row.disabled = true;
    row.addEventListener('mousedown', (e) => e.preventDefault());
    if (item.submenu) {
      row.setAttribute('aria-haspopup', 'menu');
      const openSub = async (focusFirst) => {
        menu.querySelectorAll(':scope > .app-menu__item.is-open').forEach((x) => x.classList.remove('is-open'));
        removeDeeper(depth);
        row.classList.add('is-open');
        const sub = await item.submenu();
        if (!openMenu || !row.isConnected) return;
        const rr = row.getBoundingClientRect();
        const m = buildMenu(sub, rr.right - 2, rr.top - 5, depth + 1, rr.left);
        if (focusFirst) focusItem(m, 0);
      };
      row.addEventListener('mouseenter', () => openSub(false));
      row.addEventListener('click', () => openSub(true));
      row.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') { e.preventDefault(); openSub(true); } });
    } else {
      row.addEventListener('mouseenter', () => {
        removeDeeper(depth);
        menu.querySelectorAll(':scope > .app-menu__item.is-open').forEach((x) => x.classList.remove('is-open'));
      });
      row.addEventListener('click', () => {
        close({ refocus: true });
        // Run after focus is back where it was (Cut/Copy/Paste, editor commands)
        setTimeout(() => (item.run ? item.run() : runAction(item.action)), 0);
      });
    }
    menu.append(row);
  }
  menu.addEventListener('keydown', (e) => menuKey(e, menu, depth));
  document.body.append(menu);
  // Keep inside the window
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  let left = x;
  if (left + w > window.innerWidth - 6) left = depth ? anchorLeft - w + 2 : window.innerWidth - w - 6; // submenus open to the left
  menu.style.left = `${Math.max(6, left)}px`;
  menu.style.top = `${Math.max(6, Math.min(y, window.innerHeight - h - 6))}px`;
  return menu;
}

function removeDeeper(depth) {
  document.querySelectorAll('.app-menu').forEach((m) => { if (Number(m.dataset.depth) > depth) m.remove(); });
}

function focusItem(menu, index) {
  const items = [...menu.querySelectorAll(':scope > .app-menu__item:not(:disabled)')];
  if (!items.length) return;
  items[(index + items.length) % items.length].focus();
}

function menuKey(e, menu, depth) {
  const items = [...menu.querySelectorAll(':scope > .app-menu__item:not(:disabled)')];
  const at = items.indexOf(document.activeElement);
  switch (e.key) {
    case 'ArrowDown': e.preventDefault(); focusItem(menu, at + 1); break;
    case 'ArrowUp': e.preventDefault(); focusItem(menu, at < 0 ? -1 : at - 1); break;
    case 'Home': e.preventDefault(); focusItem(menu, 0); break;
    case 'End': e.preventDefault(); focusItem(menu, -1); break;
    case 'ArrowLeft':
      e.preventDefault();
      if (depth > 0) {
        removeDeeper(depth - 1);
        document.querySelector(`.app-menu[data-depth="${depth - 1}"] .app-menu__item.is-open`)?.focus();
      } else if (openMenu?.index > 0) {
        const prev = $bar.querySelectorAll('.menubar__item')[openMenu.index - 1];
        show(openMenu.index - 1, prev, true);
      }
      break;
    case 'ArrowRight':
      if (depth === 0 && openMenu?.index >= 0 && !document.activeElement?.getAttribute('aria-haspopup')) {
        e.preventDefault();
        const next = $bar.querySelectorAll('.menubar__item')[openMenu.index + 1];
        if (next) show(openMenu.index + 1, next, true);
      }
      break;
    case 'Escape':
      e.preventDefault();
      e.stopPropagation();
      if (depth > 0) {
        removeDeeper(depth - 1);
        document.querySelector(`.app-menu[data-depth="${depth - 1}"] .app-menu__item.is-open`)?.focus();
      } else close({ refocus: true });
      break;
    case 'Tab': close({ refocus: true }); break;
    default:
      // First letter jumps to an item
      if (e.key.length === 1 && !e.ctrlKey && !e.altKey) {
        const k = e.key.toLowerCase();
        const start = at + 1;
        const hit = [...items.slice(start), ...items.slice(0, start)].find((b) => b.querySelector('.app-menu__label')?.textContent.trim().toLowerCase().startsWith(k));
        hit?.focus();
      }
  }
}
