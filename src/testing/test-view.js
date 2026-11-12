/**
 * The Tests view (sidebar) and test marks in the editor.
 *
 * Finds the project's pytest tests, runs all / failed / one file / one class
 * / one test, shows pass and fail with the failure message, and jumps to the
 * failing line. With "Run on save", saving a .py file runs the tests again.
 */
import {
  createTests, applyEvent, beginCollect, endCollect, beginRun, endRun, tree, summary, failedIds, fileMarks, groupStatus, isTestFile,
} from './test-model.js';
import { setTestMarks, setTestRunHandler } from './test-gutter.js';
import { logoSvg } from '../core/tech-logos.js';
import { visibleTabs, onTabShow } from '../app/tabs.js';
import { openPath, getWorkspaceRoot, onWorkspaceChange } from '../app/workspace.js';
import { onFileSaved } from '../app/files.js';
import { showSidebarView } from '../app/search.js';
import { getPrefs, setPrefs } from '../app/session.js';
import { showToast } from '../toast.js';

const api = () => window.electronAPI;
const m = createTests();
let pytest = null;      // { ok, version } | { ok: false, reason }
let currentRun = null;  // runner id
let currentKind = null; // 'collect' | 'run'
let pendingRun = null;  // run waiting for a discovery to finish
let log = '';
const expanded = new Set();
let renderTimer = null;

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const btn = (cls, label, onClick, title, html) => {
  const b = el('button', cls);
  b.type = 'button';
  if (html) b.innerHTML = html; else b.textContent = label;
  if (title) { b.title = title; b.setAttribute('aria-label', title); }
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return b;
};

const PLAY = '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 1.2v7.6L8.6 5z" fill="currentColor"/></svg>';
const ICON = { passed: '✓', xpass: '✓', failed: '✗', error: '✗', skipped: '↷', xfail: '↷', running: '', queued: '…', unknown: '○' };

const runOnSave = () => !!getPrefs().testsOnSave;

// ── Running ────────────────────────────────────────────────────────

export async function refreshTests() {
  if (!api()?.testDiscover) return;
  if (!getWorkspaceRoot()) { pytest = null; render(); return; }
  pytest = await api().testCheck();
  if (!pytest.ok) { render(); return; }
  try {
    beginCollect(m);
    currentKind = 'collect';
    currentRun = await api().testDiscover();
  } catch (err) {
    m.collecting = false;
    showToast(cleanErr(err), 'error', 3000);
  }
  render();
}

/** Run tests: [] = all. */
export async function runTests(ids = []) {
  if (!api()?.testRun) return;
  if (!getWorkspaceRoot()) { showToast('Open a project folder to run its tests', 'info', 2200); return; }
  if (!pytest?.ok) { pytest = await api().testCheck(); }
  if (!pytest.ok) { showTests(); render(); return; }
  if (m.collecting) { pendingRun = ids; return; }
  log = '';
  beginRun(m, ids);
  try {
    currentKind = 'run';
    currentRun = await api().testRun(ids);
  } catch (err) {
    endRun(m);
    showToast(cleanErr(err), 'error', 3000);
  }
  render();
}

export const runAllTests = () => runTests([]);
export function runFailedTests() {
  const ids = failedIds(m);
  if (!ids.length) { showToast('No failed tests to run again', 'info', 1800); return; }
  runTests(ids);
}
export function stopTests() { api()?.testStop?.(); }

/** Run the tests of a file (the file open in the editor, for example). */
export function runTestsInFile(filePath) {
  const root = getWorkspaceRoot();
  if (!root || !filePath) return;
  const rel = filePath.slice(root.length + 1).replace(/\\/g, '/');
  runTests([rel]);
}

const cleanErr = (err) => String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

function onEvent(ev) {
  if (ev.runId !== currentRun) return;
  if (ev.type === 'log') { if (currentKind === 'run') log = (log + ev.text).slice(-60_000); return; }
  if (ev.type === 'exit') {
    if (currentKind === 'collect') {
      endCollect(m);
      if (pendingRun) { const ids = pendingRun; pendingRun = null; runTests(ids); }
    } else {
      endRun(m);
      const s = summary(m);
      if (s.failed) showToast(`${s.failed} test${s.failed === 1 ? '' : 's'} failed`, 'error', 2400);
      else if (s.passed) showToast(`All ${s.passed} tests passed`, 'success', 2000);
    }
    currentRun = null;
    scheduleRender();
    return;
  }
  if (applyEvent(m, ev)) scheduleRender();
}

// ── Showing ────────────────────────────────────────────────────────

export function showTests() {
  document.querySelector('.ide-body')?.classList.remove('sidebar-hidden-pro', 'sidebar-hidden-play');
  showSidebarView('tests');
  if (!pytest) refreshTests();
}

function scheduleRender() {
  if (renderTimer) return;
  renderTimer = setTimeout(() => { renderTimer = null; render(); }, 60);
}

function updateMarks() {
  for (const { tab, view } of visibleTabs()) setTestMarks(view, tab.kind === 'notebook' ? null : fileMarks(m, tab.filePath));
}

function statusIcon(status) {
  const s = el('span', `tv-icon is-${status}`, ICON[status] ?? '○');
  s.setAttribute('aria-label', status);
  return s;
}

function render() {
  updateMarks();
  const box = document.getElementById('tests-view');
  if (!box) return;
  box.replaceChildren();
  const head = el('div', 'tv-head');
  const title = el('span', 'tv-title');
  title.innerHTML = `${logoSvg('pytest', 14)}<span>Tests</span>`; // our own static markup
  head.append(title);
  const actions = el('div', 'tv-actions');
  const busy = m.running || m.collecting;
  actions.append(
    btn('tv-btn tv-btn--primary', 'Run all', runAllTests, 'Run all tests'),
    btn('tv-btn', 'Run failed', runFailedTests, 'Run the tests that failed last time'),
    btn('tv-btn', '↻', refreshTests, 'Find tests again'),
  );
  if (busy) actions.append(btn('tv-btn', 'Stop', stopTests, 'Stop the tests'));
  head.append(actions);
  box.append(head);

  // States without tests
  if (!getWorkspaceRoot()) {
    box.append(el('p', 'tv-empty', 'Open a project folder to find its tests. Tests are functions named test_… in files named test_*.py.'));
    return;
  }
  if (pytest && !pytest.ok) {
    const p = el('div', 'tv-empty');
    p.append(el('p', '', pytest.reason === 'no-python' ? 'Choose a Python first (status bar).' : 'pytest is not installed in this Python.'));
    if (pytest.reason !== 'no-python') {
      p.append(btn('tv-btn tv-btn--primary', 'Install pytest', async () => {
        showToast('Installing pytest…', 'info', 1800);
        try {
          const res = await api().pyInstall(['pytest']);
          if (res?.ok) { showToast('pytest installed', 'success', 1800); refreshTests(); }
          else showToast('Could not install pytest: see the Output', 'error', 3000);
        } catch (err) { showToast(cleanErr(err), 'error', 3000); }
      }));
    }
    box.append(p);
    return;
  }

  // Summary
  const s = summary(m);
  const sum = el('div', 'tv-summary');
  if (m.collecting) sum.append(el('span', '', 'Finding tests…'));
  else if (m.running) sum.append(el('span', 'is-running', 'Running…'));
  if (!m.collecting) {
    const part = (n, cls, word) => { if (n) { const x = el('span', cls); x.append(el('b', '', String(n)), document.createTextNode(` ${word}`)); sum.append(x); } };
    part(s.passed, 'is-passed', 'passed');
    part(s.failed, 'is-failed', 'failed');
    part(s.skipped, 'is-skipped', 'skipped');
    if (!s.passed && !s.failed && s.total && !m.running) sum.append(el('span', '', `${s.total} test${s.total === 1 ? '' : 's'}`));
    if (s.duration && !m.running) sum.append(el('span', 'tv-dur', `${s.duration.toFixed(2)} s`));
  }
  box.append(sum);
  const opt = el('label', 'tv-option');
  const cb = el('input');
  cb.type = 'checkbox';
  cb.checked = runOnSave();
  cb.addEventListener('change', () => setPrefs({ testsOnSave: cb.checked }));
  opt.append(cb, document.createTextNode(' Run tests when I save'));
  box.append(opt);

  for (const err of m.errors) {
    const e = el('div', 'tv-collect-error');
    e.append(el('b', '', `Could not load ${err.nodeid || 'a test file'}`));
    const pre = el('pre', '', err.message.split('\n').filter((l) => /^E\s|Error/.test(l)).slice(-4).join('\n') || err.message.slice(-500));
    e.append(pre);
    box.append(e);
  }

  const files = tree(m);
  if (!files.length && !m.collecting) {
    box.append(el('p', 'tv-empty', 'No tests found. Write functions named test_… in files named test_*.py (or *_test.py), then press ↻.'));
    return;
  }
  const list = el('div', 'tv-tree');
  list.setAttribute('role', 'tree');
  for (const f of files) {
    const all = [...f.tests, ...f.classes.flatMap((c) => c.tests)];
    list.append(row({ id: f.id, label: f.id.split('/').pop(), detail: f.id.includes('/') ? f.id.slice(0, f.id.lastIndexOf('/')) : '', status: groupStatus(all), depth: 0, kind: 'file', onOpen: () => openPath(f.file) }));
    if (!expanded.has(`-${f.id}`)) {
      for (const t of f.tests) list.append(testRow(t, 1));
      for (const c of f.classes) {
        list.append(row({ id: c.id, label: c.name, status: groupStatus(c.tests), depth: 1, kind: 'class', onOpen: () => openPath(f.file, c.tests[0]?.line ? c.tests[0].line - 1 : undefined) }));
        if (!expanded.has(`-${c.id}`)) for (const t of c.tests) list.append(testRow(t, 2));
      }
    }
  }
  box.append(list);
  if (log && !m.running && s.failed) {
    const det = el('details', 'tv-log');
    det.append(el('summary', '', 'pytest output'), el('pre', '', log));
    box.append(det);
  }
}

function row({ id, label, detail, status, depth, kind, onOpen }) {
  const r = el('div', `tv-row tv-row--${kind}`);
  r.style.setProperty('--depth', String(depth));
  r.setAttribute('role', 'treeitem');
  if (kind !== 'test') {
    const key = `-${id}`;
    const tw = btn('tv-twisty', expanded.has(key) ? '▸' : '▾', () => { if (expanded.has(key)) expanded.delete(key); else expanded.add(key); render(); }, expanded.has(key) ? 'Expand' : 'Collapse');
    r.append(tw);
  }
  r.append(statusIcon(status));
  const name = el('span', 'tv-name', label);
  r.append(name);
  if (detail) r.append(el('span', 'tv-detail', detail));
  r.append(btn('tv-run', '', () => runTests([id]), `Run ${label}`, PLAY));
  r.addEventListener('click', onOpen);
  r.tabIndex = 0;
  r.addEventListener('keydown', (e) => { if (e.key === 'Enter') onOpen(); });
  return r;
}

function testRow(t, depth) {
  const frag = document.createDocumentFragment();
  const r = row({ id: t.nodeid, label: t.name, status: t.status, depth, kind: 'test', onOpen: () => openPath(t.failPath && (t.status === 'failed' || t.status === 'error') ? t.failPath : t.file, (t.status === 'failed' && t.failLine) || t.line) });
  if (t.duration && t.status !== 'running') r.insertBefore(el('span', 'tv-dur', `${t.duration < 0.01 ? '<0.01' : t.duration.toFixed(2)} s`), r.lastChild);
  frag.append(r);
  if ((t.status === 'failed' || t.status === 'error') && (t.message || t.longrepr)) {
    const det = el('details', 'tv-fail');
    det.style.setProperty('--depth', String(depth));
    det.append(el('summary', '', t.message.split('\n')[0] || 'Failed'));
    det.append(el('pre', '', t.longrepr || t.message));
    if (t.stdout) det.append(el('div', 'tv-fail__out', 'Printed:'), el('pre', '', t.stdout));
    frag.append(det);
  } else if (t.status === 'skipped' && t.message) {
    const d = el('div', 'tv-skip', t.message.replace(/^Skipped:\s*/, 'Skipped: '));
    d.style.setProperty('--depth', String(depth));
    frag.append(d);
  }
  return frag;
}

// ── Wiring ─────────────────────────────────────────────────────────

export function initTests() {
  if (!api()?.onTestEvent) return;
  api().onTestEvent(onEvent);
  setTestRunHandler((nodeid) => runTests([nodeid]));
  onTabShow(({ phase }) => { if (phase === 'after') updateMarks(); });
  let lastRoot = null;
  onWorkspaceChange(() => {
    const root = getWorkspaceRoot();
    if (root === lastRoot) return;
    lastRoot = root;
    m.items.clear();
    m.errors = [];
    pytest = null;
    if (root) setTimeout(refreshTests, 1500); else render();
  });
  onFileSaved((p) => {
    const root = getWorkspaceRoot();
    if (!root || !/\.py$/i.test(p || '') || !p.toLowerCase().startsWith(root.toLowerCase())) return;
    if (!pytest?.ok) return;
    if (runOnSave()) {
      // A test file: its new or renamed tests are found first
      if (isTestFile(p)) { refreshTests(); pendingRun = []; } else runTests([]);
    } else if (isTestFile(p)) refreshTests();
  });
  document.getElementById('view-tests')?.addEventListener('click', showTests);
  document.getElementById('rail-tests')?.addEventListener('click', showTests);
  render();
}
