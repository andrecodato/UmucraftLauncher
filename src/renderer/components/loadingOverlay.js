import { $ } from '../helpers.js';

export function hideLoadingOverlay() {
  const overlay = $('loading-overlay');
  if (overlay) {
    overlay.classList.add('hidden');
    overlay.style.display = 'none';
  }
}
