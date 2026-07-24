'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { httpGetJson } = require('../utils/http');
const { downloadFile } = require('../utils/download');
const { mapWithConcurrency } = require('../utils/concurrency');

// Same index Mojang's own launcher uses to resolve a per-version "javaVersion"
// component (java-runtime-alpha/beta/gamma/delta/legacy) to an actual runtime
// for the current platform. This is the JRE ATLauncher's "Uses Java provided
// by Minecraft" option (and the official launcher) actually run — not a
// generic Adoptium build. Confirmed in production that a generic Temurin 21
// build (same major version) still crashed a NeoForge+Connector modpack that
// launches fine under this one.
const RUNTIME_INDEX_URL = 'https://piston-meta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';

const DOWNLOAD_CONCURRENCY = 16;

function mojangPlatformKey() {
  const { platform, arch } = process;
  if (platform === 'win32') {
    if (arch === 'arm64') return 'windows-arm64';
    if (arch === 'ia32') return 'windows-x86';
    return 'windows-x64';
  }
  if (platform === 'darwin') {
    return arch === 'arm64' ? 'mac-os-arm64' : 'mac-os';
  }
  // linux
  return arch === 'ia32' ? 'linux-i386' : 'linux';
}

function javaExeName() {
  return process.platform === 'win32' ? 'java.exe' : 'java';
}

class MojangJavaInstaller {
  constructor(logger, baseDir) {
    this.logger = logger;
    this.javaDir = path.join(baseDir, 'java');
  }

  targetDir(component) {
    return path.join(this.javaDir, `mojang-${component}`);
  }

  /**
   * Returns the java executable path if `component` is already fully
   * installed and valid, otherwise null.
   */
  findExisting(component) {
    const exe = path.join(this.targetDir(component), 'bin', javaExeName());
    return fs.existsSync(exe) ? exe : null;
  }

  /**
   * Download and install Mojang's own JRE for `component`
   * (e.g. "java-runtime-delta"). Returns the java executable path.
   */
  async ensure(component, onProgress) {
    const existing = this.findExisting(component);
    if (existing) {
      this.logger.log(`Mojang JRE ja instalado: ${existing}`);
      return existing;
    }

    const platformKey = mojangPlatformKey();
    this.logger.log(`Baixando JRE oficial da Mojang (${component}, ${platformKey})...`);

    const index = await httpGetJson(RUNTIME_INDEX_URL);
    const entries = index[platformKey]?.[component];
    if (!entries || entries.length === 0) {
      throw new Error(`Mojang nao publica ${component} para ${platformKey}`);
    }

    const manifestMeta = entries[0].manifest;
    const manifest = await httpGetJson(manifestMeta.url);
    const files = Object.entries(manifest.files || {});

    const dest = this.targetDir(component);
    fs.mkdirSync(dest, { recursive: true });

    // Directories first (some file paths are deep, and download() below also
    // mkdir's per-file, but doing it upfront keeps behavior obvious).
    for (const [relPath, entry] of files) {
      if (entry.type === 'directory') {
        fs.mkdirSync(path.join(dest, relPath), { recursive: true });
      }
    }

    const fileEntries = files.filter(([, entry]) => entry.type === 'file');
    let completed = 0;

    await mapWithConcurrency(fileEntries, DOWNLOAD_CONCURRENCY, async ([relPath, entry]) => {
      const destPath = path.join(dest, relPath);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      const raw = entry.downloads.raw;
      await downloadFile(raw.url, destPath, `Java (${component})`, { silent: true });

      if (raw.sha1) {
        const hash = crypto.createHash('sha1').update(fs.readFileSync(destPath)).digest('hex');
        if (hash !== raw.sha1) {
          throw new Error(`Hash invalido para ${relPath}: esperado ${raw.sha1}, obteve ${hash}`);
        }
      }

      if (entry.executable && process.platform !== 'win32') {
        fs.chmodSync(destPath, 0o755);
      }

      completed++;
      const pct = Math.round((completed / fileEntries.length) * 100);
      if (onProgress) onProgress(pct, completed, fileEntries.length);
    });

    // Symlinks (mac/linux JRE packages include some, e.g. legacy jre bin
    // shims). Windows builds don't use this entry type.
    for (const [relPath, entry] of files) {
      if (entry.type === 'link' && entry.target) {
        const linkPath = path.join(dest, relPath);
        try {
          fs.mkdirSync(path.dirname(linkPath), { recursive: true });
          if (!fs.existsSync(linkPath)) fs.symlinkSync(entry.target, linkPath);
        } catch (err) {
          this.logger.log(`Aviso: falha ao criar symlink ${relPath}: ${err.message}`);
        }
      }
    }

    const javaBin = path.join(dest, 'bin', javaExeName());
    if (!fs.existsSync(javaBin)) {
      throw new Error(`java nao encontrado apos instalar ${component} (esperado em ${javaBin})`);
    }
    if (process.platform !== 'win32') {
      try { fs.chmodSync(javaBin, 0o755); } catch {}
    }

    this.logger.log(`Mojang JRE ${component} instalado: ${javaBin}`);
    return javaBin;
  }
}

module.exports = MojangJavaInstaller;
