/**
 * Python by THETA172 — renderer entry point.
 *
 * Wires the IDE modules together. Feature logic lives in src/app/*:
 *   state.js         shared state
 *   tabs.js          editor tabs
 *   files.js         open / save / import / drag-drop
 *   autosave.js      code stats + local auto-save
 *   runtime.js       local Python / Pyodide, run & stop
 *   layout.js        panes, split gutter, font size
 *   shortcuts.js     editable keyboard shortcuts
 *   commands.js      command palette
 *   modals.js        examples + shortcuts modals
 *   ai-fix.js        AI Fix (user's own Groq key)
 *   window-chrome.js window buttons + unsaved-changes flow
 *   context-menu.js  editor right-click menu
 *   a11y.js          accessibility wiring
 *   boot.js          start-up screen
 *   settings.js      settings dialog, pixel effects switch
 *   theme.js         Playground / Pro themes and the first-launch picker
 *
 * Pixel effects (pixelfx) live in src/fx/.
 */
import {
  createEditor, setAppTheme, layout as editorLayout, STARTER_CODE, getValue, setValue, focusEditor, getCursorPosition,
  onContentChange, onCursorChange, openFindReplace, getView,
} from './editor.js';
import { TerminalManager } from './terminal.js';
import { ReplManager } from './repl.js';
import { showToast } from './toast.js';
import { fontsReady } from './styles/fonts.js';
import { fx, startLoadingLoop, runSucceeded, runFailed, screenTransition } from './fx/moments.js';
import { handleThemeToggle, initTheme } from './theme-manager.js';
import { PipManager } from './pip-manager.js';
import {
  initClassroomPanel, openClassroomPanel, handleClassroomKeydown,
  broadcastCurrentCode, isTeacherLive, isStudentConnected, streamStudentCode,
} from './classroom/classroom.js';

import { $ } from './core/dom.js';
import { storageGet } from './core/storage.js';
import { xtermTheme } from './core/terminal-theme.js';
import { initThemeControls, onThemeChange, toggleTheme, hasChosenTheme, showThemePicker } from './app/theme.js';
import { state } from './app/state.js';
import { initTabs, addNewTab, getActiveFileName, hasUnsavedTabs, markActiveTabUnsaved } from './app/tabs.js';
import { saveToFile, saveAsFile, openFile, initFileInputs } from './app/files.js';
import { updateCodeStats, markUnsaved, scheduleAutoSave, saveCode } from './app/autosave.js';
import { initRuntime, runCode, stopCode } from './app/runtime.js';
import { startBoot, setBootStep } from './app/boot.js';
import { initSettings, openSettings, closeSettings, toggleFx } from './app/settings.js';
import { initPaneTabs, initGutter, clearOutput, adjustFontSize } from './app/layout.js';
import { initShortcuts } from './app/shortcuts.js';
import { initCommandPalette, toggleCommandPalette, openCommandPalette, isPaletteOpen, closeCommandPalette } from './app/commands.js';
import { initModals, openExamples, openShortcuts, closeAllModals } from './app/modals.js';
import { fixCode } from './app/ai-fix.js';
import { initWindowControls, initUnsavedHandling } from './app/window-chrome.js';
import { initContextMenu } from './app/context-menu.js';
import { initAccessibility } from './app/a11y.js';

// ── Global error reporting ───────────────────────────────────────
window.onerror = (message, source, line, col, error) => {
  console.error(`[THETA] Uncaught error: ${message} (${source}:${line}:${col})`, error);
  try { showToast(`Error: ${message}`, 'error', 4000); } catch (_) { /* toast itself failed */ }
  return true;
};

window.onunhandledrejection = (event) => {
  const msg = event.reason?.message || String(event.reason);
  console.error('[THETA] Unhandled rejection:', event.reason);
  try { showToast(`Error: ${msg}`, 'error', 4000); } catch (_) { /* ignore */ }
};

// ── Actions shared by buttons, shortcuts, palette and menus ──────
function copyCode() {
  navigator.clipboard.writeText(getValue())
    .then(() => showToast('Code copied to clipboard', 'success', 2000))
    .catch(() => showToast('Failed to copy', 'error', 2000));
}

/** Persist locally, then write the file; resolves true when saved. */
async function saveAll() {
  saveCode();
  return saveToFile();
}

const actions = {
  'run': runCode,
  'stop': stopCode,
  'clear': clearOutput,
  'copy': copyCode,
  'save': saveAll,
  'save-as': saveAsFile,
  'open-file': openFile,
  'new-tab': () => addNewTab(null, '# New file\n'),
  'find-replace': openFindReplace,
  'fix-code': fixCode,
  'font-inc': () => adjustFontSize(1),
  'font-dec': () => adjustFontSize(-1),
  'focus-editor': focusEditor,
  'focus-terminal': () => state.terminal?.focus(),
  'toggle-theme': handleThemeToggle,
  'toggle-fx': toggleFx,
  'switch-theme': () => toggleTheme(screenTransition),
  'settings': openSettings,
  'cmd-palette': toggleCommandPalette,
  'examples': openExamples,
  'reset-code': () => { setValue(STARTER_CODE); showToast('Code reset to starter template', 'info'); },
};

function handleEscape(e) {
  if (handleClassroomKeydown(e)) return;
  closeAllModals();
  closeSettings();
  if (isPaletteOpen()) closeCommandPalette();
}

function initButtons() {
  // Pro icon rail and the Playground class tile
  $('rail-editor')?.addEventListener('click', focusEditor);
  $('rail-classroom')?.addEventListener('click', () => openClassroomPanel());
  $('rail-examples')?.addEventListener('click', openExamples);
  $('rail-keys')?.addEventListener('click', openShortcuts);
  $('rail-settings')?.addEventListener('click', openSettings);
  $('btn-class-tile')?.addEventListener('click', () => openClassroomPanel());
  $('btn-run-rail')?.addEventListener('click', runCode);
  $('btn-run')?.addEventListener('click', runCode);
  $('btn-clear')?.addEventListener('click', clearOutput);
  $('btn-copy-code')?.addEventListener('click', copyCode);
  $('btn-fix-indent')?.addEventListener('click', fixCode);
  $('btn-save-file')?.addEventListener('click', saveAll);
  $('btn-import-file')?.addEventListener('click', openFile);
  $('btn-font-inc')?.addEventListener('click', () => adjustFontSize(1));
  $('btn-font-dec')?.addEventListener('click', () => adjustFontSize(-1));
  $('btn-palette')?.addEventListener('click', openCommandPalette);
  $('btn-classroom')?.addEventListener('click', () => openClassroomPanel());
  $('btn-new-tab')?.addEventListener('click', () => addNewTab(null, '# New file\n'));
}

// ── Editor change pipeline ───────────────────────────────────────
function initEditorEvents() {
  onCursorChange((pos) => {
    const $pos = $('cursor-pos');
    if ($pos) $pos.textContent = `Ln ${pos.lineNumber} · Col ${pos.column}`;
    if (isTeacherLive()) window.electronAPI?.classroomBroadcastCursor?.(pos.lineNumber, pos.column);
  });

  // Debounced so live classroom sessions don't flood on every keystroke
  let debounce = null;
  onContentChange(() => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      if (isTeacherLive()) broadcastCurrentCode();
      if (isStudentConnected()) streamStudentCode();
      updateCodeStats();
      markUnsaved();
      markActiveTabUnsaved();
      scheduleAutoSave();
    }, 60);
  });
}

function initClassroom() {
  initClassroomPanel({
    onLiveChange: (live) => {
      $('btn-classroom')?.classList.toggle('classroom-live', live);
      document.querySelector('.class-tile')?.classList.toggle('is-live', live);
      const $status = $('class-tile-status');
      const $text = $('class-tile-text');
      if ($status) $status.textContent = live ? 'Your class is live' : 'Classroom';
      if ($text) $text.textContent = live
        ? 'Students can see your code. Open the classroom to see theirs.'
        : 'Teach a class or join one on the same Wi-Fi or LAN.';
    },
    editorGetters: {
      getCode: () => getValue() || '',
      getCursor: () => {
        const pos = getCursorPosition();
        return { line: pos?.lineNumber || 1, col: pos?.column || 1 };
      },
      getFileName: getActiveFileName,
      setValue: (code) => setValue(code),
      // Teacher edits; ranges are validated in classroom/edit-guard.js first
      applyEdit: (from, to, insert) => getView()?.dispatch({ changes: { from, to, insert } }),
      getDocLength: () => getView()?.state.doc.length ?? 0,
    },
  });
}

// ── Boot ─────────────────────────────────────────────────────────
async function initIDE() {
  startBoot();

  const $editorHost = $('monaco-container');
  state.editor = await createEditor($editorHost);
  setBootStep(1);

  const savedCode = storageGet('theta-code');
  initTabs(savedCode || STARTER_CODE);
  if (savedCode) {
    setValue(savedCode);
    showToast('Code restored from last session', 'save', 2000);
  }

  initEditorEvents();
  updateCodeStats();

  // xterm measures its cells when it opens, so wait for JetBrains Mono
  await fontsReady();
  state.terminal = new TerminalManager($('terminal-container'));
  state.terminal.init();

  state.replManager = new ReplManager();
  state.replManager.init($('repl-container'));

  initPaneTabs();
  initGutter();
  initModals();
  initButtons();
  initCommandPalette(actions);
  initShortcuts(actions, { isRunning: () => state.isRunning, onEscape: handleEscape });
  initFileInputs($editorHost || document.querySelector('.ide-body'));
  initContextMenu($editorHost, { runCode, openFindReplace });
  initClassroom();
  initSettings();

  // Read-only hooks for the Electron smoke test (never enabled otherwise).
  // The terminal renders with WebGL, so its text is not in the DOM.
  if (window.electronAPI?.isSmokeTest) {
    window.__thetaTest = {
      terminalText() {
        const buf = state.terminal?.term?.buffer.active;
        if (!buf) return '';
        let text = '';
        for (let i = 0; i < buf.length; i++) text += (buf.getLine(i)?.translateToString(true) ?? '') + '\n';
        return text;
      },
      fxStats: () => fx.stats(),
      setCode: (code) => setValue(code),
      // Plays each pixel moment alone and reports its cost per drawn frame
      async fxBench() {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const at = document.querySelector('.exec-time-wrap');
        const runs = {
          loadingLoop: async () => { const h = startLoadingLoop(at); await wait(2500); h?.cancel(); },
          runSucceeded: async () => { runSucceeded(at); await wait(1400); },
          runFailed: async () => { runFailed(at); await wait(700); },
          screenTransition: () => screenTransition(() => {}),
        };
        const out = {};
        for (const [name, run] of Object.entries(runs)) {
          await fx.stats(); // reset
          await run();
          await wait(100);
          out[name] = await fx.stats();
        }
        return out;
      },
    };
  }

  await initRuntime();

  // First launch: choose Playground or Pro. Pro starts with pixel effects off.
  if (!hasChosenTheme()) {
    showThemePicker({
      onChosen: (theme) => {
        if (theme === 'pro' && storageGet('theta-fx') === null) fx.setUserEnabled(false);
      },
    });
  }
}

// Static UI that doesn't depend on the editor
initWindowControls();
initThemeControls(screenTransition);
onThemeChange((theme) => {
  setAppTheme(theme);
  state.terminal?.setTheme(xtermTheme(theme));
  state.replManager?.setTheme(xtermTheme(theme));
  // The layout changes shape: let the editor and terminals re-measure
  requestAnimationFrame(() => {
    editorLayout();
    state.terminal?.fit();
    state.replManager?.fit();
  });
});
initUnsavedHandling({ hasUnsaved: hasUnsavedTabs, save: saveAll });
initTheme({
  $editorPane: $('editor-pane'),
  $themeIcon: $('theme-icon'),
  $themeLabel: $('theme-label'),
  $statusThemeText: $('status-theme-text'),
  $themeBtn: $('btn-theme'),
  $statusTheme: $('status-theme'),
});
state.pipManager = new PipManager();
state.pipManager.init(); // runtime.js binds it to the chosen runtime
initAccessibility();

initIDE().catch((err) => {
  console.error('[THETA] IDE failed to start:', err);
  showToast(`IDE failed to start: ${err.message}`, 'error', 6000);
});
