import { escapeHtml } from '../helpers.js';

export function createServerCard(srv, pingResult) {
  const card = document.createElement('div');
  card.className = 'server-card';

  card.innerHTML = `
    <div class="server-info">
      <div class="server-name">${escapeHtml(srv.name)}</div>
      <div class="server-ip">${escapeHtml(srv.host)}:${srv.port || 25565}</div>
    </div>
    <div class="server-right">
      <span class="server-ping">Ping: ...</span>
      <span class="server-status-badge offline">
        <span class="dot"></span>
        ...
      </span>
    </div>
  `;

  if (pingResult) updateServerCard(card, srv, pingResult);
  return card;
}

export function updateServerCard(card, srv, result) {
  const pingEl = card.querySelector('.server-ping');
  const badgeEl = card.querySelector('.server-status-badge');

  if (result.online) {
    pingEl.textContent = 'Ping: ' + result.ping + 'ms';
    badgeEl.className = 'server-status-badge online';
    badgeEl.innerHTML = '<span class="dot"></span>Online';
  } else {
    pingEl.textContent = 'Ping: --';
    badgeEl.className = 'server-status-badge offline';
    badgeEl.innerHTML = '<span class="dot"></span>Offline';
  }
}
