/**
 * Fonts are bundled with the app (no Google Fonts request), so text looks
 * the same offline and in school labs that block font CDNs.
 * All families are SIL Open Font License.
 *   Inter          interface text (both themes)
 *   Unbounded      Playground headings and the wordmark
 *   JetBrains Mono code
 */
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/unbounded/300.css';
import '@fontsource/unbounded/400.css';
import '@fontsource/unbounded/600.css';
import '@fontsource/unbounded/800.css';
// The THETA172 brand (welcome, updating screen): Hanken Grotesk text, Silkscreen pixel labels
import '@fontsource/hanken-grotesk/400.css';
import '@fontsource/hanken-grotesk/500.css';
import '@fontsource/hanken-grotesk/600.css';
import '@fontsource/silkscreen/400.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/400-italic.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/jetbrains-mono/700.css';

const REQUIRED = [
  '400 14px "Inter"',
  '700 14px "Inter"',
  '800 14px "Unbounded"',
  '400 14px "JetBrains Mono"',
  '600 14px "JetBrains Mono"',
];

/**
 * Resolve once the fonts that affect layout are loaded, or after
 * `timeoutMs` at the latest. xterm measures its cell size when it opens,
 * so the terminal must wait for JetBrains Mono or its columns drift.
 */
export function fontsReady(timeoutMs = 2000) {
  if (!document.fonts?.load) return Promise.resolve();
  const loads = Promise.all(REQUIRED.map((f) => document.fonts.load(f).catch(() => null)));
  const timeout = new Promise((resolve) => setTimeout(resolve, timeoutMs));
  return Promise.race([loads, timeout]);
}
