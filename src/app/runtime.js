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
import { switchPane } from './layout.js';

const PYODIDE_LOAD_TIMEOUT_MS = 45_000;
const RUN_LABELS = { idle: 'Ready', ready: 'Ready', running: 'Running', done: 'Done', error: 'Error' };

let execTimer = null;
let execStart = 0;

// ── Status UI ────────────────────────────────────────────────────

export function setRunState(runState) {
  const $status = $('run-status');
  const $statusText = $('run-status-text');
  const $runBtn = $('btn-run');
  const $runBtnText = $('run-btn-text');
  const $play = document.querySelector('.run-icon-play');
  const $stop = document.querySelector('.run-icon-stop');

  if ($status) $status.className = `run-status run-status--${runState}`;
  if ($statusText) $statusText.textContent = RUN_LABELS[runState] || runState;

  const running = runState === 'running';
  $runBtn?.classList.toggle('running', running);
  if ($runBtnText) $runBtnText.textContent = running ? 'Stop' : 'Run';
  $play?.classList.toggle('hidden', running);
  $stop?.classList.toggle('hidden', !running);
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

/** Step the loading overlay's checklist while the runtime starts. */
export function animateLoadingSteps() {
  const steps = [$('lstep-1'), $('lstep-2'), $('lstep-3')];
  steps.forEach((step, i) => {
    setTimeout(() => {
      if (i > 0) steps[i - 1]?.classList.replace('active', 'done');
      step?.classList.add('active');
    }, 400 + i * 700);
  });
}

function dismissLoadingOverlay(delayMs) {
  const $overlay = $('loading-overlay');
  $('lstep-4')?.classList.add('active');
  setTimeout(() => {
    $overlay?.classList.add('fade-out');
    setTimeout(() => $overlay?.classList.add('hidden'), 420);
  }, delayMs);
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

function forwardOutput(text, stream) {
  if (stream === 'stderr') state.terminal?.writeError(text);
  else state.terminal?.writeOutput(text);

  if (isTeacherLive()) window.electronAPI?.classroomBroadcastTerminal?.(text, stream);
  if (isStudentConnected()) streamStudentOutput(text, stream);

  if (stream === 'stderr') {
    const match = text.match(/line\s+(\d+)/i);
    if (match) highlightErrorLine(parseInt(match[1], 10));
  }
}

function finishRun({ durationMs, failed, message }) {
  stopExecTimer(durationMs);
  state.terminal?.exitInputMode();
  if (durationMs !== undefined) state.terminal?.writeDoneSeparator(durationMs);
  finishProgressBar();
  setRunState(failed ? 'error' : 'done');
  state.isRunning = false;
  if (message) showToast(message, failed ? 'error' : 'success', failed ? 2400 : 2000);
}

// ── Run / Stop ───────────────────────────────────────────────────

export function runCode() {
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

  const code = getValue();
  if (!code.trim()) {
    showToast('Nothing to run — write some Python first', 'info', 2000);
    return;
  }

  saveCode();
  state.isRunning = true;
  setRunState('running');
  if (state.activePane !== 'terminal') switchPane('terminal');

  const $exec = $('exec-time');
  if ($exec) $exec.textContent = '';
  state.terminal?.exitInputMode();
  state.terminal?.writeRunSeparator();
  startProgressBar();
  startExecTimer();

  if (state.useLocalPython) window.electronAPI.runPython(code);
  else state.workerManager.run(code);
}

export function stopCode() {
  const wasRunning = state.isRunning;
  if (state.useLocalPython) window.electronAPI.killPython();
  else state.workerManager?.kill(); // Pyodide reports back via onInterrupted
  setRunState('idle');
  state.isRunning = false;

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
  if (api?.detectPython) {
    try {
      const result = await api.detectPython();
      if (result.found) {
        state.useLocalPython = true;
        bindPipManager();
        setupLocalPython(api);
        setRuntimeStatus('Runtime ready (local)');
        setRuntimeInfo(result.version.replace('Python ', ''), 'Local · Native');
        dismissLoadingOverlay(400);
        setRunState('ready');
        showToast(`Local ${result.version} detected`, 'success', 2500);
        state.terminal?.focus();
        return;
      }
    } catch (_) {
      // fall through to Pyodide
    }
  }

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

  wm.onStatus = (text) => setRuntimeStatus(text);

  const loadTimeout = setTimeout(() => {
    if (wm.isReady) return;
    setRuntimeStatus('Load timed out');
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
    dismissLoadingOverlay(600);
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
    state.terminal?.writeError(`\n${message}\n`);
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
    $('loading-overlay')?.classList.add('hidden');
    showToast(`Python runtime failed: ${msg}`, 'error', 6000);
    state.terminal?.writeError(`[runtime] ${msg}\n`);
  };

  wm.init();
}
