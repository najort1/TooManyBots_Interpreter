/**
 * Purga — evento diário de 10 minutos.
 * Testes: ativação, assalto, limites, defesa matemática, leaderboard, anúncios.
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

const NO_DEFENSE = { chaosEventDefenseEnabled: false };

test('ativação única por dia na hora configurada', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const market = createMarketService({ repository: repo, marketRepository: marketRepo, random: () => 0.5 });
  const chaosEvent = createChaosEventService({ repository: repo, eventRepository: eventRepo, getMarketService: () => market, random: () => 0.5 });
  const scope = uniqueGroup();
  const cfg = resolveFunConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR, chaosEventDurationMs: 10 * 60_000 });
  const now = atHour(TEST_HOUR);
  const result = chaosEvent.tryStartEvent(scope, cfg, now);
  assert.equal(result.ok, true);
  assert.equal(result.eventType, 'crime_chaos');
  assert.equal(result.durationMs, 10 * 60_000);
  assert.equal(result.label, 'PURGA');
  assert.equal(chaosEvent.isEventActive(scope, now + 1000).active, true);
  const withinWindow = chaosEvent.tryStartEvent(scope, cfg, now + 2000);
  assert.equal(withinWindow.reason, 'already-active');
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
  const market = createMarketService({ repository: repo, marketRepository: createFunMarketRepository({ getDatabase: getDb }), random: () => 0.5 });
  const chaosEvent = createChaosEventService({ repository: repo, eventRepository: eventRepo, getMarketService: () => market, random: () => 0.5 });
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
  const market = createMarketService({ repository: repo, marketRepository: marketRepo, random: () => 0.5 });
  const chaosEvent = createChaosEventService({ repository: repo, eventRepository: eventRepo, getMarketService: () => market, random: () => 0.01 });
  const scope = uniqueGroup();
  const atk = uniqueJid('5591');
  const vic = uniqueJid('5592');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 100, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 200, reason: 'seed' });
  const cfg = resolveFunConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR, chaosEventNoWeaponSuccess: 0.50, ...NO_DEFENSE });
  const now = atHour(TEST_HOUR);
  chaosEvent.tryStartEvent(scope, cfg, now);
  const win = chaosEvent.doCrimeAssault({ attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 50, funConfig: cfg, now: now + 1000 });
  assert.equal(win.ok, true);
  assert.equal(win.success, true);
  assert.equal(win.weapon, null);
  assert.equal(win.stolen, 50);
  const chaosEventFail = createChaosEventService({ repository: repo, eventRepository: eventRepo, getMarketService: () => market, random: () => 0.99 });
  const fail = chaosEventFail.doCrimeAssault({ attackerJid: vic, targetJid: atk, scopeKey: scope, amount: 30, funConfig: cfg, now: now + 2000 });
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
  const market = createMarketService({ repository: repo, marketRepository: marketRepo, effectsRepository: effects, casinoRepository: casinoRepo, random: () => 0.5 });
  const chaosEvent = createChaosEventService({ repository: repo, eventRepository: eventRepo, getMarketService: () => market, random: () => 0.01 });
  const scope = uniqueGroup();
  const atk = uniqueJid('5593');
  const vic = uniqueJid('5594');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 500, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 300, reason: 'seed' });
  const cfg = resolveFunConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR, chaosEventWeaponBaseChance: 0.60, ...NO_DEFENSE });
  const now = atHour(TEST_HOUR);
  chaosEvent.tryStartEvent(scope, cfg, now);
  effects.addCharges({ userJid: atk, scopeKey: scope, effectKey: 'weapons_license', charges: 1, payload: { permanent: true } });
  marketRepo.addInventory({ userJid: atk, scopeKey: scope, itemId: 'faca', acquiredPrice: 90, usesLeft: 10 });
  const win = chaosEvent.doCrimeAssault({ attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 100, funConfig: cfg, now: now + 1000 });
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
  const market = createMarketService({ repository: repo, marketRepository: marketRepo, random: () => 0.5 });
  const chaosEvent = createChaosEventService({ repository: repo, eventRepository: eventRepo, getMarketService: () => market, random: () => 0.01 });
  const scope = uniqueGroup();
  const atk = uniqueJid('5595');
  const vic = uniqueJid('5596');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 100, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 10, reason: 'seed' });
  const cfg = resolveFunConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR, chaosEventMaxDebt: 100, chaosEventMaxStealAmount: 500, chaosEventNoWeaponSuccess: 0.50, ...NO_DEFENSE });
  const now = atHour(TEST_HOUR);
  chaosEvent.tryStartEvent(scope, cfg, now);
  const result = chaosEvent.doCrimeAssault({ attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 1000, funConfig: cfg, now: now + 1000 });
  assert.equal(result.ok, true);
  assert.equal(result.success, true);
  assert.equal(result.stolenFromWallet, 10);
  assert.equal(result.stolenFromDebt, 100);
  assert.equal(result.stolen, 110);
  assert.equal(repo.getUserStats(vic, scope).coins, -100);
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('valor de assalto limitado pelo maxStealAmount', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const market = createMarketService({ repository: repo, marketRepository: marketRepo, random: () => 0.5 });
  const chaosEvent = createChaosEventService({ repository: repo, eventRepository: eventRepo, getMarketService: () => market, random: () => 0.01 });
  const scope = uniqueGroup();
  const atk = uniqueJid('5597');
  const vic = uniqueJid('5598');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 100, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 500_000, reason: 'seed' });
  const cfg = resolveFunConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR, chaosEventMaxStealAmount: 100, chaosEventNoWeaponSuccess: 0.50, ...NO_DEFENSE });
  const now = atHour(TEST_HOUR);
  chaosEvent.tryStartEvent(scope, cfg, now);
  const result = chaosEvent.doCrimeAssault({ attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 999_999, funConfig: cfg, now: now + 1000 });
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
  const chaosEvent = createChaosEventService({ repository: repo, eventRepository: eventRepo, getMarketService: () => null, random: () => 0.5 });
  const market = createMarketService({ repository: repo, marketRepository: marketRepo, effectsRepository: effects, casinoRepository: casinoRepo, chaosEventService: chaosEvent, random: () => 0.5 });
  const scope = uniqueGroup();
  const atk = uniqueJid('5599');
  const cfg = resolveFunConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR });
  const now = atHour(TEST_HOUR);
  market.setAssaultHeat(atk, scope, 5, now);
  assert.equal(market.getAssaultHeat(atk, scope, now), 5);
  chaosEvent.tryStartEvent(scope, cfg, now);
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
  const market = createMarketService({ repository: repo, marketRepository: marketRepo, random: () => 0.5 });
  const chaosEvent = createChaosEventService({ repository: repo, eventRepository: eventRepo, getMarketService: () => market, random: () => 0.5 });
  const scope = uniqueGroup();
  const cfg = resolveFunConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR, chaosEventDurationMs: 10 * 60_000 });
  const now = atHour(TEST_HOUR);
  const started = chaosEvent.tryStartEvent(scope, cfg, now);
  assert.equal(started.durationMs, 10 * 60_000);
  assert.equal(chaosEvent.isEventActive(scope, now + 5 * 60_000).active, true);
  assert.equal(chaosEvent.isEventActive(scope, now + 10 * 60_000 + 1000), false);
  const nextDay = new Date(now + 24 * 60 * 60_000);
  assert.equal(chaosEvent.tryStartEvent(scope, cfg, atHour(TEST_HOUR, { base: nextDay.getTime() })).ok, true);
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('assalto bloqueado fora do evento', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const market = createMarketService({ repository: repo, marketRepository: createFunMarketRepository({ getDatabase: getDb }) });
  const chaosEvent = createChaosEventService({ repository: repo, eventRepository: eventRepo, getMarketService: () => market });
  const scope = uniqueGroup();
  const result = chaosEvent.doCrimeAssault({ attackerJid: uniqueJid('5598'), targetJid: uniqueJid('5599'), scopeKey: scope, amount: 50, funConfig: resolveFunConfig({}) });
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
  const market = createMarketService({ repository: repo, marketRepository: marketRepo, random: () => 0.5 });
  const chaosEvent = createChaosEventService({ repository: repo, eventRepository: eventRepo, getMarketService: () => market, random: () => 0.01 });
  const scope = uniqueGroup();
  const a1 = uniqueJid('5501');
  const a2 = uniqueJid('5502');
  const vic1 = uniqueJid('5503');
  const vic2 = uniqueJid('5504');
  repo.addCoins({ userJid: a1, scopeKey: scope, amount: 100, reason: 'seed' });
  repo.addCoins({ userJid: a2, scopeKey: scope, amount: 100, reason: 'seed' });
  repo.addCoins({ userJid: vic1, scopeKey: scope, amount: 1000, reason: 'seed' });
  repo.addCoins({ userJid: vic2, scopeKey: scope, amount: 2000, reason: 'seed' });
  const cfg = resolveFunConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR, chaosEventNoWeaponSuccess: 0.50, chaosEventMaxStealAmount: 500, ...NO_DEFENSE });
  const now = atHour(TEST_HOUR);
  chaosEvent.tryStartEvent(scope, cfg, now);
  chaosEvent.doCrimeAssault({ attackerJid: a1, targetJid: vic1, scopeKey: scope, amount: 100, funConfig: cfg, now: now + 1000 });
  chaosEvent.doCrimeAssault({ attackerJid: a1, targetJid: vic2, scopeKey: scope, amount: 300, funConfig: cfg, now: now + 2000 });
  chaosEvent.doCrimeAssault({ attackerJid: a2, targetJid: vic1, scopeKey: scope, amount: 50, funConfig: cfg, now: now + 3000 });
  const lb = chaosEvent.getEventLeaderboard(scope);
  assert.equal(lb.attackers.length, 2);
  assert.equal(lb.attackers[0].total, 400);
  assert.equal(lb.attackers[1].total, 50);
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
  const market = createMarketService({ repository: repo, marketRepository: marketRepo, random: () => 0.5 });
  const chaosEvent = createChaosEventService({ repository: repo, eventRepository: eventRepo, getMarketService: () => market, random: () => 0.5 });
  const scope = uniqueGroup();
  const cfg = resolveFunConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR, chaosEventDurationMs: 10 * 60_000 });
  const now = atHour(TEST_HOUR);
  const started = chaosEvent.tryStartEvent(scope, cfg, now);
  const startMsg = chaosEvent.formatStartAnnouncement(started);
  assert.match(startMsg, /PURGA/);
  assert.match(startMsg, /ESTADO DE EMERGÊNCIA/);
  assert.match(startMsg, /10 minutos/);
  const nearEnd = now + 8 * 60_000 + 30_000;
  assert.equal(chaosEvent.shouldSendWarning(scope, nearEnd), true);
  const warnMsg = chaosEvent.formatWarningAnnouncement(chaosEvent.getTimeRemaining(scope, nearEnd));
  assert.match(warnMsg, /AVISO/);
  assert.match(warnMsg, /2 minutos/);
  assert.equal(chaosEvent.shouldSendWarning(scope, nearEnd + 1000), false);
  chaosEvent.resetWarning(scope);
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
  const result = repo.addCoinsAllowNegative({ userJid: u, scopeKey: scope, amount: -200, reason: 'test-debt' });
  assert.equal(result.ok, true);
  assert.equal(result.coins, -150);
  assert.equal(repo.getUserStats(u, scope).coins, -150);
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('defesa: assalto retorna pending com desafio matemático', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const market = createMarketService({ repository: repo, marketRepository: marketRepo, random: () => 0.5 });
  const chaosEvent = createChaosEventService({ repository: repo, eventRepository: eventRepo, getMarketService: () => market, random: () => 0.01 });
  const scope = uniqueGroup();
  const atk = uniqueJid('5520');
  const vic = uniqueJid('5521');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 100, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 200, reason: 'seed' });
  const cfg = resolveFunConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR, chaosEventNoWeaponSuccess: 0.50, chaosEventDefenseEnabled: true, chaosEventDefenseTimeoutMs: 4000 });
  const now = atHour(TEST_HOUR);
  chaosEvent.tryStartEvent(scope, cfg, now);

  const result = chaosEvent.doCrimeAssault({ attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 50, funConfig: cfg, now: now + 1000 });
  assert.equal(result.ok, true);
  assert.equal(result.success, 'pending');
  assert.equal(result.reason, 'defense');
  assert.ok(result.challenge);
  assert.ok(result.challenge.expression);
  assert.ok(Number.isFinite(result.challenge.answer));
  assert.ok(result.challenge.expiresAt > now);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('defesa: acertar a conta bloqueia o assalto', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const market = createMarketService({ repository: repo, marketRepository: marketRepo, random: () => 0.5 });
  const chaosEvent = createChaosEventService({ repository: repo, eventRepository: eventRepo, getMarketService: () => market, random: () => 0.01 });
  const scope = uniqueGroup();
  const atk = uniqueJid('5522');
  const vic = uniqueJid('5523');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 100, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 200, reason: 'seed' });
  const cfg = resolveFunConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR, chaosEventNoWeaponSuccess: 0.50, chaosEventDefenseTimeoutMs: 4000 });
  const now = atHour(TEST_HOUR);
  chaosEvent.tryStartEvent(scope, cfg, now);

  const pending = chaosEvent.doCrimeAssault({ attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 50, funConfig: cfg, now: now + 1000 });
  assert.equal(pending.success, 'pending');

  const challenge = chaosEvent.getPendingChallenge(scope, vic, now + 2000);
  assert.notEqual(challenge, null);

  const resolved = chaosEvent.resolveChallenge({
    scopeKey: scope, targetJid: vic, answer: challenge.answer, now: now + 2500,
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.defended, true);
  assert.equal(resolved.stolen, 0);

  // atk não recebeu nada, vic manteve saldo
  assert.equal(repo.getUserStats(atk, scope).coins, 100);
  assert.equal(repo.getUserStats(vic, scope).coins, 200);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('defesa: errar a conta executa o assalto', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const market = createMarketService({ repository: repo, marketRepository: marketRepo, random: () => 0.5 });
  const chaosEvent = createChaosEventService({ repository: repo, eventRepository: eventRepo, getMarketService: () => market, random: () => 0.01 });
  const scope = uniqueGroup();
  const atk = uniqueJid('5524');
  const vic = uniqueJid('5525');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 100, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 200, reason: 'seed' });
  const cfg = resolveFunConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR, chaosEventNoWeaponSuccess: 0.50, chaosEventDefenseTimeoutMs: 4000 });
  const now = atHour(TEST_HOUR);
  chaosEvent.tryStartEvent(scope, cfg, now);

  const pending = chaosEvent.doCrimeAssault({ attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 50, funConfig: cfg, now: now + 1000 });
  assert.equal(pending.success, 'pending');

  const resolved = chaosEvent.resolveChallenge({
    scopeKey: scope, targetJid: vic, answer: -9999, now: now + 2500,
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.defended, false);
  assert.equal(resolved.givenAnswer, -9999);
  assert.equal(resolved.stolen, 50);
  assert.equal(repo.getUserStats(atk, scope).coins, 150);
  assert.equal(repo.getUserStats(vic, scope).coins, 150);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('defesa: timeout executa o assalto automaticamente', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const market = createMarketService({ repository: repo, marketRepository: marketRepo, random: () => 0.5 });
  const chaosEvent = createChaosEventService({ repository: repo, eventRepository: eventRepo, getMarketService: () => market, random: () => 0.01 });
  const scope = uniqueGroup();
  const atk = uniqueJid('5526');
  const vic = uniqueJid('5527');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 100, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 200, reason: 'seed' });
  const cfg = resolveFunConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR, chaosEventNoWeaponSuccess: 0.50, chaosEventDefenseTimeoutMs: 4000 });
  const now = atHour(TEST_HOUR);
  chaosEvent.tryStartEvent(scope, cfg, now);

  chaosEvent.doCrimeAssault({ attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 50, funConfig: cfg, now: now + 1000 });

  const afterTimeout = now + 5000;

  // sem chamar getPendingChallenge (que deleta), processExpiredChallenges encontra
  const expiredList = chaosEvent.processExpiredChallenges(scope, afterTimeout);
  assert.equal(expiredList.length, 1);
  assert.equal(expiredList[0].stolen, 50);
  assert.equal(repo.getUserStats(atk, scope).coins, 150);
  assert.equal(repo.getUserStats(vic, scope).coins, 150);

  // após processado, resolveChallenge não encontra nada
  const resolved = chaosEvent.resolveChallenge({ scopeKey: scope, targetJid: vic, answer: 0, now: afterTimeout });
  assert.equal(resolved.ok, false);
  assert.equal(resolved.reason, 'no-challenge');

  // getPendingChallenge também não encontra
  assert.equal(chaosEvent.getPendingChallenge(scope, vic, afterTimeout), null);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});
