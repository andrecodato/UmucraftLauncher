'use strict';
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { JAVA_VERSIONS, BASE_DIR } = require('../utils/paths');
const { log } = require('../utils/ipcSender');
const state = require('../state');
const RuntimeDetector = require('../bootstrap/detector');

function getRequiredJavaVersion(minecraftVersion) {
  for (const [prefix, info] of Object.entries(JAVA_VERSIONS)) {
    if (minecraftVersion.startsWith(prefix)) return info;
  }
  return { version: '17', major: 17 };
}

function resolveJavaForLaunch(majorVersion) {
  if (state.resolvedJavaPath) {
    log(`Using bootstrap-resolved Java: ${state.resolvedJavaPath}`);
    return state.resolvedJavaPath;
  }

  const logger = { log: (m) => log(m), error: (m) => log(`ERROR: ${m}`), state: () => {}, progress: () => {} };
  const detector = new RuntimeDetector(logger, BASE_DIR);
  const result = detector.detect();
  if (result) {
    log(`Fallback detection found Java ${result.version} at ${result.path}`);
    return result.path;
  }

  throw new Error(`Java >= ${majorVersion} nao encontrado. Reinicie o launcher para instalar.`);
}

function launchMinecraft({ javaPath, minecraftDir, ram, username, mcVersion, forgeVersion }) {
  const librariesDir = path.join(minecraftDir, 'libraries');
  const versionsDir = path.join(minecraftDir, 'versions');
  const assetsDir = path.join(minecraftDir, 'assets');
  const nativesDir = path.join(versionsDir, mcVersion, 'natives');

  const forgeVersionId = forgeVersion ? `${mcVersion}-forge-${forgeVersion}` : mcVersion;
  const versionJsonPath = path.join(versionsDir, forgeVersionId, `${forgeVersionId}.json`);

  if (!fs.existsSync(versionJsonPath)) {
    const plainPath = path.join(versionsDir, mcVersion, `${mcVersion}.json`);
    if (!fs.existsSync(plainPath)) {
      throw new Error(`Version ${forgeVersionId} not found. Install Forge/Minecraft first.`);
    }
  }

  const actualJsonPath = fs.existsSync(versionJsonPath)
    ? versionJsonPath
    : path.join(versionsDir, mcVersion, `${mcVersion}.json`);

  const versionJson = JSON.parse(fs.readFileSync(actualJsonPath, 'utf8'));

  const classpath = [];
  for (const lib of (versionJson.libraries || [])) {
    if (lib.downloads?.artifact?.path) {
      const libPath = path.join(librariesDir, lib.downloads.artifact.path);
      if (fs.existsSync(libPath)) classpath.push(libPath);
    }
  }

  const mainJar = path.join(versionsDir, mcVersion, `${mcVersion}.jar`);
  if (fs.existsSync(mainJar)) classpath.push(mainJar);

  const mainClass = versionJson.mainClass || 'net.minecraft.client.main.Main';
  const ramMb = parseInt(ram, 10);

  const jvmArgs = [
    `-Xms512m`,
    `-Xmx${ramMb}m`,
    `-XX:+UseG1GC`,
    `-XX:+ParallelRefProcEnabled`,
    `-XX:MaxGCPauseMillis=200`,
    `-Djava.library.path=${nativesDir}`,
    `-cp`, classpath.join(process.platform === 'win32' ? ';' : ':'),
  ];

  const gameArgs = [
    mainClass,
    '--username', username,
    '--version', forgeVersionId,
    '--gameDir', minecraftDir,
    '--assetsDir', assetsDir,
    '--assetIndex', versionJson.assetIndex?.id || mcVersion,
    '--uuid', '00000000-0000-0000-0000-000000000000',
    '--accessToken', '0',
    '--userType', 'legacy',
  ];

  const args = [...jvmArgs, ...gameArgs];
  log(`Launching: ${javaPath} ${args.slice(0, 5).join(' ')}...`);

  const child = spawn(javaPath, args, {
    cwd: minecraftDir,
    detached: true,
    stdio: 'ignore',
  });

  child.unref();
  return child.pid;
}

module.exports = { getRequiredJavaVersion, resolveJavaForLaunch, launchMinecraft };
