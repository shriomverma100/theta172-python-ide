// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NEEDS, EVENT_NEEDS, allowed, safeRelative } from '../src/plugins/plugin-rules.js';
import { sanitizeHTML } from '../src/core/sanitize-html.js';

const require = createRequire(import.meta.url);
const { validateManifest, PERMISSIONS } = require('../electron/plugin-manifest.cjs');
const { PluginStore } = require('../electron/plugin-host.cjs');

const good = { id: 'word-count', name: 'Word Count', version: '1.0.0', main: 'plugin.js', permissions: ['editor.read'] };
const temp = [];
afterEach(() => { for (const d of temp.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'theta-plug-')); temp.push(d); return d; };

function pluginFolder(manifest = good, code = 'theta.log("hi")') {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'theta-plugin.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir, manifest.main || 'plugin.js'), code);
  fs.writeFileSync(path.join(dir, 'README.md'), '# readme');
  fs.writeFileSync(path.join(dir, 'secret.exe'), 'not copied');
  return dir;
}

describe('plugin manifests', () => {
  it('accepts a good manifest and fills in defaults', () => {
    const res = validateManifest(good);
    expect(res.ok).toBe(true);
    expect(res.manifest).toMatchObject({ id: 'word-count', apiVersion: 1, permissions: ['editor.read'], description: '' });
  });

  it('explains every problem', () => {
    const res = validateManifest({ id: 'Bad Id', version: 'one', main: '../escape.js', permissions: ['root'], apiVersion: 9 });
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toMatch(/"id"/);
    expect(res.errors.join(' ')).toMatch(/"name" is missing/);
    expect(res.errors.join(' ')).toMatch(/version/);
    expect(res.errors.join(' ')).toMatch(/inside the plugin folder/);
    expect(res.errors.join(' ')).toMatch(/Unknown permission "root"/);
    expect(res.errors.join(' ')).toMatch(/API version 9/);
    expect(validateManifest(null).ok).toBe(false);
  });

  it('every permission has plain words, and every request maps to a known permission', () => {
    for (const p of Object.values(NEEDS)) expect(PERMISSIONS[p]).toBeTruthy();
    for (const p of Object.values(EVENT_NEEDS)) expect(PERMISSIONS[p]).toBeTruthy();
  });
});

describe('plugin permissions', () => {
  it('allows only what was granted', () => {
    const g = new Set(['editor.read']);
    expect(allowed('editor.getText', g)).toBe(true);
    expect(allowed('editor.setText', g)).toBe(false);
    expect(allowed('workspace.readFile', g)).toBe(false);
    expect(allowed('window.showMessage', g)).toBe(true); // needs nothing
  });

  it('keeps file paths inside the project', () => {
    expect(safeRelative('data/scores.csv')).toBe('data/scores.csv');
    expect(safeRelative('.\\src\\a.py')).toBe('src/a.py');
    for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'C:\\Windows\\x', 'a\u0000b', '']) expect(safeRelative(bad)).toBe(null);
  });

  it('panel HTML keeps action buttons but nothing that runs code', () => {
    const out = sanitizeHTML('<button data-action="open-1" onclick="x()">Open</button><button data-action="bad action!">x</button><script>alert(1)</script><img src="https://x/y.png"><a href="javascript:alert(1)">l</a>', document, { actions: true });
    expect(out).toContain('<button data-action="open-1" type="button">Open</button>');
    expect(out).toContain('<button type="button">x</button>');
    expect(out).not.toMatch(/onclick|script|javascript|https:\/\/x/);
    expect(sanitizeHTML('<button data-action="a">b</button>', document)).toBe(''); // only for plugin panels
  });
});

describe('the plugin store', () => {
  it('installs a copy (only plugin files), turns it on with allowed permissions, and removes it', () => {
    const store = new PluginStore({ userData: tmp() });
    const res = store.install(pluginFolder());
    expect(res.ok).toBe(true);
    const copied = fs.readdirSync(path.join(store.dir, 'word-count')).sort();
    expect(copied).toEqual(['README.md', 'plugin.js', 'theta-plugin.json']);
    expect(store.list()[0]).toMatchObject({ id: 'word-count', ok: true, enabled: false });
    expect(() => store.code('word-count')).toThrow(/off/);
    store.setEnabled('word-count', true, ['editor.read', 'workspace.write']); // only what the manifest asks for counts
    const c = store.code('word-count');
    expect(c.granted).toEqual(['editor.read']);
    expect(c.code).toBe('theta.log("hi")');
    store.storageSet('word-count', { n: 1 });
    expect(store.storageGet('word-count')).toEqual({ n: 1 });
    expect(() => store.storageSet('word-count', { big: 'x'.repeat(300_000) })).toThrow(/256 KB/);
    store.remove('word-count');
    expect(store.list()).toEqual([]);
    expect(fs.existsSync(path.join(store.dir, 'word-count'))).toBe(false);
  });

  it('loads a developer plugin from its folder and keeps the folder on remove', () => {
    const store = new PluginStore({ userData: tmp() });
    const dir = pluginFolder({ ...good, id: 'my-plugin' }, 'v1');
    expect(store.link(dir).ok).toBe(true);
    store.setEnabled('my-plugin', true, []);
    fs.writeFileSync(path.join(dir, 'plugin.js'), 'v2'); // edited: the next load sees it
    expect(store.code('my-plugin').code).toBe('v2');
    expect(store.list()[0].dev).toBe(true);
    store.remove('my-plugin');
    expect(fs.existsSync(dir)).toBe(true);
  });

  it('refuses folders that are not plugins', () => {
    const store = new PluginStore({ userData: tmp() });
    expect(store.install(tmp()).errors[0]).toMatch(/no theta-plugin.json/);
    const noMain = tmp();
    fs.writeFileSync(path.join(noMain, 'theta-plugin.json'), JSON.stringify(good));
    expect(store.install(noMain).errors[0]).toMatch(/main file/);
  });

  it('the example plugins are valid', () => {
    for (const name of ['word-count', 'todo-finder', 'run-coach']) {
      const store = new PluginStore({ userData: tmp() });
      const res = store.readFolder(path.resolve('examples/plugins', name));
      expect(res.ok, name).toBe(true);
    }
  });
});
