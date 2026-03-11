import { $, logLine } from '../helpers.js';
import { appState } from '../store/state.js';
import { collectConfig } from '../services/configService.js';
import { loadManifest, updateVersionBadges } from '../services/manifestClient.js';

export function setupHomePage() {
  // Launch button
  $('launch-btn').addEventListener('click', startLaunch);

  // Profile selector updates badges
  $('profile-select').addEventListener('change', () => {
    appState.config.selectedProfile = $('profile-select').value;
    updateVersionBadges();
  });

  // Username — only valid MC characters
  $('username-input').addEventListener('input', () => {
    $('username-input').value = $('username-input').value.replace(/[^a-zA-Z0-9_]/g, '');
  });

  // Refresh manifest button
  $('refresh-manifest-btn').addEventListener('click', () => loadManifest(false));
}

async function startLaunch() {
  if (appState.isLaunching) return;
  if (!appState.manifest) {
    alert('Manifesto nao carregado. Verifique sua conexao e tente novamente.');
    return;
  }

  const username = $('username-input').value.trim();
  if (!username) {
    $('username-input').focus();
    $('username-input').style.borderColor = 'var(--danger)';
    setTimeout(() => $('username-input').style.borderColor = '', 2000);
    return;
  }

  appState.isLaunching = true;
  appState.config = collectConfig();
  await window.launcher.saveConfig(appState.config);

  const btn = $('launch-btn');
  btn.disabled = true;
  btn.classList.add('loading');
  btn.querySelector('.launch-btn-text').textContent = 'PREPARANDO...';

  $('log-console').innerHTML = '';
  $('progress-bar').style.width = '0%';
  $('progress-pct').textContent = '0%';
  $('progress-panel').style.display = 'block';
  $('progress-phase').textContent = 'Iniciando...';

  const result = await window.launcher.syncAndLaunch({
    config: appState.config,
    manifest: appState.manifest,
  });

  if (result.ok) {
    $('progress-phase').textContent = 'Minecraft iniciado!';
    $('progress-bar').style.width = '100%';
    $('progress-pct').textContent = '100%';
    logLine('Minecraft iniciado com sucesso! PID: ' + result.pid, 'success');

    btn.querySelector('.launch-btn-text').textContent = 'EM JOGO';
    setTimeout(() => {
      appState.isLaunching = false;
      btn.disabled = false;
      btn.classList.remove('loading');
      btn.querySelector('.launch-btn-text').textContent = 'JOGAR';
    }, 5000);
  } else {
    $('progress-phase').textContent = 'Erro';
    logLine('ERRO: ' + result.error, 'error');
    appState.isLaunching = false;
    btn.disabled = false;
    btn.classList.remove('loading');
    btn.querySelector('.launch-btn-text').textContent = 'JOGAR';
  }
}
