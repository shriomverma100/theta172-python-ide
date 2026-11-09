// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  applyTheme, getTheme, hasChosenTheme, switchTheme, toggleTheme, onThemeChange, initThemeControls, showThemePicker,
} from '../src/app/theme.js';

// Node's experimental localStorage shadows jsdom's and is undefined without a
// backing file, so give the tests a simple in-memory store.
function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    clear: () => data.clear(),
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  document.documentElement.removeAttribute('data-theme');
  document.body.innerHTML = `
    <div class="theme-switch">
      <button data-theme-choice="playground"></button>
      <button data-theme-choice="pro"></button>
    </div>
    <div id="theme-picker" class="hidden">
      <button data-pick="playground"></button>
      <button data-pick="pro"></button>
    </div>`;
});

describe('themes', () => {
  it('defaults to Playground and has no saved choice on first launch', () => {
    expect(getTheme()).toBe('playground');
    expect(hasChosenTheme()).toBe(false);
  });

  it('applies, saves and reflects the theme on every switch button', () => {
    applyTheme('pro');
    expect(document.documentElement.dataset.theme).toBe('pro');
    expect(localStorage.getItem('theta-theme')).toBe('pro');
    expect(hasChosenTheme()).toBe(true);
    const pressed = [...document.querySelectorAll('[data-theme-choice]')].map((b) => b.getAttribute('aria-pressed'));
    expect(pressed).toEqual(['false', 'true']);
  });

  it('ignores unknown theme names', () => {
    expect(applyTheme('neon')).toBe('playground');
    expect(getTheme()).toBe('playground');
  });

  it('notifies listeners (editor and terminals recolour)', () => {
    const fn = vi.fn();
    const off = onThemeChange(fn);
    applyTheme('pro');
    expect(fn).toHaveBeenCalledWith('pro');
    off();
    applyTheme('playground');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('switches through the transition and does nothing when already active', () => {
    const transition = vi.fn((done) => done());
    switchTheme('playground', transition);
    expect(transition).not.toHaveBeenCalled();
    toggleTheme(transition);
    expect(transition).toHaveBeenCalledTimes(1);
    expect(getTheme()).toBe('pro');
  });

  it('any [data-theme-choice] button switches the theme', () => {
    initThemeControls((done) => done());
    document.querySelector('[data-theme-choice="pro"]').click();
    expect(getTheme()).toBe('pro');
  });

  it('first-launch picker applies the choice and reports it', async () => {
    vi.useFakeTimers();
    const onChosen = vi.fn();
    const result = showThemePicker({ onChosen });
    expect(document.getElementById('theme-picker').classList.contains('hidden')).toBe(false);
    document.querySelector('[data-pick="pro"]').click();
    expect(getTheme()).toBe('pro');
    expect(onChosen).toHaveBeenCalledWith('pro');
    vi.advanceTimersByTime(400);
    await expect(result).resolves.toBe('pro');
    expect(document.getElementById('theme-picker').classList.contains('hidden')).toBe(true);
    vi.useRealTimers();
  });
});
