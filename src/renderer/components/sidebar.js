import { $ } from '../helpers.js';

export function setupSidebar() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      const tab = $('tab-' + btn.dataset.tab);
      if (tab) tab.classList.add('active');
    });
  });
}
