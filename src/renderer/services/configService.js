import { $ } from '../helpers.js';
import { appState } from '../store/state.js';

export function applyConfigToUI() {
  $('username-input').value = appState.config.username || '';
  $('ram-slider').value = appState.config.ram || 4096;
  $('ram-display').textContent = (appState.config.ram || 4096) + ' MB';
  $('mc-dir-input').value = appState.config.minecraftDir || '';
}

export function collectConfig() {
  return {
    ...appState.config,
    username: $('username-input').value.trim(),
    ram: parseInt($('ram-slider').value, 10),
    minecraftDir: $('mc-dir-input').value,
    selectedProfile: $('profile-select').value,
  };
}
