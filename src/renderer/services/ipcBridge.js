import { $, logLine } from '../helpers.js';

export function setupIpcListeners() {
  window.launcher.on('log', (msg) => {
    logLine(msg);
  });

  window.launcher.on('status', (msg) => {
    const phase = $('progress-phase');
    if (phase) phase.textContent = msg;
    logLine(msg);
  });

  window.launcher.on('phase', (phase) => {
    const labels = {
      'java-check': 'Verificando Java...',
      java: 'Verificando Java...',
      mods: 'Sincronizando mods...',
      launch: 'Iniciando Minecraft...',
    };
    const el = $('progress-phase');
    if (el && labels[phase]) el.textContent = labels[phase];
  });

  window.launcher.on('download-progress', ({ label, percent, downloaded, total }) => {
    const bar = $('progress-bar');
    const pct = $('progress-pct');
    const file = $('progress-file');
    if (bar) bar.style.width = percent + '%';
    if (pct) pct.textContent = percent + '%';
    const mb = (downloaded / 1024 / 1024).toFixed(1);
    const totalMb = total ? (total / 1024 / 1024).toFixed(1) + ' MB' : '?';
    if (file) file.textContent = `${label} — ${mb} MB / ${totalMb}`;
  });

  window.launcher.on('sync-progress', ({ current, total, filename, percent }) => {
    const bar = $('progress-bar');
    const pct = $('progress-pct');
    const file = $('progress-file');
    if (bar) bar.style.width = percent + '%';
    if (pct) pct.textContent = percent + '%';
    if (file) file.textContent = `Verificando: ${filename} (${current}/${total})`;
  });

  window.launcher.on('launched', ({ pid }) => {
    logLine(`Jogo iniciado! PID: ${pid}`, 'success');
  });
}
