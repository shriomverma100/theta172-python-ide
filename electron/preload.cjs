/**
 * THETA. — Electron Preload Script
 * Exposes window controls + local Python APIs to renderer.
 * All event listeners return a cleanup function and remove prior listeners
 * to prevent accumulation on renderer reload.
 */

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Helper: register an IPC listener that auto-removes the previous one.
 * Returns an unsubscribe function for explicit cleanup.
 */
function safeOn(channel, handler) {
  ipcRenderer.removeAllListeners(channel);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimize:      () => ipcRenderer.send('window-minimize'),
  maximize:      () => ipcRenderer.send('window-maximize'),
  close:         () => ipcRenderer.send('window-close'),
  isMaximized:   () => ipcRenderer.invoke('window-is-maximized'),

  onMaximizeChange: (callback) => {
    return safeOn('window-maximized', (_, isMax) => callback(isMax));
  },

  // ── Local Python ──
  detectPython:  ()       => ipcRenderer.invoke('python-detect'),
  runPython:     (code)   => ipcRenderer.send('python-run', code),
  killPython:    ()       => ipcRenderer.send('python-kill'),
  pipInstall:    (pkg)    => ipcRenderer.send('pip-install', pkg),
  sendPythonInput: (text) => ipcRenderer.send('python-input', text),

  // ── File System ──
  openFile:   ()                      => ipcRenderer.invoke('file-open'),
  saveFile:   (filePath, content)     => ipcRenderer.invoke('file-save', filePath, content),
  saveFileAs: (content, defaultName)  => ipcRenderer.invoke('file-save-as', content, defaultName),
  setTitle:   (title)                 => ipcRenderer.send('set-title', title),

  // Python event listeners (each cleans up prior listener on the same channel)
  onPythonStdout:  (cb) => safeOn('python-stdout',        (_, data) => cb(data)),
  onPythonStderr:  (cb) => safeOn('python-stderr',        (_, data) => cb(data)),
  onPythonDone:    (cb) => safeOn('python-done',           (_, code) => cb(code)),
  onPythonInput:   (cb) => safeOn('python-input-request',  ()        => cb()),
  onPipStdout:     (cb) => safeOn('pip-stdout',            (_, data) => cb(data)),
  onPipDone:       (cb) => safeOn('pip-done',              (_, code, pkg) => cb(code, pkg)),
});
