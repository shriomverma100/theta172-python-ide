/** Plugin permission rules (pure, shared by the plugin host and the tests). */

/** Which permission each request needs (none listed = always allowed). */
export const NEEDS = {
  'editor.getText': 'editor.read', 'editor.getSelection': 'editor.read', 'editor.getFileName': 'editor.read', 'editor.getCursor': 'editor.read',
  'editor.insertText': 'editor.write', 'editor.replaceSelection': 'editor.write', 'editor.setText': 'editor.write',
  'workspace.root': 'workspace.read', 'workspace.readFile': 'workspace.read', 'workspace.listFiles': 'workspace.read', 'workspace.openFile': 'workspace.read',
  'workspace.writeFile': 'workspace.write',
  'ui.showPanel': 'panel', 'ui.closePanel': 'panel',
};

/** Which permission each event needs. */
export const EVENT_NEEDS = { 'editor.change': 'editor.read', 'file.save': 'editor.read', 'run.finish': 'runs', 'panel.action': 'panel' };

/** May a plugin with these permissions make this request? */
export function allowed(method, granted) {
  const need = NEEDS[method];
  return !need || granted.has(need);
}

/** A project-relative path that stays inside the project, or null. */
export function safeRelative(rel) {
  const r = String(rel || '').replace(/\\/g, '/').replace(/^\.\//, '');
  // eslint-disable-next-line no-control-regex
  if (!r || r.startsWith('/') || /^[a-zA-Z]:/.test(r) || r.split('/').some((p) => p === '..') || /[<>:"|?*\x00-\x1f]/.test(r) || r.length > 400) return null;
  return r;
}
