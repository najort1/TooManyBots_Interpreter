/**
 * Purga — evento diário de 10 minutos: ativação, assalto, limites, leaderboard, anúncios.
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

test('ativação única por dia na hora configurada', () => {
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
  assert.equal(result.label, 'PURGA');

  const active = chaosEvent.isEventActive(scope, now + 1000);
  assert.equal(active.active, true);

  const dentroJanela = chaosEvent.tryStartEvent(scope, cfg, now + 2000);
  assert.equal(dentroJanela.ok, false);
  assert.equal(dentroJanela.reason, 'already-active');

  const nextDay = new Date(now + 24 * 60 * 60_000);
  const nextAt = atHour(TEST_HOUR, { base: nextDay.getTime() });
  assert.equal(chaosEvent.tryStartEvent(scope, cfg, nextAt).ok, true);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('não ativa fora da hora configurada', () => {
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
  const cfg = resolveFunConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR });
  assert.equal(chaosEvent.tryStartEvent(scope, cfg, atHour(19)).ok, false);
  assert.equal(chaosEvent.tryStartEvent(scope, cfg, atHour(21)).ok, false);
  assert.equal(chaosEvent.tryStartEvent(scope, cfg, atHour(TEST_HOUR)).ok, true);
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('assalto sem arma com 50% de sucesso', () => {
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
    repository: repo, eventRepository: eventRepo,
    getMarketService: () => market,
    random: () => 0.01,
  });
  const scope = uniqueGroup();
  const atk = uniqueJid('5591');
  const vic = uniqueJid('5592');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 100, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 200, reason: 'seed' });
  const cfg = resolveFunConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR, chaosEventNoWeaponSuccess: 0.50 });
  const now = atHour(TEST_HOUR);
  chaosEvent.tryStartEvent(scope, cfg, now);

  const win = chaosEvent.doCrimeAssault({
    attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 50, funConfig: cfg, now: now + 1000,
  });
  assert.equal(win.ok, true);
  assert.equal(win.success, true);
  assert.equal(win.weapon, null);
  assert.equal(win.stolen, 50);

  const chaosEventFail = createChaosEventService({
    repository: repo, eventRepository: eventRepo,
    getMarketService: () => market,
    random: () => 0.99,
  });
  const fail = chaosEventFail.doCrimeAssault({
    attackerJid: vic, targetJid: atk, scopeKey: scope, amount: 30, funConfig: cfg, now: now + 2000,
  });
  assert.equal(fail.ok, true);
  assert.equal(fail.success, false);
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('assalto com arma usa chance base maior', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const effects = createFunEffectsRepository({ getDatabase: getDb });
  const casinoRepo = createFunCasinoRepository({ getDatabase: getDb });
  const market = createMarketService({
    repository: repo, marketRepository: marketRepo,
    effectsRepository: effects, casinoRepository: casinoRepo,
    random: () => 0.5,
  });
  const chaosEvent = createChaosEventService({
    repository: repo, eventRepository: eventRepo,
    getMarketService: () => market,
    random: () => 0.01,
  });
  const scope = uniqueGroup();
  const atk = uniqueJid('5593');
  const vic = uniqueJid('5594');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 500, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 300, reason: 'seed' });
  const cfg = resolveFunConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR, chaosEventWeaponBaseChance: 0.60 });
  const now = atHour(TEST_HOUR);
  chaosEvent.tryStartEvent(scope, cfg, now);
  effects.addCharges({ userJid: atk, scopeKey: scope, effectKey: 'weapons_license', charges: 1, payload: { permanent: true } });
  marketRepo.addInventory({ userJid: atk, scopeKey: scope, itemId: 'faca', acquiredPrice: 90, usesLeft: 10 });

  const win = chaosEvent.doCrimeAssault({
    attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 100, funConfig: cfg, now: now + 1000,
  });
  assert.equal(win.ok, true);
  assert.equal(win.success, true);
  assert.notEqual(win.weapon, null);
  assert.equal(win.weapon.id, 'faca');
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('saldo negativo limitado pelo maxDebt', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const market = createMarketService({
    repository: repo, marketRepository: marketRepo,
    random: () => 0.5,
  });
  const chaosEvent = createChaosEventService({
    repository: repo, eventRepository: eventRepo,
    getMarketService: () => market,
    random: () => 0.01,
  });
  const scope = uniqueGroup();
  const atk = uniqueJid('5595');
  const vic = uniqueJid('5596');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 100, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 10, reason: 'seed' });
  const cfg = resolveFunConfig({
    chaosEventEnabled: true, chaosEventHour: TEST_HOUR,
    chaosEventMaxDebt: 100, chaosEventMaxStealAmount: 500,
    chaosEventNoWeaponSuccess: 0.50,
  });
  const now = atHour(TEST_HOUR);
  chaosEvent.tryStartEvent(scope, cfg, now);

  // tenta roubar 1000, mas maxDebt=100 e alvo tem 10
  const result = chaosEvent.doCrimeAssault({
    attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 1000, funConfig: cfg, now: now + 1000,
  });
  assert.equal(result.ok, true);
  assert.equal(result.success, true);
  assert.equal(result.stolenFromWallet, 10);
  assert.equal(result.stolenFromDebt, 100);
  assert.equal(result.stolen, 110);

  const targetAfter = repo.getUserStats(vic, scope);
  assert.equal(targetAfter.coins, -100);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('valor de assalto limitado pelo maxStealAmount', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const market = createMarketService({
    repository: repo, marketRepository: marketRepo,
    random: () => 0.5,
  });
  const chaosEvent = createChaosEventService({
    repository: repo, eventRepository: eventRepo,
    getMarketService: () => market,
    random: () => 0.01,
  });
  const scope = uniqueGroup();
  const atk = uniqueJid('5597');
  const vic = uniqueJid('5598');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 100, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 500_000, reason: 'seed' });
  const cfg = resolveFunConfig({
    chaosEventEnabled: true, chaosEventHour: TEST_HOUR,
    chaosEventMaxStealAmount: 100, chaosEventNoWeaponSuccess: 0.50,
  });
  const now = atHour(TEST_HOUR);
  chaosEvent.tryStartEvent(scope, cfg, now);

  const result = chaosEvent.doCrimeAssault({
    attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 999_999, funConfig: cfg, now: now + 1000,
  });
  assert.equal(result.ok, true);
  assert.equal(result.success, true);
  assert.equal(result.stolen, 100);
  assert.equal(result.stolenFromWallet, 100);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('heat desativado durante o evento', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const effects = createFunEffectsRepository({ getDatabase: getDb });
  const casinoRepo = createFunCasinoRepository({ getDatabase: getDb });
  const chaosEvent = createChaosEventService({
    repository: repo, eventRepository: eventRepo,
    getMarketService: () => null,
    random: () => 0.5,
  });
  const market = createMarketService({
    repository: repo, marketRepository: marketRepo,
    effectsRepository: effects, casinoRepository: casinoRepo,
    chaosEventService: chaosEvent,
    random: () => 0.5,
  });
  const scope = uniqueGroup();
  const atk = uniqueJid('5599');
  const cfg = resolveFunConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR });
  const now = atHour(TEST_HOUR);

  market.setAssaultHeat(atk, scope, 5, now);
  assert.equal(market.getAssaultHeat(atk, scope, now), 5);

  chaosEvent.tryStartEvent(scope, cfg, now);
  assert.equal(chaosEvent.isEventActive(scope, now + 1000).active, true);
  assert.equal(market.getAssaultHeat(atk, scope, now + 1000), 0);
  market.setAssaultHeat(atk, scope, 10, now + 1000);

  const after = now + 11 * 60_000 + 1000;
  assert.equal(chaosEvent.isEventActive(scope, after), false);
  assert.ok(market.getAssaultHeat(atk, scope, after) >= 0);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('duração correta de 10 minutos e transição', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const market = createMarketService({
    repository: repo, marketRepository: marketRepo,
    random: () => 0.5,
  });
  const chaosEvent = createChaosEventService({
    repository: repo, eventRepository: eventRepo,
    getMarketService: () => market,
    random: () => 0.5,
  });
  const scope = uniqueGroup();
  const cfg = resolveFunConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR, chaosEventDurationMs: 10 * 60_000 });
  const now = atHour(TEST_HOUR);

  const started = chaosEvent.tryStartEvent(scope, cfg, now);
  assert.equal(started.ok, true);
  assert.equal(started.durationMs, 10 * 60_000);

  const during = now + 5 * 60_000;
  assert.equal(chaosEvent.isEventActive(scope, during).active, true);

  const expired = now + 10 * 60_000 + 1000;
  assert.equal(chaosEvent.isEventActive(scope, expired), false);

  const nextDay = new Date(now + 24 * 60 * 60_000);
  const nextAt = atHour(TEST_HOUR, { base: nextDay.getTime() });
  assert.equal(chaosEvent.tryStartEvent(scope, cfg, nextAt).ok, true);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('assalto bloqueado fora do evento', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const market = createMarketService({
    repository: repo,
    marketRepository: createFunMarketRepository({ getDatabase: getDb }),
  });
  const chaosEvent = createChaosEventService({
    repository: repo, eventRepository: eventRepo,
    getMarketService: () => market,
  });
  const scope = uniqueGroup();
  const result = chaosEvent.doCrimeAssault({
    attackerJid: uniqueJid('5598'), targetJid: uniqueJid('5599'),
    scopeKey: scope, amount: 50, funConfig: resolveFunConfig({}),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'event-inactive');
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('leaderboard registra maiores criminosos e vítimas', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const market = createMarketService({
    repository: repo, marketRepository: marketRepo,
    random: () => 0.5,
  });
  const chaosEvent = createChaosEventService({
    repository: repo, eventRepository: eventRepo,
    getMarketService: () => market,
    random: () => 0.01,
  });
  const scope = uniqueGroup();
  const a1 = uniqueJid('5501');
  const a2 = uniqueJid('5502');
  const vic1 = uniqueJid('5503');
  const vic2 = uniqueJid('5504');
  repo.addCoins({ userJid: a1, scopeKey: scope, amount: 100, reason: 'seed' });
  repo.addCoins({ userJid: a2, scopeKey: scope, amount: 100, reason: 'seed' });
  repo.addCoins({ userJid: vic1, scopeKey: scope, amount: 1000, reason: 'seed' });
  repo.addCoins({ userJid: vic2, scopeKey: scope, amount: 2000, reason: 'seed' });

  const cfg = resolveFunConfig({
    chaosEventEnabled: true, chaosEventHour: TEST_HOUR,
    chaosEventNoWeaponSuccess: 0.50, chaosEventMaxStealAmount: 500,
  });
  const now = atHour(TEST_HOUR);
  chaosEvent.tryStartEvent(scope, cfg, now);

  chaosEvent.doCrimeAssault({ attackerJid: a1, targetJid: vic1, scopeKey: scope, amount: 100, funConfig: cfg, now: now + 1000 });
  chaosEvent.doCrimeAssault({ attackerJid: a1, targetJid: vic2, scopeKey: scope, amount: 300, funConfig: cfg, now: now + 2000 });
  chaosEvent.doCrimeAssault({ attackerJid: a2, targetJid: vic1, scopeKey: scope, amount: 50, funConfig: cfg, now: now + 3000 });

  const lb = chaosEvent.getEventLeaderboard(scope);
  assert.equal(lb.attackers.length, 2);
  assert.equal(lb.attackers[0].jid, a1);
  assert.equal(lb.attackers[0].total, 400);
  assert.equal(lb.attackers[1].total, 50);

  assert.equal(lb.victims.length, 2);
  assert.equal(lb.victims[0].total, 300);
  assert.equal(lb.victims[1].total, 150);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('anúncios: início e warning com tempo restante', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const market = createMarketService({
    repository: repo, marketRepository: marketRepo,
    random: () => 0.5,
  });
  const chaosEvent = createChaosEventService({
    repository: repo, eventRepository: eventRepo,
    getMarketService: () => market,
    random: () => 0.5,
  });
  const scope = uniqueGroup();
  const cfg = resolveFunConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR, chaosEventDurationMs: 10 * 60_000 });
  const now = atHour(TEST_HOUR);

  const started = chaosEvent.tryStartEvent(scope, cfg, now);
  const startMsg = chaosEvent.formatStartAnnouncement(started);
  assert.match(startMsg, /PURGA/);
  assert.match(startMsg, /ESTADO DE EMERGÊNCIA/);
  assert.match(startMsg, /10 minutos/);

  // warning dispara perto dos 2 min (~120s restantes)
  const nearEnd = now + 8 * 60_000 + 30_000;
  assert.equal(chaosEvent.shouldSendWarning(scope, nearEnd), true);
  const warnMsg = chaosEvent.formatWarningAnnouncement(chaosEvent.getTimeRemaining(scope, nearEnd));
  assert.match(warnMsg, /AVISO/);
  assert.match(warnMsg, /2 minutos/);

  // não dispara de novo
  assert.equal(chaosEvent.shouldSendWarning(scope, nearEnd + 1000), false);
  chaosEvent.resetWarning(scope);

  // end announcement
  const endMsg = chaosEvent.formatEndAnnouncement(scope, (j) => j.split('@')[0]);
  assert.match(endMsg, /FIM DA PURGA/);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('addCoinsAllowNegative retorna valor correto para saldo negativo', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const scope = uniqueGroup();
  const u = uniqueJid('5510');
  repo.addCoins({ userJid: u, scopeKey: scope, amount: 50, reason: 'seed' });

  const result = repo.addCoinsAllowNegative({
    userJid: u, scopeKey: scope, amount: -200, reason: 'test-debt',
  });
  assert.equal(result.ok, true);
  assert.equal(result.coins, -150);

  const stats = repo.getUserStats(u, scope);
  assert.equal(stats.coins, -150);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});
