/**
 * THETA172 — Updates (main process).
 *
 * Every installed copy checks GitHub Releases (package.json "publish") for
 * a newer version, downloads it quietly in the background (only the parts
 * that changed, thanks to the .blockmap), and tells the window. The window
 * decides when to ask: never during a live class, a running program or a
 * debug session. "Update now" shows the updating screen, then the app
 * closes, the installer runs silently (5–15 s) and the new version opens.
 *
 * Release notes containing "[critical]" mark a critical update: the window
 * offers no "Later" for it.
 *
 * Who may update (school IT): C:\ProgramData\THETA172\policy.json
 *   { "updates": "auto" }    check and download by itself (default)
 *   { "updates": "manual" }  only Help → Check for updates
 *   { "updates": "off" }     never (the IT team installs new versions)
 * The user's own "Automatic updates" setting can only make it stricter.
 *
 * Testing on this PC: THETA_UPDATE_URL=http://127.0.0.1:8123/ serves
 * latest.yml + the installer from a folder (scripts/update-server.cjs).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // every 4 hours
const FIRST_CHECK_MS = Number(process.env.THETA_UPDATE_FIRST_MS) || 15_000;

function readPolicy(file = path.join(process.env.ProgramData || 'C:\\ProgramData', 'THETA172', 'policy.json')) {
  try {
    const p = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (p && ['auto', 'manual', 'off'].includes(p.updates)) return { updates: p.updates, file };
  } catch (_) { /* no policy */ }
  return { updates: 'auto', file: null };
}

/** Release notes from GitHub (string, or a list of {version, note}) as plain text. */
function notesText(releaseNotes) {
  let raw = '';
  if (typeof releaseNotes === 'string') raw = releaseNotes;
  else if (Array.isArray(releaseNotes)) raw = releaseNotes.map((n) => n && n.note).filter(Boolean).join('\n');
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|h\d)>/gi, '\n')
    .replace(/<li>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 4000);
}

const isCritical = (text) => /\[critical\]/i.test(text || '');

/**
 * @param {{ ipcMain: Electron.IpcMain, app: Electron.App, getWindow: () => Electron.BrowserWindow|null, userData: string }} deps
 */
function registerUpdater({ ipcMain, app, getWindow, userData }) {
  const prefsFile = path.join(userData, 'updates.json');
  const loadPrefs = () => { try { return JSON.parse(fs.readFileSync(prefsFile, 'utf8')); } catch (_) { return {}; } };
  const savePrefs = (p) => { try { fs.writeFileSync(prefsFile, JSON.stringify(p, null, 2)); } catch (_) { /* not critical */ } };
  let prefs = { auto: true, ...loadPrefs() };
  const policy = readPolicy();
  const testUrl = process.env.THETA_UPDATE_URL || '';
  const canUpdate = (app.isPackaged || !!testUrl) && policy.updates !== 'off';

  /** @type {{ state: string, version?: string, notes?: string, critical?: boolean, percent?: number, bytesPerSecond?: number, transferred?: number, total?: number, message?: string, manual?: boolean }} */
  let status = { state: 'idle' };
  const send = () => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('update-status', status);
  };
  const set = (next) => { status = { ...status, ...next }; send(); };

  let updater = null;
  const getUpdater = () => {
    if (updater || !canUpdate) return updater;
    try {
      ({ autoUpdater: updater } = require('electron-updater'));
    } catch (err) {
      console.error('[updater] electron-updater unavailable:', err.message);
      return null;
    }
    updater.autoDownload = true;          // quietly, in the background
    updater.autoInstallOnAppQuit = true;  // a ready update also installs when the app is closed normally
    updater.allowDowngrade = false;
    updater.logger = null;
    if (testUrl) {
      // Not installed (or a test feed): describe the feed in a file, as an installed app has one
      const cfg = path.join(userData, 'test-app-update.yml');
      fs.writeFileSync(cfg, `provider: generic\nurl: ${testUrl}\nupdaterCacheDirName: theta172-updater-test\n`);
      updater.forceDevUpdateConfig = true;
      updater.updateConfigPath = cfg;
      // A test run must never install anything on this computer by itself
      updater.autoInstallOnAppQuit = process.env.THETA_UPDATE_INSTALL_ON_QUIT === '1';
      updater.setFeedURL({ provider: 'generic', url: testUrl });
    }
    updater.on('checking-for-update', () => set({ state: 'checking', message: '' }));
    updater.on('update-not-available', () => set({ state: status.manual ? 'latest' : 'idle', manual: false }));
    updater.on('update-available', (info) => {
      const notes = notesText(info.releaseNotes);
      set({ state: 'downloading', version: info.version, notes, critical: isCritical(notes), percent: 0 });
      // Remember the notes, so the new version can show "What's new" after it starts
      prefs.pendingNotes = { version: info.version, notes };
      savePrefs(prefs);
    });
    updater.on('download-progress', (p) => set({
      state: 'downloading', percent: Math.round(p.percent || 0), bytesPerSecond: p.bytesPerSecond, transferred: p.transferred, total: p.total,
    }));
    updater.on('update-downloaded', (info) => {
      const notes = notesText(info.releaseNotes) || status.notes || '';
      set({ state: 'ready', version: info.version, notes, critical: isCritical(notes), percent: 100 });
    });
    updater.on('error', (err) => {
      // Offline or no release yet: say so only when the user asked
      console.error('[updater]', err?.message || err);
      set({ state: status.manual ? 'error' : 'idle', message: friendly(err), manual: false });
    });
    return updater;
  };

  const friendly = (err) => {
    const m = String(err?.message || err || '');
    if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::|getaddrinfo|offline/i.test(m)) return 'No internet connection. The app checks again later by itself.';
    if (/404|Cannot find latest/i.test(m)) return 'No update has been published yet.';
    if (/sha512|checksum/i.test(m)) return 'The download was damaged. It will be downloaded again.';
    return 'Could not check for updates right now.';
  };

  const check = (manual = false) => {
    const u = getUpdater();
    if (!u) return false;
    if (['downloading', 'ready', 'installing'].includes(status.state)) { send(); return true; }
    status.manual = manual;
    u.checkForUpdates().catch((err) => { set({ state: manual ? 'error' : 'idle', message: friendly(err), manual: false }); });
    return true;
  };

  const automatic = () => canUpdate && policy.updates === 'auto' && prefs.auto !== false;

  // ── IPC ──
  ipcMain.handle('update-info', () => {
    const lastRun = prefs.lastRunVersion || null;
    const current = app.getVersion();
    let whatsNew = null;
    if (lastRun && lastRun !== current && prefs.pendingNotes?.version === current) whatsNew = prefs.pendingNotes;
    if (lastRun !== current) { prefs.lastRunVersion = current; savePrefs(prefs); }
    return {
      version: current,
      status,
      enabled: canUpdate,
      packaged: app.isPackaged,
      auto: prefs.auto !== false,
      policy: policy.updates,
      policyFile: policy.file,
      updatedFrom: lastRun && lastRun !== current ? lastRun : null,
      whatsNew,
    };
  });
  ipcMain.handle('update-check', () => {
    if (!canUpdate) return { ok: false, message: policy.updates === 'off' ? 'Your school manages updates for this computer.' : 'Updates work in the installed app.' };
    return { ok: check(true) };
  });
  ipcMain.handle('update-set-auto', (_e, on) => {
    prefs.auto = !!on;
    savePrefs(prefs);
    if (automatic()) check(false);
    return automatic();
  });
  ipcMain.handle('update-install', () => {
    const u = getUpdater();
    if (!u || status.state !== 'ready') return false;
    set({ state: 'installing' });
    // Give the updating screen a moment, then close; the installer runs silently and reopens the app
    setTimeout(() => {
      try { u.quitAndInstall(true, true); } catch (err) { set({ state: 'error', message: friendly(err) }); }
    }, 2500);
    return true;
  });

  if (automatic()) {
    setTimeout(() => check(false), FIRST_CHECK_MS);
    setInterval(() => { if (automatic()) check(false); }, CHECK_INTERVAL_MS).unref?.();
  }

  return { check, status: () => status };
}

module.exports = { registerUpdater, readPolicy, notesText, isCritical };
