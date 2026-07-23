import { $, escapeHtml, capitalize } from '../helpers.js';
import { appState } from '../store/state.js';

export function setupModsPage() {
  $('mods-search').addEventListener('input', filterMods);
}

export async function populateModsTab() {
  if (!appState.manifest) return;
  const container = $('mods-container');
  container.innerHTML = '';

  const profileNames = appState.manifest.profiles ? Object.keys(appState.manifest.profiles) : [];
  if (profileNames.length === 0) {
    container.innerHTML = '<div class="empty-state">Nenhum modpack configurado.</div>';
    return;
  }

  profileNames.forEach(profileName => loadProfileMods(profileName, container));
}

async function loadProfileMods(profileName, container) {
  const prof = appState.manifest.profiles[profileName];

  const group = document.createElement('div');
  group.className = 'modpack-group';

  const loaderLabel = prof.loader && prof.loader !== 'vanilla' && prof.loaderVersion
    ? ` · ${capitalize(prof.loader)} ${prof.loaderVersion}`
    : '';

  const title = document.createElement('div');
  title.className = 'modpack-group-title';
  title.textContent = `${profileName} — MC ${prof.minecraftVersion || '?'}${loaderLabel}`;
  group.appendChild(title);

  const grid = document.createElement('div');
  grid.className = 'mods-grid';
  grid.innerHTML = '<div class="empty-state">Carregando mods...</div>';
  group.appendChild(grid);
  container.appendChild(group);

  if (!prof.modsZipUrl) {
    grid.innerHTML = '<div class="empty-state">Este modpack ainda não tem mods.</div>';
    return;
  }

  if (!prof.modsListUrl) {
    grid.innerHTML = '<div class="empty-state">A lista detalhada de mods ainda não foi publicada para este modpack.</div>';
    return;
  }

  const result = await window.launcher.fetchModsList(prof.modsListUrl, profileName);
  if (!result.ok || !result.modsList || result.modsList.length === 0) {
    grid.innerHTML = '<div class="empty-state">Não foi possível carregar a lista de mods.</div>';
    return;
  }

  const countEl = document.createElement('span');
  countEl.className = 'modpack-group-count';
  countEl.textContent = `${result.modsList.length} mods`;
  title.appendChild(countEl);

  grid.innerHTML = '';
  result.modsList.forEach(mod => grid.appendChild(createModCard(mod)));
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
  document.querySelectorAll('.modpack-group').forEach(group => {
    let visibleCount = 0;
    group.querySelectorAll('.mod-card').forEach(card => {
      const name = card.querySelector('.mod-name')?.textContent.toLowerCase() || '';
      const match = !query || name.includes(query);
      card.style.display = match ? '' : 'none';
      if (match) visibleCount++;
    });
    group.style.display = visibleCount === 0 && query ? 'none' : '';
  });
}
