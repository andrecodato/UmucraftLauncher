'use strict';
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const extractZip = require('extract-zip');
const { JAVA_VERSIONS, BASE_DIR } = require('../utils/paths');
const { send, log } = require('../utils/ipcSender');
const { downloadFile } = require('../utils/download');
const { httpGetJson } = require('../utils/http');
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

/**
 * Convert a Maven coordinate (group:artifact:version[:classifier]) to a relative file path.
 */
function mavenToPath(name) {
  const parts = name.split(':');
  const group = parts[0].replace(/\./g, '/');
  const artifact = parts[1];
  const version = parts[2];
  const classifier = parts[3] || null;
  const filename = classifier
    ? `${artifact}-${version}-${classifier}.jar`
    : `${artifact}-${version}.jar`;
  return path.join(group, artifact, version, filename);
}

/**
 * Load a version JSON, resolving inheritsFrom chain.
 * Returns merged { libraries, mainClass, arguments, assetIndex }.
 */
function loadVersionJson(versionsDir, versionId) {
  const jsonPath = path.join(versionsDir, versionId, `${versionId}.json`);
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`Version JSON not found: ${jsonPath}`);
  }
  const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

  if (json.inheritsFrom) {
    const parent = loadVersionJson(versionsDir, json.inheritsFrom);
    // Merge: child overrides parent
    return {
      mainClass: json.mainClass || parent.mainClass,
      libraries: [...(parent.libraries || []), ...(json.libraries || [])],
      arguments: {
        jvm: [...(parent.arguments?.jvm || []), ...(json.arguments?.jvm || [])],
        game: [...(parent.arguments?.game || []), ...(json.arguments?.game || [])],
      },
      assetIndex: json.assetIndex || parent.assetIndex,
      _parentId: json.inheritsFrom,
    };
  }

  return {
    mainClass: json.mainClass,
    libraries: json.libraries || [],
    arguments: json.arguments || {},
    assetIndex: json.assetIndex,
    _parentId: null,
  };
}

/**
 * Check OS rules for a library or argument.
 * Also rejects rules gated by features (e.g. has_custom_resolution, is_demo_user).
 */
function isAllowed(rules) {
  if (!rules || rules.length === 0) return true;
  let allowed = false;
  for (const rule of rules) {
    // Rules requiring features we don't support should block the entry
    if (rule.features) {
      if (rule.action === 'allow') continue; // skip — don't grant allow for unsupported features
      if (rule.action === 'disallow') allowed = false;
      continue;
    }
    const osMatch = !rule.os || rule.os.name === 'windows';
    if (rule.action === 'allow' && osMatch) allowed = true;
    if (rule.action === 'disallow' && osMatch) allowed = false;
  }
  return allowed;
}

/**
 * Resolve the file path for a library.
 */
function resolveLibraryPath(lib, librariesDir) {
  if (lib.downloads?.artifact?.path) {
    return path.join(librariesDir, lib.downloads.artifact.path);
  }
  // Maven-style name
  if (lib.name) {
    return path.join(librariesDir, mavenToPath(lib.name));
  }
  return null;
}

/**
 * Download missing libraries.
 */
async function ensureLibraries(libraries, librariesDir) {
  let downloaded = 0;
  for (const lib of libraries) {
    if (!isAllowed(lib.rules)) continue;

    const libPath = resolveLibraryPath(lib, librariesDir);
    if (!libPath) continue;

    if (!fs.existsSync(libPath)) {
      const url = lib.downloads?.artifact?.url;
      if (url) {
        fs.mkdirSync(path.dirname(libPath), { recursive: true });
        const name = path.basename(libPath);
        await downloadFile(url, libPath, `Lib: ${name}`);
        downloaded++;
      }
    }
  }
  if (downloaded > 0) {
    log(`Baixadas ${downloaded} libraries faltantes.`);
  }
}

/**
 * Download asset index and asset objects.
 */
async function ensureAssets(assetIndex, assetsDir) {
  if (!assetIndex?.url || !assetIndex?.id) return;

  const indexDir = path.join(assetsDir, 'indexes');
  fs.mkdirSync(indexDir, { recursive: true });
  const indexPath = path.join(indexDir, `${assetIndex.id}.json`);

  // Download asset index if missing
  if (!fs.existsSync(indexPath)) {
    log(`Baixando asset index ${assetIndex.id}...`);
    send('status', `Baixando asset index...`);
    await downloadFile(assetIndex.url, indexPath, `Asset index ${assetIndex.id}`);
  }

  const indexJson = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const objects = indexJson.objects || {};
  const objectsDir = path.join(assetsDir, 'objects');
  const entries = Object.values(objects);

  const total = entries.length;

  // First pass: figure out which assets are missing
  const missing = [];
  for (let i = 0; i < entries.length; i++) {
    const { hash } = entries[i];
    const prefix = hash.substring(0, 2);
    const objDir = path.join(objectsDir, prefix);
    const objPath = path.join(objDir, hash);
    if (!fs.existsSync(objPath)) {
      missing.push({ hash, prefix, objDir, objPath });
    }
  }

  if (missing.length === 0) {
    send('status', `Assets já estão completos (${total} arquivos).`);
    send('download-progress', { label: 'Assets', percent: 100, downloaded: total, total });
    return;
  }

  log(`${missing.length} assets faltantes de ${total} total. Baixando...`);

  for (let i = 0; i < missing.length; i++) {
    const { hash, prefix, objDir, objPath } = missing[i];
    fs.mkdirSync(objDir, { recursive: true });
    const url = `https://resources.download.minecraft.net/${prefix}/${hash}`;
    await downloadFile(url, objPath, 'Assets', { silent: true });

    const pct = Math.round(((i + 1) / missing.length) * 100);
    send('download-progress', { label: 'Assets', percent: pct, downloaded: i + 1, total: missing.length });
    send('status', `Baixando assets... ${pct}% (${i + 1}/${missing.length})`);
  }

  log(`Baixados ${missing.length} assets faltantes de ${total} total.`);
}

/**
 * Extract native libraries from jars to natives directory.
 */
async function extractNatives(libraries, librariesDir, nativesDir) {
  fs.mkdirSync(nativesDir, { recursive: true });

  // Check if natives were already extracted
  const markerPath = path.join(nativesDir, '.natives-extracted');
  if (fs.existsSync(markerPath)) return;

  for (const lib of libraries) {
    if (!isAllowed(lib.rules)) continue;
    if (!lib.natives) continue;

    const nativeKey = lib.natives['windows'];
    if (!nativeKey) continue;

    const classifier = nativeKey.replace('${arch}', process.arch === 'x64' ? '64' : '32');
    const nativeDownload = lib.downloads?.classifiers?.[classifier];
    if (!nativeDownload) continue;

    const nativePath = path.join(librariesDir, nativeDownload.path);

    // Download native jar if missing
    if (!fs.existsSync(nativePath)) {
      fs.mkdirSync(path.dirname(nativePath), { recursive: true });
      await downloadFile(nativeDownload.url, nativePath, `Native: ${path.basename(nativePath)}`);
    }

    // Extract
    try {
      await extractZip(nativePath, {
        dir: nativesDir,
        onEntry: (entry) => {
          // Skip META-INF
          if (entry.fileName.startsWith('META-INF/')) return false;
        },
      });
    } catch (err) {
      log(`Aviso: erro extraindo native ${path.basename(nativePath)}: ${err.message}`);
    }
  }

  // Mark as extracted
  fs.writeFileSync(markerPath, Date.now().toString());
  log('Natives extraídas.');
}

/**
 * Process an argument value, replacing ${variable} placeholders.
 */
function resolveArg(arg, vars) {
  if (typeof arg === 'string') {
    return arg.replace(/\$\{(\w+)\}/g, (_, key) => vars[key] || '');
  }
  // Complex argument with rules
  if (typeof arg === 'object' && arg.rules) {
    if (!isAllowed(arg.rules)) return null;
    const val = arg.value;
    if (Array.isArray(val)) return val.map(v => resolveArg(v, vars)).filter(Boolean);
    return resolveArg(val, vars);
  }
  return null;
}

async function launchMinecraft({ javaPath, minecraftDir, ram, username, mcVersion, forgeVersion }) {
  const librariesDir = path.join(minecraftDir, 'libraries');
  const versionsDir = path.join(minecraftDir, 'versions');
  const assetsDir = path.join(minecraftDir, 'assets');
  const nativesDir = path.join(versionsDir, mcVersion, 'natives');
  fs.mkdirSync(nativesDir, { recursive: true });

  const forgeVersionId = forgeVersion ? `${mcVersion}-forge-${forgeVersion}` : mcVersion;

  log(`Loading version JSON: ${forgeVersionId}`);
  const versionData = loadVersionJson(versionsDir, forgeVersionId);

  // Ensure all libraries are downloaded
  send('status', 'Verificando libraries...');
  await ensureLibraries(versionData.libraries, librariesDir);

  // Ensure assets are downloaded
  send('status', 'Verificando assets...');
  await ensureAssets(versionData.assetIndex, assetsDir);

  // Extract native libraries
  send('status', 'Verificando natives...');
  await extractNatives(versionData.libraries, librariesDir, nativesDir);

  // Build classpath from libraries
  const classpath = [];
  for (const lib of versionData.libraries) {
    if (!isAllowed(lib.rules)) continue;
    const libPath = resolveLibraryPath(lib, librariesDir);
    if (libPath && fs.existsSync(libPath)) {
      classpath.push(libPath);
    }
  }

  // Add main client jar only for vanilla launches.
  // Forge's bootstraplauncher manages the client jar via the module system;
  // adding it again causes duplicate module errors.
  const isModular = versionData.mainClass === 'cpw.mods.bootstraplauncher.BootstrapLauncher';
  if (!isModular) {
    const mainJar = path.join(versionsDir, mcVersion, `${mcVersion}.jar`);
    if (fs.existsSync(mainJar)) classpath.push(mainJar);
  }

  const sep = process.platform === 'win32' ? ';' : ':';
  const mainClass = versionData.mainClass;
  const ramMb = parseInt(ram, 10);

  // Variable substitutions for arguments
  const vars = {
    auth_player_name: username,
    version_name: forgeVersionId,
    game_directory: minecraftDir,
    assets_root: assetsDir,
    assets_index_name: versionData.assetIndex?.id || mcVersion,
    auth_uuid: '00000000-0000-0000-0000-000000000000',
    auth_access_token: '0',
    clientid: '',
    auth_xuid: '0',
    user_type: 'legacy',
    version_type: 'release',
    natives_directory: nativesDir,
    launcher_name: 'UmuCraft',
    launcher_version: '1.0',
    classpath: classpath.join(sep),
    classpath_separator: sep,
    library_directory: librariesDir,
  };

  // Build JVM args
  const jvmArgs = [
    `-Xms512m`,
    `-Xmx${ramMb}m`,
    `-XX:+UseG1GC`,
    `-XX:+ParallelRefProcEnabled`,
    `-XX:MaxGCPauseMillis=200`,
  ];

  // Add JVM args from version JSON (includes Forge module path, --add-opens, etc.)
  for (const arg of (versionData.arguments?.jvm || [])) {
    const resolved = resolveArg(arg, vars);
    if (resolved === null) continue;
    if (Array.isArray(resolved)) {
      jvmArgs.push(...resolved);
    } else {
      jvmArgs.push(resolved);
    }
  }

  // Build game args
  const gameArgs = [];
  for (const arg of (versionData.arguments?.game || [])) {
    const resolved = resolveArg(arg, vars);
    if (resolved === null) continue;
    if (Array.isArray(resolved)) {
      gameArgs.push(...resolved);
    } else {
      gameArgs.push(resolved);
    }
  }

  const args = [...jvmArgs, mainClass, ...gameArgs];
  log(`Launching: ${javaPath} ${args.slice(0, 8).join(' ')}...`);
  log(`Main class: ${mainClass}`);
  log(`Classpath entries: ${classpath.length}`);

  const child = spawn(javaPath, args, {
    cwd: minecraftDir,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', () => {});
  child.stderr.on('data', (data) => {
    const text = data.toString().trim();
    if (text) log(`[MC] ${text.substring(0, 200)}`);
  });
  child.on('close', (code) => {
    if (code && code !== 0) {
      log(`[MC] Processo encerrado com código ${code}`);
    }
  });

  child.unref();
  return child.pid;
}

module.exports = { getRequiredJavaVersion, resolveJavaForLaunch, launchMinecraft };
