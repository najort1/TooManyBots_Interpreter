/**
 * Painel de grupos — membros + top comandos + top players por grupo.
 * Lê `snapshot.groups` (array de { jid, name, memberCount, topPlayers, topCommands }).
 *
 * Contrato: contracts/audit-events.md §3 (panel 'groups')
 */

import { paint, FG, STYLE, truncate, repeat } from '../ansi.js';
import { sanitizeScope } from '../auditBus.js';

const HEADER_TITLE = 'Grupos Ativos';

/**
 * @param {object} snapshot
 * @param {object} opts { width, height, scrollOffset, allow }
 */
export function renderGroupsPanel(snapshot = {}, opts = {}) {
  const allow = opts.allow != null ? Boolean(opts.allow) : false;
  const width = Math.max(20, Math.floor(Number(opts.width) || 80));
  const height = Math.max(2, Math.floor(Number(opts_height(opts)) || 10));

  const groups = Array.isArray(snapshot.groups) ? snapshot.groups : [];

  const out = [];
  out.push(paint(STYLE.bold, HEADER_TITLE, { allow }));
  out.push(repeat('─', width));

  if (groups.length === 0) {
    out.push(paint(FG.gray, '— sem grupos na whitelist —', { allow }));
    return out;
  }

  // Cada grupo ocupa um bloco de linhas
  for (const g of groups) {
    out.push(renderGroupBlock(g, { width, allow }));
  }

  // Limita por altura mantendo primeiras linhas
  const maxLines = Math.max(2, height);
  if (out.length > maxLines) return out.slice(0, maxLines);
  return out;
}

function opts_height(opts) {
  return opts.height;
}

function renderGroupBlock(g = {}, { width, allow }) {
  const name = g.name || '—';
  const memberCount = Number(g.memberCount) || 0;
  const header = `${paint(STYLE.bold, truncate(name, 24), { allow })} ${paint(FG.gray, `(${memberCount} membros)`, { allow })}`;
  const lines = [header];

  // Top players (3)
  if (Array.isArray(g.topPlayers) && g.topPlayers.length > 0) {
    const slice = g.topPlayers.slice(0, 3);
    const parts = slice.map(p => `${truncate(String(p.name || '?'), 12)} ${p.xp}xp`);
    lines.push(`  top: ${parts.join(' · ')}`);
  }

  // Top commands (5)
  if (Array.isArray(g.topCommands) && g.topCommands.length > 0) {
    const slice = g.topCommands.slice(0, 5);
    const parts = slice.map(c => `/${truncate(String(c.command || '?'), 12)} ${c.count}`);
    lines.push(`  cmds: ${parts.join(' · ')}`);
  }

  // JID truncado (FR-015) — apenas se não temos nome amigável conhecido
  if (!g.name && g.jid) {
    lines.push(paint(FG.gray, `  ${sanitizeScope(g.jid)}`, { allow }));
  }

  return lines.map(l => truncate(String(l), width)).join('\n');
}
