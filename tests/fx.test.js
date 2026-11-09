// @vitest-environment jsdom
/**
 * Pixel FX: the worker frame loop (real pixelfx effects, fake canvas) and
 * the page-side engine (settings, reduced motion, transitions, cleanup).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FxRunner } from '../src/fx/fx-runner.js';
import { EFFECTS } from '../src/fx/effects.js';
import { FxEngine } from '../src/fx/engine.js';
import { THETA_RAMP } from '../src/fx/moments.js';

// ImageData exists in browsers and workers; the runner falls back without it.
const fakeCtx = () => ({ puts: 0, last: null, putImageData(img) { this.puts++; this.last = img; } });

function runner() {
  const posts = [];
  let clock = 0;
  const r = new FxRunner({ effects: EFFECTS, now: () => clock, post: (m) => posts.push(m) });
  return { r, posts, advance: (ms) => { clock += ms; } };
}

function runToEnd(r, dt = 1 / 60, limit = 2000) {
  let ticks = 0;
  while (r.tick(dt) && ticks < limit) ticks++;
  return ticks;
}

describe('FxRunner', () => {
  it('plays each app effect to the end and draws visible pixels', () => {
    for (const name of ['collect-burst', 'hit-spark']) {
      const { r, posts } = runner();
      const ctx = fakeCtx();
      r.add({ id: 1, effect: name, ctx, options: { palette: THETA_RAMP } });
      let lit = 0;
      for (let i = 0; i < 20; i++) r.tick(1 / 60);
      for (let i = 3; i < ctx.last.data.length; i += 4) if (ctx.last.data[i] > 0) lit++;
      expect(lit, name).toBeGreaterThan(0);
      runToEnd(r);
      expect(posts).toContainEqual({ type: 'done', id: 1 });
      expect(r.size).toBe(0);
    }
  });

  it('only redraws when the effect frame changes (30 fps on a 120 Hz screen)', () => {
    const { r } = runner();
    const ctx = fakeCtx();
    r.add({ id: 1, effect: 'arcane-orb', ctx, options: { palette: THETA_RAMP } });
    const before = ctx.puts;
    for (let i = 0; i < 120; i++) r.tick(1 / 120); // one second
    const drawn = ctx.puts - before;
    expect(drawn).toBeGreaterThanOrEqual(28);
    expect(drawn).toBeLessThanOrEqual(32);
  });

  it('a transition reports covered once, before done', () => {
    const { r, posts } = runner();
    r.add({ id: 7, effect: 'blinds', ctx: fakeCtx(), transition: true, options: { color: '#000000' } });
    runToEnd(r);
    const types = posts.filter((m) => m.id === 7).map((m) => m.type);
    expect(types).toEqual(['covered', 'done']);
  });

  it('startCovered draws the covering frame first, then reports covered', () => {
    const { r, posts } = runner();
    const ctx = fakeCtx();
    r.add({ id: 3, effect: 'blinds', ctx, transition: true, startCovered: true, options: { color: '#000000' } });
    expect(ctx.puts).toBe(1);
    expect(posts).toEqual([{ type: 'covered', id: 3 }]);
    // the first frame is (almost) fully opaque black
    let opaque = 0;
    for (let i = 3; i < ctx.last.data.length; i += 4) if (ctx.last.data[i] === 255) opaque++;
    expect(opaque / (ctx.last.data.length / 4)).toBeGreaterThan(0.95);
  });

  it('cancelling a transition still reports covered (the screen must swap)', () => {
    const { r, posts } = runner();
    r.add({ id: 9, effect: 'blinds', ctx: fakeCtx(), transition: true });
    r.cancel(9);
    expect(posts.map((m) => m.type)).toEqual(['covered', 'done']);
  });

  it('unknown effects finish immediately', () => {
    const { r, posts } = runner();
    expect(r.add({ id: 2, effect: 'nope', ctx: fakeCtx() })).toBe(false);
    expect(posts).toEqual([{ type: 'done', id: 2 }]);
  });

  it('counts frames over the 2 ms budget', () => {
    const { r, advance } = runner();
    r.add({ id: 1, effect: 'hit-spark', ctx: { putImageData() { advance(3); } } });
    for (let i = 0; i < 10; i++) r.tick(1 / 30);
    const s = r.takeStats();
    expect(s.frames).toBeGreaterThan(0);
    expect(s.overBudget).toBe(s.frames);
    expect(s.avgMs).toBeGreaterThan(2);
  });

  // Real cost of the effects the app plays, measured in Node. In the app
  // they run in a worker, off the main thread.
  it('each app effect draws a frame in under 2 ms on average', () => {
    for (const [name, opts] of [
      ['collect-burst', {}], ['hit-spark', {}], ['arcane-orb', {}], ['blinds', { transition: true }],
    ]) {
      let total = 0;
      let frames = 0;
      const r = new FxRunner({ effects: EFFECTS, now: () => performance.now(), post: () => {} });
      r.add({ id: 1, effect: name, ctx: fakeCtx(), options: { palette: THETA_RAMP }, ...opts });
      for (let i = 0; i < 90 && r.size; i++) r.tick(1 / 30); // warm-up and measure
      const s = r.takeStats();
      total += s.totalMs;
      frames += s.frames;
      expect(total / frames, name).toBeLessThan(2);
    }
  });
});

// ── Page side ─────────────────────────────────────────────────────
class FakeWorker {
  constructor() { this.sent = []; FakeWorker.last = this; }
  postMessage(msg) { this.sent.push(msg); }
  reply(msg) { this.onmessage?.({ data: msg }); }
}

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; }, data };
}

function makeEngine({ reduced = false, storage = memoryStorage() } = {}) {
  const listeners = [];
  const mq = { matches: reduced, addEventListener: (_t, fn) => listeners.push(fn) };
  window.matchMedia = () => mq;
  window.HTMLCanvasElement.prototype.transferControlToOffscreen = function () { return {}; };
  window.Worker = FakeWorker;
  const engine = new FxEngine({ win: window, storage, createWorker: () => new FakeWorker() });
  return { engine, storage, setReduced: (v) => { mq.matches = v; listeners.forEach((fn) => fn({ matches: v })); } };
}

describe('FxEngine', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('is on by default and remembers when the user turns it off', () => {
    const { engine, storage } = makeEngine();
    expect(engine.enabled).toBe(true);
    engine.setUserEnabled(false);
    expect(engine.enabled).toBe(false);
    expect(storage.data['theta-fx']).toBe('off');
    expect(makeEngine({ storage }).engine.enabled).toBe(false);
  });

  it('stays off while Windows animation effects are off', () => {
    const { engine, setReduced } = makeEngine({ reduced: true });
    expect(engine.enabled).toBe(false);
    expect(engine.play('hit-spark')).toBeNull();
    setReduced(false);
    expect(engine.enabled).toBe(true);
  });

  it('plays in the worker and removes the canvas when the worker is done', () => {
    const { engine } = makeEngine();
    const handle = engine.play('collect-burst', { x: 100, y: 100 });
    expect(handle).not.toBeNull();
    const msg = FakeWorker.last.sent[0];
    expect(msg).toMatchObject({ type: 'play', effect: 'collect-burst' });
    const canvas = document.querySelector('.fx-layer canvas');
    expect(canvas).not.toBeNull();
    expect(canvas.closest('.fx-layer').getAttribute('aria-hidden')).toBe('true');
    FakeWorker.last.reply({ type: 'done', id: msg.id });
    expect(document.querySelector('.fx-layer canvas')).toBeNull();
    expect(engine.activeCount).toBe(0);
  });

  it('places art pixels on whole device pixels at 125% scaling', () => {
    const { engine } = makeEngine();
    window.devicePixelRatio = 1.25;
    engine.play('hit-spark', { x: 101.3, y: 47.9, scale: 2 });
    const c = document.querySelector('.fx-layer canvas');
    const [w] = EFFECTS['hit-spark'].meta.size;
    // 2 css px * 1.25 = 2.5 -> rounded to 3 device px per art pixel
    expect(parseFloat(c.style.width) * 1.25).toBeCloseTo(w * 3, 5);
    expect((parseFloat(c.style.left) * 1.25) % 1).toBeCloseTo(0, 5);
    window.devicePixelRatio = 1;
  });

  it('transition: swaps the screen when covered, resolves when done', async () => {
    const { engine } = makeEngine();
    const onCovered = vi.fn();
    const done = engine.transition('blinds', { onCovered });
    const { id } = FakeWorker.last.sent[0];
    expect(onCovered).not.toHaveBeenCalled();
    FakeWorker.last.reply({ type: 'covered', id });
    expect(onCovered).toHaveBeenCalledTimes(1);
    FakeWorker.last.reply({ type: 'done', id });
    await expect(done).resolves.toBe(true);
    expect(onCovered).toHaveBeenCalledTimes(1);
  });

  it('transition with effects off swaps the screen straight away', async () => {
    const { engine } = makeEngine({ reduced: true });
    const onCovered = vi.fn();
    await expect(engine.transition('blinds', { onCovered })).resolves.toBe(false);
    expect(onCovered).toHaveBeenCalledTimes(1);
  });

  it('turning effects off mid-transition still swaps the screen', () => {
    const { engine } = makeEngine();
    const onCovered = vi.fn();
    engine.transition('blinds', { onCovered });
    engine.setUserEnabled(false);
    expect(onCovered).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.fx-layer canvas')).toBeNull();
  });

  it('turns itself off if the worker crashes', () => {
    const { engine } = makeEngine();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    engine.play('hit-spark');
    FakeWorker.last.onerror({ message: 'boom' });
    expect(engine.enabled).toBe(false);
    expect(engine.activeCount).toBe(0);
  });

  it('caps how many effects play at once', () => {
    const { engine } = makeEngine();
    const handles = Array.from({ length: 6 }, () => engine.play('hit-spark'));
    expect(handles.filter(Boolean)).toHaveLength(4);
  });
});
