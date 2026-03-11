import { $ } from '../helpers.js';
import { SERVERS } from '../data/servers.js';
import { createServerCard, updateServerCard } from '../components/serverCard.js';

export function setupServersPage() {
  $('refresh-servers-btn').addEventListener('click', () => refreshServers());
}

export async function refreshServers() {
  const list = $('servers-list');
  list.innerHTML = '';

  if (SERVERS.length === 0) {
    list.innerHTML = '<div class="empty-state">Nenhum servidor configurado.</div>';
    return;
  }

  // Render placeholder cards
  SERVERS.forEach(srv => {
    const card = createServerCard(srv, null);
    list.appendChild(card);
  });

  // Ping each server
  for (let i = 0; i < SERVERS.length; i++) {
    const srv = SERVERS[i];
    try {
      const result = await window.launcher.pingServer({ host: srv.host, port: srv.port || 25565 });
      const card = list.children[i];
      updateServerCard(card, srv, result);
    } catch {}
  }
}
