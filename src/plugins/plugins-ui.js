/**
 * The Plugins window: what is installed, what each plugin may do, turn on /
 * off (after agreeing to its permissions), reload, see its log, remove;
 * install from a folder or load one you are writing.
 */
import { startPlugin, stopPlugin, getRuntime, onPluginsChanged } from './plugin-host.js';
import { showToast } from '../toast.js';

const api = () => window.electronAPI;
let words = {}; // permission -> plain words
let openLogs = new Set();
let unsub = null;

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const btn = (cls, text, onClick, title) => {
  const b = el('button', cls, text);
  b.type = 'button';
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
};
const cleanErr = (err) => String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

/** Ask before turning a plugin on: what it will be able to do. */
function confirmPermissions(manifest) {
  return new Promise((resolve) => {
    const overlay = el('div', 'viva-modal');
    const box = el('div', 'viva-modal__box');
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    box.append(el('h2', 'viva-modal__title', `Turn on ${manifest.name}?`));
    const perms = manifest.permissions;
    if (perms.length) {
      box.append(el('p', 'viva-modal__lead', 'It will be able to:'));
      const ul = el('ul', 'pl-perms-list');
      for (const p of perms) ul.append(el('li', '', words[p] || p));
      box.append(ul);
    } else {
      box.append(el('p', 'viva-modal__lead', 'It asks for no special permissions: it can add commands, show messages and status text.'));
    }
    box.append(el('p', 'viva-modal__lead pl-note', 'Plugins run separated from the app and cannot reach the internet or your files outside the open project. Only turn on plugins you trust.'));
    const row = el('div', 'viva-modal__row');
    const done = (v) => { overlay.remove(); resolve(v); };
    row.append(btn('viva-modal__btn', 'Cancel', () => done(false)), btn('viva-modal__btn viva-modal__btn--primary', 'Turn on', () => done(true)));
    box.append(row);
    overlay.append(box);
    overlay.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') done(false); });
    document.body.append(overlay);
    row.lastChild.focus();
  });
}

async function setOn(p, on) {
  try {
    if (on) {
      if (!(await confirmPermissions(p.manifest))) return;
      await api().pluginsSetEnabled(p.id, true, p.manifest.permissions);
      await startPlugin(p.id);
      showToast(`${p.manifest.name} is on`, 'success', 1800);
    } else {
      stopPlugin(p.id);
      await api().pluginsSetEnabled(p.id, false, []);
    }
  } catch (err) {
    showToast(cleanErr(err), 'error', 3500);
  }
  render();
}

let box = null;

export async function openPluginsManager() {
  document.getElementById('plugins-modal')?.remove();
  words = (await api()?.pluginsInfo?.())?.permissions || {};
  const overlay = el('div', 'viva-modal');
  overlay.id = 'plugins-modal';
  box = el('div', 'viva-modal__box pl-box');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', 'Plugins');
  overlay.append(box);
  overlay.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); });
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  document.body.append(overlay);
  unsub?.();
  unsub = onPluginsChanged(() => { if (box?.isConnected) render(); });
  render();
}

function close() {
  document.getElementById('plugins-modal')?.remove();
  unsub?.();
  unsub = null;
}

async function render() {
  if (!box?.isConnected) return;
  if (!api()?.pluginsList) {
    box.replaceChildren(el('p', 'viva-modal__lead', 'Plugins need the desktop app.'));
    return;
  }
  const list = await api().pluginsList();
  box.replaceChildren();
  const head = el('div', 'viva-modal__head');
  head.append(el('h2', 'viva-modal__title', 'Plugins'), btn('viva-modal__close', '×', close));
  const bar = el('div', 'pl-bar');
  bar.append(
    btn('viva-modal__btn viva-modal__btn--primary', 'Install from folder…', async () => {
      try {
        const res = await api().pluginsInstall();
        if (res && !res.ok) showToast(res.errors.join(' '), 'error', 4500);
        else if (res) showToast(`Installed ${res.manifest.name}. Turn it on below.`, 'success', 2400);
      } catch (err) { showToast(cleanErr(err), 'error', 3500); }
      render();
    }, 'Copy a plugin folder (with theta-plugin.json) into the app'),
    btn('viva-modal__btn', 'Load a plugin I am writing…', async () => {
      try {
        const res = await api().pluginsLink();
        if (res && !res.ok) showToast(res.errors.join(' '), 'error', 4500);
        else if (res) showToast(`Loaded ${res.manifest.name} from its folder: edit it, then press Reload`, 'success', 3000);
      } catch (err) { showToast(cleanErr(err), 'error', 3500); }
      render();
    }, 'Use a plugin straight from its folder, to edit and reload it'),
  );
  box.append(head, bar);
  if (!list.length) {
    box.append(el('p', 'viva-modal__lead', 'No plugins yet. A plugin is a folder with a theta-plugin.json and a .js file. Examples come with the app source under examples/plugins.'));
    return;
  }
  for (const p of list) {
    const card = el('div', `pl-card${p.enabled ? ' is-on' : ''}${p.ok ? '' : ' is-broken'}`);
    const top = el('div', 'pl-card__top');
    const name = el('div', 'pl-card__name');
    name.append(el('b', '', p.manifest?.name || p.id));
    if (p.manifest) name.append(el('span', 'pl-card__ver', `v${p.manifest.version}${p.manifest.author ? ` · ${p.manifest.author}` : ''}`));
    if (p.dev) name.append(el('span', 'pl-card__dev', 'developer'));
    top.append(name);
    const rt = getRuntime(p.id);
    const status = !p.ok ? 'cannot load' : !p.enabled ? 'off' : rt?.error ? 'error' : rt?.state === 'running' ? 'on' : 'starting';
    top.append(el('span', `pl-card__state is-${status.replace(' ', '-')}`, status));
    card.append(top);
    if (p.manifest?.description) card.append(el('p', 'pl-card__desc', p.manifest.description));
    if (!p.ok) card.append(el('p', 'pl-card__err', p.errors.join(' ')));
    if (p.manifest?.permissions?.length) {
      const chips = el('div', 'pl-chips');
      for (const perm of p.manifest.permissions) {
        const c = el('span', 'pl-chip', perm);
        c.title = words[perm] || perm;
        chips.append(c);
      }
      card.append(chips);
    }
    if (rt?.error) card.append(el('p', 'pl-card__err', rt.error.split('\n')[0]));
    const actions = el('div', 'pl-card__actions');
    if (p.ok) actions.append(btn(`viva-modal__btn${p.enabled ? '' : ' viva-modal__btn--primary'}`, p.enabled ? 'Turn off' : 'Turn on', () => setOn(p, !p.enabled)));
    if (p.enabled) actions.append(btn('viva-modal__btn', 'Reload', async () => { try { await startPlugin(p.id); showToast(`Reloaded ${p.manifest.name}`, 'info', 1500); } catch (err) { showToast(cleanErr(err), 'error', 3500); } render(); }));
    if (rt) actions.append(btn('viva-modal__btn', openLogs.has(p.id) ? 'Hide log' : `Log (${rt.log.length})`, () => { if (openLogs.has(p.id)) openLogs.delete(p.id); else openLogs.add(p.id); render(); }));
    actions.append(btn('viva-modal__btn', 'Open folder', () => api().pluginsOpenFolder(p.id)));
    actions.append(btn('viva-modal__btn', 'Remove', async () => {
      if (!window.confirm(`Remove ${p.manifest?.name || p.id}?${p.dev ? ' (its folder is kept)' : ''}`)) return;
      stopPlugin(p.id);
      await api().pluginsRemove(p.id);
      render();
    }));
    card.append(actions);
    if (rt && openLogs.has(p.id)) {
      const pre = el('pre', 'pl-log', rt.log.map((l) => `${new Date(l.at).toLocaleTimeString()}  ${l.kind === 'error' ? '✗ ' : ''}${l.text}`).join('\n') || 'Nothing logged yet.');
      card.append(pre);
    }
    box.append(card);
  }
}
