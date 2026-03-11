'use strict';
const { ipcMain, app } = require('electron');
const state = require('../state');

function registerWindowIpc() {
  ipcMain.handle('window-minimize', () => state.mainWindow.minimize());
  ipcMain.handle('window-maximize', () => {
    state.mainWindow.isMaximized() ? state.mainWindow.unmaximize() : state.mainWindow.maximize();
  });
  ipcMain.handle('window-close', () => app.quit());
}

module.exports = { registerWindowIpc };
