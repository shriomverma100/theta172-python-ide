/**
 * THETA172 — Study mode window placement (main process).
 *
 * Students often watch a lecture next to the editor. Study mode places the
 * window on one side of the screen (the lecture takes the other side):
 *   duo     – keep the window where it is (layout change only)
 *   half    – 1/2 of the screen width, full height
 *   third   – 1/3, full height
 *   quarter – 1/4, full height
 *   mini    – a small always-on-top window in a corner
 * Leaving study mode puts the window back where it was.
 * The renderer is told the window's shape so it can suggest study mode
 * when the user narrows or snaps the window themselves.
 */

'use strict';

const MODES = new Set(['duo', 'half', 'third', 'quarter', 'mini']);
const STUDY_MIN = { width: 380, height: 420 };
const NORMAL_MIN = { width: 800, height: 540 };

/**
 * Where the window goes for a mode.
 * @param {string} mode
 * @param {'left'|'right'} side  the side the APP goes on (the lecture takes the other)
 * @param {{x:number,y:number,width:number,height:number}} area  the display's work area
 * @returns {{x:number,y:number,width:number,height:number}|null}  null: don't move
 */
function studyBounds(mode, side, area) {
  if (!MODES.has(mode) || mode === 'duo') return null;
  const right = side === 'right';
  if (mode === 'mini') {
    const width = Math.min(480, Math.round(area.width * 0.36));
    const height = Math.min(660, Math.round(area.height * 0.72));
    const margin = 16;
    return {
      x: right ? area.x + area.width - width - margin : area.x + margin,
      y: area.y + area.height - height - margin,
      width,
      height,
    };
  }
  const fraction = { half: 1 / 2, third: 1 / 3, quarter: 1 / 4 }[mode];
  const width = Math.max(STUDY_MIN.width, Math.round(area.width * fraction));
  return { x: right ? area.x + area.width - width : area.x, y: area.y, width, height: area.height };
}

/**
 * How the window sits on its screen.
 * sideBySide: about half the width or less and nearly full height — the shape
 * of a window snapped next to another one.
 */
function windowShape(bounds, area, maximized = false) {
  const fraction = bounds.width / area.width;
  const tall = bounds.height >= area.height * 0.8;
  return {
    width: bounds.width,
    height: bounds.height,
    fraction: Math.round(fraction * 100) / 100,
    maximized,
    sideBySide: !maximized && tall && fraction <= 0.62,
    side: bounds.x + bounds.width / 2 < area.x + area.width / 2 ? 'left' : 'right',
  };
}

function registerStudyWindow({ ipcMain, screen, getWindow }) {
  let saved = null; // bounds (and maximized) from before study mode
  let timer = null;

  const area = (win) => screen.getDisplayMatching(win.getBounds()).workArea;
  const send = (ch, payload) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(ch, payload);
  };
  const report = () => {
    const win = getWindow();
    if (!win || win.isDestroyed() || win.isMinimized()) return;
    send('window-shape', windowShape(win.getBounds(), area(win), win.isMaximized() || win.isFullScreen()));
  };

  /** Watch the window: tell the renderer its shape after the user resizes or snaps it. */
  function attach(win) {
    const later = () => { clearTimeout(timer); timer = setTimeout(report, 250); };
    for (const ev of ['resize', 'move', 'maximize', 'unmaximize', 'restore']) win.on(ev, later);
  }

  ipcMain.handle('window-shape', () => {
    const win = getWindow();
    return win ? windowShape(win.getBounds(), area(win), win.isMaximized()) : null;
  });

  ipcMain.handle('study-place', (_e, mode, side) => {
    const win = getWindow();
    if (!win || !MODES.has(mode)) return null;
    if (!saved) saved = { bounds: win.getBounds(), maximized: win.isMaximized() };
    win.setMinimumSize(STUDY_MIN.width, STUDY_MIN.height);
    win.setAlwaysOnTop(mode === 'mini', 'floating');
    const target = studyBounds(mode, side === 'left' ? 'left' : 'right', area(win));
    if (target) {
      if (win.isMaximized()) win.unmaximize();
      if (win.isFullScreen()) win.setFullScreen(false);
      win.setBounds(target, true);
    }
    return { bounds: win.getBounds() };
  });

  ipcMain.handle('study-exit', () => {
    const win = getWindow();
    if (!win) return null;
    win.setAlwaysOnTop(false);
    if (saved) {
      win.setBounds(saved.bounds, true);
      if (saved.maximized) win.maximize();
    }
    saved = null;
    win.setMinimumSize(NORMAL_MIN.width, NORMAL_MIN.height);
    return { bounds: win.getBounds() };
  });

  return { attach };
}

module.exports = { registerStudyWindow, studyBounds, windowShape, MODES };
