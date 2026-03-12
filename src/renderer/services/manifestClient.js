import { $ } from '../helpers.js';
import { appState } from '../store/state.js';
import { populateModsTab } from '../pages/modsPage.js';

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

  // Profile selector
  const profileSelect = $('profile-select');
  profileSelect.innerHTML = '';
  const profiles = m.profiles ? Object.keys(m.profiles) : ['Default'];
  profiles.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    if (p === appState.config.selectedProfile) opt.selected = true;
    profileSelect.appendChild(opt);
  });

  updateVersionBadges();
  populateModsTab();
}

export function updateVersionBadges() {
  if (!appState.manifest) return;
  const profileName = $('profile-select').value;
  const prof = appState.manifest.profiles?.[profileName] || appState.manifest;

  $('mc-version-badge').textContent = 'MC ' + (prof.minecraftVersion || '?');

  const forgeBadge = $('forge-badge');
  if (prof.forgeVersion) {
    forgeBadge.textContent = 'Forge ' + prof.forgeVersion;
    forgeBadge.style.display = '';
  } else {
    forgeBadge.style.display = 'none';
  }

  const mcVer = prof.minecraftVersion || '1.21';
  let javaVer = '17';
  if (mcVer.startsWith('1.20') || mcVer.startsWith('1.21')) javaVer = '21';
  $('java-badge').textContent = 'Java ' + javaVer;

  const modsBadge = $('mods-badge');
  if (prof.modsVersion) {
    modsBadge.textContent = 'Mods v' + prof.modsVersion;
  } else {
    modsBadge.textContent = 'Sem mods';
  }
}
