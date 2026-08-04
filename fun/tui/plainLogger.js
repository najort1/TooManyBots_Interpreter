/**
 * plainLogger — sink fallback não-TTY.
 * Reproduz as linhas `[fun] HH:MM:SS [categoria] ok|falha scope? detalhe?`
 * quando o terminal não é interativo (redirecionamento/CI/serviço).
 *
 * Contrato: contracts/audit-events.md §3
 */

/**
 * @param {object} entry AuditEntry
 * @returns {string} linha formatada (sem ANSI, sem newline final)
 */
export function formatPlainEntry(entry = {}) {
  const ts = Number(entry.ts) || Date.now();
  const time = formatTime(ts);
  const category = String(entry.category || 'system');
  const level = entry.ok === false ? 'falha' : (entry.ok === true ? 'ok' : String(entry.level || 'info'));
  const scope = entry.scope ? ` ${String(entry.scope)}` : '';
  const detail = formatDetail(entry.detail);
  return `[fun] ${time} [${category}] ${level}${scope}${detail}`;
}

function formatTime(ms) {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function formatDetail(detail) {
  if (detail == null) return '';
  try {
    if (typeof detail === 'string') return ` ${detail}`;
    const keys = Object.keys(detail);
    if (keys.length === 0) return '';
    if (keys.length === 1 && keys[0] === 'reason') return ` ${String(detail.reason)}`;
    return ` ${JSON.stringify(detail)}`;
  } catch {
    return '';
  }
}
