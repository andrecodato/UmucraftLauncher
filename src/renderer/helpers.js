export const $ = (id) => document.getElementById(id);

export function logLine(msg, type = '') {
  const el = $('log-console');
  if (!el) return;
  const line = document.createElement('div');
  line.className = 'log-line ' + type;
  line.textContent = '> ' + msg;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
