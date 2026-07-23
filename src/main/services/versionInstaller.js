'use strict';
const path = require('path');
const fs = require('fs');
const { send, log } = require('../utils/ipcSender');
const { downloadFile } = require('../utils/download');
const { httpGetJson } = require('../utils/http');
const { fileHash } = require('../utils/fileHash');

function slugify(str) {
  const slug = String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'default';
}

function isMinecraftInstalled(gameRoot, mcVersion) {
  const jarPath = path.join(gameRoot, 'versions', mcVersion, `${mcVersion}.jar`);
  const jsonPath = path.join(gameRoot, 'versions', mcVersion, `${mcVersion}.json`);
  return fs.existsSync(jarPath) && fs.existsSync(jsonPath);
}

async function ensureMinecraftInstalled(gameRoot, mcVersion) {
  if (isMinecraftInstalled(gameRoot, mcVersion)) {
    log(`Minecraft ${mcVersion} já está instalado.`);
    return;
  }

  log(`Minecraft ${mcVersion} não encontrado, baixando...`);
  send('status', `Baixando Minecraft ${mcVersion}...`);

  const versionManifest = await httpGetJson('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
  const versionEntry = versionManifest.versions.find(v => v.id === mcVersion);
  if (!versionEntry) {
    throw new Error(`Versão ${mcVersion} não encontrada no manifesto do Minecraft.`);
  }

  const versionMeta = await httpGetJson(versionEntry.url);
  const clientUrl = versionMeta.downloads?.client?.url;
  if (!clientUrl) {
    throw new Error(`URL do client não encontrada para Minecraft ${mcVersion}.`);
  }

  const versionDir = path.join(gameRoot, 'versions', mcVersion);
  fs.mkdirSync(versionDir, { recursive: true });

  const clientJar = path.join(versionDir, `${mcVersion}.jar`);
  await downloadFile(clientUrl, clientJar, `Minecraft ${mcVersion}`);

  fs.writeFileSync(
    path.join(versionDir, `${mcVersion}.json`),
    JSON.stringify(versionMeta, null, 2)
  );

  log(`Minecraft ${mcVersion} instalado.`);
}

/**
 * Ensure the resolved version JSON for a profile's loader is present locally,
 * returning the versionId to pass into launchMinecraft/loadVersionJson.
 *
 * For "vanilla" (or no loader/versionJsonUrl), this just ensures the vanilla
 * client and returns mcVersion. For any real loader (forge/neoforge/fabric),
 * the version JSON is not built locally — it's imported from the manifest's
 * versionJsonUrl, which the Pi watcher publishes from an ATLauncher
 * instance.json export (already merged with the correct loader libraries/
 * mainClass/arguments by ATLauncher itself).
 */
async function ensureVersionJson({ gameRoot, mcVersion, loader, loaderVersion, versionJsonUrl, versionJsonMd5 }) {
  await ensureMinecraftInstalled(gameRoot, mcVersion);

  if (!loader || loader === 'vanilla' || !versionJsonUrl) {
    return mcVersion;
  }

  const versionId = slugify(`${mcVersion}-${loader}-${loaderVersion}`);
  const versionDir = path.join(gameRoot, 'versions', versionId);
  const versionJsonPath = path.join(versionDir, `${versionId}.json`);

  if (fs.existsSync(versionJsonPath)) {
    log(`${loader} ${loaderVersion} já está instalado (${versionId}).`);
    return versionId;
  }

  log(`Baixando definição de versão para ${loader} ${loaderVersion}...`);
  send('status', `Baixando ${loader} ${loaderVersion}...`);

  fs.mkdirSync(versionDir, { recursive: true });
  const tmpPath = path.join(versionDir, `${versionId}.json.tmp`);
  await downloadFile(versionJsonUrl, tmpPath, `${loader} ${loaderVersion}`, { silent: true });

  if (versionJsonMd5) {
    const hash = fileHash(tmpPath);
    if (hash !== versionJsonMd5) {
      fs.unlinkSync(tmpPath);
      throw new Error(`MD5 do version.json inválido para ${loader} ${loaderVersion}: esperado ${versionJsonMd5}, obteve ${hash}`);
    }
  }

  fs.renameSync(tmpPath, versionJsonPath);
  log(`${loader} ${loaderVersion} instalado (${versionId}).`);

  return versionId;
}

module.exports = { ensureMinecraftInstalled, ensureVersionJson, slugify };
