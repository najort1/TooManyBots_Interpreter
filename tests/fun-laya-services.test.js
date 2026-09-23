import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoreReconciliationService } from '../fun/services/loreReconciliationService.js';
import { createPersonaSocialHintService } from '../fun/services/personaSocialHintService.js';

test('loreReconciliationService: Laya detecta ausência de retração e economiza chamada ao Zen', async () => {
  let zenCalled = false;
  let layaCalled = false;

  const mockRepo = {
    listFacts: () => [{ id: '1', summary: 'Fato de teste do grupo' }],
    deleteFact: () => true,
  };

  const fakeZen = async () => {
    zenCalled = true;
    return JSON.stringify({ removals: [] });
  };

  const fakeLaya = async () => {
    layaCalled = true;
    return {
      ok: true,
      answers: {
        has_retraction: { noul: 0.1 }, // Apenas 10% de chance de ser retração
      },
    };
  };

  const service = createLoreReconciliationService({
    memoryRepository: mockRepo,
    generateZen: fakeZen,
    predictLaya: fakeLaya,
  });

  const res = await service.observe({
    scopeKey: '123@g.us',
    text: 'esquecer isso que eu disse',
    funConfig: {
      layaEnabled: true,
      layaLoreReconciliationEnabled: true,
      loreReconciliationEnabled: true,
      zenEnabled: true,
    },
  });

  assert.equal(layaCalled, true);
  assert.equal(zenCalled, false); // Zen não foi chamado!
  assert.equal(res.ok, true);
  assert.equal(res.removed, 0);
  assert.equal(res.reason, 'laya-no-retraction');
});

test('loreReconciliationService: fallback para Zen quando Laya falha', async () => {
  let zenCalled = false;

  const mockRepo = {
    listFacts: () => [{ id: '1', summary: 'Fato de teste do grupo' }],
    deleteFact: () => true,
  };

  const fakeZen = async () => {
    zenCalled = true;
    return JSON.stringify({ removals: [{ factId: '1', reason: 'pedido explícito' }] });
  };

  const fakeLaya = async () => {
    return { ok: false, reason: 'timeout', fallback: true };
  };

  const service = createLoreReconciliationService({
    memoryRepository: mockRepo,
    generateZen: fakeZen,
    predictLaya: fakeLaya,
  });

  const res = await service.observe({
    scopeKey: '123@g.us',
    text: 'esquecer isso que eu disse',
    funConfig: {
      layaEnabled: true,
      layaLoreReconciliationEnabled: true,
      loreReconciliationEnabled: true,
      zenEnabled: true,
    },
  });

  assert.equal(zenCalled, true); // Fallback Zen ativado
  assert.equal(res.ok, true);
  assert.equal(res.removed, 1);
});

test('personaSocialHintService: Laya infere sinal social e grava no repository', async () => {
  let zenCalled = false;
  let savedHints = [];

  const mockRepo = {
    upsertHints: (scope, hints) => {
      savedHints = hints;
      return hints.length;
    },
  };

  const fakeZen = async () => {
    zenCalled = true;
    return JSON.stringify({ hints: [] });
  };

  const fakeLaya = async () => {
    return {
      ok: true,
      answers: {
        social_signal: { choice: 'positive' },
        confidence: { score: 1.8 },
      },
    };
  };

  const service = createPersonaSocialHintService({
    repository: mockRepo,
    generateZen: fakeZen,
    predictLaya: fakeLaya,
  });

  // Observa mensagens até atingir o mínimo de flush
  for (let i = 0; i < 8; i += 1) {
    service.observeMessage({
      scopeKey: '123@g.us',
      userJid: 'user1@s.whatsapp.net',
      text: `mensagem de zoeira ${i}`,
      messageType: 'text',
      funConfig: {
        personaSocialHintsEnabled: true,
        layaEnabled: true,
        layaSocialHintsEnabled: true,
        zenEnabled: true,
        personaSocialHintsMinMessages: 8,
        personaSocialHintsBatchSize: 8,
      },
    });
  }

  // Dá tempo para a promise de flush assíncrona resolver
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(zenCalled, false); // Zen poupado!
  assert.equal(savedHints.length, 1);
  assert.equal(savedHints[0].socialSignal, 'positive');
  assert.equal(savedHints[0].participantJid, 'user1@s.whatsapp.net');
});
