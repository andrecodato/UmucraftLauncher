'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const extractZip = require('extract-zip');
const { send, log } = require('../utils/ipcSender');
const { downloadFile } = require('../utils/download');
const { fileHash } = require('../utils/fileHash');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Windows can transiently EPERM/EBUSY a fresh file (AV real-time scan, search
// indexer) right as we try to delete/replace it. Retry a few times before
// giving up instead of failing the whole sync over a race condition.
async function withRetry(fn, { attempts = 5, delayMs = 250 } = {}) {
  for (let i = 1; i <= attempts; i++) {
    try {
      return fn();
    } catch (err) {
      const retryable = err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES';
      if (!retryable || i === attempts) throw err;
      await delay(delayMs);
    }
  }
}

// rename() fails with EXDEV if the scratch dir and destination end up on
// different volumes (e.g. TEMP redirected elsewhere); fall back to a copy.
function moveInto(from, to) {
  try {
    fs.renameSync(from, to);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    fs.cpSync(from, to, { recursive: true });
    fs.rmSync(from, { recursive: true, force: true });
  }
}

async function syncMods(manifest, profileDir) {
  const modsDir = path.join(profileDir, 'mods');
  fs.mkdirSync(modsDir, { recursive: true });

  const modsVersion = manifest.modsVersion;
  const modsZipUrl = manifest.modsZipUrl;
  const modsZipMd5 = manifest.modsZipMd5;

  if (!modsZipUrl) {
    log('Nenhum modsZipUrl no manifest, pulando sync.');
    return 0;
  }

  // Check local version
  const versionFile = path.join(profileDir, '.mods-version');
  const localVersion = fs.existsSync(versionFile)
    ? fs.readFileSync(versionFile, 'utf8').trim()
    : null;

  if (localVersion === modsVersion) {
    log(`Mods já estão na versão ${modsVersion}, pulando download.`);
    send('sync-progress', { current: 1, total: 1, filename: 'Mods atualizados', percent: 100 });
    return 0;
  }

  log(`Atualizando mods: ${localVersion || 'nenhuma'} -> ${modsVersion}`);
  send('sync-progress', { current: 0, total: 1, filename: 'Baixando pacote de mods...', percent: 0 });

  // Download zip to temp
  const tmpDir = path.join(os.tmpdir(), 'umulauncher-mods');
  fs.mkdirSync(tmpDir, { recursive: true });
  const zipPath = path.join(tmpDir, 'mods.zip');

  await downloadFile(modsZipUrl, zipPath, 'Baixando pacote de mods');

  // Verify MD5
  if (modsZipMd5) {
    send('sync-progress', { current: 0, total: 1, filename: 'Verificando integridade...', percent: 0 });
    const hash = fileHash(zipPath);
    if (hash !== modsZipMd5) {
      fs.unlinkSync(zipPath);
      throw new Error(`MD5 inválido: esperado ${modsZipMd5}, obteve ${hash}`);
    }
    log('MD5 verificado com sucesso.');
  }

  // Clear mods folder
  send('sync-progress', { current: 0, total: 1, filename: 'Limpando pasta de mods...', percent: 0 });
  const existing = fs.readdirSync(modsDir);
  for (const file of existing) {
    const filePath = path.join(modsDir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      fs.rmSync(filePath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(filePath);
    }
  }
  log(`Pasta mods limpa (${existing.length} itens removidos).`);

  // Extract zip into mods folder
  send('sync-progress', { current: 0, total: 1, filename: 'Extraindo mods...', percent: 50 });
  await extractZip(zipPath, { dir: modsDir });

  // Save version
  fs.writeFileSync(versionFile, modsVersion);

  // Cleanup temp
  try { fs.unlinkSync(zipPath); } catch {}

  const newFiles = fs.readdirSync(modsDir).filter(f => f.endsWith('.jar'));
  log(`Mods atualizados para versão ${modsVersion} (${newFiles.length} mods extraídos).`);
  send('sync-progress', { current: 1, total: 1, filename: 'Mods atualizados!', percent: 100 });

  return newFiles.length;
}

/**
 * Syncs config/shaderpacks/resourcepacks/options.txt/etc — whatever the
 * server admin drops in the profile's staging folder alongside mods/ (see
 * deploy/pi-server/watcher.py's rebuild_extras_zip). Unlike syncMods, this
 * never clears profileDir itself: it's an overlay applied on top of an
 * instance dir that also holds player-owned data (saves, logs) which must
 * never be wiped by a sync.
 *
 * Extracting straight into profileDir used to overwrite existing files
 * (e.g. mod-managed config/*.json) in place, which on Windows can EPERM
 * when AV/indexing has a fresh handle on one of them. Instead we extract
 * into a scratch dir first, then for each top-level entry the zip actually
 * provides, delete-and-replace that one entry in profileDir — same
 * delete-then-rewrite approach syncMods uses for mods/, just scoped to
 * only the paths extras.zip owns so saves/logs/options.txt are untouched.
 */
async function syncExtras(manifest, profileDir) {
  const extrasVersion = manifest.extrasVersion;
  const extrasZipUrl = manifest.extrasZipUrl;
  const extrasZipMd5 = manifest.extrasZipMd5;

  if (!extrasZipUrl) {
    return 0;
  }

  const versionFile = path.join(profileDir, '.extras-version');
  const localVersion = fs.existsSync(versionFile)
    ? fs.readFileSync(versionFile, 'utf8').trim()
    : null;

  if (localVersion === extrasVersion) {
    log(`Config/shaders/extras já estão na versão ${extrasVersion}, pulando download.`);
    return 0;
  }

  log(`Atualizando config/shaders/extras: ${localVersion || 'nenhuma'} -> ${extrasVersion}`);
  send('sync-progress', { current: 0, total: 1, filename: 'Baixando config/shaders...', percent: 0 });

  const tmpDir = path.join(os.tmpdir(), 'umulauncher-extras');
  fs.mkdirSync(tmpDir, { recursive: true });
  const zipPath = path.join(tmpDir, 'extras.zip');
  const extractDir = path.join(tmpDir, 'extracted');

  await downloadFile(extrasZipUrl, zipPath, 'Baixando config/shaders...');

  if (extrasZipMd5) {
    const hash = fileHash(zipPath);
    if (hash !== extrasZipMd5) {
      fs.unlinkSync(zipPath);
      throw new Error(`MD5 inválido (extras): esperado ${extrasZipMd5}, obteve ${hash}`);
    }
  }

  send('sync-progress', { current: 0, total: 1, filename: 'Extraindo config/shaders...', percent: 50 });
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  await extractZip(zipPath, { dir: extractDir });

  const entries = fs.readdirSync(extractDir);
  for (const entry of entries) {
    const from = path.join(extractDir, entry);
    const to = path.join(profileDir, entry);
    await withRetry(() => fs.rmSync(to, { recursive: true, force: true }));
    await withRetry(() => moveInto(from, to));
  }
  fs.rmSync(extractDir, { recursive: true, force: true });

  fs.writeFileSync(versionFile, extrasVersion);
  try { fs.unlinkSync(zipPath); } catch {}

  log(`Config/shaders/extras atualizados para versão ${extrasVersion} (${entries.length} itens substituídos).`);
  send('sync-progress', { current: 1, total: 1, filename: 'Config/shaders atualizados!', percent: 100 });

  return 1;
}

module.exports = { syncMods, syncExtras };
