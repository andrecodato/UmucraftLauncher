import { $ } from '../helpers.js';
import { appState } from '../store/state.js';
import { collectConfig } from '../services/configService.js';

export function setupSettingsPage() {
  setupRamSlider();

  $('save-settings-btn').addEventListener('click', async () => {
    appState.config = collectConfig();
    await window.launcher.saveConfig(appState.config);
    $('save-settings-btn').textContent = 'Salvo!';
    setTimeout(() => $('save-settings-btn').textContent = 'Salvar configuracoes', 2000);
  });

  $('browse-dir-btn').addEventListener('click', async () => {
    const dir = await window.launcher.browseMinecraftDir();
    if (dir) $('mc-dir-input').value = dir;
  });

  $('open-launcher-dir-btn').addEventListener('click', () => {
    window.launcher.openFolder();
  });
}

function setupRamSlider() {
  const slider = $('ram-slider');
  slider.addEventListener('input', () => {
    const val = parseInt(slider.value, 10);
    $('ram-display').textContent = val + ' MB';
    if (appState.sysInfo.totalRam && val > appState.sysInfo.totalRam * 0.75) {
      $('ram-display').style.color = '#e3b341';
    } else {
      $('ram-display').style.color = '';
    }
  });
}
