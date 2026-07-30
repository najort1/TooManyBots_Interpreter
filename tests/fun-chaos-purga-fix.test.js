/**
 * Testes das correções: tracker de atividade próprio, escudo anti-assalto, duplo roubo.
 * Valida fixes dos bugs #1, #2, E1/E3, E5.
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
import { createMarketService } from '../fun/services/marketService.js';
import { createChaosEventService } from '../fun/services/chaosEventService.js';
import { resolveFunConfig } from '../fun/index.js';

await initDb();
_resetDefaultFunStatsRepository();

let _jidSeq = 0;
function uniqueJid(prefix = '5511') {
  _jidSeq += 1;
  return `${prefix}${String(Date.now()).slice(-5)}${_jidSeq}${Math.floor(Math.random() * 900 + 100)}@s.whatsapp.net`;
}
let _groupSeq = 0;
function uniqueGroup() {
  _groupSeq += 1;
  return `120363${String(Date.now()).slice(-8)}${_groupSeq}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

const NO_DEFENSE = { chaosEventDefenseEnabled: false };

function setup(extra = {}) {
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const market = createMarketService({ repository: repo, marketRepository: marketRepo, random: () => 0.5 });
  const chaosEvent = createChaosEventService({
    repository: repo,
    eventRepository: eventRepo,
    getMarketService: () => market,
    random: () => 0.01,
  });
  const scope = uniqueGroup();
  const atk = uniqueJid('5591');
  const vic = uniqueJid('5592');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 1000, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 1000, reason: 'seed' });
  const cfg = resolveFunConfig({
    chaosEventEnabled: true,
    chaosEventHour: 20,
    chaosEventMinute: 30,
    chaosEventNoWeaponSuccess: 1.0,
    chaosEventAssaultCooldownMs: 0,
    chaosEventDefenseDeliveryGraceMs: 0,
    ...extra,
    ...NO_DEFENSE,
  });
  const now = Date.now();
  chaosEvent.tryStartEvent(scope, cfg, now, { force: true });
  return { repo, eventRepo, marketRepo, market, chaosEvent, scope, atk, vic, cfg, now };
}

test('FIX #1: tracker interno bloqueia alvo AFK sem depender de conversation_events', () => {
  const { chaosEvent, scope, atk, vic, cfg, now } = setup();
  // Simula: vítima ativa há 5 min (fora da janela de 3 min)
  chaosEvent.registerActivity(scope, vic, now - 5 * 60_000);
  // Sem conversation_events — tracker interno é a fonte
  const r = chaosEvent.doCrimeAssault({
    attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 50, funConfig: cfg, now,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'inactive-target');
});

test('FIX #1: tracker interno libera alvo ativo dentro da janela', () => {
  const { chaosEvent, scope, atk, vic, cfg, now } = setup();
  chaosEvent.registerActivity(scope, vic, now - 60_000); // 1 min atrás
  const r = chaosEvent.doCrimeAssault({
    attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 50, funConfig: cfg, now,
  });
  assert.equal(r.ok, true);
  assert.equal(r.success, true);
});

test('FIX #2: escudo anti-assalto persistia quando conversation_events vazio — agora tracker interno desfaz', () => {
  const { chaosEvent, scope, atk, vic, cfg, now } = setup();
  const atk2 = uniqueJid('5593');
  // Vítima ativa antes do roubo
  chaosEvent.registerActivity(scope, vic, now - 30_000);
  // Roubo 1
  const first = chaosEvent.doCrimeAssault({
    attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 40, funConfig: cfg, now: now + 1000,
  });
  assert.equal(first.stolen, 40);

  // Sem nova atividade → bloqueado (escudo)
  const second = chaosEvent.doCrimeAssault({
    attackerJid: atk2, targetJid: vic, scopeKey: scope, amount: 40, funConfig: cfg, now: now + 2000,
  });
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'victim-silent-after-rob');

  // Vítima manda mensagem depois do roubo → escudo desfaz
  chaosEvent.registerActivity(scope, vic, now + 3000);
  const third = chaosEvent.doCrimeAssault({
    attackerJid: atk2, targetJid: vic, scopeKey: scope, amount: 40, funConfig: cfg, now: now + 4000,
  });
  assert.equal(third.ok, true);
  assert.equal(third.success, true);
  assert.ok(third.stolen > 0);
});

test('FIX #2: escudo não impede assalto se vítima nunca foi roubada antes', () => {
  const { chaosEvent, scope, atk, vic, cfg, now } = setup();
  chaosEvent.registerActivity(scope, vic, now - 30_000);
  const r = chaosEvent.doCrimeAssault({
    attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 50, funConfig: cfg, now,
  });
  assert.equal(r.ok, true);
  assert.equal(r.success, true);
});

test('FIX E1/E3: tryStartEvent limpa lastRobbedAt entre purgas (sem formatEndAnnouncement)', () => {
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const market = createMarketService({ repository: repo, marketRepository: marketRepo, random: () => 0.5 });
  const chaosEvent = createChaosEventService({
    repository: repo,
    eventRepository: eventRepo,
    getMarketService: () => market,
    random: () => 0.01,
  });
  const scope = uniqueGroup();
  const atk = uniqueJid('5601');
  const vic = uniqueJid('5602');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 1000, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 1000, reason: 'seed' });
  const cfg = resolveFunConfig({
    chaosEventEnabled: true, chaosEventHour: 20, chaosEventMinute: 30,
    chaosEventNoWeaponSuccess: 1.0, chaosEventAssaultCooldownMs: 0,
    chaosEventDefenseEnabled: false, chaosEventDefenseDeliveryGraceMs: 0,
  });

  // Purga 1
  const now1 = Date.now();
  chaosEvent.tryStartEvent(scope, cfg, now1, { force: true });
  chaosEvent.registerActivity(scope, vic, now1 - 30_000);
  const r1 = chaosEvent.doCrimeAssault({
    attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 40, funConfig: cfg, now: now1 + 1000,
  });
  assert.equal(r1.stolen, 40);
  // Vítima agora muda — NÃO chama formatEndAnnouncement (simula crash/announce pulado)
  const now2 = now1 + 24 * 60 * 60_000;
  // Purga 2 — tryStartEvent deve limpar lastRobbedAt
  chaosEvent.tryStartEvent(scope, cfg, now2, { force: true });
  chaosEvent.registerActivity(scope, vic, now2 - 30_000);
  const r2 = chaosEvent.doCrimeAssault({
    attackerJid: atk, targetJid: vic, scopeKey: scope, amount: 40, funConfig: cfg, now: now2 + 1000,
  });
  // Sem escudo residual de purga 1
  assert.equal(r2.ok, true, 'purga 2 não deve herdar escudo de purga 1');
  assert.equal(r2.success, true);
});

test('FIX E5: duplo roubo evitado — resolve de desafio hard-expirado re-checa escudo', () => {
  const { repo, eventRepo, marketRepo, market, scope, cfg, now } = (() => {
    const r = createFunStatsRepository({ getDatabase: getDb });
    r.ensureFunSchema();
    const er = createFunEventRepository({ getDatabase: getDb });
    const mr = createFunMarketRepository({ getDatabase: getDb });
    const m = createMarketService({ repository: r, marketRepository: mr, random: () => 0.5 });
    const ce = createChaosEventService({
      repository: r, eventRepository: er, getMarketService: () => m, random: () => 0.01,
    });
    const sc = uniqueGroup();
    const cfg = resolveFunConfig({
      chaosEventEnabled: true, chaosEventHour: 20, chaosEventMinute: 30,
      chaosEventNoWeaponSuccess: 1.0, chaosEventAssaultCooldownMs: 0,
      chaosEventDefenseEnabled: true, chaosEventDefenseTimeoutMs: 4000, chaosEventDefenseDeliveryGraceMs: 0,
    });
    const now = Date.now();
    ce.tryStartEvent(sc, cfg, now, { force: true });
    return { repo: r, eventRepo: er, marketRepo: mr, market: m, chaosEvent: ce, scope: sc, cfg, now };
  })();

  const atk1 = uniqueJid('5611');
  const atk2 = uniqueJid('5612');
  const vic = uniqueJid('5613');
  repo.addCoins({ userJid: atk1, scopeKey: scope, amount: 500, reason: 'seed' });
  repo.addCoins({ userJid: atk2, scopeKey: scope, amount: 500, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 500, reason: 'seed' });

  // Atividade da vítima antes do roubo
  const chaosEvent = createChaosEventService({
    repository: repo, eventRepository: eventRepo, getMarketService: () => market, random: () => 0.01,
  });
  chaosEvent.tryStartEvent(scope, cfg, now, { force: true });
  chaosEvent.registerActivity(scope, vic, now - 30_000);

  // atk1 ataca → desafio pendente
  const p1 = chaosEvent.doCrimeAssault({
    attackerJid: atk1, targetJid: vic, scopeKey: scope, amount: 40, funConfig: cfg, now: now + 1000,
  });
  assert.equal(p1.success, 'pending');

  // Aguarda hard-expiração (4s timeout + 0 grace)
  const afterHard = now + 6000;
  // atk2 tenta atacar — resolve interno do desafio do atk1 → roubo → escudo
  // Re-checa escudo → atk2 bloqueado (nÃO duplo roubo)
  const r2 = chaosEvent.doCrimeAssault({
    attackerJid: atk2, targetJid: vic, scopeKey: scope, amount: 30, funConfig: cfg, now: afterHard,
  });
  assert.equal(r2.ok, false, 'escudo após timeout-resolve deve bloquear atk2');
  assert.equal(r2.reason, 'victim-silent-after-rob');
});
