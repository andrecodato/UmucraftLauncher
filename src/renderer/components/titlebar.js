import { $ } from '../helpers.js';

export function setupTitlebar() {
  $('btn-minimize').addEventListener('click', () => window.launcher.minimize());
  $('btn-maximize').addEventListener('click', () => window.launcher.maximize());
  $('btn-close').addEventListener('click', () => window.launcher.close());
}
