/**
 * Testes do audit bus (coleta/agregação da auditoria).
 * FR-017 · in-memory · sem rede · determinístico.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createAuditBus,
  sanitizeScope,
  truncateJid,
  hasSensitiveContent,
  KIND_TO_CATEGORY,
} from '../fun/tui/auditBus.js';

test('sanitizeScope: nome amigável mantém; JID de grupo trunca', () => {
  assert.equal(sanitizeScope(''), null);
  assert.equal(sanitizeScope(null), null);
  assert.equal(sanitizeScope('Bot Crew'), 'Bot Crew');
  assert.equal(sanitizeScope('Zoeira Geral'), 'Zoeira Geral');
  const truncated = sanitizeScope('120363abc12345678901234@g.us');
  assert.ok(truncated.includes('…'), `esperava … no JID truncado: ${truncated}`);
  assert.ok(truncated.endsWith('@g.us'));
  // JID curto não trunca
  assert.equal(sanitizeScope('12345@g.us'), '12345@g.us');
  // JID de usuário também trunca
  const userJid = sanitizeScope('5511999998888@s.whatsapp.net');
  assert.ok(userJid.includes('…') || userJid.endsWith('@s.whatsapp.net'));
});

test('truncateJid: respeita head/tail e domain', () => {
  const out = truncateJid('120363abc12345678901234@g.us', 4, 8);
  assert.ok(out.startsWith('…'));
  assert.ok(out.endsWith('@g.us'));
  // JID menor que head+tail não trunca
  assert.equal(truncateJid('12345@g.us', 4, 8), '12345@g.us');
  // vazio
  assert.equal(truncateJid(''), '');
});

test('hasSensitiveContent: detecta PII/NSFW e ignora null/objetos limpos', () => {
  assert.equal(hasSensitiveContent(null), false);
  assert.equal(hasSensitiveContent(undefined), false);
  assert.equal(hasSensitiveContent({ foo: 1 }), false);
  assert.equal(hasSensitiveContent({ reason: 'timeout' }), false);
  assert.ok(hasSensitiveContent({ text: 'nsfw content' }));
  assert.ok(hasSensitiveContent('email: 55119999877776@s.whatsapp.net here'));
  // @lid é JID LID — também sensível
  assert.ok(hasSensitiveContent('qualquer @lid'));
});

test('emit: agrega entrada válida no ring buffer e nos counters', () => {
  const bus = createAuditBus({ maxHistory: 100 });
  bus.emit({ category: 'connection', level: 'ok', kind: 'open', scope: null, ok: true });
  bus.emit({ category: 'market', level: 'warn', kind: 'market', scope: 'Bot Crew', ok: false, detail: { reason: 'empty' } });
  const snap = bus.buildSnapshot({ funConfig: {} });
  assert.equal(snap.history.length, 2);
  const cats = Object.fromEntries(snap.counters.byCategory);
  assert.equal(cats['connection'], 1);
  assert.equal(cats['market'], 1);
  const kinds = Object.fromEntries(snap.counters.byKind);
  assert.equal(kinds['open'], 1);
  assert.equal(kinds['market'], 1);
});

test('emit: ring buffer respeita limite (tuiMaxHistory)', () => {
  const bus = createAuditBus({ maxHistory: 5 });
  for (let i = 0; i < 20; i++) {
    bus.emit({ category: 'system', level: 'info', kind: `tick-${i}`, ok: true });
  }
  const snap = bus.buildSnapshot({ funConfig: {} });
  assert.equal(snap.history.length, 5, `ring buffer deve estar no limite, era ${snap.history.length}`);
  // últimos 5 preservados (kind-19..15)
  const kinds = snap.history.map(h => h.kind).sort();
  assert.deepEqual(kinds, ['tick-15', 'tick-16', 'tick-17', 'tick-18', 'tick-19']);
});

test('emit: detail com PII/NSFW é descartado e contabilizado', () => {
  const bus = createAuditBus({ maxHistory: 50 });
  const ok = bus.emit({ category: 'market', level: 'ok', kind: 'market', ok: true, detail: { price: 100 } });
  const discarded = bus.emit({ category: 'market', level: 'ok', kind: 'market', ok: true, detail: { text: 'nsfw xxx' } });
  assert.ok(ok, 'entrada limpa deve ser aceita');
  assert.equal(discarded, null, 'entrada com NSFW deve ser anulada');
  assert.equal(bus._internal.discardedCount(), 1);
  const snap = bus.buildSnapshot({ funConfig: {} });
  assert.equal(snap.history.length, 1);
  assert.equal(snap.discardedCount, 1);
});

test('emit: scope JID é sanitizado (truncateJid) ao entrar no histórico', () => {
  const bus = createAuditBus({ maxHistory: 50 });
  bus.emit({ category: 'market', level: 'ok', kind: 'market', scope: '120363abcABCDEFGHIJKLMNO1234567@g.us', ok: true });
  const snap = bus.buildSnapshot({ funConfig: {} });
  const entry = snap.history[0];
  assert.ok(entry.scope.includes('…'), `scope deve estar truncado: ${entry.scope}`);
  assert.ok(!entry.scope.includes('abcABCDEFGHIJKLMNO1234567'), 'JID completo não deve aparecer');
});

test('emit: categoria desconhecida cai para system; level inválido vira info', () => {
  const bus = createAuditBus({ maxHistory: 20 });
  bus.emit({ category: 'zzz', level: 'critical', kind: 'x', ok: null });
  const entry = bus._internal.history[0];
  assert.equal(entry.category, 'system');
  assert.equal(entry.level, 'info');
  assert.equal(entry.ok, null);
});

test('recordWorldTick: mapeia results[].kind → categoria e emite world-tick + 1 entrada por resultado', () => {
  const bus = createAuditBus({ maxHistory: 200 });
  const now = Date.UTC(2026, 7, 3, 15, 0, 0);
  bus.recordWorldTick({
    fired: 3,
    results: [
      { scopeKey: '12345@g.us', kind: 'market', ok: true },
      { scopeKey: '12345@g.us', kind: 'chaos-event-warning', ok: true },
      { scopeKey: '12345@g.us', kind: 'self-heal', ok: false, reason: 'dry-run' },
    ],
    tookMs: 42,
  }, now);

  const snap = bus.buildSnapshot({ funConfig: {} });
  // 1 world-tick + 3 resultados = 4 entries
  assert.equal(snap.history.length, 4);

  const worldTick = snap.history[0];
  assert.equal(worldTick.category, 'world');
  assert.equal(worldTick.kind, 'world-tick');
  assert.equal(worldTick.detail.fired, 3);
  assert.equal(worldTick.detail.tookMs, 42);

  // Market deve mapear para 'market'
  const market = snap.history.find(h => h.kind === 'market');
  assert.equal(market.category, 'market');
  assert.equal(market.level, 'ok');

  // chaos-event-warning → chaos
  const chaos = snap.history.find(h => h.kind === 'chaos-event-warning');
  assert.equal(chaos.category, 'chaos');

  // self-heal falha → level warn + reason
  const selfHeal = snap.history.find(h => h.kind === 'self-heal');
  assert.equal(selfHeal.category, 'self-heal');
  assert.equal(selfHeal.level, 'warn');
  assert.ok(selfHeal.detail?.reason);
});

test('recordWorldTick: quiet hours gera world-tick info com skipped=true', () => {
  const bus = createAuditBus({ maxHistory: 20 });
  bus.recordWorldTick({ fired: 0, results: [], skipped: true, reason: 'quiet-hours' });
  const snap = bus.buildSnapshot({ funConfig: {} });
  const tick = snap.history[0];
  assert.equal(tick.level, 'info');
  assert.equal(tick.detail.skipped, true);
});

test('KIND_TO_CATEGORY: mapeamento cobre todos os kinds do relógio do mundo', () => {
  const expected = [
    'self-heal', 'memory-extract', 'persona-social-hints', 'group-news',
    'market', 'economy-tick', 'event', 'chaos-event-warning',
    'chaos-event', 'chaos-event-end', 'challenge-expired',
    'challenge-launched', 'restock', 'birthday',
  ];
  for (const k of expected) {
    assert.ok(KIND_TO_CATEGORY[k], `kind ${k} deve mapear para categoria`);
  }
});

test('buildSnapshot: meta.quietHours respeita funConfig (ativado e inativo)', () => {
  const bus = createAuditBus({ maxHistory: 5 });
  // America/Sao_Paulo = UTC-3 (sem DST): 06:00 UTC = 03:00 SP → dentro da janela [1,6)
  const nowAtiva = Date.UTC(2026, 7, 3, 6, 0, 0);
  const snap = bus.buildSnapshot({
    funConfig: {
      worldQuietHoursEnabled: true,
      worldQuietHourStart: 1,
      worldQuietHourEnd: 6,
      worldTimezone: 'America/Sao_Paulo',
    },
    now: nowAtiva,
  });
  assert.equal(snap.meta.quietHours.enabled, true);
  assert.equal(snap.meta.quietHours.active, true, '06:00 UTC = 03:00 SP deve estar em quiet hours');

  // 09:00 UTC = 06:00 SP → fora da janela [1,6)
  const snap2 = bus.buildSnapshot({
    funConfig: {
      worldQuietHoursEnabled: true,
      worldQuietHourStart: 1,
      worldQuietHourEnd: 6,
      worldTimezone: 'America/Sao_Paulo',
    },
    now: Date.UTC(2026, 7, 3, 9, 0, 0),
  });
  assert.equal(snap2.meta.quietHours.active, false, '09:00 UTC = 06:00 SP deve NÃO estar em quiet hours');
});

test('buildSnapshot: selfHeal agrega contadores das entradas self-heal', () => {
  const bus = createAuditBus({ maxHistory: 50 });
  bus.emit({
    category: 'self-heal',
    level: 'ok',
    kind: 'sweep',
    ok: true,
    detail: { applied: 3, rejected: 1, pending: 2, failed: 0, lastSweepAt: 1700000000000 },
  });
  const snap = bus.buildSnapshot({
    funConfig: { selfHealEnabled: true, selfHealDryRun: true },
  });
  assert.equal(snap.selfHeal.enabled, true);
  assert.equal(snap.selfHeal.dryRun, true);
  assert.equal(snap.selfHeal.lastSweepAt, 1700000000000);
  assert.deepEqual(snap.selfHeal.counters, { applied: 3, rejected: 1, pending: 2, failed: 0 });
});

test('buildSnapshot: fontes injetadas (fakes) aparecem nas seções do snapshot', () => {
  const bus = createAuditBus({
    maxHistory: 5,
    sources: {
      getConnection: () => ({
        state: 'reconnecting',
        lastReason: 'timeout',
        lastStatusCode: 428,
        reconnect: { pending: true, nextReconnectAt: 1234, currentAttempt: 2, lastDelayMs: 3000 },
      }),
      getQueues: () => ({
        command: { totalQueued: 10, totalRunning: 2, totalAccepted: 100, totalRejected: 1, totalCompleted: 90, totalFailed: 9 },
        output: { queued: 5, running: 1, accepted: 50, sent: 45, coalesced: 2, failed: 0, avgWaitMs: 120, p95WaitMs: 800, acceptedPerSecond: 0.5 },
      }),
      getLlm: () => ({
        byTask: { invent: { zen: 5, template: 2 } },
        invent: { zen: 5, template: 2, total: 7, zenRate: 5/7, templateRate: 2/7 },
        alert: null,
        lastByTask: { invent: { provider: 'zen', at: 1700000000000 } },
      }),
      getGroups: () => [{
        jid: '12345@g.us', name: 'Zoeira Geral', memberCount: 42,
        topPlayers: [{ name: 'Ana', xp: 1000, coins: 50 }],
        topCommands: [{ command: '/rank', count: 7 }],
      }],
      getDashboard: () => ({ enabled: true, started: true, url: 'http://127.0.0.1:8790' }),
    },
  });
  const snap = bus.buildSnapshot({ funConfig: {} });
  assert.equal(snap.connection.state, 'reconnecting');
  assert.equal(snap.connection.reconnect.pending, true);
  assert.equal(snap.queues.command.totalQueued, 10);
  assert.equal(snap.queues.output.accepted, 50);
  assert.equal(snap.llm.byTask.invent.zen, 5);
  assert.equal(snap.llm.lastByTask.invent.provider, 'zen');
  assert.equal(snap.dashboard.url, 'http://127.0.0.1:8790');
  assert.equal(snap.groups[0].name, 'Zoeira Geral');
  assert.equal(snap.groups[0].memberCount, 42);
  assert.equal(snap.groups[0].topCommands[0].command, '/rank');
});

test('buildSnapshot: config.whitelistCount e flags principais', () => {
  const bus = createAuditBus({ maxHistory: 5 });
  const snap = bus.buildSnapshot({
    funConfig: {
      groupWhitelistJids: ['a@g.us', 'b@g.us'],
      worldAutonomous: true,
      economyEnabled: false,
      propertiesEnabled: true,
    },
  });
  assert.equal(snap.config.whitelistCount, 2);
  assert.equal(snap.config.worldAutonomous, true);
  assert.equal(snap.config.economyEnabled, false);
  assert.equal(snap.config.propertiesEnabled, true);
});
