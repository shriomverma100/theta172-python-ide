/**
 * THETA. — Packages panel.
 *
 * Desktop: installs into, lists and removes packages from the selected
 * interpreter (see app/interpreter.js), and can check for conflicts.
 * Browser (Pyodide): installs with micropip; the list shows this session's
 * installs.
 */

import { showToast } from './toast.js';
import { logoEl } from './core/tech-logos.js';
import { isValidPackageSpec } from './core/package-spec.js';
import {
  installPackages, uninstallPackage, checkEnvironment, showInterpreterPicker, getInterpreter, onInterpreterChange,
} from './app/interpreter.js';

export class PipManager {
  constructor() {
    this.sessionPackages = []; // Pyodide: { name, version }
    this.packages = [];        // what the list shows
    this.loading = false;
    this.filter = '';

    // External references (set by main app)
    this.terminal = null;
    this.workerManager = null;
    this.useLocalPython = false;
  }

  init() {
    const $ = (id) => document.getElementById(id);
    this.$input = $('pip-input');
    this.$panel = $('pip-packages-panel');
    this.$list = $('pip-packages-list');
    this.$env = $('pip-env');
    this.$filter = $('pip-filter');

    this.$input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.handleInstall();
      }
    });
    $('pip-install-btn')?.addEventListener('click', () => this.handleInstall());
    $('pip-list-btn')?.addEventListener('click', () => this.toggle());
    $('pip-packages-close')?.addEventListener('click', () => this.toggle(false));
    $('pip-check')?.addEventListener('click', () => checkEnvironment());
    this.$env?.addEventListener('click', () => showInterpreterPicker());
    this.$filter?.addEventListener('input', () => {
      this.filter = this.$filter.value.trim().toLowerCase();
      this.renderList();
    });
    onInterpreterChange(() => {
      this.renderEnv();
      if (this.isOpen) this.refreshList();
    });
  }

  get isOpen() { return !!this.$panel && !this.$panel.classList.contains('hidden'); }

  toggle(force) {
    const open = force ?? !this.isOpen;
    this.$panel?.classList.toggle('hidden', !open);
    if (open) {
      this.renderEnv();
      this.refreshList();
    }
  }

  renderEnv() {
    const local = this.useLocalPython;
    document.getElementById('pip-check')?.classList.toggle('hidden', !local);
    if (!this.$env) return;
    const a = getInterpreter();
    this.$env.disabled = !local;
    this.$env.textContent = local ? (a ? a.label : 'Choose Python') : 'Browser Python (Pyodide)';
    this.$env.title = local && a ? `${a.path}\nClick to change` : '';
  }

  async refreshList() {
    if (!this.useLocalPython) {
      this.packages = this.sessionPackages;
      this.renderList();
      return;
    }
    if (!getInterpreter()) {
      this.packages = [];
      this.renderList('Choose a Python first.');
      return;
    }
    this.loading = true;
    this.renderList();
    try {
      this.packages = await window.electronAPI.pyPackages();
      this.loading = false;
      this.renderList();
    } catch (err) {
      this.loading = false;
      this.packages = [];
      this.renderList(err.message);
    }
  }

  async handleInstall() {
    const specs = (this.$input?.value || '').trim().split(/[\s,]+/).filter(Boolean);
    if (!specs.length) return;
    if (!specs.every(isValidPackageSpec)) {
      showToast('Invalid package name', 'error', 2500);
      return;
    }

    if (this.useLocalPython) {
      this.$input.value = '';
      const ok = await installPackages(specs);
      if (ok && this.isOpen) this.refreshList();
      if (!ok) this.$input.value = specs.join(' ');
      return;
    }

    if (!this.workerManager?.isReady) {
      showToast('Python runtime not ready yet', 'error', 2000);
      return;
    }
    this.$input.value = '';
    for (const spec of specs) await this.installInBrowser(spec);
  }

  /** Pyodide: install one package with micropip. Resolves true on success. */
  async installInBrowser(spec) {
    if (!this.workerManager?.isReady) return false;
    const ok = await this.workerManager.installPackage(spec);
    if (ok) {
      const name = spec.split(/[=<>!~[]/)[0];
      const i = this.sessionPackages.findIndex((p) => p.name.toLowerCase() === name.toLowerCase());
      if (i >= 0) this.sessionPackages[i].version = 'latest';
      else this.sessionPackages.push({ name, version: 'latest' });
      if (this.isOpen) this.refreshList();
    }
    return ok;
  }

  async remove(name) {
    if (!window.confirm(`Remove ${name} from ${getInterpreter()?.label || 'this Python'}?`)) return;
    const ok = await uninstallPackage(name);
    showToast(ok ? `${name} removed` : `Could not remove ${name}. See the terminal.`, ok ? 'info' : 'error', 2200);
    if (ok) this.refreshList();
  }

  renderList(message) {
    const $list = this.$list;
    if (!$list) return;
    $list.textContent = '';
    const note = (text) => {
      const el = document.createElement('span');
      el.className = 'pip-packages-empty';
      el.textContent = text;
      $list.appendChild(el);
    };
    if (message) return note(message);
    if (this.loading && !this.packages.length) return note('Reading installed packages…');

    const shown = this.filter
      ? this.packages.filter((p) => p.name.toLowerCase().includes(this.filter))
      : this.packages;
    const $count = document.getElementById('pip-count');
    if ($count) $count.textContent = this.packages.length ? String(this.packages.length) : '';
    if (!this.packages.length) return note(this.useLocalPython ? 'No packages installed yet.' : 'No packages installed in this session yet.');
    if (!shown.length) return note(`No installed package matches "${this.filter}".`);

    for (const pkg of shown) {
      const item = document.createElement('div');
      item.className = 'pip-package-item';
      const left = document.createElement('span');
      const nameSpan = document.createElement('span');
      nameSpan.className = 'pip-package-item__name';
      nameSpan.textContent = pkg.name;
      const verSpan = document.createElement('span');
      verSpan.className = 'pip-package-item__version';
      verSpan.textContent = pkg.version;
      left.className = 'pip-package-item__left';
      const logo = logoEl(pkg.name, 16);
      if (logo) left.append(logo);
      left.append(nameSpan, verSpan);
      item.appendChild(left);

      if (this.useLocalPython && !/^(pip|setuptools|uv)$/i.test(pkg.name)) {
        const unBtn = document.createElement('button');
        unBtn.type = 'button';
        unBtn.className = 'pip-package-item__uninstall';
        unBtn.textContent = 'Remove';
        unBtn.setAttribute('aria-label', `Remove ${pkg.name}`);
        unBtn.addEventListener('click', () => this.remove(pkg.name));
        item.appendChild(unBtn);
      }
      $list.appendChild(item);
    }
  }
}
