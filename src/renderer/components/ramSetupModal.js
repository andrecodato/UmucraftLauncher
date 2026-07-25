import { $ } from '../helpers.js';

const RECOMMENDED_MIN = 4096;
const RECOMMENDED_MAX = 8192;
const WARN_RATIO = 0.7;

function formatGb(mb) {
  return `${(mb / 1024).toFixed(1).replace(/\.0$/, '')} GB`;
}

function updateWarning(val, totalRam) {
  const warn = $('ram-modal-warning');
  if (!warn) return;

  if (totalRam && val > totalRam * WARN_RATIO) {
    warn.textContent = `Atencao: isso passa de ${Math.round(WARN_RATIO * 100)}% da sua RAM total (${formatGb(totalRam)}) — o resto do sistema pode ficar sem memoria e travar.`;
    warn.style.display = 'block';
  } else if (val > RECOMMENDED_MAX) {
    warn.textContent = `Atencao: mais do que o recomendado (ate ${formatGb(RECOMMENDED_MAX)}) pra maioria dos modpacks — so aumente se souber que precisa.`;
    warn.style.display = 'block';
  } else {
    warn.style.display = 'none';
  }
}

/**
 * Shows the first-launch RAM picker and resolves with the chosen value (MB)
 * once the user confirms. No cancel path on purpose — this gates the very
 * first launch of a profile, between sync finishing and java spawning (see
 * homePage.js), so there's nothing sensible to "cancel" back to.
 */
export function showRamSetupModal({ totalRam, currentRam }) {
  return new Promise((resolve) => {
    const overlay = $('ram-setup-modal');
    const slider = $('ram-modal-slider');
    const display = $('ram-modal-display');
    const totalLabel = $('ram-modal-total');
    const confirmBtn = $('ram-modal-confirm');

    const maxRam = Math.min(totalRam || 16384, 32768);
    slider.min = 1024;
    slider.max = maxRam;
    slider.step = 512;
    slider.value = Math.min(Math.max(currentRam || RECOMMENDED_MIN, RECOMMENDED_MIN), maxRam);

    totalLabel.textContent = totalRam ? formatGb(totalRam) : '?';

    const render = () => {
      const val = parseInt(slider.value, 10);
      display.textContent = `${val} MB (${formatGb(val)})`;
      updateWarning(val, totalRam);
    };
    render();
    slider.addEventListener('input', render);

    overlay.classList.remove('hidden');
    overlay.style.display = 'flex';

    confirmBtn.addEventListener('click', function onConfirm() {
      confirmBtn.removeEventListener('click', onConfirm);
      slider.removeEventListener('input', render);
      overlay.classList.add('hidden');
      overlay.style.display = 'none';
      resolve(parseInt(slider.value, 10));
    });
  });
}
