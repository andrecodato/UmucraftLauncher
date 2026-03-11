import { $ } from '../helpers.js';
import { appState } from '../store/state.js';

export function populateModsTab() {
  if (!appState.manifest) return;
  const container = $('mods-container');
  container.innerHTML = '';

  const profileNames = appState.manifest.profiles ? Object.keys(appState.manifest.profiles) : [];
  if (profileNames.length === 0) {
    container.innerHTML = '<div class="empty-state">Nenhum mod configurado.</div>';
    return;
  }

  profileNames.forEach(profileName => {
    const prof = appState.manifest.profiles[profileName];
    const mods = prof.mods || [];
    if (mods.length === 0) return;

    const group = document.createElement('div');
    group.className = 'modpack-group';

    const title = document.createElement('div');
    title.className = 'modpack-group-title';
    title.textContent = 'Modpack: ' + profileName;
    group.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'mods-grid';

    mods.forEach(mod => {
      const card = document.createElement('div');
      card.className = 'mod-card';

      const nameEl = document.createElement('div');
      nameEl.className = 'mod-name';
      nameEl.title = mod.filename;
      nameEl.textContent = mod.name || mod.filename;
      card.appendChild(nameEl);

      const metaEl = document.createElement('div');
      metaEl.className = 'mod-meta';
      metaEl.textContent = mod.filename;
      card.appendChild(metaEl);

      if (mod.version) {
        const verEl = document.createElement('div');
        verEl.className = 'mod-meta';
        verEl.textContent = 'v' + mod.version;
        card.appendChild(verEl);
      }

      if (mod.url && !mod.url.startsWith('URL_NAO_ENCONTRADA') && !mod.url.startsWith('COLOQUE')) {
        const link = document.createElement('a');
        link.className = 'mod-link';
        link.textContent = 'Download';
        link.addEventListener('click', (e) => {
          e.preventDefault();
          window.launcher.openExternal(mod.url);
        });
        card.appendChild(link);
      }

      grid.appendChild(card);
    });

    group.appendChild(grid);
    container.appendChild(group);
  });
}
