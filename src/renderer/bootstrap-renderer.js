'use strict';

const $ = (id) => document.getElementById(id);
const logArea = $('log-area');
const stateLabel = $('state-label');
const progressBar = $('progress-bar');
const progressDetail = $('progress-detail');
const spinner = $('spinner');
const actions = $('actions');
const retryBtn = $('retry-btn');
const logsBtn = $('logs-btn');

const STATE_LABELS = {
  checking_bundled:    'Verificando runtime empacotado...',
  checking_system:     'Verificando Java do sistema...',
  checking_common:     'Buscando Java em diretorios comuns...',
  runtime_found:       'Runtime compativel encontrado!',
  runtime_not_found:   'Nenhum Java compativel encontrado',
  downloading_runtime: 'Baixando Adoptium JDK 21...',
  extracting_runtime:  'Extraindo JDK...',
  validating_runtime:  'Validando instalacao...',
  preparing_profile:   'Preparando perfil padrao...',
  completed:           'Inicializacao concluida! Abrindo launcher...',
  failed:              'Falha na inicializacao',
};

function addLog(msg, type = '') {
  const line = document.createElement('div');
  line.className = 'log-line' + (type ? ' ' + type : '');
  line.textContent = msg;
  logArea.appendChild(line);
  logArea.scrollTop = logArea.scrollHeight;
}

// ─── IPC Events ──────────────────────────────────────────────────────────────

window.bootstrap.on('bootstrap-log', (msg) => {
  const isError = typeof msg === 'string' && msg.startsWith('ERROR:');
  addLog(msg, isError ? 'error' : '');
});

window.bootstrap.on('bootstrap-state', ({ state, detail }) => {
  const label = STATE_LABELS[state] || state;
  stateLabel.textContent = detail ? `${label} — ${detail}` : label;

  if (state.startsWith('STATE')) {
    addLog(detail || label, 'state');
  }

  if (state === 'runtime_found' || state === 'completed') {
    stateLabel.className = 'state-label success';
    progressBar.className = 'progress-bar';
    progressBar.style.width = '100%';
    spinner.classList.add('hidden');
  } else if (state === 'failed') {
    stateLabel.className = 'state-label error';
    progressBar.className = 'progress-bar';
    progressBar.style.width = '100%';
    progressBar.style.background = 'var(--danger)';
    spinner.classList.add('hidden');
    actions.classList.remove('hidden');
  } else if (state === 'downloading_runtime') {
    progressBar.className = 'progress-bar';
    progressBar.style.width = '0%';
    progressBar.style.background = '';
  } else {
    // Pulsing for detection steps
    progressBar.className = 'progress-bar pulse';
    progressBar.style.background = '';
  }
});

window.bootstrap.on('bootstrap-progress', ({ phase, percent, downloaded, total }) => {
  if (phase === 'downloading') {
    progressBar.className = 'progress-bar';
    progressBar.style.width = percent + '%';
    const dlMB = (downloaded / 1024 / 1024).toFixed(1);
    const totalMB = total > 0 ? (total / 1024 / 1024).toFixed(1) : '?';
    progressDetail.textContent = `${dlMB} MB / ${totalMB} MB (${percent}%)`;
  }
});

// ─── Actions ─────────────────────────────────────────────────────────────────

retryBtn.addEventListener('click', () => {
  actions.classList.add('hidden');
  stateLabel.className = 'state-label';
  stateLabel.textContent = 'Tentando novamente...';
  progressBar.className = 'progress-bar pulse';
  progressBar.style.background = '';
  progressBar.style.width = '';
  progressDetail.textContent = '';
  spinner.classList.remove('hidden');
  logArea.innerHTML = '';
  addLog('--- Retry ---', 'state');
  window.bootstrap.retry();
});

logsBtn.addEventListener('click', () => {
  window.bootstrap.openLogs();
});
