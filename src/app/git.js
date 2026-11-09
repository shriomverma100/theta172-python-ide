/**
 * Source control (desktop): the Git view in the sidebar, the diff view, the
 * branch picker and the editor's change markers.
 *
 * Git itself runs in the main process (electron/git.cjs); this module only
 * shows its state and asks for actions.
 */
import { MergeView } from '@codemirror/merge';
import { $ } from '../core/dom.js';
import { showToast } from '../toast.js';
import { getView, viewerExtensions } from '../editor.js';
import { setBaselineEffect } from '../git-gutter.js';
import { getActiveTab, onTabShow, onTabsChanged, findTabByPath, visibleTabs, tabText } from './tabs.js';
import { getWorkspaceRoot, onWorkspaceChange, onFilesChanged, openPath, isInWorkspace } from './workspace.js';
import { openQuickPick, openInputBox } from './quick-pick.js';
import { showSidebarView } from './search.js';

const api = () => window.electronAPI;
const LETTER_NAMES = { M: 'Modified', A: 'Added', D: 'Deleted', R: 'Renamed', C: 'Copied', T: 'Type changed', U: 'Conflict' };

let git = { available: null, version: null, repo: null }; // last git-status answer
let busy = null; // label of the action in progress
let refreshTimer = null;
let refreshSeq = 0;
let historyOpen = false;
let diff = null; // { view: MergeView, file, staged }

const isWin = () => /^[A-Za-z]:/.test(git.repo?.top || getWorkspaceRoot() || '');
const sep = () => (isWin() ? '\\' : '/');
const same = (a, b) => (isWin() ? a.toLowerCase() === b.toLowerCase() : a === b);

/** Absolute path of a repository-relative path. */
function absPath(rel) {
  return `${git.repo.top}${sep()}${rel.split('/').join(sep())}`;
}

/** Repository-relative path ("a/b.py") of an absolute path, or null when outside. */
function relPath(abs) {
  const top = git.repo?.top;
  if (!top || !abs) return null;
  const prefix = top + sep();
  if (!same(abs.slice(0, prefix.length), prefix)) return null;
  return abs.slice(prefix.length).split(sep()).join('/');
}

const errorText = (err) => String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

// ── Refreshing ──────────────────────────────────────────────────

export function refreshGitSoon(delay = 300) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshGitView, delay);
}

export async function refreshGitView() {
  if (!api()?.gitStatus) return;
  const seq = ++refreshSeq;
  let next;
  try { next = await api().gitStatus(); } catch (_) { return; }
  if (seq !== refreshSeq) return;
  git = { available: next.available, version: next.version || null, repo: next.repo || null };
  render();
  updateBaselines();
  if (historyOpen) renderHistory();
}

// ── Change markers for the visible file ──────────────────────────

/** Change markers for every file shown in an editor group. */
function updateBaselines() {
  for (const { tab, view } of visibleTabs()) updateBaseline(tab, view);
}

async function updateBaseline(tab = getActiveTab(), view = getView()) {
  if (!view || !tab) return;
  const rel = tab?.filePath && tab.kind !== 'notebook' ? relPath(tab.filePath) : null;
  let text = null;
  if (rel) {
    const entry = git.repo.files.find((f) => f.path === rel);
    if (entry?.kind === 'untracked') text = '';
    else {
      try {
        // The index holds what was last staged or committed; ignored files show no marks
        text = await api().gitShow(rel, '');
        if (text === '' && !entry) text = null;
      } catch (_) { text = null; }
    }
  }
  // Still showing this file in that view?
  if (!visibleTabs().some((v) => v.tab === tab && v.view === view)) return;
  view.dispatch({ effects: setBaselineEffect.of(text) });
}

// ── The Git view ─────────────────────────────────────────────────

function letterFor(f, staged) {
  if (f.kind === 'untracked') return 'U';
  if (f.kind === 'conflict') return '!';
  return (staged ? f.staged : f.unstaged) || 'M';
}

function fileRow(f, staged) {
  const row = document.createElement('div');
  row.className = 'git-file';
  row.setAttribute('role', 'listitem');
  const letter = letterFor(f, staged);
  const parts = f.path.split('/');
  const name = parts.pop();
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'git-file__open';
  open.title = `${f.path}\n${f.kind === 'untracked' ? 'New file (not tracked yet)' : LETTER_NAMES[letter] || ''}${f.orig ? ` from ${f.orig}` : ''}. Click to see the changes.`;
  const n = document.createElement('span');
  n.className = 'git-file__name';
  n.textContent = name;
  const d = document.createElement('span');
  d.className = 'git-file__dir';
  d.textContent = parts.join('/');
  open.append(n, d);
  open.addEventListener('click', () => openDiff(f, staged));
  open.addEventListener('dblclick', () => openWorkingFile(f.path));
  const actions = document.createElement('span');
  actions.className = 'git-file__actions';
  const act = (label, title, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'git-act';
    b.textContent = label;
    b.title = title;
    b.setAttribute('aria-label', `${title}: ${f.path}`);
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    actions.appendChild(b);
  };
  if (staged) act('−', 'Unstage', () => action('Unstaging', () => api().gitUnstage([f.path])));
  else {
    act('↶', f.kind === 'untracked' ? 'Delete (to the Recycle Bin)' : 'Discard changes', () => discard([f]));
    act('+', 'Stage', () => action('Staging', () => api().gitStage([f.path])));
  }
  const badge = document.createElement('span');
  badge.className = `git-letter git-letter--${letter === '!' ? 'conflict' : letter}`;
  badge.textContent = letter;
  badge.setAttribute('aria-label', f.kind === 'untracked' ? 'Untracked' : LETTER_NAMES[letter] || letter);
  row.append(open, actions, badge);
  return row;
}

function section(title, files, staged) {
  const wrap = document.createElement('section');
  wrap.className = 'git-section';
  const head = document.createElement('div');
  head.className = 'git-section__head';
  const h = document.createElement('h3');
  h.textContent = title;
  const count = document.createElement('span');
  count.className = 'git-count';
  count.textContent = String(files.length);
  h.appendChild(count);
  head.appendChild(h);
  const tools = document.createElement('span');
  tools.className = 'git-section__tools';
  const tool = (label, tip, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'git-act';
    b.textContent = label;
    b.title = tip;
    b.setAttribute('aria-label', tip);
    b.addEventListener('click', fn);
    tools.appendChild(b);
  };
  const paths = files.map((f) => f.path);
  if (staged) tool('−', 'Unstage all', () => action('Unstaging', () => api().gitUnstage(paths)));
  else {
    tool('↶', 'Discard all changes', () => discard(files));
    tool('+', 'Stage all', () => action('Staging', () => api().gitStage(paths)));
  }
  head.appendChild(tools);
  const list = document.createElement('div');
  list.className = 'git-files';
  list.setAttribute('role', 'list');
  for (const f of files) list.appendChild(fileRow(f, staged));
  wrap.append(head, list);
  return wrap;
}

function render() {
  const $view = $('git-view');
  if (!$view) return;
  const $state = $('git-state');
  const $repo = $('git-repo');
  const showState = (html, button) => {
    $repo.classList.add('hidden');
    $state.classList.remove('hidden');
    $state.innerHTML = html;
    if (button) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'git-primary';
      b.textContent = button.label;
      b.addEventListener('click', button.run);
      $state.appendChild(b);
    }
  };
  setBadge(0);
  renderStatusBranch();
  if (git.available === false) {
    return showState('<p class="git-state__title">Git isn\'t installed</p><p>Install Git to save versions of your work, see what changed and share it on GitHub.</p>', {
      label: 'Download Git', run: () => window.open('https://git-scm.com/downloads'),
    });
  }
  if (!getWorkspaceRoot()) return showState('<p class="git-state__title">No folder open</p><p>Open a project folder to track its changes with Git.</p>');
  if (!git.repo) {
    return showState('<p class="git-state__title">Not a Git repository</p><p>Start tracking this folder: every commit saves a version you can go back to.</p>', {
      label: 'Initialize repository',
      run: () => action('Initializing', () => api().gitInit(), 'Repository created'),
    });
  }

  $state.classList.add('hidden');
  $repo.classList.remove('hidden');
  const r = git.repo;
  const staged = r.files.filter((f) => f.staged);
  const changes = r.files.filter((f) => f.unstaged || f.kind !== 'tracked');
  setBadge(r.files.length);

  $('git-branch-name').textContent = r.branch || '(no branch)';
  const $sync = $('git-sync');
  const $syncText = $('git-sync-text');
  if (!r.upstream) {
    $syncText.textContent = 'Publish';
    $sync.title = 'Push this branch to the remote for the first time';
  } else {
    $syncText.textContent = `↓${r.behind} ↑${r.ahead}`;
    $sync.title = `Pull ${r.behind} and push ${r.ahead} commit${r.ahead === 1 ? '' : 's'} (${r.upstream})`;
  }
  $sync.disabled = !!busy;

  const $commit = $('git-commit');
  $commit.disabled = !!busy || !r.files.length;
  $commit.textContent = busy ? `${busy}…` : staged.length
    ? `Commit ${staged.length} file${staged.length === 1 ? '' : 's'}`
    : r.files.length ? 'Stage all and commit' : 'Nothing to commit';

  const $lists = $('git-lists');
  $lists.textContent = '';
  if (staged.length) $lists.appendChild(section('Staged', staged, true));
  if (changes.length) $lists.appendChild(section('Changes', changes, false));
  if (!r.files.length) {
    const p = document.createElement('p');
    p.className = 'git-clean';
    p.textContent = 'Everything is committed. Edit a file and its changes appear here.';
    $lists.appendChild(p);
  }
}

function setBadge(n) {
  for (const id of ['view-git', 'rail-git']) {
    const el = $(id);
    if (!el) continue;
    let b = el.querySelector('.git-badge');
    if (!b) { b = document.createElement('span'); b.className = 'git-badge'; el.appendChild(b); }
    b.textContent = n ? String(n > 99 ? '99+' : n) : '';
  }
}

function renderStatusBranch() {
  const $b = $('status-branch');
  if (!$b) return;
  $b.classList.toggle('hidden', !git.repo);
  if (git.repo) $b.querySelector('span').textContent = git.repo.branch || 'detached';
}

async function renderHistory() {
  const $h = $('git-history-list');
  if (!$h || !git.repo) return;
  let commits = [];
  try { commits = await api().gitLog(40); } catch (_) { /* none */ }
  $h.textContent = '';
  if (!commits.length) {
    $h.innerHTML = '<li class="git-clean">No commits yet.</li>';
    return;
  }
  for (const c of commits) {
    const li = document.createElement('li');
    li.className = 'git-commit-row';
    li.title = `${c.hash}\n${c.author}, ${c.date}`;
    const s = document.createElement('span');
    s.className = 'git-commit-row__subject';
    s.textContent = c.subject;
    const m = document.createElement('span');
    m.className = 'git-commit-row__meta';
    m.textContent = `${c.short} · ${c.author} · ${c.date}`;
    li.append(s, m);
    $h.appendChild(li);
  }
}

// ── Actions ──────────────────────────────────────────────────────

async function action(label, run, success) {
  if (busy) return false;
  busy = label;
  render();
  let res;
  try {
    res = await run();
  } catch (err) {
    res = { ok: false, error: errorText(err) };
  }
  busy = null;
  if (res && res.ok === false) showToast(res.error, 'error', 4200);
  else if (success) showToast(success, 'success', 2000);
  await refreshGitView();
  return !res || res.ok !== false;
}

async function discard(files) {
  const untracked = files.filter((f) => f.kind === 'untracked').length;
  const text = files.length === 1
    ? (untracked ? `Delete "${files[0].path}"? It moves to the Recycle Bin.` : `Throw away your changes to "${files[0].path}"? This can't be undone.`)
    : `Throw away changes to ${files.length} files?${untracked ? ` ${untracked} new file${untracked === 1 ? '' : 's'} move to the Recycle Bin.` : ''} This can't be undone.`;
  if (!window.confirm(text)) return;
  // Open tabs with unsaved edits keep them; the editor reloads clean tabs when the files change
  await action('Discarding', () => api().gitDiscard(files.map((f) => f.path)));
}

/** Ask for name and email once (git refuses to commit without them). */
async function askIdentity() {
  const current = await api().gitIdentity();
  const name = await openInputBox({ title: 'Git needs your name for commits', value: current.name || '', validate: (v) => (v.trim() ? null : 'Type your name') });
  if (name === null) return false;
  const email = await openInputBox({ title: 'And your email (it is saved in each commit)', value: current.email || '', validate: (v) => (/^[^\s@]+@[^\s@]+$/.test(v.trim()) ? null : 'Type a valid email') });
  if (email === null) return false;
  const res = await api().gitSetIdentity(name.trim(), email.trim());
  if (!res.ok) showToast(res.error, 'error', 3000);
  return res.ok;
}

export async function commit() {
  const r = git.repo;
  if (!r || busy) return;
  const $msg = $('git-message');
  const message = $msg.value.trim();
  if (!message) {
    showToast('Write a short message about what you changed', 'info', 2400);
    $msg.focus();
    return;
  }
  if (!r.files.length) return;
  const stageAll = !r.files.some((f) => f.staged);
  const run = async () => {
    if (stageAll) {
      const res = await api().gitStage(r.files.map((f) => f.path));
      if (!res.ok) return res;
    }
    return api().gitCommit(message);
  };
  busy = 'Committing';
  render();
  let res = await run().catch((err) => ({ ok: false, error: errorText(err) }));
  if (!res.ok && res.error === 'IDENTITY') {
    busy = null;
    if (await askIdentity()) {
      busy = 'Committing';
      res = await api().gitCommit(message).catch((err) => ({ ok: false, error: errorText(err) }));
    } else {
      res = { ok: false, error: 'Commit cancelled.' };
    }
  }
  busy = null;
  if (res.ok) {
    $msg.value = '';
    showToast('Committed', 'success', 1800);
  } else {
    showToast(res.error, 'error', 4200);
  }
  await refreshGitView();
}

export async function sync() {
  const r = git.repo;
  if (!r || busy) return;
  if (!r.upstream) return action('Publishing', () => api().gitPush(), 'Branch published');
  if (r.behind) {
    const ok = await action('Pulling', () => api().gitPull(), r.ahead ? null : 'Up to date');
    if (!ok) return;
  }
  if (git.repo?.ahead) await action('Pushing', () => api().gitPush(), 'Pushed');
  else if (!r.behind) await action('Checking', () => api().gitFetch(), null);
}

export async function pickBranch() {
  if (!git.repo) {
    showSidebarView('git');
    return;
  }
  const b = await api().gitBranches();
  const locals = new Set(b.local.map((x) => x.name));
  const items = [
    { label: '+ Create a new branch…', run: createBranch },
    { separator: 'Branches' },
    ...b.local.map((x) => ({
      label: x.name,
      description: x.upstream ? `tracks ${x.upstream}` : '',
      checked: x.name === b.current,
      run: () => x.name !== b.current && action('Switching', () => api().gitCheckout({ name: x.name }), `On ${x.name}`),
    })),
  ];
  const remotes = b.remote.filter((x) => !locals.has(x.name.split('/').slice(1).join('/')));
  if (remotes.length) {
    items.push({ separator: 'Remote branches' });
    for (const x of remotes) items.push({ label: x.name, description: 'check out', run: () => action('Switching', () => api().gitCheckout({ track: x.name }), `On ${x.name.split('/').slice(1).join('/')}`) });
  }
  openQuickPick({ title: 'Switch branch', items });
}

async function createBranch() {
  const name = await openInputBox({
    title: 'Name for the new branch',
    validate: (v) => (!v.trim() ? 'Type a name' : /\s/.test(v.trim()) ? 'Use - instead of spaces' : null),
  });
  if (name) await action('Creating branch', () => api().gitCheckout({ name: name.trim(), create: true }), `On ${name.trim()}`);
}

// ── Diff view ────────────────────────────────────────────────────

async function openWorkingFile(rel) {
  const abs = absPath(rel);
  if (isInWorkspace(abs)) await openPath(abs);
  else showToast('That file is outside the open folder', 'info', 2200);
}

/** Text for one side of a diff. */
async function sideText(f, which) {
  if (which === 'HEAD') return f.staged === 'A' || f.kind === 'untracked' ? '' : api().gitShow(f.orig || f.path, 'HEAD');
  if (which === 'index') return f.kind === 'untracked' ? '' : api().gitShow(f.path, '');
  // working tree: the open tab's text (with unsaved edits) or the file on disk
  const tab = findTabByPath(absPath(f.path));
  if (tab?.kind === 'notebook') return tabText(tab);
  if (tab) return tab.id === getActiveTab()?.id ? getView().state.doc.toString() : tab.code;
  return api().gitReadWorking(f.path);
}

export async function openDiff(f, staged) {
  closeDiff();
  let a;
  let b;
  try {
    [a, b] = staged
      ? await Promise.all([sideText(f, 'HEAD'), sideText(f, 'index')])
      : await Promise.all([sideText(f, 'index'), sideText(f, 'working')]);
  } catch (err) {
    showToast(errorText(err), 'error', 3000);
    return;
  }
  if (/\0/.test(a) || /\0/.test(b)) {
    showToast('This is a binary file; there is no text to compare', 'info', 2600);
    return;
  }
  const $diff = $('diff-view');
  const $body = $('diff-body');
  $('diff-title').textContent = f.path;
  $('diff-sides').textContent = staged ? 'Last commit  →  Staged' : f.kind === 'untracked' ? 'New file' : 'Staged / last commit  →  Your changes';
  const $toggle = $('diff-stage');
  $toggle.textContent = staged ? 'Unstage' : 'Stage';
  $toggle.onclick = async () => {
    const ok = await action(staged ? 'Unstaging' : 'Staging', () => (staged ? api().gitUnstage([f.path]) : api().gitStage([f.path])));
    if (ok) closeDiff();
  };
  $('diff-open').onclick = () => { closeDiff(); openWorkingFile(f.path); };
  $body.textContent = '';
  const view = new MergeView({
    a: { doc: a, extensions: viewerExtensions() },
    b: { doc: b, extensions: viewerExtensions() },
    parent: $body,
    highlightChanges: true,
    gutter: true,
    collapseUnchanged: { margin: 3, minSize: 6 },
  });
  diff = { view, file: f.path, staged };
  $diff.classList.remove('hidden');
  $('diff-close').focus();
}

export function closeDiff() {
  if (!diff) return;
  diff.view.destroy();
  diff = null;
  $('diff-view')?.classList.add('hidden');
}

export const isDiffOpen = () => !!diff;

// ── Start-up ─────────────────────────────────────────────────────

export function initGit() {
  if (!api()?.gitStatus) {
    $('view-git')?.classList.add('hidden');
    $('rail-git')?.classList.add('hidden');
    return;
  }
  $('view-git')?.addEventListener('click', () => { showSidebarView('git'); refreshGitView(); });
  $('git-commit')?.addEventListener('click', commit);
  $('git-message')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(); }
  });
  $('git-branch')?.addEventListener('click', pickBranch);
  $('status-branch')?.addEventListener('click', pickBranch);
  $('git-sync')?.addEventListener('click', sync);
  $('git-refresh')?.addEventListener('click', () => refreshGitView());
  $('git-history-toggle')?.addEventListener('click', () => {
    historyOpen = !historyOpen;
    $('git-history-toggle').setAttribute('aria-expanded', String(historyOpen));
    $('git-history-list').classList.toggle('hidden', !historyOpen);
    if (historyOpen) renderHistory();
  });
  $('diff-close')?.addEventListener('click', closeDiff);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && diff) { e.preventDefault(); closeDiff(); } });

  onWorkspaceChange(() => refreshGitSoon(50));
  onFilesChanged(() => refreshGitSoon(400));
  onTabShow(({ phase, tab }) => { if (phase === 'after') updateBaseline(tab, getView()); });
  onTabsChanged(() => refreshGitSoon(600)); // saves change the working tree
  window.addEventListener('focus', () => refreshGitSoon(100));
  refreshGitSoon(800);
}
