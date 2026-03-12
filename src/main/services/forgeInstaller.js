'use strict';
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { BASE_DIR } = require('../utils/paths');
const { send, log } = require('../utils/ipcSender');
const { downloadFile } = require('../utils/download');
const { httpGetJson } = require('../utils/http');

function getForgeInstallerUrl(mcVersion, forgeVersion) {
  return `https://maven.minecraftforge.net/net/minecraftforge/forge/${mcVersion}-${forgeVersion}/forge-${mcVersion}-${forgeVersion}-installer.jar`;
}

function getForgeVersionId(mcVersion, forgeVersion) {
  return `${mcVersion}-forge-${forgeVersion}`;
}

function isMinecraftInstalled(minecraftDir, mcVersion) {
  const jarPath = path.join(minecraftDir, 'versions', mcVersion, `${mcVersion}.jar`);
  const jsonPath = path.join(minecraftDir, 'versions', mcVersion, `${mcVersion}.json`);
  return fs.existsSync(jarPath) && fs.existsSync(jsonPath);
}

async function ensureMinecraftInstalled(minecraftDir, mcVersion) {
  if (isMinecraftInstalled(minecraftDir, mcVersion)) {
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

  const versionDir = path.join(minecraftDir, 'versions', mcVersion);
  fs.mkdirSync(versionDir, { recursive: true });

  const clientJar = path.join(versionDir, `${mcVersion}.jar`);
  await downloadFile(clientUrl, clientJar, `Minecraft ${mcVersion}`);

  fs.writeFileSync(
    path.join(versionDir, `${mcVersion}.json`),
    JSON.stringify(versionMeta, null, 2)
  );

  log(`Minecraft ${mcVersion} instalado.`);
}

function isForgeInstalled(minecraftDir, mcVersion, forgeVersion) {
  const forgeId = getForgeVersionId(mcVersion, forgeVersion);
  const forgeJsonPath = path.join(minecraftDir, 'versions', forgeId, `${forgeId}.json`);
  return fs.existsSync(forgeJsonPath);
}

async function installForge(javaPath, minecraftDir, mcVersion, forgeVersion) {
  const forgeId = getForgeVersionId(mcVersion, forgeVersion);

  if (isForgeInstalled(minecraftDir, mcVersion, forgeVersion)) {
    log(`Forge ${forgeId} já está instalado.`);
    return;
  }

  log(`Forge ${forgeId} não encontrado, iniciando instalação...`);

  // Ensure vanilla Minecraft is installed first (Forge needs it)
  await ensureMinecraftInstalled(minecraftDir, mcVersion);

  // Forge installer requires launcher_profiles.json to exist
  const profilesPath = path.join(minecraftDir, 'launcher_profiles.json');
  if (!fs.existsSync(profilesPath)) {
    fs.writeFileSync(profilesPath, JSON.stringify({ profiles: {}, selectedProfile: '' }, null, 2));
    log('Criado launcher_profiles.json para o Forge installer.');
  }

  send('status', `Baixando Forge ${forgeVersion}...`);

  // Download the installer jar to a temp location
  const cacheDir = path.join(BASE_DIR, 'cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const installerPath = path.join(cacheDir, `forge-${mcVersion}-${forgeVersion}-installer.jar`);

  if (!fs.existsSync(installerPath)) {
    const installerUrl = getForgeInstallerUrl(mcVersion, forgeVersion);
    await downloadFile(installerUrl, installerPath, `Forge ${forgeVersion} installer`);
    log('Forge installer baixado.');
  }

  // Run the installer
  send('status', `Instalando Forge ${forgeVersion}...`);
  log(`Executando Forge installer: ${installerPath}`);

  await runForgeInstaller(javaPath, installerPath, minecraftDir);

  // Verify installation
  if (!isForgeInstalled(minecraftDir, mcVersion, forgeVersion)) {
    throw new Error(`Falha na instalação do Forge ${forgeId}. Verifique os logs.`);
  }

  log(`Forge ${forgeId} instalado com sucesso!`);
  send('status', `Forge ${forgeVersion} instalado!`);

  // Clean up installer
  try { fs.unlinkSync(installerPath); } catch {}
}

function runForgeInstaller(javaPath, installerPath, minecraftDir) {
  return new Promise((resolve, reject) => {
    const args = [
      '-jar', installerPath,
      '--installClient', minecraftDir,
    ];

    log(`Comando: ${javaPath} ${args.join(' ')}`);

    const child = spawn(javaPath, args, {
      cwd: minecraftDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let lastUiUpdate = 0;

    child.stdout.on('data', (data) => {
      const text = data.toString().trim();
      if (!text) return;
      stdout += text + '\n';

      // Only send important lines to UI, throttle the rest
      const now = Date.now();
      const isImportant = text.includes('Successfully') || text.includes('error') || text.includes('Downloading') || text.includes('Download');
      if (isImportant) {
        log(`[Forge] ${text}`);
      } else if (now - lastUiUpdate > 500) {
        // Throttle: max 1 update per 500ms for verbose output
        const shortLine = text.length > 80 ? text.substring(0, 80) + '...' : text;
        send('status', `Instalando Forge... ${shortLine}`);
        lastUiUpdate = now;
      }
    });

    child.stderr.on('data', (data) => {
      const text = data.toString().trim();
      if (text) {
        stderr += text + '\n';
        log(`[Forge ERR] ${text}`);
      }
    });

    child.on('close', (code) => {
      if (code === 0) {
        log('Forge installer finalizado com sucesso.');
        resolve();
      } else {
        const errorMsg = `Forge installer falhou (código ${code}).\n${stderr || stdout}`;
        log(errorMsg);
        reject(new Error(errorMsg));
      }
    });

    child.on('error', (err) => {
      reject(new Error(`Não foi possível executar o Forge installer: ${err.message}`));
    });
  });
}

module.exports = { installForge, isForgeInstalled };
