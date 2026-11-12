/**
 * Command palette (Ctrl+Shift+P): searchable list of IDE actions.
 */
import { focusEditor } from '../editor.js';
import { $ } from '../core/dom.js';
import { getBindingLabel } from './shortcuts.js';

/** id must match an action key (and a shortcut id when it has one). */
const COMMANDS = [
  { id: 'run',            name: 'Run Code',               icon: '<path d="M4 2.5L12 7L4 11.5V2.5Z" fill="currentColor"/>' },
  { id: 'stop',           name: 'Stop Execution',         icon: '<rect x="3" y="3" width="8" height="8" fill="currentColor"/>' },
  { id: 'clear',          name: 'Clear Terminal',         icon: '<path d="M3 12L12 3M3 3L12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' },
  { id: 'copy',           name: 'Copy Code',              icon: '<rect x="3.5" y="3.5" width="7" height="7" stroke="currentColor" stroke-width="1.2"/><path d="M3.5 3.5V2A1 1 0 012 1H1V8A1 1 0 002 9H3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>' },
  { id: 'save',           name: 'Save File',              icon: '<path d="M2 3H9L12 6V13H2V3Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><rect x="4" y="8" width="6" height="5" stroke="currentColor" stroke-width="1.1"/>' },
  { id: 'save-as',        name: 'Save As...',             icon: '<path d="M2 3H9L12 6V13H2V3Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M7 1V5M5 3H9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>' },
  { id: 'open-file',      name: 'Open File...',           icon: '<path d="M2 4H5L7 2H12V12H2V4Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>' },
  { id: 'find-replace',   name: 'Find & Replace',         icon: '<circle cx="6" cy="6" r="4" stroke="currentColor" stroke-width="1.2"/><path d="M9 9L13 13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' },
  { id: 'examples',       name: 'Browse Examples',        icon: '<rect x="2" y="2" width="10" height="10" stroke="currentColor" stroke-width="1.2"/><path d="M5 5H9M5 7H7M5 9H8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>' },
  { id: 'new-tab',        name: 'New Tab',                icon: '<path d="M7 3V11M3 7H11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' },
  { id: 'new-notebook',   name: 'New Notebook (.ipynb)',  icon: '<rect x="2.5" y="1.5" width="9" height="11" rx="1.2" stroke="currentColor" stroke-width="1.2"/><path d="M5 4.5h4M5 7h4M5 9.5h2.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>' },
  { id: 'nb-run-all',     name: 'Notebook: Run All Cells',      icon: '<path d="M2 3v8l4.5-4zM7.5 3v8L12 7z" fill="currentColor"/>' },
  { id: 'nb-run-above',   name: 'Notebook: Run Cells Up to Here', icon: '<path d="M3 12V5M1 7l2-2 2 2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 3v8l5-4z" fill="currentColor"/>' },
  { id: 'nb-restart',     name: 'Notebook: Restart Kernel',     icon: '<path d="M11.5 4.5A5 5 0 1 0 12 8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M12 1.5v3.2H8.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>' },
  { id: 'nb-clear',       name: 'Notebook: Clear All Outputs',  icon: '<path d="M2 3.5h10M5 3.5V2h4v1.5M3.5 3.5l.6 8.5h5.8l.6-8.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>' },
  { id: 'nb-export-py',   name: 'Notebook: Export as Python Script', icon: '<path d="M3 1.5h5l3 3v8H3Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M7 6v4.5M5 8.5l2 2 2-2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>' },
  { id: 'save-all',       name: 'Save All',                     icon: '<path d="M2 3H9L12 6V13H2V3Z M4.5 8.5h5M4.5 10.5h5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' },
  { id: 'revert-file',    name: 'Revert File (load it from disk again)', icon: '<path d="M3 7a4 4 0 1 0 1.2-2.8M3 2.5v2.7h2.7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' },
  { id: 'close-editor',   name: 'Close Editor',                 icon: '<path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' },
  { id: 'close-all',      name: 'Close All Editors',            icon: '<path d="M2 4.5l5 5M7 4.5l-5 5M8.5 3h4M8.5 7h4M8.5 11h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' },
  { id: 'reopen-closed',  name: 'Reopen Closed Editor',         icon: '<path d="M3 7a4 4 0 1 0 1.2-2.8M3 2.5v2.7h2.7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' },
  { id: 'go-to-line',     name: 'Go to Line…',                  icon: '<path d="M2 3.5h10M2 7h6M2 10.5h10M10 5.5l2 1.5-2 1.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' },
  { id: 'auto-save-toggle', name: 'Turn Auto Save On / Off',   icon: '<path d="M2 3H9L12 6V13H2V3Z M7 6v3l2 1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' },
  { id: 'reveal-file',    name: 'Reveal in File Explorer',      icon: '<path d="M1.5 3.5h4l1.5 1.5h5.5v7h-11Z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' },
  { id: 'copy-path',      name: 'Copy Path of Active File',     icon: '<path d="M4 4h7v8H4Z M2.5 10V2.5H9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' },
  { id: 'next-tab',       name: 'Next Tab',                     icon: '<path d="M3 7h8M8 4l3 3-3 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' },
  { id: 'prev-tab',       name: 'Previous Tab',                 icon: '<path d="M11 7H3M6 4L3 7l3 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' },
  { id: 'manage-plugins', name: 'Plugins: Manage Plugins…',      icon: '<path d="M5 2h4v2.2a1.3 1.3 0 1 0 2.6 0V2H12v4h-2.2a1.3 1.3 0 1 0 0 2.6H12V12H8V9.8a1.3 1.3 0 1 0-2.6 0V12H2V8h2.2a1.3 1.3 0 1 0 0-2.6H2V2h3Z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round" fill="none"/>' },
  { id: 'run-task',       name: 'Run Task…',                    icon: '<path d="M2.5 3.5h9v7h-9Z M4.5 6l1.5 1.5L4.5 9M7.5 9h2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' },
  { id: 'rerun-task',     name: 'Run Last Task',                icon: '<path d="M3 7a4 4 0 1 0 1.2-2.8M3 2.5v2.7h2.7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' },
  { id: 'configure-tasks', name: 'Configure Tasks (.theta/tasks.json)', icon: '<path d="M7 4.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM7 1.5v2M7 10.5v2M1.5 7h2M10.5 7h2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' },
  { id: 'show-tests',     name: 'Show Tests',                   icon: '<path d="M5.5 2h3M6 2v3.5L2.8 11a1 1 0 0 0 .9 1.5h6.6a1 1 0 0 0 .9-1.5L8 5.5V2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' },
  { id: 'tests-run-all',  name: 'Run All Tests',                icon: '<path d="M3 2.5v9l7.5-4.5Z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' },
  { id: 'tests-run-failed', name: 'Run Failed Tests Again',    icon: '<path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' },
  { id: 'tests-run-file', name: 'Run Tests in This File',       icon: '<path d="M3 1.5h5l3 3v8H3Z M5.5 7v3l2.5-1.5Z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' },
  { id: 'tests-refresh',  name: 'Find Tests Again',             icon: '<path d="M3 7a4 4 0 1 0 1.2-2.8M3 2.5v2.7h2.7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' },
  { id: 'run-class-gpu',  name: 'Run on Class GPU (shared by your teacher)', icon: '<rect x="2" y="3.5" width="10" height="7" rx="1" stroke="currentColor" stroke-width="1.2" fill="none"/><path d="M4.5 6h5M4.5 8h3M4 10.5v2M10 10.5v2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>' },
  { id: 'chain-lens',     name: 'Chain Lens: Data After Each Step', icon: '<circle cx="5.5" cy="5.5" r="3.5" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M8.2 8.2 12 12M3.5 5.5h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' },
  { id: 'viva-practice',  name: 'Practice Viva on This File',  icon: '<path d="M2.5 3h9v6h-5l-3 2.5V9h-1Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" fill="none"/>' },
  { id: 'replay-file',    name: 'Replay How This File Was Written', icon: '<path d="M3 2.5v9l7.5-4.5Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" fill="none"/>' },
  { id: 'predict',        name: 'Predict the Output, Then Run', icon: '<path d="M7 2.5c-3 0-5.2 2.3-5.7 4.5.5 2.2 2.7 4.5 5.7 4.5s5.2-2.3 5.7-4.5C12.2 4.8 10 2.5 7 2.5Z" stroke="currentColor" stroke-width="1.2"/><circle cx="7" cy="7" r="1.8" fill="currentColor"/>' },
  { id: 'check-updates',  name: 'Check for Updates',            icon: '<path d="M7 1.5v8M3.5 6 7 9.5 10.5 6M2 12.5h10" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' },
  { id: 'about',          name: 'About Python by THETA172',     icon: '<circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M7 6.2v3.6M7 4.2h.01" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' },
  { id: 'tour',           name: 'Take the Tour (Startup Guide)', icon: '<path d="M2 7h7M6.5 3.5 10 7l-3.5 3.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="7" r="1.2" fill="currentColor"/>' },
  { id: 'explain-error',  name: 'Explain the Last Error',       icon: '<circle cx="7" cy="7" r="5.2" stroke="currentColor" stroke-width="1.2"/><path d="M7 6.3v3.5M7 4.3v.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' },
  { id: 'explain-language', name: 'Explain Errors in Hindi / English', icon: '<path d="M2 3h6M5 2v1.2M3.3 3c.4 2 1.8 3.6 3.7 4.4M7 3c-.5 2.3-2.2 4.2-4.6 5M8 12l2.5-6 2.5 6M8.9 10h3.2" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>' },
  { id: 'focus-editor',   name: 'Focus Editor',           icon: '<path d="M2.5 4L5.5 7L2.5 10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 10H10.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' },
  { id: 'focus-terminal', name: 'Focus Terminal',         icon: '<rect x="1" y="1" width="12" height="12" stroke="currentColor" stroke-width="1.2"/><path d="M3.5 4.5L6 7L3.5 9.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>' },
  { id: 'font-inc',       name: 'Increase Font Size',     icon: '<path d="M3 2.5H8M5.5 2.5V7.5M3 10H8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>' },
  { id: 'font-dec',       name: 'Decrease Font Size',     icon: '<path d="M3 5H8M3 9H8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>' },
  { id: 'reset-code',     name: 'Reset to Starter Code',  icon: '<path d="M2 7C2 4.2 4.2 2 7 2s5 2.2 5 5-2.2 5-5 5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M2 4V7H5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>' },
  { id: 'toggle-theme',   name: 'Toggle Editor Theme',    icon: '<circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.2"/><path d="M7 2A5 5 0 017 12V2Z" fill="currentColor"/>' },
  { id: 'open-folder',    name: 'Open Folder…',           icon: '<path d="M1.5 3.5h4l1.5 1.5h5.5v7h-11Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>' },
  { id: 'close-folder',   name: 'Close Folder',           icon: '<path d="M1.5 3.5h4l1.5 1.5h5.5v7h-11Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M5.5 7.5l3 3m0-3-3 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>' },
  { id: 'new-file',       name: 'New File in Project',    icon: '<path d="M3 1.5h5l3 3v8H3Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M7 6.5v4M5 8.5h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>' },
  { id: 'search-files',   name: 'Search in Project',      icon: '<circle cx="6" cy="6" r="4" stroke="currentColor" stroke-width="1.2"/><path d="M9 9l3.5 3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M4 6h4" stroke="currentColor" stroke-width="1.2"/>' },
  { id: 'toggle-sidebar', name: 'Show / Hide Sidebar',    icon: '<rect x="1.5" y="2.5" width="11" height="9" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M5 2.5v9" stroke="currentColor" stroke-width="1.2"/>' },
  { id: 'move-editor-right',  name: 'Move Editor to the Right Group', icon: '<rect x="1.5" y="2.5" width="11" height="9" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M7 2.5v9M3 7h3M5 5.5 6.5 7 5 8.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>' },
  { id: 'move-editor-left',   name: 'Move Editor to the Left Group',  icon: '<rect x="1.5" y="2.5" width="11" height="9" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M7 2.5v9M11 7H8M9 5.5 7.5 7 9 8.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>' },
  { id: 'focus-other-group',  name: 'Focus the Other Editor Group',   icon: '<rect x="1.5" y="2.5" width="11" height="9" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M7 2.5v9" stroke="currentColor" stroke-width="1.2"/><rect x="8" y="3.5" width="3.5" height="7" fill="currentColor" opacity=".5"/>' },
  { id: 'toggle-split',   name: 'Split Editor',           icon: '<rect x="1.5" y="2.5" width="11" height="9" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M7 2.5v9" stroke="currentColor" stroke-width="1.2"/>' },
  { id: 'open-shell',     name: 'Open Terminal (Shell)',  icon: '<rect x="1" y="2" width="12" height="10" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M3.5 5.5 5.5 7.5 3.5 9.5M7 9.5h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>' },
  { id: 'go-definition',      name: 'Go to Definition',            icon: '<path d="M2 7h8M7 4l3 3-3 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 2v10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' },
  { id: 'find-references',    name: 'Find All References',         icon: '<circle cx="4" cy="4" r="1.6" fill="currentColor"/><circle cx="4" cy="10" r="1.6" fill="currentColor"/><path d="M7 4h5M7 10h5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' },
  { id: 'rename-symbol',      name: 'Rename Symbol',               icon: '<rect x="1.5" y="4" width="11" height="6" rx="1" stroke="currentColor" stroke-width="1.2"/><path d="M4 7h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' },
  { id: 'format-document',    name: 'Format Document (Ruff)',      icon: '<path d="M2 3h10M2 6h7M2 9h10M2 12h6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' },
  { id: 'go-symbol',          name: 'Go to Symbol in File',        icon: '<path d="M3 2.5 1.5 7 3 11.5M11 2.5 12.5 7 11 11.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7" cy="7" r="1.6" fill="currentColor"/>' },
  { id: 'workspace-symbol',   name: 'Go to Symbol in Project',     icon: '<rect x="1.5" y="1.5" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.2"/><circle cx="7" cy="7" r="1.6" fill="currentColor"/>' },
  { id: 'show-problems',      name: 'Show Problems',               icon: '<path d="M7 1.5 13 12H1Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M7 5.5v3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="7" cy="10.2" r=".8" fill="currentColor"/>' },
  { id: 'restart-language-server', name: 'Python: Restart Language Server', icon: '<path d="M2 7a5 5 0 1 0 1.5-3.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M2 2v3h3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>' },
  { id: 'source-control',     name: 'Git: Source Control',         icon: '<circle cx="4" cy="3" r="1.6" stroke="currentColor" stroke-width="1.2"/><circle cx="4" cy="11" r="1.6" stroke="currentColor" stroke-width="1.2"/><circle cx="10" cy="5" r="1.6" stroke="currentColor" stroke-width="1.2"/><path d="M4 4.6v4.8M10 6.6c0 2.2-2.6 2-5.4 3.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>' },
  { id: 'git-commit',         name: 'Git: Commit',                 icon: '<circle cx="7" cy="7" r="2.5" stroke="currentColor" stroke-width="1.3"/><path d="M1 7h3.5M9.5 7H13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' },
  { id: 'git-branch',         name: 'Git: Switch / Create Branch', icon: '<circle cx="4" cy="3" r="1.6" stroke="currentColor" stroke-width="1.2"/><circle cx="4" cy="11" r="1.6" stroke="currentColor" stroke-width="1.2"/><path d="M4 4.6v4.8" stroke="currentColor" stroke-width="1.2"/>' },
  { id: 'git-sync',           name: 'Git: Pull and Push',          icon: '<path d="M4 2v9M1.5 8.5 4 11l2.5-2.5M10 12V3M7.5 5.5 10 3l2.5 2.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>' },
  { id: 'study-mode',         name: 'Study Mode (lecture side by side)', icon: '<rect x="1" y="2" width="12" height="10" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M7.5 2v10" stroke="currentColor" stroke-width="1.2"/><path d="M3.5 5.5v3L5.5 7Z" fill="currentColor"/>' },
  { id: 'study-exit',         name: 'Leave Study Mode',            icon: '<path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' },
  { id: 'debug-start',        name: 'Start Debugging',             icon: '<rect x="4" y="4" width="6" height="8" rx="3" stroke="currentColor" stroke-width="1.2"/><path d="M2 6h2M10 6h2M2 10h2M10 10h2M5.5 4a1.5 1.5 0 0 1 3 0" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>' },
  { id: 'toggle-breakpoint',  name: 'Toggle Breakpoint',           icon: '<circle cx="7" cy="7" r="4" fill="currentColor"/>' },
  { id: 'debug-stop',         name: 'Stop Debugging',              icon: '<rect x="3.5" y="3.5" width="7" height="7" rx="1" fill="currentColor"/>' },
  { id: 'debug-restart',      name: 'Restart Debugging',           icon: '<path d="M11.5 7A4.5 4.5 0 1 1 10.2 3.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M11 1.5v3h-3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>' },
  { id: 'select-interpreter', name: 'Python: Select Interpreter', icon: '<path d="M5 1.5h3a2 2 0 0 1 2 2V6H5a2 2 0 0 0-2 2v1.5" stroke="currentColor" stroke-width="1.2"/><path d="M9 12.5H6a2 2 0 0 1-2-2V8h5a2 2 0 0 0 2-2V4.5" stroke="currentColor" stroke-width="1.2"/>' },
  { id: 'manage-packages',    name: 'Python: Manage Packages',    icon: '<path d="M7 1.5 12 4v6l-5 2.5L2 10V4Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M2 4l5 2.5L12 4M7 6.5v6" stroke="currentColor" stroke-width="1.2"/>' },
  { id: 'check-environment',  name: 'Python: Check Environment',  icon: '<path d="M3 7.5 6 10.5 11.5 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>' },
  { id: 'switch-theme',   name: 'Switch Theme (Playground / Pro)', icon: '<rect x="1.5" y="2.5" width="11" height="9" rx="2" stroke="currentColor" stroke-width="1.2"/><path d="M7 2.5v9" stroke="currentColor" stroke-width="1.2"/><path d="M2 3h5v8H2Z" fill="currentColor" opacity=".4"/>' },
  { id: 'toggle-fx',      name: 'Toggle Pixel Effects',   icon: '<rect x="2" y="2" width="4" height="4" fill="currentColor"/><rect x="8" y="8" width="4" height="4" fill="currentColor"/><rect x="8" y="2" width="4" height="4" stroke="currentColor" stroke-width="1"/>' },
  { id: 'settings',       name: 'Open Settings',          icon: '<path d="M2 4H8M11 4H12M2 10H4M7 10H12" stroke="currentColor" stroke-width="1.2"/><rect x="8" y="2.5" width="3" height="3" stroke="currentColor" stroke-width="1.1"/><rect x="4" y="8.5" width="3" height="3" stroke="currentColor" stroke-width="1.1"/>' },
  { id: 'cmd-palette',    name: 'Command Palette',       icon: '<circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.2"/><path d="M10.5 10.5L13 13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' },
];

let actions = {};
let filtered = [...COMMANDS];
let selected = 0;

/** Commands added while the app runs (plugins): { id, name, run }. */
const extra = [];
const PLUGIN_ICON = '<path d="M5 2h4v2.2a1.3 1.3 0 1 0 2.6 0V2H12v4h-2.2a1.3 1.3 0 1 0 0 2.6H12V12H8V9.8a1.3 1.3 0 1 0-2.6 0V12H2V8h2.2a1.3 1.3 0 1 0 0-2.6H2V2h3Z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round" fill="none"/>';

export function addCommand({ id, name, run }) {
  removeCommand(id);
  extra.push({ id, name, run, icon: PLUGIN_ICON });
}
export function removeCommand(id) {
  const i = extra.findIndex((c) => c.id === id);
  if (i >= 0) extra.splice(i, 1);
}
export const extraCommands = () => extra.slice();

export function filterCommands(query) {
  const q = query.trim().toLowerCase();
  const all = [...COMMANDS, ...extra];
  return q ? all.filter((c) => c.name.toLowerCase().includes(q)) : all;
}

export function isPaletteOpen() {
  return !$('cmd-palette')?.classList.contains('hidden');
}

export function openCommandPalette() {
  const $input = $('cmd-input');
  $('cmd-palette')?.classList.remove('hidden');
  if (!$input) return;
  $input.value = '';
  filtered = filterCommands('');
  selected = 0;
  render();
  setTimeout(() => $input.focus(), 50);
}

export function closeCommandPalette() {
  $('cmd-palette')?.classList.add('hidden');
  focusEditor();
}

export function toggleCommandPalette() {
  if (isPaletteOpen()) closeCommandPalette();
  else openCommandPalette();
}

function execute(cmd) {
  closeCommandPalette();
  if (cmd.run) cmd.run();
  else actions[cmd.id]?.();
}

function render() {
  const $results = $('cmd-results');
  if (!$results) return;
  $results.innerHTML = '';

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'cmd-empty';
    empty.textContent = 'No commands found';
    $results.appendChild(empty);
    return;
  }

  filtered.forEach((cmd, i) => {
    const el = document.createElement('div');
    el.className = 'cmd-result-item' + (i === selected ? ' active' : '');
    el.setAttribute('role', 'option');
    el.setAttribute('aria-selected', String(i === selected));

    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('class', 'cmd-result-icon');
    icon.setAttribute('width', '14');
    icon.setAttribute('height', '14');
    icon.setAttribute('viewBox', '0 0 14 14');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = cmd.icon; // trusted constant

    const name = document.createElement('span');
    name.className = 'cmd-result-name';
    name.textContent = cmd.name;
    el.append(icon, name);

    const key = getBindingLabel(cmd.id);
    if (key) {
      const keyEl = document.createElement('span');
      keyEl.className = 'cmd-result-key';
      keyEl.textContent = key;
      el.appendChild(keyEl);
    }

    el.addEventListener('click', () => execute(cmd));
    el.addEventListener('mouseenter', () => {
      if (selected === i) return;
      selected = i;
      render();
    });
    $results.appendChild(el);
  });
}

export function initCommandPalette(actionMap) {
  actions = actionMap;
  const $input = $('cmd-input');
  $('cmd-results')?.setAttribute('role', 'listbox');

  $input?.addEventListener('input', (e) => {
    filtered = filterCommands(e.target.value);
    selected = 0;
    render();
  });

  $input?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') return closeCommandPalette();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      selected = Math.max(0, Math.min(filtered.length - 1, selected + step));
      render();
      return;
    }
    if (e.key === 'Enter' && filtered[selected]) execute(filtered[selected]);
  });

  document.querySelector('#cmd-palette .cmd-palette-backdrop')?.addEventListener('click', closeCommandPalette);
}
