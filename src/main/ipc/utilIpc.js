'use strict';
const { ipcMain, shell, dialog } = require('electron');
const os = require('os');
const { BASE_DIR } = require('../utils/paths');
const state = require('../state');

function registerUtilIpc() {
  ipcMain.handle('open-folder', (_, folderPath) => {
    shell.openPath(folderPath || BASE_DIR);
  });

  ipcMain.handle('open-external', (_, url) => {
    if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
      shell.openExternal(url);
    }
  });

  ipcMain.handle('browse-minecraft-dir', async () => {
    const result = await dialog.showOpenDialog(state.mainWindow, {
      properties: ['openDirectory'],
      title: 'Selecione a pasta do UmuCraft',
      defaultPath: BASE_DIR,
    });
    if (!result.canceled) return result.filePaths[0];
    return null;
  });

  ipcMain.handle('get-system-info', () => {
    const totalRam = Math.floor(os.totalmem() / 1024 / 1024);
    return {
      platform: process.platform,
      totalRam,
      launcherDir: BASE_DIR,
    };
  });
}

module.exports = { registerUtilIpc };
