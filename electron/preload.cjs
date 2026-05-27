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

  // ── Interactive REPL ──
  startRepl:      ()     => ipcRenderer.send('repl-start'),
  sendReplInput:  (text) => ipcRenderer.send('repl-input', text),
  killRepl:       ()     => ipcRenderer.send('repl-kill'),
  onReplStdout:   (cb)   => safeOn('repl-stdout',  (_, data) => cb(data)),
  onReplStderr:   (cb)   => safeOn('repl-stderr',  (_, data) => cb(data)),
  onReplExit:     (cb)   => safeOn('repl-exit',    (_, code) => cb(code)),

  // ── Unsaved Changes ──
  onCheckUnsaved:    (cb) => safeOn('check-unsaved',  () => cb()),
  sendUnsavedStatus: (hasUnsaved) => ipcRenderer.send('unsaved-status', hasUnsaved),
  onSaveAndClose:    (cb) => safeOn('save-and-close', () => cb()),
  sendCloseConfirmed: ()  => ipcRenderer.send('close-confirmed'),
  onShowUnsavedDialog: (cb) => safeOn('show-unsaved-dialog', () => cb()),
  sendUnsavedDialogResponse: (choice) => ipcRenderer.send('unsaved-dialog-response', choice),

  // ── Collab WebSocket Server ──
  collabStartServer:   (options) => ipcRenderer.invoke('collab-start-server', options),
  collabStopServer:    ()        => ipcRenderer.invoke('collab-stop-server'),
  collabServerInfo:    ()        => ipcRenderer.invoke('collab-server-info'),
  collabStateFull:     (state)   => ipcRenderer.send('collab-state-full', state),
  collabStateDelta:    (delta)   => ipcRenderer.send('collab-state-delta', delta),
  collabHighlight:     (hl)      => ipcRenderer.send('collab-highlight', hl),

  onCollabViewersChanged:   (cb) => safeOn('collab-viewers-changed',   (_, viewers)   => cb(viewers)),
  onCollabHighlightRequest: (cb) => safeOn('collab-highlight-request', (_, highlight) => cb(highlight)),
  onCollabServerError:      (cb) => safeOn('collab-server-error',      (_, errMsg)    => cb(errMsg)),

  // ── Collab mDNS Discovery ──
  collabBrowseStart:  ()     => ipcRenderer.invoke('collab-browse-start'),
  collabBrowseStop:   ()     => ipcRenderer.invoke('collab-browse-stop'),
  collabNearbyList:   ()     => ipcRenderer.invoke('collab-nearby-list'),
  collabRegistryLookup: (roomKey) => ipcRenderer.invoke('collab-registry-lookup', roomKey),
  onCollabNearbyDevices: (cb) => safeOn('collab-nearby-devices', (_, devices) => cb(devices)),

  // ── Teacher Dashboard ──
  onCollabStudentState: (cb) => safeOn('collab-student-state', (_, data) => cb(data)),

  // ── Interactions ──
  onCollabInteraction:    (cb)   => safeOn('collab-interaction', (_, data) => cb(data)),
  collabSendInteraction:  (data) => ipcRenderer.send('collab-interaction-send', data),

  // ── Chat ──
  onCollabChat:           (cb)   => safeOn('collab-chat', (_, data) => cb(data)),
  collabSendChat:         (data) => ipcRenderer.send('collab-chat-send', data),

  // ── CRDT Collaborative Editing ──
  onCollabCrdt:           (cb)   => safeOn('collab-crdt-sync', (_, data) => cb(data)),
  collabSendCrdt:         (data) => ipcRenderer.send('collab-crdt-send', data),
  onCollabAwareness:      (cb)   => safeOn('collab-crdt-awareness', (_, data) => cb(data)),
  collabSendAwareness:    (data) => ipcRenderer.send('collab-awareness-send', data),
  collabSendCollabMode:   (data) => ipcRenderer.send('collab-mode-send', data),
});
