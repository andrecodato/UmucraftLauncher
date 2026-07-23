import { $, capitalize } from '../helpers.js';
import { appState } from '../store/state.js';
import { populateModsTab } from '../pages/modsPage.js';
import { populateNewsTab } from '../pages/newsPage.js';
import { createProfileCard, updateProfileCardPing } from '../components/profileCard.js';

export async function loadManifest(silent = true) {
  const result = await window.launcher.fetchManifest();

  if (!result.ok) {
    if (!silent) alert('Nao foi possivel conectar ao servidor: ' + result.error);
    return;
  }

  appState.manifest = result.manifest;
  populateManifestUI(result.manifest, result.cached);
}

export function populateManifestUI(m, cached) {
  $('server-name').textContent = m.serverName || 'UmuCraft';
  $('server-description').textContent = m.description || (cached ? '(dados em cache)' : 'Launcher Minecraft Offline');

  // Tags
  const tagsEl = $('hero-tags');
  tagsEl.innerHTML = '';
  (m.tags || []).forEach(tag => {
    const b = document.createElement('span');
    b.className = 'badge';
    b.textContent = tag;
    tagsEl.appendChild(b);
  });

  renderProfileCards(m);
  updateVersionBadges();
  populateModsTab();
  populateNewsTab();
}

export function renderProfileCards(m) {
  const container = $('profile-cards');
  container.innerHTML = '';

  const names = m.profiles ? Object.keys(m.profiles) : [];
  if (names.length === 0) {
    container.innerHTML = '<div class="empty-state">Nenhum servidor configurado.</div>';
    return;
  }

  if (!names.includes(appState.config.selectedProfile)) {
    appState.config.selectedProfile = names[0];
  }

  names.forEach(name => {
    const prof = m.profiles[name];
    const card = createProfileCard(name, prof, name === appState.config.selectedProfile);
    card.addEventListener('click', () => selectProfile(name));
    container.appendChild(card);
  });

  names.forEach(async (name, i) => {
    const prof = m.profiles[name];
    if (!prof.host) return;
    try {
      const result = await window.launcher.pingServer({ host: prof.host, port: prof.port || 25565 });
      updateProfileCardPing(container.children[i], result);
    } catch {}
  });
}

export function selectProfile(name) {
  if (!appState.manifest?.profiles?.[name]) return;
  appState.config.selectedProfile = name;
  $('profile-cards').querySelectorAll('.profile-card').forEach(el => {
    el.classList.toggle('selected', el.dataset.profile === name);
  });
  updateVersionBadges();
}

export function updateVersionBadges() {
  if (!appState.manifest) return;
  const prof = appState.manifest.profiles?.[appState.config.selectedProfile];
  if (!prof) return;

  $('mc-version-badge').textContent = 'MC ' + (prof.minecraftVersion || '?');

  const loaderBadge = $('loader-badge');
  if (prof.loader && prof.loader !== 'vanilla' && prof.loaderVersion) {
    loaderBadge.textContent = capitalize(prof.loader) + ' ' + prof.loaderVersion;
    loaderBadge.className = 'badge loader-' + prof.loader;
    loaderBadge.style.display = '';
  } else {
    loaderBadge.style.display = 'none';
  }

  const mcVer = prof.minecraftVersion || '1.21';
  let javaVer = prof.javaMajor ? String(prof.javaMajor) : '17';
  if (!prof.javaMajor && (mcVer.startsWith('1.20') || mcVer.startsWith('1.21'))) javaVer = '21';
  $('java-badge').textContent = 'Java ' + javaVer;

  const modsBadge = $('mods-badge');
  if (prof.modsVersion) {
    modsBadge.textContent = 'Mods v' + prof.modsVersion;
  } else {
    modsBadge.textContent = 'Sem mods';
  }
}
