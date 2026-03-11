'use strict';
const path = require('path');
const fs = require('fs');
const { send, log } = require('../utils/ipcSender');
const { downloadFile } = require('../utils/download');
const { fileHash } = require('../utils/fileHash');

async function syncMods(manifest, profileDir) {
  const modsDir = path.join(profileDir, 'mods');
  fs.mkdirSync(modsDir, { recursive: true });

  const serverMods = manifest.mods || [];
  const localFiles = fs.readdirSync(modsDir);

  for (const file of localFiles) {
    const inManifest = serverMods.find(m => m.filename === file);
    if (!inManifest) {
      log(`Removing old mod: ${file}`);
      fs.unlinkSync(path.join(modsDir, file));
    }
  }

  let updated = 0;
  for (let i = 0; i < serverMods.length; i++) {
    const mod = serverMods[i];
    const destPath = path.join(modsDir, mod.filename);
    const exists = fs.existsSync(destPath);
    const currentHash = exists ? fileHash(destPath) : null;

    send('sync-progress', {
      current: i + 1,
      total: serverMods.length,
      filename: mod.filename,
      percent: Math.round(((i + 1) / serverMods.length) * 100),
    });

    if (!exists || (mod.md5 && currentHash !== mod.md5)) {
      log(`Downloading mod: ${mod.filename}`);
      await downloadFile(mod.url, destPath, `Baixando: ${mod.filename}`);
      updated++;
    } else {
      log(`Mod OK: ${mod.filename}`);
    }
  }

  return updated;
}

module.exports = { syncMods };
