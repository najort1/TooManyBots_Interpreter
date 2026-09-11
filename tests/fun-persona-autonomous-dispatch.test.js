import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createFunPersonaRepository } from '../fun/db/funPersonaRepository.js';
import { createFunGroupRepository } from '../fun/db/funGroupRepository.js';
import { createPersonaService } from '../fun/services/personaService.js';
import { createIdentityMap } from '../fun/utils/identity.js';

const group = `120363${String(Date.now()).slice(-10)}88@g.us`;
const author = '5511999999999@s.whatsapp.net';
const bot = '5511888888888@s.whatsapp.net';

await initDb();

function setup(action, onRecord = () => {}) {
  const personaRepository = createFunPersonaRepository({ getDatabase: getDb });
  const groupRepository = createFunGroupRepository({ getDatabase: getDb });
  const policy = { recordSent: (...args) => onRecord(...args), observeHumanMessage: () => {} };
  const detector = { evaluate: async () => ({ eligible: true, action, score: 95, reason: 'llm-opportunity' }) };
  const service = createPersonaService({
    personaRepository,
    groupRepository,
    personaAutonomyPolicy: policy,
    personaOpportunityDetector: detector,
    getLogger: () => null,
  });
  return { service, policy };
}

for (const action of [
  { type: 'react', emoji: '😂' },
  { type: 'sticker', slug: 'rindo_muito' },
  { type: 'text', text: 'isso foi de base kkkkk' },
]) {
  test(`persona autonomous dispatch: despacha uma única ação ${action.type} e só registra após confirmação`, async () => {
    let records = 0;
    const { service } = setup(action, () => { records += 1; });
    const sent = [];
    const result = await service.tryRespond({
      scopeKey: group,
      text: 'olha isso kkkkk',
      messageType: 'text',
      authorJid: author,
      sock: { user: { id: bot }, sendMessage: async () => ({ key: { id: 'fallback' } }) },
      identityMap: createIdentityMap(),
      funConfig: { personaEnabled: true, personaAutonomyEnabled: true, replyQuoted: false },
      dispatchAutonomousAction: async (dispatched) => {
        sent.push(dispatched);
        return { key: { id: `autonomous-${action.type}` } };
      },
      responseContextPack: { immediateContext: [] },
      now: 1_700_000_000_000,
    });

    assert.equal(result.responded, true);
    assert.equal(result.trigger, 'autonomous');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, action.type);
    assert.equal(records, 1);
  });
}

test('persona autonomous dispatch: rejeição da fila não cria fallback nem consome orçamento', async () => {
  let records = 0;
  const { service } = setup({ type: 'react', emoji: '😂' }, () => { records += 1; });
  const result = await service.tryRespond({
    scopeKey: group,
    text: 'olha isso kkkkk',
    messageType: 'text',
    authorJid: author,
    sock: { user: { id: bot }, sendMessage: async () => ({ key: { id: 'should-not-send' } }) },
    identityMap: createIdentityMap(),
    funConfig: { personaEnabled: true, personaAutonomyEnabled: true },
    dispatchAutonomousAction: async () => ({ skipped: true, reason: 'output-queue-rejected' }),
    responseContextPack: { immediateContext: [] },
    now: 1_700_000_000_000,
  });

  assert.equal(result.responded, false);
  assert.equal(result.reason, 'autonomous-dispatch-failed');
  assert.equal(records, 0);
});

test('persona autonomous dispatch: lote com buffer acumula e despacha apenas ao atingir 40 mensagens', async () => {
  const { createPersonaOpportunityDetector } = await import('../fun/services/personaOpportunityDetector.js');
  const personaRepository = createFunPersonaRepository({ getDatabase: getDb });
  const groupRepository = createFunGroupRepository({ getDatabase: getDb });
  let records = 0;
  const policy = {
    evaluate: () => ({ eligible: true, score: 90, reason: 'llm-preflight' }),
    recordSent: () => { records += 1; },
    observeHumanMessage: () => {},
  };

  let zenCalls = 0;
  const detector = createPersonaOpportunityDetector({
    autonomyPolicy: policy,
    generateZen: async () => {
      zenCalls += 1;
      return JSON.stringify({
        action: 'react',
        target_message_index: 15,
        score: 95,
        reason: 'reação de lote',
        emoji: '🎯',
        stickerSlug: null,
        commentText: null,
      });
    },
  });

  const service = createPersonaService({
    personaRepository,
    groupRepository,
    personaAutonomyPolicy: policy,
    personaOpportunityDetector: detector,
    getLogger: () => null,
  });

  const funConfig = {
    personaEnabled: true,
    personaAutonomyEnabled: true,
    personaAutonomyLlmEnabled: true,
    personaAutonomyBatchSize: 40,
    personaAutonomyBatchContextMessages: 10,
    replyQuoted: false,
  };

  const sent = [];
  const dispatchAutonomousAction = async (dispatched) => {
    sent.push(dispatched);
    return { key: { id: 'autonomous-batch-react' } };
  };

  // Enviar 39 mensagens não endereçadas: todas devem ser observadas/acumuladas e não responder
  for (let i = 1; i <= 39; i += 1) {
    const res = await service.tryRespond({
      scopeKey: group,
      text: `mensagem de grupo ${i}`,
      messageType: 'text',
      authorJid: author,
      sock: { user: { id: bot } },
      identityMap: createIdentityMap(),
      funConfig,
      dispatchAutonomousAction,
      responseContextPack: { immediateContext: [] },
      now: 1_700_000_000_000 + i,
    });
    assert.equal(res.responded, false);
    assert.equal(res.reason, 'buffering');
  }

  assert.equal(zenCalls, 0);
  assert.equal(sent.length, 0);
  assert.equal(records, 0);

  // A 40ª mensagem dispara a avaliação em lote da LLM
  const res40 = await service.tryRespond({
    scopeKey: group,
    text: 'mensagem de grupo 40',
    messageType: 'text',
    authorJid: author,
    sock: { user: { id: bot } },
    identityMap: createIdentityMap(),
    funConfig,
    dispatchAutonomousAction,
    responseContextPack: { immediateContext: [] },
    now: 1_700_000_000_000 + 40,
  });

  assert.equal(res40.responded, true);
  assert.equal(res40.trigger, 'autonomous');
  assert.equal(zenCalls, 1);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], { type: 'react', emoji: '🎯' });
  assert.equal(records, 1);
});

test('persona autonomous dispatch: menção direta continua respondendo imediatamente sem esperar lote', async () => {
  const personaRepository = createFunPersonaRepository({ getDatabase: getDb });
  const groupRepository = createFunGroupRepository({ getDatabase: getDb });
  const policy = { recordSent: () => {}, observeHumanMessage: () => {} };
  const detector = {
    observeMessage: () => ({ observed: true, shouldFlush: false, count: 1 }),
    evaluateBatch: async () => ({ eligible: false, reason: 'buffering' }),
  };

  const service = createPersonaService({
    personaRepository,
    groupRepository,
    personaAutonomyPolicy: policy,
    personaOpportunityDetector: detector,
    getLogger: () => null,
  });

  const res = await service.tryRespond({
    scopeKey: group,
    text: 'bot como você tá?',
    messageType: 'text',
    authorJid: author,
    sock: {
      user: { id: bot },
      sendMessage: async () => ({ key: { id: 'immediate-mention-response' } }),
    },
    identityMap: createIdentityMap(),
    funConfig: { personaEnabled: true, personaAutonomyEnabled: true },
    responseContextPack: { immediateContext: [] },
    now: 1_700_000_000_000,
  });

  assert.equal(res.responded, true);
  assert.equal(res.trigger, 'mention');
});

test('persona autonomous dispatch: entrega targetMeta com targetKey da mensagem alvo no lote', async () => {
  const personaRepository = createFunPersonaRepository({ getDatabase: getDb });
  const groupRepository = createFunGroupRepository({ getDatabase: getDb });
  const policy = { recordSent: () => {}, observeHumanMessage: () => {} };
  const targetKey = { remoteJid: group, id: 'TARGET_GTA_MSG_ID', fromMe: false };
  const detector = {
    evaluate: async () => ({
      eligible: true,
      action: { type: 'react', emoji: '🔥' },
      score: 85,
      reason: 'zoar gta',
      targetMessage: {
        messageKey: targetKey,
        quoteSource: { key: targetKey },
        text: 'GTA 6 vai ser absurdo',
      },
    }),
  };

  const service = createPersonaService({
    personaRepository,
    groupRepository,
    personaAutonomyPolicy: policy,
    personaOpportunityDetector: detector,
    getLogger: () => null,
  });

  let dispatchedAction = null;
  let dispatchedMeta = null;
  const res = await service.tryRespond({
    scopeKey: group,
    text: 'mensagem 40 aleatória',
    messageType: 'text',
    authorJid: author,
    sock: { user: { id: bot } },
    identityMap: createIdentityMap(),
    funConfig: { personaEnabled: true, personaAutonomyEnabled: true },
    dispatchAutonomousAction: async (action, targetMeta) => {
      dispatchedAction = action;
      dispatchedMeta = targetMeta;
      return { key: { id: 'sent-react' } };
    },
    responseContextPack: { immediateContext: [] },
    now: 1_700_000_000_000,
  });

  assert.equal(res.responded, true);
  assert.equal(dispatchedAction.type, 'react');
  assert.equal(dispatchedAction.emoji, '🔥');
  assert.deepEqual(dispatchedMeta.targetKey, targetKey);
  assert.deepEqual(dispatchedMeta.targetQuoteSource.key, targetKey);
});

