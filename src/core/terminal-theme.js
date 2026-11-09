/**
 * Terminal colours for both xterm terminals (program output and REPL),
 * one set per app theme. ANSI colours stay distinct so programs that print
 * in colour still read well; every one reaches 4.5:1 on its background
 * (tests/contrast.test.js).
 */
const ANSI = {
  red: '#FF7A68',
  green: '#7BD88F',
  yellow: '#F2C14E',
  blue: '#7FB2FF',
  magenta: '#D69CF5',
  cyan: '#6FD6E8',
  white: '#DADADA',
  brightBlack: '#9A96BD',
  brightRed: '#FF9A88',
  brightGreen: '#A6EBB3',
  brightYellow: '#FFDA85',
  brightBlue: '#A9CBFF',
  brightMagenta: '#E6BEFA',
  brightCyan: '#A1E8F3',
  brightWhite: '#FFFFFF',
};

export const XTERM_THEMES = {
  // Playground: the dark well inside the lime output tile
  playground: {
    ...ANSI,
    background: '#17142E',
    foreground: '#ECEAFF',
    cursor: '#C6F24E',
    cursorAccent: '#17142E',
    selectionBackground: 'rgba(198, 242, 78, 0.3)',
    black: '#17142E',
    scrollbarSliderBackground: 'rgba(236, 234, 255, 0.16)',
    scrollbarSliderHoverBackground: 'rgba(236, 234, 255, 0.28)',
    scrollbarSliderActiveBackground: 'rgba(198, 242, 78, 0.5)',
  },
  // Pro: the graphite bottom panel
  pro: {
    ...ANSI,
    brightBlack: '#9A9EA8',
    background: '#15161A',
    foreground: '#E7E8EB',
    cursor: '#FF4A36',
    cursorAccent: '#15161A',
    selectionBackground: 'rgba(110, 168, 254, 0.3)',
    black: '#15161A',
    scrollbarSliderBackground: 'rgba(231, 232, 235, 0.14)',
    scrollbarSliderHoverBackground: 'rgba(231, 232, 235, 0.24)',
    scrollbarSliderActiveBackground: 'rgba(110, 168, 254, 0.5)',
  },
};

/** The xterm theme for the app theme that is active right now. */
export function xtermTheme(name = currentAppTheme()) {
  return XTERM_THEMES[name] || XTERM_THEMES.playground;
}

function currentAppTheme() {
  return globalThis.document?.documentElement?.dataset?.theme === 'pro' ? 'pro' : 'playground';
}

export const XTERM_FONT = '"JetBrains Mono", Consolas, monospace';
