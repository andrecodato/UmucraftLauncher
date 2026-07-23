'use strict';
const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { BASE_DIR, CONFIG, LATEST_MC_VERSION } = require('../utils/paths');
const { send, log } = require('../utils/ipcSender');
const { httpGetJson } = require('../utils/http');
const { fetchManifest } = require('../services/manifestService');
const { syncMods } = require('../services/modSyncService');
const { getRequiredJavaVersion, resolveJavaForLaunch, launchMinecraft } = require('../services/minecraftLauncher');
const { ensureVersionJson, slugify } = require('../services/versionInstaller');
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

  ipcMain.handle('fetch-mods-list', async (_, { url, profileName }) => {
    const cachePath = path.join(BASE_DIR, 'cache', `mods-list-${slugify(profileName)}.json`);
    try {
      const modsList = await httpGetJson(url);
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      fs.writeFileSync(cachePath, JSON.stringify(modsList));
      return { ok: true, modsList };
    } catch (err) {
      if (fs.existsSync(cachePath)) {
        return { ok: true, modsList: JSON.parse(fs.readFileSync(cachePath, 'utf8')), cached: true };
      }
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('sync-and-launch', async (_, { config, manifest }) => {
    try {
      const profileName = config.selectedProfile || CONFIG.DEFAULT_PROFILE;
      const profileManifest = manifest.profiles?.[profileName];
      if (!profileManifest) {
        throw new Error(`Perfil "${profileName}" não encontrado no manifesto.`);
      }

      const mcVersion = profileManifest.minecraftVersion || LATEST_MC_VERSION;
      const loader = profileManifest.loader || 'vanilla';
      const javaInfo = getRequiredJavaVersion(mcVersion, profileManifest.javaMajor);

      const gameRoot = config.minecraftDir || BASE_DIR;
      const instanceDir = path.join(gameRoot, 'instances', slugify(profileName));
      fs.mkdirSync(instanceDir, { recursive: true });

      send('status', `Verificando Java ${javaInfo.major}...`);
      send('phase', 'java');
      const javaPath = resolveJavaForLaunch(javaInfo.major);

      send('status', loader !== 'vanilla' ? `Verificando ${loader}...` : 'Verificando Minecraft...');
      send('phase', 'loader');
      const versionId = await ensureVersionJson({
        gameRoot,
        mcVersion,
        loader,
        loaderVersion: profileManifest.loaderVersion,
        versionJsonUrl: profileManifest.versionJsonUrl,
        versionJsonMd5: profileManifest.versionJsonMd5,
      });

      send('status', 'Sincronizando mods...');
      send('phase', 'mods');
      const updatedCount = await syncMods(profileManifest, instanceDir);

      if (updatedCount > 0) {
        log(`${updatedCount} mod(s) atualizado(s).`);
      } else {
        log('Todos os mods estão atualizados!');
      }

      send('status', 'Iniciando Minecraft...');
      send('phase', 'launch');

      const pid = await launchMinecraft({
        javaPath,
        gameRoot,
        instanceDir,
        ram: config.ram || 4096,
        username: config.username || 'Player',
        mcVersion,
        versionId,
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
