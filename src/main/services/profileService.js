'use strict';
const path = require('path');
const fs = require('fs');
const { BASE_DIR, CONFIG, LATEST_MC_VERSION } = require('../utils/paths');
const { send, log } = require('../utils/ipcSender');
const { downloadFile } = require('../utils/download');
const { httpGetJson } = require('../utils/http');

async function ensureDefaultProfile() {
  const configPath = path.join(BASE_DIR, 'config.json');
  let config = {};
  if (fs.existsSync(configPath)) {
    try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
  }

  if (config.defaultProfileReady) return;

  send('status', 'Preparando perfil padrão...');

  const versionDir = path.join(BASE_DIR, 'versions', LATEST_MC_VERSION);
  fs.mkdirSync(versionDir, { recursive: true });

  const clientJar = path.join(versionDir, `${LATEST_MC_VERSION}.jar`);
  if (!fs.existsSync(clientJar)) {
    try {
      log(`Fetching version manifest for ${LATEST_MC_VERSION}...`);
      const versionManifest = await httpGetJson('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
      const versionEntry = versionManifest.versions.find(v => v.id === LATEST_MC_VERSION);

      if (versionEntry) {
        const versionMeta = await httpGetJson(versionEntry.url);
        const clientUrl = versionMeta.downloads?.client?.url;
        if (clientUrl) {
          log(`Downloading Minecraft ${LATEST_MC_VERSION} client...`);
          send('status', `Baixando Minecraft ${LATEST_MC_VERSION}...`);
          await downloadFile(clientUrl, clientJar, `Minecraft ${LATEST_MC_VERSION}`);

          fs.writeFileSync(
            path.join(versionDir, `${LATEST_MC_VERSION}.json`),
            JSON.stringify(versionMeta, null, 2)
          );
          log(`Minecraft ${LATEST_MC_VERSION} client downloaded.`);
        }
      }
    } catch (err) {
      log(`Could not download Minecraft client: ${err.message}`);
    }
  }

  config.defaultProfileReady = true;
  config.username = config.username || '';
  config.ram = config.ram || 4096;
  config.selectedProfile = config.selectedProfile || CONFIG.DEFAULT_PROFILE;
  config.minecraftDir = BASE_DIR;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  send('status', 'Perfil padrão pronto.');
  log('Default profile prepared.');
}

module.exports = { ensureDefaultProfile };
