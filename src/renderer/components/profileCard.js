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
