/**
 * Every text colour must be readable in BOTH themes: WCAG AA contrast
 * (4.5:1 for text, 3:1 for outlines that mark a control). Checks the theme
 * tokens, the editor's code colours and the terminal colours.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { XTERM_THEMES } from '../src/core/terminal-theme.js';

const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
const editorSrc = readFileSync(new URL('../src/editor.js', import.meta.url), 'utf8');

/** The token block for one theme (falls back to the shared :root block). */
function themeBlock(theme) {
  const start = css.indexOf(`:root[data-theme="${theme}"] {`);
  if (start < 0) throw new Error(`no block for ${theme}`);
  return css.slice(start, css.indexOf('\n}', start));
}
const shared = css.slice(css.indexOf(':root {'), css.indexOf('\n}', css.indexOf(':root {')));

function token(theme, name) {
  const re = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`);
  const m = themeBlock(theme).match(re) || shared.match(re);
  if (!m) throw new Error(`token --${name} not found for ${theme}`);
  return m[1];
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Colours used in one HighlightStyle block of src/editor.js */
function highlightColours(name) {
  const start = editorSrc.indexOf(`const ${name} = HighlightStyle.define([`);
  if (start < 0) throw new Error(`no highlight style ${name}`);
  const block = editorSrc.slice(start, editorSrc.indexOf(']);', start));
  return [...block.matchAll(/color: '(#[0-9A-Fa-f]{6})'/g)].map((m) => m[1]);
}

/** The bg and gutter colours passed to one blackoutTheme({...}) call */
function editorPalette(name) {
  const start = editorSrc.indexOf(`const ${name} = blackoutTheme({`);
  if (start < 0) throw new Error(`no editor palette ${name}`);
  const block = editorSrc.slice(start, editorSrc.indexOf('}, ', start));
  const get = (k) => block.match(new RegExp(`${k}: '(#[0-9A-Fa-f]{6})'`))[1];
  return { bg: get('bg'), text: get('text'), gutter: get('gutter') };
}

for (const theme of ['playground', 'pro']) {
  describe(`${theme} theme tokens`, () => {
    const texts = ['text', 'text-2', 'text-3', 'text-4', 'accent-text', 'ok-text', 'warn-text'];
    const grounds = ['bg', 'surface-1', 'surface-3'];
    for (const t of texts) {
      for (const g of grounds) {
        it(`--${t} is readable on --${g}`, () => {
          expect(contrast(token(theme, t), token(theme, g))).toBeGreaterThanOrEqual(4.5);
        });
      }
    }

    it('text on the dark panels (editor, terminal) is readable', () => {
      expect(contrast(token(theme, 'panel-text'), token(theme, 'panel'))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token(theme, 'panel-text-2'), token(theme, 'panel'))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token(theme, 'panel-text-2'), token(theme, 'panel-2'))).toBeGreaterThanOrEqual(4.5);
    });

    it('button and input outlines stand out (3:1)', () => {
      expect(contrast(token(theme, 'line-strong'), token(theme, 'surface-1'))).toBeGreaterThanOrEqual(3);
    });

    it('text on the red Run button is readable', () => {
      expect(contrast(token(theme, 'on-red'), token(theme, 'red'))).toBeGreaterThanOrEqual(4.5);
    });

    it('the focus ring is visible (3:1)', () => {
      expect(contrast(token(theme, 'focus'), token(theme, 'bg'))).toBeGreaterThanOrEqual(3);
    });
  });
}

describe('bright tiles (Playground)', () => {
  it('ink text is readable on every accent fill', () => {
    for (const fill of ['red', 'lime', 'lilac', 'sky', 'yellow', 'pink']) {
      expect(contrast(token('playground', 'ink'), token('playground', fill)), fill).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('editor code colours', () => {
  for (const [palette, highlight] of [['playgroundDark', 'playgroundHighlight'], ['proDark', 'proHighlight']]) {
    it(`${palette}: text, line numbers and every syntax colour are readable`, () => {
      const p = editorPalette(palette);
      expect(contrast(p.text, p.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.gutter, p.bg)).toBeGreaterThanOrEqual(4.5);
      const colours = highlightColours(highlight);
      expect(colours.length).toBeGreaterThan(8);
      for (const c of colours) expect(contrast(c, p.bg), c).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('light palette (projectors) colours are readable on white', () => {
    const colours = highlightColours('theta172LightHighlight');
    expect(colours.length).toBeGreaterThan(8);
    for (const c of colours) expect(contrast(c, '#FFFFFF'), c).toBeGreaterThanOrEqual(4.5);
  });
});

describe('terminal colours', () => {
  for (const [theme, t] of Object.entries(XTERM_THEMES)) {
    it(`${theme}: every ANSI text colour is readable on the terminal background`, () => {
      const skip = new Set(['background', 'black', 'cursorAccent']);
      for (const [name, value] of Object.entries(t)) {
        if (skip.has(name) || !/^#[0-9A-Fa-f]{6}$/.test(value)) continue;
        expect(contrast(value, t.background), `${theme}.${name}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});
