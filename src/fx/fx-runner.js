/**
 * The pixel FX frame loop, without any DOM. Runs inside the FX worker
 * (src/fx/fx.worker.js) and in unit tests.
 *
 * Each item is one pixelfx effect drawn into its own canvas context.
 * An item is only redrawn when the effect's own frame changes (pixelfx
 * effects are authored at 30 fps), and the cost of every drawn frame is
 * measured against FRAME_BUDGET_MS.
 */
import { createFrame, clearFrame, createFx, composite } from 'pixelfx';

/** Main-thread budget. Tests hold the effect code itself to this in Node. */
export const FRAME_BUDGET_MS = 2;
const COVER_AT = 0.45; // pixelfx screen transitions cover the screen at ~45%

export class FxRunner {
  /**
   * @param {object} deps
   * @param {Record<string, object>} deps.effects  name -> pixelfx module
   * @param {() => number} deps.now  milliseconds
   * @param {(msg: object) => void} deps.post  events back to the page
   */
  constructor({ effects, now, post }) {
    this.effects = effects;
    this.now = now;
    this.post = post;
    this.items = new Map();
    this.stats = newStats();
  }

  /**
   * @param {object} o
   * @param {number} o.id
   * @param {string} o.effect  key in `effects`
   * @param {CanvasRenderingContext2D} o.ctx
   * @param {object} [o.options]
   * @param {number} [o.speed]
   * @param {boolean} [o.transition]  report `covered` at the cover point
   * @param {boolean} [o.startCovered]  skip ahead to the covered frame
   */
  add({ id, effect, ctx, options = {}, speed = 1, transition = false, startCovered = false }) {
    const mod = this.effects[effect];
    if (!mod?.meta || !ctx) {
      this.post({ type: 'done', id });
      return false;
    }
    const [w, h] = mod.meta.size;
    const [ox, oy] = transition ? [0, 0] : (mod.meta.origin ?? [w / 2, h / 2]);
    const item = {
      id,
      inst: createFx(mod, { ...options, x: ox, y: oy }),
      frame: createFrame(w, h),
      img: typeof ImageData === 'function' ? new ImageData(w, h) : { data: new Uint8ClampedArray(w * h * 4), width: w, height: h },
      ctx,
      speed,
      fps: mod.meta.fps || 30,
      shown: -1,
      coverAt: transition ? (mod.meta.duration ?? 1) * COVER_AT : Infinity,
      covered: false,
    };
    if (startCovered && transition) item.inst.update(item.coverAt);
    this.items.set(id, item);
    this.stats.played++;
    this._render(item);
    // Report covered only after the covering frame is drawn
    if (startCovered && transition) this._cover(item);
    return true;
  }

  stop(id) { this.items.get(id)?.inst.stop(); }

  cancel(id) {
    const item = this.items.get(id);
    if (item) this._finish(item);
  }

  clear() { for (const item of [...this.items.values()]) this._finish(item); }

  get size() { return this.items.size; }

  /** Advance every effect by `dt` seconds and redraw those whose frame changed. */
  tick(dt) {
    const t0 = this.now();
    let drew = false;
    for (const item of [...this.items.values()]) {
      item.inst.update(dt * item.speed);
      if (item.inst.t >= item.coverAt) this._cover(item);
      if (item.inst.done()) {
        this._finish(item);
        continue;
      }
      if (Math.floor(item.inst.t * item.fps) !== item.shown) {
        this._render(item);
        drew = true;
      }
    }
    if (drew) this._measure(this.now() - t0);
    return this.items.size > 0;
  }

  _render(item) {
    item.shown = Math.floor(item.inst.t * item.fps);
    clearFrame(item.frame);
    item.inst.draw(item.frame);
    composite(item.frame, item.img.data, null);
    item.ctx.putImageData(item.img, 0, 0);
  }

  _cover(item) {
    if (item.covered) return;
    item.covered = true;
    this.post({ type: 'covered', id: item.id });
  }

  _finish(item) {
    this.items.delete(item.id);
    if (item.coverAt !== Infinity) this._cover(item);
    this.post({ type: 'done', id: item.id });
  }

  _measure(ms) {
    const s = this.stats;
    s.frames++;
    s.totalMs += ms;
    s.maxMs = Math.max(s.maxMs, ms);
    if (ms > FRAME_BUDGET_MS) s.overBudget++;
  }

  takeStats() {
    const s = this.stats;
    this.stats = newStats();
    return { ...s, avgMs: s.frames ? s.totalMs / s.frames : 0 };
  }
}

function newStats() {
  return { frames: 0, totalMs: 0, maxMs: 0, overBudget: 0, played: 0 };
}
