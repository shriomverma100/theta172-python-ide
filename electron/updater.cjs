/**
 * THETA172 — Auto-updates (main process).
 *
 * Checks GitHub Releases (configured under "publish" in package.json) for
 * a newer version, downloads it in the background and asks before
 * restarting. Only runs in packaged production builds.
 */

'use strict';

const { dialog } = require('electron');

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours

function initAutoUpdates(getWindow) {
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    console.error('[updater] electron-updater unavailable:', err.message);
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (err) => {
    // Offline, private repo or no release yet: never bother the user.
    console.error('[updater]', err?.message || err);
  });

  autoUpdater.on('update-downloaded', async (info) => {
    const win = getWindow();
    const options = {
      type: 'info',
      title: 'Update ready',
      message: `Python by THETA172 ${info.version} is ready to install.`,
      detail: 'Restart now to update, or it will install the next time you close the app.',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    };
    const { response } = win && !win.isDestroyed()
      ? await dialog.showMessageBox(win, options)
      : await dialog.showMessageBox(options);
    if (response === 0) autoUpdater.quitAndInstall();
  });

  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 10_000);
  setInterval(check, CHECK_INTERVAL_MS).unref?.();
}

module.exports = { initAutoUpdates };
