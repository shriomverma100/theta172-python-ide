/**
 * THETA172 — plugin manifests (theta-plugin.json): what a plugin is and
 * what it may do. Pure checks, shared by the plugin store and the tests.
 *
 * {
 *   "id": "word-count",                 lower-case letters, digits, dashes
 *   "name": "Word Count",
 *   "version": "1.0.0",
 *   "description": "Shows words and lines of the open file.",
 *   "author": "Asha",
 *   "main": "plugin.js",                a .js file inside the plugin folder
 *   "apiVersion": 1,
 *   "permissions": ["editor.read"]
 * }
 */

'use strict';

const API_VERSION = 1;

/** What a plugin can ask for, in plain words (shown before you turn it on). */
const PERMISSIONS = {
  'editor.read': 'Read the code in the open file',
  'editor.write': 'Change the code in the open file',
  'runs': 'See when your programs run and what they print',
  'workspace.read': 'Read files in the open project folder',
  'workspace.write': 'Create and change files in the open project folder',
  'panel': 'Show its own panel (a sandboxed page)',
};

const ID_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}([-+][\w.-]{1,40})?$/;
const MAIN_RE = /^(?!.*\.\.)[\w./-]{1,120}\.js$/;

const str = (v, max) => (typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, max) : '');

/**
 * @param {unknown} raw  the parsed theta-plugin.json
 * @returns {{ ok: true, manifest: object } | { ok: false, errors: string[] }}
 */
function validateManifest(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['theta-plugin.json must be a JSON object.'] };
  const id = typeof raw.id === 'string' ? raw.id : '';
  if (!ID_RE.test(id)) errors.push('"id" must be 2–41 lower-case letters, digits or dashes, e.g. "word-count".');
  const name = str(raw.name, 60);
  if (!name) errors.push('"name" is missing.');
  const version = typeof raw.version === 'string' ? raw.version : '';
  if (!VERSION_RE.test(version)) errors.push('"version" must look like 1.0.0.');
  const main = typeof raw.main === 'string' ? raw.main.replace(/\\/g, '/') : 'plugin.js';
  if (!MAIN_RE.test(main) || main.startsWith('/')) errors.push('"main" must be a .js file inside the plugin folder.');
  const apiVersion = raw.apiVersion === undefined ? API_VERSION : raw.apiVersion;
  if (apiVersion !== API_VERSION) errors.push(`This plugin needs plugin API version ${apiVersion}; this app has version ${API_VERSION}.`);
  const permissions = raw.permissions === undefined ? [] : raw.permissions;
  if (!Array.isArray(permissions)) errors.push('"permissions" must be a list.');
  else for (const p of permissions) if (!PERMISSIONS[p]) errors.push(`Unknown permission "${p}". Known: ${Object.keys(PERMISSIONS).join(', ')}.`);
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    manifest: {
      id, name, version, main, apiVersion,
      description: str(raw.description, 300),
      author: str(raw.author, 80),
      homepage: /^https:\/\/[^\s]{3,200}$/.test(raw.homepage || '') ? raw.homepage : '',
      permissions: [...new Set(permissions)],
    },
  };
}

module.exports = { validateManifest, PERMISSIONS, API_VERSION };
