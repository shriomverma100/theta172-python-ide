/**
 * Pixel FX layer (page side). Places a canvas for each effect and hands it
 * to the FX worker, which does all the drawing (src/fx/fx.worker.js).
 *
 * - Never blocks input: every canvas lives in a `pointer-events: none` layer.
 * - Never slows the editor: drawing happens off the main thread; the page
 *   only spends a fraction of a millisecond starting each effect. Both costs
 *   are measured (see `stats()` and FRAME_BUDGET_MS).
 * - Crisp at any Windows scaling: one art pixel is a whole number of device
 *   pixels, and sprites sit on the device-pixel grid.
 * - Off when the user switches it off, or when Windows "Animation effects"
 *   is off (prefers-reduced-motion). Transitions then complete instantly.
 *
 * Text is never drawn here: labels stay in the DOM so they stay sharp.
 */
import { EFFECTS } from './effects.js';
import { FRAME_BUDGET_MS } from './fx-runner.js';
// Built as one classic script (vite.config.js worker.format) and inlined as a
// blob: URL: a worker file loaded from file:// is blocked under COEP.
import FxWorker from './fx.worker.js?worker&inline';

export { FRAME_BUDGET_MS };
const MAX_ACTIVE = 4;

export class FxEngine {
  /**
   * @param {object} [opts]
   * @param {Window} [opts.win]
   * @param {{getItem: Function, setItem: Function}} [opts.storage]
   * @param {string} [opts.storageKey]
   * @param {() => Worker} [opts.createWorker]
   */
  constructor({ win = globalThis.window, storage = safeStorage(win), storageKey = 'theta-fx', createWorker = defaultWorker } = {}) {
    this.win = win;
    this.doc = win?.document;
    this.storage = storage;
    this.storageKey = storageKey;
    this.createWorker = createWorker;
    this.worker = null;
    this.layer = null;
    this.items = new Map(); // id -> { canvas, onCovered, resolve }
    this.nextId = 1;
    this.mainStats = { calls: 0, totalMs: 0, maxMs: 0, dropped: 0 };
    this._statsWaiters = [];
    this._listeners = new Set();

    this._userEnabled = storage?.getItem(storageKey) !== 'off';
    const mq = win?.matchMedia?.('(prefers-reduced-motion: reduce)');
    this._reducedMotion = !!mq?.matches;
    mq?.addEventListener?.('change', (e) => {
      this._reducedMotion = e.matches;
      if (!this.enabled) this.clear();
      this._emit();
    });
  }

  /** True when effects will actually play. */
  get enabled() { return this._userEnabled && !this._reducedMotion && this.supported; }
  get userEnabled() { return this._userEnabled; }
  get reducedMotion() { return this._reducedMotion; }
  get supported() {
    return typeof this.win?.Worker === 'function'
      && typeof this.win?.HTMLCanvasElement?.prototype?.transferControlToOffscreen === 'function';
  }
  get activeCount() { return this.items.size; }

  setUserEnabled(on) {
    this._userEnabled = !!on;
    try { this.storage?.setItem(this.storageKey, on ? 'on' : 'off'); } catch (_) { /* storage blocked */ }
    if (!this.enabled) this.clear();
    this._emit();
  }

  /** @param {(engine: FxEngine) => void} fn  @returns {() => void} unsubscribe */
  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit() { this._listeners.forEach((fn) => fn(this)); }

  _ensureWorker() {
    if (this.worker) return this.worker;
    const t0 = this.win.performance.now();
    this.worker = this.createWorker();
    this.workerStartMs = this.win.performance.now() - t0; // one-time, reported separately
    this.worker.onmessage = ({ data: msg }) => this._onMessage(msg);
    this.worker.onerror = (e) => {
      console.error('[THETA fx] worker failed, pixel effects off for this session', e.message);
      this._userEnabled = false;
      this.clear();
      this._emit();
    };
    return this.worker;
  }

  _ensureLayer() {
    if (this.layer?.isConnected) return this.layer;
    const layer = this.doc.createElement('div');
    layer.className = 'fx-layer';
    layer.setAttribute('aria-hidden', 'true');
    this.doc.body.appendChild(layer);
    this.layer = layer;
    return layer;
  }

  _onMessage(msg) {
    const item = this.items.get(msg.id);
    if (msg.type === 'covered') item?.onCovered?.();
    else if (msg.type === 'done' && item) this._finish(msg.id, true);
    else if (msg.type === 'stats') this._statsWaiters.splice(0).forEach((r) => r(msg.stats));
  }

  _finish(id, played) {
    const item = this.items.get(id);
    if (!item) return;
    this.items.delete(id);
    item.canvas.remove();
    item.onCovered?.(); // a transition must always swap the screen
    item.resolve?.(played);
  }

  _measure(t0) {
    const ms = this.win.performance.now() - t0;
    const s = this.mainStats;
    s.calls++;
    s.totalMs += ms;
    s.maxMs = Math.max(s.maxMs, ms);
  }

  _send(id, effect, canvas, extra) {
    const offscreen = canvas.transferControlToOffscreen();
    this._ensureWorker().postMessage({ type: 'play', id, effect, canvas: offscreen, ...extra }, [offscreen]);
  }

  /**
   * Play an effect at a point on screen.
   * @param {string} effect  name in EFFECTS
   * @param {object} [o]
   * @param {Element} [o.at]  centre the effect on this element
   * @param {number} [o.x] @param {number} [o.y]  viewport CSS px (if no `at`)
   * @param {'origin'|'center'} [o.align]  which point of the effect sits there
   * @param {number} [o.scale]  CSS px per art pixel at 100% scaling
   * @param {number} [o.speed]
   * @param {object} [o.options]  effect options (palette, seed, ...)
   * @returns {{stop: Function, cancel: Function} | null}
   */
  play(effect, { at, x = 0, y = 0, align = 'center', scale = 2, speed = 1, options = {} } = {}) {
    const mod = EFFECTS[effect];
    if (!this.enabled || !mod?.meta || !this.doc || this.doc.hidden) return null;
    if (this.items.size >= MAX_ACTIVE) {
      this.mainStats.dropped++;
      return null;
    }
    this._ensureWorker();
    if (at) {
      // Reading layout may flush pending style work the frame needs anyway,
      // so it is not counted as effect cost.
      const r = at.getBoundingClientRect();
      x = r.left + r.width / 2;
      y = r.top + r.height / 2;
    }
    const t0 = this.win.performance.now();

    const [w, h] = mod.meta.size;
    const [ox, oy] = mod.meta.origin ?? [w / 2, h / 2];
    const dpr = this.win.devicePixelRatio || 1;
    const cssPx = Math.max(1, Math.round(scale * dpr)) / dpr; // whole device pixels per art pixel
    const ax = align === 'origin' ? ox : w / 2;
    const ay = align === 'origin' ? oy : h / 2;
    const snap = (v) => Math.round(v * dpr) / dpr;

    const canvas = this.doc.createElement('canvas');
    canvas.className = 'fx-sprite';
    canvas.width = w;
    canvas.height = h;
    Object.assign(canvas.style, {
      left: `${snap(x - ax * cssPx)}px`,
      top: `${snap(y - ay * cssPx)}px`,
      width: `${w * cssPx}px`,
      height: `${h * cssPx}px`,
    });
    this._ensureLayer().appendChild(canvas);

    const id = this.nextId++;
    this.items.set(id, { canvas });
    this._send(id, effect, canvas, { options, speed });
    this._measure(t0);

    return {
      stop: () => this.worker?.postMessage({ type: 'stop', id }),
      cancel: () => {
        this.worker?.postMessage({ type: 'cancel', id });
        this._finish(id, false);
      },
    };
  }

  /**
   * Full-screen pixel transition. `onCovered` runs once the screen is hidden,
   * which is when the caller should swap what is underneath. With effects
   * off it runs `onCovered` straight away.
   * @param {string} effect  a pixelfx transition (320 x 180)
   * @param {object} [o]
   * @param {() => void} [o.onCovered]
   * @param {boolean} [o.startCovered]  begin fully covered and only reveal
   * @param {number} [o.speed]
   * @param {object} [o.options]
   * @returns {Promise<boolean>} resolves when finished (false if skipped)
   */
  transition(effect, { onCovered, startCovered = false, speed = 1, options = {} } = {}) {
    let covered = false;
    const cover = () => {
      if (covered) return;
      covered = true;
      try { onCovered?.(); } catch (err) { console.error('[THETA fx] transition callback failed', err); }
    };

    const mod = EFFECTS[effect];
    if (!this.enabled || !mod?.meta || !this.doc) {
      cover();
      return Promise.resolve(false);
    }
    this._ensureWorker();
    const t0 = this.win.performance.now();
    const [w, h] = mod.meta.size;
    const canvas = this.doc.createElement('canvas');
    canvas.className = 'fx-screen';
    canvas.width = w;
    canvas.height = h;
    this._ensureLayer().appendChild(canvas);

    const id = this.nextId++;
    const done = new Promise((resolve) => this.items.set(id, { canvas, onCovered: cover, resolve }));
    this._send(id, effect, canvas, { options, speed, transition: true, startCovered });
    this._measure(t0);
    return done;
  }

  /** Stop everything now (pending transitions still run their callbacks). */
  clear() {
    this.worker?.postMessage({ type: 'clear' });
    for (const id of [...this.items.keys()]) this._finish(id, false);
  }

  /** Cost report: page time per effect start, worker time per drawn frame. */
  async stats() {
    const main = { ...this.mainStats, avgMs: this.mainStats.calls ? this.mainStats.totalMs / this.mainStats.calls : 0 };
    this.mainStats = { calls: 0, totalMs: 0, maxMs: 0, dropped: 0 };
    if (!this.worker) return { main, worker: null, workerStartMs: 0 };
    const worker = await new Promise((resolve) => {
      this._statsWaiters.push(resolve);
      this.worker.postMessage({ type: 'stats' });
      setTimeout(() => resolve(null), 1000);
    });
    return { main, worker, workerStartMs: this.workerStartMs };
  }
}

function defaultWorker() {
  return new FxWorker({ name: 'theta-fx' });
}

function safeStorage(win) {
  try { return win?.localStorage ?? null; } catch (_) { return null; }
}
