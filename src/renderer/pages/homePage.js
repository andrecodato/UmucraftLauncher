import { $, logLine } from '../helpers.js';
import { appState } from '../store/state.js';
import { collectConfig, applyConfigToUI } from '../services/configService.js';
import { loadManifest } from '../services/manifestClient.js';
import { showRamSetupModal } from '../components/ramSetupModal.js';

export function setupHomePage() {
  // Launch button
  $('launch-btn').addEventListener('click', startLaunch);

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

  const syncResult = await window.launcher.syncProfile({
    config: appState.config,
    manifest: appState.manifest,
  });

  if (!syncResult.ok) {
    failLaunch(btn, syncResult.error);
    return;
  }

  // First time this profile is launched: ask how much RAM to give it before
  // spawning java. Subsequent launches reuse whatever was picked (still
  // editable later from Configuracoes).
  const prompted = appState.config.ramPromptedProfiles || [];
  if (!prompted.includes(syncResult.profileName)) {
    btn.querySelector('.launch-btn-text').textContent = 'CONFIGURAR RAM...';
    const chosenRam = await showRamSetupModal({
      totalRam: appState.sysInfo.totalRam,
      currentRam: appState.config.ram,
    });
    appState.config.ram = chosenRam;
    appState.config.ramPromptedProfiles = [...prompted, syncResult.profileName];
    applyConfigToUI();
    await window.launcher.saveConfig(appState.config);
    btn.querySelector('.launch-btn-text').textContent = 'PREPARANDO...';
  }

  const launchResult = await window.launcher.launchProfile({
    gameRoot: syncResult.gameRoot,
    instanceDir: syncResult.instanceDir,
    mcVersion: syncResult.mcVersion,
    versionId: syncResult.versionId,
    loader: syncResult.loader,
    loaderVersion: syncResult.loaderVersion,
    javaMajor: syncResult.javaMajor,
    ram: appState.config.ram,
    username: appState.config.username,
  });

  if (launchResult.ok) {
    $('progress-phase').textContent = 'Minecraft iniciado!';
    $('progress-bar').style.width = '100%';
    $('progress-pct').textContent = '100%';
    logLine('Minecraft iniciado com sucesso! PID: ' + launchResult.pid, 'success');

    btn.querySelector('.launch-btn-text').textContent = 'EM JOGO';
    setTimeout(() => {
      appState.isLaunching = false;
      btn.disabled = false;
      btn.classList.remove('loading');
      btn.querySelector('.launch-btn-text').textContent = 'JOGAR';
    }, 5000);
  } else {
    failLaunch(btn, launchResult.error);
  }
}

function failLaunch(btn, error) {
  $('progress-phase').textContent = 'Erro';
  logLine('ERRO: ' + error, 'error');
  appState.isLaunching = false;
  btn.disabled = false;
  btn.classList.remove('loading');
  btn.querySelector('.launch-btn-text').textContent = 'JOGAR';
}
