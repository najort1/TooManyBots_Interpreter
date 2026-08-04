/**
 * Painel de saúde — filas (command/output) + reconexão + world lastTick.
 * Render puro: dado `snapshot` (queues/connection/world), retorna linhas formatadas.
 *
 * Contrato: contracts/audit-events.md §3 (panel 'health')
 */

import { paint, FG, STYLE, truncate, padCenter, repeat } from '../ansi.js';
import { formatUptime } from '../renderer.js';

const HEADER_TITLE = 'Saúde do Runtime';

/**
 * @param {object} snapshot
 * @param {object} opts { width, height, scrollOffset, allow }
 */
export function renderHealthPanel(snapshot = {}, opts = {}) {
  const allow = opts.allow != null ? Boolean(opts.allow) : false;
  const width = Math.max(20, Math.floor(Number(opts.width) || 80));
  const height = Math.max(2, Math.floor(Number(opts.height) || 10));
  const out = [];
  out.push(paint(STYLE.bold, HEADER_TITLE, { allow }));
  out.push(repeat('─', width));

  out.push(renderConnectionSection(snapshot.connection, { width, allow }));
  out.push(renderCommandQueueSection(snapshot.queues?.command, { width, allow }));
  out.push(renderOutputQueueSection(snapshot.queues?.output, { width, allow }));
  out.push(renderWorldSection(snapshot.world, { width, allow }));

  // Limita pela altura (mantém as primeiras linhas críticas)
  const maxLines = Math.max(2, height);
  if (out.length > maxLines) return out.slice(0, maxLines);
  return out;
}

function renderConnectionSection(conn = {}, { width, allow }) {
  const state = String(conn.state || 'offline');
  const badge = renderStateBadge(state, allow);
  const reason = conn.lastReason ? ` · ${truncate(String(conn.lastReason), 20)}` : '';
  const rc = conn.reconnect || {};
  let rcText = '';
  if (rc.pending) {
    rcText = ` · tentativa ${Number(rc.currentAttempt) || 0}${rc.lastDelayMs ? ` · ${formatMs(rc.lastDelayMs)}` : ''}`;
  } else if (state === 'reconnecting') {
    rcText = ` · tentativa ${Number(rc.currentAttempt) || 0}${rc.lastDelayMs ? ` · ${formatMs(rc.lastDelayMs)}` : ''}`;
  }
  return truncate(`Conexão ${badge}${reason}${rcText}`, width);
}

function renderStateBadge(state, allow) {
  switch (state) {
    case 'online': return paint(FG.green, 'online', { allow });
    case 'connecting': return paint(FG.yellow, 'conectando', { allow });
    case 'reconnecting': return paint(FG.yellow, 'reconectando', { allow });
    case 'logged-out': return paint(FG.red, 'logged-out', { allow });
    default: return paint(FG.gray, 'offline', { allow });
  }
}

function renderCommandQueueSection(cmd = {}, { width, allow }) {
  const queued = Number(cmd.totalQueued) || 0;
  const running = Number(cmd.totalRunning) || 0;
  const accepted = Number(cmd.totalAccepted) || 0;
  const rejected = Number(cmd.totalRejected) || 0;
  const completed = Number(cmd.totalCompleted) || 0;
  const failed = Number(cmd.totalFailed) || 0;

  const queuedColor = queued > 3 ? FG.yellow : FG.gray;
  const rejectedColor = rejected > 0 ? FG.red : FG.gray;
  const failedColor = failed > 0 ? FG.red : FG.gray;

  return truncate(
    `Fila cmd ${paint(queuedColor, `${queued} fila`, { allow })} · ${running} run · ${completed} ok ${paint(rejectedColor, `${rejected} rej`, { allow })} ${paint(failedColor, `${failed} falha`, { allow })}`,
    width,
  );
}

function renderOutputQueueSection(out = {}, { width, allow }) {
  const queued = Number(out.queued) || 0;
  const running = Number(out.running) || 0;
  const accepted = Number(out.accepted) || 0;
  const sent = Number(out.sent) || 0;
  const coalesced = Number(out.coalesced) || 0;
  const failed = Number(out.failed) || 0;
  const avgWait = Number(out.avgWaitMs) || 0;
  const p95Wait = Number(out.p95WaitMs) || 0;
  const aps = Number(out.acceptedPerSecond) || 0;

  const failedColor = failed > 0 ? FG.red : FG.gray;
  const first = truncate(`Out ${queued} fila · ${sent} env · ${coalesced} coaliz ${paint(failedColor, `${failed} falha`, { allow })}`, width);
  const second = truncate(`wait avg ${formatMs(avgWait)} · p95 ${formatMs(p95Wait)} · ${aps.toFixed(2)}/s`, width);
  return `${first}\n${second}`;
}

function renderWorldSection(world = {}, { width, allow }) {
  if (!world.enabled) {
    return paint(FG.gray, 'Mundo autônomo — OFF', { allow });
  }
  const tickMs = Number(world.tickMs) || 45_000;
  const last = world.lastTick;
  if (!last) {
    return paint(FG.gray, `Mundo a cada ${formatMs(tickMs)} · aguardando 1º tick`, { allow });
  }
  const fired = Number(last.fired) || 0;
  const tookMs = Number(last.tookMs) || 0;
  return truncate(`Mundo a cada ${formatMs(tickMs)} · último ${fired} disparo(s) em ${formatMs(tookMs)}`, width);
}

function formatMs(n) {
  const num = Math.max(0, Math.floor(Number(n) || 0));
  if (num < 1000) return `${num}ms`;
  return `${(num / 1000).toFixed(1)}s`;
}
