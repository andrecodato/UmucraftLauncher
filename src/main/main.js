const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { execSync, spawn } = require('child_process');
const os = require('os');

// ─── CONFIG ──────────────────────────────────────────────────────────────────
// Base directory: everything lives under ~/.umucraft
const BASE_DIR = path.join(os.homedir(), '.umucraft');

const CONFIG = {
  // URL to your manifest.json hosted on GitHub Raw, Dropbox, etc.
  MANIFEST_URL: 'https://YOUR_HOST/manifest.json',

  // Default profile name shown in launcher
  DEFAULT_PROFILE: 'MyServer',
};

// Java versions per Minecraft version range
const JAVA_VERSIONS = {
  '1.17': { version: '17', major: 17 },
  '1.18': { version: '17', major: 17 },
  '1.19': { version: '17', major: 17 },
  '1.20': { version: '21', major: 21 },
  '1.21': { version: '21', major: 21 },
};

// OpenJDK download URLs (Adoptium/Temurin)
const JAVA_DOWNLOAD_URLS = {
  win32: {
    17: 'https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.10%2B7/OpenJDK17U-jdk_x64_windows_hotspot_17.0.10_7.zip',
    21: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.2%2B13/OpenJDK21U-jdk_x64_windows_hotspot_21.0.2_13.zip',
  },
  linux: {
    17: 'https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.10%2B7/OpenJDK17U-jdk_x64_linux_hotspot_17.0.10_7.tar.gz',
    21: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.2%2B13/OpenJDK21U-jdk_x64_linux_hotspot_21.0.2_13.tar.gz',
  },
  darwin: {
    17: 'https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.10%2B7/OpenJDK17U-jdk_x64_mac_hotspot_17.0.10_7.tar.gz',
    21: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.2%2B13/OpenJDK21U-jdk_x64_mac_hotspot_21.0.2_13.tar.gz',
  },
};

let mainWindow;

// ─── WINDOW ──────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 600,
    minWidth: 800,
    minHeight: 500,
    frame: false,
    transparent: false,
    resizable: true,
    icon: path.join(__dirname, '../assets/icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    backgroundColor: '#0d1117',
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(() => {
  // Ensure base directory structure exists
  fs.mkdirSync(BASE_DIR, { recursive: true });
  fs.mkdirSync(path.join(BASE_DIR, 'mods'), { recursive: true });
  fs.mkdirSync(path.join(BASE_DIR, 'java'), { recursive: true });
  fs.mkdirSync(path.join(BASE_DIR, 'cache'), { recursive: true });

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function send(event, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(event, data);
  }
}

function log(msg) {
  console.log(`[Launcher] ${msg}`);
  send('log', msg);
}

// Download a file with progress reporting
function downloadFile(url, destPath, progressLabel) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);
    let downloaded = 0;
    let total = 0;

    const request = (reqUrl) => {
      proto.get(reqUrl, (res) => {
        // Follow redirects
        if (res.statusCode === 301 || res.statusCode === 302) {
          file.close();
          return request(res.headers.location);
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${reqUrl}`));
          return;
        }
        total = parseInt(res.headers['content-length'] || '0', 10);
        res.pipe(file);
        res.on('data', (chunk) => {
          downloaded += chunk.length;
          if (total > 0) {
            const pct = Math.round((downloaded / total) * 100);
            send('download-progress', { label: progressLabel, percent: pct, downloaded, total });
          }
        });
        file.on('finish', () => { file.close(); resolve(); });
        file.on('error', reject);
        res.on('error', reject);
      }).on('error', reject);
    };

    request(url);
  });
}

// Compute simple file hash for change detection
function fileHash(filePath) {
  try {
    const crypto = require('crypto');
    const buf = fs.readFileSync(filePath);
    return crypto.createHash('md5').update(buf).digest('hex');
  } catch {
    return null;
  }
}

// ─── MANIFEST ────────────────────────────────────────────────────────────────
async function fetchManifest() {
  return new Promise((resolve, reject) => {
    const proto = CONFIG.MANIFEST_URL.startsWith('https') ? https : http;
    proto.get(CONFIG.MANIFEST_URL, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        // Handle redirect
        https.get(res.headers.location, (r2) => {
          let data = '';
          r2.on('data', c => data += c);
          r2.on('end', () => {
            try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
          });
        }).on('error', reject);
        return;
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// ─── MOD SYNC ────────────────────────────────────────────────────────────────
async function syncMods(manifest, profileDir) {
  const modsDir = path.join(profileDir, 'mods');
  fs.mkdirSync(modsDir, { recursive: true });

  const serverMods = manifest.mods || [];
  const localFiles = fs.readdirSync(modsDir);

  // Remove mods not in manifest
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

// ─── JAVA ─────────────────────────────────────────────────────────────────────
function getRequiredJavaVersion(minecraftVersion) {
  for (const [prefix, info] of Object.entries(JAVA_VERSIONS)) {
    if (minecraftVersion.startsWith(prefix)) return info;
  }
  return { version: '17', major: 17 };
}

function findJavaExecutable(javaDir) {
  const platform = process.platform;
  const candidates = platform === 'win32'
    ? ['bin/java.exe', 'jdk/bin/java.exe']
    : ['bin/java', 'jdk/bin/java'];

  // Search recursively for java binary
  function searchDir(dir, depth = 0) {
    if (depth > 4) return null;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const found = searchDir(fullPath, depth + 1);
          if (found) return found;
        } else if (entry.name === (platform === 'win32' ? 'java.exe' : 'java')) {
          if (fullPath.includes('bin')) return fullPath;
        }
      }
    } catch {}
    return null;
  }

  return searchDir(javaDir);
}

async function ensureJava(majorVersion) {
  const javaDir = path.join(BASE_DIR, 'java', `jdk${majorVersion}`);
  fs.mkdirSync(javaDir, { recursive: true });

  // Check if already installed
  const existing = findJavaExecutable(javaDir);
  if (existing) {
    log(`Java ${majorVersion} already installed: ${existing}`);
    return existing;
  }

  const platform = process.platform;
  const url = JAVA_DOWNLOAD_URLS[platform]?.[majorVersion];
  if (!url) throw new Error(`No Java download URL for platform ${platform} / version ${majorVersion}`);

  log(`Downloading Java ${majorVersion} for ${platform}...`);
  send('status', `Baixando Java ${majorVersion}...`);

  const ext = platform === 'win32' ? 'zip' : 'tar.gz';
  const archivePath = path.join(BASE_DIR, 'cache', `jdk${majorVersion}.${ext}`);

  await downloadFile(url, archivePath, `Java ${majorVersion}`);

  log(`Extracting Java ${majorVersion}...`);
  send('status', `Extraindo Java ${majorVersion}...`);

  if (platform === 'win32') {
    // Use PowerShell to extract zip
    execSync(`powershell -command "Expand-Archive -Force '${archivePath}' '${javaDir}'"`, { stdio: 'pipe' });
  } else {
    execSync(`tar -xzf "${archivePath}" -C "${javaDir}" --strip-components=1`, { stdio: 'pipe' });
    // Make java executable
    const javaBin = path.join(javaDir, 'bin', 'java');
    if (fs.existsSync(javaBin)) fs.chmodSync(javaBin, '755');
  }

  // Clean up archive
  try { fs.unlinkSync(archivePath); } catch {}

  const javaExec = findJavaExecutable(javaDir);
  if (!javaExec) throw new Error('Java installation failed - binary not found after extraction');

  log(`Java ${majorVersion} installed at: ${javaExec}`);
  return javaExec;
}

// ─── LAUNCH MINECRAFT ────────────────────────────────────────────────────────
function launchMinecraft({ javaPath, minecraftDir, ram, username, accessToken, uuid, mcVersion, forgeVersion }) {
  const librariesDir = path.join(minecraftDir, 'libraries');
  const versionsDir = path.join(minecraftDir, 'versions');
  const assetsDir = path.join(minecraftDir, 'assets');
  const nativesDir = path.join(versionsDir, mcVersion, 'natives');

  // Build classpath (simplified - real implementation would parse version JSON)
  const forgeVersionId = `${mcVersion}-forge-${forgeVersion}`;
  const versionJsonPath = path.join(versionsDir, forgeVersionId, `${forgeVersionId}.json`);

  if (!fs.existsSync(versionJsonPath)) {
    throw new Error(`Forge version ${forgeVersionId} not found. Install Forge first via the official Forge installer.`);
  }

  const versionJson = JSON.parse(fs.readFileSync(versionJsonPath, 'utf8'));

  // Build classpath from libraries
  const classpath = [];
  for (const lib of (versionJson.libraries || [])) {
    if (lib.downloads?.artifact?.path) {
      const libPath = path.join(librariesDir, lib.downloads.artifact.path);
      if (fs.existsSync(libPath)) classpath.push(libPath);
    }
  }

  // Add main jar
  const mainJar = path.join(versionsDir, mcVersion, `${mcVersion}.jar`);
  if (fs.existsSync(mainJar)) classpath.push(mainJar);

  const mainClass = versionJson.mainClass || 'net.minecraft.launchwrapper.Launch';
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
    '--uuid', uuid || '00000000-0000-0000-0000-000000000000',
    '--accessToken', accessToken || '0',
    '--userType', accessToken ? 'mojang' : 'legacy',
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

// ─── IPC HANDLERS ────────────────────────────────────────────────────────────
ipcMain.handle('window-minimize', () => mainWindow.minimize());
ipcMain.handle('window-maximize', () => {
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.handle('window-close', () => app.quit());

ipcMain.handle('load-config', () => {
  const configPath = path.join(BASE_DIR, 'config.json');
  if (fs.existsSync(configPath)) {
    try { return JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
  }
  return {
    username: '',
    ram: 4096,
    selectedProfile: CONFIG.DEFAULT_PROFILE,
    minecraftDir: BASE_DIR,
    profiles: [],
  };
});

ipcMain.handle('save-config', (_, config) => {
  const configPath = path.join(BASE_DIR, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  return true;
});

ipcMain.handle('fetch-manifest', async () => {
  try {
    const manifest = await fetchManifest();
    // Cache manifest locally
    fs.writeFileSync(
      path.join(BASE_DIR, 'cache', 'manifest.json'),
      JSON.stringify(manifest, null, 2)
    );
    return { ok: true, manifest };
  } catch (err) {
    // Try cached version
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

    const mcVersion = profileManifest.minecraftVersion || '1.20.1';
    const forgeVersion = profileManifest.forgeVersion || '47.2.0';
    const javaInfo = getRequiredJavaVersion(mcVersion);

    const minecraftDir = config.minecraftDir || BASE_DIR;

    // Step 1: Ensure Java
    send('status', `Verificando Java ${javaInfo.major}...`);
    send('phase', 'java');
    const javaPath = await ensureJava(javaInfo.major);

    // Step 2: Sync mods
    send('status', 'Sincronizando mods...');
    send('phase', 'mods');
    const updatedCount = await syncMods(profileManifest, minecraftDir);

    if (updatedCount > 0) {
      log(`${updatedCount} mod(s) atualizado(s).`);
    } else {
      log('Todos os mods estão atualizados!');
    }

    // Step 3: Launch
    send('status', 'Iniciando Minecraft...');
    send('phase', 'launch');

    const pid = launchMinecraft({
      javaPath,
      minecraftDir,
      ram: config.ram || 4096,
      username: config.username || 'Player',
      accessToken: config.accessToken || null,
      uuid: config.uuid || null,
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

ipcMain.handle('open-folder', (_, folderPath) => {
  shell.openPath(folderPath || BASE_DIR);
});

ipcMain.handle('browse-minecraft-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Selecione a pasta do Minecraft',
    defaultPath: BASE_DIR,
  });
  if (!result.canceled) return result.filePaths[0];
  return null;
});

ipcMain.handle('get-system-info', () => {
  const totalRam = Math.floor(os.totalmem() / 1024 / 1024);
  return {
    platform: process.platform,
    totalRam,
    launcherDir: BASE_DIR,
  };
});
