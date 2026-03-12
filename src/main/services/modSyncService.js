'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const extractZip = require('extract-zip');
const { send, log } = require('../utils/ipcSender');
const { downloadFile } = require('../utils/download');
const { fileHash } = require('../utils/fileHash');

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

module.exports = { syncMods };
