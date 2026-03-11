'use strict';
const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { BASE_DIR, CONFIG } = require('../utils/paths');

function registerConfigIpc() {
  ipcMain.handle('load-config', () => {
    const configPath = path.join(BASE_DIR, 'config.json');
    if (fs.existsSync(configPath)) {
      try { return JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
    }
    return {
      username: '',
      ram: 4096,
      selectedProfile: CONFIG.DEFAULT_PROFILE,
      minecraftDir: BASE_DIR,
      profiles: [],
    };
  });

  ipcMain.handle('save-config', (_, config) => {
    const configPath = path.join(BASE_DIR, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    return true;
  });
}

module.exports = { registerConfigIpc };
