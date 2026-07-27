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

let _jidSeq = 0;
function uniqueJid(prefix = '5511') {
  _jidSeq += 1;
  // Sequência monotônica evita colisão em loops apertados (Date.now() repete no mesmo ms)
  return `${prefix}${String(Date.now()).slice(-5)}${_jidSeq}${Math.floor(Math.random() * 900 + 100)}@s.whatsapp.net`;
}

let _groupSeq = 0;
function uniqueGroup() {
  _groupSeq += 1;
  return `120363${String(Date.now()).slice(-8)}${_groupSeq}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

const TEST_HOUR = 20;

function atHour(hour = TEST_HOUR, minute = 30, { base = Date.now() } = {}) {
  const d = new Date(base);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

/** Simula a vítima mandando mensagem (libera re-roubo na Purga). */
function pokeActivity(jid, occurredAt, flowPath = '') {
  const db = getDb();
  db.prepare(`
    INSERT INTO analytics.conversation_events (occurred_at, event_type, direction, jid, flow_path, message_text, metadata)
    VALUES (?, 'message', 'incoming', ?, ?, '', '{}')
  `).run(Number(occurredAt), String(jid), String(flowPath || ''));
}

const NO_DEFENSE = { chaosEventDefenseEnabled: false };
/** Sem cooldown entre assaltos (testes de sequência no mesmo atacante). */
const NO_COOLDOWN = { chaosEventAssaultCooldownMs: 0 };
/** Grace Baileys zero — processExpired liquida logo após o timeout fair. */
const NO_GRACE = { chaosEventDefenseDeliveryGraceMs: 0 };
/** Defesa rápida + sem grace (timeouts unitários). */
const FAST_DEFENSE = {
  chaosEventDefenseEnabled: true,
  chaosEventDefenseTimeoutMs: 4000,
  ...NO_GRACE,
};

/** Garante que horário de fim de semana bate com o configurado, para testes rodarem qualquer dia. */
function chaosConfig(extra = {}) {
  const h = extra.chaosEventHour ?? TEST_HOUR;
  const m = extra.chaosEventMinute ?? 30;
  return resolveFunConfig({
    // defaults de teste: sem cooldown/grace para não quebrar assaltos em sequência
    chaosEventAssaultCooldownMs: 0,
    chaosEventDefenseDeliveryGraceMs: 0,
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

test('purga: pistola sem munição cai nos punhos (não bloqueia assalto)', () => {
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
  const atk = uniqueJid('55930');
  const vic = uniqueJid('55931');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 500, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 300, reason: 'seed' });
  const cfg = chaosConfig({
    chaosEventEnabled: true,
    chaosEventHour: TEST_HOUR,
    chaosEventNoWeaponSuccess: 0.5,
    ...NO_DEFENSE,
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
  // pistola sem munição no inventário
  marketRepo.addInventory({
    userJid: atk,
    scopeKey: scope,
    itemId: 'pistola',
    acquiredPrice: 260,
    usesLeft: 10,
  });
  const win = chaosEvent.doCrimeAssault({
    attackerJid: atk,
    targetJid: vic,
    scopeKey: scope,
    amount: 50,
    funConfig: cfg,
    now: now + 1000,
  });
  assert.equal(win.ok, true, 'sem munição ainda pode assaltar');
  assert.equal(win.success, true);
  assert.equal(win.fists, true, 'deve usar punhos');
  assert.equal(win.weapon, null);
  assert.ok(win.chance <= 0.55, `chance de punhos ~50%: ${win.chance}`);
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('purga: pistola sem munição mas com faca usa a faca', () => {
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
  const atk = uniqueJid('55932');
  const vic = uniqueJid('55933');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 500, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 300, reason: 'seed' });
  const cfg = chaosConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR, ...NO_DEFENSE });
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
    itemId: 'pistola',
    acquiredPrice: 260,
    usesLeft: 10,
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
    amount: 50,
    funConfig: cfg,
    now: now + 1000,
  });
  assert.equal(win.ok, true);
  assert.equal(win.success, true);
  assert.equal(win.weapon?.id, 'faca');
  assert.notEqual(win.fists, true);
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('purga: vítima roubada e silenciosa não pode ser roubada de novo', () => {
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
  const atk = uniqueJid('55934');
  const atk2 = uniqueJid('55935');
  const vic = uniqueJid('55936');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 500, reason: 'seed' });
  repo.addCoins({ userJid: atk2, scopeKey: scope, amount: 500, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 500, reason: 'seed' });
  const cfg = chaosConfig({
    chaosEventEnabled: true,
    chaosEventHour: TEST_HOUR,
    chaosEventNoWeaponSuccess: 1,
    ...NO_DEFENSE,
  });
  const now = atHour(TEST_HOUR);
  chaosEvent.tryStartEvent(scope, cfg, now);
  insertConversationEvent(vic, scope, now - 30_000);

  const first = chaosEvent.doCrimeAssault({
    attackerJid: atk,
    targetJid: vic,
    scopeKey: scope,
    amount: 40,
    funConfig: cfg,
    now: now + 1000,
  });
  assert.equal(first.ok, true);
  assert.equal(first.success, true);
  assert.ok(first.stolen > 0);

  // Sem nova mensagem da vítima → bloqueado
  const second = chaosEvent.doCrimeAssault({
    attackerJid: atk2,
    targetJid: vic,
    scopeKey: scope,
    amount: 40,
    funConfig: cfg,
    now: now + 2000,
  });
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'victim-silent-after-rob');

  // Vítima manda mensagem depois do roubo → pode ser alvo de novo
  insertConversationEvent(vic, scope, now + 3000);
  const third = chaosEvent.doCrimeAssault({
    attackerJid: atk2,
    targetJid: vic,
    scopeKey: scope,
    amount: 40,
    funConfig: cfg,
    now: now + 4000,
  });
  assert.equal(third.ok, true);
  assert.equal(third.success, true);
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
  // vic1 precisa "falar" depois do roubo pra poder ser alvo de novo
  pokeActivity(vic1, now + 2500, scope);
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
  const startMsg = chaosEvent.formatStartAnnouncement(started, cfg);
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

  // recarrega vic + manda msg (libera re-roubo)
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 50, reason: 'refill', now: now + 2000 });
  pokeActivity(vic, now + 2200, scope);
  const pending2 = chaosEvent.doCrimeAssault({ attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 20, funConfig: cfg, now: now + 2500 });
  assert.equal(pending2.success, 'pending');

  const r2 = chaosEvent.resolveChallenge({ scopeKey: scope, targetJid: vic, answer: null, now: now + 3000 });
  assert.equal(r2.ok, true);
  assert.equal(r2.defended, false);
  assert.equal(r2.stolen, 20);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('defesa: múltiplos assaltos no mesmo alvo — segundo recebe target-busy', () => {
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
  assert.equal(first.challenge.attackerJid, a1);

  // a2 ataca vic — não sobrescreve (evita roubo silencioso do 1º)
  const second = chaosEvent.doCrimeAssault({ attackerJid: a2, targetJid: vic, scopeKey: scope, amount: 30, funConfig: cfg, now: now + 2000 });
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'target-busy');

  // resolve o desafio do a1
  const resolved = chaosEvent.resolveChallenge({
    scopeKey: scope, targetJid: vic, answer: first.challenge.answer, now: now + 3000,
  });
  assert.equal(resolved.defended, true);
  assert.equal(resolved.stolen, 0);
  assert.equal(repo.getUserStats(a1, scope).coins, 100);
  assert.equal(repo.getUserStats(a2, scope).coins, 100);
  assert.equal(repo.getUserStats(vic, scope).coins, 500);

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

// ─── Filtro de Atividade ────────────────────────────────────────────────────

function setupActivityTest(extraCfg = {}) {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const market = createMarketService({ repository: repo, marketRepository: marketRepo, random: () => 0.5 });
  const chaosEvent = createChaosEventService({ repository: repo, eventRepository: eventRepo, getMarketService: () => market, random: () => 0.01 });
  const scope = uniqueGroup();
  const atk = uniqueJid('5561');
  const vic = uniqueJid('5562');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 1000, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 1000, reason: 'seed' });
  const cfg = chaosConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR, chaosEventNoWeaponSuccess: 1.0, chaosEventMaxStealAmount: 500, ...NO_DEFENSE, ...extraCfg });
  const now = atHour(TEST_HOUR);
  chaosEvent.tryStartEvent(scope, cfg, now);
  return { repo, eventRepo, marketRepo, market, chaosEvent, scope, atk, vic, cfg, now };
}

function insertConversationEvent(jid, flowPath, occurredAt) {
  const db = getDb();
  db.prepare(`
    INSERT INTO analytics.conversation_events (occurred_at, event_type, direction, jid, flow_path, message_text, metadata)
    VALUES (?, 'message', 'incoming', ?, ?, '', '{}')
  `).run(Number(occurredAt), String(jid), String(flowPath || ''));
}

test('getLastPlayerActivity — retorna o evento mais recente do JID alvo', () => {
  const { chaosEvent, scope, atk, vic, cfg, now } = setupActivityTest();
  insertConversationEvent(vic, scope, now - 60_000);
  insertConversationEvent(vic, scope, now - 30_000);
  const result = chaosEvent.doCrimeAssault({ attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 50, funConfig: cfg, now });
  assert.equal(result.ok, true, 'alvo com evento recente deve passar');
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('getLastPlayerActivity — não mistura jogadores', () => {
  const { chaosEvent, scope, atk, vic, cfg, now } = setupActivityTest();
  const outro = uniqueJid('5563');
  insertConversationEvent(outro, scope, now - 5_000);
  insertConversationEvent(vic, scope, now - 20 * 60_000);
  const result = chaosEvent.doCrimeAssault({ attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 50, funConfig: cfg, now });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'inactive-target');
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('getLastPlayerActivity — sem eventos retorna 0 (fail-open)', () => {
  const { chaosEvent, scope, atk, vic, cfg, now } = setupActivityTest();
  const result = chaosEvent.doCrimeAssault({ attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 50, funConfig: cfg, now });
  assert.equal(result.ok, true, 'sem dados não deve bloquear');
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('getLastPlayerActivity — leitura não altera dados', () => {
  const { chaosEvent, scope, atk, vic, cfg, now } = setupActivityTest();
  insertConversationEvent(vic, scope, now - 30_000);
  const db = getDb();
  const before = db.prepare('SELECT COUNT(*) AS total FROM analytics.conversation_events WHERE jid = ?').get(String(vic));
  chaosEvent.doCrimeAssault({ attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 50, funConfig: cfg, now });
  const after = db.prepare('SELECT COUNT(*) AS total FROM analytics.conversation_events WHERE jid = ?').get(String(vic));
  assert.equal(Number(before.total), Number(after.total));
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('janela de atividade — dentro da janela permite seguir', () => {
  const { chaosEvent, scope, atk, vic, cfg, now } = setupActivityTest();
  insertConversationEvent(vic, scope, now - 60_000);
  const result = chaosEvent.doCrimeAssault({ attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 50, funConfig: cfg, now });
  assert.equal(result.ok, true);
  assert.equal(result.success, true);
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('janela de atividade — exatamente no limite (3 min) permite seguir', () => {
  const { chaosEvent, scope, atk, vic, cfg, now } = setupActivityTest();
  insertConversationEvent(vic, scope, now - 180_000);
  const result = chaosEvent.doCrimeAssault({ attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 50, funConfig: cfg, now });
  assert.equal(result.ok, true, 'exatamente no limite não deve bloquear');
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('janela de atividade — 1ms além do limite (3 min) bloqueia', () => {
  const { chaosEvent, scope, atk, vic, cfg, now } = setupActivityTest();
  insertConversationEvent(vic, scope, now - 180_001);
  const result = chaosEvent.doCrimeAssault({ attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 50, funConfig: cfg, now });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'inactive-target');
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('janela de atividade — muito antigo bloqueia', () => {
  const { chaosEvent, scope, atk, vic, cfg, now } = setupActivityTest();
  insertConversationEvent(vic, scope, now - 3_600_000);
  const result = chaosEvent.doCrimeAssault({ attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 50, funConfig: cfg, now });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'inactive-target');
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('janela de atividade — evento futuro não bloqueia', () => {
  const { chaosEvent, scope, atk, vic, cfg, now } = setupActivityTest();
  insertConversationEvent(vic, scope, now + 60_000);
  const result = chaosEvent.doCrimeAssault({ attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 50, funConfig: cfg, now });
  assert.equal(result.ok, true, 'evento futuro deve ser considerado ativo');
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('precedência — event-inactive antes de inactive-target', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const market = createMarketService({ repository: repo, marketRepository: createFunMarketRepository({ getDatabase: getDb }) });
  const chaosEvent = createChaosEventService({ repository: repo, eventRepository: eventRepo, getMarketService: () => market });
  const scope = uniqueGroup();
  const cfg = chaosConfig({});
  // Sem evento ativo — must retornar event-inactive independente de atividade do alvo
  const result = chaosEvent.doCrimeAssault({ attackerJid: uniqueJid('5564'), targetJid: uniqueJid('5565'), scopeKey: scope, amount: 50, funConfig: cfg });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'event-inactive');
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('precedência — invalid-target antes de inactive-target', () => {
  const { chaosEvent, scope, cfg, now } = setupActivityTest();
  // auto-ataque
  const result = chaosEvent.doCrimeAssault({ attackerJid: scope, targetJid: scope, scopeKey: scope, amount: 50, funConfig: cfg, now });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid-target');
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('inatividade bloqueia antes de arma/lockpick', () => {
  const { chaosEvent, scope, atk, vic, cfg, now, marketRepo } = setupActivityTest();
  marketRepo.addInventory({ userJid: atk, scopeKey: scope, itemId: 'lockpick', acquiredPrice: 50, usesLeft: 3 });
  insertConversationEvent(vic, scope, now - 20 * 60_000);
  const result = chaosEvent.doCrimeAssault({ attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 50, funConfig: cfg, now });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'inactive-target');
  // lockpick não foi consumido
  const inv = marketRepo.listInventory(atk, scope);
  const lp = inv.find(i => i.itemId === 'lockpick');
  assert.equal(lp.usesLeft, 3);
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('inatividade não altera saldos', () => {
  const { chaosEvent, scope, atk, vic, cfg, now, repo } = setupActivityTest();
  insertConversationEvent(vic, scope, now - 20 * 60_000);
  const atkBefore = repo.getUserStats(atk, scope).coins;
  const vicBefore = repo.getUserStats(vic, scope).coins;
  chaosEvent.doCrimeAssault({ attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 50, funConfig: cfg, now });
  assert.equal(repo.getUserStats(atk, scope).coins, atkBefore);
  assert.equal(repo.getUserStats(vic, scope).coins, vicBefore);
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('inatividade não registra leaderboard', () => {
  const { chaosEvent, scope, atk, vic, cfg, now } = setupActivityTest();
  insertConversationEvent(vic, scope, now - 20 * 60_000);
  chaosEvent.doCrimeAssault({ attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 50, funConfig: cfg, now });
  const lb = chaosEvent.getEventLeaderboard(scope);
  assert.equal(lb.attackers.length, 0);
  assert.equal(lb.victims.length, 0);
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('isolamento entre alvos — ativo passa, inativo bloqueia no mesmo evento', () => {
  const { chaosEvent, scope, atk, cfg, now, repo } = setupActivityTest();
  const vicAtivo = uniqueJid('5566');
  const vicInativo = uniqueJid('5567');
  repo.addCoins({ userJid: vicAtivo, scopeKey: scope, amount: 500, reason: 'seed' });
  repo.addCoins({ userJid: vicInativo, scopeKey: scope, amount: 500, reason: 'seed' });
  insertConversationEvent(vicAtivo, scope, now - 30_000);
  insertConversationEvent(vicInativo, scope, now - 20 * 60_000);

  const r1 = chaosEvent.doCrimeAssault({ attackerJid: atk, targetJid: vicAtivo, scopeKey: scope, amount: 50, funConfig: cfg, now });
  assert.equal(r1.ok, true, 'alvo ativo deve passar');

  const r2 = chaosEvent.doCrimeAssault({ attackerJid: atk, targetJid: vicInativo, scopeKey: scope, amount: 50, funConfig: cfg, now });
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, 'inactive-target');
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

// ─── Testes de Configuração ─────────────────────────────────────────────────

test('config — default de 3 minutos (atividade na Purga)', () => {
  const cfg = resolveFunConfig({});
  assert.equal(cfg.chaosEventActivityWindowMs, 3 * 60_000);
});

test('config — aceita mínimo de 1 minuto', () => {
  const cfg = resolveFunConfig({ chaosEventActivityWindowMs: 60_000 });
  assert.equal(cfg.chaosEventActivityWindowMs, 60_000);
});

test('config — aceita máximo de 60 minutos', () => {
  const cfg = resolveFunConfig({ chaosEventActivityWindowMs: 60 * 60_000 });
  assert.equal(cfg.chaosEventActivityWindowMs, 60 * 60_000);
});

test('config — clamp abaixo do mínimo', () => {
  for (const val of [0, -1, 1, 59_999]) {
    const cfg = resolveFunConfig({ chaosEventActivityWindowMs: val });
    assert.equal(cfg.chaosEventActivityWindowMs, 60_000, `valor ${val} deve subir para 60_000`);
  }
});

test('config — clamp acima do máximo', () => {
  for (const val of [3_600_001, 7_200_000, 99_999_999]) {
    const cfg = resolveFunConfig({ chaosEventActivityWindowMs: val });
    assert.equal(cfg.chaosEventActivityWindowMs, 60 * 60_000, `valor ${val} deve descer para ${60 * 60_000}`);
  }
});

test('config — valor intermediário preservado', () => {
  const cfg = resolveFunConfig({ chaosEventActivityWindowMs: 5 * 60_000 });
  assert.equal(cfg.chaosEventActivityWindowMs, 5 * 60_000);
});

test('config — entradas inválidas caem no default ou mínimo', () => {
  // undefined / ausente → default (3 min)
  assert.equal(resolveFunConfig({}).chaosEventActivityWindowMs, 3 * 60_000);
  assert.equal(resolveFunConfig({ chaosEventActivityWindowMs: undefined }).chaosEventActivityWindowMs, 3 * 60_000);
  // string com texto, NaN, Infinity → normalizeInt retorna default
  for (const val of ['abc', NaN, Infinity]) {
    const cfg = resolveFunConfig({ chaosEventActivityWindowMs: val });
    assert.equal(cfg.chaosEventActivityWindowMs, 3 * 60_000, `valor ${val} deve usar default 180_000`);
  }
  // string vazia e null → normalizeInt converte para 0 → clamp ao mínimo (60_000)
  for (const val of ['', null]) {
    const cfg = resolveFunConfig({ chaosEventActivityWindowMs: val });
    assert.equal(cfg.chaosEventActivityWindowMs, 60_000, `valor ${JSON.stringify(val)} deve ser clampado ao mínimo 60_000`);
  }
});

test('config — fracionário é truncado por normalizeInt', () => {
  const cfg = resolveFunConfig({ chaosEventActivityWindowMs: 90_500.9 });
  assert.equal(cfg.chaosEventActivityWindowMs, 90_500);
});

test('config — isolamento: alterar activity não afeta outros parâmetros', () => {
  const base = resolveFunConfig({});
  const modified = resolveFunConfig({ chaosEventActivityWindowMs: 5 * 60_000 });
  assert.equal(modified.chaosEventActivityWindowMs, 5 * 60_000);
  assert.equal(modified.chaosEventHour, base.chaosEventHour);
  assert.equal(modified.chaosEventDurationMs, base.chaosEventDurationMs);
  assert.equal(modified.chaosEventEnabled, base.chaosEventEnabled);
});

// ─── Teste do Handler ───────────────────────────────────────────────────────

import { handleAssaultCommand } from '../fun/commands/handlers/market.js';

test('handler — inactive-target exibe mensagem amigável', async () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const market = createMarketService({ repository: repo, marketRepository: marketRepo, random: () => 0.5 });
  const chaosEvent = createChaosEventService({ repository: repo, eventRepository: eventRepo, getMarketService: () => market, random: () => 0.01 });
  const scope = uniqueGroup();
  const atk = uniqueJid('5568');
  const vic = uniqueJid('5569');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 100, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 500, reason: 'seed' });
  const cfg = chaosConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR, chaosEventNoWeaponSuccess: 1.0, ...NO_DEFENSE });
  const now = Date.now();
  // Força início do evento via upsert direto — evita dependência de horário para isEventActive
  eventRepo.upsert(scope, {
    eventType: 'crime_chaos', multiplier: 1,
    startsAt: now, endsAt: now + 10 * 60_000, lastSpawnAt: now,
    payload: { label: 'PURGA' },
  });

  // Marca alvo como inativo (20min antes = fora da janela de 10min)
  insertConversationEvent(vic, scope, now - 20 * 60_000);

  let replyMsg = '';
  const reply = (msg) => { replyMsg = msg; };
  const nameOf = (j) => j.split('@')[0];

  const result = await handleAssaultCommand({
    userJid: atk,
    scopeKey: scope,
    marketService: market,
    funConfig: cfg,
    getContactDisplayName: nameOf,
    listContacts: () => [],
    reply,
    chaosEventService: chaosEvent,
    args: [`@${vic.split('@')[0]}`, '50'],
    mentionedJids: [vic],
    quotedParticipant: '',
    sock: null,
    identityMap: null,
    msgTimeMs: now,
  });

  assert.equal(result.handled, true);
  assert.ok(replyMsg.includes('inativo'), `mensagem deve mencionar inatividade: "${replyMsg}"`);
  assert.ok(!replyMsg.includes('inactive-target'), 'não deve expor código interno');
  assert.ok(!replyMsg.includes('coins'), 'não deve mencionar moedas');
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('handler — invalid-target mantém mensagem existente', async () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const chaosEvent = {
    isEventActive: () => ({ active: true, eventType: 'crime_chaos', startsAt: 0, endsAt: Date.now() + 60_000, remainingMs: 60_000 }),
    doCrimeAssault: () => ({ ok: false, reason: 'invalid-target' }),
  };
  const scope = uniqueGroup();
  const atk = uniqueJid('5570');
  const vic = uniqueJid('5571');

  let replyMsg = '';
  const reply = (msg) => { replyMsg = msg; };

  const result = await handleAssaultCommand({
    userJid: atk,
    scopeKey: scope,
    marketService: null,
    funConfig: chaosConfig({}),
    getContactDisplayName: (j) => j.split('@')[0],
    listContacts: () => [],
    reply,
    chaosEventService: chaosEvent,
    args: ['@alvo', '50'],
    mentionedJids: [vic],
    quotedParticipant: '',
    sock: null,
    identityMap: null,
    msgTimeMs: Date.now(),
  });
  assert.equal(result.handled, true);
  assert.ok(replyMsg.includes('Alvo inválido'), `mensagem deve ser 'Alvo inválido': "${replyMsg}"`);
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

// ─── Estresse extremo / edge cases / regressões ──────────────────────────────

function setupPurga({
  defense = false,
  maxDebt = 100,
  maxSteal = 100,
  noWeapon = 1.0,
  durationMs = 10 * 60_000,
  cooldownMs = 0,
  graceMs = 0,
  random = () => 0.01,
} = {}) {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const market = createMarketService({ repository: repo, marketRepository: marketRepo, random: () => 0.5 });
  const chaosEvent = createChaosEventService({
    repository: repo,
    eventRepository: eventRepo,
    getMarketService: () => market,
    random,
  });
  const scope = uniqueGroup();
  const cfg = chaosConfig({
    chaosEventEnabled: true,
    chaosEventHour: TEST_HOUR,
    chaosEventNoWeaponSuccess: noWeapon,
    chaosEventMaxDebt: maxDebt,
    chaosEventMaxStealAmount: maxSteal,
    chaosEventDurationMs: durationMs,
    chaosEventAssaultCooldownMs: cooldownMs,
    chaosEventDefenseDeliveryGraceMs: graceMs,
    ...(defense
      ? { chaosEventDefenseEnabled: true, chaosEventDefenseTimeoutMs: 4000 }
      : NO_DEFENSE),
  });
  // Wall-clock + force: evita skew de atHour futuro vs resolveEventTime(msgTime)
  const now = Date.now();
  const started = chaosEvent.tryStartEvent(scope, cfg, now, { force: true });
  return { repo, eventRepo, marketRepo, market, chaosEvent, scope, cfg, now, started };
}

test('edge: force ignora disabled, wrong-hour e already-today', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const chaosEvent = createChaosEventService({ repository: repo, eventRepository: eventRepo, getMarketService: () => null });
  const scope = uniqueGroup();
  const disabled = chaosConfig({ chaosEventEnabled: false, chaosEventHour: TEST_HOUR });
  const now = atHour(TEST_HOUR);

  assert.equal(chaosEvent.tryStartEvent(scope, disabled, now).reason, 'disabled');
  const forced = chaosEvent.tryStartEvent(scope, disabled, now, { force: true });
  assert.equal(forced.ok, true, 'force deve iniciar mesmo disabled');
  assert.equal(forced.label, 'PURGA');

  // already-active ainda bloqueia force
  assert.equal(chaosEvent.tryStartEvent(scope, disabled, now + 1000, { force: true }).reason, 'already-active');

  // após expirar: force ignora already-today e wrong-hour
  const after = now + 11 * 60_000;
  const wrongHour = chaosConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR });
  assert.equal(chaosEvent.tryStartEvent(scope, wrongHour, after).ok, false);
  const forced2 = chaosEvent.tryStartEvent(scope, wrongHour, after, { force: true });
  assert.equal(forced2.ok, true, 'force pós-expiração deve reiniciar');
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('edge: janela de ativação m..m+4 ok, m+5 rejeita', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const chaosEvent = createChaosEventService({ repository: repo, eventRepository: eventRepo, getMarketService: () => null });
  const cfg = chaosConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR, chaosEventMinute: 30 });

  const at30 = chaosEvent.tryStartEvent(uniqueGroup(), cfg, atHour(TEST_HOUR, 30));
  assert.equal(at30.ok, true);

  const at34 = chaosEvent.tryStartEvent(uniqueGroup(), cfg, atHour(TEST_HOUR, 34));
  assert.equal(at34.ok, true);

  const at35 = chaosEvent.tryStartEvent(uniqueGroup(), cfg, atHour(TEST_HOUR, 35));
  assert.equal(at35.ok, false);
  assert.equal(at35.reason, 'wrong-hour');

  const at29 = chaosEvent.tryStartEvent(uniqueGroup(), cfg, atHour(TEST_HOUR, 29));
  assert.equal(at29.ok, false);
  assert.equal(at29.reason, 'wrong-hour');
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('edge: amount 0/negativo/NaN/string vira mínimo 1 (cap maxSteal)', () => {
  const { chaosEvent, scope, cfg, now, repo } = setupPurga({ maxSteal: 100 });
  const atk = uniqueJid('5601');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 500, reason: 'seed' });

  let t = 1000;
  for (const amount of [0, -10, NaN, 'abc', null, undefined, '']) {
    const vic = uniqueJid('5602');
    repo.addCoins({ userJid: vic, scopeKey: scope, amount: 500, reason: 'seed' });
    const r = chaosEvent.doCrimeAssault({
      attackerJid: atk, targetJid: vic, scopeKey: scope, amount, funConfig: cfg, now: now + t,
    });
    t += 1000;
    assert.equal(r.ok, true, `amount=${amount} deve processar (${r.reason || r.success})`);
    assert.equal(r.success, true);
    assert.equal(r.stolen, 1, `amount=${amount} deve roubar mínimo 1`);
  }
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('edge: auto-ataque e jids vazios', () => {
  const { chaosEvent, scope, cfg, now } = setupPurga();
  const u = uniqueJid('5603');
  assert.equal(chaosEvent.doCrimeAssault({
    attackerJid: u, targetJid: u, scopeKey: scope, amount: 10, funConfig: cfg, now: now + 1,
  }).reason, 'invalid-target');
  assert.equal(chaosEvent.doCrimeAssault({
    attackerJid: '', targetJid: u, scopeKey: scope, amount: 10, funConfig: cfg, now: now + 1,
  }).reason, 'invalid-target');
  assert.equal(chaosEvent.doCrimeAssault({
    attackerJid: u, targetJid: '', scopeKey: scope, amount: 10, funConfig: cfg, now: now + 1,
  }).reason, 'invalid-target');
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('BUGFIX: maxDebt customizado é respeitado (não só default 100)', () => {
  const { chaosEvent, scope, cfg, now, repo } = setupPurga({ maxDebt: 25, maxSteal: 500 });
  const atk = uniqueJid('5604');
  const vic = uniqueJid('5605');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 100, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 10, reason: 'seed' });

  const r = chaosEvent.doCrimeAssault({
    attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 500, funConfig: cfg, now: now + 1000,
  });
  assert.equal(r.ok, true);
  assert.equal(r.stolenFromWallet, 10);
  assert.equal(r.stolenFromDebt, 25, 'maxDebt=25 deve limitar dívida');
  assert.equal(r.stolen, 35);
  assert.equal(repo.getUserStats(vic, scope).coins, -25);
  assert.equal(repo.getUserStats(atk, scope).coins, 135);
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('BUGFIX: maxDebt customizado também no timeout da defesa', () => {
  const { chaosEvent, scope, cfg, now, repo } = setupPurga({ defense: true, maxDebt: 40, maxSteal: 200 });
  const atk = uniqueJid('5606');
  const vic = uniqueJid('5607');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 50, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 5, reason: 'seed' });

  chaosEvent.doCrimeAssault({
    attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 200, funConfig: cfg, now: now + 1000,
  });
  const expired = chaosEvent.processExpiredChallenges(scope, now + 6000);
  assert.equal(expired.length, 1);
  assert.equal(expired[0].stolen, 45); // 5 wallet + 40 debt
  assert.equal(repo.getUserStats(vic, scope).coins, -40);
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('edge: vítima já no teto de dívida não gera mais steal', () => {
  const { chaosEvent, scope, cfg, now, repo } = setupPurga({ maxDebt: 100, maxSteal: 100 });
  const atk = uniqueJid('5608');
  const vic = uniqueJid('5609');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 50, reason: 'seed' });
  // força vítima a -100
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 10, reason: 'seed' });
  repo.addCoinsAllowNegative({ userJid: vic, scopeKey: scope, amount: -110, reason: 'seed-debt' });
  assert.equal(repo.getUserStats(vic, scope).coins, -100);

  const r = chaosEvent.doCrimeAssault({
    attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 100, funConfig: cfg, now: now + 1000,
  });
  assert.equal(r.ok, true);
  assert.equal(r.success, true);
  assert.equal(r.stolen, 0, 'já no teto: nada a roubar');
  assert.equal(repo.getUserStats(vic, scope).coins, -100);
  assert.equal(repo.getUserStats(atk, scope).coins, 50);
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('edge: conservação de coins (sem dívida) — soma zero-sum', () => {
  const { chaosEvent, scope, cfg, now, repo } = setupPurga({ maxDebt: 0, maxSteal: 80 });
  const atk = uniqueJid('5610');
  const vic = uniqueJid('5611');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 200, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 200, reason: 'seed' });
  const totalBefore = 400;

  chaosEvent.doCrimeAssault({
    attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 80, funConfig: cfg, now: now + 1000,
  });
  const totalAfter =
    (repo.getUserStats(atk, scope).coins || 0) + (repo.getUserStats(vic, scope).coins || 0);
  assert.equal(totalAfter, totalBefore, 'sem dívida deve ser zero-sum');
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('edge: processExpiredChallenges duas vezes não double-steal', () => {
  const { chaosEvent, scope, cfg, now, repo } = setupPurga({ defense: true, maxSteal: 50 });
  const atk = uniqueJid('5612');
  const vic = uniqueJid('5613');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 100, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 100, reason: 'seed' });

  chaosEvent.doCrimeAssault({
    attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 50, funConfig: cfg, now: now + 1000,
  });
  const first = chaosEvent.processExpiredChallenges(scope, now + 6000);
  assert.equal(first.length, 1);
  assert.equal(first[0].stolen, 50);
  const atkAfter1 = repo.getUserStats(atk, scope).coins;

  const second = chaosEvent.processExpiredChallenges(scope, now + 7000);
  assert.equal(second.length, 0);
  assert.equal(repo.getUserStats(atk, scope).coins, atkAfter1);
  assert.equal(repo.getUserStats(vic, scope).coins, 50);
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('edge: resolveChallenge timeout + processExpired não double-steal', () => {
  const { chaosEvent, scope, cfg, now, repo } = setupPurga({ defense: true, maxSteal: 40 });
  const atk = uniqueJid('5614');
  const vic = uniqueJid('5615');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 100, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 100, reason: 'seed' });

  chaosEvent.doCrimeAssault({
    attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 40, funConfig: cfg, now: now + 1000,
  });

  // checkMessageForChallenge em timeout executa transferência
  const msg = chaosEvent.checkMessageForChallenge(scope, vic, 'timeout', now + 6000);
  assert.equal(msg.matched, true);
  assert.equal(msg.result.timedOut, true);
  assert.equal(msg.result.stolen, 40);

  // processExpired não deve achar nada
  const expired = chaosEvent.processExpiredChallenges(scope, now + 7000);
  assert.equal(expired.length, 0);
  assert.equal(repo.getUserStats(atk, scope).coins, 140);
  assert.equal(repo.getUserStats(vic, scope).coins, 60);
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('edge: checkMessageForChallenge extrai número embutido ("é 18", "resposta: 7")', () => {
  const { chaosEvent, scope, cfg, now, repo } = setupPurga({ defense: true });
  const atk = uniqueJid('5616');
  const vic = uniqueJid('5617');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 100, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 100, reason: 'seed' });

  const p = chaosEvent.doCrimeAssault({
    attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 20, funConfig: cfg, now: now + 1000,
  });
  assert.equal(p.success, 'pending');
  const ans = p.challenge.answer;

  const check = chaosEvent.checkMessageForChallenge(scope, vic, `é ${ans} né`, now + 2000);
  assert.equal(check.matched, true);
  assert.equal(check.result.defended, true);
  assert.equal(repo.getUserStats(vic, scope).coins, 100);
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('edge: shouldSendEnd só uma vez e ignora evento antigo', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const chaosEvent = createChaosEventService({ repository: repo, eventRepository: eventRepo, getMarketService: () => null });
  const scope = uniqueGroup();
  const cfg = chaosConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR, chaosEventDurationMs: 60_000 });
  const now = atHour(TEST_HOUR);
  chaosEvent.tryStartEvent(scope, cfg, now);

  assert.equal(chaosEvent.shouldSendEnd(scope, now + 30_000), false, 'ainda ativo');
  assert.equal(chaosEvent.shouldSendEnd(scope, now + 61_000), true, 'acabou agora');
  assert.equal(chaosEvent.shouldSendEnd(scope, now + 62_000), false, 'já anunciado');

  // Evento velho (terminou há mais de 1 duração): não re-anuncia
  const scope2 = uniqueGroup();
  eventRepo.upsert(scope2, {
    eventType: 'crime_chaos',
    multiplier: 1,
    startsAt: now - 30 * 60_000,
    endsAt: now - 20 * 60_000,
    lastSpawnAt: now - 30 * 60_000,
    payload: { label: 'PURGA' },
  });
  assert.equal(chaosEvent.shouldSendEnd(scope2, now), false, 'evento stale não re-anuncia');
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('edge: shouldSendWarning só na janela ~2min e uma vez', () => {
  const { chaosEvent, scope, now } = setupPurga({ durationMs: 10 * 60_000 });
  // remaining = 10min → fora da janela
  assert.equal(chaosEvent.shouldSendWarning(scope, now + 1000), false);
  // remaining ≈ 90s (dentro 10s..140s)
  const nearEnd = now + 10 * 60_000 - 90_000;
  assert.equal(chaosEvent.shouldSendWarning(scope, nearEnd), true);
  assert.equal(chaosEvent.shouldSendWarning(scope, nearEnd + 1000), false);
  // remaining < 10s
  assert.equal(chaosEvent.shouldSendWarning(scope, now + 10 * 60_000 - 5000), false);
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('edge: newsService quebrado não derruba start/end', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const boom = () => {
    throw new Error('news down');
  };
  const chaosEvent = createChaosEventService({
    repository: repo,
    eventRepository: eventRepo,
    getMarketService: () => null,
    getNewsService: () => ({ log: boom }),
  });
  const scope = uniqueGroup();
  const cfg = chaosConfig({ chaosEventEnabled: true, chaosEventHour: TEST_HOUR });
  const now = atHour(TEST_HOUR);
  const started = chaosEvent.tryStartEvent(scope, cfg, now);
  assert.equal(started.ok, true);
  const endMsg = chaosEvent.formatEndAnnouncement(scope, (j) => j);
  assert.match(endMsg, /FIM DA PURGA/);
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('edge: createChaosEventService exige repository e eventRepository', () => {
  assert.throws(() => createChaosEventService({}), /repository required/);
  assert.throws(() => createChaosEventService({ repository: {} }), /eventRepository required/);
});

test('edge: anúncios com leaderboard vazio e com dados', () => {
  const { chaosEvent, scope, cfg, now, repo, started } = setupPurga({ maxSteal: 50 });
  const startMsg = chaosEvent.formatStartAnnouncement(started);
  assert.match(startMsg, /PURGA/);
  assert.match(startMsg, /\/crime/);

  const emptyEnd = chaosEvent.formatEndAnnouncement(uniqueGroup(), (j) => j);
  assert.match(emptyEnd, /FIM DA PURGA/);
  assert.ok(!emptyEnd.includes('Maiores criminosos'));

  // recria leaderboard no scope atual
  const atk = uniqueJid('5618');
  const vic = uniqueJid('5619');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 100, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 100, reason: 'seed' });
  chaosEvent.doCrimeAssault({
    attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 50, funConfig: cfg, now: now + 1000,
  });
  const end = chaosEvent.formatEndAnnouncement(scope, (j) => j.split('@')[0]);
  assert.match(end, /Maiores criminosos/);
  assert.match(end, /Maiores vítimas/);
  // cleanup limpa leaderboard
  const lb = chaosEvent.getEventLeaderboard(scope);
  assert.equal(lb.attackers.length, 0);
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('edge: isHeatDisabled e cooldownRemaining coerentes com ciclo de vida', () => {
  const { chaosEvent, scope, now } = setupPurga({ durationMs: 120_000 });
  assert.equal(chaosEvent.isHeatDisabled(scope, now + 1000), true);
  assert.ok(chaosEvent.cooldownRemaining(scope, now + 1000) > 0);
  assert.equal(chaosEvent.getTimeRemaining(scope, now + 1000) > 0, true);

  const after = now + 121_000;
  assert.equal(chaosEvent.isEventActive(scope, after), false);
  assert.equal(chaosEvent.isHeatDisabled(scope, after), false);
  assert.equal(chaosEvent.cooldownRemaining(scope, after), 0);
  assert.equal(chaosEvent.getTimeRemaining(scope, after), 0);
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('edge: formatWarningAnnouncement limites de plural e zero', () => {
  const { chaosEvent } = setupPurga();
  assert.equal(chaosEvent.formatWarningAnnouncement(0), '');
  assert.match(chaosEvent.formatWarningAnnouncement(30_000), /1 minuto[^s]/);
  assert.match(chaosEvent.formatWarningAnnouncement(90_000), /2 minutos/);
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('estresse: 50 assaltos sequenciais com conservação e caps', () => {
  const { chaosEvent, scope, cfg, now, repo } = setupPurga({ maxDebt: 50, maxSteal: 30 });
  const atk = uniqueJid('5620');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 10_000, reason: 'seed' });

  let totalStolen = 0;
  for (let i = 0; i < 50; i++) {
    const vic = uniqueJid('5621');
    repo.addCoins({ userJid: vic, scopeKey: scope, amount: 20, reason: 'seed' });
    const r = chaosEvent.doCrimeAssault({
      attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 999, funConfig: cfg, now: now + 1000 + i,
    });
    assert.equal(r.ok, true);
    assert.equal(r.success, true);
    // max: 20 wallet + 50 debt = 70, mas maxSteal=30 → 20+10 debt ou 30 se wallet cheio
    assert.ok(r.stolen <= 30, `stolen=${r.stolen} > maxSteal`);
    assert.ok(repo.getUserStats(vic, scope).coins >= -50, 'vítima não ultrapassa maxDebt');
    totalStolen += r.stolen;
  }

  assert.equal(repo.getUserStats(atk, scope).coins, 10_000 + totalStolen);
  const lb = chaosEvent.getEventLeaderboard(scope);
  assert.equal(lb.attackers[0].total, totalStolen);
  assert.ok(lb.attackers.length === 1);
  assert.ok(lb.victims.length <= 3);
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('estresse: 30 desafios paralelos — metade defende, metade timeout', () => {
  const { chaosEvent, scope, cfg, now, repo } = setupPurga({ defense: true, maxSteal: 25 });
  const pairs = [];
  for (let i = 0; i < 30; i++) {
    const atk = uniqueJid('5630');
    const vic = uniqueJid('5631');
    repo.addCoins({ userJid: atk, scopeKey: scope, amount: 500, reason: 'seed' });
    repo.addCoins({ userJid: vic, scopeKey: scope, amount: 100, reason: 'seed' });
    const p = chaosEvent.doCrimeAssault({
      attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 25, funConfig: cfg, now: now + 1000 + i,
    });
    assert.equal(p.success, 'pending');
    pairs.push({ atk, vic, answer: p.challenge.answer });
  }

  // primeiros 15 defendem
  for (let i = 0; i < 15; i++) {
    const p = pairs[i];
    const r = chaosEvent.checkMessageForChallenge(scope, p.vic, String(p.answer), now + 2000 + i);
    assert.equal(r.matched, true);
    assert.equal(r.result.defended, true);
    assert.equal(repo.getUserStats(p.vic, scope).coins, 100);
    assert.equal(repo.getUserStats(p.atk, scope).coins, 500);
  }

  // restantes expiram
  const expired = chaosEvent.processExpiredChallenges(scope, now + 10_000);
  assert.equal(expired.length, 15);
  for (const exp of expired) {
    assert.equal(exp.stolen, 25);
  }
  for (let i = 15; i < 30; i++) {
    assert.equal(repo.getUserStats(pairs[i].vic, scope).coins, 75);
    assert.equal(repo.getUserStats(pairs[i].atk, scope).coins, 525);
  }
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('estresse: 1000 gerações de desafio matemático válidas e resolvíveis', () => {
  // random determinístico variado
  let seed = 42;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed % 10000) / 10000;
  };
  const { chaosEvent, scope, cfg, now, repo } = setupPurga({ defense: true, random: rnd });
  const atk = uniqueJid('5640');
  const vic = uniqueJid('5641');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 1_000_000, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 1_000_000, reason: 'seed' });

  for (let i = 0; i < 1000; i++) {
    const p = chaosEvent.doCrimeAssault({
      attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 1, funConfig: cfg, now: now + 1000 + i,
    });
    if (p.success !== 'pending') continue; // falha aleatória de roll
    assert.ok(Number.isFinite(p.challenge.answer));
    assert.ok(p.challenge.answer >= 0);
    assert.match(p.challenge.expression, /^\d+ [+\-] \d+$/);
    // valida aritmética
    const m = p.challenge.expression.match(/^(\d+) ([+\-]) (\d+)$/);
    const a = Number(m[1]);
    const op = m[2];
    const b = Number(m[3]);
    const expected = op === '+' ? a + b : a - b;
    assert.equal(p.challenge.answer, expected);
    // limpa desafio para próximo
    chaosEvent.resolveChallenge({
      scopeKey: scope, targetJid: vic, answer: p.challenge.answer, now: now + 1000 + i + 1,
    });
  }
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('handler: crime pendente e sucesso/falha durante PURGA', async () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const market = createMarketService({ repository: repo, marketRepository: marketRepo, random: () => 0.5 });
  const chaosEvent = createChaosEventService({
    repository: repo, eventRepository: eventRepo, getMarketService: () => market, random: () => 0.01,
  });
  const scope = uniqueGroup();
  const atk = uniqueJid('5650');
  const vic = uniqueJid('5651');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 200, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 200, reason: 'seed' });
  const now = Date.now();
  eventRepo.upsert(scope, {
    eventType: 'crime_chaos', multiplier: 1,
    startsAt: now, endsAt: now + 10 * 60_000, lastSpawnAt: now,
    payload: { label: 'PURGA' },
  });
  const cfg = chaosConfig({
    chaosEventEnabled: true, chaosEventHour: TEST_HOUR,
    chaosEventNoWeaponSuccess: 1.0, chaosEventDefenseEnabled: true, chaosEventDefenseTimeoutMs: 4000,
  });

  let replyMsg = '';
  const result = await handleAssaultCommand({
    userJid: atk,
    scopeKey: scope,
    marketService: market,
    funConfig: cfg,
    getContactDisplayName: (j) => j.split('@')[0],
    listContacts: () => [],
    reply: (m) => { replyMsg = m; },
    chaosEventService: chaosEvent,
    args: [`@${vic.split('@')[0]}`, '40'],
    mentionedJids: [vic],
    quotedParticipant: '',
    sock: null,
    identityMap: null,
    msgTimeMs: now,
  });
  assert.equal(result.handled, true);
  assert.match(replyMsg, /Tentativa de crime|Defenda-se|Resolva/);
  assert.ok(!replyMsg.includes('undefined'));
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('handler: crime sucesso sem defesa na PURGA', async () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const market = createMarketService({ repository: repo, marketRepository: marketRepo, random: () => 0.5 });
  const chaosEvent = createChaosEventService({
    repository: repo, eventRepository: eventRepo, getMarketService: () => market, random: () => 0.01,
  });
  const scope = uniqueGroup();
  const atk = uniqueJid('5652');
  const vic = uniqueJid('5653');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 200, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 200, reason: 'seed' });
  const now = Date.now();
  eventRepo.upsert(scope, {
    eventType: 'crime_chaos', multiplier: 1,
    startsAt: now, endsAt: now + 10 * 60_000, lastSpawnAt: now,
    payload: { label: 'PURGA' },
  });
  const cfg = chaosConfig({
    chaosEventEnabled: true, chaosEventHour: TEST_HOUR,
    chaosEventNoWeaponSuccess: 1.0, ...NO_DEFENSE,
  });

  let replyMsg = '';
  await handleAssaultCommand({
    userJid: atk,
    scopeKey: scope,
    marketService: market,
    funConfig: cfg,
    getContactDisplayName: (j) => j.split('@')[0],
    listContacts: () => [],
    reply: (m) => { replyMsg = m; },
    chaosEventService: chaosEvent,
    args: [`@${vic.split('@')[0]}`, '40'],
    mentionedJids: [vic],
    quotedParticipant: '',
    sock: null,
    identityMap: null,
    msgTimeMs: now,
  });
  assert.match(replyMsg, /Crime bem-sucedido/);
  assert.match(replyMsg, /40/);
  assert.equal(repo.getUserStats(atk, scope).coins, 240);
  assert.equal(repo.getUserStats(vic, scope).coins, 160);
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('integração: ciclo completo start → crimes → warning → end', () => {
  const { chaosEvent, scope, cfg, now, repo, started } = setupPurga({ durationMs: 3 * 60_000, maxSteal: 50 });
  assert.equal(started.ok, true);
  assert.match(chaosEvent.formatStartAnnouncement(started), /PURGA/);

  const players = Array.from({ length: 5 }, () => uniqueJid('5660'));
  for (const p of players) {
    repo.addCoins({ userJid: p, scopeKey: scope, amount: 300, reason: 'seed' });
  }
  // round-robin crimes
  for (let i = 0; i < players.length; i++) {
    const atk = players[i];
    const vic = players[(i + 1) % players.length];
    const r = chaosEvent.doCrimeAssault({
      attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 50, funConfig: cfg, now: now + 1000 + i * 100,
    });
    assert.equal(r.ok, true);
    assert.equal(r.success, true);
  }

  const warnAt = now + 3 * 60_000 - 90_000;
  if (chaosEvent.shouldSendWarning(scope, warnAt)) {
    const w = chaosEvent.formatWarningAnnouncement(chaosEvent.getTimeRemaining(scope, warnAt));
    assert.match(w, /AVISO|minuto/);
  }

  const endAt = now + 3 * 60_000 + 1000;
  assert.equal(chaosEvent.isEventActive(scope, endAt), false);
  assert.equal(chaosEvent.shouldSendEnd(scope, endAt), true);
  const endMsg = chaosEvent.formatEndAnnouncement(scope, (j) => j.split('@')[0]);
  assert.match(endMsg, /FIM DA PURGA/);
  assert.match(endMsg, /Maiores criminosos/);

  // assalto pós-fim bloqueado
  const blocked = chaosEvent.doCrimeAssault({
    attackerJid: players[0], targetJid: players[1], scopeKey: scope, amount: 10, funConfig: cfg, now: endAt,
  });
  assert.equal(blocked.reason, 'event-inactive');
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('edge: opts clamp — duration mínima 60s, chances e caps', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const chaosEvent = createChaosEventService({ repository: repo, eventRepository: eventRepo, getMarketService: () => null });
  const scope = uniqueGroup();
  const cfg = chaosConfig({
    chaosEventEnabled: true,
    chaosEventHour: TEST_HOUR,
    chaosEventDurationMs: 100, // abaixo do mínimo
    chaosEventNoWeaponSuccess: 0.01, // abaixo
    chaosEventWeaponBaseChance: 0.99, // acima
    chaosEventMaxStealAmount: 0,
  });
  const now = atHour(TEST_HOUR);
  const started = chaosEvent.tryStartEvent(scope, cfg, now);
  assert.equal(started.ok, true);
  assert.equal(started.durationMs, 60_000, 'duration floor 60s');
  assert.equal(chaosEvent.isEventActive(scope, now + 59_000).active, true);
  assert.equal(chaosEvent.isEventActive(scope, now + 61_000), false);
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('edge: already-today bloqueia segundo spawn no mesmo dia civil do fuso', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const chaosEvent = createChaosEventService({ repository: repo, eventRepository: eventRepo, getMarketService: () => null });
  const scope = uniqueGroup();
  const cfg = chaosConfig({
    chaosEventEnabled: true,
    chaosEventHour: TEST_HOUR,
    chaosEventMinute: 30,
    chaosEventDurationMs: 60_000,
  });
  const dayStart = atHour(TEST_HOUR, 30);
  assert.equal(chaosEvent.tryStartEvent(scope, cfg, dayStart).ok, true);
  // após evento: ainda mesmo dia civil → already-today
  const laterSameDay = dayStart + 5 * 60_000;
  // force minute window: if outside hour window, wrong-hour; if we force hour window with minute 34:
  const stillWindow = atHour(TEST_HOUR, 34, { base: dayStart });
  // endsAt was dayStart+60s, so at stillWindow (4min later) event is dead
  const r = chaosEvent.tryStartEvent(scope, cfg, stillWindow);
  assert.equal(r.ok, false);
  assert.ok(['already-today', 'wrong-hour'].includes(r.reason));
  // Explicit: same day after window — use force false at exact hour next... actually minute 30 next day only.
  // Simulate: same calendar day, minute still in window after event ended
  const r2 = chaosEvent.tryStartEvent(scope, cfg, dayStart + 90_000); // 31:30 same hour window if minute was 30 → 31 is in window
  // dayStart is HH:30, +90s = HH:31:30 — still in window m..m+5
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, 'already-today');
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

// ─── Cooldown 30s · msgTime defesa · concorrência ───────────────────────────

test('cooldown: 30s entre assaltos do mesmo atacante', () => {
  const { chaosEvent, scope, cfg, now, repo } = setupPurga({
    cooldownMs: 30_000, maxSteal: 20,
  });
  const atk = uniqueJid('5701');
  const vic1 = uniqueJid('5702');
  const vic2 = uniqueJid('5703');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 500, reason: 'seed' });
  repo.addCoins({ userJid: vic1, scopeKey: scope, amount: 200, reason: 'seed' });
  repo.addCoins({ userJid: vic2, scopeKey: scope, amount: 200, reason: 'seed' });

  const r1 = chaosEvent.doCrimeAssault({
    attackerJid: atk, targetJid: vic1, scopeKey: scope, amount: 20, funConfig: cfg, now: now + 1000,
  });
  assert.equal(r1.ok, true);
  assert.equal(r1.success, true);

  const blocked = chaosEvent.doCrimeAssault({
    attackerJid: atk, targetJid: vic2, scopeKey: scope, amount: 20, funConfig: cfg, now: now + 2000,
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'cooldown');
  assert.ok(blocked.remainingMs > 25_000);
  assert.ok(blocked.remainingMs <= 30_000);

  const afterCd = chaosEvent.doCrimeAssault({
    attackerJid: atk, targetJid: vic2, scopeKey: scope, amount: 20, funConfig: cfg, now: now + 1000 + 30_000,
  });
  assert.equal(afterCd.ok, true);
  assert.equal(afterCd.success, true);
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('cooldown: atacantes diferentes não compartilham cooldown', () => {
  const { chaosEvent, scope, cfg, now, repo } = setupPurga({ cooldownMs: 30_000, maxSteal: 10 });
  const a1 = uniqueJid('5704');
  const a2 = uniqueJid('5705');
  const vic = uniqueJid('5706');
  for (const u of [a1, a2, vic]) {
    repo.addCoins({ userJid: u, scopeKey: scope, amount: 300, reason: 'seed' });
  }
  assert.equal(chaosEvent.doCrimeAssault({
    attackerJid: a1, targetJid: vic, scopeKey: scope, amount: 10, funConfig: cfg, now: now + 1000,
  }).ok, true);
  // vic fala no chat → a2 pode assaltar (cooldown é por atacante, não por vítima)
  pokeActivity(vic, now + 1050, scope);
  assert.equal(chaosEvent.doCrimeAssault({
    attackerJid: a2, targetJid: vic, scopeKey: scope, amount: 10, funConfig: cfg, now: now + 1100,
  }).ok, true);
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('cooldown: default de config é 30s', () => {
  const cfg = resolveFunConfig({});
  assert.equal(cfg.chaosEventAssaultCooldownMs, 30_000);
  assert.equal(cfg.chaosEventDefenseTimeoutMs, 8000);
  assert.equal(cfg.chaosEventDefenseDeliveryGraceMs, 25_000);
});

test('defesa: msgTime no prazo vale mesmo com wall-clock atrasado (Baileys lag)', () => {
  const { chaosEvent, scope, cfg, now, repo } = setupPurga({
    defense: true, graceMs: 25_000, cooldownMs: 0,
  });
  const atk = uniqueJid('5710');
  const vic = uniqueJid('5711');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 100, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 100, reason: 'seed' });

  const t0 = now + 1000;
  const pending = chaosEvent.doCrimeAssault({
    attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 30, funConfig: cfg, now: t0,
  });
  assert.equal(pending.success, 'pending');
  const ans = pending.challenge.answer;
  const expiresAt = pending.challenge.expiresAt; // t0 + 4000

  // User digitou a resposta 1s antes do prazo (msgTime)
  const msgTime = expiresAt - 1000;
  // Mas Baileys só entregou 15s depois do wall (simulado passando msgTime, não wall)
  const check = chaosEvent.checkMessageForChallenge(scope, vic, String(ans), msgTime);
  assert.equal(check.matched, true);
  assert.equal(check.result.defended, true);
  assert.equal(repo.getUserStats(vic, scope).coins, 100);
  assert.equal(repo.getUserStats(atk, scope).coins, 100);
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('defesa: msgTime depois do prazo = timeout mesmo se processado cedo', () => {
  const { chaosEvent, scope, cfg, now, repo } = setupPurga({
    defense: true, graceMs: 25_000, cooldownMs: 0,
  });
  const atk = uniqueJid('5712');
  const vic = uniqueJid('5713');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 100, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 100, reason: 'seed' });

  const t0 = now + 1000;
  const pending = chaosEvent.doCrimeAssault({
    attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 40, funConfig: cfg, now: t0,
  });
  const ans = pending.challenge.answer;
  // User enviou 1ms depois do expiresAt
  const lateMsg = pending.challenge.expiresAt + 1;
  const check = chaosEvent.checkMessageForChallenge(scope, vic, String(ans), lateMsg);
  assert.equal(check.matched, true);
  assert.equal(check.result.timedOut, true);
  assert.equal(check.result.stolen, 40);
  assert.equal(repo.getUserStats(vic, scope).coins, 60);
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('defesa: processExpired respeita grace — não rouba no soft-timeout', () => {
  const { chaosEvent, scope, cfg, now, repo } = setupPurga({
    defense: true, graceMs: 20_000, cooldownMs: 0,
  });
  const atk = uniqueJid('5714');
  const vic = uniqueJid('5715');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 100, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 100, reason: 'seed' });

  const t0 = now + 1000;
  const pending = chaosEvent.doCrimeAssault({
    attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 25, funConfig: cfg, now: t0,
  });
  // Soft-expired (4s) mas dentro do grace (20s)
  const softExpired = pending.challenge.expiresAt + 1000;
  const early = chaosEvent.processExpiredChallenges(scope, softExpired);
  assert.equal(early.length, 0, 'grace ainda ativo — não liquida');
  assert.equal(repo.getUserStats(vic, scope).coins, 100);

  // Ainda dá para defender com msgTime no prazo
  const ok = chaosEvent.checkMessageForChallenge(
    scope, vic, String(pending.challenge.answer), pending.challenge.expiresAt - 50
  );
  assert.equal(ok.matched, true);
  assert.equal(ok.result.defended, true);
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('defesa: processExpired liquida só após hardExpiresAt', () => {
  const { chaosEvent, scope, cfg, now, repo } = setupPurga({
    defense: true, graceMs: 10_000, cooldownMs: 0,
  });
  const atk = uniqueJid('5716');
  const vic = uniqueJid('5717');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 100, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 100, reason: 'seed' });

  const t0 = now + 1000;
  const pending = chaosEvent.doCrimeAssault({
    attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 35, funConfig: cfg, now: t0,
  });
  const hard = pending.challenge.hardExpiresAt;
  assert.ok(hard > pending.challenge.expiresAt);

  assert.equal(chaosEvent.processExpiredChallenges(scope, hard).length, 0);
  const done = chaosEvent.processExpiredChallenges(scope, hard + 1);
  assert.equal(done.length, 1);
  assert.equal(done[0].stolen, 35);
  assert.equal(repo.getUserStats(vic, scope).coins, 65);
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('concorrência: 20 assaltos no mesmo alvo sem defesa — saldo nunca negativo além do maxDebt', () => {
  const { chaosEvent, scope, cfg, now, repo } = setupPurga({
    maxDebt: 50, maxSteal: 40, cooldownMs: 0,
  });
  const vic = uniqueJid('5720');
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 100, reason: 'seed' });

  let totalStolen = 0;
  for (let i = 0; i < 20; i++) {
    const atk = uniqueJid('5721');
    repo.addCoins({ userJid: atk, scopeKey: scope, amount: 50, reason: 'seed' });
    // cada roubo exige que a vítima "fale" de novo (anti-farm AFK)
    pokeActivity(vic, now + 1000 + i * 2, scope);
    const r = chaosEvent.doCrimeAssault({
      attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 40, funConfig: cfg, now: now + 1001 + i * 2,
    });
    assert.equal(r.ok, true, `i=${i} reason=${r.reason}`);
    if (r.success) totalStolen += r.stolen;
  }
  const vicCoins = repo.getUserStats(vic, scope).coins;
  assert.ok(vicCoins >= -50, `vítima em ${vicCoins}, maxDebt=50`);
  // totalStolen não pode inventar coins além de wallet inicial + maxDebt
  assert.ok(totalStolen <= 100 + 50, `stolen ${totalStolen} > cap 150`);
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('concorrência: 40 challenges paralelos — defendidos sem throw e sem double-steal', () => {
  const { chaosEvent, scope, cfg, now, repo } = setupPurga({
    defense: true, graceMs: 0, cooldownMs: 0, maxSteal: 15,
  });
  const pairs = [];
  for (let i = 0; i < 40; i++) {
    const atk = uniqueJid('5730');
    const vic = uniqueJid('5731');
    repo.addCoins({ userJid: atk, scopeKey: scope, amount: 200, reason: 'seed' });
    repo.addCoins({ userJid: vic, scopeKey: scope, amount: 80, reason: 'seed' });
    const p = chaosEvent.doCrimeAssault({
      attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 15, funConfig: cfg, now: now + 1000 + i,
    });
    assert.equal(p.ok, true, `assault ${i}: ${p.reason}`);
    assert.equal(p.success, 'pending');
    pairs.push({ atk, vic, answer: p.challenge.answer });
  }

  // Metade defende com msgTime no prazo
  for (let i = 0; i < 20; i++) {
    const p = pairs[i];
    const r = chaosEvent.checkMessageForChallenge(scope, p.vic, String(p.answer), now + 2000 + i);
    assert.equal(r.matched, true);
    assert.equal(r.result.defended, true);
    assert.equal(repo.getUserStats(p.vic, scope).coins, 80);
    // segunda tentativa no mesmo desafio
    const again = chaosEvent.checkMessageForChallenge(scope, p.vic, String(p.answer), now + 2100 + i);
    assert.equal(again.matched, false);
  }

  // Outra metade: timeout via processExpired
  const expired = chaosEvent.processExpiredChallenges(scope, now + 1000 + 40 + 4000 + 1);
  assert.equal(expired.length, 20);
  for (const e of expired) {
    assert.equal(e.stolen, 15);
  }
  // Double processExpired vazio
  assert.equal(chaosEvent.processExpiredChallenges(scope, now + 20_000).length, 0);
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('concorrência: doCrimeAssault nunca lança com inputs lixo', () => {
  const { chaosEvent, scope, cfg, now } = setupPurga();
  const junk = [
    { attackerJid: null, targetJid: uniqueJid('5740'), amount: 10 },
    { attackerJid: uniqueJid('5741'), targetJid: null, amount: 10 },
    { attackerJid: 'x', targetJid: 'x', amount: Infinity },
    { attackerJid: uniqueJid('5742'), targetJid: uniqueJid('5743'), amount: -1e20 },
  ];
  for (const j of junk) {
    const r = chaosEvent.doCrimeAssault({
      ...j, scopeKey: scope, funConfig: cfg, now: now + 1,
    });
    assert.equal(typeof r.ok, 'boolean');
  }
  // resolve/check também seguros
  assert.equal(chaosEvent.resolveChallenge({ scopeKey: scope, targetJid: 'nope', answer: 1 }).ok, false);
  assert.equal(chaosEvent.checkMessageForChallenge(scope, 'nope', '1', now).matched, false);
  assert.deepEqual(chaosEvent.processExpiredChallenges('no-scope', now), []);
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('handler: cooldown exibe segundos amigáveis', async () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const market = createMarketService({ repository: repo, marketRepository: marketRepo, random: () => 0.5 });
  const chaosEvent = createChaosEventService({
    repository: repo, eventRepository: eventRepo, getMarketService: () => market, random: () => 0.01,
  });
  const scope = uniqueGroup();
  const atk = uniqueJid('5750');
  const vic = uniqueJid('5751');
  const now = Date.now();
  eventRepo.upsert(scope, {
    eventType: 'crime_chaos', multiplier: 1,
    startsAt: now, endsAt: now + 10 * 60_000, lastSpawnAt: now,
    payload: { label: 'PURGA' },
  });
  const cfg = chaosConfig({
    chaosEventEnabled: true, chaosEventHour: TEST_HOUR,
    chaosEventNoWeaponSuccess: 1.0, chaosEventAssaultCooldownMs: 30_000, ...NO_DEFENSE,
  });
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 200, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 200, reason: 'seed' });

  // Primeiro assalto via service (marca cooldown)
  chaosEvent.doCrimeAssault({
    attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 10, funConfig: cfg, now,
  });

  let replyMsg = '';
  await handleAssaultCommand({
    userJid: atk,
    scopeKey: scope,
    marketService: market,
    funConfig: cfg,
    getContactDisplayName: (j) => j.split('@')[0],
    listContacts: () => [],
    reply: (m) => { replyMsg = m; },
    chaosEventService: chaosEvent,
    args: [`@${vic.split('@')[0]}`, '10'],
    mentionedJids: [vic],
    quotedParticipant: '',
    sock: null,
    identityMap: null,
    msgTimeMs: now + 1000,
  });
  assert.match(replyMsg, /Aguarde/);
  assert.match(replyMsg, /\d+s/);
  assert.ok(!replyMsg.includes('cooldown'));
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('handler: target-busy mensagem amigável', async () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const chaosEvent = {
    isEventActive: () => ({ active: true }),
    doCrimeAssault: () => ({ ok: false, reason: 'target-busy', remainingMs: 3000 }),
  };
  let replyMsg = '';
  await handleAssaultCommand({
    userJid: uniqueJid('5752'),
    scopeKey: uniqueGroup(),
    marketService: null,
    funConfig: chaosConfig({}),
    getContactDisplayName: (j) => j.split('@')[0],
    listContacts: () => [],
    reply: (m) => { replyMsg = m; },
    chaosEventService: chaosEvent,
    args: ['@alvo', '50'],
    mentionedJids: [uniqueJid('5753')],
    quotedParticipant: '',
    sock: null,
    identityMap: null,
    msgTimeMs: Date.now(),
  });
  assert.match(replyMsg, /defendendo|conta/i);
  assert.ok(!replyMsg.includes('target-busy'));
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('anúncio: menciona cooldown e segundos de defesa configurados', () => {
  const { chaosEvent, started, cfg } = setupPurga({
    defense: true, cooldownMs: 30_000, graceMs: 0,
  });
  // force defense timeout 8s no cfg
  const cfg8 = { ...cfg, chaosEventDefenseTimeoutMs: 8000, chaosEventAssaultCooldownMs: 30_000 };
  const msg = chaosEvent.formatStartAnnouncement(started, cfg8);
  assert.match(msg, /8s/);
  assert.match(msg, /30s/);
  assert.match(msg, /Cooldown/);
  delete process.env.FUN_DISABLE_LIVE_LLM;
});
