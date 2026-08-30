import test from 'node:test';
import assert from 'node:assert/strict';
import { createExtractionAdapters } from '../fun/services/extractionAdapters/index.js';
import { createGroupMemoryService } from '../fun/services/groupMemoryService.js';
import { createPersonaService } from '../fun/services/personaService.js';

function createMockMemoryRepo() {
  const facts = [];
  let persona = '';

  return {
    listFacts: (scopeKey, opts = {}) => {
      let res = facts.filter((f) => f.scopeKey === scopeKey);
      if (opts.minScore != null) res = res.filter((f) => f.score >= opts.minScore);
      return res.slice(0, opts.limit || 50);
    },
    insertFact: (fact) => {
      const rec = { id: `fact-${facts.length + 1}`, hits: 1, ...fact };
      facts.push(rec);
      return rec;
    },
    reinforceFact: (id, patch) => {
      const f = facts.find((x) => x.id === id);
      if (f) Object.assign(f, patch, { hits: (f.hits || 1) + 1 });
      return f;
    },
    decayAndPurge: () => {},
    pruneToCap: () => {},
    setPersona: (scopeKey, text) => {
      persona = text;
    },
    getPersona: () => ({ personaText: persona, generatedAt: Date.now() }),
    _facts: facts,
  };
}

function createMockPersonaRepo() {
  let profile = null;
  return {
    getProfile: () => profile,
    upsertProfile: (p) => { profile = p; return { ok: true }; },
    getActiveThread: () => null,
    openThread: () => ({ id: 'thread-1', turnCount: 1 }),
    setAnchor: () => ({ ok: true }),
  };
}

function createMockGroupRepo() {
  return {
    getGroupSettings: () => ({ personaEnabled: true }),
  };
}

test('E2E: fluxo de extração com todos os adaptadores habilitados', async () => {
  const funConfig = {
    memoryEnabled: true,
    memoryFlushMinMessages: 3,
    memoryMinMsgChars: 6,
    personaEnabled: true,
    extractionAdapters: {
      parseGuard: { enabled: true },
      evidenceEnricher: { enabled: true },
      bufferLock: { enabled: true },
      batchDedup: { enabled: true, minScore: 80, windowHours: 24 },
      promptContext: { enabled: true },
      metricsRecorder: { enabled: true, sink: 'none' },
    },
  };

  const adapters = createExtractionAdapters({ funConfig });
  const memoryRepository = createMockMemoryRepo();
  const personaRepository = createMockPersonaRepo();
  const groupRepository = createMockGroupRepo();

  // Mock LLM de extração retornando JSON válido com kind estendido ('humor')
  const mockGenerateZen = async ({ system, prompt }) => {
    if (system?.includes('extrai FATOS')) {
      return JSON.stringify({
        facts: [
          {
            kind: 'humor', // parseGuard deve normalizar para 'running_gag'
            summary: 'Lucas perdeu no truco e teve que pagar o lanche de todo mundo',
            subjects: [0],
            keywords: ['truco', 'lanche'],
            score: 75,
          },
        ],
      });
    }
    if (system?.includes('membro comum de um grupo')) {
      return 'kkkkk o Lucas sempre perde no truco mano';
    }
    return '';
  };

  const groupMemoryService = createGroupMemoryService({
    memoryRepository,
    generateZen: mockGenerateZen,
    adapters,
  });

  const profileService = {
    getProfile: (jid) => ({
      nickname: 'Lucas Truqueiro',
      bio: 'O pior jogador de truco de SP',
      extras: 'gosta de pedir 6 quando não tem nada',
    }),
    displayName: (jid) => 'Lucas Truqueiro',
  };

  const personaService = createPersonaService({
    personaRepository,
    groupRepository,
    profileService,
    generateZen: mockGenerateZen,
    adapters,
  });

  const scopeKey = '123456789@g.us';
  const now = Date.now();

  // 1. Observa 2 mensagens (sem disparar o trigger automático ainda)
  groupMemoryService.observeMessage({
    scopeKey,
    userJid: 'lucas@s.whatsapp.net',
    text: 'galera perdi no truco de novo vou pagar o lanche',
    messageId: 'msg-101',
    funConfig,
    now,
  });
  groupMemoryService.observeMessage({
    scopeKey,
    userJid: 'pedro@s.whatsapp.net',
    text: 'kkkkkkkk boa Lucas já escolhe o podrão',
    messageId: 'msg-102',
    funConfig,
    now,
  });
  groupMemoryService.observeMessage({
    scopeKey,
    userJid: 'marcos@s.whatsapp.net',
    text: 'eu quero x-tudo com bacon',
    messageId: 'msg-103',
    funConfig: { ...funConfig, memoryFlushMinMessages: 10 }, // Não dispara auto-flush aqui
    now,
  });

  // Executa flush explicitamente e aguarda conclusão
  const flushResult = await groupMemoryService.flushScope(scopeKey, funConfig, now);
  assert.equal(flushResult.ok, true);
  assert.equal(flushResult.inserted, 1);

  // Verifica que o fato salvo foi processado pelo parseGuard e evidenceEnricher
  const savedFacts = memoryRepository.listFacts(scopeKey);
  assert.equal(savedFacts.length, 1);
  assert.ok(savedFacts[0].summary.includes('Lucas perdeu no truco'));
  assert.ok(savedFacts[0]._parseGuard != null); // trace adicionado pelo parseGuard
  assert.ok(savedFacts[0]._parseGuard.confidence >= 50);
  assert.equal(savedFacts[0].evidence.status, 'linked'); // enriquecido pelo evidenceEnricher
  assert.equal(savedFacts[0].evidence.messageId, 'msg-101');
  assert.equal(savedFacts[0].evidence.authorJid, 'lucas@s.whatsapp.net');

  // 2. Persona respondendo ao Lucas com PromptContextBuilder
  const sentMessages = [];
  const fakeSock = {
    sendMessage: async (scope, payload) => {
      sentMessages.push(payload.text);
      return { key: { id: 'bot-msg-1' } };
    },
  };

  const personaResp = await personaService.tryRespond({
    scopeKey,
    authorJid: 'lucas@s.whatsapp.net',
    text: 'bot o que você acha do meu truco?',
    messageType: 'text',
    funConfig,
    sock: fakeSock,
    now,
  });

  assert.equal(personaResp.responded, true);
  assert.ok(personaResp.response.includes('Lucas'));

  // 3. Verifica métricas gravadas
  const recorded = adapters.metricsRecorder.getMetrics();
  assert.ok(recorded.length >= 4);
  assert.ok(recorded.some((m) => m.metric.startsWith('parseGuard')));
  assert.ok(recorded.some((m) => m.metric.startsWith('evidenceEnricher')));
});
