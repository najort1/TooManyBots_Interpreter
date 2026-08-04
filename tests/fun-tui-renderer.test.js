/**
 * Testes do renderer (função pura).
 * FR-017 · layout, foco, adaptação a tamanho, sem ANSI fora de TTY.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRenderer,
  PANELS,
  DEFAULT_PANEL,
  formatUptime,
  formatLevelIcon,
} from '../fun/tui/renderer.js';
import { FG, paint } from '../fun/tui/ansi.js';

function fakeSnapshot(overrides = {}) {
  return {
    meta: {
      startedAt: 1700000000000,
      now: 1700000100000,
      uptimeMs: 100_000,
      quietHours: { enabled: true, active: false, windowLabel: '1h–6h' },
    },
    connection: { state: 'online', lastReason: null, reconnect: { pending: false } },
    world: { enabled: true, tickMs: 45000, lastTick: null, resultsByKind: new Map() },
    queues: {
      command: { totalQueued: 0, totalRunning: 0, totalAccepted: 0, totalRejected: 0, totalCompleted: 0, totalFailed: 0 },
      output: { queued: 0, running: 0, accepted: 0, sent: 0, coalesced: 0, failed: 0, avgWaitMs: 0, p95WaitMs: 0, acceptedPerSecond: 0 },
    },
    llm: { byTask: {}, invent: null, alert: null, lastByTask: null },
    selfHeal: { enabled: true, dryRun: true, lastSweepAt: null, counters: { applied: 0, rejected: 0, pending: 0, failed: 0 } },
    dashboard: { enabled: true, started: true, url: 'http://127.0.0.1:8790' },
    groups: [],
    config: { whitelistCount: 1, worldAutonomous: true, economyEnabled: true, propertiesEnabled: true },
    history: [
      { ts: 1700000099000, category: 'market', level: 'ok', kind: 'market', scope: 'Zoeira', ok: true, detail: null },
      { ts: 1700000098000, category: 'connection', level: 'ok', kind: 'open', scope: null, ok: true, detail: null },
    ],
    counters: { byCategory: new Map(), byKind: new Map() },
    discardedCount: 0,
    ...overrides,
  };
}

function makeRenderer(panels = {}) {
  return createRenderer(panels);
}

test('PANELS: lista ordenada com os 5 painéis', () => {
  assert.deepEqual(PANELS, ['audit', 'health', 'llm', 'economy', 'groups']);
  assert.equal(DEFAULT_PANEL, 'audit');
});

test('renderDashboard: retorna string com header, body e footer', () => {
  const renderer = makeRenderer({
    audit: (snap, opts) => ['linha 1', 'linha 2', `w=${opts.width}`],
  });
  const snap = fakeSnapshot();
  const out = renderer.renderDashboard(snap, { width: 100, height: 24, focus: 'audit', allow: false });
  assert.ok(out.includes('fun'));
  assert.ok(out.includes('linha 1'));
  assert.ok(out.includes('linha 2'));
  assert.ok(out.includes('rolear') || out.includes('rir') || out.includes('↑↓'));
});

test('renderDashboard: sem ANSI quando allow=false', () => {
  const renderer = makeRenderer({
    audit: (snap, opts) => ['linha 1'],
  });
  const snap = fakeSnapshot();
  const out = renderer.renderDashboard(snap, { width: 100, height: 20, focus: 'audit', allow: false });
  assert.ok(!out.includes('\u001b['), 'não deve emitir sequências ANSI quando allow=false');
});

test('renderDashboard: com allow=true emite ANSI e prefixo de clear/home', () => {
  const renderer = makeRenderer({
    audit: (snap, opts) => ['linha 1'],
  });
  const snap = fakeSnapshot();
  const out = renderer.renderDashboard(snap, { width: 100, height: 20, focus: 'audit', allow: true });
  assert.ok(out.includes('\u001b[2J'), 'deve conter CLEAR_SCREEN');
  assert.ok(out.includes('\u001b[H'), 'deve conter CURSOR_HOME');
});

test('renderDashboard: foco em painel registrado usa render dele', () => {
  let seenFocus = null;
  const renderer = makeRenderer({
    audit: (snap, opts) => ['audit-body'],
    health: (snap, opts) => { seenFocus = 'health'; return ['health-body']; },
  });
  const snap = fakeSnapshot();
  const out = renderer.renderDashboard(snap, { width: 100, height: 20, focus: 'health', allow: false });
  assert.equal(seenFocus, 'health');
  assert.ok(out.includes('health-body'));
  assert.ok(!out.includes('audit-body'));
});

test('renderDashboard: foco em painel desconhecido cai para default (audit)', () => {
  let called = null;
  const renderer = makeRenderer({
    audit: (snap, opts) => { called = 'audit'; return ['audit-body']; },
  });
  const snap = fakeSnapshot();
  renderer.renderDashboard(snap, { width: 100, height: 20, focus: 'zzz', allow: false });
  assert.equal(called, 'audit');
});

test('renderDashboard: terminal estreito (width<100) ainda renderiza body', () => {
  const renderer = makeRenderer({
    audit: (snap, opts) => [`audit w=${opts.width}`],
  });
  const snap = fakeSnapshot();
  const out = renderer.renderDashboard(snap, { width: 60, height: 20, focus: 'audit', allow: false });
  assert.ok(out.includes('audit w='));
});

test('renderDashboard: terminal curto (height<12) usa modo mini e não quebra', () => {
  const renderer = makeRenderer({
    audit: (snap, opts) => ['linha gigantesca que não deve aparecer no mini'],
  });
  const snap = fakeSnapshot();
  const out = renderer.renderDashboard(snap, { width: 100, height: 8, focus: 'audit', allow: false });
  assert.ok(out.includes('online') || out.includes('offline') || out.includes('conectando') || out.includes('reconectando'));
  assert.ok(!out.includes('linha gigantesca'), 'body grande não deve aparecer no height baixo');
});

test('renderDashboard: footer mostra nome do painel em foco', () => {
  const renderer = makeRenderer({
    health: (snap, opts) => ['health-body'],
  });
  const snap = fakeSnapshot();
  const out = renderer.renderDashboard(snap, { width: 100, height: 20, focus: 'health', allow: false });
  assert.ok(out.includes('Saúde'));
});

test('renderDashboard: status badges aparecem quando há alertas (LLM/FILA/RECON)', () => {
  const renderer = makeRenderer({
    audit: (snap, opts) => ['body'],
  });
  const snap = fakeSnapshot({
    llm: { byTask: {}, invent: null, alert: { templateRate: 0.55 }, lastByTask: null },
    queues: {
      command: { totalQueued: 10, totalRunning: 0, totalAccepted: 0, totalRejected: 0, totalCompleted: 0, totalFailed: 0 },
      output: { queued: 0 },
    },
    connection: { state: 'reconnecting', reconnect: { pending: true } },
  });
  const out = renderer.renderDashboard(snap, { width: 100, height: 20, focus: 'audit', allow: true });
  // Em allow=true os badges usam cores ANSI — apenas verificamos texto
  assert.ok(out.includes('LLM') || out.includes('FILA') || out.includes('RECON'));
});

test('formatUptime: formata em dias/horas/min/seg', () => {
  assert.equal(formatUptime(0), '0m0s');
  assert.equal(formatUptime(45000), '0m45s');
  assert.equal(formatUptime(3 * 60_000), '3m0s');
  assert.equal(formatUptime(2 * 60 * 60_000), '2h0m');
  assert.equal(formatUptime(25 * 60 * 60_000), '1d1h');
  assert.equal(formatUptime(48 * 60 * 60_000 + 30_000), '2d0h');
});

test('formatLevelIcon: ok=verde, falha=vermelho, warn=amarelo, info=cinza', () => {
  const okIcon = formatLevelIcon({ level: 'ok', ok: true }, true);
  assert.ok(okIcon.includes('\u001b[32m'), 'ok deve ser verde');

  const errIcon = formatLevelIcon({ level: 'ok', ok: false }, true);
  assert.ok(errIcon.includes('\u001b[31m'), 'falha deve ser vermelho');

  const warnIcon = formatLevelIcon({ level: 'warn' }, true);
  assert.ok(warnIcon.includes('\u001b[33m'), 'warn deve ser amarelo');

  const infoIcon = formatLevelIcon({ level: 'info' }, true);
  assert.ok(infoIcon.includes('\u001b[90m'), 'info deve ser cinza');

  // Sem ANSI quando allow=false
  const plain = formatLevelIcon({ level: 'ok', ok: true }, false);
  assert.equal(plain, '✓');
});
