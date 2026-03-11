'use strict';
const { ipcMain } = require('electron');
const { pingMinecraftServer } = require('../services/serverPingService');

function registerServerIpc() {
  ipcMain.handle('ping-server', async (_, { host, port }) => {
    return pingMinecraftServer(host, port || 25565);
  });
}

module.exports = { registerServerIpc };
