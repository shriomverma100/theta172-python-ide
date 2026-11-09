import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { studyBounds, windowShape } = require('../electron/study-window.cjs');

const screen = { x: 0, y: 0, width: 1920, height: 1040 }; // a 1080p screen minus the taskbar

describe('Study mode window placement', () => {
  it('puts the app on half, a third or a quarter of the screen, on the chosen side', () => {
    expect(studyBounds('half', 'right', screen)).toEqual({ x: 960, y: 0, width: 960, height: 1040 });
    expect(studyBounds('half', 'left', screen)).toEqual({ x: 0, y: 0, width: 960, height: 1040 });
    expect(studyBounds('third', 'right', screen)).toEqual({ x: 1280, y: 0, width: 640, height: 1040 });
    expect(studyBounds('quarter', 'left', screen)).toEqual({ x: 0, y: 0, width: 480, height: 1040 });
  });

  it('never makes the window narrower than the study minimum', () => {
    const small = { x: 0, y: 0, width: 1366, height: 728 };
    expect(studyBounds('quarter', 'right', small).width).toBe(380);
    expect(studyBounds('quarter', 'right', small).x).toBe(1366 - 380);
  });

  it('floats Mini in a bottom corner', () => {
    const b = studyBounds('mini', 'right', screen);
    expect(b.width).toBeLessThanOrEqual(480);
    expect(b.x + b.width).toBe(1920 - 16);
    expect(b.y + b.height).toBe(1040 - 16);
  });

  it('respects a second monitor’s position', () => {
    const second = { x: 1920, y: 0, width: 2560, height: 1400 };
    expect(studyBounds('half', 'left', second)).toMatchObject({ x: 1920, width: 1280 });
  });

  it('keeps Duo where it is and ignores unknown modes', () => {
    expect(studyBounds('duo', 'right', screen)).toBeNull();
    expect(studyBounds('wide', 'right', screen)).toBeNull();
  });
});

describe('Spotting a window put side by side', () => {
  it('sees a snapped half or third as side by side, on the right side', () => {
    expect(windowShape({ x: 960, y: 0, width: 960, height: 1040 }, screen)).toMatchObject({ sideBySide: true, side: 'right', fraction: 0.5 });
    expect(windowShape({ x: 0, y: 0, width: 640, height: 1040 }, screen)).toMatchObject({ sideBySide: true, side: 'left' });
  });

  it('does not suggest study mode for a maximized, wide or short window', () => {
    expect(windowShape({ x: 0, y: 0, width: 1920, height: 1040 }, screen, true).sideBySide).toBe(false);
    expect(windowShape({ x: 100, y: 50, width: 1400, height: 900 }, screen).sideBySide).toBe(false);
    expect(windowShape({ x: 100, y: 50, width: 900, height: 500 }, screen).sideBySide).toBe(false);
  });
});
