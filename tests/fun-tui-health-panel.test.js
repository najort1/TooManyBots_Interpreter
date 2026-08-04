/**
 * Testes do painel de saúde (filas + reconexão).
 * FR-017 · US2 · in-memory · determinístico.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { renderHealthPanel } from '../fun/tui/panels/healthPanel.js';

function fakeSnapshot(overrides = {}) {
  return {
    connection: {
      state: 'online',
      lastReason: null,
      lastStatusCode: null,
      reconnect: { pending: false, nextReconnectAt: null, currentAttempt: 0, lastDelayMs: null },
    },
    queues: {
      command: { totalQueued: 0, totalRunning: 0, totalAccepted: 12, totalRejected: 0, totalCompleted: 10, totalFailed: 0 },
      output: { queued: 0, running: 0, accepted: 30, sent: 28, coalesced: 2, failed: 0, avgWaitMs: 50, p95WaitMs: 200, acceptedPerSecond: 0.5 },
    },
    world: { enabled: true, tickMs: 45000, lastTick: { ts: 1700000000000, fired: 2, tookMs: 30 }, resultsByKind: new Map() },
    meta: { uptimeMs: 100_000 },
    config: { whitelistCount: 1, worldAutonomous: true, economyEnabled: true, propertiesEnabled: true },
    ...overrides,
  };
}

test('renderHealthPanel: estado online exibe conexão + filas zeradas/ok', () => {
  const snap = fakeSnapshot();
  const lines = renderHealthPanel(snap, { width: 80, height: 20, allow: false });
  const joined = lines.join('\n');
  assert.ok(joined.toLowerCase().includes('online'));
  assert.ok(joined.toLowerCase().includes('fila') || joined.toLowerCase().includes('comando'));
});

test('renderHealthPanel: reconexão pendente mostra contador e delay', () => {
  const snap = fakeSnapshot({
    connection: {
      state: 'reconnecting',
      lastReason: 'timeout',
      lastStatusCode: 428,
      reconnect: { pending: true, nextReconnectAt: Date.now() + 3000, currentAttempt: 2, lastDelayMs: 3000 },
    },
  });
  const joined = renderHealthPanel(snap, { width: 80, height: 20, allow: false }).join('\n');
  assert.ok(joined.includes('reconectando') || joined.toLowerCase().includes('reconnect'), `esperava reconectar: ${joined}`);
  assert.ok(joined.includes('2'), 'deve mostrar currentAttempt=2');
  assert.ok(/3[.,]0?s|3000\s?ms|3s/.test(joined.toLowerCase()) || joined.includes('3000'), `deve mostrar delay 3000ms: ${joined}`);
});

test('renderHealthPanel: filas com backlog destacam rejeições/falhas', () => {
  const snap = fakeSnapshot({
    queues: {
      command: { totalQueued: 8, totalRunning: 2, totalAccepted: 50, totalRejected: 5, totalCompleted: 40, totalFailed: 3 },
      output: { queued: 5, running: 1, accepted: 60, sent: 50, coalesced: 3, failed: 2, avgWaitMs: 120, p95WaitMs: 800, acceptedPerSecond: 0.4 },
    },
  });
  const joined = renderHealthPanel(snap, { width: 80, height: 20, allow: true }).join('\n');
  assert.ok(joined.includes('8'), 'totalQueued=8 deve aparecer');
  assert.ok(joined.includes('5'), 'totalRejected=5 deve aparecer');
  assert.ok(joined.includes('3'), 'totalFailed=3 deve aparecer');
  // Cores ANSI em allow=true
  assert.ok(joined.includes('\u001b['));
});

test('renderHealthPanel: world lastTick mostrado com fired e tookMs', () => {
  const snap = fakeSnapshot({
    world: { enabled: true, tickMs: 45000, lastTick: { ts: 1700000000000, fired: 3, tookMs: 45 }, resultsByKind: new Map([['market', 1], ['news', 2]]) },
  });
  const joined = renderHealthPanel(snap, { width: 80, height: 20, allow: false }).join('\n');
  assert.ok(joined.includes('3'), 'fired=3 deve aparecer');
  assert.ok(/45\s?ms/.test(joined), `deve mostrar tookMs=45ms: ${joined}`);
});

test('renderHealthPanel: world desativado mostra mensagem clara', () => {
  const snap = fakeSnapshot({
    world: { enabled: false, tickMs: 45000, lastTick: null, resultsByKind: new Map() },
  });
  const joined = renderHealthPanel(snap, { width: 80, height: 20, allow: false }).join('\n');
  assert.ok(joined.toLowerCase().includes('off') || joined.toLowerCase().includes('desligado') || joined.includes('—'),
    `world desativado deve indicar: ${joined}`);
});

test('renderHealthPanel: output queue p95 e avgWaitMs expostos', () => {
  const snap = fakeSnapshot({
    queues: {
      command: { totalQueued: 0, totalRunning: 0, totalAccepted: 0, totalRejected: 0, totalCompleted: 0, totalFailed: 0 },
      output: { queued: 0, running: 0, accepted: 100, sent: 90, coalesced: 10, failed: 0, avgWaitMs: 80, p95WaitMs: 350, acceptedPerSecond: 1.2 },
    },
  });
  const joined = renderHealthPanel(snap, { width: 80, height: 20, allow: false }).join('\n');
  assert.ok(joined.includes('80'), 'avgWaitMs=80 deve aparecer');
  assert.ok(joined.includes('350'), 'p95WaitMs=350 deve aparecer');
  assert.ok(joined.includes('1.2') || joined.includes('1,2'), 'acceptedPerSecond deve aparecer');
});

test('renderHealthPanel: limita linhas pela altura', () => {
  const snap = fakeSnapshot();
  const lines = renderHealthPanel(snap, { width: 80, height: 4, allow: false });
  assert.ok(lines.length <= 8, `height=4 não deve renderizar ${lines.length} linhas`);
});

test('renderHealthPanel: estado vazio (offline inicial) não trava', () => {
  const snap = {
    connection: { state: 'offline', reconnect: {} },
    queues: { command: {}, output: {} },
    world: { enabled: false },
    meta: { uptimeMs: 0 },
    config: {},
  };
  const lines = renderHealthPanel(snap, { width: 40, height: 6, allow: false });
  assert.ok(Array.isArray(lines));
  assert.ok(lines.length > 0);
});
