// Word Count — a THETA172 plugin.
// Runs once when the plugin is turned on; `theta` is the plugin API.

const count = (text) => ({
  lines: text ? text.split('\n').length : 0,
  words: (text.match(/[A-Za-z_][\w']*/g) || []).length,
});

async function update() {
  const text = await theta.editor.getText();
  const { lines, words } = count(text);
  await theta.statusBar.set('count', `${lines} lines · ${words} words`, 'Lines and words in this file');
}

theta.editor.onChange(update);
update();

theta.commands.register('count-selection', 'Count words in the selection', async () => {
  const text = await theta.editor.getSelection();
  if (!text) {
    await theta.window.showMessage('Select some code first.');
    return;
  }
  const { lines, words } = count(text);
  await theta.window.showMessage(`${words} words on ${lines} lines`, 'success');
});
