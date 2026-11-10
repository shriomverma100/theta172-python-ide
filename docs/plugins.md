# Writing plugins for Python by THETA172

A plugin adds commands, status-bar text, panels and small helpers to the IDE.
It is a folder with two files:

```
my-plugin/
  theta-plugin.json   what the plugin is and what it may do
  plugin.js           its code
```

Three complete examples are in [`examples/plugins`](../examples/plugins):
**Word Count** (status bar + a command), **TODO Finder** (reads the project,
shows a panel) and **Run Coach** (listens to runs, keeps its own data).

## Try one

1. **Plugins → Manage Plugins…** (or the command palette: *Plugins: Manage Plugins…*).
2. **Install from folder…** and pick `examples/plugins/word-count`.
3. **Turn on.** The app lists what the plugin will be able to do; agree, and it starts.

While you write a plugin, use **Load a plugin I am writing…** instead: the app
uses your folder in place, and **Reload** picks up your changes.

## theta-plugin.json

```json
{
  "id": "word-count",
  "name": "Word Count",
  "version": "1.0.0",
  "description": "Shows the lines and words of the open file.",
  "author": "Your name",
  "main": "plugin.js",
  "apiVersion": 1,
  "permissions": ["editor.read"]
}
```

| Field | |
|---|---|
| `id` | 2–41 lower-case letters, digits or dashes. Unique. |
| `name`, `version` | Shown in the Plugins window. Version like `1.0.0`. |
| `main` | The `.js` file inside the folder (default `plugin.js`). |
| `apiVersion` | `1` for this version of the app. |
| `permissions` | What the plugin needs (below). Ask only for what you use. |

### Permissions

| Permission | Lets the plugin |
|---|---|
| *(none)* | add commands, show messages, input boxes and pick lists, set status-bar text, keep its own storage, write to its log |
| `editor.read` | read the open file's code, selection, name and cursor; hear when it changes or is saved |
| `editor.write` | insert text, replace the selection or the whole file |
| `runs` | hear when a program finishes: did it work, the error, what it printed |
| `workspace.read` | list and read files in the open project folder, open a file in the editor |
| `workspace.write` | create and change files in the open project folder |
| `panel` | show a panel of HTML with buttons |

You see these, in plain words, before a plugin is turned on.

## How plugins run (and what they cannot do)

Each plugin runs in its own **sandboxed worker**: no access to the app's
page, to Node.js or to Electron. Before the plugin's code starts, the worker
removes `fetch`, `XMLHttpRequest`, `WebSocket`, `importScripts`, IndexedDB and
nested workers. The only way to do anything is the `theta` object, and the
app checks each request against the permissions you allowed. Plugins cannot
reach the internet, run programs, or touch files outside the open project.

Panels are HTML, not pages: the app removes scripts, styles, event handlers,
remote images and links that run code. Buttons with `data-action="name"`
send `name` back to the plugin.

## The `theta` API

`plugin.js` runs once when the plugin is turned on. It may use `await` at the
top level. Every call returns a promise.

```js
// Commands: in the command palette and the Plugins menu
theta.commands.register('hello', 'Say hello', async () => {
  await theta.window.showMessage('Hello!', 'success');   // 'info' | 'success' | 'error'
});

// Asking
const name = await theta.window.showInput({ title: 'Your name', value: '' });   // null if cancelled
const pick = await theta.window.showQuickPick(['Small', 'Large'], { title: 'Size' }); // { index, label } or null

// Status bar (Pro) / run rail (Playground)
await theta.statusBar.set('count', '42 words', 'Words in this file');
await theta.statusBar.remove('count');

// Your plugin's log (Plugins window → Log)
await theta.log('started', { version: theta.plugin.version });

// Your plugin's own storage (up to 256 KB)
await theta.storage.set('settings', { size: 'large' });
const settings = await theta.storage.get('settings');
```

### Editor (`editor.read`, `editor.write`)

```js
const code = await theta.editor.getText();
const selected = await theta.editor.getSelection();
const file = await theta.editor.getFileName();
const { line, column } = await theta.editor.getCursor();
theta.editor.onChange(({ fileName }) => { /* typing paused */ });
theta.editor.onSave(({ path }) => { /* a file was saved */ });

await theta.editor.insertText('# hello\n');      // editor.write
await theta.editor.replaceSelection('new text');  // editor.write
await theta.editor.setText(code.toUpperCase());   // editor.write
```

### Runs (`runs`)

```js
theta.runs.onFinish(({ ok, fileName, durationMs, stdout, error }) => {
  // error: { type: 'NameError', message: "name 'x' is not defined", line: 3 } when it failed
});
```

### Project files (`workspace.read`, `workspace.write`)

Paths are relative to the project folder and cannot leave it.

```js
const files = await theta.workspace.listFiles('src');     // [{ name, type: 'file' | 'dir', path }]
const text = await theta.workspace.readFile('data/scores.csv');
await theta.workspace.openFile('src/main.py', 12);        // open at line 12
await theta.workspace.writeFile('notes/todo.md', '- try the plugin API\n'); // workspace.write
```

### Panels (`panel`)

```js
await theta.ui.showPanel({
  title: 'Results',
  html: '<h3>3 things to do</h3><button data-action="refresh">Refresh</button>',
});
theta.ui.onAction(({ action }) => { if (action === 'refresh') { /* … */ } });
await theta.ui.closePanel();
```

## Errors

An error a plugin throws (or a rejected promise it does not handle) is shown
in the Plugins window and in the plugin's log; the app keeps running. A call
the plugin is not allowed to make is rejected with a message naming the
missing permission.

## Limits

- 30 commands, 5 messages per 10 seconds, status text of 60 characters.
- 256 KB of storage; a 2 MB main file; 200 files and 5 MB per plugin folder.
- No network access in API version 1.
