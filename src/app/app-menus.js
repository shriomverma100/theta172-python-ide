/**
 * What is in File, Edit, View, Run and Help. Items name app actions (the
 * same ids the shortcuts and the command palette use), so a shortcut a
 * user changes shows up here too.
 */
import { recentItems, autoSaveItems } from './ide-actions.js';
import { pluginMenuItems } from '../plugins/plugin-host.js';

const sep = { separator: true };
const notebookOpen = () => document.querySelector('.monaco-container.nb-shown') !== null;

export const APP_MENUS = [
  {
    label: 'File',
    items: [
      { label: 'New File', action: 'new-tab', shortcut: 'new-tab' },
      { label: 'New Notebook', action: 'new-notebook' },
      { label: 'New File in Project…', action: 'new-file' },
      sep,
      { label: 'Open File…', action: 'open-file', shortcut: 'open-file' },
      { label: 'Open Folder…', action: 'open-folder', shortcut: 'open-folder' },
      { label: 'Open Recent', submenu: recentItems },
      sep,
      { label: 'Save', action: 'save', shortcut: 'save' },
      { label: 'Save As…', action: 'save-as', shortcut: 'save-as' },
      { label: 'Save All', action: 'save-all', shortcut: 'save-all' },
      { label: 'Auto Save', submenu: autoSaveItems },
      { label: 'Revert File', action: 'revert-file' },
      sep,
      { label: 'Reveal in File Explorer', action: 'reveal-file' },
      { label: 'Copy Path', action: 'copy-path' },
      { label: 'Copy Relative Path', action: 'copy-relative-path' },
      sep,
      { label: 'Close Editor', action: 'close-editor', shortcut: 'close-editor' },
      { label: 'Close All Editors', action: 'close-all' },
      { label: 'Close Folder', action: 'close-folder' },
      sep,
      { label: 'Settings', action: 'settings' },
      { label: 'Exit', action: 'exit', keys: 'Alt+F4' },
    ],
  },
  {
    label: 'Edit',
    items: [
      { label: 'Undo', action: 'undo', keys: 'Ctrl+Z' },
      { label: 'Redo', action: 'redo', keys: 'Ctrl+Y' },
      sep,
      { label: 'Cut', action: 'cut', keys: 'Ctrl+X' },
      { label: 'Copy', action: 'copy-selection', keys: 'Ctrl+C' },
      { label: 'Paste', action: 'paste', keys: 'Ctrl+V' },
      { label: 'Select All', action: 'select-all-text', keys: 'Ctrl+A' },
      sep,
      { label: 'Find and Replace', action: 'find-replace', shortcut: 'find-replace' },
      { label: 'Search in Project', action: 'search-files', shortcut: 'search-files' },
      sep,
      { label: 'Toggle Comment', action: 'toggle-comment', keys: 'Ctrl+/' },
      { label: 'Format Document', action: 'format-document', shortcut: 'format-document' },
      { label: 'Rename Symbol', action: 'rename-symbol', shortcut: 'rename-symbol' },
      sep,
      { label: 'Go to Line…', action: 'go-to-line', shortcut: 'go-to-line' },
      { label: 'Go to Symbol in File…', action: 'go-symbol', shortcut: 'go-symbol' },
      { label: 'Go to Definition', action: 'go-definition', shortcut: 'go-definition' },
    ],
  },
  {
    label: 'View',
    items: [
      { label: 'Command Palette…', action: 'cmd-palette', shortcut: 'cmd-palette' },
      sep,
      { label: 'Show / Hide Sidebar', action: 'toggle-sidebar', shortcut: 'toggle-sidebar' },
      { label: 'Source Control', action: 'source-control', shortcut: 'source-control' },
      { label: 'Tests', action: 'show-tests' },
      { label: 'Problems', action: 'show-problems', shortcut: 'show-problems' },
      { label: 'Terminal (Shell)', action: 'open-shell', shortcut: 'open-shell' },
      sep,
      { label: 'Split Editor', action: 'toggle-split', shortcut: 'toggle-split' },
      { label: 'Next Tab', action: 'next-tab', shortcut: 'next-tab' },
      { label: 'Previous Tab', action: 'prev-tab', shortcut: 'prev-tab' },
      { label: 'Study Mode', action: 'study-mode', shortcut: 'study-mode' },
      sep,
      { label: 'Switch Theme (Playground / Pro)', action: 'switch-theme' },
      { label: 'Light / Dark Code Colours', action: 'toggle-theme', shortcut: 'toggle-theme' },
      { label: 'Bigger Text', action: 'font-inc', shortcut: 'font-inc' },
      { label: 'Smaller Text', action: 'font-dec', shortcut: 'font-dec' },
    ],
  },
  {
    label: 'Run',
    items: [
      { label: 'Run', action: 'run', shortcut: 'run' },
      { label: 'Stop', action: 'stop' },
      { label: 'Predict, Then Run…', action: 'predict' },
      { label: 'Chain Lens (data after each step)', action: 'chain-lens', shortcut: 'chain-lens' },
      { label: 'Practice Viva on This File…', action: 'viva-practice' },
      { label: 'Replay How This File Was Written', action: 'replay-file' },
      { label: 'Run on Class GPU', action: 'run-class-gpu' },
      sep,
      { label: 'Run All Tests', action: 'tests-run-all', shortcut: 'tests-run-all' },
      { label: 'Run Failed Tests', action: 'tests-run-failed' },
      { label: 'Run Tests in This File', action: 'tests-run-file' },
      sep,
      { label: 'Run Task…', action: 'run-task', shortcut: 'run-task' },
      { label: 'Run Last Task', action: 'rerun-task' },
      { label: 'Configure Tasks…', action: 'configure-tasks' },
      sep,
      { label: 'Start Debugging', action: 'debug-start', shortcut: 'debug-start' },
      { label: 'Toggle Breakpoint', action: 'toggle-breakpoint', shortcut: 'toggle-breakpoint' },
      sep,
      { label: 'Run All Cells', action: 'nb-run-all', when: notebookOpen },
      { label: 'Restart Kernel', action: 'nb-restart', when: notebookOpen },
      { separator: true, when: notebookOpen },
      { label: 'Select Python…', action: 'select-interpreter' },
      { label: 'Manage Packages', action: 'manage-packages' },
      { label: 'Check Environment', action: 'check-environment' },
    ],
  },
  {
    label: 'Plugins',
    // Built when the menu opens: the commands of the plugins that are on
    get items() {
      const mine = pluginMenuItems();
      return [...mine, ...(mine.length ? [sep] : []), { label: 'Manage Plugins…', action: 'manage-plugins' }];
    },
  },
  {
    label: 'Help',
    items: [
      { label: 'Keyboard Shortcuts', action: 'shortcuts' },
      { label: 'Examples', action: 'examples' },
      sep,
      { label: 'Explain the Last Error', action: 'explain-error' },
      { label: 'Explain Errors in Hindi / English', action: 'explain-language' },
      sep,
      { label: 'Check for Updates…', action: 'check-updates' },
      { label: "What's New", action: 'whats-new' },
      { label: 'Take the Tour', action: 'tour' },
      { label: 'Replay the Welcome', action: 'welcome' },
      { label: 'About Python by THETA172', action: 'about' },
    ],
  },
];
