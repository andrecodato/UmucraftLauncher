#!/usr/bin/env node
/**
 * generate-manifest.js
 *
 * Admin utility: scan a mods folder and generate/update manifest.json
 * with correct MD5 hashes, filenames, and auto-resolved download URLs.
 *
 * The script reads mod metadata from each .jar (mods.toml, fabric.mod.json,
 * or mcmod.info) and then queries CurseForge and Modrinth APIs to find the
 * direct download URL for each mod file.
 *
 * ─── Environment Variables ───────────────────────────────────────────────────
 *   CURSEFORGE_API_KEY  (required for CurseForge lookups)
 *     Obtain one at https://console.curseforge.com/#/api-keys
 *     Set it before running:
 *       Windows:  set CURSEFORGE_API_KEY=seu_token_aqui
 *       Linux:    export CURSEFORGE_API_KEY=seu_token_aqui
 *
 * ─── Usage ───────────────────────────────────────────────────────────────────
 *   node scripts/generate-manifest.js <modsDir> [manifestPath] [profileName]
 *
 *   Examples:
 *     node scripts/generate-manifest.js ./mods
 *     node scripts/generate-manifest.js ./mods ./manifest.json "My Pack"
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const StreamZip = require('node-stream-zip');

// ─── CLI args ────────────────────────────────────────────────────────────────
const modsDir = process.argv[2] || './mods';
const manifestPath = process.argv[3] || './manifest.json';
const profileName = process.argv[4] || 'Default';

const CURSEFORGE_API_KEY = process.env.CURSEFORGE_API_KEY || '';

if (!CURSEFORGE_API_KEY) {
  console.warn('⚠  CURSEFORGE_API_KEY não definida – consultas ao CurseForge serão ignoradas.');
  console.warn('   Defina com: set CURSEFORGE_API_KEY=seu_token   (Windows)');
  console.warn('              export CURSEFORGE_API_KEY=seu_token  (Linux/Mac)\n');
}

if (!fs.existsSync(modsDir)) {
  console.error(`Pasta não encontrada: ${modsDir}`);
  process.exit(1);
}

// ─── HTTP helper ─────────────────────────────────────────────────────────────
function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const req = proto.get(url, { headers }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return httpGet(res.headers.location, headers).then(resolve, reject);
      }
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ─── Read mod metadata from .jar ─────────────────────────────────────────────
async function readModMeta(jarPath) {
  const meta = { modId: null, version: null };

  let zip;
  try {
    zip = new StreamZip.async({ file: jarPath });
    const entries = await zip.entries();
    const entryNames = Object.keys(entries);

    // 1) Forge – META-INF/mods.toml
    if (entryNames.includes('META-INF/mods.toml')) {
      const buf = await zip.entryData('META-INF/mods.toml');
      const text = buf.toString('utf8');
      const idMatch = text.match(/modId\s*=\s*"([^"]+)"/);
      const verMatch = text.match(/version\s*=\s*"([^"]+)"/);
      if (idMatch) meta.modId = idMatch[1];
      if (verMatch && verMatch[1] !== '${file.jarVersion}') meta.version = verMatch[1];
    }

    // 2) Fabric – fabric.mod.json
    if (!meta.modId && entryNames.includes('fabric.mod.json')) {
      const buf = await zip.entryData('fabric.mod.json');
      try {
        const json = JSON.parse(buf.toString('utf8'));
        meta.modId = json.id || null;
        meta.version = json.version || null;
      } catch {}
    }

    // 3) Legacy Forge – mcmod.info
    if (!meta.modId && entryNames.includes('mcmod.info')) {
      const buf = await zip.entryData('mcmod.info');
      try {
        let json = JSON.parse(buf.toString('utf8'));
        if (Array.isArray(json)) json = json[0];
        if (json.modList) json = json.modList[0];
        meta.modId = json.modid || null;
        meta.version = json.version || null;
      } catch {}
    }
  } catch {
    // jar could not be read – leave meta empty
  } finally {
    if (zip) try { await zip.close(); } catch {}
  }

  return meta;
}

// ─── CurseForge lookup ──────────────────────────────────────────────────────
async function searchCurseForge(modId, filename) {
  if (!CURSEFORGE_API_KEY) return null;

  try {
    const query = encodeURIComponent(modId);
    const url = `https://api.curseforge.com/v1/mods/search?gameId=432&searchFilter=${query}&classId=6&sortField=2&sortOrder=desc&pageSize=5`;
    const res = await httpGet(url, {
      'x-api-key': CURSEFORGE_API_KEY,
      Accept: 'application/json',
    });
    if (res.status !== 200) return null;

    const json = JSON.parse(res.body);
    const mods = json.data || [];
    if (mods.length === 0) return null;

    // Pick the mod whose slug best matches
    const mod = mods.find((m) => m.slug === modId) || mods[0];

    // Try to find the exact file by filename
    const filesUrl = `https://api.curseforge.com/v1/mods/${mod.id}/files?pageSize=50`;
    const filesRes = await httpGet(filesUrl, {
      'x-api-key': CURSEFORGE_API_KEY,
      Accept: 'application/json',
    });
    if (filesRes.status !== 200) return null;

    const filesJson = JSON.parse(filesRes.body);
    const files = filesJson.data || [];

    // Match by exact filename
    let match = files.find((f) => f.fileName === filename);
    // Fallback: filename contains modId
    if (!match) match = files.find((f) => f.fileName.toLowerCase().includes(modId.toLowerCase()));

    if (match && match.downloadUrl) return match.downloadUrl;

    // If file found but downloadUrl is null (CurseForge restriction), build CDN URL
    if (match) {
      const fid = String(match.id);
      const part1 = fid.substring(0, 4);
      const part2 = fid.substring(4);
      return `https://edge.forgecdn.net/files/${part1}/${part2}/${encodeURIComponent(match.fileName)}`;
    }

    return null;
  } catch {
    return null;
  }
}

// ─── Modrinth lookup ────────────────────────────────────────────────────────
async function searchModrinth(modId, filename) {
  try {
    const query = encodeURIComponent(modId);
    const url = `https://api.modrinth.com/v2/search?query=${query}&facets=[["project_type:mod"]]&limit=5`;
    const res = await httpGet(url, {
      'User-Agent': 'Umulauncher/generate-manifest (contact@umucraft)',
    });
    if (res.status !== 200) return null;

    const json = JSON.parse(res.body);
    const hits = json.hits || [];
    if (hits.length === 0) return null;

    const project = hits.find((h) => h.slug === modId) || hits[0];

    // Get versions for this project
    const versionsUrl = `https://api.modrinth.com/v2/project/${project.project_id}/version`;
    const versionsRes = await httpGet(versionsUrl, {
      'User-Agent': 'Umulauncher/generate-manifest (contact@umucraft)',
    });
    if (versionsRes.status !== 200) return null;

    const versions = JSON.parse(versionsRes.body);

    // Match by exact filename in files
    for (const ver of versions) {
      for (const file of ver.files || []) {
        if (file.filename === filename) return file.url;
      }
    }

    // Fallback: first file of latest version
    if (versions.length > 0 && versions[0].files?.length > 0) {
      return versions[0].files[0].url;
    }

    return null;
  } catch {
    return null;
  }
}

// ─── Resolve download URL ───────────────────────────────────────────────────
async function resolveUrl(modId, filename) {
  // Try CurseForge first
  const cfUrl = await searchCurseForge(modId, filename);
  if (cfUrl) return { url: cfUrl, source: 'CurseForge' };

  // Then Modrinth
  const mrUrl = await searchModrinth(modId, filename);
  if (mrUrl) return { url: mrUrl, source: 'Modrinth' };

  return { url: `URL_NAO_ENCONTRADA_PARA_${filename}`, source: null };
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  // Load existing manifest if it exists
  let manifest = {};
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      console.log('Manifesto existente carregado.');
    } catch (e) {
      console.warn('Não foi possível ler manifesto existente, criando novo.');
    }
  }

  if (!manifest.profiles) manifest.profiles = {};
  if (!manifest.profiles[profileName]) {
    manifest.profiles[profileName] = {
      minecraftVersion: '1.20.1',
      forgeVersion: '47.2.0',
      mods: [],
    };
  }

  const profile = manifest.profiles[profileName];
  const existingMods = profile.mods || [];

  // Scan mods folder
  const files = fs.readdirSync(modsDir).filter((f) => f.endsWith('.jar'));
  console.log(`\nEncontrados ${files.length} arquivos .jar em ${modsDir}\n`);
  console.log('─'.repeat(80));

  const newMods = [];

  for (let i = 0; i < files.length; i++) {
    const filename = files[i];
    const filePath = path.join(modsDir, filename);
    const buf = fs.readFileSync(filePath);
    const md5 = crypto.createHash('md5').update(buf).digest('hex');
    const size = fs.statSync(filePath).size;

    // Read mod metadata from jar
    const meta = await readModMeta(filePath);
    const modId = meta.modId || filename.replace(/[-_][\d.]+.*\.jar$/, '').replace(/[-_]/g, '').toLowerCase();
    const modVersion = meta.version || '';

    // Check existing entry
    const existing = existingMods.find((m) => m.filename === filename);
    const changed = existing ? existing.md5 !== md5 : true;
    const status = !existing ? '✚ NOVO' : changed ? '↻ ATUALIZADO' : '✓ sem alteração';

    console.log(`\n[${i + 1}/${files.length}] ${filename}`);
    console.log(`  Status:  ${status}`);
    console.log(`  modId:   ${meta.modId || '(não detectado, inferido: ' + modId + ')'}`);
    console.log(`  Versão:  ${modVersion || '(não detectada)'}`);
    console.log(`  MD5:     ${md5}`);

    // Resolve URL: reuse existing valid URL for unchanged mods
    let url;
    let source;
    const existingUrlInvalid = !existing?.url || existing.url.startsWith('COLOQUE') || existing.url.startsWith('URL_NAO_ENCONTRADA');

    if (!changed && !existingUrlInvalid) {
      url = existing.url;
      source = '(cache do manifesto)';
    } else {
      const result = await resolveUrl(modId, filename);
      url = result.url;
      source = result.source || 'NÃO ENCONTRADO';
      if (!result.source) {
        console.log(`  ⚠ URL não encontrada em CurseForge nem Modrinth!`);
      }
    }

    console.log(`  Fonte:   ${source}`);
    console.log(`  URL:     ${url}`);

    newMods.push({
      name: existing?.name || meta.modId || filename.replace(/[-_][\d.]+.*\.jar$/, '').replace(/[-_]/g, ' '),
      filename,
      version: modVersion || existing?.version || '',
      md5,
      size,
      url,
    });
  }

  console.log('\n' + '─'.repeat(80));

  // Check for removed mods
  const removedMods = existingMods.filter((m) => !files.includes(m.filename));
  if (removedMods.length > 0) {
    console.log(`\n⚠ Mods REMOVIDOS (não encontrados na pasta):`);
    removedMods.forEach((m) => console.log(`  ✗ ${m.filename}`));
  }

  profile.mods = newMods;
  manifest.profiles[profileName] = profile;

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  // Summary
  const found = newMods.filter((m) => !m.url.startsWith('URL_NAO_ENCONTRADA'));
  const notFound = newMods.filter((m) => m.url.startsWith('URL_NAO_ENCONTRADA'));

  console.log(`\n✅ Manifesto salvo em: ${manifestPath}`);
  console.log(`   ${newMods.length} mods processados | ${found.length} com URL | ${notFound.length} sem URL`);

  if (notFound.length > 0) {
    console.log('\n⚠ Mods sem URL resolvida (edite manualmente no manifest.json):');
    notFound.forEach((m) => console.log(`   - ${m.filename}`));
  }

  console.log('\n📋 Próximos passos:');
  console.log('  1. Revise as URLs no manifest.json (especialmente as não encontradas)');
  console.log('  2. Hospede o manifest.json em um lugar público (GitHub Raw, Dropbox, etc)');
  console.log('  3. Atualize MANIFEST_URL em src/main/main.js');
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
