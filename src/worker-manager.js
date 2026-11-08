/**
 * THETA172 — Worker Manager
 * 
 * Manages the Pyodide Web Worker lifecycle and the
 * SharedArrayBuffer I/O bridge between main thread and worker.
 */

const BUFFER_SIZE = 4096 + 8; // 8 bytes header + 4096 bytes data

export class WorkerManager {
  constructor() {
    this.worker = null;
    this.sharedBuffer = null;
    this.int32View = null;
    this.uint8View = null;
    this.isReady = false;
    this.isRunning = false;

    // Callbacks
    this.onReady = null;
    this.onStatus = null;
    this.onStdout = null;
    this.onStderr = null;
    this.onInputRequest = null;
    this.onDone = null;
    this.onError = null;
    this.onInterrupted = null;
    this.onInstallStart = null;
    this.onInstallDone = null;
    this.onInstallError = null;
    this.onLoadError = null;
  }

  init() {
    // SharedArrayBuffer requires COEP/COOP headers
    if (!window.SharedArrayBuffer) {
      console.error('SharedArrayBuffer not available. Check COEP/COOP headers.');
      return;
    }

    this.sharedBuffer = new SharedArrayBuffer(BUFFER_SIZE);
    this.int32View = new Int32Array(this.sharedBuffer);
    this.uint8View = new Uint8Array(this.sharedBuffer);

    this.worker = new Worker(
      new URL('./workers/pyodide.worker.js', import.meta.url),
      { type: 'classic' }
    );

    this.worker.onmessage = (event) => this._handleMessage(event);
    this.worker.onerror = (err) => {
      console.error('Worker error:', err);
      this.onError?.('Worker crashed: ' + err.message);
    };

    // Send buffer to worker
    this.worker.postMessage({ type: 'init', buffer: this.sharedBuffer });
  }

  _handleMessage(event) {
    const msg = event.data;

    switch (msg.type) {
      case 'ready':
        this.isReady = true;
        this.onReady?.();
        break;

      case 'status':
        this.onStatus?.(msg.text);
        break;

      case 'stdout':
        this.onStdout?.(msg.text);
        break;

      case 'stderr':
        this.onStderr?.(msg.text);
        break;

      case 'input-request':
        this.onInputRequest?.(msg.prompt);
        break;

      case 'done':
        this.isRunning = false;
        this.onDone?.(msg.duration);
        break;

      case 'error':
        this.isRunning = false;
        this.onError?.(msg.message, msg.duration);
        break;

      case 'interrupted':
        this.isRunning = false;
        this.onInterrupted?.();
        break;

      case 'install-start':
        this.onInstallStart?.(msg.package);
        break;

      case 'install-done':
        this.onInstallDone?.(msg.package);
        break;

      case 'install-error':
        this.onInstallError?.(msg.package, msg.message);
        break;

      case 'load-error':
        this.isReady = false;
        this.onLoadError?.(msg.message);
        break;
    }
  }

  /**
   * Run Python code in the worker.
   */
  run(code) {
    if (!this.isReady || this.isRunning) return;
    this.isRunning = true;

    // Reset signal byte
    Atomics.store(this.int32View, 0, 0);

    this.worker.postMessage({ type: 'run', code });
  }

  /**
   * Provide input to a waiting Python input() call.
   * Called when user presses Enter in the terminal.
   */
  provideInput(text) {
    if (!this.sharedBuffer) return;

    const encoded = new TextEncoder().encode(text);
    const len = Math.min(encoded.length, BUFFER_SIZE - 8);

    // Write length and data
    this.int32View[1] = len;
    this.uint8View.set(encoded.subarray(0, len), 8);

    // Signal worker: data is ready
    Atomics.store(this.int32View, 0, 1);
    Atomics.notify(this.int32View, 0, 1);
  }

  /**
   * Kill running execution.
   */
  kill() {
    if (!this.worker) return;
    this.worker.postMessage({ type: 'kill' });
    if (this.sharedBuffer) {
      Atomics.store(this.int32View, 0, 2);
      Atomics.notify(this.int32View, 0, 1);
    }
    this.isRunning = false;
  }

  /**
   * Install a package via micropip.
   */
  installPackage(name) {
    if (!this.isReady) return;
    this.worker.postMessage({ type: 'install', package: name });
  }
}
