/**
 * Tasks: one-click commands for a project, run in the Shell (a real
 * terminal, with the chosen Python's environment active).
 *
 * Built in: run the current file, run all tests, lint and format with Ruff,
 * install requirements.txt. A project adds its own in .theta/tasks.json:
 *   { "tasks": [ { "label": "Train the model", "command": "python train.py --epochs 5" } ] }
 * "Run Task…" (Ctrl+Shift+B) lists them; "Run Last Task" repeats the last one.
 */
import { openQuickPick } from './quick-pick.js';
import { getWorkspaceRoot, openPath } from './workspace.js';
import { switchPane } from './layout.js';
import { state } from './state.js';
import { showToast } from '../toast.js';
import { parseTasksFile } from './tasks-file.js';

export { parseTasksFile };

const api = () => window.electronAPI;
const TASKS_DIR = '.theta';
const TASKS_FILE = 'tasks.json';
let last = null;
let hooks = { runFile: () => {}, runTests: () => {} };

const sep = (root) => (root.includes('\\') ? '\\' : '/');
const tasksPath = (root) => `${root}${sep(root)}${TASKS_DIR}${sep(root)}${TASKS_FILE}`;

/** How to call a program in this shell: PowerShell needs & "path". */
function call(exe, args, shell) {
  const quoted = /\s/.test(exe) ? `"${exe}"` : exe;
  return shell === 'powershell' ? `& ${quoted} ${args}` : `${quoted} ${args}`;
}

async function projectTasks() {
  const root = getWorkspaceRoot();
  if (!root) return { tasks: [], error: null };
  const res = await api()?.wsRead?.(tasksPath(root));
  if (!res?.ok) return { tasks: [], error: null }; // no file: fine
  return parseTasksFile(res.value);
}

async function builtIns() {
  const tools = (await api()?.toolPaths?.()) || {};
  const shell = tools.shell;
  const out = [
    { label: 'Run the current file', detail: 'Same as the Run button', run: () => hooks.runFile() },
    { label: 'Run all tests', detail: 'pytest, results in the Tests view', run: () => hooks.runTests() },
  ];
  if (tools.ruff) {
    out.push(
      { label: 'Lint the project (Ruff)', detail: 'ruff check .', command: call(tools.ruff, 'check .', shell) },
      { label: 'Fix what Ruff can fix', detail: 'ruff check --fix .', command: call(tools.ruff, 'check --fix .', shell) },
      { label: 'Format the project (Ruff)', detail: 'ruff format .', command: call(tools.ruff, 'format .', shell) },
    );
  }
  out.push({ label: 'Install requirements.txt', detail: 'Into the chosen Python', run: installRequirements });
  if (tools.python) out.push({ label: 'Show the Python version and packages', detail: 'python -m pip list', command: `${call(tools.python, '--version', shell)}; ${call(tools.python, '-m pip list', shell)}` });
  return out;
}

async function installRequirements() {
  switchPane('terminal');
  try {
    const res = await api().pyInstallRequirements();
    showToast(res?.ok ? 'Requirements installed' : 'Some requirements could not be installed: see the Output', res?.ok ? 'success' : 'error', 2600);
  } catch (err) {
    showToast(String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error', 3000);
  }
}

/** Run one task. */
export async function runTask(task) {
  last = task;
  if (task.run) { task.run(); return; }
  if (!api()?.shellInput) { showToast('Tasks need the desktop app', 'info', 2000); return; }
  switchPane('shell');
  const ok = await state.shell?.run(task.command);
  if (!ok) showToast('The terminal could not start', 'error', 2400);
}

export function runLastTask() {
  if (last) runTask(last);
  else openTasks();
}

/** "Run Task…": the built-in tasks and the project's own. */
export async function openTasks() {
  const [mine, built] = await Promise.all([projectTasks(), builtIns()]);
  if (mine.error) showToast(mine.error, 'error', 3500);
  const items = [];
  if (mine.tasks.length) {
    items.push({ separator: 'This project (.theta/tasks.json)' });
    for (const t of mine.tasks) items.push({ label: t.label, description: t.detail || t.command, run: () => runTask(t) });
  }
  items.push({ separator: 'Built in' });
  for (const t of built) items.push({ label: t.label, description: t.detail, run: () => runTask(t) });
  items.push({ separator: '' }, { label: 'Configure tasks…', description: mine.tasks.length ? 'Edit .theta/tasks.json' : 'Add your own commands', run: configureTasks });
  openQuickPick({ title: 'Run a task', items });
}

/** Open .theta/tasks.json, creating it with an example the first time. */
export async function configureTasks() {
  const root = getWorkspaceRoot();
  if (!root) { showToast('Open a project folder to add tasks to it', 'info', 2200); return; }
  const file = tasksPath(root);
  const exists = await api()?.wsRead?.(file);
  if (!exists?.ok) {
    await api()?.wsCreate?.(root, TASKS_DIR, 'folder');
    await api()?.wsCreate?.(`${root}${sep(root)}${TASKS_DIR}`, TASKS_FILE, 'file');
    const example = `${JSON.stringify({
      tasks: [
        { label: 'Run main.py', command: 'python main.py' },
        { label: 'Run tests with details', command: 'python -m pytest -v' },
      ],
    }, null, 2)}\n`;
    const res = await api()?.saveFile?.(file, example);
    if (res?.error) { showToast(`Could not create tasks.json: ${res.error}`, 'error', 3000); return; }
  }
  await openPath(file);
}

export function initTasks(h) { hooks = { ...hooks, ...h }; }
