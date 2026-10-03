import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createFunBondRepository } from '../fun/db/funBondRepository.js';
import { createBondService, classifyBond } from '../fun/services/bondService.js';

await initDb();

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

function uniqueJid(suffix = '') {
  return `551199${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 900 + 100)}${suffix}@s.whatsapp.net`;
}

test('funBondRepository: normaliza par (userA < userB) independentemente da ordem', () => {
  const repo = createFunBondRepository({ getDatabase: getDb });
  const u1 = '5511999990001@s.whatsapp.net';
  const u2 = '5511999990002@s.whatsapp.net';

  const pair1 = repo.normalizePair(u1, u2);
  const pair2 = repo.normalizePair(u2, u1);

  assert.equal(pair1.userA, u1);
  assert.equal(pair1.userB, u2);
  assert.equal(pair2.userA, u1);
  assert.equal(pair2.userB, u2);
});

test('funBondRepository: cria vínculo padrão (strangers) e recupera corretamente', () => {
  const repo = createFunBondRepository({ getDatabase: getDb });
  const scope = uniqueGroup();
  const a = uniqueJid('1');
  const b = uniqueJid('2');

  const bond = repo.getBond(scope, a, b);
  assert.equal(bond.scopeKey, scope);
  assert.equal(bond.affection, 0);
  assert.equal(bond.rivalry, 0);
  assert.equal(bond.intimacy, 0);
  assert.equal(bond.chaos, 0);
  assert.equal(bond.archetype, 'strangers');
  assert.equal(bond.interactionsCount, 0);
});

test('bondService: recordAction aplica deltas por ação e atualiza arquétipo', () => {
  const repo = createFunBondRepository({ getDatabase: getDb });
  const service = createBondService({ bondRepository: repo });
  const scope = uniqueGroup();
  const a = uniqueJid('A');
  const b = uniqueJid('B');
  const t0 = 1_000_000;

  // A beija B
  const r1 = service.recordAction({
    scopeKey: scope,
    actorJid: a,
    targetJid: b,
    action: 'kiss',
    now: t0,
  });

  assert.equal(r1.ok, true);
  assert.ok(r1.bond.affection > 0, 'Afeto deve aumentar com kiss');
  assert.ok(r1.bond.intimacy > 0, 'Intimidade deve aumentar com kiss');
  assert.equal(r1.bond.interactionsCount, 1);

  // B esbofeteia A (retaliação / conflito)
  const r2 = service.recordAction({
    scopeKey: scope,
    actorJid: b,
    targetJid: a,
    action: 'slap',
    now: t0 + 10_000,
  });

  assert.equal(r2.ok, true);
  assert.ok(r2.bond.rivalry > 0, 'Rivalidade deve aumentar com slap');
  assert.ok(r2.bond.chaos > 0, 'Caos deve aumentar com slap');
  assert.equal(r2.bond.interactionsCount, 2);
});

test('bondService: soft-cap diário aplica diminishing returns (100% -> 60% -> 30% -> 0%)', () => {
  const repo = createFunBondRepository({ getDatabase: getDb });
  const service = createBondService({ bondRepository: repo });
  const scope = uniqueGroup();
  const a = uniqueJid('A');
  const b = uniqueJid('B');
  const t0 = 2_000_000;

  const act1 = service.recordAction({ scopeKey: scope, actorJid: a, targetJid: b, action: 'hug', now: t0 });
  assert.equal(act1.multiplier, 1.0);

  const act2 = service.recordAction({ scopeKey: scope, actorJid: b, targetJid: a, action: 'hug', now: t0 + 1000 });
  assert.equal(act2.multiplier, 0.6);

  const act3 = service.recordAction({ scopeKey: scope, actorJid: a, targetJid: b, action: 'hug', now: t0 + 2000 });
  assert.equal(act3.multiplier, 0.3);

  const act4 = service.recordAction({ scopeKey: scope, actorJid: b, targetJid: a, action: 'hug', now: t0 + 3000 });
  assert.equal(act4.multiplier, 0.0);
  assert.equal(act4.saturated, true);
});

test('bondService: classifyBond mapeia coordenadas para arquétipos esperados', () => {
  assert.equal(classifyBond({ affection: 0, rivalry: 0, intimacy: 0, chaos: 0 }).key, 'strangers');
  assert.equal(classifyBond({ affection: 60, rivalry: 50, intimacy: 30, chaos: 20 }).key, 'love_hate');
  assert.equal(classifyBond({ affection: 80, rivalry: 10, intimacy: 60, chaos: 10 }).key, 'soulmates');
  assert.equal(classifyBond({ affection: 10, rivalry: 75, intimacy: 20, chaos: 60 }).key, 'archnemesis');
  assert.equal(classifyBond({ affection: 25, rivalry: 20, intimacy: 55, chaos: 65 }).key, 'partners_in_crime');
  assert.equal(classifyBond({ affection: 15, rivalry: 65, intimacy: 10, chaos: 20 }).key, 'bitter_rivals');
});

test('bondService: detecção de procs — Reação Crítica e Esquiva Cômica', () => {
  const repo = createFunBondRepository({ getDatabase: getDb });
  const service = createBondService({
    bondRepository: repo,
    random: () => 0.01, // força proc
  });
  const scope = uniqueGroup();
  const a = uniqueJid('A');
  const b = uniqueJid('B');

  // Vínculo inicial sem rivalidade alta: chance de reação crítica com afeto
  const resCrit = service.checkReactionProc({
    scopeKey: scope,
    actorJid: a,
    targetJid: b,
    action: 'kiss',
    bond: { affection: 80, rivalry: 10, intimacy: 70, chaos: 10, archetype: 'soulmates' },
  });
  assert.equal(resCrit.procType, 'critical_reaction');
  assert.ok(resCrit.bonusXp > 0);

  // Vínculo com rivalidade altíssima tentando kiss: esquiva cômica
  const resDodge = service.checkReactionProc({
    scopeKey: scope,
    actorJid: a,
    targetJid: b,
    action: 'kiss',
    bond: { affection: 5, rivalry: 70, intimacy: 10, chaos: 30, archetype: 'bitter_rivals' },
  });
  assert.equal(resDodge.procType, 'comedic_dodge');
  assert.equal(resDodge.blocked, true);
});

test('bondService: janela de contra-tapa (45 segundos) após um /slap', () => {
  const repo = createFunBondRepository({ getDatabase: getDb });
  const service = createBondService({ bondRepository: repo });
  const scope = uniqueGroup();
  const a = uniqueJid('A');
  const b = uniqueJid('B');
  const t0 = 5_000_000;

  // A dá um slap em B
  service.recordAction({ scopeKey: scope, actorJid: a, targetJid: b, action: 'slap', now: t0 });

  // B confere se tem janela de contra-tapa contra A
  const windowActive = service.getCounterSlapWindow(scope, b, a, t0 + 20_000);
  assert.equal(windowActive.active, true);
  assert.ok(windowActive.remainingMs > 0);

  // Após 50 segundos, a janela expira
  const windowExpired = service.getCounterSlapWindow(scope, b, a, t0 + 50_000);
  assert.equal(windowExpired.active, false);
});

test('bondService: decaimento temporal assimétrico reduz rivalidade e caos mais rápido que afeto', () => {
  const repo = createFunBondRepository({ getDatabase: getDb });
  const service = createBondService({ bondRepository: repo });
  const scope = uniqueGroup();
  const a = uniqueJid('A');
  const b = uniqueJid('B');
  const t0 = 10_000_000;

  // Cria vínculo com valores altos
  repo.upsertBondRaw({
    scopeKey: scope,
    userA: repo.normalizePair(a, b).userA,
    userB: repo.normalizePair(a, b).userB,
    affection: 80,
    rivalry: 80,
    intimacy: 80,
    chaos: 80,
    lastInteractionAt: t0,
    lastDecayAt: t0,
    updatedAt: t0,
  });

  // 3 dias depois sem nenhuma interação
  const threeDaysLater = t0 + 3 * 24 * 60 * 60 * 1000;
  const decayed = service.getBondWithDecay(scope, a, b, threeDaysLater);

  assert.ok(decayed.rivalry < 80, 'Rivalidade deve ter decaído');
  assert.ok(decayed.chaos < 80, 'Caos deve ter decaído');
  assert.ok(decayed.affection < 80, 'Afeto deve ter decaído');
  assert.ok(decayed.intimacy < 80, 'Intimidade deve ter decaído');

  // Rivalidade e Caos decaem em taxa maior que Intimidade
  const lossRivalry = 80 - decayed.rivalry;
  const lossIntimacy = 80 - decayed.intimacy;
  assert.ok(lossRivalry > lossIntimacy, 'Rivalidade deve esfriar mais rápido que intimidade');

  // Verifica que o decaimento foi persistido duravelmente no banco de dados (CRITICAL #2)
  const persistedInDb = repo.getBond(scope, a, b);
  assert.equal(persistedInDb.rivalry, decayed.rivalry, 'Decaimento deve persistir duravelmente no SQLite');
  assert.equal(persistedInDb.lastDecayAt, threeDaysLater, 'lastDecayAt deve ser atualizado no banco');
});

test('bondService: reação afetuosa em vínculo diário saturado não ativa proc de moedas nem XP', () => {
  const repo = createFunBondRepository({ getDatabase: getDb });
  const service = createBondService({
    bondRepository: repo,
    random: () => 0.01, // Força proc crítico se elegível (chance >= 1%)
  });

  const scope = uniqueGroup();
  const a = uniqueJid();
  const b = uniqueJid();

  // Executa 3 ações no dia para saturar o soft-cap diário
  service.recordAction({ scopeKey: scope, actorJid: a, targetJid: b, action: 'kiss' });
  service.recordAction({ scopeKey: scope, actorJid: b, targetJid: a, action: 'cuddle' });
  service.recordAction({ scopeKey: scope, actorJid: a, targetJid: b, action: 'hug' });

  // Na 4ª ação do dia, o vínculo está saturado (dailyPointsAcc >= 3)
  const saturatedProc = service.checkReactionProc({
    scopeKey: scope,
    actorJid: a,
    targetJid: b,
    action: 'kiss',
  });

  assert.equal(saturatedProc.procType, 'none', 'Proc não deve disparar quando a relação já estiver saturada no dia');
  assert.equal(saturatedProc.bonusCoins, undefined, 'Nenhuma moeda deve ser emitida no estado saturado');
});
