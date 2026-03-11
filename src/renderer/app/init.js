import { $ } from '../helpers.js';
import { appState } from '../store/state.js';
import { applyConfigToUI } from '../services/configService.js';
import { loadManifest } from '../services/manifestClient.js';
import { setupIpcListeners } from '../services/ipcBridge.js';
import { setupTitlebar } from '../components/titlebar.js';
import { setupSidebar } from '../components/sidebar.js';
import { hideLoadingOverlay } from '../components/loadingOverlay.js';
import { setupHomePage } from '../pages/homePage.js';
import { setupServersPage, refreshServers } from '../pages/serversPage.js';
import { setupDiscordPage } from '../pages/discordPage.js';
import { setupSettingsPage } from '../pages/settingsPage.js';
import { populateTipsTab } from '../pages/tipsPage.js';

async function init() {
  // Wire up UI components
  setupTitlebar();
  setupSidebar();
  setupIpcListeners();
  setupHomePage();
  setupServersPage();
  setupDiscordPage();
  setupSettingsPage();

  // Load config & system info
  appState.sysInfo = await window.launcher.getSystemInfo();
  appState.config = await window.launcher.loadConfig();

  applyConfigToUI();

  // Set RAM max
  const maxRam = Math.min(appState.sysInfo.totalRam, 32768);
  $('ram-slider').max = maxRam;
  $('ram-max-label').textContent = Math.round(maxRam / 1024) + ' GB';
  $('mc-dir-input').value = appState.config.minecraftDir || appState.sysInfo.launcherDir || '';

  // Load manifest in background
  loadManifest();

  // Populate static tabs
  populateTipsTab();
  refreshServers();

  // Hide loading overlay (bootstrap already handled startup)
  hideLoadingOverlay();
}

document.addEventListener('DOMContentLoaded', init);
