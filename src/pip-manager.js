/**
 * THETA. — Pip Manager
 * Handles package installation UI, validation, and installed packages list.
 */

import { showToast } from './toast.js';

// Valid PyPI package name regex — blocks shell injection, flags, metacharacters
const VALID_PKG = /^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?(([><=!~]=?|===?)[a-zA-Z0-9.*]+)?$/;

export class PipManager {
  constructor() {
    this.installedPackages = []; // { name, version }
    this.$input = null;
    this.$status = null;
    this.$listBtn = null;
    this.$panel = null;
    this.$panelClose = null;
    this.$installBtn = null;

    // External references (set by main app)
    this.terminal = null;
    this.workerManager = null;
    this.useLocalPython = false;
  }

  init() {
    const $ = (id) => document.getElementById(id);

    this.$input = $('pip-input');
    this.$status = $('pip-status');
    this.$listBtn = $('pip-list-btn');
    this.$panel = $('pip-packages-panel');
    this.$panelClose = $('pip-packages-close');
    this.$installBtn = $('pip-install-btn');

    // Enter key in input
    this.$input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.handleInstall();
      }
    });

    // Install button
    this.$installBtn?.addEventListener('click', () => this.handleInstall());

    // List panel toggle
    this.$listBtn?.addEventListener('click', () => {
      this.$panel?.classList.toggle('hidden');
    });

    this.$panelClose?.addEventListener('click', () => {
      this.$panel?.classList.add('hidden');
    });
  }

  handleInstall() {
    const pkg = this.$input?.value?.trim();
    if (!pkg) return;

    // Validate package name
    if (!VALID_PKG.test(pkg) || pkg.startsWith('-')) {
      showToast('Invalid package name', 'error', 2500);
      return;
    }

    if (this.useLocalPython) {
      this.$input.value = '';
      if (this.$status) {
        this.$status.textContent = `Installing ${pkg}...`;
        this.$status.className = 'pip-bar__status installing';
      }
      this.terminal?.writeSystem(`\n[pip] Installing "${pkg}"...\n`);
      window.electronAPI.pipInstall(pkg);
      this.addPackage(pkg, 'local');
      return;
    }

    if (!this.workerManager?.isReady) {
      showToast('Python runtime not ready yet', 'error', 2000);
      return;
    }

    this.$input.value = '';
    this.workerManager.installPackage(pkg);
    this.addPackage(pkg, 'latest');
  }

  addPackage(name, version) {
    const existing = this.installedPackages.findIndex(
      p => p.name.toLowerCase() === name.toLowerCase()
    );
    if (existing >= 0) {
      this.installedPackages[existing].version = version;
    } else {
      this.installedPackages.push({ name, version });
    }
    this.renderList();
  }

  removePackage(name) {
    const idx = this.installedPackages.findIndex(
      p => p.name.toLowerCase() === name.toLowerCase()
    );
    if (idx >= 0) {
      this.installedPackages.splice(idx, 1);
      this.renderList();
      showToast(`Removed: ${name}`, 'info', 1800);
    }
  }

  renderList() {
    const $list = document.getElementById('pip-packages-list');
    if (!$list) return;

    if (this.installedPackages.length === 0) {
      $list.innerHTML = '<span class="pip-packages-empty">No packages installed yet</span>';
      return;
    }

    $list.innerHTML = '';
    this.installedPackages.forEach(pkg => {
      const item = document.createElement('div');
      item.className = 'pip-package-item';

      const left = document.createElement('span');
      const nameSpan = document.createElement('span');
      nameSpan.className = 'pip-package-item__name';
      nameSpan.textContent = pkg.name;
      const verSpan = document.createElement('span');
      verSpan.className = 'pip-package-item__version';
      verSpan.textContent = pkg.version;
      left.appendChild(nameSpan);
      left.appendChild(verSpan);

      const unBtn = document.createElement('button');
      unBtn.className = 'pip-package-item__uninstall';
      unBtn.textContent = 'remove';
      unBtn.addEventListener('click', () => this.removePackage(pkg.name));

      item.appendChild(left);
      item.appendChild(unBtn);
      $list.appendChild(item);
    });
  }

  setStatus(text, className = '') {
    if (this.$status) {
      this.$status.textContent = text;
      this.$status.className = 'pip-bar__status' + (className ? ' ' + className : '');
    }
  }

  clearStatus(delay = 4000) {
    setTimeout(() => {
      if (this.$status) {
        this.$status.textContent = '';
        this.$status.className = 'pip-bar__status';
      }
    }, delay);
  }
}
