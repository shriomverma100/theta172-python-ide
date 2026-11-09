// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { pathToUri, uriToPath, uriKey, sameUri, untitledUri } from '../src/core/uri.js';
import { sanitizeHTML } from '../src/core/sanitize-html.js';
import { minimalChange, editsByUri } from '../src/core/text-edits.js';

const require = createRequire(import.meta.url);
const { encodeMessage, MessageReader, settingsFor, withHostCapabilities, LanguageServer } = require('../electron/lsp-host.cjs');

describe('URIs match what Pyright sends', () => {
  it('converts Windows paths the way Pyright and VS Code do', () => {
    expect(pathToUri('D:\\code drive\\main.py')).toBe('file:///d%3A/code%20drive/main.py');
    expect(pathToUri('/home/a/my project/x.py')).toBe('file:///home/a/my%20project/x.py');
  });

  it('turns URIs back into paths', () => {
    expect(uriToPath('file:///d%3A/code%20drive/main.py')).toBe('D:\\code drive\\main.py');
    expect(uriToPath('file:///c:/Users/a/x.py')).toBe('C:\\Users\\a\\x.py');
    expect(uriToPath('file:///home/a/x.py')).toBe('/home/a/x.py');
    expect(uriToPath('untitled:/tab-1/main.py')).toBeNull();
  });

  it('compares URIs whatever their escaping or drive-letter case', () => {
    expect(sameUri('file:///d%3A/Code/A.py', 'file:///D:/code/a.py')).toBe(true);
    expect(sameUri('file:///home/a/A.py', 'file:///home/a/a.py')).toBe(false); // case matters on Linux
    expect(uriKey(untitledUri('tab-3', 'main.py'))).toBe('untitled:/tab-3/main.py');
  });
});

describe('Hover documentation is sanitised', () => {
  it('keeps formatting and drops scripts, handlers and javascript: links', () => {
    const out = sanitizeHTML('<p>Hi <b>there</b><script>alert(1)</script><img src=x onerror=alert(1)>'
      + '<a href="javascript:alert(1)" onclick="x()">bad</a><a href="https://docs.python.org">ok</a>'
      + '<iframe src="https://evil"></iframe><code class="tok">x</code></p>', document);
    expect(out).toContain('<b>there</b>');
    expect(out).toContain('<code class="tok">x</code>');
    expect(out).not.toMatch(/script|onerror|onclick|iframe|javascript:|<img/i);
    expect(out).toContain('href="https://docs.python.org"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('unwraps unknown harmless tags but keeps their text', () => {
    expect(sanitizeHTML('<custom-el>text <i>it</i></custom-el>', document)).toBe('text <i>it</i>');
  });
});

describe('Edits from the language server', () => {
  it('finds the smallest change for a format', () => {
    const a = 'x=1\nprint( x )\n';
    const b = 'x = 1\nprint(x)\n';
    const c = minimalChange(a, b);
    expect(a.slice(0, c.from) + c.insert + a.slice(c.to)).toBe(b);
    expect(c.from).toBe(1); // "x" before the change is untouched
    expect(a.length - c.to).toBe(2); // so is ")\n" after it
    expect(minimalChange('same', 'same')).toBeNull();
  });

  it('groups rename edits per file from both WorkspaceEdit forms', () => {
    const e = { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, newText: 'plus' };
    const grouped = editsByUri({
      changes: { 'file:///d%3A/p/main.py': [e] },
      documentChanges: [{ textDocument: { uri: 'file:///D:/p/main.py', version: 3 }, edits: [e] }, { textDocument: { uri: 'file:///d%3A/p/h.py' }, edits: [e, e] }],
    });
    expect(grouped.size).toBe(2);
    expect([...grouped.values()].map((g) => g.edits.length).sort()).toEqual([2, 2]);
  });
});

describe('Language server host (main process)', () => {
  it('frames messages by byte length, including non-ASCII text', () => {
    const framed = encodeMessage({ text: 'héllo ✓' });
    const header = framed.toString('ascii', 0, framed.indexOf('\r\n'));
    expect(header).toBe(`Content-Length: ${Buffer.byteLength(JSON.stringify({ text: 'héllo ✓' }))}`);
  });

  it('reassembles messages split across chunks, and several in one chunk', () => {
    const reader = new MessageReader();
    const a = encodeMessage({ id: 1, text: 'ünïcode' });
    const b = encodeMessage({ id: 2 });
    expect(reader.push(a.subarray(0, 10))).toEqual([]);
    expect(reader.push(Buffer.concat([a.subarray(10), b])).map((m) => JSON.parse(m).id)).toEqual([1, 2]);
  });

  it('gives the server the active Python and a type-checking level', () => {
    const python = settingsFor('python', { pythonPath: 'C:\\env\\python.exe', typeChecking: 'basic' });
    expect(python.pythonPath).toBe('C:\\env\\python.exe');
    expect(settingsFor('basedpyright.analysis', { pythonPath: null, typeChecking: 'nonsense' }).typeCheckingMode).toBe('standard');
    expect(settingsFor('unknown.section', { pythonPath: null, typeChecking: 'basic' })).toBeNull();
  });

  it('tells the server the client answers configuration requests', () => {
    const out = JSON.parse(withHostCapabilities(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: 'file:///d%3A/proj', capabilities: {} } })));
    expect(out.params.capabilities.workspace.configuration).toBe(true);
    expect(out.params.workspaceFolders[0]).toEqual({ uri: 'file:///d%3A/proj', name: 'proj' });
  });

  it('answers the server’s configuration requests itself and relays everything else', () => {
    const written = [];
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdin = { write: (buf) => written.push(buf.toString()), end() {} };
    proc.kill = () => {};
    const toEditor = [];
    const server = new LanguageServer({
      spawn: () => proc, command: 'node', args: [], env: {},
      getSettings: () => ({ pythonPath: '/env/bin/python', typeChecking: 'strict' }),
      onMessage: (json) => toEditor.push(JSON.parse(json)),
    });
    server.start({ cwd: '/tmp' });
    proc.stdout.emit('data', Buffer.concat([
      encodeMessage({ jsonrpc: '2.0', id: 7, method: 'workspace/configuration', params: { items: [{ section: 'python' }, { section: 'basedpyright.analysis' }] } }),
      encodeMessage({ jsonrpc: '2.0', id: 8, method: 'window/workDoneProgress/create', params: {} }),
      encodeMessage({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri: 'x', diagnostics: [] } }),
    ]));
    const replies = written.map((w) => JSON.parse(w.slice(w.indexOf('{'))));
    expect(replies[0].id).toBe(7);
    expect(replies[0].result[0].pythonPath).toBe('/env/bin/python');
    expect(replies[0].result[1].typeCheckingMode).toBe('strict');
    expect(replies[1]).toMatchObject({ id: 8, result: null });
    expect(toEditor.map((m) => m.method)).toEqual(['textDocument/publishDiagnostics']);
  });
});
