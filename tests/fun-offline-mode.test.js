/**
 * Testes unitários para o Modo Offline / Econômico e resiliência de LLM (TooManyBots Fun).
 *
 * Garante que quando zenEnabled: false ou quando o servidor Zen está offline:
 * 1. Nenhuma retentativa de rede é feita.
 * 2. Comandos respondem instantaneamente com fallbacks mockados em pt-BR.
 * 3. Buffers não entram em loop infinito.
 * 4. Self-healing não polui o banco com erros falsos.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from '../db/index.js';
import { checkZenConnectivity } from '../fun/llm/zenHealthCheck.js';
import { createPersonaService } from '../fun/services/personaService.js';
import { createPersonaSocialHintService } from '../fun/services/personaSocialHintService.js';
import { createFunModule } from '../fun/index.js';
import { createEventAggregationService } from '../fun/events/eventAggregationService.js';

await initDb();

test('checkZenConnectivity retorna explicitamente desativado quando zenEnabled: false', async () => {
  const result = await checkZenConnectivity({ zenEnabled: false });
  assert.equal(result.online, false);
  assert.equal(result.reason, 'explicitly-disabled');
});

test('checkZenConnectivity falha graciosamente em porta fechada sem lançar erro', async () => {
  // Usa uma porta improvável em localhost para simular serviço indisponível
  const result = await checkZenConnectivity(
    {
      zenEnabled: true,
      zenBaseUrl: 'http://127.0.0.1:59999/v1',
      zenApiKey: '',
    },
    { timeoutMs: 500 }
  );

  assert.equal(result.online, false);
  assert.ok(result.reason);
});

test('personaService responde instantaneamente com fallback quando zenEnabled: false', async () => {
  let networkCalls = 0;
  const dummyZen = async () => {
    networkCalls += 1;
    throw new Error('Não deveria chamar rede no modo econômico!');
  };

  const personaService = createPersonaService({
    generateZen: dummyZen,
    personaRepository: {
      getProfile: () => null,
      upsertProfile: () => ({}),
      getActiveThread: () => null,
      getActiveThreadByAnchor: () => null,
      openThread: () => ({ id: 'thread-1' }),
      continueThread: () => ({ id: 'thread-1' }),
      setAnchor: () => ({}),
    },
    groupRepository: {
      getGroupSettings: () => ({ personaEnabled: true }),
    },
    userProfileRepository: {
      getProfile: () => null,
    },
    getLogger: () => ({
      debug: () => {},
      warn: () => {},
      info: () => {},
    }),
  });

  const responseText = await personaService.generateResponse({
    text: 'Olá bot, como você está?',
    scopeKey: '120363000000000000@g.us',
    userJid: '5511999999999@s.whatsapp.net',
    funConfig: {
      zenEnabled: false,
      personaEnabled: true,
    },
  });

  assert.equal(networkCalls, 0, 'Zero chamadas de rede esperadas no modo econômico');
  assert.equal(responseText, '', 'generateResponse deve retornar vazio imediatamente sem chamar rede');
  const fallback = personaService.fallbackResponse(Date.now());
  assert.ok(fallback, 'Deve retornar mensagem válida de fallback em pt-BR');
});

test('personaSocialHintService aborta flushScope com reason llm-disabled quando zenEnabled: false', async () => {
  let networkCalls = 0;
  const dummyZen = async () => {
    networkCalls += 1;
    throw new Error('Não deveria chamar rede!');
  };

  const dummyRepo = {
    saveHints: () => 0,
    listRecentHints: () => [],
  };

  const hintService = createPersonaSocialHintService({
    repository: dummyRepo,
    generateZen: dummyZen,
  });

  const result = await hintService.flushScope('120363000000000000@g.us', {
    zenEnabled: false,
    personaSocialHintsEnabled: true,
    personaSocialHintsMinMessages: 1,
  });

  assert.equal(networkCalls, 0);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'disabled');
});

test('fun module tickWorldEvents não dispara selfHealing quando zenEnabled: false', async () => {
  let sweepCalled = 0;
  const funModule = createFunModule({
    getConfig: () => ({
      enabled: true,
      selfHealEnabled: true,
      zenEnabled: false,
      selfHealIntervalMs: 0,
      worldQuietHoursEnabled: false,
      groupWhitelistJids: ['120363000000000000@g.us'],
    }),
    selfHealingService: {
      runSweep: async () => {
        sweepCalled += 1;
        return { ok: true };
      },
    },
  });

  await funModule.init();
  await funModule.tickWorldEvents({ now: Date.now() });
  assert.equal(sweepCalled, 0, 'Não deve chamar selfHealing.runSweep no tick quando zenEnabled: false');
});

test('eventAggregationService não re-enfileira mensagens em loop infinito quando extractor retorna llm-disabled', async () => {
  const eventAggregation = createEventAggregationService({
    eventRepository: {
      getByAnySourceMessage: () => null,
      markPastEvents: () => {},
      listByScope: () => [],
    },
    eventBatchExtractor: {
      extractBatch: async () => ({ ok: false, reason: 'llm-disabled' }),
    },
  });

  const scopeKey = '120363000000000000@g.us';
  const funConfig = {
    groupEventsEnabled: true,
    groupEventBatchSize: 40,
    groupEventBatchContextMessages: 0,
  };

  for (let i = 0; i < 39; i += 1) {
    await eventAggregation.observeMessage({
      scopeKey,
      userJid: `551199999999${i}@s.whatsapp.net`,
      text: `Churrasco no sábado às 14h - ${i}`,
      messageId: `MSG_${i}`,
      isGroup: true,
      funConfig,
    });
  }

  eventAggregation._buffers.get(scopeKey).flushing = true;
  await eventAggregation.observeMessage({
    scopeKey,
    userJid: '55119999999999@s.whatsapp.net',
    text: 'Churrasco no sábado às 14h - 39',
    messageId: 'MSG_39',
    isGroup: true,
    funConfig,
  });
  eventAggregation._buffers.get(scopeKey).flushing = false;

  const result = await eventAggregation.flushScope(scopeKey, funConfig);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'llm-disabled');
  assert.equal(result.requeued, 0, 'Não deve re-enfileirar mensagens');
});
