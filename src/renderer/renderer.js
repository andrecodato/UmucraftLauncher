/* renderer.js – Launcher UI Logic */
'use strict';

// ─── STATE ────────────────────────────────────────────────────────────────────
let config = {};
let manifest = null;
let sysInfo = {};
let isLaunching = false;

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function init() {
  sysInfo = await window.launcher.getSystemInfo();
  config = await window.launcher.loadConfig();

  applyConfigToUI();
  setupEventListeners();
  setupIpcListeners();
  setupRamSlider();

  // Load manifest in background
  loadManifest();

  // Set RAM max based on system
  const maxRam = Math.min(sysInfo.totalRam, 32768);
  const sliderEl = $('ram-slider');
  sliderEl.max = maxRam;
  $('ram-max-label').textContent = Math.round(maxRam / 1024) + ' GB';
  $('mc-dir-input').value = config.minecraftDir || '';
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
function logLine(msg, type = '') {
  const el = $('log-console');
  const line = document.createElement('div');
  line.className = 'log-line ' + type;
  line.textContent = '> ' + msg;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

// ─── CONFIG UI ────────────────────────────────────────────────────────────────
function applyConfigToUI() {
  $('username-input').value = config.username || '';
  $('ram-slider').value = config.ram || 4096;
  $('ram-display').textContent = (config.ram || 4096) + ' MB';
  $('mc-dir-input').value = config.minecraftDir || '';
  $('login-mode').value = config.loginMode || 'offline';
  updateLoginModeHint();
}

function collectConfig() {
  return {
    ...config,
    username: $('username-input').value.trim(),
    ram: parseInt($('ram-slider').value, 10),
    minecraftDir: $('mc-dir-input').value,
    selectedProfile: $('profile-select').value,
    loginMode: $('login-mode').value,
  };
}

// ─── MANIFEST ─────────────────────────────────────────────────────────────────
async function loadManifest(silent = true) {
  setServerStatus('checking');
  const result = await window.launcher.fetchManifest();

  if (!result.ok) {
    setServerStatus('offline');
    if (!silent) alert('Não foi possível conectar ao servidor: ' + result.error);
    return;
  }

  manifest = result.manifest;
  setServerStatus('online');
  populateManifestUI(manifest, result.cached);
}

function populateManifestUI(m, cached) {
  // Server info in hero
  $('server-name').textContent = m.serverName || 'MyServer';
  $('server-description').textContent = m.description || (cached ? '(dados em cache)' : 'Servidor Minecraft');

  // Tags
  const tagsEl = $('hero-tags');
  tagsEl.innerHTML = '';
  const tags = m.tags || [];
  tags.forEach(tag => {
    const b = document.createElement('span');
    b.className = 'badge';
    b.textContent = tag;
    tagsEl.appendChild(b);
  });

  // Populate profile selector
  const profileSelect = $('profile-select');
  profileSelect.innerHTML = '';
  const profiles = m.profiles ? Object.keys(m.profiles) : ['Default'];
  profiles.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    if (p === config.selectedProfile) opt.selected = true;
    profileSelect.appendChild(opt);
  });

  // Update version badges
  updateVersionBadges();

  // Populate mods tab
  populateModsTab();

  // Populate news tab
  populateNewsTab(m.news || []);
}

function updateVersionBadges() {
  if (!manifest) return;
  const profileName = $('profile-select').value;
  const prof = manifest.profiles?.[profileName] || manifest;

  $('mc-version-badge').textContent = 'MC ' + (prof.minecraftVersion || '?');
  $('forge-badge').textContent = 'Forge ' + (prof.forgeVersion || '?');

  const mcVer = prof.minecraftVersion || '1.20';
  let javaVer = '17';
  if (mcVer.startsWith('1.20') || mcVer.startsWith('1.21')) javaVer = '21';
  else if (mcVer.startsWith('1.17') || mcVer.startsWith('1.18') || mcVer.startsWith('1.19')) javaVer = '17';
  else javaVer = '8';
  $('java-badge').textContent = 'Java ' + javaVer;

  const modsCount = (prof.mods || []).length;
  $('mods-badge').textContent = modsCount + ' mod' + (modsCount !== 1 ? 's' : '');
}

function populateModsTab() {
  if (!manifest) return;
  const profileName = $('profile-select').value;
  const prof = manifest.profiles?.[profileName] || manifest;
  const mods = prof.mods || [];

  const grid = $('mods-grid');
  grid.innerHTML = '';

  if (mods.length === 0) {
    grid.innerHTML = '<div class="empty-state">Nenhum mod configurado no servidor.</div>';
    return;
  }

  mods.forEach(mod => {
    const card = document.createElement('div');
    card.className = 'mod-card';
    card.innerHTML = `
      <div class="mod-name" title="${mod.filename}">${mod.name || mod.filename}</div>
      <div class="mod-meta">${mod.filename}</div>
      ${mod.version ? `<div class="mod-meta">v${mod.version}</div>` : ''}
      <div class="mod-status ok">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>
        Incluído
      </div>
    `;
    grid.appendChild(card);
  });
}

function populateNewsTab(news) {
  const list = $('news-list');
  list.innerHTML = '';

  if (news.length === 0) {
    list.innerHTML = '<div class="empty-state">Sem notícias no momento.</div>';
    $('news-date').textContent = '';
    return;
  }

  // Most recent date
  const latest = news[0];
  $('news-date').textContent = latest.date || '';

  news.forEach(item => {
    const card = document.createElement('div');
    card.className = 'news-card' + (item.pinned ? ' pinned' : '');
    const tagType = item.tag || 'info';
    card.innerHTML = `
      ${item.tag ? `<span class="news-tag ${tagType}">${item.tag}</span>` : ''}
      <div class="news-card-header">
        <div class="news-title">${item.title}</div>
        <div class="news-card-date">${item.date || ''}</div>
      </div>
      <div class="news-body">${item.body || ''}</div>
    `;
    list.appendChild(card);
  });
}

// ─── SERVER STATUS ────────────────────────────────────────────────────────────
function setServerStatus(state) {
  const dot = $('status-dot');
  const label = $('status-label');
  dot.className = 'status-dot';
  if (state === 'online') {
    dot.classList.add('online');
    label.textContent = 'Online';
  } else if (state === 'offline') {
    dot.classList.add('offline');
    label.textContent = 'Offline';
  } else {
    label.textContent = '...';
  }
}

// ─── RAM SLIDER ───────────────────────────────────────────────────────────────
function setupRamSlider() {
  const slider = $('ram-slider');
  slider.addEventListener('input', () => {
    const val = parseInt(slider.value, 10);
    $('ram-display').textContent = val + ' MB';
    // Warn if over 75% of system RAM
    if (sysInfo.totalRam && val > sysInfo.totalRam * 0.75) {
      $('ram-display').style.color = '#e3b341';
    } else {
      $('ram-display').style.color = '';
    }
  });
}

// ─── LAUNCH ───────────────────────────────────────────────────────────────────
async function startLaunch() {
  if (isLaunching) return;
  if (!manifest) {
    alert('Manifesto não carregado. Verifique sua conexão e tente novamente.');
    return;
  }

  const username = $('username-input').value.trim();
  if (!username) {
    $('username-input').focus();
    $('username-input').style.borderColor = 'var(--danger)';
    setTimeout(() => $('username-input').style.borderColor = '', 2000);
    return;
  }

  isLaunching = true;
  config = collectConfig();
  await window.launcher.saveConfig(config);

  // UI state
  const btn = $('launch-btn');
  btn.disabled = true;
  btn.classList.add('loading');
  btn.querySelector('.launch-btn-text').textContent = 'PREPARANDO...';

  $('log-console').innerHTML = '';
  $('progress-bar').style.width = '0%';
  $('progress-pct').textContent = '0%';
  $('progress-panel').style.display = 'block';
  $('progress-phase').textContent = 'Iniciando...';

  const result = await window.launcher.syncAndLaunch({ config, manifest });

  if (result.ok) {
    $('progress-phase').textContent = '✓ Minecraft iniciado!';
    $('progress-bar').style.width = '100%';
    $('progress-pct').textContent = '100%';
    logLine('Minecraft iniciado com sucesso! PID: ' + result.pid, 'success');

    btn.querySelector('.launch-btn-text').textContent = 'EM JOGO';
    setTimeout(() => {
      isLaunching = false;
      btn.disabled = false;
      btn.classList.remove('loading');
      btn.querySelector('.launch-btn-text').textContent = 'JOGAR';
    }, 5000);
  } else {
    $('progress-phase').textContent = '✗ Erro';
    logLine('ERRO: ' + result.error, 'error');
    isLaunching = false;
    btn.disabled = false;
    btn.classList.remove('loading');
    btn.querySelector('.launch-btn-text').textContent = 'JOGAR';
  }
}

// ─── EVENT LISTENERS ──────────────────────────────────────────────────────────
function setupEventListeners() {
  // Titlebar
  $('btn-minimize').addEventListener('click', () => window.launcher.minimize());
  $('btn-maximize').addEventListener('click', () => window.launcher.maximize());
  $('btn-close').addEventListener('click', () => window.launcher.close());

  // Tab navigation
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      $('tab-' + btn.dataset.tab).classList.add('active');
    });
  });

  // Launch button
  $('launch-btn').addEventListener('click', startLaunch);

  // Profile selector
  $('profile-select').addEventListener('change', () => {
    config.selectedProfile = $('profile-select').value;
    updateVersionBadges();
    populateModsTab();
  });

  // Username
  $('username-input').addEventListener('input', () => {
    // Only allow valid MC usernames
    $('username-input').value = $('username-input').value.replace(/[^a-zA-Z0-9_]/g, '');
  });

  // Settings
  $('save-settings-btn').addEventListener('click', async () => {
    config = collectConfig();
    await window.launcher.saveConfig(config);
    $('save-settings-btn').textContent = '✓ Salvo!';
    setTimeout(() => $('save-settings-btn').textContent = 'Salvar configurações', 2000);
  });

  $('browse-dir-btn').addEventListener('click', async () => {
    const dir = await window.launcher.browseMinecraftDir();
    if (dir) $('mc-dir-input').value = dir;
  });

  $('open-launcher-dir-btn').addEventListener('click', () => {
    window.launcher.openFolder();
  });

  $('refresh-manifest-btn').addEventListener('click', () => loadManifest(false));

  $('login-mode').addEventListener('change', updateLoginModeHint);

  $('ms-login-btn')?.addEventListener('click', () => {
    alert('Login Microsoft requer implementação OAuth. Por enquanto, use o modo offline.');
  });
}

function updateLoginModeHint() {
  const mode = $('login-mode').value;
  const hint = $('login-hint');
  const msSection = $('ms-login-section');

  if (mode === 'offline') {
    hint.textContent = 'Modo offline: use qualquer nickname. O servidor deve permitir modo offline.';
    if (msSection) msSection.style.display = 'none';
  } else {
    hint.textContent = 'Modo Microsoft: usa sua conta original do Minecraft.';
    if (msSection) msSection.style.display = 'block';
  }
}

// ─── IPC LISTENERS ────────────────────────────────────────────────────────────
function setupIpcListeners() {
  window.launcher.on('log', (msg) => {
    logLine(msg);
  });

  window.launcher.on('status', (msg) => {
    $('progress-phase').textContent = msg;
    logLine(msg);
  });

  window.launcher.on('phase', (phase) => {
    const labels = {
      java: '⚙ Verificando Java...',
      mods: '📦 Sincronizando mods...',
      launch: '🚀 Iniciando Minecraft...',
    };
    if (labels[phase]) $('progress-phase').textContent = labels[phase];
  });

  window.launcher.on('download-progress', ({ label, percent, downloaded, total }) => {
    $('progress-bar').style.width = percent + '%';
    $('progress-pct').textContent = percent + '%';
    const mb = (downloaded / 1024 / 1024).toFixed(1);
    const totalMb = total ? (total / 1024 / 1024).toFixed(1) + ' MB' : '?';
    $('progress-file').textContent = `${label} — ${mb} MB / ${totalMb}`;
  });

  window.launcher.on('sync-progress', ({ current, total, filename, percent }) => {
    $('progress-bar').style.width = percent + '%';
    $('progress-pct').textContent = percent + '%';
    $('progress-file').textContent = `Verificando: ${filename} (${current}/${total})`;
  });

  window.launcher.on('launched', ({ pid }) => {
    logLine(`Jogo iniciado! PID: ${pid}`, 'success');
  });
}

// ─── BOOT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
