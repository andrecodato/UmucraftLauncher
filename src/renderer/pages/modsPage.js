import { $ } from '../helpers.js';
import { appState } from '../store/state.js';

export function populateModsTab() {
  if (!appState.manifest) return;
  const container = $('mods-container');
  container.innerHTML = '';

  const profileNames = appState.manifest.profiles ? Object.keys(appState.manifest.profiles) : [];
  if (profileNames.length === 0) {
    container.innerHTML = '<div class="empty-state">Nenhum modpack configurado.</div>';
    return;
  }

  profileNames.forEach(profileName => {
    const prof = appState.manifest.profiles[profileName];

    const group = document.createElement('div');
    group.className = 'modpack-group';

    const title = document.createElement('div');
    title.className = 'modpack-group-title';
    title.textContent = 'Modpack: ' + profileName;
    group.appendChild(title);

    const info = document.createElement('div');
    info.className = 'mods-grid';

    const card = document.createElement('div');
    card.className = 'mod-card';

    const nameEl = document.createElement('div');
    nameEl.className = 'mod-name';
    nameEl.textContent = `Minecraft ${prof.minecraftVersion || '?'}`;
    card.appendChild(nameEl);

    if (prof.forgeVersion) {
      const forgeEl = document.createElement('div');
      forgeEl.className = 'mod-meta';
      forgeEl.textContent = `Forge ${prof.forgeVersion}`;
      card.appendChild(forgeEl);
    }

    if (prof.modsVersion) {
      const verEl = document.createElement('div');
      verEl.className = 'mod-meta';
      verEl.textContent = `Versão dos mods: ${prof.modsVersion}`;
      card.appendChild(verEl);
    }

    const statusEl = document.createElement('div');
    statusEl.className = 'mod-meta';
    statusEl.textContent = prof.modsZipUrl ? 'Pacote de mods disponível' : 'Sem pacote configurado';
    card.appendChild(statusEl);

    info.appendChild(card);
    group.appendChild(info);
    container.appendChild(group);
  });
}
