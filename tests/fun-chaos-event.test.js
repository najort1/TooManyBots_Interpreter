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

function atHour(hour = TEST_HOUR, minute = 30, { base = Date.now() } = {}) {
  const d = new Date(base);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

const NO_DEFENSE = { chaosEventDefenseEnabled: false };

/** Garante que horário de fim de semana bate com o configurado, para testes rodarem qualquer dia. */
function chaosConfig(extra = {}) {
  const h = extra.chaosEventHour ?? TEST_HOUR;
  const m = extra.chaosEventMinute ?? 30;
  return resolveFunConfig({
    ...extra,
    chaosEventWeekendHour: extra.chaosEventWeekendHour ?? h,
    chaosEventWeekendMinute: extra.chaosEventWeekendMinute ?? m,
  });
}

test('ativação única por dia na hora configurada', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const market = createMarketService({ repository: repo, marketRepository: marketRepo, random: () => 0.5 });
  const chaosEvent = createChaosEventService({ repository: repo, eventRepository: eventRepo, getMarketService: () => market, random: () => 0.5 });
  const scope = uniqueGroup();
  const cfg = chaosConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR, chaosEventDurationMs: 10 * 60_000 });
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
  const nextAt = atHour(TEST_HOUR, 30, { base: nextDay.getTime() });
  assert.equal(chaosEvent.tryStartEvent(scope, cfg, nextAt).ok, true);
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('ativação em dias consecutivos com horário que cruza meia-noite UTC', () => {
  // Cenário real: PURGA às 23:30 BRT = 02:30 UTC dia seguinte.
  // O bug anterior usava Date.UTC(y,mo-1,dd) que calculava meia-noite UTC,
  // fazendo o lastSpawnAt cair na janela errada e bloqueando o dia seguinte.
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const market = createMarketService({ repository: repo, marketRepository: marketRepo, random: () => 0.5 });
  const chaosEvent = createChaosEventService({ repository: repo, eventRepository: eventRepo, getMarketService: () => market, random: () => 0.5 });
  const scope = uniqueGroup();
  const cfg = chaosConfig({
    chaosEventEnabled: true,
    chaosEventHour: 23,
    chaosEventMinute: 30,
    chaosEventDurationMs: 10 * 60_000,
  });

  // Dia 1: 23:30 — deve disparar
  const day1 = atHour(23, 30);
  const r1 = chaosEvent.tryStartEvent(scope, cfg, day1);
  assert.equal(r1.ok, true, 'Dia 1 deve disparar');

  // Dentro do mesmo evento: rejeita (already-active)
  assert.equal(chaosEvent.tryStartEvent(scope, cfg, day1 + 5000).ok, false);

  // Simula que o evento terminou (endsAt já passou)
  const afterEvent1 = day1 + 11 * 60_000;

  // Dia 2: 23:30 (+24h) — NÃO pode ser bloqueado por already-today
  const day2 = day1 + 24 * 60 * 60_000;
  const day2Time = atHour(23, 30, { base: day2 });

  // Confirma que o evento anterior não está mais ativo
  assert.equal(chaosEvent.isEventActive(scope, day2Time), false, 'Evento anterior deve ter expirado');

  const r2 = chaosEvent.tryStartEvent(scope, cfg, day2Time);
  assert.equal(r2.ok, true, 'Dia 2 deve disparar — já foi um dia diferente no fuso');
  assert.equal(r2.label, 'PURGA');

  // Dia 3: +48h — também deve funcionar
  const day3 = day1 + 48 * 60 * 60_000;
  const day3Time = atHour(23, 30, { base: day3 });
  const r3 = chaosEvent.tryStartEvent(scope, cfg, day3Time);
  assert.equal(r3.ok, true, 'Dia 3 deve disparar');
  assert.equal(r3.label, 'PURGA');

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
  const cfg = chaosConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR });
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
  const cfg = chaosConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR, chaosEventNoWeaponSuccess: 0.50, ...NO_DEFENSE });
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
  const cfg = chaosConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR, chaosEventWeaponBaseChance: 0.60, ...NO_DEFENSE });
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
  const cfg = chaosConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR, chaosEventMaxDebt: 100, chaosEventMaxStealAmount: 500, chaosEventNoWeaponSuccess: 0.50, ...NO_DEFENSE });
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
  const cfg = chaosConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR, chaosEventMaxStealAmount: 100, chaosEventNoWeaponSuccess: 0.50, ...NO_DEFENSE });
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
  const cfg = chaosConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR });
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
  const cfg = chaosConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR, chaosEventDurationMs: 10 * 60_000 });
  const now = atHour(TEST_HOUR);
  const started = chaosEvent.tryStartEvent(scope, cfg, now);
  assert.equal(started.durationMs, 10 * 60_000);
  assert.equal(chaosEvent.isEventActive(scope, now + 5 * 60_000).active, true);
  assert.equal(chaosEvent.isEventActive(scope, now + 10 * 60_000 + 1000), false);
  const nextDay = new Date(now + 24 * 60 * 60_000);
  assert.equal(chaosEvent.tryStartEvent(scope, cfg, atHour(TEST_HOUR, 30, { base: nextDay.getTime() })).ok, true);
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
  const result = chaosEvent.doCrimeAssault({ attackerJid: uniqueJid('5598'), targetJid: uniqueJid('5599'), scopeKey: scope, amount: 50, funConfig: chaosConfig({}) });
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
  const cfg = chaosConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR, chaosEventNoWeaponSuccess: 0.50, chaosEventMaxStealAmount: 500, ...NO_DEFENSE });
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
  const cfg = chaosConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR, chaosEventDurationMs: 10 * 60_000 });
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
  const cfg = chaosConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR, chaosEventNoWeaponSuccess: 0.50, chaosEventDefenseEnabled: true, chaosEventDefenseTimeoutMs: 4000 });
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
  const cfg = chaosConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR, chaosEventNoWeaponSuccess: 0.50, chaosEventDefenseTimeoutMs: 4000 });
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
  const cfg = chaosConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR, chaosEventNoWeaponSuccess: 0.50, chaosEventDefenseTimeoutMs: 4000 });
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
  const cfg = chaosConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR, chaosEventNoWeaponSuccess: 0.50, chaosEventDefenseTimeoutMs: 4000 });
  const now = atHour(TEST_HOUR);
  chaosEvent.tryStartEvent(scope, cfg, now);

  chaosEvent.doCrimeAssault({ attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 50, funConfig: cfg, now: now + 1000 });

  const afterTimeout = now + 5001;

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

test('defesa: resposta inválida (NaN) executa assalto', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const market = createMarketService({ repository: repo, marketRepository: marketRepo, random: () => 0.5 });
  const chaosEvent = createChaosEventService({ repository: repo, eventRepository: eventRepo, getMarketService: () => market, random: () => 0.01 });
  const scope = uniqueGroup();
  const atk = uniqueJid('5528');
  const vic = uniqueJid('5529');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 100, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 50, reason: 'seed' });
  const cfg = chaosConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR, chaosEventNoWeaponSuccess: 0.50, chaosEventDefenseTimeoutMs: 4000 });
  const now = atHour(TEST_HOUR);
  chaosEvent.tryStartEvent(scope, cfg, now);

  const pending = chaosEvent.doCrimeAssault({ attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 50, funConfig: cfg, now: now + 1000 });
  assert.equal(pending.success, 'pending');

  const nanResult = chaosEvent.resolveChallenge({ scopeKey: scope, targetJid: vic, answer: 'abc', now: now + 2000 });
  assert.equal(nanResult.ok, true);
  assert.equal(nanResult.defended, false);
  assert.equal(nanResult.stolen, 50);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('defesa: responder vazio ou null executa assalto', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const market = createMarketService({ repository: repo, marketRepository: marketRepo, random: () => 0.5 });
  const chaosEvent = createChaosEventService({ repository: repo, eventRepository: eventRepo, getMarketService: () => market, random: () => 0.01 });
  const scope = uniqueGroup();
  const atk = uniqueJid('5530');
  const vic = uniqueJid('5531');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 100, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 50, reason: 'seed' });
  const cfg = chaosConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR, chaosEventNoWeaponSuccess: 0.50, chaosEventDefenseTimeoutMs: 4000 });
  const now = atHour(TEST_HOUR);
  chaosEvent.tryStartEvent(scope, cfg, now);

  const pending1 = chaosEvent.doCrimeAssault({ attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 30, funConfig: cfg, now: now + 1000 });
  assert.equal(pending1.success, 'pending');

  const r1 = chaosEvent.resolveChallenge({ scopeKey: scope, targetJid: vic, answer: '', now: now + 2000 });
  assert.equal(r1.ok, true);
  assert.equal(r1.defended, false);
  assert.equal(r1.stolen, 30);

  // recarrega vic
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 50, reason: 'refill', now: now + 2000 });
  const pending2 = chaosEvent.doCrimeAssault({ attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 20, funConfig: cfg, now: now + 2500 });
  assert.equal(pending2.success, 'pending');

  const r2 = chaosEvent.resolveChallenge({ scopeKey: scope, targetJid: vic, answer: null, now: now + 3000 });
  assert.equal(r2.ok, true);
  assert.equal(r2.defended, false);
  assert.equal(r2.stolen, 20);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('defesa: múltiplos assaltos no mesmo alvo sobrescrevem desafio anterior', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const market = createMarketService({ repository: repo, marketRepository: marketRepo, random: () => 0.5 });
  const chaosEvent = createChaosEventService({ repository: repo, eventRepository: eventRepo, getMarketService: () => market, random: () => 0.01 });
  const scope = uniqueGroup();
  const a1 = uniqueJid('5532');
  const a2 = uniqueJid('5533');
  const vic = uniqueJid('5534');
  repo.addCoins({ userJid: a1, scopeKey: scope, amount: 100, reason: 'seed' });
  repo.addCoins({ userJid: a2, scopeKey: scope, amount: 100, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 500, reason: 'seed' });
  const cfg = chaosConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR, chaosEventNoWeaponSuccess: 0.50, chaosEventDefenseTimeoutMs: 60000 });
  const now = atHour(TEST_HOUR);
  chaosEvent.tryStartEvent(scope, cfg, now);

  // a1 ataca vic primeiro
  const first = chaosEvent.doCrimeAssault({ attackerJid: a1, targetJid: vic, scopeKey: scope, amount: 50, funConfig: cfg, now: now + 1000 });
  assert.equal(first.success, 'pending');
  const firstChallenge = first.challenge;
  assert.equal(firstChallenge.attackerJid, a1);

  // a2 ataca vic logo em seguida — sobrescreve
  const second = chaosEvent.doCrimeAssault({ attackerJid: a2, targetJid: vic, scopeKey: scope, amount: 30, funConfig: cfg, now: now + 2000 });
  assert.equal(second.success, 'pending');
  const secondChallenge = second.challenge;
  assert.equal(secondChallenge.attackerJid, a2);

  // o desafio foi sobrescrito: attacker mudou de a1 para a2
  assert.equal(secondChallenge.attackerJid, a2);

  // resolve com a resposta correta do desafio ATIVO (segundo)
  const resolved = chaosEvent.resolveChallenge({ scopeKey: scope, targetJid: vic, answer: secondChallenge.answer, now: now + 3000 });
  assert.equal(resolved.defended, true);
  assert.equal(resolved.stolen, 0);
  // a1 nunca atacou de fato (foi sobrescrito), a2 perdeu o ataque (defendido)
  assert.equal(repo.getUserStats(a1, scope).coins, 100);
  assert.equal(repo.getUserStats(a2, scope).coins, 100);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('defesa: assaltos em alvos diferentes no mesmo escopo não interferem', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const market = createMarketService({ repository: repo, marketRepository: marketRepo, random: () => 0.5 });
  const chaosEvent = createChaosEventService({ repository: repo, eventRepository: eventRepo, getMarketService: () => market, random: () => 0.01 });
  const scope = uniqueGroup();
  const atk = uniqueJid('5535');
  const vic1 = uniqueJid('5536');
  const vic2 = uniqueJid('5537');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 100, reason: 'seed' });
  repo.addCoins({ userJid: vic1, scopeKey: scope, amount: 100, reason: 'seed' });
  repo.addCoins({ userJid: vic2, scopeKey: scope, amount: 100, reason: 'seed' });
  const cfg = chaosConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR, chaosEventNoWeaponSuccess: 0.50, chaosEventDefenseTimeoutMs: 60000 });
  const now = atHour(TEST_HOUR);
  chaosEvent.tryStartEvent(scope, cfg, now);

  const p1 = chaosEvent.doCrimeAssault({ attackerJid: atk, targetJid: vic1, scopeKey: scope, amount: 30, funConfig: cfg, now: now + 1000 });
  const p2 = chaosEvent.doCrimeAssault({ attackerJid: atk, targetJid: vic2, scopeKey: scope, amount: 40, funConfig: cfg, now: now + 2000 });
  assert.equal(p1.success, 'pending', `p1.success deveria ser pending, foi ${p1.success}`);
  assert.equal(p2.success, 'pending', `p2.success deveria ser pending, foi ${p2.success}, reason=${p2.reason || 'n/a'}`);
  assert.ok(p2.challenge.expiresAt > p1.challenge.expiresAt);

  // vic1 acerta o desafio dele — via checkMessageForChallenge (simula digitar o número)
  const msgCheck = chaosEvent.checkMessageForChallenge(scope, vic1, String(p1.challenge.answer), now + 3000);
  assert.equal(msgCheck.matched, true);
  assert.equal(msgCheck.result.defended, true);
  // o resolveChallenge direto agora falha (já foi consumido pelo check)
  const r1 = chaosEvent.resolveChallenge({ scopeKey: scope, targetJid: vic1, answer: p1.challenge.answer, now: now + 3100 });
  assert.equal(r1.ok, false);
  assert.equal(r1.reason, 'no-challenge');
  assert.equal(repo.getUserStats(vic1, scope).coins, 100);

  // vic2 erra o dele
  const r2 = chaosEvent.resolveChallenge({ scopeKey: scope, targetJid: vic2, answer: p2.challenge.answer + 1, now: now + 3500 });
  assert.equal(r2.defended, false);
  assert.equal(r2.stolen, 40);
  assert.equal(repo.getUserStats(vic2, scope).coins, 60);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('defesa: escopos diferentes têm desafios isolados', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const market = createMarketService({ repository: repo, marketRepository: marketRepo, random: () => 0.5 });
  const chaosEvent = createChaosEventService({ repository: repo, eventRepository: eventRepo, getMarketService: () => market, random: () => 0.01 });
  const scopeA = uniqueGroup();
  const scopeB = uniqueGroup();
  const atk = uniqueJid('5538');
  const vic = uniqueJid('5539');
  repo.addCoins({ userJid: atk, scopeKey: scopeA, amount: 100, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scopeA, amount: 100, reason: 'seed' });
  repo.addCoins({ userJid: atk, scopeKey: scopeB, amount: 100, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scopeB, amount: 100, reason: 'seed' });
  const cfg = chaosConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR, chaosEventNoWeaponSuccess: 0.50, chaosEventDefenseTimeoutMs: 60000 });
  const now = atHour(TEST_HOUR);
  chaosEvent.tryStartEvent(scopeA, cfg, now);
  chaosEvent.tryStartEvent(scopeB, cfg, now);

  const pA = chaosEvent.doCrimeAssault({ attackerJid: atk, targetJid: vic, scopeKey: scopeA, amount: 40, funConfig: cfg, now: now + 1000 });
  const pB = chaosEvent.doCrimeAssault({ attackerJid: atk, targetJid: vic, scopeKey: scopeB, amount: 60, funConfig: cfg, now: now + 2000 });
  assert.equal(pA.success, 'pending');
  assert.equal(pB.success, 'pending');

  // resolve do scopeA só mexe no scopeA
  const rA = chaosEvent.resolveChallenge({ scopeKey: scopeA, targetJid: vic, answer: pA.challenge.answer, now: now + 3000 });
  assert.equal(rA.defended, true);
  assert.equal(repo.getUserStats(vic, scopeA).coins, 100);
  assert.equal(repo.getUserStats(vic, scopeB).coins, 100);

  // resolve do scopeB
  const rB = chaosEvent.resolveChallenge({ scopeKey: scopeB, targetJid: vic, answer: pB.challenge.answer - 1, now: now + 3500 });
  assert.equal(rB.defended, false);
  assert.equal(rB.stolen, 60);
  assert.equal(repo.getUserStats(vic, scopeB).coins, 40);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('defesa: getPendingChallenge retorna null sem desafio', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const chaosEvent = createChaosEventService({ repository: repo, eventRepository: eventRepo, getMarketService: () => null });
  assert.equal(chaosEvent.getPendingChallenge(uniqueGroup(), uniqueJid('5540'), Date.now()), null);
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('defesa: responder o mesmo desafio duas vezes (segunda falha)', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const market = createMarketService({ repository: repo, marketRepository: marketRepo, random: () => 0.5 });
  const chaosEvent = createChaosEventService({ repository: repo, eventRepository: eventRepo, getMarketService: () => market, random: () => 0.01 });
  const scope = uniqueGroup();
  const atk = uniqueJid('5541');
  const vic = uniqueJid('5542');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 100, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 50, reason: 'seed' });
  const cfg = chaosConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR, chaosEventNoWeaponSuccess: 0.50, chaosEventDefenseTimeoutMs: 60000 });
  const now = atHour(TEST_HOUR);
  chaosEvent.tryStartEvent(scope, cfg, now);

  const p = chaosEvent.doCrimeAssault({ attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 30, funConfig: cfg, now: now + 1000 });
  assert.equal(p.success, 'pending');

  // primeira resposta (acerta)
  const r1 = chaosEvent.resolveChallenge({ scopeKey: scope, targetJid: vic, answer: p.challenge.answer, now: now + 2000 });
  assert.equal(r1.defended, true);
  assert.equal(r1.stolen, 0);
  assert.equal(repo.getUserStats(vic, scope).coins, 50);

  // segunda resposta no mesmo desafio (já removido)
  const r2 = chaosEvent.resolveChallenge({ scopeKey: scope, targetJid: vic, answer: p.challenge.answer, now: now + 2500 });
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, 'no-challenge');

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('defesa: generateMathChallenge nunca produz total negativo', () => {
  // testa internamente: gera 500 expressões e verifica que nenhuma tem total < 0
  const repo = createFunStatsRepository({ getDatabase: getDb });
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const chaosEvent = createChaosEventService({ repository: repo, eventRepository: eventRepo, getMarketService: () => null, random: () => 0.49 });
  const scope = uniqueGroup();
  const cfg = chaosConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR, chaosEventNoWeaponSuccess: 0.50, chaosEventDefenseTimeoutMs: 60000 });
  const now = atHour(TEST_HOUR);
  chaosEvent.tryStartEvent(scope, cfg, now);

  for (let i = 0; i < 500; i++) {
    const p = chaosEvent.doCrimeAssault({ attackerJid: uniqueJid('5550'), targetJid: uniqueJid('5551'), scopeKey: scope, amount: 10, funConfig: cfg, now: now + i * 10 });
    if (p.success === 'pending') {
      assert.ok(Number.isFinite(p.challenge.answer));
      assert.ok(p.challenge.answer >= 0, `expressão "${p.challenge.expression}" deu negativo`);
      assert.match(p.challenge.expression, /^[\d\s\+\-]+$/);
    }
  }
});

test('defesa: resolveChallenge com tempo exato no limiar funciona', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const market = createMarketService({ repository: repo, marketRepository: marketRepo, random: () => 0.5 });
  const chaosEvent = createChaosEventService({ repository: repo, eventRepository: eventRepo, getMarketService: () => market, random: () => 0.01 });
  const scope = uniqueGroup();
  const atk = uniqueJid('5543');
  const vic = uniqueJid('5544');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 100, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 50, reason: 'seed' });
  const cfg = chaosConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR, chaosEventNoWeaponSuccess: 0.50, chaosEventDefenseTimeoutMs: 4000 });
  const now = atHour(TEST_HOUR);
  chaosEvent.tryStartEvent(scope, cfg, now);

  const p = chaosEvent.doCrimeAssault({ attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 20, funConfig: cfg, now: now + 1000 });

  // responde exatamente no último ms antes de expirar
  const deadline = now + 5000;
  const r = chaosEvent.resolveChallenge({ scopeKey: scope, targetJid: vic, answer: p.challenge.answer, now: deadline });
  assert.equal(r.ok, true);
  assert.equal(r.defended, true);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('defesa: assalto sem arma com defesa ativa retorna pending e não coins', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const market = createMarketService({ repository: repo, marketRepository: marketRepo, random: () => 0.5 });
  const chaosEvent = createChaosEventService({ repository: repo, eventRepository: eventRepo, getMarketService: () => market, random: () => 0.01 });
  const scope = uniqueGroup();
  const atk = uniqueJid('5545');
  const vic = uniqueJid('5546');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 100, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 100, reason: 'seed' });
  const cfg = chaosConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR, chaosEventNoWeaponSuccess: 0.50, chaosEventDefenseTimeoutMs: 4000 });
  const now = atHour(TEST_HOUR);
  chaosEvent.tryStartEvent(scope, cfg, now);

  const result = chaosEvent.doCrimeAssault({ attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 50, funConfig: cfg, now: now + 1000 });
  assert.equal(result.success, 'pending');
  assert.equal(result.stolen, 0);
  assert.equal(repo.getUserStats(atk, scope).coins, 100);
  assert.equal(repo.getUserStats(vic, scope).coins, 100);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('defesa: checkMessageForChallenge acerta sem comando especial', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const market = createMarketService({ repository: repo, marketRepository: marketRepo, random: () => 0.5 });
  const chaosEvent = createChaosEventService({ repository: repo, eventRepository: eventRepo, getMarketService: () => market, random: () => 0.01 });
  const scope = uniqueGroup();
  const atk = uniqueJid('5547');
  const vic = uniqueJid('5548');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 100, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 100, reason: 'seed' });
  const cfg = chaosConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR, chaosEventNoWeaponSuccess: 0.50, chaosEventDefenseTimeoutMs: 60000 });
  const now = atHour(TEST_HOUR);
  chaosEvent.tryStartEvent(scope, cfg, now);

  const pending = chaosEvent.doCrimeAssault({ attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 30, funConfig: cfg, now: now + 1000 });
  assert.equal(pending.success, 'pending');

  // vic digita o número certo — sem comando, sem marcação
  const check = chaosEvent.checkMessageForChallenge(scope, vic, String(pending.challenge.answer), now + 2000);
  assert.equal(check.matched, true);
  assert.equal(check.result.defended, true);
  assert.equal(check.result.stolen, 0);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('defesa: checkMessageForChallenge com resposta errada ignora', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const market = createMarketService({ repository: repo, marketRepository: marketRepo, random: () => 0.5 });
  const chaosEvent = createChaosEventService({ repository: repo, eventRepository: eventRepo, getMarketService: () => market, random: () => 0.01 });
  const scope = uniqueGroup();
  const atk = uniqueJid('5549');
  const vic = uniqueJid('5550');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 100, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 100, reason: 'seed' });
  const cfg = chaosConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR, chaosEventNoWeaponSuccess: 0.50, chaosEventDefenseTimeoutMs: 60000 });
  const now = atHour(TEST_HOUR);
  chaosEvent.tryStartEvent(scope, cfg, now);

  const pending = chaosEvent.doCrimeAssault({ attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 30, funConfig: cfg, now: now + 1000 });
  assert.equal(pending.success, 'pending');

  // vic digita um número errado — check retorna matched=false, desafio continua
  const wrong = chaosEvent.checkMessageForChallenge(scope, vic, '999', now + 2000);
  assert.equal(wrong.matched, false);

  // desafio ainda está ativo
  const challenge = chaosEvent.getPendingChallenge(scope, vic, now + 2500);
  assert.notEqual(challenge, null);
  assert.equal(challenge.expired, undefined);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('defesa: checkMessageForChallenge com texto não numérico ignora', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const market = createMarketService({ repository: repo, marketRepository: marketRepo, random: () => 0.5 });
  const chaosEvent = createChaosEventService({ repository: repo, eventRepository: eventRepo, getMarketService: () => market, random: () => 0.01 });
  const scope = uniqueGroup();
  const atk = uniqueJid('5551');
  const vic = uniqueJid('5552');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 100, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 100, reason: 'seed' });
  const cfg = chaosConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR, chaosEventNoWeaponSuccess: 0.50, chaosEventDefenseTimeoutMs: 60000 });
  const now = atHour(TEST_HOUR);
  chaosEvent.tryStartEvent(scope, cfg, now);

  const pending = chaosEvent.doCrimeAssault({ attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 30, funConfig: cfg, now: now + 1000 });
  assert.equal(pending.success, 'pending');

  // mensagens sem número ou com número diferente são ignoradas
  assert.equal(chaosEvent.checkMessageForChallenge(scope, vic, 'kkk', now + 2000).matched, false);
  assert.equal(chaosEvent.checkMessageForChallenge(scope, vic, '/defender 9', now + 2100).matched, false);
  assert.equal(chaosEvent.checkMessageForChallenge(scope, vic, 'dois', now + 2200).matched, false);

  // desafio ainda ativo
  assert.notEqual(chaosEvent.getPendingChallenge(scope, vic, now + 2500), null);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('estresse: múltiplos crimes e defesas simultâneas durante Purga', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const market = createMarketService({ repository: repo, marketRepository: marketRepo, random: () => 0.5 });
  const chaosEvent = createChaosEventService({ repository: repo, eventRepository: eventRepo, getMarketService: () => market, random: () => 0.01 });
  const scope = uniqueGroup();
  const cfg = chaosConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR, chaosEventNoWeaponSuccess: 1.0, chaosEventDefenseTimeoutMs: 60000 });
  const now = atHour(TEST_HOUR);
  chaosEvent.tryStartEvent(scope, cfg, now);

  // 10 pares atacante/alvo
  const pairs = [];
  for (let i = 0; i < 10; i++) {
    const atk = uniqueJid('5511');
    const vic = uniqueJid('5522');
    repo.addCoins({ userJid: atk, scopeKey: scope, amount: 1000, reason: 'seed' });
    repo.addCoins({ userJid: vic, scopeKey: scope, amount: 500, reason: 'seed' });
    pairs.push({ atk, vic });
  }

  // Todos atacam simultaneamente
  const crimes = pairs.map((p, i) => {
    const t = now + 1000 + i * 50;
    const r = chaosEvent.doCrimeAssault({ attackerJid: p.atk, targetJid: p.vic, scopeKey: scope, amount: 50, funConfig: cfg, now: t });
    return r;
  });

  for (const c of crimes) {
    assert.equal(c.ok, true);
    assert.equal(c.success, 'pending');
  }

  // Cada alvo descobre a resposta e responde
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    const t = now + 2000 + i * 50;
    const challenge = chaosEvent.getPendingChallenge(scope, p.vic, t);
    if (challenge) {
      p.answer = challenge.answer;
      const d = chaosEvent.checkMessageForChallenge(scope, p.vic, String(challenge.answer), t + 25);
      assert.equal(d.matched, true);
      assert.equal(d.result.defended, true);
      // saldo do atacante não mudou (defesa bloqueou)
      const atkStats = repo.getUserStats(p.atk, scope);
      assert.equal(atkStats.coins, 1000);
    }
  }

  // Tenta atacar de novo — event ainda ativo (random 0.01 = 100% sucesso no noWeaponSuccess)
  const retry = chaosEvent.doCrimeAssault({ attackerJid: pairs[0].atk, targetJid: pairs[0].vic, scopeKey: scope, amount: 30, funConfig: cfg, now: now + 5000 });
  assert.equal(retry.ok, true);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});
