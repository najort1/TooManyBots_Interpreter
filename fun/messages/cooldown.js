/**
 * Formatação padronizada de cooldown — mesma identidade visual em todos os comandos.
 */

function formatDuration(ms) {
  const sec = Math.ceil(Math.max(0, ms) / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

/**
 * @param {string} command — nome do comando (ex.: "roleta")
 * @param {number|string} retryIn — ms ou string já formatada
 * @returns {string} ex.: "⏳ Roleta disponível em 5m."
 */
export function formatCooldown(command, retryIn) {
  const label = typeof retryIn === 'number' ? formatDuration(retryIn) : String(retryIn || '');
  const cmd = String(command || '').replace(/^\/+/, '');
  return `⏳ ${cmd} disponível em ${label}.`;
}

export { formatDuration };