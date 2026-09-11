'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { downloadFile } = require('../utils/download');

const EXTRACT_TIMEOUT = 3 * 60 * 1000;  // 3 minutes

// Cada modpack pode exigir um major diferente (JAVA_VERSIONS em utils/paths.js) —
// mantemos uma build Temurin fixa e testada por major, em vez de "a mais nova
// disponível", porque Forge/NeoForge/Connector fazem hacks no sistema de
// módulos do Java que quebram entre minor/major releases (ex: Connector
// funcionando em Java 21 mas quebrando em Java 25 com
// "NoSuchElementException" — bug real encontrado em produção).
const DOWNLOAD_URLS = {
  17: {
    win32:  'https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.10%2B7/OpenJDK17U-jdk_x64_windows_hotspot_17.0.10_7.zip',
    linux:  'https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.10%2B7/OpenJDK17U-jdk_x64_linux_hotspot_17.0.10_7.tar.gz',
    darwin: 'https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.10%2B7/OpenJDK17U-jdk_x64_mac_hotspot_17.0.10_7.tar.gz',
  },
  21: {
    win32:  'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.2%2B13/OpenJDK21U-jdk_x64_windows_hotspot_21.0.2_13.zip',
    linux:  'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.2%2B13/OpenJDK21U-jdk_x64_linux_hotspot_21.0.2_13.tar.gz',
    darwin: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.2%2B13/OpenJDK21U-jdk_x64_mac_hotspot_21.0.2_13.tar.gz',
  },
};

class RuntimeInstaller {
  constructor(logger, baseDir) {
    this.logger = logger;
    this.baseDir = baseDir;
    this.javaDir = path.join(baseDir, 'java');
    this.cacheDir = path.join(baseDir, 'cache');
    fs.mkdirSync(this.javaDir, { recursive: true });
    fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  /**
   * Download file with redirect support, timeout, retry and progress callback.
   *
   * Este método já teve um downloader `https.get` próprio, duplicando (mal) o
   * de `utils/download.js`. Como é ele quem busca o JDK no GitHub no primeiro
   * boot, era também o primeiro lugar a falhar com "unable to get local issuer
   * certificate" atrás de antivírus com inspeção HTTPS — e o único que não se
   * beneficiava de nenhuma correção feita na camada de rede compartilhada.
   * Agora delega: um só caminho de rede para o launcher inteiro.
   */
  _downloadFile(url, destPath, onProgress) {
    return downloadFile(url, destPath, 'Java Runtime', {
      silent: true, // o progresso da tela de bootstrap vem do onProgress
      onProgress: (percent, downloaded, total) => {
        if (onProgress) onProgress(percent, downloaded, total);
      },
      onRetry: ({ attempt, attempts, error, delayMs }) => {
        this.logger.log(
          `Falha de rede baixando o JDK (${error.code || error.message}); `
          + `nova tentativa em ${Math.round(delayMs / 1000)}s (${attempt}/${attempts - 1})`
        );
      },
    });
  }

  /**
   * Download and install a specific Adoptium JDK major version (17 or 21).
   * Returns { valid, version, path, output } from the detector.
   */
  async install(majorVersion, onProgress) {
    const platform = process.platform;
    const urlsForMajor = DOWNLOAD_URLS[majorVersion];
    if (!urlsForMajor) throw new Error(`No Adoptium build configured for Java major ${majorVersion}`);
    const url = urlsForMajor[platform];
    if (!url) throw new Error(`No download URL for platform: ${platform}`);

    const ext = platform === 'win32' ? 'zip' : 'tar.gz';
    const archivePath = path.join(this.cacheDir, `jdk${majorVersion}.${ext}`);
    const targetDir = path.join(this.javaDir, `jdk${majorVersion}`);

    // Clean previous failed install
    if (fs.existsSync(targetDir)) {
      this.logger.log(`Removing previous install at: ${targetDir}`);
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
    fs.mkdirSync(targetDir, { recursive: true });

    // Download
    this.logger.log(`Downloading Adoptium JDK ${majorVersion} for ${platform}...`);
    this.logger.log(`URL: ${url}`);

    await this._downloadFile(url, archivePath, onProgress);

    // Extract
    this.logger.log(`Extracting to: ${targetDir}`);

    try {
      if (platform === 'win32') {
        execSync(
          `powershell -NoProfile -Command "Expand-Archive -Force -LiteralPath '${archivePath}' -DestinationPath '${targetDir}'"`,
          { stdio: 'pipe', timeout: EXTRACT_TIMEOUT, windowsHide: true }
        );
      } else {
        execSync(
          `tar -xzf "${archivePath}" -C "${targetDir}" --strip-components=1`,
          { stdio: 'pipe', timeout: EXTRACT_TIMEOUT }
        );
        const javaBin = path.join(targetDir, 'bin', 'java');
        if (fs.existsSync(javaBin)) fs.chmodSync(javaBin, '755');
      }
    } catch (err) {
      throw new Error(`Extraction failed: ${err.message}`);
    }

    // Cleanup archive
    try { fs.unlinkSync(archivePath); } catch {}

    // Find and validate the java executable
    const RuntimeDetector = require('./detector');
    const detector = new RuntimeDetector(this.logger, this.baseDir);
    const candidates = detector.findJavaExecutables(targetDir);

    if (candidates.length === 0) {
      throw new Error('Java binary not found after extraction');
    }

    const result = detector.validateExecutable(candidates[0]);
    if (!result.valid) {
      throw new Error(`Installed Java validation failed: ${result.error}`);
    }

    this.logger.log(`Installed Java validated: version ${result.version}`);
    return result;
  }
}

module.exports = RuntimeInstaller;
