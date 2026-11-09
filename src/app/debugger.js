/**
 * The debugger (desktop): breakpoints, stepping, variables, watch, call
 * stack and evaluate, driven by debugpy in the main process.
 *
 * The program's output and input() use the Output pane, as in a normal Run.
 */
import { getView, focusEditor } from '../editor.js';
import { breakpointLines, setBreakpointsEffect, setPausedLineEffect, toggleBreakpointAt, setBreakpointListener } from '../debug-editor.js';
import { showToast } from '../toast.js';
import { $ } from '../core/dom.js';
import { pathToUri } from '../core/uri.js';
import { state } from './state.js';
import {
  getTabs, getActiveTab, switchTab, onTabShow, onTabsChanged, openLibraryTab, updateTabState, getTabState,
} from './tabs.js';
import { isInWorkspace, openPath, relativePath } from './workspace.js';
import { showSidebarView } from './search.js';
import { switchPane } from './layout.js';
import { setRunState } from './runtime.js';
import { saveToFile } from './files.js';
import { getPrefs, setPrefs } from './session.js';

const api = () => window.electronAPI;
const SPECIAL = /^(special|function|class) variables$/;

/** The current session, or null. */
let session = null;
/*
 * session = {
 *   tabId, name, program, temp,     what is being debugged
 *   paused, threadId, frames, frameId,
 *   location: { tabId, line } | null
 * }
 */
const expanded = new Set(); // variable paths the user opened ("frame/x/y")

export const isDebugging = () => !!session;

// ── Breakpoints ──────────────────────────────────────────────────

/** Which key the main process knows a tab's file by: its path, '' for the debugged temp copy. */
function breakpointKey(tab) {
  if (tab.filePath && isInWorkspace(tab.filePath)) return tab.filePath;
  if (session?.temp && tab.id === session.tabId) return '';
  return null;
}

function collectBreakpoints(debugTab) {
  const out = {};
  for (const tab of getTabs()) {
    const st = getTabState(tab.id);
    const lines = st ? breakpointLines(st) : [];
    if (!lines.length) continue;
    if (tab.filePath && isInWorkspace(tab.filePath)) out[tab.filePath] = lines;
    else if (tab.id === debugTab.id) out[''] = lines;
  }
  return out;
}

function renderBreakpoints() {
  const $list = $('dbg-breakpoints');
  if (!$list) return;
  $list.textContent = '';
  let any = false;
  for (const tab of getTabs()) {
    const st = getTabState(tab.id);
    for (const line of st ? breakpointLines(st) : []) {
      any = true;
      const li = document.createElement('li');
      li.className = 'dbg-bp';
      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'dbg-bp__go';
      go.innerHTML = '<span class="dbg-bp__dot" aria-hidden="true"></span>';
      go.append(`${tab.filePath && isInWorkspace(tab.filePath) ? relativePath(tab.filePath) : tab.name}`);
      const ln = document.createElement('span');
      ln.className = 'dbg-bp__line';
      ln.textContent = `line ${line}`;
      go.appendChild(ln);
      go.addEventListener('click', () => reveal(tab.id, line));
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'dbg-bp__rm';
      rm.setAttribute('aria-label', `Remove breakpoint at line ${line}`);
      rm.textContent = '×';
      rm.addEventListener('click', () => {
        const s = getTabState(tab.id);
        if (!s) return;
        const lines = breakpointLines(s).filter((n) => n !== line);
        updateTabState(tab.id, { effects: setBreakpointsEffect.of(lines) });
        syncBreakpoints(tab);
        renderBreakpoints();
      });
      li.append(go, rm);
      $list.appendChild(li);
    }
  }
  if (!any) {
    const li = document.createElement('li');
    li.className = 'dbg-empty';
    li.textContent = 'No breakpoints. Click left of a line number, or press F9.';
    $list.appendChild(li);
  }
}

/** Tell the running debugger about a tab's breakpoints. */
function syncBreakpoints(tab) {
  if (!session) return;
  const key = breakpointKey(tab);
  const st = getTabState(tab.id);
  if (key === null || !st) return;
  api().debugSetBreakpoints(key, breakpointLines(st)).catch(() => {});
}

export function toggleBreakpoint() {
  const view = getView();
  if (view) toggleBreakpointAt(view, view.state.selection.main.head);
}

// ── Showing where the program is ─────────────────────────────────

function samePath(a, b) {
  if (!a || !b) return false;
  const win = /^[A-Za-z]:/.test(a);
  const n = (p) => p.replace(/\//g, win ? '\\' : '/');
  return win ? n(a).toLowerCase() === n(b).toLowerCase() : n(a) === n(b);
}

async function reveal(tabId, line) {
  if (getActiveTab()?.id !== tabId) switchTab(tabId);
  const view = getView();
  if (!view || line > view.state.doc.lines) return;
  const pos = view.state.doc.line(line).from;
  view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
  focusEditor();
}

/** Open the file of a stack frame and mark its line. */
async function showFrame(frame) {
  if (!session) return;
  const file = frame.source?.path;
  const line = frame.line;
  let tab = null;
  if (file && session.temp && samePath(file, session.program)) {
    tab = getTabs().find((t) => t.id === session.tabId) || null;
  }
  if (!tab && file) tab = getTabs().find((t) => samePath(t.filePath, file)) || null;
  if (!tab && file && isInWorkspace(file)) {
    await openPath(file);
    tab = getActiveTab();
  }
  if (!tab && file) {
    try {
      const content = await api().debugReadFile(file);
      tab = openLibraryTab(pathToUri(file), file.split(/[\\/]/).pop(), content);
    } catch (_) {
      tab = null;
    }
  }
  if (!session) return;
  setLocation(tab ? { tabId: tab.id, line } : null);
  if (tab) await reveal(tab.id, line);
}

function setLocation(location) {
  const before = session?.location;
  if (session) session.location = location;
  // Clear the old mark wherever it was; set the new one
  if (before && (!location || before.tabId !== location.tabId)) updateTabState(before.tabId, { effects: setPausedLineEffect.of(null) });
  if (location) updateTabState(location.tabId, { effects: setPausedLineEffect.of(location.line) });
}

// ── Variables, watch, call stack ─────────────────────────────────

async function variables(ref) {
  try {
    return (await api().debugRequest('variables', { variablesReference: ref })).variables || [];
  } catch (_) {
    return [];
  }
}

function valueSpan(v) {
  const span = document.createElement('span');
  span.className = 'dbg-var__value';
  const t = (v.type || '').toLowerCase();
  span.dataset.kind = /^(str|bytes)$/.test(t) ? 'str' : /^(int|float|complex|bool)$/.test(t) ? 'num' : t === 'nonetype' ? 'none' : 'obj';
  span.textContent = v.value;
  span.title = v.type ? `${v.type}: ${v.value}` : v.value;
  return span;
}

async function renderVarList($parent, list, prefix, depth) {
  // Plain names first, then the "special/function variables" groups
  const sorted = [...list].sort((a, b) => Number(SPECIAL.test(a.name)) - Number(SPECIAL.test(b.name)));
  for (const v of sorted) {
    const id = `${prefix}/${v.evaluateName || v.name}`;
    const row = document.createElement('div');
    row.className = 'dbg-var';
    row.setAttribute('role', 'treeitem');
    row.style.setProperty('--depth', depth);
    const open = expanded.has(id);
    const twisty = document.createElement('button');
    twisty.type = 'button';
    twisty.className = 'dbg-var__twisty';
    if (v.variablesReference > 0) {
      twisty.textContent = open ? '▾' : '▸';
      twisty.setAttribute('aria-label', `${open ? 'Collapse' : 'Expand'} ${v.name}`);
      row.setAttribute('aria-expanded', String(open));
    } else {
      twisty.disabled = true;
      twisty.tabIndex = -1;
    }
    const name = document.createElement('span');
    name.className = `dbg-var__name${SPECIAL.test(v.name) ? ' dbg-var__name--group' : ''}`;
    name.textContent = v.name;
    row.append(twisty, name);
    if (!SPECIAL.test(v.name)) {
      const eq = document.createElement('span');
      eq.className = 'dbg-var__eq';
      eq.textContent = '=';
      row.append(eq, valueSpan(v));
      if (v.type) {
        const type = document.createElement('span');
        type.className = 'dbg-var__type';
        type.textContent = v.type;
        row.appendChild(type);
      }
    }
    $parent.appendChild(row);
    if (v.variablesReference > 0) {
      const toggle = () => { if (expanded.has(id)) expanded.delete(id); else expanded.add(id); renderVariables(); };
      twisty.addEventListener('click', toggle);
      name.addEventListener('click', toggle);
      if (open) await renderVarList($parent, await variables(v.variablesReference), id, depth + 1);
    }
  }
}

let renderSeq = 0;
async function renderVariables() {
  const $vars = $('dbg-variables');
  if (!$vars) return;
  const seq = ++renderSeq;
  if (!session?.paused || session.frameId == null) {
    $vars.innerHTML = `<p class="dbg-empty">${session ? 'Running… pause or hit a breakpoint to see variables.' : 'Variables appear when the program pauses.'}</p>`;
    return;
  }
  const frameId = session.frameId;
  let scopes = [];
  try { scopes = (await api().debugRequest('scopes', { frameId })).scopes || []; } catch (_) { /* resumed */ }
  if (seq !== renderSeq || !session) return;
  const frag = document.createElement('div');
  for (const scope of scopes) {
    const id = `${frameId}:${scope.name}`;
    if (!expanded.has(`${id}!seen`)) { expanded.add(`${id}!seen`); if (!scope.expensive) expanded.add(id); }
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'dbg-scope';
    head.textContent = `${expanded.has(id) ? '▾' : '▸'} ${scope.name}`;
    head.addEventListener('click', () => { if (expanded.has(id)) expanded.delete(id); else expanded.add(id); renderVariables(); });
    frag.appendChild(head);
    if (expanded.has(id)) await renderVarList(frag, await variables(scope.variablesReference), id, 0);
  }
  if (seq !== renderSeq) return; // a newer render started
  $vars.textContent = '';
  $vars.append(...frag.childNodes);
}

function watchList() { return Array.isArray(getPrefs().watch) ? getPrefs().watch.slice(0, 30) : []; }

async function renderWatch() {
  const $w = $('dbg-watch');
  if (!$w) return;
  const rows = [];
  for (const expr of watchList()) {
    let value = { value: session?.paused ? '…' : 'not available while running', type: '' };
    if (session?.paused && session.frameId != null) {
      try {
        const r = await api().debugRequest('evaluate', { expression: expr, frameId: session.frameId, context: 'watch' });
        value = { value: r.result, type: r.type };
      } catch (err) {
        value = { value: String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), type: 'error' };
      }
    }
    const row = document.createElement('div');
    row.className = 'dbg-var dbg-watch-row';
    const name = document.createElement('span');
    name.className = 'dbg-var__name';
    name.textContent = expr;
    const eq = document.createElement('span');
    eq.className = 'dbg-var__eq';
    eq.textContent = '=';
    const val = valueSpan(value);
    if (value.type === 'error') val.dataset.kind = 'error';
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'dbg-bp__rm';
    rm.textContent = '×';
    rm.setAttribute('aria-label', `Stop watching ${expr}`);
    rm.addEventListener('click', () => {
      setPrefs({ watch: watchList().filter((e) => e !== expr) });
      renderWatch();
    });
    row.append(name, eq, val, rm);
    rows.push(row);
  }
  $w.textContent = '';
  $w.append(...rows);
}

function renderStack() {
  const $s = $('dbg-stack');
  if (!$s) return;
  $s.textContent = '';
  for (const f of session?.paused ? session.frames : []) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `dbg-frame${f.id === session.frameId ? ' active' : ''}${f.presentationHint === 'subtle' ? ' subtle' : ''}`;
    const name = document.createElement('span');
    name.className = 'dbg-frame__name';
    name.textContent = f.name === '<module>' ? 'main program' : `${f.name}()`;
    const where = document.createElement('span');
    where.className = 'dbg-frame__where';
    const file = f.source?.path ? f.source.path.split(/[\\/]/).pop() : '?';
    where.textContent = `${session.temp && samePath(f.source?.path, session.program) ? session.name : file}:${f.line}`;
    b.append(name, where);
    b.addEventListener('click', async () => {
      session.frameId = f.id;
      renderStack();
      await showFrame(f);
      renderVariables();
      renderWatch();
    });
    li.appendChild(b);
    $s.appendChild(li);
  }
}

function setStatus(text) {
  const $t = $('dbg-status-text');
  if ($t) $t.textContent = text;
}

function renderControls() {
  const on = !!session;
  const paused = !!session?.paused;
  $('debug-toolbar')?.classList.toggle('hidden', !on);
  $('dbg-start')?.classList.toggle('hidden', on);
  $('dbg-continue')?.classList.toggle('hidden', on && !paused);
  $('dbg-pause')?.classList.toggle('hidden', !on || paused);
  for (const id of ['dbg-over', 'dbg-into', 'dbg-out']) {
    const b = $(id);
    if (b) b.disabled = !paused;
  }
  document.documentElement.toggleAttribute('data-debugging', on);
}

// ── Events from the debugger ─────────────────────────────────────

async function onStopped(body) {
  if (!session) return;
  session.paused = true;
  session.threadId = body.threadId ?? session.threadId;
  let frames = [];
  try {
    frames = (await api().debugRequest('stackTrace', { threadId: session.threadId, levels: 40 })).stackFrames || [];
  } catch (_) { /* resumed or ended */ }
  if (!session) return; // ended while we waited
  session.frames = frames;
  const top = session.frames[0];
  session.frameId = top?.id ?? null;
  const $exc = $('dbg-exception');
  $exc?.classList.add('hidden');
  let why = { breakpoint: 'on a breakpoint', step: 'after a step', entry: 'at the start', pause: 'where you paused', exception: 'on an exception', goto: '' }[body.reason] ?? '';
  if (body.reason === 'exception') {
    try {
      const info = await api().debugRequest('exceptionInfo', { threadId: session.threadId });
      const text = `${info.exceptionId?.split('.').pop() || 'Exception'}: ${info.description || ''}`.trim();
      if ($exc) { $exc.textContent = text; $exc.classList.remove('hidden'); }
      why = `on ${info.exceptionId?.split('.').pop() || 'an exception'}`;
    } catch (_) { /* no details */ }
    if (!session) return;
  }
  const file = top?.source?.path ? (session.temp && samePath(top.source.path, session.program) ? session.name : top.source.path.split(/[\\/]/).pop()) : '';
  setStatus(top ? `Paused ${why} · ${file}, line ${top.line}` : 'Paused');
  setRunState('running', top ? `Paused · line ${top.line}` : 'Paused');
  renderControls();
  renderStack();
  if (top) await showFrame(top);
  if (!session) return;
  renderVariables();
  renderWatch();
}

function onContinued() {
  if (!session) return;
  session.paused = false;
  session.frames = [];
  session.frameId = null;
  $('dbg-exception')?.classList.add('hidden');
  setLocation(null);
  setStatus(`Running ${session.name}…`);
  setRunState('running', `Debugging ${session.name}`);
  renderControls();
  renderStack();
  renderVariables();
  renderWatch();
}

function onEnded({ exitCode } = {}) {
  if (!session) return;
  const name = session.name;
  setLocation(null);
  session = null;
  state.debugging = false;
  state.isRunning = false;
  state.terminal?.exitInputMode();
  const failed = exitCode != null && exitCode !== 0;
  state.terminal?.writeSystem(`\n[debug] ${name} finished${exitCode != null ? ` (exit code ${exitCode})` : ''}\n`);
  setRunState(failed ? 'error' : 'done', failed ? `Debug ended · exit ${exitCode}` : 'Debug finished');
  setStatus('Not debugging. Press F5 to debug the open file.');
  $('dbg-exception')?.classList.add('hidden');
  renderControls();
  renderStack();
  renderVariables();
  renderWatch();
}

function onOutput(stream, text) {
  if (!session) return;
  if (stream === 'stderr') state.terminal?.writeError(text);
  else state.terminal?.writeOutput(text);
  // A chunk without a newline usually means input() is waiting
  if (stream === 'stdout' && text && !text.endsWith('\n')) {
    state.terminal?.enterInputMode('');
    state.terminal.onInputSubmit = (value) => {
      if (value === null) { stopDebugging(); return; }
      api().debugInput(value);
    };
  }
}

// ── Commands ─────────────────────────────────────────────────────

/** F5: start debugging the active tab, or continue when paused. */
export async function startDebugging() {
  if (session) {
    if (session.paused) await command('continue');
    return;
  }
  if (!api()?.debugStart) {
    showToast('The debugger needs the desktop app', 'info', 2600);
    return;
  }
  if (!state.useLocalPython) {
    // Pyodide means no local Python was found; otherwise it is still starting
    showToast(state.workerManager
      ? 'The debugger needs a Python on this computer. Choose one from the status bar.'
      : 'Python is still starting. Try again in a moment.', 'info', 3000);
    return;
  }
  if (state.isRunning) {
    showToast('Stop the running program first', 'info', 1800);
    return;
  }
  let tab = getActiveTab();
  if (!tab || tab.readOnly) {
    showToast('Open a Python file to debug', 'info', 2000);
    return;
  }
  if (tab.kind === 'notebook') {
    showToast('The debugger works on .py files. In a notebook, run cells one at a time to check each step.', 'info', 3200);
    return;
  }
  const inProject = !!(tab.filePath && isInWorkspace(tab.filePath));
  if (inProject && tab.unsaved) {
    if (!(await saveToFile())) return;
    tab = getActiveTab();
  }
  const view = getView();
  session = {
    tabId: tab.id, name: tab.name, program: null, temp: !inProject,
    paused: false, threadId: null, frames: [], frameId: null, location: null,
  };
  state.debugging = true;
  state.isRunning = true;
  state.stopDebug = stopDebugging;
  expanded.clear();
  if (state.activePane !== 'terminal') switchPane('terminal');
  showSidebarView('debug');
  state.terminal?.exitInputMode();
  state.terminal?.writeRunSeparator();
  state.terminal?.writeSystem(`[debug] Starting ${tab.name}…\n`);
  setRunState('running', `Debugging ${tab.name}`);
  setStatus(`Starting ${tab.name}…`);
  renderControls();

  try {
    const res = await api().debugStart({
      filePath: inProject ? tab.filePath : null,
      code: view.state.doc.toString(),
      breakpoints: collectBreakpoints(tab),
      raisedExceptions: !!getPrefs().debugRaised,
    });
    if (session) {
      session.program = res.program;
      if (!session.paused) setStatus(`Running ${tab.name}…`);
    }
  } catch (err) {
    const message = String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    showToast(`Could not start the debugger: ${message}`, 'error', 4000);
    state.terminal?.writeError(`[debug] ${message}\n`);
    onEnded({});
  }
}

async function command(name) {
  if (!session) return;
  if (name !== 'pause' && !session.paused) return;
  try {
    await api().debugRequest(name, { threadId: session.threadId ?? 1 });
  } catch (err) {
    showToast(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error', 2400);
  }
}

export const continueDebugging = () => (session ? command('continue') : startDebugging());
export const pauseDebugging = () => command('pause');
export const stepOver = () => command('next');
export const stepInto = () => command('stepIn');
export const stepOut = () => command('stepOut');

export async function stopDebugging() {
  if (!session) return;
  setStatus('Stopping…');
  await api().debugStop().catch(() => {});
}

export async function restartDebugging() {
  if (!session) return startDebugging();
  const tabId = session.tabId;
  await stopDebugging();
  for (let i = 0; i < 40 && session; i++) await new Promise((r) => setTimeout(r, 50));
  if (getTabs().some((t) => t.id === tabId)) switchTab(tabId);
  return startDebugging();
}

async function evaluateInput() {
  const $in = $('dbg-eval-input');
  const $log = $('dbg-eval-log');
  const expr = $in?.value.trim();
  if (!expr || !$log) return;
  $in.value = '';
  const q = document.createElement('div');
  q.className = 'dbg-eval-q';
  q.textContent = `› ${expr}`;
  const a = document.createElement('div');
  a.className = 'dbg-eval-a';
  if (!session?.paused) {
    a.textContent = 'Pause the program first (a breakpoint or the Pause button).';
    a.classList.add('err');
  } else {
    try {
      const r = await api().debugRequest('evaluate', { expression: expr, frameId: session.frameId, context: 'repl' });
      a.textContent = r.result;
    } catch (err) {
      a.textContent = String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      a.classList.add('err');
    }
  }
  $log.append(q, a);
  while ($log.children.length > 60) $log.firstChild.remove();
  $log.scrollTop = $log.scrollHeight;
  if (session?.paused) { renderVariables(); renderWatch(); } // the expression may have changed values
}

// ── Start-up ─────────────────────────────────────────────────────

export function initDebugger() {
  const a = api();
  if (a?.onDebugEvent) {
    a.onDebugEvent((event, body) => {
      if (event === 'stopped') onStopped(body);
      else if (event === 'continued') onContinued();
      else if (event === 'output' && body?.output && body.category !== 'telemetry') {
        if (body.category === 'stderr') state.terminal?.writeError(body.output);
        else if (body.category === 'stdout') state.terminal?.writeOutput(body.output);
        else state.terminal?.writeSystem(body.output);
      }
    });
    a.onDebugOutput(onOutput);
    a.onDebugEnded(onEnded);
  }

  // The paused-line mark follows tab switches
  onTabShow(({ phase, tab }) => {
    if (phase !== 'after') return;
    const loc = session?.location;
    getView()?.dispatch({ effects: setPausedLineEffect.of(loc && tab && loc.tabId === tab.id ? loc.line : null) });
  });
  onTabsChanged(renderBreakpoints);
  setBreakpointListener(() => {
    const tab = getActiveTab();
    if (tab) syncBreakpoints(tab);
    renderBreakpoints();
  });

  $('dbg-start')?.addEventListener('click', startDebugging);
  $('dbg-continue')?.addEventListener('click', continueDebugging);
  $('dbg-pause')?.addEventListener('click', pauseDebugging);
  $('dbg-over')?.addEventListener('click', stepOver);
  $('dbg-into')?.addEventListener('click', stepInto);
  $('dbg-out')?.addEventListener('click', stepOut);
  $('dbg-restart')?.addEventListener('click', restartDebugging);
  $('dbg-stop')?.addEventListener('click', stopDebugging);
  $('dbg-watch-input')?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const expr = e.target.value.trim();
    if (!expr) return;
    e.target.value = '';
    if (!watchList().includes(expr)) setPrefs({ watch: [...watchList(), expr] });
    renderWatch();
  });
  $('dbg-eval-input')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') evaluateInput(); });
  const $raised = $('dbg-raised');
  if ($raised) {
    $raised.checked = !!getPrefs().debugRaised;
    $raised.addEventListener('change', () => {
      setPrefs({ debugRaised: $raised.checked });
      if (session) api().debugRequest('setExceptionBreakpoints', { filters: $raised.checked ? ['raised', 'uncaught'] : ['uncaught'] }).catch(() => {});
    });
  }
  renderControls();
  renderBreakpoints();
  renderWatch();
}

