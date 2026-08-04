/**
 * Painel de economia — último `economy-tick` + totais.
 * Lê `snapshot.history` filtrando `kind === 'economy-tick'` (mais recente primeiro)
 * e o contador `snapshot.counters.byKind.get('economy-tick')`.
 *
 * Contrato: contracts/audit-events.md §3 (panel 'economy')
 */

import { paint, FG, STYLE, truncate, repeat } from '../ansi.js';
import { formatLevelIcon } from '../renderer.js';
import { sanitizeScope } from '../auditBus.js';

const HEADER_TITLE = 'Economia do Mundo';
const MAX_DETAIL = 5; // últimos N economia-tick exibidos

/**
 * @param {object} snapshot
 * @param {object} opts { width, height, scrollOffset, allow }
 */
export function renderEconomyPanel(snapshot = {}, opts = {}) {
  const allow = opts.allow != null ? Boolean(opts.allow) : false;
  const width = Math.max(20, Math.floor(Number(opts.width) || 80));
  const height = Math.max(2, Math.floor(Number(opts.height) || 10));

  const out = [];
  out.push(paint(STYLE.bold, HEADER_TITLE, { allow }));
  out.push(repeat('─', width));

  if (snapshot.config?.economyEnabled === false) {
    out.push(paint(FG.gray, 'Economia — OFF (economyEnabled=false)', { allow }));
    return out;
  }

  const history = Array.isArray(snapshot.history) ? snapshot.history : [];
  const econEntries = history.filter(h => h && h.kind === 'economy-tick');
  const total = snapshot.counters?.byKind?.get?.('economy-tick') || econEntries.length;

  if (econEntries.length === 0) {
    out.push(paint(FG.gray, '— sem ticks de economia ainda —', { allow }));
    return out;
  }

  // Linha de total
  const totalLabel = paint(FG.gray, `Ticks acumulados: ${total}`, { allow });
  out.push(totalLabel);

  // Últimos N (mais recente primeiro — history em ordem)
  const limit = Math.max(1, Math.min(MAX_DETAIL, height - 3));
  const slice = econEntries.slice(0, limit);
  for (const entry of slice) {
    out.push(formatEconEntry(entry, { width, allow }));
  }

  // Limita pela altura
  const maxLines = Math.max(2, height);
  if (out.length > maxLines) return out.slice(0, maxLines);
  return out;
}

function formatEconEntry(entry, { width, allow }) {
  const icon = formatLevelIcon(entry, allow);
  const scope = entry.scope ? ` ${paint(FG.cyan, truncate(String(sanitizeScope(entry.scope)), 20), { allow })}` : '';
  const d = entry.detail || {};
  const parts = [];
  if (Number(d.changed) > 0) parts.push(`${d.changed}ItemAt`);
  if (Number(d.stockChanged) > 0) parts.push(`${d.stockChanged}stock`);
  if (Number(d.scheduledApplied) > 0) parts.push(`${d.scheduledApplied}reg`);
  if (d.reason && entry.ok === false) parts.push(String(d.reason));
  if (d.nextInMs && entry.ok === false) parts.push(`_próx ${formatMs(d.nextInMs)}`);
  const detailStr = parts.length ? ` ${paint(FG.gray, truncate(parts.join(' · '), 40), { allow })}` : '';
  const time = formatTime(Number(entry.ts) || Date.now());
  return truncate(`${paint(FG.gray, time, { allow })} ${icon}${scope}${detailStr}`, width);
}

function formatTime(ms) {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function formatMs(n) {
  const num = Math.max(0, Math.floor(Number(n) || 0));
  if (num < 1000) return `${num}ms`;
  if (num < 60_000) return `${(num / 1000).toFixed(0)}s`;
  return `${(num / 60_000).toFixed(1)}min`;
}
