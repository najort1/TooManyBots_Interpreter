import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createFunBondRepository } from '../fun/db/funBondRepository.js';
import { createBondService } from '../fun/services/bondService.js';
import { createPersonaChemistryService } from '../fun/services/personaChemistryService.js';

await initDb();

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

function uniqueJid(suffix = '') {
  return `551199${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 900 + 100)}${suffix}@s.whatsapp.net`;
}

const alice = uniqueJid('A');
const bob = uniqueJid('B');

const cfg = {
  zenEnabled: true,
  personaChemistryEnabled: true,
  // opts() aplica piso de 8 (mesmo convencionado em personaSocialHintsBatchSize / fun/config.js).
  personaChemistryBatchSize: 8,
  personaChemistryMaxAbsDelta: 8,
};

test('bondService.applyChemistryDelta: aplica e clampa deltas por eixo, marca lastAction=ai_chemistry', () => {
  const repo = createFunBondRepository({ getDatabase: getDb });
  const service = createBondService({ bondRepository: repo });
  const scope = uniqueGroup();
  const a = uniqueJid('X');
  const b = uniqueJid('Y');

  const result = service.applyChemistryDelta({
    scopeKey: scope,
    userA: a,
    userB: b,
    deltas: { affection: 50, rivalry: -2, intimacy: 3, chaos: 0 },
    maxAbsDelta: 8,
    now: 1_000_000,
  });

  assert.equal(result.ok, true);
  assert.equal(result.applied.affection, 8, 'afeto deve ser clampado em +8');
  assert.equal(result.applied.rivalry, -2);
  assert.equal(result.bond.affection, 8);
  assert.equal(result.bond.rivalry, 0, 'clamp(0 - 2) não pode ficar negativo');
  assert.equal(result.bond.intimacy, 3);
  assert.equal(result.bond.lastAction, 'ai_chemistry');
});

test('bondService.applyChemistryDelta: rejeita par inválido (mesmo usuário)', () => {
  const repo = createFunBondRepository({ getDatabase: getDb });
  const service = createBondService({ bondRepository: repo });
  const scope = uniqueGroup();
  const a = uniqueJid('Z');

  const result = service.applyChemistryDelta({ scopeKey: scope, userA: a, userB: a, deltas: {} });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid-participants');
});

test('personaChemistryService: trigger é SOMENTE contagem — abaixo do batchSize nunca avalia, mesmo com timestamps antigos', async () => {
  let calls = 0;
  const repo = createFunBondRepository({ getDatabase: getDb });
  const bondService = createBondService({ bondRepository: repo });
  const service = createPersonaChemistryService({
    bondService,
    generateZen: async () => {
      calls += 1;
      return JSON.stringify({ pairs: [] });
    },
  });
  const scope = uniqueGroup();
  const veryOld = 1;

  for (let i = 0; i < cfg.personaChemistryBatchSize - 1; i += 1) {
    service.observeMessage({
      scopeKey: scope,
      userJid: i % 2 === 0 ? alice : bob,
      text: `mensagem ${i}`,
      funConfig: cfg,
      now: veryOld,
    });
  }

  const manual = await service.flushScope(scope, cfg, Date.now());
  assert.equal(manual.ok, false);
  assert.equal(manual.reason, 'too-few');

  // Sweep do scheduler (flushDueScopes): buffer abaixo do limite NÃO avalia,
  // mesmo que "now" simule muito tempo depois — não existe timer de flush.
  const swept = await service.flushDueScopes(cfg, Date.now() + 999_999_999);
  assert.equal(swept.flushed, 0);
  assert.equal(calls, 0);
});

test('personaChemistryService: dispara ao atingir exatamente o batchSize e aplica deltas via bondService', async () => {
  const calls = [];
  const repo = createFunBondRepository({ getDatabase: getDb });
  const bondService = createBondService({ bondRepository: repo });
  const service = createPersonaChemistryService({
    bondService,
    getContactDisplayName: (jid) => (jid === alice ? 'Alice' : 'Bob'),
    generateZen: async (input) => {
      calls.push(input);
      return JSON.stringify({
        pairs: [
          { participants: [0, 1], evidence_msg: [0, 1], affection: 5, rivalry: 0, intimacy: 2, chaos: 0 },
        ],
      });
    },
  });
  const scope = uniqueGroup();

  for (let i = 0; i < cfg.personaChemistryBatchSize; i += 1) {
    service.observeMessage({
      scopeKey: scope,
      userJid: i % 2 === 0 ? alice : bob,
      text: `conversa ${i}`,
      funConfig: cfg,
      now: Date.now(),
    });
  }

  // A última mensagem já disparou o flush fire-and-forget (trigger de contagem).
  // Aguarda o microtask resolver antes de inspecionar efeitos colaterais.
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(calls.length, 1);
  assert.match(calls[0].prompt, /Alice/);
  assert.match(calls[0].prompt, /Bob/);

  const bond = bondService.getBondWithDecay(scope, alice, bob);
  assert.equal(bond.affection, 5);
  assert.equal(bond.intimacy, 2);
  assert.equal(bond.lastAction, 'ai_chemistry');
});

test('personaChemistryService: ignora pares inválidos (auto-par, índice fora do lote, duplicado)', async () => {
  const repo = createFunBondRepository({ getDatabase: getDb });
  const bondService = createBondService({ bondRepository: repo });
  const service = createPersonaChemistryService({
    bondService,
    generateZen: async () => JSON.stringify({
      pairs: [
        { participants: [0, 0], affection: 5 },
        { participants: [0, 99], affection: 5 },
        { participants: [0, 1], affection: 3, rivalry: 1 },
        { participants: [1, 0], affection: 9, rivalry: 9 },
      ],
    }),
  });
  const scope = uniqueGroup();

  for (let i = 0; i < cfg.personaChemistryBatchSize; i += 1) {
    service.observeMessage({
      scopeKey: scope,
      userJid: i % 2 === 0 ? alice : bob,
      text: `msg ${i}`,
      funConfig: cfg,
      now: Date.now(),
    });
  }

  await new Promise((resolve) => setTimeout(resolve, 0));

  const bond = bondService.getBondWithDecay(scope, alice, bob);
  assert.equal(bond.affection, 3, 'só o primeiro par válido deve ser aplicado');
  assert.equal(bond.rivalry, 1);
});

test('personaChemistryService: não observa nem chama LLM quando desativado (feature off / master off)', () => {
  let calls = 0;
  const repo = createFunBondRepository({ getDatabase: getDb });
  const bondService = createBondService({ bondRepository: repo });
  const service = createPersonaChemistryService({
    bondService,
    generateZen: async () => {
      calls += 1;
      return JSON.stringify({ pairs: [] });
    },
  });
  const scope = uniqueGroup();

  const offByFeature = service.observeMessage({
    scopeKey: scope, userJid: alice, text: 'oi', funConfig: { ...cfg, personaChemistryEnabled: false }, now: Date.now(),
  });
  assert.equal(offByFeature.observed, false);

  const offByMaster = service.observeMessage({
    scopeKey: scope, userJid: alice, text: 'oi', funConfig: { ...cfg, zenEnabled: false }, now: Date.now(),
  });
  assert.equal(offByMaster.observed, false);
  assert.equal(calls, 0);
});

test('personaChemistryService: resposta válida vazia {"pairs": []} não dispara retries redundantes', async () => {
  let calls = 0;
  const repo = createFunBondRepository({ getDatabase: getDb });
  const bondService = createBondService({ bondRepository: repo });
  const service = createPersonaChemistryService({
    bondService,
    generateZen: async () => {
      calls += 1;
      return JSON.stringify({ pairs: [] });
    },
  });
  const scope = uniqueGroup();

  for (let i = 0; i < cfg.personaChemistryBatchSize; i += 1) {
    service.observeMessage({
      scopeKey: scope,
      userJid: i % 2 === 0 ? alice : bob,
      text: `msg ${i}`,
      funConfig: cfg,
      now: Date.now(),
    });
  }

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 1, 'deve parar na primeira tentativa quando o JSON é válido');
});
