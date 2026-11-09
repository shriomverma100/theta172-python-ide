/**
 * The Python interpreter the app uses (desktop only).
 *
 * The main process discovers interpreters and owns the choice; this module
 * shows it (status bar, run rail), offers the picker, installs packages into
 * it and offers a fix when a run fails with ModuleNotFoundError.
 */
import { $ } from '../core/dom.js';
import { showToast } from '../toast.js';
import { isValidPackageSpec } from '../core/package-spec.js';
import { missingModule, packageForModule } from '../core/module-map.js';
import { state } from './state.js';
import { onWorkspaceChange } from './workspace.js';
import { openQuickPick } from './quick-pick.js';

const KIND_LABEL = { project: 'project env', default: 'THETA172 env', bundled: 'built in', system: 'system', conda: 'conda' };

let py = { active: null, list: [], root: null, hasUv: false };
let busy = false;
const listeners = new Set();
const api = () => window.electronAPI;

export function getInterpreter() { return py.active; }
export function onInterpreterChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function isInstalling() { return busy; }

function apply(next) {
  if (!next) return;
  const prev = py.active?.path;
  py = next;
  renderLabels();
  if (prev !== py.active?.path) listeners.forEach((fn) => fn(py.active));
}

function renderLabels() {
  const a = py.active;
  const version = a ? a.version : '—';
  const kind = a ? (a.kind === 'project' ? a.envName : KIND_LABEL[a.kind] || a.kind) : 'none';
  const $ver = $('python-version');
  const $type = $('runtime-type');
  const $rail = $('runbar-runtime');
  if ($ver) $ver.textContent = version;
  if ($type) $type.textContent = kind;
  if ($rail) $rail.textContent = a ? `Python ${version} · ${kind}` : 'Choose Python';
  const tip = a ? `${a.label}\n${a.path}\nClick to change` : 'Choose a Python interpreter';
  document.querySelectorAll('[data-interpreter]').forEach((el) => { el.title = tip; });
}

/**
 * Prepare and pick the interpreter (creates the default environment on the
 * first start). Resolves with the active interpreter or null.
 */
export async function initInterpreter({ onStatus } = {}) {
  const a = api();
  if (!a?.pyInit) return null;
  a.onPyStatus?.((text) => onStatus?.(text));
  a.onPyLog?.((text) => state.terminal?.writeSystem(text));
  a.onPyChanged?.((st) => apply(st));
  document.querySelectorAll('[data-interpreter]').forEach((el) => el.addEventListener('click', showInterpreterPicker));

  let lastRoot;
  onWorkspaceChange(({ root }) => {
    if (root === lastRoot) return;
    lastRoot = root;
    refreshInterpreters({ rescan: false });
  });

  apply(await a.pyInit());
  lastRoot = py.root;
  return py.active;
}

export async function refreshInterpreters({ rescan = true } = {}) {
  try { apply(await api().pyList(rescan)); } catch (err) { showToast(err.message, 'error', 3000); }
  return py;
}

// ── Picker ───────────────────────────────────────────────────────

export async function showInterpreterPicker() {
  if (!api()?.pyList) {
    showToast('The browser version runs Python in WebAssembly only.', 'info', 2600);
    return;
  }
  await refreshInterpreters();
  const items = py.list.map((i) => ({
    label: `Python ${i.version}`,
    description: i.kind === 'project' ? `${i.envName} · this project` : KIND_LABEL[i.kind],
    detail: i.path,
    checked: i.path === py.active?.path,
    run: () => selectInterpreter(i.path),
  }));
  const actions = [];
  if (py.root && !py.list.some((i) => i.kind === 'project')) {
    actions.push({ label: 'Create a .venv for this project', description: 'own packages for this folder', run: createProjectEnv });
  }
  if (py.hasRequirements) actions.push({ label: 'Install requirements.txt', description: 'into the selected Python', run: installRequirements });
  actions.push({ label: 'Refresh list', run: () => refreshInterpreters().then(() => showToast('Python list refreshed', 'info', 1400)) });
  openQuickPick({
    title: 'Select the Python to run your code',
    items: [{ separator: 'Interpreters' }, ...items, { separator: 'Environment' }, ...actions],
  });
}

async function selectInterpreter(path) {
  try {
    apply(await api().pySelect(path));
    showToast(`Using ${py.active.label}`, 'success', 1800);
  } catch (err) {
    showToast(err.message, 'error', 3000);
  }
}

async function createProjectEnv() {
  if (!(await guard('Creating .venv…'))) return;
  try {
    apply(await api().pyCreateEnv());
    showToast('Project environment ready', 'success', 2200);
  } catch (err) {
    showToast(err.message, 'error', 3200);
  } finally {
    done();
  }
}

async function installRequirements() {
  if (!(await guard('Installing requirements.txt…'))) return;
  try {
    const res = await api().pyInstallRequirements();
    showToast(res.ok ? 'Requirements installed' : 'Some requirements failed. See the terminal.', res.ok ? 'success' : 'error', 2800);
    if (res.ok) state.pipManager?.refreshList?.();
  } catch (err) {
    showToast(err.message, 'error', 3200);
  } finally {
    done();
  }
}

// ── Installing ───────────────────────────────────────────────────

async function guard(statusText) {
  if (busy) {
    showToast('Another install is still running', 'info', 1800);
    return false;
  }
  busy = true;
  setPipStatus(statusText, 'installing');
  state.terminal?.writeSystem(`\n[python] ${statusText}\n`);
  return true;
}

function done(text = '', kind = '') {
  busy = false;
  setPipStatus(text, kind);
  if (text) setTimeout(() => setPipStatus(''), 4000);
}

function setPipStatus(text, kind = '') {
  const $s = $('pip-status');
  if (!$s) return;
  $s.textContent = text;
  $s.className = `pip-bar__status${kind ? ` ${kind}` : ''}`;
}

/** Install packages into the active interpreter. Resolves true on success. */
export async function installPackages(specs) {
  if (!specs.length || !specs.every(isValidPackageSpec)) {
    showToast('Invalid package name', 'error', 2400);
    return false;
  }
  if (!(await guard(`Installing ${specs.join(', ')}…`))) return false;
  try {
    const res = await api().pyInstall(specs);
    done(res.ok ? `${specs.join(', ')} installed` : 'Install failed', res.ok ? 'success' : 'error');
    showToast(res.ok ? `${specs.join(', ')} installed` : `Could not install ${specs.join(', ')}. See the terminal.`, res.ok ? 'success' : 'error', 2600);
    return res.ok;
  } catch (err) {
    done('Install failed', 'error');
    showToast(err.message, 'error', 3000);
    return false;
  }
}

export async function uninstallPackage(name) {
  if (!(await guard(`Removing ${name}…`))) return false;
  try {
    const res = await api().pyUninstall(name);
    done(res.ok ? `${name} removed` : 'Remove failed', res.ok ? 'success' : 'error');
    return res.ok;
  } catch (err) {
    done('Remove failed', 'error');
    showToast(err.message, 'error', 3000);
    return false;
  }
}

export async function checkEnvironment() {
  try {
    const res = await api().pyCheck();
    state.terminal?.writeSystem(`\n[python] Environment check\n${res.output}\n`);
    showToast(res.ok ? 'No conflicts between installed packages' : 'Some packages conflict. See the terminal.', res.ok ? 'success' : 'error', 2800);
    return res;
  } catch (err) {
    showToast(err.message, 'error', 3000);
    return null;
  }
}

// ── ModuleNotFoundError fix bar ──────────────────────────────────

let pendingModule = null;

/** Called with each chunk of a run's stderr. */
export function noteRunError(text) {
  const mod = missingModule(text);
  if (mod) pendingModule = mod;
}

export function resetRunErrors() {
  pendingModule = null;
  hideFixBar();
}

/** Called when a run ends; offers a fix for a missing module. */
export function offerFixes({ failed, rerun }) {
  if (!failed || !pendingModule) return;
  showFixBar(pendingModule, rerun);
}

export function hideFixBar() {
  $('fix-bar')?.classList.add('hidden');
}

function showFixBar(module, rerun) {
  const $bar = $('fix-bar');
  const $text = $('fix-bar-text');
  const $btn = $('fix-bar-install');
  if (!$bar || !$text || !$btn) return;
  const fix = packageForModule(module);
  const local = state.useLocalPython;
  $bar.classList.remove('hidden', 'fix-bar--done');
  $btn.disabled = false;

  if (!fix.package) {
    $text.textContent = fix.hint;
    $btn.classList.add('hidden');
    return;
  }
  const where = local && py.active ? ` in Python ${py.active.version}` : '';
  $text.textContent = fix.package === module
    ? `"${module}" is not installed${where}.`
    : `"${module}" comes from the package ${fix.package}, which is not installed${where}.`;
  $btn.classList.remove('hidden');
  $btn.textContent = `Install ${fix.package}`;
  $btn.onclick = async () => {
    $btn.disabled = true;
    $btn.textContent = `Installing ${fix.package}…`;
    const ok = local
      ? await installPackages([fix.package])
      : await state.pipManager?.installInBrowser?.(fix.package);
    if (!ok) {
      $btn.disabled = false;
      $btn.textContent = `Retry installing ${fix.package}`;
      return;
    }
    $bar.classList.add('fix-bar--done');
    $text.textContent = `${fix.package} is installed.`;
    $btn.disabled = false;
    $btn.textContent = 'Run again';
    $btn.onclick = () => { hideFixBar(); rerun?.(); };
    state.pipManager?.refreshList?.();
  };
}

export function initFixBar() {
  $('fix-bar-close')?.addEventListener('click', hideFixBar);
}
