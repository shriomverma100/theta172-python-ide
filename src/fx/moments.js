/**
 * The app's pixel moments. Each one is optional decoration: when effects are
 * off (setting or Windows "Animation effects"), every function still does its
 * real job (a transition still swaps the screen), just without the
 * animation. Status text is always shown in the DOM by the caller.
 */
import { FxEngine } from './engine.js';

/** Blackout red, dark to light, as an 8-step pixelfx ramp. */
export const THETA_RAMP = ['#0b0303', '#2a0907', '#5c120c', '#962013', '#d8331f', '#ff4a36', '#ff9a88', '#ffffff'];

export const fx = new FxEngine();

/** App start / runtime loading: a spinning core while Python starts. */
export function startLoadingLoop(anchor) {
  return fx.play('arcane-orb', { at: anchor, scale: 2, options: { palette: THETA_RAMP } });
}

/** Run finished without errors: a ring of sparks at the run timer. */
export function runSucceeded(anchor) {
  fx.play('collect-burst', { at: anchor, scale: 2, speed: 1.15, options: { palette: THETA_RAMP } });
}

/** Run raised an error: a short spark hit. */
export function runFailed(anchor) {
  fx.play('hit-spark', { at: anchor, scale: 2, options: { palette: THETA_RAMP } });
}

// Blinds: about 1 ms a frame in Node. (pixel-dissolve looked good but cost ~3 ms.)
const WIPE = { palette: THETA_RAMP, color: '#000000' };

/** Close pixel blinds over the screen, swap the view underneath, open them. */
export function screenTransition(onCovered) {
  return fx.transition('blinds', { onCovered, speed: 2, options: WIPE });
}

/** Start-up screen leaving: start fully covered and open onto the IDE. */
export function revealApp(onCovered) {
  return fx.transition('blinds', { onCovered, startCovered: true, speed: 1.6, options: WIPE });
}
