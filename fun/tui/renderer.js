/**
 * renderer — composição de painéis da TUI.
 * Função pura: dado um `AuditSnapshot` e as dimensões, retorna a string ANSI
 * completa da tela (cabeçalho + painel em foco + rodapé). Sem efeitos colaterais.
 *
 * Painéis são registrados via `registerPanel(name, fn)` pelo runtime
 * (`fun/runtime.js`). Cada painel recebe `(snapshot, opts)` e retorna um array
 * de linhas já formatadas.
 *
 * Contrato: contracts/audit-events.md §3
 */

import {
  FG,
  STYLE,
  paint,
  padCenter,
  repeat,
  truncate,
  isAnsiAllowed,
  RESET,
  CLEAR_SCREEN,
  CURSOR_HOME,
} from './ansi.js';

export const PANELS = ['audit', 'health', 'llm', 'economy', 'groups'];
export const DEFAULT_PANEL = 'audit';

const PANEL_LABELS = Object.freeze({
  audit: 'Auditoria',
  health: 'Saúde',
  llm: 'LLM',
  economy: 'Economia',
  groups: 'Grupos',
});

/**
 * @param {Record<string, (snapshot: object, opts: object) => string[]>} panels
 */
export function createRenderer(panels = {}) {
  function renderDashboard(snapshot = {}, opts = {}) {
    const allow = opts.allow != null ? Boolean(opts.allow) : isAnsiAllowed();
    const width = Math.max(20, Math.floor(Number(opts.width) || 80));
    const height = Math.max(8, Math.floor(Number(opts.height) || 24));
    const focus = PANELS.includes(opts.focus) ? opts.focus : DEFAULT_PANEL;
    const scrollOffset = Math.max(0, Math.floor(Number(opts.scrollOffset) || 0));
    const panelFns = panels[focus] || panels[DEFAULT_PANEL] || null;

    const bodyLines = [];
    bodyLines.push(renderHeader(snapshot, { width, allow }));

    if (width < 100) {
      // Empilha verticalmente quando terminal estreito (SC-011)
      const panelLines = panelFns
        ? panelFns(snapshot, { width: width - 2, height: Math.max(4, height - 6), scrollOffset, allow })
        : [];
      bodyLines.push(...panelLines);
    } else {
      const panelWidth = width - 2;
      const panelLines = panelFns
        ? panelFns(snapshot, { width: panelWidth, height: Math.max(4, height - 6), scrollOffset, allow })
        : [];
      bodyLines.push(...panelLines);
    }

    if (height < 12) {
      // Terminal curto: prioriza auditoria + conexão (SC-011)
      bodyLines.length = 0;
      const mini = renderMini(snapshot, { width, allow });
      bodyLines.push(...mini);
    }

    bodyLines.push(renderFooter(snapshot, { width, focus, allow }));

    // Compõe a tela completa
    const prefix = allow ? `${CURSOR_HOME}${CLEAR_SCREEN}` : '';
    const screen = bodyLines.join('\n');
    return `${prefix}${screen}`;
  }

  function renderHeader(snapshot, { width, allow }) {
    const conn = renderConnectionBadge(snapshot.connection, allow);
    const uptime = formatUptime(snapshot.meta?.uptimeMs || 0);
    const quiet = renderQuietHoursBadge(snapshot.meta?.quietHours, allow);
    const url = snapshot.dashboard?.url ? ` ${snapshot.dashboard.url}` : '';
    const left = `${conn} · ${uptime} ${quiet}`;
    const header = `${truncate(left, width - 8)}${paint(FG.gray, truncate(url, 10), { allow })}`.trimEnd();
    const bar = repeat('─', width);
    return `${paint(STYLE.bold, 'fun', { allow })} ${header}${'\n'}${bar}`;
  }

  function renderFooter(snapshot, { width, focus, allow }) {
    const bar = repeat('─', width);
    const focusLabel = paint(STYLE.inverse, ` ${PANEL_LABELS[focus] || 'Auditoria'} `, { allow });
    const others = PANELS.filter(p => p !== focus)
      .map(p => paint(FG.gray, PANEL_LABELS[p], { allow }))
      .join(' ');
    const keys = paint(FG.gray, '↑↓ rolar · Tab painel · q sair', { allow });
    const statusBits = renderStatusBits(snapshot, { allow });
    return `${bar}\n${focusLabel}  ${others}   ${keys}${statusBits}`;
  }

  function renderStatusBits(snapshot, { allow }) {
    const bits = [];
    if (snapshot.llm?.alert) bits.push(paint(FG.brightRed, 'LLM', { allow }));
    if (snapshot.queues?.command?.totalQueued > 3) bits.push(paint(FG.yellow, 'FILA', { allow }));
    if (snapshot.connection?.state === 'reconnecting') bits.push(paint(FG.yellow, 'RECON', { allow }));
    return bits.length ? `  ${bits.join(' · ')}` : '';
  }

  function renderMini(snapshot, { width, allow }) {
    const conn = renderConnectionBadge(snapshot.connection, allow);
    const last = snapshot.history?.[0];
    const lastLine = last ? `${formatLevelIcon(last, allow)} ${truncate(last.kind, 18)} ${truncate(last.scope || '', 12)}` : '—';
    return [`${conn} · ${lastLine}`];
  }

  return { renderDashboard };
}

/**
 * Helpers de formatação de UI (exportados também p/ painéis).
 */

export function renderConnectionBadge(conn = {}, allow) {
  const state = String(conn.state || 'offline');
  const map = {
    offline: { color: FG.gray, label: 'offline' },
    connecting: { color: FG.yellow, label: 'conectando…' },
    online: { color: FG.green, label: 'online' },
    reconnecting: { color: FG.yellow, label: 'reconectando' },
    'logged-out': { color: FG.red, label: 'logged-out' },
  };
  const cfg = map[state] || map.offline;
  return paint(cfg.color, cfg.label, { allow });
}

export function renderQuietHoursBadge(quiet = {}, allow) {
  if (!quiet.enabled) return '';
  if (quiet.active) return ` · ${paint(FG.cyan, '🌙 silêncio', { allow })}`;
  return '';
}

export function formatUptime(ms) {
  const total = Math.max(0, Math.floor(Number(ms) || 0));
  const s = Math.floor(total / 1000) % 60;
  const m = Math.floor(total / 60_000) % 60;
  const h = Math.floor(total / 3_600_000) % 24;
  const d = Math.floor(total / 86_400_000);
  if (d > 0) return `${d}d${h}h`;
  if (h > 0) return `${h}h${m}m`;
  return `${m}m${s}s`;
}

export function formatLevelIcon(entry, allow) {
  const level = String(entry?.level || 'ok');
  const ok = entry?.ok;
  if (ok === false || level === 'error') return paint(FG.red, '✗', { allow });
  if (ok === true || level === 'ok') return paint(FG.green, '✓', { allow });
  if (level === 'warn') return paint(FG.yellow, '!', { allow });
  return paint(FG.gray, '·', { allow });
}

export function formatLevelLabel(entry) {
  const level = String(entry?.level || 'ok');
  const ok = entry?.ok;
  if (ok === false || level === 'error') return 'falha';
  if (ok === true || level === 'ok') return 'ok';
  if (level === 'warn') return 'alerta';
  return level;
}
