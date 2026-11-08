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

  // ── Classroom (Teacher) ──
  classroomStartServer:   (name) => ipcRenderer.invoke('classroom-start-server', name),
  classroomStopServer:    ()     => ipcRenderer.invoke('classroom-stop-server'),
  classroomBroadcastCode: (code, cursor, fileName) => ipcRenderer.send('classroom-broadcast-code', code, cursor, fileName),
  classroomBroadcastChange: (from, to, insert) => ipcRenderer.send('classroom-broadcast-change', from, to, insert),
  classroomBroadcastTerminal: (text, stream) => ipcRenderer.send('classroom-broadcast-terminal', text, stream),
  classroomBroadcastCursor: (line, col) => ipcRenderer.send('classroom-broadcast-cursor', line, col),
  classroomBroadcastSelection: (ranges) => ipcRenderer.send('classroom-broadcast-selection', ranges),
  classroomRequestStudentCode: (id) => ipcRenderer.send('classroom-request-student-code', id),
  classroomRequestEdit:   (id) => ipcRenderer.send('classroom-request-edit', id),
  classroomSendEdit:      (id, code) => ipcRenderer.send('classroom-send-edit', id, code),
  classroomSendLiveEdit:  (id, from, to, insert) => ipcRenderer.send('classroom-send-live-edit', id, from, to, insert),
  classroomClearHelp:     (id) => ipcRenderer.send('classroom-clear-help', id),
  classroomGetStudents:   ()   => ipcRenderer.invoke('classroom-get-students'),
  classroomSendChatMessage: (text, target, senderName) => ipcRenderer.send('classroom-send-chat-message', text, target, senderName),

  onStudentJoined:   (cb) => safeOn('classroom-student-joined',  (_, info) => cb(info)),
  onStudentLeft:     (cb) => safeOn('classroom-student-left',    (_, info) => cb(info)),
  onHelpRequest:     (cb) => safeOn('classroom-help-request',    (_, info) => cb(info)),
  onStudentCode:     (cb) => safeOn('classroom-student-code',    (_, info) => cb(info)),
  onStudentCodeLive: (cb) => safeOn('classroom-student-code-live', (_, info) => cb(info)),
  onStudentOutputLive: (cb) => safeOn('classroom-student-output-live', (_, info) => cb(info)),
  onEditGrant:       (cb) => safeOn('classroom-edit-grant',      (_, info) => cb(info)),
  onEditRevoke:      (cb) => safeOn('classroom-edit-revoke',     (_, info) => cb(info)),
  onClassroomChatMessageReceived: (cb) => safeOn('classroom-chat-message-received', (_, info) => cb(info)),

  // ── Classroom (Student) ──
  classroomStartDiscovery: (name, roll) => ipcRenderer.send('classroom-start-discovery', name, roll),
  classroomStopDiscovery:  ()           => ipcRenderer.send('classroom-stop-discovery'),
  classroomSendHelp:       (msg)        => ipcRenderer.send('classroom-send-help', msg),
  classroomSendCode:       (code, fn)   => ipcRenderer.send('classroom-send-code', code, fn),
  classroomSendCodeLive:   (code, fn)   => ipcRenderer.send('classroom-send-code-live', code, fn),
  classroomSendOutputLive: (text, stream) => ipcRenderer.send('classroom-send-output-live', text, stream),
  classroomGrantEdit:      (granted)    => ipcRenderer.send('classroom-grant-edit', granted),
  classroomRevokeEdit:     ()           => ipcRenderer.send('classroom-revoke-edit'),

  onTeacherFound:    (cb) => safeOn('classroom-teacher-found',  (_, info) => cb(info)),
  onClassroomConnected:   (cb) => safeOn('classroom-connected',      (_, info) => cb(info)),
  onClassroomDisconnected:(cb) => safeOn('classroom-disconnected',   ()        => cb()),
  onClassroomCodeSync:    (cb) => safeOn('classroom-code-sync',      (_, data) => cb(data)),
  onClassroomCodeChange:  (cb) => safeOn('classroom-code-change',    (_, data) => cb(data)),
  onClassroomTerminal:    (cb) => safeOn('classroom-terminal',       (_, data) => cb(data)),
  onClassroomCursor:      (cb) => safeOn('classroom-cursor',         (_, data) => cb(data)),
  onClassroomSelection:   (cb) => safeOn('classroom-selection',      (_, data) => cb(data)),
  onClassroomViewRequest: (cb) => safeOn('classroom-view-request',   ()        => cb()),
  onClassroomEditRequest: (cb) => safeOn('classroom-edit-request',   ()        => cb()),
  onClassroomEditCode:    (cb) => safeOn('classroom-edit-code',      (_, data) => cb(data)),
  onClassroomEditLive:    (cb) => safeOn('classroom-edit-live',      (_, data) => cb(data)),
  onClassroomSessionEnd:  (cb) => safeOn('classroom-session-end',    ()        => cb()),

});
