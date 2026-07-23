'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const fse = require('fs-extra');
const { app } = require('electron');

// Same convention as the official launcher's .minecraft: lives under the
// OS's roaming app-data folder (%APPDATA% on Windows), not the home dir root.
const BASE_DIR = path.join(app.getPath('appData'), '.UmuCraft');
const OLD_BASE_DIR = path.join(os.homedir(), '.UmuCraft');

const CONFIG = {
  MANIFEST_URL: 'https://umucraft-updates.codato.dev/manifest.json',
  DEFAULT_PROFILE: 'Default',
};

const LATEST_MC_VERSION = '1.21.4';

const JAVA_VERSIONS = {
  '1.17': { version: '17', major: 17 },
  '1.18': { version: '17', major: 17 },
  '1.19': { version: '17', major: 17 },
  '1.20': { version: '21', major: 21 },
  '1.21': { version: '21', major: 21 },
};

/**
 * Older builds put BASE_DIR straight in the home directory. Move it into
 * place the first time this runs on a machine that already has one, so
 * existing players don't silently lose their downloaded Java/Minecraft/mods
 * and have to redo everything from scratch.
 */
function migrateOldBaseDir() {
  if (OLD_BASE_DIR === BASE_DIR) return;
  if (fs.existsSync(BASE_DIR) || !fs.existsSync(OLD_BASE_DIR)) return;

  fs.mkdirSync(path.dirname(BASE_DIR), { recursive: true });
  fse.moveSync(OLD_BASE_DIR, BASE_DIR);

  const configPath = path.join(BASE_DIR, 'config.json');
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (config.minecraftDir === OLD_BASE_DIR) {
        config.minecraftDir = BASE_DIR;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      }
    } catch {}
  }
}

function ensureDirectories() {
  migrateOldBaseDir();
  const dirs = ['java', 'versions', 'mods', 'modpacks', 'config', 'assets', 'cache', 'libraries', 'logs'];
  dirs.forEach(d => fs.mkdirSync(path.join(BASE_DIR, d), { recursive: true }));
}

module.exports = { BASE_DIR, CONFIG, LATEST_MC_VERSION, JAVA_VERSIONS, ensureDirectories };
