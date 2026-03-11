import { $ } from '../helpers.js';
import { TIPS } from '../data/tips.js';

export function populateTipsTab() {
  const container = $('tips-container');
  container.innerHTML = '';

  // Group by category
  const categories = {};
  TIPS.forEach(tip => {
    if (!categories[tip.category]) categories[tip.category] = [];
    categories[tip.category].push(tip);
  });

  for (const [catName, tips] of Object.entries(categories)) {
    const section = document.createElement('div');
    section.className = 'tips-category';

    const title = document.createElement('div');
    title.className = 'tips-category-title';
    title.textContent = catName;
    section.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'tips-grid';

    tips.forEach(tip => {
      const card = document.createElement('div');
      card.className = 'tip-card';
      card.addEventListener('click', () => {
        window.launcher.openExternal(tip.url);
      });

      const img = document.createElement('img');
      img.className = 'tip-thumb';
      img.src = tip.thumbnail;
      img.alt = tip.title;
      img.loading = 'lazy';
      card.appendChild(img);

      const info = document.createElement('div');
      info.className = 'tip-info';

      const tipTitle = document.createElement('div');
      tipTitle.className = 'tip-title';
      tipTitle.textContent = tip.title;
      info.appendChild(tipTitle);

      const catLabel = document.createElement('div');
      catLabel.className = 'tip-category-label';
      catLabel.textContent = tip.category;
      info.appendChild(catLabel);

      card.appendChild(info);
      grid.appendChild(card);
    });

    section.appendChild(grid);
    container.appendChild(section);
  }
}
