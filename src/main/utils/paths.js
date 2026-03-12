'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');

const BASE_DIR = path.join(os.homedir(), '.UmuCraft');

const CONFIG = {
  MANIFEST_URL: 'https://www.dropbox.com/scl/fi/2ayggbyej2fmvqc38ell1/manifest.json?rlkey=9sln2f4nxuwl7rsv04dh1y832&st=0d97hib4&dl=1',
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

function ensureDirectories() {
  const dirs = ['java', 'versions', 'mods', 'modpacks', 'config', 'assets', 'cache', 'libraries', 'logs'];
  dirs.forEach(d => fs.mkdirSync(path.join(BASE_DIR, d), { recursive: true }));
}

module.exports = { BASE_DIR, CONFIG, LATEST_MC_VERSION, JAVA_VERSIONS, ensureDirectories };
