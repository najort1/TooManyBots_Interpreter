/**
 * createFunTui — fábrica da TUI interativa (alternate screen + readline raw).
 *
 * Ciclo:
 * - `start()`: entra no alternate screen buffer, inicia refresh throttled
 *   (`tuiRefreshMs`) e teclado via `node:readline` raw mode.
 * - `stop()` / tecla `q` / `SIGINT`: restaura o buffer e encerra.
 * - Sem ANSI quando `!process.stdout.isTTY` (modo plain não chama o loop).
 *
 * Contrato: contracts/audit-events.md §4
 */

import * as readline from 'node:readline';
import { ENTER_ALT_SCREEN, EXIT_ALT_SCREEN, CLEAR_SCREEN, CURSOR_HOME } from './ansi.js';
import { PANELS, DEFAULT_PANEL } from './renderer.js';
import { formatPlainEntry } from './plainLogger.js';

const KEY_ARROW_UP = '\u001b[A';
const KEY_ARROW_DOWN = '\u001b[B';
const KEY_TAB = '\t';
const KEY_Q = 'q';
const KEY_CTRL_C = '\u0003';

/**
 * @param {object} opts
 * @param {object} opts.bus auditBus com `buildSnapshot`
 * @param {object} opts.renderer renderer com `renderDashboard`
 * @param {object} opts.funConfig config normalizado (tuiRefreshMs, tuiEnabled)
 * @param {object} opts.sink saída (default process.stdout)
 * @param {number} [opts.refreshMs] intervalo de refresh (override p/ testes)
 * @param {boolean} [opts.allow] sobrescreve isTTY (testes)
 */
export function createFunTui({
  bus,
  renderer,
  funConfig = {},
  sink = process.stdout,
  refreshMs,
  allow,
} = {}) {
  const isAllowed = allow != null ? Boolean(allow) : Boolean(sink.isTTY);
  const refreshDelay = Math.max(200, Math.floor(Number(refreshMs || funConfig.tuiRefreshMs) || 1000));

  let running = false;
  let focus = DEFAULT_PANEL;
  let scrollOffset = 0;
  let timer = null;
  let rl = null;
  let width = sink.columns || 80;
  let height = sink.rows || 24;

  function emitPlain(entry) {
    try {
      sink.write(`${formatPlainEntry(entry)}\n`);
    } catch {
      // ignore
    }
  }

  function refresh() {
    if (!running || !isAllowed) return;
    try {
      width = sink.columns || width;
      height = sink.rows || height;
      const snapshot = bus.buildSnapshot({ funConfig, now: Date.now() });
      const screen = renderer.renderDashboard(snapshot, { width, height, focus, scrollOffset, allow: true });
      sink.write(screen);
    } catch (err) {
      // Erro de render não pode derrubar o bot
      sink.write(`[fun/tui] render falhou: ${String(err?.message || err)}\n`);
    }
  }

  function start() {
    if (running) return;
    if (!isAllowed || funConfig.tuiEnabled === false) return;
    running = true;
    sink.write(ENTER_ALT_SCREEN);
    sink.write(`${CLEAR_SCREEN}${CURSOR_HOME}`);

    refresh();
    timer = setInterval(refresh, refreshDelay);
    if (typeof timer.unref === 'function') timer.unref();

    rl = readline.createInterface({ input: process.stdin, output: null, terminal: true });
    try {
      process.stdin.setRawMode?.(true);
    } catch {
      // sem raw mode: apenas refresh automático
    }
    process.stdin.resume();
    rl.input.on('data', onKey);

    process.once('SIGINT', handleSignal);
    process.once('exit', handleSignal);
  }

  function onKey(buf) {
    const data = String(buf || '');
    if (data === KEY_ARROW_UP) {
      scrollOffset = Math.max(0, scrollOffset - 1);
      refresh();
    } else if (data === KEY_ARROW_DOWN) {
      scrollOffset += 1;
      refresh();
    } else if (data === KEY_TAB) {
      const next = focusNextPanel(focus);
      if (next) { focus = next; scrollOffset = 0; refresh(); }
    } else if (data === KEY_Q || data === KEY_CTRL_C) {
      stop();
      process.exit(0);
    }
  }

  function focusNextPanel(current) {
    const idx = PANELS.indexOf(current);
    if (idx < 0) return DEFAULT_PANEL;
    return PANELS[(idx + 1) % PANELS.length];
  }

  function stop() {
    if (!running) return;
    running = false;
    if (timer) { clearInterval(timer); timer = null; }
    try {
      rl?.input?.removeListener?.('data', onKey);
      rl?.close?.();
    } catch {
      // ignore
    }
    try {
      process.stdin.setRawMode?.(false);
      process.stdin.pause();
    } catch {
      // ignore
    }
    if (isAllowed) sink.write(EXIT_ALT_SCREEN);
    process.removeListener('SIGINT', handleSignal);
    process.removeListener('exit', handleSignal);
  }

  function handleSignal() {
    stop();
    if (process.listenerCount('SIGINT') === 0) {
      process.exit(0);
    }
  }

  return {
    start,
    stop,
    refresh,
    emitPlain,
    isAllowed: () => isAllowed,
    getFocus: () => focus,
    setFocus: (panel) => { if (PANELS.includes(panel)) focus = panel; },
    _internal: { getRunning: () => running, getScrollOffset: () => scrollOffset, resetScroll: () => { scrollOffset = 0; } },
  };
}
