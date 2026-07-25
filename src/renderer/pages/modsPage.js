import { $, escapeHtml, capitalize } from '../helpers.js';
import { appState } from '../store/state.js';

const modsListCache = {};

export function setupModsPage() {
  $('mods-search').addEventListener('input', filterMods);
  $('mods-back-btn').addEventListener('click', showPacksView);
}

export function populateModsTab() {
  if (!appState.manifest) return;
  showPacksView();
  Object.keys(modsListCache).forEach(k => delete modsListCache[k]);

  const grid = $('mods-packs-grid');
  grid.innerHTML = '';

  const profileNames = appState.manifest.profiles ? Object.keys(appState.manifest.profiles) : [];
  if (profileNames.length === 0) {
    grid.innerHTML = '<div class="empty-state">Nenhum modpack configurado.</div>';
    return;
  }

  profileNames.forEach(name => grid.appendChild(createPackCard(name, appState.manifest.profiles[name])));
}

function createPackCard(name, prof) {
  const card = document.createElement('div');
  card.className = 'mods-pack-card';

  const loaderBadge = prof.loader && prof.loader !== 'vanilla' && prof.loaderVersion
    ? `<span class="badge loader-${escapeHtml(prof.loader)}">${escapeHtml(capitalize(prof.loader))} ${escapeHtml(prof.loaderVersion)}</span>`
    : '';

  card.innerHTML = `
    <div class="mods-pack-name">${escapeHtml(name)}</div>
    <div class="mods-pack-badges">
      <span class="badge">MC ${escapeHtml(prof.minecraftVersion || '?')}</span>
      ${loaderBadge}
    </div>
    <div class="mods-pack-count">${prof.modsZipUrl ? 'Ver mods' : 'Sem mods'}</div>
  `;

  card.addEventListener('click', () => openPack(name, prof));
  return card;
}

function showPacksView() {
  $('mods-packs-view').style.display = '';
  $('mods-detail-view').style.display = 'none';
  $('mods-search').value = '';
}

async function openPack(name, prof) {
  $('mods-packs-view').style.display = 'none';
  $('mods-detail-view').style.display = '';
  $('mods-detail-title').textContent = `Mods — ${name}`;

  const grid = $('mods-detail-grid');
  grid.innerHTML = '<div class="empty-state">Carregando mods...</div>';

  if (!prof.modsZipUrl) {
    grid.innerHTML = '<div class="empty-state">Este modpack ainda não tem mods.</div>';
    return;
  }
  if (!prof.modsListUrl) {
    grid.innerHTML = '<div class="empty-state">A lista detalhada de mods ainda não foi publicada para este modpack.</div>';
    return;
  }

  if (modsListCache[name]) {
    renderModsGrid(grid, modsListCache[name]);
    return;
  }

  const result = await window.launcher.fetchModsList(prof.modsListUrl, name);
  if (!result.ok || !result.modsList || result.modsList.length === 0) {
    grid.innerHTML = '<div class="empty-state">Não foi possível carregar a lista de mods.</div>';
    return;
  }

  modsListCache[name] = result.modsList;
  renderModsGrid(grid, result.modsList);
}

function renderModsGrid(grid, modsList) {
  grid.innerHTML = '';
  modsList.forEach(mod => grid.appendChild(createModCard(mod)));
}

function createModCard(mod) {
  const card = document.createElement('div');
  card.className = 'mod-card';

  const icon = mod.iconUrl
    ? `<img class="mod-icon" src="${escapeHtml(mod.iconUrl)}" alt="" loading="lazy">`
    : '<div class="mod-icon-placeholder"></div>';

  const authors = mod.authors && mod.authors.length ? escapeHtml(mod.authors.join(', ')) : '';
  const version = mod.version && mod.version !== 'Unknown' ? escapeHtml(mod.version) : '';

  card.innerHTML = `
    ${icon}
    <div class="mod-info">
      <div class="mod-name">${escapeHtml(mod.name)}</div>
      ${version ? `<div class="mod-meta">${version}</div>` : ''}
      ${authors ? `<div class="mod-authors">${authors}</div>` : ''}
      ${mod.description ? `<div class="mod-desc">${escapeHtml(mod.description)}</div>` : ''}
    </div>
  `;
  return card;
}

function filterMods() {
  const query = $('mods-search').value.trim().toLowerCase();
  document.querySelectorAll('#mods-detail-grid .mod-card').forEach(card => {
    const name = card.querySelector('.mod-name')?.textContent.toLowerCase() || '';
    card.style.display = !query || name.includes(query) ? '' : 'none';
  });
}
