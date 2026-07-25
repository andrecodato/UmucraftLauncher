import { escapeHtml, capitalize } from '../helpers.js';

export function createProfileCard(name, prof, selected) {
  const card = document.createElement('div');
  card.className = 'profile-card' + (selected ? ' selected' : '');
  card.dataset.profile = name;

  const loaderBadge = prof.loader && prof.loader !== 'vanilla' && prof.loaderVersion
    ? `<span class="badge loader-${escapeHtml(prof.loader)}">${escapeHtml(capitalize(prof.loader))} ${escapeHtml(prof.loaderVersion)}</span>`
    : '';

  card.innerHTML = `
    <div class="profile-card-info">
      <div class="profile-card-name">${escapeHtml(name)}</div>
      ${prof.host ? `<div class="profile-card-ip">${escapeHtml(prof.host)}:${prof.port || 25565}</div>` : ''}
      <div class="profile-card-badges">
        <span class="badge">MC ${escapeHtml(prof.minecraftVersion || '?')}</span>
        ${loaderBadge}
      </div>
    </div>
    <div class="profile-card-right">
      <button class="profile-card-folder-btn" data-action="open-folder" title="Abrir pasta da instância" aria-label="Abrir pasta da instância">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
      </button>
      <span class="profile-card-ping">${prof.host ? 'Ping: ...' : ''}</span>
      <span class="profile-card-status offline" style="${prof.host ? '' : 'display:none'}">
        <span class="dot"></span>
        ...
      </span>
    </div>
  `;

  return card;
}

export function updateProfileCardPing(card, result) {
  const pingEl = card.querySelector('.profile-card-ping');
  const statusEl = card.querySelector('.profile-card-status');
  if (!pingEl || !statusEl) return;

  if (result.online) {
    pingEl.textContent = 'Ping: ' + result.ping + 'ms';
    statusEl.className = 'profile-card-status online';
    statusEl.innerHTML = '<span class="dot"></span>Online';
  } else {
    pingEl.textContent = 'Ping: --';
    statusEl.className = 'profile-card-status offline';
    statusEl.innerHTML = '<span class="dot"></span>Offline';
  }
}
