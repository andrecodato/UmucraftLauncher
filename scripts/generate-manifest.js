#!/usr/bin/env node
/**
 * generate-manifest.js
 *
 * Utility: generate a manifest.json for the launcher from a mods .zip file.
 *
 * Usage:
 *   node scripts/generate-manifest.js <modsZipPath> <dropboxUrl> [manifestPath] [profileName] [version]
 *
 * Examples:
 *   node scripts/generate-manifest.js ./mods.zip "https://www.dropbox.com/scl/fi/XXX/mods.zip?rlkey=YYY&dl=1"
 *   node scripts/generate-manifest.js ./mods.zip "https://dropbox-url" ./manifest.json "Default" "1.0.0"
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const modsZipPath = process.argv[2];
const dropboxUrl = process.argv[3];
const manifestPath = process.argv[4] || './manifest.json';
const profileName = process.argv[5] || 'Default';
const version = process.argv[6] || '1.0.0';

if (!modsZipPath || !dropboxUrl) {
  console.error('Uso: node scripts/generate-manifest.js <modsZipPath> <dropboxUrl> [manifestPath] [profileName] [version]');
  console.error('');
  console.error('Exemplo:');
  console.error('  node scripts/generate-manifest.js ./mods.zip "https://www.dropbox.com/scl/fi/XXX/mods.zip?rlkey=YYY&dl=1"');
  process.exit(1);
}

if (!fs.existsSync(modsZipPath)) {
  console.error(`Arquivo nao encontrado: ${modsZipPath}`);
  process.exit(1);
}

// Calculate MD5 of the zip
const buf = fs.readFileSync(modsZipPath);
const md5 = crypto.createHash('md5').update(buf).digest('hex');
const size = fs.statSync(modsZipPath).size;

// Load existing manifest or create new
let manifest = {};
if (fs.existsSync(manifestPath)) {
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    console.log('Manifesto existente carregado.');
  } catch {
    console.warn('Nao foi possivel ler manifesto existente, criando novo.');
  }
}

if (!manifest.profiles) manifest.profiles = {};
if (!manifest.profiles[profileName]) {
  manifest.profiles[profileName] = {
    minecraftVersion: '1.20.1',
    forgeVersion: '47.2.0',
  };
}

const profile = manifest.profiles[profileName];
profile.modsVersion = version;
profile.modsZipUrl = dropboxUrl;
profile.modsZipMd5 = md5;

// Remove old per-mod fields if they exist
delete profile.mods;

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

console.log('');
console.log('Manifesto gerado com sucesso!');
console.log('─'.repeat(50));
console.log(`  Perfil:     ${profileName}`);
console.log(`  Versao:     ${version}`);
console.log(`  Zip:        ${modsZipPath}`);
console.log(`  Tamanho:    ${(size / 1024 / 1024).toFixed(2)} MB`);
console.log(`  MD5:        ${md5}`);
console.log(`  Dropbox:    ${dropboxUrl}`);
console.log(`  Salvo em:   ${manifestPath}`);
console.log('─'.repeat(50));
console.log('');
console.log('Proximos passos:');
console.log('  1. Suba o mods.zip no Dropbox e pegue o link compartilhavel');
console.log('  2. Suba o manifest.json no GitHub (raw URL)');
console.log('  3. Configure MANIFEST_URL no paths.js para o raw URL do GitHub');
