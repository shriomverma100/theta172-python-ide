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
 *   workspace.js     project folder: file tree, create/rename/move/delete, git
 *   search.js        search and replace across the project
 *   session.js       restore the folder and tabs after a restart
 *   shell-terminal.js  the Shell tab (PowerShell in a real terminal)
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
import { showInterpreterPicker, checkEnvironment, initFixBar } from './app/interpreter.js';
import { initSpotlight } from './app/spotlight.js';
import { initGit, pickBranch, commit as gitCommit, sync as gitSync, refreshGitView } from './app/git.js';
import { initStudy, toggleStudySheet, exitStudy, enterStudy, getStudyMode, toggleDrawer, showSuggestion } from './app/study.js';
import {
  initDebugger, startDebugging, stopDebugging, restartDebugging, pauseDebugging, stepOver, stepInto, stepOut,
  toggleBreakpoint, isDebugging,
} from './app/debugger.js';
import {
  initLanguageServer, goToDefinition, findReferences, renameSymbol, formatDocument, goToSymbolInFile,
  goToSymbolInProject, restartLanguageServer, isLanguageServerReady, problemSummary,
} from './app/lsp.js';
import {
  initClassroomPanel, openClassroomPanel, handleClassroomKeydown,
  broadcastCurrentCode, isTeacherLive, isStudentConnected, streamStudentCode,
} from './classroom/classroom.js';

import { $ } from './core/dom.js';
import { storageGet } from './core/storage.js';
import { xtermTheme } from './core/terminal-theme.js';
import { initThemeControls, onThemeChange, toggleTheme, hasChosenTheme, showThemePicker } from './app/theme.js';
import { state } from './app/state.js';
import {
  initTabs, addNewTab, getActiveFileName, hasUnsavedTabs, markActiveTabUnsaved, onTabsChanged, getTabs, getActiveTab,
  splitEditor, closeRightGroup, isSplit, moveActiveTab, focusGroup, getFocusedGroup,
} from './app/tabs.js';
import { startCompletion } from '@codemirror/autocomplete';
import { initWorkspace, openFolder, closeFolder, createItem, onWorkspaceChange, render as renderExplorer } from './app/workspace.js';
import { initSearch, focusSearch, showSidebarView } from './app/search.js';
import { initSession, restoreSession, saveSessionSoon } from './app/session.js';
import { ShellTerminal } from './app/shell-terminal.js';
import { saveToFile, saveAsFile, openFile, initFileInputs } from './app/files.js';
import { updateCodeStats, markUnsaved, scheduleAutoSave, saveCode } from './app/autosave.js';
import { initRuntime, runCode, stopCode } from './app/runtime.js';
import { startBoot, setBootStep } from './app/boot.js';
import { initSettings, openSettings, closeSettings, toggleFx, applyEditorPrefs } from './app/settings.js';
import { initPaneTabs, initGutter, clearOutput, adjustFontSize, switchPane } from './app/layout.js';
import { initShortcuts } from './app/shortcuts.js';
import { initCommandPalette, toggleCommandPalette, openCommandPalette, isPaletteOpen, closeCommandPalette } from './app/commands.js';
import { initModals, openExamples, openShortcuts, closeAllModals } from './app/modals.js';
import { fixCode } from './app/ai-fix.js';
import { initWindowControls, initUnsavedHandling } from './app/window-chrome.js';
import { initContextMenu } from './app/context-menu.js';
import { initAccessibility } from './app/a11y.js';

// ── Global error reporting ───────────────────────────────────────
window.onerror = (message, source, line, col, error) => {
  // The stack goes into the text too: logs and the smoke test only keep the message
  console.error(`[THETA] Uncaught error: ${message} (${source}:${line}:${col}) ${error?.stack || ''}`, error);
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
  'open-folder': openFolder,
  'close-folder': closeFolder,
  'new-file': () => createItem('file'),
  'search-files': () => { showSidebar(true); focusSearch(); },
  'toggle-sidebar': () => (getStudyMode() ? toggleDrawer() : showSidebar()),
  'toggle-split': toggleSplitView,
  'move-editor-right': () => { moveActiveTab('right'); relayout(); },
  'move-editor-left': () => { moveActiveTab('left'); relayout(); },
  'focus-other-group': () => { if (isSplit()) focusGroup(1 - getFocusedGroup()); },
  'open-shell': () => switchPane('shell'),
  'select-interpreter': showInterpreterPicker,
  'go-definition': goToDefinition,
  'find-references': findReferences,
  'rename-symbol': renameSymbol,
  'format-document': () => formatDocument(),
  'go-symbol': goToSymbolInFile,
  'workspace-symbol': goToSymbolInProject,
  'show-problems': () => switchPane('problems'),
  'restart-language-server': restartLanguageServer,
  'debug-start': startDebugging,
  'debug-stop': stopDebugging,
  'debug-restart': restartDebugging,
  'debug-pause': pauseDebugging,
  'step-over': stepOver,
  'step-into': stepInto,
  'step-out': stepOut,
  'toggle-breakpoint': toggleBreakpoint,
  'study-mode': toggleStudySheet,
  'source-control': () => { showSidebar(true); showSidebarView('git'); refreshGitView(); },
  'git-branch': pickBranch,
  'git-commit': gitCommit,
  'git-sync': gitSync,
  'study-exit': exitStudy,
  'manage-packages': () => { switchPane('terminal'); state.pipManager?.toggle(true); },
  'check-environment': checkEnvironment,
};

// ── Sidebar and split editor ─────────────────────────────────────
function relayout() {
  requestAnimationFrame(() => {
    editorLayout();
    state.terminal?.fit();
    state.replManager?.fit();
    state.shell?.fit();
  });
}

/** Show or hide the project sidebar (Ctrl+B). Pass true to force it open. */
function showSidebar(force) {
  const body = document.querySelector('.ide-body');
  const hidden = force === true ? false : !body.classList.contains('sidebar-hidden');
  body.classList.toggle('sidebar-hidden', hidden);
  relayout();
}

/** Split: open the current file in a right-hand group too; again: close that group. */
function toggleSplitView() {
  if (isSplit()) closeRightGroup();
  else splitEditor();
  relayout();
}

function handleEscape(e) {
  if (handleClassroomKeydown(e)) return;
  closeAllModals();
  closeSettings();
  if (isPaletteOpen()) closeCommandPalette();
}

function initButtons() {
  // Pro icon rail and the Playground class tile
  $('rail-files')?.addEventListener('click', () => {
    const body = document.querySelector('.ide-body');
    const onFiles = !$('files-view')?.classList.contains('hidden');
    if (onFiles && !body.classList.contains('sidebar-hidden')) showSidebar(); // second click hides
    else { showSidebar(true); showSidebarView('files'); }
  });
  $('rail-search')?.addEventListener('click', () => { showSidebar(true); focusSearch(); });
  $('rail-debug')?.addEventListener('click', () => { showSidebar(true); showSidebarView('debug'); });
  $('rail-git')?.addEventListener('click', () => { showSidebar(true); showSidebarView('git'); refreshGitView(); });
  $('btn-split')?.addEventListener('click', toggleSplitView);
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
  // Edits made by the app itself (opening a file, switching tabs) are not unsaved changes
  let userEdited = false;
  onContentChange((_update, { programmatic }) => {
    if (!programmatic) userEdited = true;
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      if (isTeacherLive()) broadcastCurrentCode();
      if (isStudentConnected()) streamStudentCode();
      updateCodeStats();
      if (userEdited) {
        markUnsaved();
        markActiveTabUnsaved();
        scheduleAutoSave();
      }
      userEdited = false;
      saveSessionSoon();
    }, 60);
  });

  // Keep the explorer's "open file" highlight and the window title in step
  onTabsChanged(() => {
    renderExplorer();
    updateCodeStats();
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

  applyEditorPrefs();
  const savedCode = storageGet('theta-code'); // single-file autosave from older versions
  initTabs(savedCode || STARTER_CODE);
  initWorkspace();
  initSearch();
  initSession();
  if (await restoreSession()) showToast('Reopened your project and tabs', 'save', 2000);
  else if (savedCode) showToast('Code restored from last session', 'save', 2000);

  initEditorEvents();
  updateCodeStats();

  // xterm measures its cells when it opens, so wait for JetBrains Mono
  await fontsReady();
  state.terminal = new TerminalManager($('terminal-container'));
  state.terminal.init();

  state.replManager = new ReplManager();
  state.replManager.init($('repl-container'));
  state.shell = new ShellTerminal($('shell-container'));

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
      // Language intelligence (Phase 4)
      lspReady: () => isLanguageServerReady(),
      problems: () => problemSummary(),
      code: () => getView()?.state.doc.toString() ?? '',
      cursorTo(text, offsetInText = 0) {
        const view = getView();
        const at = view.state.doc.toString().indexOf(text);
        if (at < 0) return false;
        view.dispatch({ selection: { anchor: at + offsetInText } });
        view.focus();
        return true;
      },
      complete: () => startCompletion(getView()),
      // Study mode (Phase 6): study('half', 'right') or study(null) to leave
      study: (mode, side) => (mode ? enterStudy(mode, side) : exitStudy()),
      studySuggest: (side) => showSuggestion(side),
      // Debugger (Phase 5)
      toggleBreakpointLine(n) {
        const view = getView();
        view.dispatch({ selection: { anchor: view.state.doc.line(n).from } });
        toggleBreakpoint();
      },
      submitInput: (text) => state.terminal?.onInputSubmit?.(text),
      debugState: () => ({
        active: isDebugging(),
        status: document.getElementById('dbg-status-text')?.textContent || '',
        pausedLine: (() => {
          const el = document.querySelector('.cm-debug-paused-line');
          return el ? getView().state.doc.lineAt(getView().posAtDOM(el)).number : null;
        })(),
      }),
      /** Screen position of `text` (+ offset) in the editor, for hover tests. */
      coordsOf(text, offsetInText = 0) {
        const view = getView();
        const at = view.state.doc.toString().indexOf(text);
        const c = at < 0 ? null : view.coordsAtPos(at + offsetInText);
        return c && { x: c.left + 2, y: (c.top + c.bottom) / 2 };
      },
      tabs: () => getTabs().map((t) => ({ name: t.name, unsaved: t.unsaved, readOnly: !!t.readOnly })),
      activeTab: () => getActiveTab()?.name,
      shellText() {
        const buf = state.shell?.term?.buffer.active;
        if (!buf) return '';
        let text = '';
        for (let i = 0; i < buf.length; i++) text += (buf.getLine(i)?.translateToString(true) ?? '') + '\n';
        return text;
      },
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

  // First launch: choose Playground or Pro straight away; Python keeps
  // loading behind the picker. Pro starts with pixel effects off.
  if (!hasChosenTheme()) {
    showThemePicker({
      onChosen: (theme) => {
        if (theme === 'pro' && storageGet('theta-fx') === null) fx.setUserEnabled(false);
      },
    });
  }

  await initRuntime();
  // Language intelligence needs local Python (desktop); it starts in the background
  if (state.useLocalPython) initLanguageServer().catch((err) => console.error('[THETA] language server', err));
}

// Static UI that doesn't depend on the editor
initWindowControls();
initThemeControls(screenTransition);
onWorkspaceChange(({ name }) => window.electronAPI?.setTitle?.(name ? `${name} — Python by THETA172` : 'Python by THETA172'));
onThemeChange((theme) => {
  setAppTheme(theme);
  state.terminal?.setTheme(xtermTheme(theme));
  state.replManager?.setTheme(xtermTheme(theme));
  state.shell?.setTheme(xtermTheme(theme));
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
initFixBar();
initDebugger();
initSpotlight();
initGit();
initStudy();
initAccessibility();

initIDE().catch((err) => {
  console.error('[THETA] IDE failed to start:', err);
  showToast(`IDE failed to start: ${err.message}`, 'error', 6000);
});
