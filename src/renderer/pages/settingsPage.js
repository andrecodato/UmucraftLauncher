import { $ } from '../helpers.js';
import { appState } from '../store/state.js';
import { collectConfig } from '../services/configService.js';

const JAVA_SOURCE_LABELS = {
  bundled: 'gerenciado pelo launcher',
  installed: 'baixado automaticamente',
  system: 'Java do sistema',
  common: 'instalação detectada',
};

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

/** Populates the "Java em uso" line and the app version, once sysInfo loads. */
export function renderSysInfo() {
  const { javaVersion, javaSource, appVersion } = appState.sysInfo || {};

  const statusEl = $('java-current-status');
  if (javaVersion) {
    const sourceLabel = JAVA_SOURCE_LABELS[javaSource] || javaSource || '';
    statusEl.innerHTML = `<span class="status-dot"></span>Usando Java ${javaVersion}${sourceLabel ? ` (${sourceLabel})` : ''}`;
  } else {
    statusEl.innerHTML = '<span class="status-dot"></span>Java ainda não detectado.';
  }

  $('app-version-hint').textContent = appVersion ? `UmuCraft Launcher — versão ${appVersion}` : 'UmuCraft Launcher';
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
