/**
 * THETA172 — Pyodide Web Worker
 * 
 * Runs Python in a background thread.
 * Uses SharedArrayBuffer + Atomics for synchronous input() handling.
 * 
 * SharedArrayBuffer layout:
 *   [0]    = Int32: signal (0=waiting, 1=data ready, 2=kill)
 *   [1]    = Int32: byte length of input string
 *   [2..n] = Uint8: UTF-8 encoded input bytes (max 4096 chars)
 */

importScripts('https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js');

let pyodide = null;
let sharedBuffer = null;
let int32View = null;
let uint8View = null;
let isRunning = false;
let killFlag = false;

// ---- Init ----
async function initPyodide() {
  self.postMessage({ type: 'status', text: 'Loading Pyodide...' });

  pyodide = await loadPyodide({
    stdout: (text) => self.postMessage({ type: 'stdout', text: text + '\n' }),
    stderr: (text) => self.postMessage({ type: 'stderr', text: text + '\n' }),
  });

  self.postMessage({ type: 'status', text: 'Setting up environment...' });

  // Override sys.stdout and sys.stderr for unbuffered output
  pyodide.runPython(`
import sys
import io

class JSStdout(io.TextIOBase):
    def write(self, s):
        if s:
            from js import postOutputToMain
            postOutputToMain(s, 'stdout')
        return len(s)
    
    def flush(self):
        pass

class JSStderr(io.TextIOBase):
    def write(self, s):
        if s:
            from js import postOutputToMain
            postOutputToMain(s, 'stderr')
        return len(s)
    
    def flush(self):
        pass

sys.stdout = JSStdout()
sys.stderr = JSStderr()
  `);

  self.postMessage({ type: 'ready' });
}

// ---- Message output bridge ----
self.postOutputToMain = (text, channel) => {
  self.postMessage({ type: channel, text });
};

// ---- Custom input() using Atomics ----
function syncInput(prompt) {
  if (!sharedBuffer) {
    return '';
  }

  // Signal main thread we need input
  Atomics.store(int32View, 0, 0); // reset signal
  self.postMessage({ type: 'input-request', prompt: prompt || '' });

  // Block until main thread writes data (signal becomes 1)
  const result = Atomics.wait(int32View, 0, 0);

  if (killFlag || int32View[0] === 2) {
    throw new Error('KeyboardInterrupt');
  }

  if (result === 'timed-out' || int32View[0] !== 1) {
    return '';
  }

  // Read input from buffer
  const byteLen = int32View[1];
  if (byteLen === 0) return '';

  const bytes = uint8View.slice(8, 8 + byteLen);
  const text = new TextDecoder().decode(bytes);
  return text;
}

// ---- Run Python code ----
async function runCode(code) {
  if (!pyodide) return;
  isRunning = true;
  killFlag = false;

  const startTime = performance.now();

  try {
    // Install custom input() that blocks via Atomics
    pyodide.globals.set('__theta_input__', syncInput);
    pyodide.runPython(`
import builtins
builtins.input = __theta_input__
    `);

    await pyodide.runPythonAsync(code);

    const duration = performance.now() - startTime;
    self.postMessage({ type: 'done', duration });

  } catch (err) {
    const duration = performance.now() - startTime;
    let msg = err.message || String(err);

    // Clean up Pyodide traceback noise for display
    if (msg.includes('PythonError')) {
      const match = msg.match(/PythonError: ([\s\S]+)/);
      if (match) msg = match[1].trim();
    }

    if (msg.includes('KeyboardInterrupt')) {
      self.postMessage({ type: 'interrupted' });
    } else {
      self.postMessage({ type: 'error', message: msg, duration });
    }
  } finally {
    isRunning = false;
  }
}
// ---- Install package via micropip ----
async function installPackage(packageName) {
  if (!pyodide) {
    self.postMessage({ type: 'install-error', package: packageName, message: 'Runtime not ready' });
    return;
  }

  self.postMessage({ type: 'install-start', package: packageName });

  // Suppress raw stdout/stderr during install (tracebacks are noisy)
  const origPost = self.postOutputToMain;
  self.postOutputToMain = () => {};

  try {
    await pyodide.loadPackage('micropip');
    const micropip = pyodide.pyimport('micropip');
    await micropip.install(packageName);

    self.postOutputToMain = origPost;
    self.postMessage({ type: 'install-done', package: packageName });
  } catch (err) {
    self.postOutputToMain = origPost;
    let raw = err.message || String(err);
    let msg;

    // Match known error patterns → clean one-liner
    if (raw.includes("Can't find a pure Python 3 wheel") || raw.includes('Unsupported content type')) {
      msg = `"${packageName}" is not available in Pyodide. Only pure Python packages can be installed.`;
    } else if (raw.includes('NETWORK') || raw.includes('fetch') || raw.includes('Failed to fetch')) {
      msg = `Network error — could not reach PyPI. Check your internet connection.`;
    } else if (raw.includes('No matching distribution') || raw.includes('not found')) {
      msg = `"${packageName}" was not found on PyPI. Check the package name.`;
    } else {
      // Extract just the last line (the actual error) from traceback
      const lines = raw.split('\n').filter(l => l.trim());
      const lastLine = lines[lines.length - 1] || raw;
      msg = lastLine.length > 120 ? lastLine.slice(0, 120) + '...' : lastLine;
    }

    self.postMessage({ type: 'install-error', package: packageName, message: msg });
  }
}

// ---- Message handler ----
self.onmessage = async (event) => {
  const { type, data } = event.data;

  switch (type) {
    case 'init':
      sharedBuffer = event.data.buffer;
      int32View = new Int32Array(sharedBuffer);
      uint8View = new Uint8Array(sharedBuffer);
      await initPyodide();
      break;

    case 'run':
      if (isRunning) {
        self.postMessage({ type: 'stderr', text: 'Already running. Stop first.\n' });
        return;
      }
      await runCode(event.data.code);
      break;

    case 'install':
      await installPackage(event.data.package);
      break;

    case 'kill':
      killFlag = true;
      if (sharedBuffer) {
        Atomics.store(int32View, 0, 2);
        Atomics.notify(int32View, 0, 1);
      }
      break;
  }
};
