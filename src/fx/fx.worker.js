/**
 * Pixel FX worker: draws every effect on OffscreenCanvases, so effects
 * never take time from typing, scrolling or the terminal on the main thread.
 *
 * Messages in:  play {id, effect, canvas, options, speed, transition, startCovered}
 *               stop {id} · cancel {id} · clear · stats
 * Messages out: covered {id} · done {id} · stats {...}
 */
import { FxRunner } from './fx-runner.js';
import { EFFECTS } from './effects.js';

const runner = new FxRunner({
  effects: EFFECTS,
  now: () => performance.now(),
  post: (msg) => self.postMessage(msg),
});

const raf = self.requestAnimationFrame?.bind(self) ?? ((fn) => setTimeout(() => fn(performance.now()), 16));
let running = false;
let last = 0;

function loop(now) {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  running = runner.tick(dt);
  if (running) raf(loop);
}

function ensureLoop() {
  if (running) return;
  running = true;
  last = performance.now();
  raf(loop);
}

self.onmessage = ({ data: msg }) => {
  switch (msg.type) {
    case 'play': {
      const ctx = msg.canvas.getContext('2d');
      if (runner.add({ ...msg, ctx })) ensureLoop();
      break;
    }
    case 'stop': runner.stop(msg.id); break;
    case 'cancel': runner.cancel(msg.id); break;
    case 'clear': runner.clear(); break;
    case 'stats': self.postMessage({ type: 'stats', stats: runner.takeStats() }); break;
    default: break;
  }
};
