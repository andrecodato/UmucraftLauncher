'use strict';
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const extractZip = require('extract-zip');
const { JAVA_VERSIONS, BASE_DIR } = require('../utils/paths');
const { send, log } = require('../utils/ipcSender');
const { downloadFile } = require('../utils/download');
const { httpGetJson } = require('../utils/http');
const { mapWithConcurrency } = require('../utils/concurrency');
const state = require('../state');
const RuntimeDetector = require('../bootstrap/detector');
const RuntimeInstaller = require('../bootstrap/installer');
const MojangJavaInstaller = require('../bootstrap/mojangJava');

// Minecraft/Forge/NeoForge ship thousands of small library/asset files;
// downloading them one at a time makes latency (not bandwidth) the
// bottleneck. This many in flight at once is a big speedup without
// hammering Mojang's CDN.
const DOWNLOAD_CONCURRENCY = 16;

function getRequiredJavaVersion(minecraftVersion, javaMajorHint) {
  if (javaMajorHint) {
    return { version: String(javaMajorHint), major: javaMajorHint };
  }
  for (const [prefix, info] of Object.entries(JAVA_VERSIONS)) {
    if (minecraftVersion.startsWith(prefix)) return info;
  }
  return { version: '17', major: 17 };
}

/**
 * Resolves the Java executable for a specific profile — NOT just "whatever
 * Java the bootstrap happened to find".
 *
 * The bootstrap step (controller.js) only guarantees *some* Java >= 17 so
 * the app itself can start; it has no idea yet which modpack will be
 * launched. Forge/NeoForge (and especially the Sinytra Connector Fabric
 * compat layer) do low-level Java module-system patching that's fragile —
 * not just across major versions, but across *distributions* of the same
 * major. Confirmed in production against a real NeoForge 21.1.x + Connector
 * modpack: it crashed with "NoSuchElementException: No value present" in
 * ConnectorLoaderService.updateModuleReads under both system Java 25 AND a
 * freshly-downloaded generic Adoptium Temurin 21 — but launched fine under
 * ATLauncher, which (per its instance settings) uses "Java provided by
 * Minecraft", i.e. Mojang's own redistributed JRE, not a generic vendor
 * build. So the exact Mojang JRE is the primary path whenever the version
 * JSON tells us which component it needs (javaVersion.component, e.g.
 * "java-runtime-delta" — present on every real Mojang/ATLauncher version
 * JSON); a plain major-version Adoptium install is only the fallback for
 * versions that don't carry that field.
 */
async function resolveJavaForLaunch(javaVersionInfo, fallbackMajor) {
  const logger = { log: (m) => log(m), error: (m) => log(`ERROR: ${m}`), state: () => {}, progress: () => {} };

  if (javaVersionInfo?.component) {
    const component = javaVersionInfo.component;
    send('status', `Verificando Java (${component})...`);
    const mojangJava = new MojangJavaInstaller(logger, BASE_DIR);
    try {
      return await mojangJava.ensure(component, (pct, completed, total) => {
        send('download-progress', { label: `Java (${component})`, percent: pct, downloaded: completed, total });
      });
    } catch (err) {
      log(`Falha ao obter o JRE oficial da Mojang (${component}): ${err.message}. Tentando fallback...`);
    }
  }

  const majorVersion = javaVersionInfo?.majorVersion || fallbackMajor;

  if (state.resolvedJavaPath && state.resolvedJavaVersion === majorVersion) {
    log(`Using bootstrap-resolved Java: ${state.resolvedJavaPath}`);
    return state.resolvedJavaPath;
  }

  const detector = new RuntimeDetector(logger, BASE_DIR);

  const bundled = detector.detectBundledMajor(majorVersion);
  if (bundled) {
    log(`Usando Java ${majorVersion} ja baixado: ${bundled.path}`);
    return bundled.path;
  }

  if (state.resolvedJavaPath) {
    log(`Java resolvido no boot e versao ${state.resolvedJavaVersion}, mas este perfil exige Java ${majorVersion}. Baixando a versao correta...`);
  } else {
    log(`Nenhum Java resolvido no boot. Baixando Java ${majorVersion}...`);
  }

  send('status', `Baixando Java ${majorVersion}...`);
  const installer = new RuntimeInstaller(logger, BASE_DIR);
  const installResult = await installer.install(majorVersion, (pct, downloaded, total) => {
    send('download-progress', { label: `Java ${majorVersion}`, percent: pct, downloaded, total });
  });

  if (!installResult.valid) {
    throw new Error(`Falha ao instalar Java ${majorVersion}.`);
  }

  log(`Java ${majorVersion} instalado: ${installResult.path}`);
  return installResult.path;
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
      javaVersion: json.javaVersion || parent.javaVersion,
      _parentId: json.inheritsFrom,
    };
  }

  return {
    mainClass: json.mainClass,
    libraries: json.libraries || [],
    arguments: json.arguments || {},
    assetIndex: json.assetIndex,
    javaVersion: json.javaVersion,
    _parentId: null,
  };
}

/**
 * ATLauncher's merged instance.json commonly lists the same library twice
 * (vanilla and the loader both declare guava, gson, log4j, etc.), which
 * makes the classpath contain the same jar path twice. NeoForge's
 * BootstrapLauncher builds a Map keyed by path from the classpath and
 * throws IllegalStateException: Duplicate key on startup if that happens,
 * so this needs to be deduped before libraries are downloaded/classpathed.
 */
function dedupeLibraries(libraries) {
  const seen = new Set();
  const result = [];
  for (const lib of libraries) {
    const key = lib.name || lib.downloads?.artifact?.path;
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    result.push(lib);
  }
  return result;
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
 * Download missing libraries, `DOWNLOAD_CONCURRENCY` at a time.
 */
async function ensureLibraries(libraries, librariesDir) {
  const missing = [];
  for (const lib of libraries) {
    if (!isAllowed(lib.rules)) continue;

    const libPath = resolveLibraryPath(lib, librariesDir);
    if (!libPath) continue;

    if (!fs.existsSync(libPath)) {
      const url = lib.downloads?.artifact?.url;
      if (url) missing.push({ url, libPath });
    }
  }

  if (missing.length === 0) return;

  let completed = 0;
  await mapWithConcurrency(missing, DOWNLOAD_CONCURRENCY, async ({ url, libPath }) => {
    fs.mkdirSync(path.dirname(libPath), { recursive: true });
    await downloadFile(url, libPath, `Lib: ${path.basename(libPath)}`, { silent: true });
    completed++;
    const pct = Math.round((completed / missing.length) * 100);
    send('download-progress', { label: 'Libraries', percent: pct, downloaded: completed, total: missing.length });
    send('status', `Baixando libraries... ${pct}% (${completed}/${missing.length})`);
  });

  log(`Baixadas ${missing.length} libraries faltantes.`);
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

  let completed = 0;
  await mapWithConcurrency(missing, DOWNLOAD_CONCURRENCY, async ({ hash, prefix, objDir, objPath }) => {
    fs.mkdirSync(objDir, { recursive: true });
    const url = `https://resources.download.minecraft.net/${prefix}/${hash}`;
    await downloadFile(url, objPath, 'Assets', { silent: true });

    completed++;
    const pct = Math.round((completed / missing.length) * 100);
    send('download-progress', { label: 'Assets', percent: pct, downloaded: completed, total: missing.length });
    send('status', `Baixando assets... ${pct}% (${completed}/${missing.length})`);
  });

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

/**
 * NeoForge doesn't ship a ready-to-use patched client jar — it has to be
 * built locally by running the loader's own official installer, which
 * downloads `neoforge-<version>-universal.jar` and applies a binary patch
 * (via `net.neoforged.installertools:binarypatcher`, using NeoForm's mapping
 * data) to the vanilla client jar, producing
 * `libraries/net/neoforged/neoforge/<version>/neoforge-<version>-client.jar`.
 * ATLauncher runs this exact step when a modpack instance is created; our
 * launcher never did, so that jar — and the `neoforge-<version>-universal.jar`
 * that carries the "neoforge" mod registration — never existed on disk.
 * BootstrapLauncher discovers both automatically via `-DlibraryDirectory`
 * once they're present (they don't need to be added to -cp/-p by hand); the
 * game just can't find them if the installer never ran. Confirmed live: this
 * is what was actually behind "Mod ID: 'minecraft'/'neoforge' ... Actual
 * version: '[MISSING]'" — not the client-jar classpath/naming issue above,
 * which was a real bug too but not sufficient on its own.
 *
 * Cached per loaderVersion by checking for the client jar's existence — the
 * installer only needs to run once per version, shared across profiles
 * (same as libraries/versions/assets).
 *
 * Only 'neoforge' is implemented — old-school Forge uses a different maven
 * layout and version-string convention (mcVersion-loaderVersion combined)
 * that hasn't been verified against a real installer run yet.
 */
async function ensureLoaderInstalled({ javaPath, gameRoot, loader, loaderVersion }) {
  if (loader !== 'neoforge' || !loaderVersion) return;

  const librariesDir = path.join(gameRoot, 'libraries');
  const clientJarPath = path.join(
    librariesDir, 'net', 'neoforged', 'neoforge', loaderVersion, `neoforge-${loaderVersion}-client.jar`
  );
  if (fs.existsSync(clientJarPath)) return;

  log(`neoforge ${loaderVersion}: client jar patchado ausente. Rodando o instalador oficial (primeira vez, pode demorar)...`);
  send('status', `Instalando NeoForge ${loaderVersion} (primeira vez, pode demorar)...`);

  const installerUrl = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${loaderVersion}/neoforge-${loaderVersion}-installer.jar`;
  const installerCacheDir = path.join(gameRoot, 'cache', 'installers');
  fs.mkdirSync(installerCacheDir, { recursive: true });
  const installerPath = path.join(installerCacheDir, `neoforge-${loaderVersion}-installer.jar`);
  if (!fs.existsSync(installerPath)) {
    await downloadFile(installerUrl, installerPath, `Instalador NeoForge ${loaderVersion}`);
  }

  // The official installer refuses to run against a target dir with no
  // launcher_profiles.json — it's checking for "a real Mojang-style launcher
  // lives here", not actually reading anything from it. A stub satisfies it.
  const profilesStub = path.join(gameRoot, 'launcher_profiles.json');
  if (!fs.existsSync(profilesStub)) {
    fs.writeFileSync(profilesStub, JSON.stringify({ profiles: {}, settings: {}, version: 3 }));
  }

  await new Promise((resolve, reject) => {
    const child = spawn(javaPath, ['-jar', installerPath, '--install-client', gameRoot], { cwd: installerCacheDir });
    let output = '';
    child.stdout.on('data', (d) => { output += d.toString(); });
    child.stderr.on('data', (d) => { output += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(clientJarPath)) {
        resolve();
      } else {
        reject(new Error(`Instalador do NeoForge ${loaderVersion} falhou (codigo ${code}):\n${output.slice(-2000)}`));
      }
    });
  });

  log(`NeoForge ${loaderVersion} instalado.`);
}

async function launchMinecraft({ javaMajorHint, gameRoot, instanceDir, ram, username, mcVersion, versionId, loader, loaderVersion }) {
  const librariesDir = path.join(gameRoot, 'libraries');
  const versionsDir = path.join(gameRoot, 'versions');
  const assetsDir = path.join(gameRoot, 'assets');
  const nativesDir = path.join(versionsDir, versionId, 'natives');
  fs.mkdirSync(nativesDir, { recursive: true });
  fs.mkdirSync(instanceDir, { recursive: true });

  log(`Loading version JSON: ${versionId}`);
  const versionData = loadVersionJson(versionsDir, versionId);

  // Resolved here (not earlier) because javaVersion.component only exists
  // once the actual version JSON is loaded — see resolveJavaForLaunch's
  // docstring for why the exact Mojang JRE matters, not just the major.
  const javaPath = await resolveJavaForLaunch(versionData.javaVersion, javaMajorHint);

  await ensureLoaderInstalled({ javaPath, gameRoot, loader, loaderVersion });

  const dedupedLibraries = dedupeLibraries(versionData.libraries);
  const removed = versionData.libraries.length - dedupedLibraries.length;
  if (removed > 0) log(`${removed} libraries duplicadas removidas do version.json.`);
  versionData.libraries = dedupedLibraries;

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

  // The client jar goes on the classpath for EVERY launch, including
  // BootstrapLauncher (NeoForge) ones — confirmed against ATLauncher's own
  // working `-cp` (atlauncher-line.txt has client-1.21.1.jar right alongside
  // every neoforge/modlauncher library). BootstrapLauncher avoids
  // double-processing it as an automatic JPMS module via
  // `-DignoreList=client-extra,client-<version>.jar` (from the version
  // JSON's jvm args) — but that ignore-list only matches by exact filename.
  // We store the vanilla download as `<mcVersion>.jar` (Mojang's own
  // versions/<id>/<id>.jar convention, used elsewhere e.g. versionInstaller's
  // isMinecraftInstalled), so putting THAT path on the classpath produces an
  // automatic module named after "1.21.1.jar" — not in the ignore list, and
  // not the "client" name FML's game-layer code actually looks for — so
  // NeoForge still can't find Minecraft's own module and reports "Mod ID:
  // 'minecraft' ... Actual version: '[MISSING]'" (cascading to 'neoforge'
  // and everything that depends on either) even though the jar is right
  // there. A same-content copy named client-<mcVersion>.jar, matching
  // ATLauncher's own naming, is what actually needs to be on the classpath.
  const mainJar = path.join(versionsDir, mcVersion, `${mcVersion}.jar`);
  if (fs.existsSync(mainJar)) {
    const clientAliasJar = path.join(versionsDir, mcVersion, `client-${mcVersion}.jar`);
    if (!fs.existsSync(clientAliasJar) || fs.statSync(clientAliasJar).size !== fs.statSync(mainJar).size) {
      fs.copyFileSync(mainJar, clientAliasJar);
    }
    classpath.push(clientAliasJar);
  }

  const sep = process.platform === 'win32' ? ';' : ':';
  const mainClass = versionData.mainClass;
  const ramMb = parseInt(ram, 10);

  // Variable substitutions for arguments
  const vars = {
    auth_player_name: username,
    // Must be the plain Minecraft version (matches ATLauncher's real
    // `--version` and the actual client-<mcVersion>.jar filename on disk) —
    // NOT our internal merged loader versionId, or `-DignoreList=client-extra,
    // client-${version_name}.jar` (if templated that way in the version JSON)
    // would reference a filename that doesn't exist and BootstrapLauncher
    // would treat the real client jar as a duplicate module.
    version_name: mcVersion,
    game_directory: instanceDir,
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

  // TEMP DEBUG — full command dump for diffing against ATLauncher's actual
  // launch command. Remove once the Connector crash is diagnosed.
  try {
    fs.writeFileSync(
      path.join(require('os').tmpdir(), 'umucraft-full-launch-args.json'),
      JSON.stringify({ javaPath, args }, null, 2)
    );
  } catch {}

  const child = spawn(javaPath, args, {
    cwd: instanceDir,
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
