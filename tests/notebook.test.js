// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  parseNotebook, serializeNotebook, newNotebook, addMessage, applyControlChars, pickMime,
  splitLines, stripAnsi, toPythonScript, NotebookError, MAX_STREAM_CHARS,
} from '../src/notebook/model.js';
import { renderMarkdown } from '../src/notebook/markdown.js';
import { sanitizeHTML } from '../src/core/sanitize-html.js';

const require = createRequire(import.meta.url);
const { Kernel, kernelScript, MARK } = require('../electron/kernel.cjs');

const JUPYTER_NB = {
  cells: [
    { cell_type: 'markdown', id: 'intro', metadata: {}, source: ['# Title\n', 'Some *text*'] },
    {
      cell_type: 'code', execution_count: 3, id: 'c1', metadata: { tags: ['x'] },
      outputs: [
        { name: 'stdout', output_type: 'stream', text: ['hello\n', 'world\n'] },
        { data: { 'image/png': 'iVBORw0KGgo=', 'text/plain': ['<Figure>'] }, metadata: {}, output_type: 'display_data' },
        { data: { 'text/plain': ['42'] }, execution_count: 3, metadata: {}, output_type: 'execute_result' },
      ],
      source: ['print("hello")\n', 'print("world")'],
    },
    { cell_type: 'raw', id: 'r', metadata: {}, source: 'raw text' },
  ],
  metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' } },
  nbformat: 4,
  nbformat_minor: 5,
};

describe('reading and writing .ipynb', () => {
  it('reads Jupyter notebooks (lists of lines become text)', () => {
    const nb = parseNotebook(JSON.stringify(JUPYTER_NB));
    expect(nb.cells.map((c) => c.type)).toEqual(['markdown', 'code', 'raw']);
    expect(nb.cells[0].source).toBe('# Title\nSome *text*');
    expect(nb.cells[1].count).toBe(3);
    expect(nb.cells[1].outputs[0]).toEqual({ output_type: 'stream', name: 'stdout', text: 'hello\nworld\n' });
    expect(nb.cells[1].outputs[1].data['image/png']).toBe('iVBORw0KGgo=');
    expect(nb.cells[1].metadata.tags).toEqual(['x']);
  });

  it('writes what it read back unchanged (round trip)', () => {
    const text = serializeNotebook(parseNotebook(JSON.stringify(JUPYTER_NB)));
    const back = JSON.parse(text);
    expect(back.cells[1].source).toEqual(['print("hello")\n', 'print("world")']);
    expect(back.cells[1].outputs[0].text).toEqual(['hello\n', 'world\n']);
    expect(back.cells[1].outputs[1].data['image/png']).toBe('iVBORw0KGgo='); // pictures stay one string
    expect(back.cells[1].outputs[2].execution_count).toBe(3);
    expect(back.cells[0]).not.toHaveProperty('outputs');
    expect(back.nbformat).toBe(4);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toContain('\n "cells": [');
    // A second round trip is byte-identical
    expect(serializeNotebook(parseNotebook(text))).toBe(text);
  });

  it('opens an empty file as a new notebook with one code cell', () => {
    const nb = parseNotebook('');
    expect(nb.cells).toHaveLength(1);
    expect(nb.cells[0].type).toBe('code');
    expect(JSON.parse(serializeNotebook(newNotebook())).metadata.kernelspec.name).toBe('python3');
  });

  it('gives cells missing or duplicate ids fresh ones', () => {
    const nb = parseNotebook(JSON.stringify({ nbformat: 4, nbformat_minor: 2, metadata: {}, cells: [
      { cell_type: 'code', source: 'a', outputs: [] }, { cell_type: 'code', id: 'same', source: 'b' }, { cell_type: 'code', id: 'same', source: 'c' },
    ] }));
    const ids = nb.cells.map((c) => c.id);
    expect(new Set(ids).size).toBe(3);
    ids.forEach((id) => expect(id).toMatch(/^[\w-]{1,64}$/));
    expect(nb.nbformat_minor).toBe(5); // ids need 4.5
  });

  it('refuses things that are not notebooks', () => {
    expect(() => parseNotebook('{not json')).toThrow(NotebookError);
    expect(() => parseNotebook('{"a": 1}')).toThrow(/not a Jupyter notebook/);
    expect(() => parseNotebook('{"worksheets": [], "nbformat": 3}')).toThrow(/format 3/);
  });

  it('records the Python version it ran on', () => {
    const text = serializeNotebook(newNotebook(), { pythonVersion: '3.12.16' });
    expect(JSON.parse(text).metadata.language_info).toEqual({ name: 'python', version: '3.12.16' });
  });

  it('splits text into lines that keep their newline', () => {
    expect(splitLines('a\nb\n')).toEqual(['a\n', 'b\n']);
    expect(splitLines('a\nb')).toEqual(['a\n', 'b']);
    expect(splitLines('')).toEqual([]);
  });

  it('exports code and Markdown as a percent-format script', () => {
    const script = toPythonScript(parseNotebook(JSON.stringify(JUPYTER_NB)));
    expect(script).toBe('# %% [markdown]\n# # Title\n# Some *text*\n\n# %%\nprint("hello")\nprint("world")\n');
  });
});

describe('kernel messages become outputs', () => {
  it('joins consecutive text from the same stream', () => {
    const out = [];
    addMessage(out, { type: 'stream', name: 'stdout', text: 'a' });
    addMessage(out, { type: 'stream', name: 'stdout', text: 'b\n' });
    addMessage(out, { type: 'stream', name: 'stderr', text: 'warn\n' });
    addMessage(out, { type: 'stream', name: 'stdout', text: 'c' });
    expect(out.map((o) => [o.name, o.text])).toEqual([['stdout', 'ab\n'], ['stderr', 'warn\n'], ['stdout', 'c']]);
  });

  it('shows progress bars the way a terminal does (\\r rewrites the line)', () => {
    expect(applyControlChars('10%\r50%\r100%\ndone')).toBe('100%\ndone');
    expect(applyControlChars('abc\bd')).toBe('abd');
    const out = [];
    addMessage(out, { type: 'stream', name: 'stdout', text: 'step 1' });
    addMessage(out, { type: 'stream', name: 'stdout', text: '\rstep 2' });
    expect(out[0].text).toBe('step 2');
  });

  it('keeps runaway output bounded', () => {
    const out = [];
    for (let i = 0; i < 30; i++) addMessage(out, { type: 'stream', name: 'stdout', text: 'x'.repeat(10_000) });
    expect(out[0].text.length).toBeLessThan(MAX_STREAM_CHARS + 100);
    expect(out[0].text.startsWith('[… earlier output hidden …]')).toBe(true);
  });

  it('turns results, displays and errors into nbformat outputs', () => {
    const out = [];
    addMessage(out, { type: 'display', data: { 'image/png': 'AAA', 'text/plain': 'fig' } });
    addMessage(out, { type: 'result', count: 7, data: { 'text/plain': '42' } });
    addMessage(out, { type: 'error', ename: 'ZeroDivisionError', evalue: 'division by zero', traceback: 'Traceback:\n  line 1\nZeroDivisionError: division by zero\n' });
    expect(out[0].output_type).toBe('display_data');
    expect(out[1]).toMatchObject({ output_type: 'execute_result', execution_count: 7 });
    expect(out[2].traceback).toEqual(['Traceback:', '  line 1', 'ZeroDivisionError: division by zero']);
    expect(addMessage(out, { type: 'done' })).toBe(false);
  });

  it('picks the richest output it can show', () => {
    expect(pickMime({ 'text/plain': 'x', 'text/html': '<b>x</b>' })).toBe('text/html');
    expect(pickMime({ 'text/plain': 'x', 'image/png': 'A' })).toBe('image/png');
    expect(pickMime({ 'application/vnd.custom': 1, 'text/plain': 'x' })).toBe('text/plain');
    expect(pickMime({})).toBe(null);
  });

  it('removes terminal colour codes from tracebacks', () => {
    expect(stripAnsi('\x1b[0;31mValueError\x1b[0m: bad')).toBe('ValueError: bad');
  });
});

describe('Markdown cells', () => {
  const md = (s, o) => renderMarkdown(s, o);

  it('renders headings, emphasis, code and lists', () => {
    expect(md('# Hello')).toBe('<h1>Hello</h1>');
    expect(md('Some **bold** and *it* and `x = 1`')).toBe('<p>Some <strong>bold</strong> and <em>it</em> and <code>x = 1</code></p>');
    expect(md('- a\n- b\n  - c\n- d')).toBe('<ul><li>a<ul><li>c</li></ul></li><li>b</li><li>d</li></ul>'.replace('<li>a<ul><li>c</li></ul></li><li>b</li>', '<li>a</li><li>b<ul><li>c</li></ul></li>'));
    expect(md('1. one\n2. two')).toBe('<ol><li>one</li><li>two</li></ol>');
    expect(md('```python\nx = 1 < 2\n```')).toBe('<pre><code class="language-python">x = 1 &lt; 2</code></pre>');
  });

  it('renders tables, quotes and rules', () => {
    expect(md('| a | b |\n|---|--:|\n| 1 | 2 |')).toBe('<table><thead><tr><th>a</th><th class="nb-md-right">b</th></tr></thead><tbody><tr><td>1</td><td class="nb-md-right">2</td></tr></tbody></table>');
    expect(md('> quoted')).toBe('<blockquote><p>quoted</p></blockquote>');
    expect(md('---')).toBe('<hr>');
  });

  it('never lets HTML or scripts through', () => {
    expect(md('<script>alert(1)</script>')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
    expect(md('[x](javascript:alert(1))')).not.toContain('href');
    expect(md('`<b>`')).toBe('<p><code>&lt;b&gt;</code></p>');
  });

  it('shows only pictures stored in the notebook', () => {
    const att = { 'a.png': { 'image/png': 'iVBORw0KGgo=' } };
    expect(md('![pic](attachment:a.png)', { attachments: att })).toBe('<p><img alt="pic" src="data:image/png;base64,iVBORw0KGgo="></p>');
    expect(md('![pic](https://tracker.example/x.png)')).toContain('[image: pic]');
  });

  it('links and plain URLs', () => {
    expect(md('[site](https://example.com)')).toBe('<p><a href="https://example.com">site</a></p>');
    expect(md('see https://example.com now')).toBe('<p>see <a href="https://example.com">https://example.com</a> now</p>');
  });
});

describe('notebook HTML outputs are sanitized', () => {
  it('keeps tables and stored pictures, drops scripts, styles and remote images', () => {
    const html = '<style>.x{}</style><table class="dataframe" border="1"><tr><td colspan="2" onclick="x()">1</td></tr></table>'
      + '<img src="data:image/png;base64,AAAA"><img src="https://evil.example/t.png"><script>alert(1)</script>';
    const out = sanitizeHTML(html, document, { notebook: true });
    expect(out).toContain('<table class="dataframe">');
    expect(out).toContain('colspan="2"');
    expect(out).not.toContain('onclick');
    expect(out).toContain('<img src="data:image/png;base64,AAAA">');
    expect(out).not.toContain('evil.example');
    expect(out).not.toContain('script');
    expect(out).not.toContain('style');
  });

  it('documentation (not notebook) mode still drops all images', () => {
    expect(sanitizeHTML('<img src="data:image/png;base64,AAAA">', document)).toBe('');
  });
});

// ── The kernel itself, on a real Python ───────────────────────────────
const PY = [
  path.resolve('vendor/win-x64/python/python.exe'),
  path.resolve('vendor/linux-x64/python/bin/python3'),
  path.resolve('vendor/darwin-arm64/python/bin/python3'),
].find((p) => fs.existsSync(p));

function startKernel() {
  const messages = [];
  const waiters = [];
  const kernel = new Kernel({
    spawn,
    onMessage: (m) => {
      messages.push(m);
      for (const w of [...waiters]) if (w.test(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
    },
  });
  const waitFor = (test) => new Promise((resolve) => {
    const hit = messages.find(test);
    if (hit) resolve(hit); else waiters.push({ test, resolve });
  });
  return { kernel, messages, waitFor };
}

describe.skipIf(!PY)('the kernel (bundled Python)', () => {
  it('finds its script', () => {
    expect(fs.existsSync(kernelScript())).toBe(true);
    expect(MARK.startsWith('\x1e')).toBe(true);
  });

  it('keeps variables between cells, shows results, errors and input()', async () => {
    const { kernel, messages, waitFor } = startKernel();
    try {
      const info = await kernel.start({ python: PY, cwd: process.cwd(), env: process.env });
      expect(info.python).toMatch(/^3\./);

      kernel.execute('a', 'x = 20\nprint("hi")\nx + 22');
      await waitFor((m) => m.type === 'done' && m.id === 'a');
      expect(messages.find((m) => m.id === 'a' && m.type === 'stream').text).toBe('hi\n');
      expect(messages.find((m) => m.id === 'a' && m.type === 'result').data['text/plain']).toBe('42');

      kernel.execute('b', '1/0');
      const done = await waitFor((m) => m.type === 'done' && m.id === 'b');
      expect(done.status).toBe('error');
      const err = messages.find((m) => m.id === 'b' && m.type === 'error');
      expect(err.ename).toBe('ZeroDivisionError');
      expect(err.traceback).toContain('<cell');
      expect(err.traceback).not.toContain('theta_kernel');

      kernel.execute('c', 'name = input("Name? ")\nname.upper()');
      await waitFor((m) => m.type === 'input_request' && m.id === 'c');
      kernel.input('ada');
      await waitFor((m) => m.type === 'done' && m.id === 'c');
      expect(messages.find((m) => m.id === 'c' && m.type === 'result').data['text/plain']).toBe("'ADA'");

      // Interrupt a long loop; the namespace survives
      kernel.execute('d', 'import time\nwhile True: time.sleep(0.01)');
      await new Promise((r) => setTimeout(r, 300));
      kernel.interrupt();
      const stopped = await waitFor((m) => m.type === 'done' && m.id === 'd');
      expect(stopped.status).toBe('error');
      kernel.execute('e', 'x');
      await waitFor((m) => m.type === 'done' && m.id === 'e');
      expect(messages.find((m) => m.id === 'e' && m.type === 'result').data['text/plain']).toBe('20');

      // Rich objects use their HTML form
      kernel.execute('f', 'class T:\n    def _repr_html_(self): return "<b>rich</b>"\nT()');
      await waitFor((m) => m.type === 'done' && m.id === 'f');
      expect(messages.find((m) => m.id === 'f' && m.type === 'result').data['text/html']).toBe('<b>rich</b>');
    } finally {
      kernel.stop();
    }
  }, 30_000);
});
