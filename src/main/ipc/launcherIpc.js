'use strict';
const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { BASE_DIR, CONFIG, LATEST_MC_VERSION } = require('../utils/paths');
const { send, log } = require('../utils/ipcSender');
const { fetchManifest } = require('../services/manifestService');
const { syncMods } = require('../services/modSyncService');
const { getRequiredJavaVersion, resolveJavaForLaunch, launchMinecraft } = require('../services/minecraftLauncher');
const { installForge } = require('../services/forgeInstaller');
const state = require('../state');

function registerLauncherIpc() {
  ipcMain.handle('startup-check', async () => {
    return {
      javaPath: state.resolvedJavaPath,
      ok: !!state.resolvedJavaPath,
    };
  });

  ipcMain.handle('fetch-manifest', async () => {
    try {
      const manifest = await fetchManifest();
      fs.writeFileSync(
        path.join(BASE_DIR, 'cache', 'manifest.json'),
        JSON.stringify(manifest, null, 2)
      );
      return { ok: true, manifest };
    } catch (err) {
      const cachePath = path.join(BASE_DIR, 'cache', 'manifest.json');
      if (fs.existsSync(cachePath)) {
        log(`Could not reach server, using cached manifest: ${err.message}`);
        return { ok: true, manifest: JSON.parse(fs.readFileSync(cachePath, 'utf8')), cached: true };
      }
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('sync-and-launch', async (_, { config, manifest }) => {
    try {
      const profileName = config.selectedProfile || CONFIG.DEFAULT_PROFILE;
      const profileManifest = manifest.profiles?.[profileName] || manifest;

      const mcVersion = profileManifest.minecraftVersion || LATEST_MC_VERSION;
      const forgeVersion = profileManifest.forgeVersion || null;
      const javaInfo = getRequiredJavaVersion(mcVersion);

      const minecraftDir = config.minecraftDir || BASE_DIR;

      send('status', `Verificando Java ${javaInfo.major}...`);
      send('phase', 'java');
      const javaPath = resolveJavaForLaunch(javaInfo.major);

      if (forgeVersion) {
        send('status', `Verificando Forge ${forgeVersion}...`);
        send('phase', 'forge');
        await installForge(javaPath, minecraftDir, mcVersion, forgeVersion);
      }

      send('status', 'Sincronizando mods...');
      send('phase', 'mods');
      const updatedCount = await syncMods(profileManifest, minecraftDir);

      if (updatedCount > 0) {
        log(`${updatedCount} mod(s) atualizado(s).`);
      } else {
        log('Todos os mods estão atualizados!');
      }

      send('status', 'Iniciando Minecraft...');
      send('phase', 'launch');

      const pid = await launchMinecraft({
        javaPath,
        minecraftDir,
        ram: config.ram || 4096,
        username: config.username || 'Player',
        mcVersion,
        forgeVersion,
      });

      send('launched', { pid });
      return { ok: true, pid };
    } catch (err) {
      log(`ERRO: ${err.message}`);
      return { ok: false, error: err.message };
    }
  });
}

module.exports = { registerLauncherIpc };
