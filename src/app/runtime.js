/**
 * Code execution: picks the runtime (local Python when Electron finds one,
 * otherwise Pyodide in a Web Worker), runs/stops code and keeps the run
 * status, timer, progress bar and loading overlay in sync.
 */
import { getValue, highlightErrorLine, clearErrorHighlights } from '../editor.js';
import { WorkerManager } from '../worker-manager.js';
import { showToast } from '../toast.js';
import { $ } from '../core/dom.js';
import { isTeacherLive, isStudentConnected, streamStudentOutput } from '../classroom/classroom.js';
import { state } from './state.js';
import { saveCode } from './autosave.js';
import { getActiveFileName, getActiveTab } from './tabs.js';
import { runActiveNotebookCell, interruptActiveNotebook } from '../notebook/notebooks.js';
import { getWorkspaceRoot, isInWorkspace, relativePath } from './workspace.js';
import { saveToFile } from './files.js';
import { tidyTraceback, errorLineInUserCode } from '../core/traceback.js';
import { switchPane } from './layout.js';
import { setBootStep, setBootDetail, finishBoot, failBoot } from './boot.js';
import { runSucceeded, runFailed } from '../fx/moments.js';
import { initInterpreter, noteRunError, resetRunErrors, offerFixes } from './interpreter.js';

const PYODIDE_LOAD_TIMEOUT_MS = 45_000;
const RUN_LABELS = { idle: 'Ready', ready: 'Ready', running: 'Running', done: 'Done', error: 'Error' };

let execTimer = null;
let execStart = 0;

// ── Status UI ────────────────────────────────────────────────────

/**
 * Show the run state everywhere: the status pill (Playground) / kernel chip
 * (Pro), both Run buttons, and data-run-state on <html> (Theta the pixel
 * buddy reacts to it). `detail` replaces the default label, e.g.
 * "Done in 0.84s" or "NameError · line 8".
 */
export function setRunState(runState, detail) {
  const $status = $('run-status');
  const $statusText = $('run-status-text');
  if ($status) $status.className = `run-status run-status--${runState}`;
  const text = detail || RUN_LABELS[runState] || runState;
  if ($statusText) $statusText.textContent = text;
  if ($status) $status.title = text; // the words hide in narrow windows; the tooltip keeps them
  document.documentElement.dataset.runState = runState;

  const running = runState === 'running';
  document.querySelectorAll('[data-run-btn]').forEach((btn) => {
    btn.classList.toggle('running', running);
    const label = btn.querySelector('.run-label');
    if (label) label.textContent = running ? 'Stop' : 'Run';
    btn.querySelector('.run-icon-play')?.classList.toggle('hidden', running);
    btn.querySelector('.run-icon-stop')?.classList.toggle('hidden', !running);
  });
}

// ── Run history (Playground run rail) ───────────────────────────
const MAX_RUNS = 8;
const runs = [];
let runCount = 0;

function addRunHistory(entry) {
  runCount += 1;
  runs.push({ n: runCount, ...entry });
  if (runs.length > MAX_RUNS) runs.shift();
  const $list = $('run-history');
  if (!$list) return;
  $list.replaceChildren(...runs.map((r) => {
    const li = document.createElement('li');
    li.className = r.kind;
    const n = document.createElement('span');
    n.className = 'run-n';
    n.textContent = `#${r.n}`;
    const label = document.createElement('span');
    label.textContent = r.label;
    li.append(n, label);
    return li;
  }));
  $list.lastElementChild?.scrollIntoView?.({ inline: 'end', block: 'nearest' });
}

function setRuntimeStatus(text) {
  const $s = $('pyodide-status');
  if ($s) $s.textContent = text;
}

function setRuntimeInfo(version, kind) {
  const $ver = $('python-version');
  const $type = $('runtime-type');
  if ($ver) $ver.textContent = version;
  if ($type) $type.textContent = kind;
  const $rail = $('runbar-runtime');
  if ($rail) $rail.textContent = `Python ${version} · ${kind}`;
}

function startExecTimer() {
  execStart = performance.now();
  const $exec = $('exec-time');
  $exec?.classList.add('running');
  const tick = () => {
    if ($exec) $exec.textContent = `${((performance.now() - execStart) / 1000).toFixed(1)}s`;
    execTimer = requestAnimationFrame(tick);
  };
  execTimer = requestAnimationFrame(tick);
}

function stopExecTimer(durationMs) {
  cancelAnimationFrame(execTimer);
  execTimer = null;
  const $exec = $('exec-time');
  if ($exec && durationMs !== undefined) {
    $exec.textContent = `${(durationMs / 1000).toFixed(3)}s`;
  }
  $exec?.classList.remove('running');
}

function startProgressBar() {
  const $bar = $('run-progress-bar');
  if ($bar) $bar.className = 'run-progress-bar indeterminate';
}

function finishProgressBar() {
  const $bar = $('run-progress-bar');
  if (!$bar) return;
  $bar.className = 'run-progress-bar done';
  setTimeout(() => { $bar.className = 'run-progress-bar'; }, 500);
}

function setPipStatus(text, kind, clearAfterMs) {
  const $pip = $('pip-status');
  if (!$pip) return;
  $pip.textContent = text;
  $pip.className = `pip-bar__status ${kind}`;
  if (clearAfterMs) {
    setTimeout(() => { $pip.textContent = ''; $pip.className = 'pip-bar__status'; }, clearAfterMs);
  }
}

// ── Output routing (terminal + classroom) ────────────────────────

/** How the active file appears in tracebacks: its path in the project, or the tab name. */
function activeFileId() {
  const path = getActiveTab()?.filePath;
  return path && isInWorkspace(path) ? relativePath(path) : getActiveFileName() || 'main.py';
}

// ── Run events (error explanations, predictions, progress, class pulse) ──

const runListeners = { start: new Set(), finish: new Set() };
/** fn({ code, fileName }) when a run starts. */
export function onRunStart(fn) { runListeners.start.add(fn); return () => runListeners.start.delete(fn); }
/**
 * fn({ code, fileName, ok, stopped, durationMs, stdout, stderr, error }) when a run ends;
 * error = { type, message, line, lineText } for a failed run.
 */
export function onRunFinish(fn) { runListeners.finish.add(fn); return () => runListeners.finish.delete(fn); }

const MAX_CAPTURE = 200_000;
let current = null; // { code, fileName, stdout, stderr, stopped }

/** The exception at the end of a traceback: { type, message }. */
export function lastException(stderr) {
  const lines = String(stderr || '').trimEnd().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^(\w+(?:Error|Exception|Interrupt|Exit|Warning)|StopIteration|KeyboardInterrupt)(?::\s?(.*))?$/.exec(lines[i].trim());
    if (m) return { type: m[1], message: (m[2] || '').trim() };
  }
  return null;
}

function forwardOutput(text, stream) {
  if (stream === 'stderr') text = tidyTraceback(text, getActiveFileName() || 'main.py', getWorkspaceRoot());
  if (current) {
    const k = stream === 'stderr' ? 'stderr' : 'stdout';
    if (current[k].length < MAX_CAPTURE) current[k] += text;
  }
  if (stream === 'stderr') state.terminal?.writeError(text);
  else state.terminal?.writeOutput(text);

  if (isTeacherLive()) window.electronAPI?.classroomBroadcastTerminal?.(text, stream);
  if (isStudentConnected()) streamStudentOutput(text, stream);

  if (stream === 'stderr') {
    const line = errorLineInUserCode(text, activeFileId());
    if (line) {
      highlightErrorLine(line);
      state.lastErrorLine = line;
    }
    // Remember the exception name for the status pill and run history
    const names = [...text.matchAll(/^(\w+(?:Error|Exception|Interrupt|Exit))\b/gm)];
    if (names.length) state.lastError = names[names.length - 1][1];
    noteRunError(text);
  }
}

function finishRun({ durationMs, failed, message }) {
  stopExecTimer(durationMs);
  state.terminal?.exitInputMode();
  if (durationMs !== undefined) state.terminal?.writeDoneSeparator(durationMs);
  finishProgressBar();
  const secs = durationMs !== undefined ? `${(durationMs / 1000).toFixed(2)}s` : '';
  const errLabel = state.lastError || 'Error';
  setRunState(
    failed ? 'error' : 'done',
    failed ? `${errLabel}${state.lastErrorLine ? ` · line ${state.lastErrorLine}` : ''}` : `Done in ${secs}`,
  );
  addRunHistory(failed ? { kind: 'fail', label: errLabel } : { kind: 'ok', label: secs });
  state.isRunning = false;
  if (message) showToast(message, failed ? 'error' : 'success', failed ? 2400 : 2000);

  const $anchor = document.querySelector('.exec-time-wrap');
  if (failed) runFailed($anchor);
  else if (durationMs !== undefined) runSucceeded($anchor);
  offerFixes({ failed, rerun: runCode });

  const run = current;
  current = null;
  if (run) {
    const exc = failed ? lastException(run.stderr) : null;
    const line = failed ? state.lastErrorLine || null : null;
    const lineText = line ? (run.code.split('\n')[line - 1] ?? '').trim() : '';
    const event = {
      code: run.code, fileName: run.fileName, ok: !failed, stopped: run.stopped, durationMs,
      stdout: run.stdout, stderr: run.stderr,
      error: failed ? { type: exc?.type || state.lastError || 'Error', message: exc?.message || '', line, lineText } : null,
    };
    runListeners.finish.forEach((fn) => { try { fn(event); } catch (err) { console.error('[run listener]', err); } });
  }
}

// ── Run / Stop ───────────────────────────────────────────────────

export async function runCode() {
  // While debugging, Run acts as Stop for the debug session
  if (state.debugging) { state.stopDebug?.(); return; }
  // A notebook runs its selected cell in its own kernel
  if (runActiveNotebookCell()) return;
  clearErrorHighlights();
  const ready = state.useLocalPython || state.workerManager?.isReady;
  if (!ready) {
    showToast('Runtime is still loading…', 'info', 1800);
    return;
  }
  if (state.isRunning) {
    stopCode();
    return;
  }

  let code = getValue();
  if (!code.trim()) {
    showToast('Nothing to run — write some Python first', 'info', 2000);
    return;
  }

  // A file in the open project runs in place, so its imports see the other
  // project files; save it first so they also see the latest text.
  const tab = getActiveTab();
  const projectFile = !!(state.useLocalPython && tab?.filePath && isInWorkspace(tab.filePath));
  if (projectFile && tab.unsaved) {
    const saved = await saveToFile();
    if (!saved) return;
    code = getValue();
  }

  saveCode();
  state.isRunning = true;
  state.lastError = null;
  state.lastErrorLine = null;
  resetRunErrors();
  setRunState('running', `Running ${getActiveFileName() || 'main.py'}`);
  if (state.activePane !== 'terminal') switchPane('terminal');

  const $exec = $('exec-time');
  if ($exec) $exec.textContent = '';
  state.terminal?.exitInputMode();
  state.terminal?.writeRunSeparator();
  startProgressBar();
  startExecTimer();

  current = { code, fileName: getActiveFileName() || 'main.py', stdout: '', stderr: '', stopped: false };
  runListeners.start.forEach((fn) => { try { fn({ code, fileName: current.fileName }); } catch (err) { console.error('[run listener]', err); } });

  if (state.useLocalPython) window.electronAPI.runPython(code, projectFile ? { filePath: tab.filePath } : {});
  else state.workerManager.run(code);
}

export function stopCode() {
  if (state.debugging) { state.stopDebug?.(); return; }
  if (!state.isRunning && interruptActiveNotebook()) return;
  const wasRunning = state.isRunning;
  if (current) current.stopped = true;
  if (state.useLocalPython) window.electronAPI.killPython();
  else state.workerManager?.kill(); // Pyodide reports back via onInterrupted
  setRunState('idle', 'Stopped');
  state.isRunning = false;
  if (wasRunning) addRunHistory({ kind: 'stopped', label: 'stopped' });

  if (wasRunning && state.useLocalPython) {
    stopExecTimer();
    state.terminal?.exitInputMode();
    state.terminal?.writeInterrupted();
    finishProgressBar();
    showToast('Execution stopped', 'info', 1600);
  }
}

// ── Runtime start-up ─────────────────────────────────────────────

/**
 * Detect local Python (Electron) and fall back to Pyodide.
 * Resolves once the choice is made; Pyodide may still be loading.
 */
export async function initRuntime() {
  // Pyodide input() requests come through the terminal's input mode.
  state.terminal.onInputSubmit = (value) => {
    if (value === null) {
      state.workerManager?.kill();
      setRunState('idle');
      return;
    }
    state.workerManager?.provideInput(value);
  };

  const api = window.electronAPI;
  setBootStep(2);
  if (api?.pyInit) {
    try {
      // First start creates the default environment from the built-in Python
      const active = await initInterpreter({ onStatus: (text) => setBootStep(2, text) });
      if (active) {
        state.useLocalPython = true;
        bindPipManager();
        setupLocalPython(api);
        setRuntimeStatus('Runtime ready');
        setBootStep(3, `Using ${active.label}`);
        finishBoot(400);
        setRunState('ready');
        state.terminal?.focus();
        return;
      }
    } catch (err) {
      console.error('[THETA] Python setup failed:', err);
      // fall through to Pyodide
    }
  }

  setBootStep(3, 'No local Python found, starting the built-in runtime');
  initPyodide();
  bindPipManager();
}

/** The pip manager must know which runtime installs packages. */
function bindPipManager() {
  const pip = state.pipManager;
  if (!pip) return;
  pip.useLocalPython = state.useLocalPython;
  pip.terminal = state.terminal;
  pip.workerManager = state.workerManager;
}

function setupLocalPython(api) {
  api.onPythonStdout((data) => {
    forwardOutput(data, 'stdout');
    // A chunk without a trailing newline usually means input() is waiting.
    if (data && !data.endsWith('\n')) {
      state.terminal?.enterInputMode('');
      state.terminal.onInputSubmit = (value) => {
        if (value === null) {
          stopCode();
          return;
        }
        api.sendPythonInput(value);
      };
    }
  });

  api.onPythonStderr((data) => forwardOutput(data, 'stderr'));

  api.onPythonDone((exitCode) => {
    if (!state.isRunning) return; // already stopped by the user
    const durationMs = performance.now() - execStart;
    const failed = exitCode !== 0;
    finishRun({
      durationMs,
      failed,
      message: failed ? 'Execution error' : `Done in ${(durationMs / 1000).toFixed(3)}s`,
    });
  });

  api.onPipStdout((data) => state.terminal?.writeSystem(data));

  api.onPipDone((exitCode, pkg) => {
    if (exitCode === 0) {
      setPipStatus(`[OK] ${pkg} installed`, 'success', 4000);
      showToast(`${pkg} installed`, 'success', 2500);
    } else {
      setPipStatus('[FAIL] Failed', 'error', 5000);
      showToast(`Failed to install ${pkg}`, 'error', 3000);
    }
  });
}

function initPyodide() {
  const wm = new WorkerManager();
  state.workerManager = wm;

  wm.onStatus = (text) => {
    setRuntimeStatus(text);
    setBootDetail(text);
  };

  const loadTimeout = setTimeout(() => {
    if (wm.isReady) return;
    setRuntimeStatus('Load timed out');
    setBootDetail('The Python runtime is taking too long to download. Check the internet connection, then retry.');
    showToast('Python runtime is taking too long. Check your connection.', 'error', 5000);
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'loading-retry-btn';
    retry.textContent = 'Retry';
    retry.addEventListener('click', () => {
      retry.remove();
      wm.init();
      setRuntimeStatus('Retrying...');
      showToast('Retrying Python runtime load...', 'info', 2000);
    });
    document.querySelector('.loading-content')?.appendChild(retry);
  }, PYODIDE_LOAD_TIMEOUT_MS);

  wm.onReady = () => {
    clearTimeout(loadTimeout);
    finishBoot(500);
    setRuntimeStatus('Runtime ready');
    setRuntimeInfo('3.11', 'Pyodide · WASM');
    setRunState('ready');
    state.terminal?.focus();
  };

  wm.onStdout = (text) => forwardOutput(text, 'stdout');
  wm.onStderr = (text) => forwardOutput(text, 'stderr');
  wm.onInputRequest = (prompt) => state.terminal?.enterInputMode(prompt);

  wm.onDone = (durationMs) => finishRun({
    durationMs,
    failed: false,
    message: `Done in ${(durationMs / 1000).toFixed(3)}s`,
  });

  wm.onError = (message, durationMs) => {
    forwardOutput(`\n${message}\n`, 'stderr'); // same path as local runs: tidy, highlight, classroom
    finishRun({ durationMs, failed: true, message: 'Execution error' });
  };

  wm.onInterrupted = () => {
    stopExecTimer();
    state.terminal?.exitInputMode();
    state.terminal?.writeInterrupted();
    finishProgressBar();
    setRunState('idle');
    state.isRunning = false;
    showToast('Execution stopped', 'info', 1600);
  };

  wm.onInstallStart = (pkg) => setPipStatus(`Installing ${pkg}...`, 'installing');
  wm.onInstallDone = (pkg) => {
    setPipStatus(`[OK] ${pkg} installed`, 'success', 4000);
    state.terminal?.writeSystem(`[pip] ${pkg} installed successfully\n`);
    showToast(`${pkg} installed`, 'success', 2500);
  };
  wm.onInstallError = (pkg, msg) => {
    setPipStatus('[FAIL] Failed', 'error', 5000);
    state.terminal?.writeError(`[pip] ${pkg} failed -- ${msg}\n`);
    showToast(`Failed to install ${pkg}`, 'error', 3000);
  };

  wm.onLoadError = (msg) => {
    clearTimeout(loadTimeout);
    console.error('[THETA] Pyodide load error:', msg);
    failBoot();
    showToast(`Python runtime failed: ${msg}`, 'error', 6000);
    state.terminal?.writeError(`[runtime] ${msg}\n`);
  };

  wm.init();
}
