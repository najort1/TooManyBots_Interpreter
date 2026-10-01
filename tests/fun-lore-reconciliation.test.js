import test from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { DEFAULT_FUN_CONFIG } from '../fun/constants.js';
import { resolveFunConfig } from '../fun/config.js';
import { createFunMemoryRepository } from '../fun/db/funMemoryRepository.js';
import { createLoreReconciliationService } from '../fun/services/loreReconciliationService.js';

await initDb();
delete process.env.FUN_DISABLE_LIVE_LLM;

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

function uniqueJid(prefix = '5511') {
  return `${prefix}${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 90 + 10)}@s.whatsapp.net`;
}

test('reconciliation: detecta novos termos de retratacao (tira, nao gosto, etc)', async () => {
  const memory = createFunMemoryRepository({ getDatabase: getDb });
  const scope = uniqueGroup();
  const fact = memory.insertFact({ scopeKey: scope, summary: 'Lucas bateu o celta no poste', score: 80 });

  let called = false;
  const service = createLoreReconciliationService({
    memoryRepository: memory,
    generateZen: async () => {
      called = true;
      return JSON.stringify({ removals: [{ factId: fact.id, reason: 'usuario pediu para tirar' }] });
    },
  });

  const result = await service.observe({
    scopeKey: scope,
    text: 'tira isso aí, não gosto dessa piada do celta',
    funConfig: resolveFunConfig({}),
    now: 1000,
  });

  assert.equal(called, true);
  assert.equal(result.ok, true);
  assert.equal(result.removed, 1);
  assert.equal(memory.getFact(fact.id), null);
});

test('reconciliation: repassa quotedText e autor para o prompt da LLM', async () => {
  const memory = createFunMemoryRepository({ getDatabase: getDb });
  const scope = uniqueGroup();
  const author = uniqueJid('5511');
  const fact = memory.insertFact({ scopeKey: scope, summary: 'Beto comprou uma moto velha', subjects: [author] });

  let capturedPrompt = '';
  const service = createLoreReconciliationService({
    memoryRepository: memory,
    generateZen: async ({ prompt }) => {
      capturedPrompt = prompt;
      return JSON.stringify({ removals: [{ factId: fact.id, reason: 'mentira' }] });
    },
  });

  await service.observe({
    scopeKey: scope,
    text: 'mentira pura, apaga',
    quotedText: 'Beto comprou uma moto velha e caiu',
    quotedParticipant: author,
    quotedParticipantName: 'Beto',
    authorJid: author,
    authorName: 'Beto Silva',
    funConfig: resolveFunConfig({}),
    now: 2000,
  });

  assert.ok(capturedPrompt.includes('Beto Silva'), 'prompt deve conter o nome do autor');
  assert.ok(capturedPrompt.includes('Beto comprou uma moto velha e caiu'), 'prompt deve conter a mensagem citada');
});

test('reconciliation: candidate ranker prioriza fato com palavra-chave sobre fato com maior score geral', async () => {
  const memory = createFunMemoryRepository({ getDatabase: getDb });
  const scope = uniqueGroup();
  // Fato irrelevante mas com score altíssimo
  memory.insertFact({ scopeKey: scope, summary: 'Pedro danca valsa todo sabado', score: 99 });
  // Fato relevante com score baixo
  const targetFact = memory.insertFact({ scopeKey: scope, summary: 'Carlos tem medo de barata voadora', keywords: ['barata', 'medo'], score: 40 });

  let promptCandidates = '';
  const service = createLoreReconciliationService({
    memoryRepository: memory,
    generateZen: async ({ prompt }) => {
      promptCandidates = prompt;
      return JSON.stringify({ removals: [{ factId: targetFact.id, reason: 'superado' }] });
    },
  });

  await service.observe({
    scopeKey: scope,
    text: 'supera essa piada da barata gente, chega',
    funConfig: resolveFunConfig({ loreReconciliationMaxCandidates: 1 }), // limit 1
    now: 3000,
  });

  assert.ok(promptCandidates.includes(targetFact.id), 'candidato selecionado deve ser o que tem a palavra-chave barata');
});

test('reconciliation: cooldown curto (debounce 5s) em caso de zero remocoes permite mensagem de esclarecimento', async () => {
  const memory = createFunMemoryRepository({ getDatabase: getDb });
  const scope = uniqueGroup();
  const fact = memory.insertFact({ scopeKey: scope, summary: 'Historico de piada', score: 50 });

  let callCount = 0;
  const service = createLoreReconciliationService({
    memoryRepository: memory,
    generateZen: async () => {
      callCount += 1;
      if (callCount === 1) {
        return JSON.stringify({ removals: [] }); // primeira tentativa: vago, sem remocao
      }
      return JSON.stringify({ removals: [{ factId: fact.id, reason: 'agora detalhou' }] });
    },
  });

  const cfg = resolveFunConfig({ loreReconciliationCooldownMs: 60_000, loreReconciliationMissCooldownMs: 5_000 });

  // 1ª msg vaga aos 10.000ms -> retorna 0 removals
  const res1 = await service.observe({ scopeKey: scope, text: 'tira isso', funConfig: cfg, now: 10_000 });
  assert.equal(res1.ok, true);
  assert.equal(res1.removed, 0);

  // 2ª msg 2s depois (12.000ms) -> bloqueada pelo debounce curto
  const res2 = await service.observe({ scopeKey: scope, text: 'tira a piada', funConfig: cfg, now: 12_000 });
  assert.equal(res2.ok, false);
  assert.equal(res2.reason, 'cooldown');

  // 3ª msg 6s depois (16.000ms) -> passa pelo debounce e executa com sucesso!
  const res3 = await service.observe({ scopeKey: scope, text: 'tira o Historico de piada', funConfig: cfg, now: 16_000 });
  assert.equal(res3.ok, true);
  assert.equal(res3.removed, 1);
  assert.equal(callCount, 2);
});

test('reconciliation: feedback via Baileys reaction no messageKey quando ackMode=react', async () => {
  const memory = createFunMemoryRepository({ getDatabase: getDb });
  const scope = uniqueGroup();
  const fact = memory.insertFact({ scopeKey: scope, summary: 'Fato apagavel', score: 50 });

  let reactionSent = null;
  const mockSock = {
    sendMessage: async (jid, payload) => {
      reactionSent = { jid, payload };
      return { key: { id: 'ack' } };
    },
  };

  const service = createLoreReconciliationService({
    memoryRepository: memory,
    generateZen: async () => JSON.stringify({ removals: [{ factId: fact.id, reason: 'ok' }] }),
  });

  const res = await service.observe({
    scopeKey: scope,
    text: 'apaga esse fato pfv',
    messageKey: { remoteJid: scope, id: 'msg123' },
    sock: mockSock,
    funConfig: resolveFunConfig({ loreReconciliationAckMode: 'react', loreReconciliationAckEmoji: '🗑️' }),
    now: 20_000,
  });

  assert.equal(res.ok, true);
  assert.equal(res.removed, 1);
  assert.deepEqual(reactionSent, {
    jid: scope,
    payload: { react: { text: '🗑️', key: { remoteJid: scope, id: 'msg123' } } },
  });
});
