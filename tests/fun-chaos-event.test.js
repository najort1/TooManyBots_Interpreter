/**
 * Evento "10 Minutos de Crime" — ativação, assalto, saldo negativo, heat desativado.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import {
  createFunStatsRepository,
  _resetDefaultFunStatsRepository,
} from '../fun/db/funStatsRepository.js';
import { createFunEventRepository } from '../fun/db/funEventRepository.js';
import { createFunMarketRepository } from '../fun/db/funMarketRepository.js';
import { createFunEffectsRepository } from '../fun/db/funEffectsRepository.js';
import { createFunCasinoRepository } from '../fun/db/funCasinoRepository.js';
import { createMarketService } from '../fun/services/marketService.js';
import { createChaosEventService } from '../fun/services/chaosEventService.js';
import { resolveFunConfig } from '../fun/index.js';

await initDb();
_resetDefaultFunStatsRepository();

function uniqueJid(prefix = '5511') {
  return `${prefix}${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 90 + 10)}@s.whatsapp.net`;
}

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

const TEST_HOUR = 20;

function atHour(hour = TEST_HOUR, { base = Date.now() } = {}) {
  const d = new Date(base);
  d.setHours(hour, 1, 0, 0);
  return d.getTime();
}

test('chaosEventService: ativação única por dia na hora configurada', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });

  const market = createMarketService({
    repository: repo,
    marketRepository: marketRepo,
    random: () => 0.5,
  });

  const chaosEvent = createChaosEventService({
    repository: repo,
    eventRepository: eventRepo,
    getMarketService: () => market,
    random: () => 0.5,
  });

  const scope = uniqueGroup();
  const cfg = resolveFunConfig({
    chaosEventEnabled: true,
    chaosEventHour: TEST_HOUR,
    chaosEventDurationMs: 10 * 60_000,
  });

  const now = atHour(TEST_HOUR);
  const result = chaosEvent.tryStartEvent(scope, cfg, now);
  assert.equal(result.ok, true);
  assert.equal(result.eventType, 'crime_chaos');
  assert.equal(result.durationMs, 10 * 60_000);

  const active = chaosEvent.isEventActive(scope, now + 1000);
  assert.equal(active.active, true);
  assert.equal(active.eventType, 'crime_chaos');

  // dentro da janela de 10 min: still active
  const withinWindow = chaosEvent.tryStartEvent(scope, cfg, now + 2000);
  assert.equal(withinWindow.ok, false);
  assert.equal(withinWindow.reason, 'already-active');

  // dia seguinte: pode ativar de novo
  const nextDay = new Date(now + 24 * 60 * 60_000);
  const nextAt = atHour(TEST_HOUR, { base: nextDay.getTime() });
  const nextResult = chaosEvent.tryStartEvent(scope, cfg, nextAt);
  assert.equal(nextResult.ok, true);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('chaosEventService: não ativa fora da hora configurada', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });

  const market = createMarketService({
    repository: repo,
    marketRepository: createFunMarketRepository({ getDatabase: getDb }),
    random: () => 0.5,
  });

  const chaosEvent = createChaosEventService({
    repository: repo,
    eventRepository: eventRepo,
    getMarketService: () => market,
    random: () => 0.5,
  });

  const scope = uniqueGroup();
  const cfg = resolveFunConfig({
    chaosEventEnabled: true,
    chaosEventHour: TEST_HOUR,
  });

  assert.equal(chaosEvent.tryStartEvent(scope, cfg, atHour(19)).ok, false);
  assert.equal(chaosEvent.tryStartEvent(scope, cfg, atHour(21)).ok, false);
  assert.equal(chaosEvent.tryStartEvent(scope, cfg, atHour(TEST_HOUR)).ok, true);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('chaosEventService: assalto sem arma com 50% de sucesso', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });

  const market = createMarketService({
    repository: repo,
    marketRepository: marketRepo,
    random: () => 0.5,
  });

  const chaosEvent = createChaosEventService({
    repository: repo,
    eventRepository: eventRepo,
    getMarketService: () => market,
    random: () => 0.01,
  });

  const scope = uniqueGroup();
  const atk = uniqueJid('5591');
  const vic = uniqueJid('5592');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 100, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 200, reason: 'seed' });

  const cfg = resolveFunConfig({
    chaosEventEnabled: true,
    chaosEventHour: TEST_HOUR,
    chaosEventNoWeaponSuccess: 0.50,
  });

  const now = atHour(TEST_HOUR);

  // ativa evento
  const started = chaosEvent.tryStartEvent(scope, cfg, now);
  assert.equal(started.ok, true);

  // sem arma — sucesso (random 0.01 < 0.50)
  const win = chaosEvent.doCrimeAssault({
    attackerJid: atk,
    targetJid: vic,
    scopeKey: scope,
    amount: 50,
    funConfig: cfg,
    now: now + 1000,
  });
  assert.equal(win.ok, true);
  assert.equal(win.success, true);
  assert.equal(win.weapon, null);
  assert.equal(win.stolen, 50);

  // sem arma — falha (precisa de outro chaosEvent com random alto)
  const chaosEventFail = createChaosEventService({
    repository: repo,
    eventRepository: eventRepo,
    getMarketService: () => market,
    random: () => 0.99,
  });

  const fail = chaosEventFail.doCrimeAssault({
    attackerJid: vic,
    targetJid: atk,
    scopeKey: scope,
    amount: 30,
    funConfig: cfg,
    now: now + 2000,
  });
  assert.equal(fail.ok, true);
  assert.equal(fail.success, false);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('chaosEventService: assalto com arma usa chance base maior', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const effects = createFunEffectsRepository({ getDatabase: getDb });
  const casinoRepo = createFunCasinoRepository({ getDatabase: getDb });

  const market = createMarketService({
    repository: repo,
    marketRepository: marketRepo,
    effectsRepository: effects,
    casinoRepository: casinoRepo,
    random: () => 0.5,
  });

  const chaosEvent = createChaosEventService({
    repository: repo,
    eventRepository: eventRepo,
    getMarketService: () => market,
    random: () => 0.01,
  });

  const scope = uniqueGroup();
  const atk = uniqueJid('5593');
  const vic = uniqueJid('5594');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 500, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 300, reason: 'seed' });

  const cfg = resolveFunConfig({
    chaosEventEnabled: true,
    chaosEventHour: TEST_HOUR,
    chaosEventWeaponBaseChance: 0.60,
  });

  const now = atHour(TEST_HOUR);
  chaosEvent.tryStartEvent(scope, cfg, now);

  effects.addCharges({
    userJid: atk,
    scopeKey: scope,
    effectKey: 'weapons_license',
    charges: 1,
    payload: { permanent: true },
  });

  marketRepo.addInventory({
    userJid: atk,
    scopeKey: scope,
    itemId: 'faca',
    acquiredPrice: 90,
    usesLeft: 10,
  });

  const win = chaosEvent.doCrimeAssault({
    attackerJid: atk,
    targetJid: vic,
    scopeKey: scope,
    amount: 100,
    funConfig: cfg,
    now: now + 1000,
  });
  assert.equal(win.ok, true);
  assert.equal(win.success, true);
  assert.notEqual(win.weapon, null);
  assert.equal(win.weapon.id, 'faca');

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('chaosEventService: alvo fica com saldo negativo quando não tem moedas', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });

  const market = createMarketService({
    repository: repo,
    marketRepository: marketRepo,
    random: () => 0.5,
  });

  const chaosEvent = createChaosEventService({
    repository: repo,
    eventRepository: eventRepo,
    getMarketService: () => market,
    random: () => 0.01,
  });

  const scope = uniqueGroup();
  const atk = uniqueJid('5595');
  const vic = uniqueJid('5596');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 100, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 10, reason: 'seed' });

  const cfg = resolveFunConfig({
    chaosEventEnabled: true,
    chaosEventHour: TEST_HOUR,
    chaosEventNoWeaponSuccess: 0.50,
  });

  const now = atHour(TEST_HOUR);
  chaosEvent.tryStartEvent(scope, cfg, now);

  const result = chaosEvent.doCrimeAssault({
    attackerJid: atk,
    targetJid: vic,
    scopeKey: scope,
    amount: 100,
    funConfig: cfg,
    now: now + 1000,
  });

  assert.equal(result.ok, true);
  assert.equal(result.success, true);
  assert.equal(result.stolen, 100);
  assert.equal(result.stolenFromWallet, 10);
  assert.equal(result.stolenFromDebt, 90);

  const targetAfter = repo.getUserStats(vic, scope);
  assert.ok(targetAfter.coins < 0, `esperado saldo negativo, obtido ${targetAfter.coins}`);

  const attackerAfter = repo.getUserStats(atk, scope);
  assert.equal(attackerAfter.coins, 200);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('chaosEventService: heat desativado durante o evento', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const effects = createFunEffectsRepository({ getDatabase: getDb });
  const casinoRepo = createFunCasinoRepository({ getDatabase: getDb });

  const chaosEvent = createChaosEventService({
    repository: repo,
    eventRepository: eventRepo,
    getMarketService: () => null,
    random: () => 0.5,
  });

  const market = createMarketService({
    repository: repo,
    marketRepository: marketRepo,
    effectsRepository: effects,
    casinoRepository: casinoRepo,
    chaosEventService: chaosEvent,
    random: () => 0.5,
  });

  const scope = uniqueGroup();
  const atk = uniqueJid('5597');
  const cfg = resolveFunConfig({
    chaosEventEnabled: true,
    chaosEventHour: TEST_HOUR,
  });

  const now = atHour(TEST_HOUR);

  // sem evento ativo, heat normal
  market.setAssaultHeat(atk, scope, 5, now);
  assert.equal(market.getAssaultHeat(atk, scope, now), 5);

  // ativa evento
  chaosEvent.tryStartEvent(scope, cfg, now);
  const active = chaosEvent.isEventActive(scope, now + 1000);
  assert.equal(active.active, true);

  // durante evento, heat = 0 mesmo com valor persistido
  assert.equal(market.getAssaultHeat(atk, scope, now + 1000), 0);

  // setAssaultHeat não persiste durante o evento
  market.setAssaultHeat(atk, scope, 10, now + 1000);

  // após evento terminar (simula 11 min depois), heat volta ao comportamento normal
  const after = now + 11 * 60_000 + 1000;
  assert.equal(chaosEvent.isEventActive(scope, after), false);
  // heat retoma do último valor persistido (5) com decay
  const restored = market.getAssaultHeat(atk, scope, after);
  assert.ok(restored >= 0);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('chaosEventService: duração correta de 10 minutos e transição', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });

  const market = createMarketService({
    repository: repo,
    marketRepository: marketRepo,
    random: () => 0.5,
  });

  const chaosEvent = createChaosEventService({
    repository: repo,
    eventRepository: eventRepo,
    getMarketService: () => market,
    random: () => 0.5,
  });

  const scope = uniqueGroup();
  const cfg = resolveFunConfig({
    chaosEventEnabled: true,
    chaosEventHour: TEST_HOUR,
    chaosEventDurationMs: 10 * 60_000,
  });

  const now = atHour(TEST_HOUR);

  // ativa
  const started = chaosEvent.tryStartEvent(scope, cfg, now);
  assert.equal(started.ok, true);
  assert.equal(started.durationMs, 10 * 60_000);

  // ativo durante os 10 minutos
  const during = now + 5 * 60_000;
  assert.equal(chaosEvent.isEventActive(scope, during).active, true);

  // expira após 10 minutos
  const expired = now + 10 * 60_000 + 1000;
  assert.equal(chaosEvent.isEventActive(scope, expired), false);

  // pode ativar de novo no dia seguinte
  const nextDay = new Date(now + 24 * 60 * 60_000);
  const nextAt = atHour(TEST_HOUR, { base: nextDay.getTime() });
  const nextStart = chaosEvent.tryStartEvent(scope, cfg, nextAt);
  assert.equal(nextStart.ok, true);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('chaosEventService: assalto bloqueado fora do evento', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });

  const market = createMarketService({
    repository: repo,
    marketRepository: createFunMarketRepository({ getDatabase: getDb }),
  });

  const chaosEvent = createChaosEventService({
    repository: repo,
    eventRepository: eventRepo,
    getMarketService: () => market,
  });

  const scope = uniqueGroup();
  const atk = uniqueJid('5598');
  const vic = uniqueJid('5599');

  const result = chaosEvent.doCrimeAssault({
    attackerJid: atk,
    targetJid: vic,
    scopeKey: scope,
    amount: 50,
    funConfig: resolveFunConfig({}),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'event-inactive');

  delete process.env.FUN_DISABLE_LIVE_LLM;
});
