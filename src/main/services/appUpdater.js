'use strict';
const { autoUpdater } = require('electron-updater');

/**
 * Checks for a new launcher version and, if found, downloads and silently
 * installs it, restarting the app. Resolves `true` if an update was found
 * and the app is about to quit/restart (caller should stop and return),
 * or `false` if there's no update (or the check failed/timed out) and
 * startup should continue normally.
 */
function checkForAppUpdate(logger) {
  return new Promise((resolve) => {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;

    let settled = false;
    let checkTimeout = null;

    const finish = (updated) => {
      if (settled) return;
      settled = true;
      if (checkTimeout) clearTimeout(checkTimeout);
      cleanup();
      resolve(updated);
    };

    const onAvailable = (info) => {
      if (checkTimeout) clearTimeout(checkTimeout);
      logger.state('downloading_update', `Baixando atualização ${info.version}...`);
      autoUpdater.downloadUpdate().catch((err) => {
        logger.error(`Falha ao baixar atualização: ${err.message}`);
        finish(false);
      });
    };

    const onNotAvailable = () => {
      logger.log('Launcher já está na versão mais recente.');
      finish(false);
    };

    const onProgress = (p) => {
      logger.progress({
        phase: 'downloading_update',
        percent: Math.round(p.percent),
        downloaded: p.transferred,
        total: p.total,
      });
    };

    const onDownloaded = (info) => {
      logger.state('update_ready', `Reiniciando para aplicar a versão ${info.version}...`);
      setTimeout(() => autoUpdater.quitAndInstall(true, true), 800);
      finish(true);
    };

    const onError = (err) => {
      logger.log(`Verificação de atualização falhou, seguindo sem atualizar: ${err.message}`);
      finish(false);
    };

    function cleanup() {
      autoUpdater.removeListener('update-available', onAvailable);
      autoUpdater.removeListener('update-not-available', onNotAvailable);
      autoUpdater.removeListener('download-progress', onProgress);
      autoUpdater.removeListener('update-downloaded', onDownloaded);
      autoUpdater.removeListener('error', onError);
    }

    autoUpdater.on('update-available', onAvailable);
    autoUpdater.on('update-not-available', onNotAvailable);
    autoUpdater.on('download-progress', onProgress);
    autoUpdater.on('update-downloaded', onDownloaded);
    autoUpdater.on('error', onError);

    // Only guards the check itself (small latest.yml fetch) — once a real
    // download starts (onAvailable), we let it run to completion.
    checkTimeout = setTimeout(() => {
      logger.log('Verificação de atualização demorou demais, seguindo sem atualizar.');
      finish(false);
    }, 10000);

    logger.state('checking_update', 'Verificando atualizações do launcher...');
    autoUpdater.checkForUpdates().catch((err) => {
      logger.log(`Não foi possível verificar atualizações: ${err.message}`);
      finish(false);
    });
  });
}

module.exports = { checkForAppUpdate };
