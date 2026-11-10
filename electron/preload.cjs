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
  // True only under `npm run test:smoke`; enables read-only test hooks.
  isSmokeTest: process.env.THETA_SMOKE === '1',

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
  runPython:     (code, opts) => ipcRenderer.send('python-run', code, opts),
  killPython:    ()       => ipcRenderer.send('python-kill'),
  pipInstall:    (pkg)    => ipcRenderer.send('pip-install', pkg),
  pyInit:        ()       => ipcRenderer.invoke('py-init'),
  pyList:        (rescan) => ipcRenderer.invoke('py-list', rescan),
  pyActive:      ()       => ipcRenderer.invoke('py-active'),
  pySelect:      (exe)    => ipcRenderer.invoke('py-select', exe),
  pyCreateEnv:   ()       => ipcRenderer.invoke('py-create-env'),
  pyInstall:     (specs)  => ipcRenderer.invoke('py-install', specs),
  pyInstallRequirements: () => ipcRenderer.invoke('py-install-requirements'),
  pyUninstall:   (name)   => ipcRenderer.invoke('py-uninstall', name),
  pyPackages:    ()       => ipcRenderer.invoke('py-packages'),
  pyCheck:       ()       => ipcRenderer.invoke('py-check'),
  lspStart:      ()       => ipcRenderer.invoke('lsp-start'),
  lspStop:       ()       => ipcRenderer.invoke('lsp-stop'),
  lspSend:       (gen, json) => ipcRenderer.send('lsp-send', gen, json),
  lspSettings:   (s)      => ipcRenderer.invoke('lsp-settings', s),
  lspReadFile:   (uri)    => ipcRenderer.invoke('lsp-read-file', uri),
  lspFormat:     (code, name) => ipcRenderer.invoke('lsp-format', code, name),
  debugStart:    (opts)   => ipcRenderer.invoke('debug-start', opts),
  windowShape:   ()       => ipcRenderer.invoke('window-shape'),
  gitStatus:     ()       => ipcRenderer.invoke('git-status'),
  nbStart:       (id, file) => ipcRenderer.invoke('nb-start', id, file),
  nbRestart:     (id, file) => ipcRenderer.invoke('nb-restart', id, file),
  nbExecute:     (id, runId, code) => ipcRenderer.invoke('nb-execute', id, runId, code),
  nbInput:       (id, value) => ipcRenderer.send('nb-input', id, value),
  nbInterrupt:   (id)     => ipcRenderer.send('nb-interrupt', id),
  nbShutdown:    (id)     => ipcRenderer.invoke('nb-shutdown', id),
  onNbMessage:   (cb)     => safeOn('nb-message', (_, id, msg) => cb(id, msg)),
  onNbExit:      (cb)     => safeOn('nb-exit', (_, id, code) => cb(id, code)),
  gitShow:       (file, rev) => ipcRenderer.invoke('git-show', file, rev),
  gitReadWorking: (file)  => ipcRenderer.invoke('git-read-working', file),
  gitStage:      (files)  => ipcRenderer.invoke('git-stage', files),
  gitUnstage:    (files)  => ipcRenderer.invoke('git-unstage', files),
  gitDiscard:    (files)  => ipcRenderer.invoke('git-discard', files),
  gitCommit:     (msg, opts) => ipcRenderer.invoke('git-commit', msg, opts),
  gitBranches:   ()       => ipcRenderer.invoke('git-branches'),
  gitCheckout:   (opts)   => ipcRenderer.invoke('git-checkout', opts),
  gitLog:        (limit)  => ipcRenderer.invoke('git-log', limit),
  gitPull:       ()       => ipcRenderer.invoke('git-pull'),
  gitPush:       ()       => ipcRenderer.invoke('git-push'),
  gitFetch:      ()       => ipcRenderer.invoke('git-fetch'),
  gitInit:       ()       => ipcRenderer.invoke('git-init'),
  gitIdentity:   ()       => ipcRenderer.invoke('git-identity'),
  gitSetIdentity: (name, email) => ipcRenderer.invoke('git-set-identity', name, email),
  studyPlace:    (mode, side) => ipcRenderer.invoke('study-place', mode, side),
  studyExit:     ()       => ipcRenderer.invoke('study-exit'),
  onWindowShape: (cb)     => safeOn('window-shape', (_, shape) => cb(shape)),
  debugRequest:  (cmd, args) => ipcRenderer.invoke('debug-request', cmd, args),
  debugSetBreakpoints: (file, lines) => ipcRenderer.invoke('debug-set-breakpoints', file, lines),
  debugInput:    (text)   => ipcRenderer.send('debug-input', text),
  debugStop:     ()       => ipcRenderer.invoke('debug-stop'),
  debugReadFile: (file)   => ipcRenderer.invoke('debug-read-file', file),
  sendPythonInput: (text) => ipcRenderer.send('python-input', text),

  // ── File System ──
  openFile:   ()                      => ipcRenderer.invoke('file-open'),
  saveFile:   (filePath, content)     => ipcRenderer.invoke('file-save', filePath, content),
  saveFileAs: (content, defaultName)  => ipcRenderer.invoke('file-save-as', content, defaultName),
  setTitle:   (title)                 => ipcRenderer.send('set-title', title),
  readFile:   (filePath)              => ipcRenderer.invoke('file-read', filePath),

  // ── Workspace (every path is checked in the main process) ──
  wsOpenFolder: ()                    => ipcRenderer.invoke('ws-open-folder'),
  wsReopen:     ()                    => ipcRenderer.invoke('ws-reopen'),
  wsClose:      ()                    => ipcRenderer.invoke('ws-close'),
  wsList:       (dir)                 => ipcRenderer.invoke('ws-list', dir),
  wsRead:       (file)                => ipcRenderer.invoke('ws-read', file),
  wsCreate:     (parent, name, type)  => ipcRenderer.invoke('ws-create', parent, name, type),
  wsRename:     (p, name)             => ipcRenderer.invoke('ws-rename', p, name),
  wsMove:       (p, dir)              => ipcRenderer.invoke('ws-move', p, dir),
  wsDelete:     (p)                   => ipcRenderer.invoke('ws-delete', p),
  wsSearch:     (q, opts)             => ipcRenderer.invoke('ws-search', q, opts),
  wsReplace:    (q, rep, opts, skip)  => ipcRenderer.invoke('ws-replace', q, rep, opts, skip),
  wsGit:        ()                    => ipcRenderer.invoke('ws-git'),
  wsReveal:     (p)                   => ipcRenderer.invoke('ws-reveal', p),
  wsRecent:     ()                    => ipcRenderer.invoke('ws-recent'),
  wsOpenRecent: (dir)                 => ipcRenderer.invoke('ws-open-recent', dir),
  fileReveal:   (p)                   => ipcRenderer.invoke('file-reveal', p),
  onWsChanged:  (cb) => safeOn('ws-changed', (_, paths) => cb(paths)),

  // ── System terminal (PowerShell / bash in a real pty) ──
  shellStart:   (size)       => ipcRenderer.invoke('shell-start', size),
  shellInput:   (data)       => ipcRenderer.send('shell-input', data),
  shellResize:  (cols, rows) => ipcRenderer.send('shell-resize', cols, rows),
  shellKill:    ()           => ipcRenderer.send('shell-kill'),
  onShellData:  (cb) => safeOn('shell-data', (_, data) => cb(data)),
  onShellExit:  (cb) => safeOn('shell-exit', (_, code) => cb(code)),

  // Python event listeners (each cleans up prior listener on the same channel)
  onPythonStdout:  (cb) => safeOn('python-stdout',        (_, data) => cb(data)),
  onPythonStderr:  (cb) => safeOn('python-stderr',        (_, data) => cb(data)),
  onPythonDone:    (cb) => safeOn('python-done',           (_, code) => cb(code)),
  onPythonInput:   (cb) => safeOn('python-input-request',  ()        => cb()),
  onPipStdout:     (cb) => safeOn('pip-stdout',            (_, data) => cb(data)),
  onPyLog:         (cb) => safeOn('py-log',                (_, text) => cb(text)),
  onPyStatus:      (cb) => safeOn('py-status',             (_, text) => cb(text)),
  onPyChanged:     (cb) => safeOn('py-changed',            (_, st) => cb(st)),
  onLspMessage:    (cb) => safeOn('lsp-message',           (_, gen, json) => cb(gen, json)),
  onLspExit:       (cb) => safeOn('lsp-exit',              (_, gen, code) => cb(gen, code)),
  onDebugEvent:    (cb) => safeOn('debug-event',           (_, ev, body) => cb(ev, body)),
  onDebugOutput:   (cb) => safeOn('debug-output',          (_, stream, text) => cb(stream, text)),
  onDebugEnded:    (cb) => safeOn('debug-ended',           (_, info) => cb(info)),
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
  classroomStartServer:   (name, opts) => ipcRenderer.invoke('classroom-start-server', name, opts),
  classroomStatus:        ()     => ipcRenderer.invoke('classroom-status'),
  classroomSendEvent:     (target, msg, key) => ipcRenderer.send('classroom-send-event', target, msg, key),
  onRelayStatus:          (cb)   => safeOn('classroom-relay-status', (_, info) => cb(info)),
  onStudentStatus:        (cb)   => safeOn('classroom-student-status', (_, info) => cb(info)),
  onStudentEvent:         (cb)   => safeOn('classroom-student-event', (_, who, msg) => cb(who, msg)),
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
  classroomStartDiscovery: (name, roll, opts) => ipcRenderer.send('classroom-start-discovery', name, roll, opts),
  classroomStudentSendEvent: (msg, key) => ipcRenderer.send('classroom-student-send-event', msg, key),
  onLinkStatus:      (cb) => safeOn('classroom-link-status', (_, info) => cb(info)),
  onJoinError:       (cb) => safeOn('classroom-join-error', (_, message) => cb(message)),
  onClassEvent:      (cb) => safeOn('classroom-class-event', (_, msg) => cb(msg)),
  classroomStopDiscovery:  ()           => ipcRenderer.send('classroom-stop-discovery'),
  classroomSendHelp:       (msg, error) => ipcRenderer.send('classroom-send-help', msg, error),
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
