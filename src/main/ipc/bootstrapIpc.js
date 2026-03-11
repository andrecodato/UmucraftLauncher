'use strict';
const { ipcMain, shell } = require('electron');
const path = require('path');
const { BASE_DIR } = require('../utils/paths');
const { createMainWindow } = require('../windows/mainWindow');
const { ensureDefaultProfile } = require('../services/profileService');
const BootstrapController = require('../bootstrap/controller');
const state = require('../state');

function registerBootstrapIpc() {
  ipcMain.handle('bootstrap-retry', async () => {
    if (!state.bootstrapCtrl || !state.bootstrapWindow || state.bootstrapWindow.isDestroyed()) return;

    state.bootstrapCtrl = new BootstrapController(BASE_DIR);
    state.bootstrapCtrl.setSender(state.bootstrapWindow.webContents);

    const result = await state.bootstrapCtrl.run();
    if (!result.ok) return;

    state.resolvedJavaPath = result.javaPath;

    state.bootstrapCtrl.logger.state('preparing_profile');
    try { await ensureDefaultProfile(); } catch {}

    await new Promise(r => setTimeout(r, 800));
    createMainWindow();
    if (state.bootstrapWindow && !state.bootstrapWindow.isDestroyed()) {
      state.bootstrapWindow.close();
      state.bootstrapWindow = null;
    }
  });

  ipcMain.handle('bootstrap-open-logs', () => {
    const logPath = state.bootstrapCtrl
      ? state.bootstrapCtrl.getLogPath()
      : path.join(BASE_DIR, 'logs', 'bootstrap.log');
    shell.openPath(logPath);
  });
}

module.exports = { registerBootstrapIpc };
