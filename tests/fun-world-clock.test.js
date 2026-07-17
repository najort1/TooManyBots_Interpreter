/**
 * Relógio do mundo — eventos sem depender de mensagem de usuário.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import {
  createFunStatsRepository,
  _resetDefaultFunStatsRepository,
} from '../fun/db/funStatsRepository.js';
import { createFunMarketRepository } from '../fun/db/funMarketRepository.js';
import { createFunEventRepository } from '../fun/db/funEventRepository.js';
import { createMarketService } from '../fun/services/marketService.js';
import { createEventService } from '../fun/services/eventService.js';
import { createFunModule, resolveFunConfig } from '../fun/index.js';
import { DEFAULT_FUN_CONFIG } from '../fun/constants.js';
import { isWorldQuietHours, getLocalHour } from '../fun/utils/worldQuietHours.js';

await initDb();
_resetDefaultFunStatsRepository();

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

/** Timestamp com hora local fixa em America/Sao_Paulo (aprox. via UTC-3 fixo). */
function atSaoPauloHour(hour, { base = Date.UTC(2026, 5, 15, 12, 0, 0) } = {}) {
  // SP standard: UTC-3 (sem DST desde 2019)
  const utcHour = (hour + 3) % 24;
  const d = new Date(base);
  d.setUTCHours(utcHour, 30, 0, 0);
  return d.getTime();
}

test('defaults: worldAutonomous + worldTickMs + eventTickChance', () => {
  assert.equal(DEFAULT_FUN_CONFIG.worldAutonomous, true);
  assert.ok(DEFAULT_FUN_CONFIG.worldTickMs >= 15_000);
  assert.ok(DEFAULT_FUN_CONFIG.eventTickChance > DEFAULT_FUN_CONFIG.eventAutoSpawnChance);
  const cfg = resolveFunConfig({});
  assert.equal(cfg.worldAutonomous, true);
  assert.equal(cfg.worldQuietHoursEnabled, true);
  assert.equal(cfg.worldQuietHourStart, 1);
  assert.equal(cfg.worldQuietHourEnd, 6);
});

test('quiet hours: 1h–6h bloqueia; 0h e 6h liberam', () => {
  const cfg = resolveFunConfig({
    worldQuietHoursEnabled: true,
    worldQuietHourStart: 1,
    worldQuietHourEnd: 6,
    worldTimezone: 'America/Sao_Paulo',
  });
  assert.equal(isWorldQuietHours(cfg, atSaoPauloHour(1)), true);
  assert.equal(isWorldQuietHours(cfg, atSaoPauloHour(3)), true);
  assert.equal(isWorldQuietHours(cfg, atSaoPauloHour(5)), true);
  assert.equal(isWorldQuietHours(cfg, atSaoPauloHour(6)), false);
  assert.equal(isWorldQuietHours(cfg, atSaoPauloHour(0)), false);
  assert.equal(isWorldQuietHours(cfg, atSaoPauloHour(12)), false);
  assert.equal(isWorldQuietHours({ worldQuietHoursEnabled: false }, atSaoPauloHour(3)), false);
  assert.ok(Number.isFinite(getLocalHour(Date.now(), 'America/Sao_Paulo')));
});

test('tryAutoMarketEvent autonomous: dispara quando nextEventAt venceu (sem soft-skip)', async () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const scope = uniqueGroup();
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const market = createMarketService({
    repository: repo,
    marketRepository: marketRepo,
    random: () => 0.99, // soft-skip ganharia no modo msg
  });

  const now = Date.now();
  marketRepo.ensurePrices(scope, now);
  marketRepo.setMeta(scope, {
    lastEventAt: now - 60_000,
    nextEventAt: now - 1000, // já passou
    lastRestockAt: now,
    now,
  });

  const soft = await market.tryAutoMarketEvent({
    scopeKey: scope,
    funConfig: resolveFunConfig({ marketEnabled: true }),
    now,
    autonomous: false,
  });
  // random 0.99 > 0.22 → soft-skip no modo mensagem
  assert.equal(soft.ok, false);
  assert.equal(soft.reason, 'soft-skip');

  const auto = await market.tryAutoMarketEvent({
    scopeKey: scope,
    funConfig: resolveFunConfig({ marketEnabled: true }),
    now: now + 10,
    autonomous: true,
  });
  assert.equal(auto.ok, true);
  assert.ok(auto.event?.title);
});

test('tryAutoSpawn tick usa eventTickChance', () => {
  const scope = uniqueGroup();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  // random baixo sempre passa em chance 0.12 e falha em 0.028 se random = 0.05
  const events = createEventService({
    eventRepository: eventRepo,
    random: () => 0.05,
  });
  const cfg = resolveFunConfig({
    eventAutoSpawn: true,
    eventAutoSpawnChance: 0.028,
    eventTickChance: 0.12,
    eventCooldownMs: 0,
  });

  const msgPath = events.tryAutoSpawn({
    scopeKey: scope,
    funConfig: cfg,
    now: Date.now(),
    tick: false,
  });
  assert.equal(msgPath.ok, false);
  assert.equal(msgPath.reason, 'no-roll');

  const tickPath = events.tryAutoSpawn({
    scopeKey: `${scope}b`,
    funConfig: cfg,
    now: Date.now(),
    tick: true,
  });
  assert.equal(tickPath.ok, true);
});

test('tickWorldEvents anuncia mercado no grupo sem mensagem humana', async () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const scope = uniqueGroup();
  const posts = [];

  const mod = createFunModule({
    getConfig: () =>
      resolveFunConfig({
        enabled: true,
        worldAutonomous: true,
        worldQuietHoursEnabled: false, // teste de anúncio fora da madrugada
        groupWhitelistJids: [scope],
        requireGroupWhitelist: true,
        marketEnabled: true,
        eventAutoSpawn: true,
        eventTickChance: 0, // só mercado neste teste
        eventAutoSpawnChance: 0,
      }),
    sendText: async (sock, jid, text) => {
      posts.push({ jid, text: String(text) });
    },
  });
  mod.init();

  const marketRepo = mod._services.marketRepository;
  const now = Date.now();
  marketRepo.ensurePrices(scope, now);
  marketRepo.setMeta(scope, {
    lastEventAt: now - 90_000,
    nextEventAt: now - 500,
    lastRestockAt: now,
    now,
  });

  const result = await mod.tickWorldEvents({
    sock: {},
    sendText: async (sock, jid, text) => {
      posts.push({ jid, text: String(text) });
    },
    now: now + 1000,
  });

  assert.equal(result.ok, true);
  assert.ok(result.fired >= 1);
  assert.ok(posts.some((p) => p.jid === scope && /Mercado de rua|mercado/i.test(p.text)));
});

test('tickWorldEvents respeita worldAutonomous=false', async () => {
  const mod = createFunModule({
    getConfig: () =>
      resolveFunConfig({
        worldAutonomous: false,
        groupWhitelistJids: [uniqueGroup()],
      }),
  });
  mod.init();
  const r = await mod.tickWorldEvents({ sock: {}, sendText: async () => {} });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'world-autonomous-off');
});

test('tickWorldEvents: worldEventsEnabled=false bloqueia mercado; happy hour ainda anuncia', async () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const scope = uniqueGroup();
  const posts = [];

  const mod = createFunModule({
    getConfig: () =>
      resolveFunConfig({
        enabled: true,
        worldAutonomous: true,
        worldQuietHoursEnabled: false,
        groupWhitelistJids: [scope],
        requireGroupWhitelist: true,
        marketEnabled: true,
        eventAutoSpawn: true,
        eventTickChance: 1,
        eventAutoSpawnChance: 1,
        eventCooldownMs: 0,
      }),
    sendText: async (sock, jid, text) => {
      posts.push({ jid, text: String(text) });
    },
  });
  mod.init();

  mod._services.groupRepository.upsertGroupSettings({
    groupJid: scope,
    worldEventsEnabled: false,
  });

  const marketRepo = mod._services.marketRepository;
  const now = Date.now();
  marketRepo.ensurePrices(scope, now);
  marketRepo.setMeta(scope, {
    lastEventAt: now - 90_000,
    nextEventAt: now - 500,
    lastRestockAt: now,
    now,
  });

  const result = await mod.tickWorldEvents({
    sock: {},
    sendText: async (sock, jid, text) => {
      posts.push({ jid, text: String(text) });
    },
    now: now + 1000,
  });

  assert.equal(result.ok, true);
  assert.ok(
    result.results.some(
      (r) => r.scopeKey === scope && r.kind === 'market' && r.reason === 'world-events-off'
    ),
    'mercado auto bloqueado'
  );
  assert.ok(
    result.results.some(
      (r) => r.scopeKey === scope && r.kind === 'event' && r.ok && r.eventType === 'casino_happy'
    ),
    'happy hour deve disparar com world events off'
  );
  assert.ok(
    posts.some((p) => p.jid === scope && /HAPPY HOUR/i.test(p.text)),
    'anúncio de happy hour no chat'
  );
  assert.ok(
    !posts.some((p) => p.jid === scope && /Mercado de rua|TRÉGUA/i.test(p.text)),
    'sem anúncio de mercado/trégua'
  );
});

test('tickWorldEvents bloqueia na madrugada (1h–6h)', async () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const scope = uniqueGroup();
  const posts = [];
  const mod = createFunModule({
    getConfig: () =>
      resolveFunConfig({
        enabled: true,
        worldAutonomous: true,
        worldQuietHoursEnabled: true,
        worldQuietHourStart: 1,
        worldQuietHourEnd: 6,
        worldTimezone: 'America/Sao_Paulo',
        groupWhitelistJids: [scope],
        requireGroupWhitelist: true,
        marketEnabled: true,
        eventAutoSpawn: true,
        eventTickChance: 1,
        eventAutoSpawnChance: 1,
        eventCooldownMs: 0,
      }),
    sendText: async (sock, jid, text) => {
      posts.push({ jid, text: String(text) });
    },
  });
  mod.init();

  const marketRepo = mod._services.marketRepository;
  const night = atSaoPauloHour(3);
  marketRepo.ensurePrices(scope, night);
  marketRepo.setMeta(scope, {
    lastEventAt: night - 90_000,
    nextEventAt: night - 500,
    lastRestockAt: night,
    now: night,
  });

  const r = await mod.tickWorldEvents({
    sock: {},
    sendText: async (sock, jid, text) => {
      posts.push({ jid, text: String(text) });
    },
    now: night,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'quiet-hours');
  assert.equal(posts.length, 0);
  delete process.env.FUN_DISABLE_LIVE_LLM;
});
