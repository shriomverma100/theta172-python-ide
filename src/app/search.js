/**
 * Search and replace across the open project folder.
 * The search runs in the main process (electron/workspace.cjs); results
 * open the file at the matching line. "Replace all" skips files that have
 * unsaved changes in the editor, then reloads the open tabs it changed.
 */
import { showToast } from '../toast.js';
import { $ } from '../core/dom.js';
import { getUnsavedPaths, reloadTab, findTabByPath } from './tabs.js';
import { getWorkspaceRoot, openPath, refreshTree, refreshGit } from './workspace.js';

const opts = { matchCase: false, wholeWord: false, regex: false };
let timer = null;
let seq = 0;

const api = () => window.electronAPI;

function summary(text) {
  const $s = $('search-summary');
  if ($s) $s.textContent = text;
}

/** The line text with every match wrapped in <mark>, built with text nodes only. */
function highlighted(text, query) {
  const frag = document.createDocumentFragment();
  let re;
  try {
    let src = opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (opts.wholeWord) src = `\\b(?:${src})\\b`;
    re = new RegExp(src, opts.matchCase ? 'g' : 'gi');
  } catch (_) {
    frag.append(text);
    return frag;
  }
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (!m[0]) continue;
    frag.append(text.slice(last, m.index));
    const mark = document.createElement('mark');
    mark.textContent = m[0];
    frag.append(mark);
    last = m.index + m[0].length;
  }
  frag.append(text.slice(last));
  return frag;
}

function renderResults(results, query) {
  const $list = $('search-results');
  if (!$list) return;
  $list.replaceChildren();
  for (const file of results) {
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'sr-file';
    head.title = file.path;
    const name = document.createElement('span');
    name.textContent = file.rel;
    const count = document.createElement('span');
    count.className = 'sr-file__count';
    count.textContent = String(file.matches.length);
    head.append(name, count);
    head.addEventListener('click', () => openPath(file.path, file.matches[0]?.line));
    $list.appendChild(head);

    for (const m of file.matches.slice(0, 50)) {
      const line = document.createElement('button');
      line.type = 'button';
      line.className = 'sr-line';
      const n = document.createElement('span');
      n.className = 'sr-line__n';
      n.textContent = String(m.line);
      const txt = document.createElement('span');
      txt.className = 'sr-line__text';
      txt.appendChild(highlighted(m.text.trimStart(), query));
      line.append(n, txt);
      line.addEventListener('click', () => openPath(file.path, m.line));
      $list.appendChild(line);
    }
  }
}

export async function runSearch() {
  const query = $('search-input')?.value || '';
  if (!getWorkspaceRoot()) { summary('Open a folder to search its files.'); renderResults([], ''); return; }
  if (!query) { summary(''); renderResults([], ''); return; }
  const mine = ++seq;
  summary('Searching…');
  const res = await api()?.wsSearch?.(query, opts);
  if (mine !== seq) return; // a newer search started
  if (!res?.ok) { summary(res?.error || 'Search failed.'); renderResults([], ''); return; }
  const { results, total, truncated } = res.value;
  summary(total
    ? `${total}${truncated ? '+' : ''} result${total === 1 ? '' : 's'} in ${results.length} file${results.length === 1 ? '' : 's'}${truncated ? ' (showing the first 2000)' : ''}`
    : 'No results');
  renderResults(results, query);
}

async function replaceAll() {
  const query = $('search-input')?.value || '';
  const replacement = $('replace-input')?.value ?? '';
  if (!query || !getWorkspaceRoot()) return;
  const skip = getUnsavedPaths();
  const note = skip.length ? `\n\n${skip.length} file(s) with unsaved changes will be skipped. Save them first to include them.` : '';
  if (!window.confirm(`Replace every match of "${query}" with "${replacement}" in this project?${note}\n\nThis changes the files on disk.`)) return;

  const res = await api()?.wsReplace?.(query, replacement, opts, skip);
  if (!res?.ok) { showToast(res?.error || 'Replace failed', 'error', 3000); return; }
  const { changed, count } = res.value;
  // Show the new text in open tabs (tabs with unsaved edits were skipped)
  for (const p of changed) {
    if (!findTabByPath(p)) continue;
    const read = await api().wsRead(p);
    if (read?.ok) reloadTab(p, read.value);
  }
  showToast(`Replaced ${count} match${count === 1 ? '' : 'es'} in ${changed.length} file${changed.length === 1 ? '' : 's'}`, 'success', 2500);
  refreshTree();
  refreshGit();
  runSearch();
}

/** Show the Search view in the sidebar and focus its box. */
export function focusSearch() {
  showSidebarView('search');
  const $in = $('search-input');
  $in?.focus();
  $in?.select();
}

/** Show one sidebar view: 'files', 'search' or 'debug'. */
export function showSidebarView(view) {
  for (const v of ['files', 'search', 'debug']) {
    const on = v === view;
    $(`${v}-view`)?.classList.toggle('hidden', !on);
    $(`view-${v}`)?.classList.toggle('active', on);
    $(`view-${v}`)?.setAttribute('aria-selected', String(on));
    $(`rail-${v}`)?.classList.toggle('is-active', on);
  }
  // File actions (new file / folder) only belong to the Files view
  $('sidebar')?.classList.toggle('search-mode', view !== 'files');
}

export function currentSidebarView() {
  return ['search', 'debug'].find((v) => !$(`${v}-view`)?.classList.contains('hidden')) || 'files';
}

export function initSearch() {
  $('view-files')?.addEventListener('click', () => showSidebarView('files'));
  $('view-search')?.addEventListener('click', focusSearch);
  $('view-debug')?.addEventListener('click', () => showSidebarView('debug'));
  $('search-input')?.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(runSearch, 280); });
  $('search-input')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(timer); runSearch(); } });
  $('replace-all')?.addEventListener('click', replaceAll);
  for (const [id, key] of [['search-case', 'matchCase'], ['search-word', 'wholeWord'], ['search-regex', 'regex']]) {
    $(id)?.addEventListener('click', (e) => {
      opts[key] = !opts[key];
      e.currentTarget.setAttribute('aria-pressed', String(opts[key]));
      runSearch();
    });
  }
}
