import { $ } from '../helpers.js';
import { appState } from '../store/state.js';

const TAG_LABELS = { update: 'Atualização', maintenance: 'Manutenção', event: 'Evento', info: 'Info' };

export function populateNewsTab() {
  const container = $('news-container');
  if (!container) return;
  container.innerHTML = '';

  const news = appState.manifest?.news || [];
  if (news.length === 0) {
    container.innerHTML = '<div class="empty-state">Nenhuma noticia no momento.</div>';
    return;
  }

  const sorted = [...news].sort((a, b) => {
    if (!!b.pinned !== !!a.pinned) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
    return new Date(b.date) - new Date(a.date);
  });

  sorted.forEach(item => {
    const card = document.createElement('div');
    card.className = 'news-card' + (item.pinned ? ' pinned' : '');

    const header = document.createElement('div');
    header.className = 'news-card-header';

    const title = document.createElement('div');
    title.className = 'news-card-title';
    title.textContent = item.title || '';
    header.appendChild(title);

    const date = document.createElement('div');
    date.className = 'news-card-date';
    date.textContent = item.date || '';
    header.appendChild(date);

    card.appendChild(header);

    if (item.tag) {
      const tag = document.createElement('span');
      tag.className = 'badge news-tag-' + item.tag;
      tag.textContent = TAG_LABELS[item.tag] || item.tag;
      card.appendChild(tag);
    }

    const body = document.createElement('p');
    body.className = 'news-card-body';
    body.textContent = item.body || '';
    card.appendChild(body);

    container.appendChild(card);
  });
}
