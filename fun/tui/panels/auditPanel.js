/**
 * Painel de auditoria — render puro da lista rolável de entradas por categoria.
 * Recebe `snapshot.history` (array já na ordem: mais recente primeiro por padrão)
 * e retorna um array de linhas formatadas.
 *
 * Contrato: contracts/audit-events.md §3 (panel 'audit')
 */

import {
  paint,
  FG,
  STYLE,
  truncate,
  padCenter,
  repeat,
  RESET,
} from '../ansi.js';
import { formatLevelIcon, formatLevelLabel } from '../renderer.js';
import { sanitizeScope } from '../auditBus.js';

const EMPTY_MESSAGE = '— sem atividade auditorada —';
const HEADER_TITLE = 'Auditoria do Mundo';

/**
 * @param {object} snapshot AuditSnapshot
 * @param {object} opts
 * @param {number} opts.width largura disponível para o painel
 * @param {number} opts.height altura disponível (linhas includindo cabeçalho)
 * @param {number} opts.scrollOffset deslocamento inicial da lista (↑/↓)
 * @param {boolean} opts.allow se ANSI pode ser emitido
 */
export function renderAuditPanel(snapshot = {}, opts = {}) {
  const allow = opts.allow != null ? Boolean(opts.allow) : false;
  const width = Math.max(20, Math.floor(Number(opts.width) || 80));
  const height = Math.max(2, Math.floor(Number(opts.height) || 10));
  const scrollOffset = Math.max(0, Math.floor(Number(opts.scrollOffset) || 0));

  const history = Array.isArray(snapshot.history) ? snapshot.history : [];

  // Compute limit for displayed lines considering header
  const headerLines = 2; // título + regra
  const bodyLimit = Math.max(1, height - headerLines);

  const out = [];
  const title = paint(STYLE.bold, HEADER_TITLE, { allow });
  const totalHistory = String(history.length);
  const totalLabel = paint(FG.gray, `[${totalHistory}]`, { allow });
  out.push(`${title} ${totalLabel}`);
  out.push(repeat('─', width));

  if (history.length === 0) {
    out.push(paint(FG.gray, padCenter(EMPTY_MESSAGE, width), { allow }));
    return out;
  }

  const start = Math.min(scrollOffset, Math.max(0, history.length - bodyLimit));
  const end = Math.min(start + bodyLimit, history.length);
  for (let i = start; i < end; i++) {
    out.push(formatEntry(history[i], { width, allow }));
  }

  return out;
}

/**
 * Formata uma `AuditEntry` em uma linha do painel.
 * Estrutura: `HH:MM:SS [categoria] levelIcon kind scope  detalhe?`
 *
 * @param {object} entry
 * @param {object} opts
 * @param {number} opts.width
 * @param {boolean} opts.allow
 */
function formatEntry(entry, { width, allow }) {
  if (!entry) return '';
  const time = formatTime(Number(entry.ts) || Date.now());
  const icon = formatLevelIcon(entry, allow);
  const catColor = categoryColor(entry.category, allow);
  const category = paint(catColor, `[${String(entry.category || 'system')}]`, { allow });
  const kind = truncate(String(entry.kind || ''), 22);
  // Defesa em profundidade: se o snapshot vier com JID completo, sanitiza aqui
  const scopeRaw = entry.scope != null ? sanitizeScope(entry.scope) : null;
  const scopeTxt = scopeRaw ? ` ${paint(FG.cyan, truncate(String(scopeRaw), 20), { allow })}` : '';
  const detailTxt = formatDetailLine(entry.detail, allow);

  // Colunas: HH:MM:SS | icon | [cat] | kind | scope
  const line = `${paint(FG.gray, time, { allow })} ${icon} ${category} ${padRight(truncate(kind, 22), 22)}${scopeTxt}${detailTxt}`;
  return truncate(line, width);
}

function formatTime(ms) {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function formatDetailLine(detail, allow) {
  if (detail == null) return '';
  try {
    if (typeof detail === 'string') return ` ${paint(FG.gray, truncate(detail, 24), { allow })}`;
    if (detail.reason) return ` ${paint(FG.gray, truncate(String(detail.reason), 24), { allow })}`;
    const keys = Object.keys(detail);
    if (keys.length === 0) return '';
    const first = keys[0];
    const val = String(detail[first]);
    return ` ${paint(FG.gray, truncate(`${first}=${val}`, 24), { allow })}`;
  } catch {
    return '';
  }
}

function categoryColor(category, allow) {
  switch (String(category)) {
    case 'connection': return FG.blue;
    case 'world': return FG.brightCyan;
    case 'market':
    case 'economy': return FG.green;
    case 'chaos': return FG.magenta;
    case 'news': return FG.brightCyan;
    case 'self-heal': return FG.yellow;
    case 'memory': return FG.cyan;
    case 'persona': return FG.magenta;
    case 'challenge': return FG.brightYellow;
    case 'restock': return FG.green;
    case 'birthday': return FG.brightMagenta;
    case 'llm': return FG.brightRed;
    case 'queue': return FG.gray;
    default: return FG.gray;
  }
}

function padRight(text, width) {
  const t = String(text ?? '');
  if (t.length >= width) return t.slice(0, width);
  return `${t}${' '.repeat(width - t.length)}`;
}
