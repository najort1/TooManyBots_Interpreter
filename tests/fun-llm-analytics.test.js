import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createFunLlmRepository } from '../fun/db/funLlmRepository.js';
import {
  setLlmMetricsRepository,
  recordLlmCall,
  recordLlmHit,
  getLlmMetrics,
  resetLlmMetrics,
} from '../fun/llm/llmMetrics.js';
import { openaiChatComplete } from '../fun/llm/openaiClient.js';
import { startFunDashboardServer } from '../fun/dashboard/server.js';

await initDb();

test('funLlmRepository: persiste chamadas e calcula estatísticas analíticas completas', () => {
  const repo = createFunLlmRepository({ getDatabase: getDb });
  const now = Date.now();
  const groupA = `120363${String(now).slice(-8)}11@g.us`;
  const groupB = `120363${String(now).slice(-8)}22@g.us`;
  const userA = '5511999990001@s.whatsapp.net';
  const userB = '5511999990002@s.whatsapp.net';

  // 1. Inserir chamadas com diferentes tarefas, tokens e tempos
  const res1 = repo.recordCall({
    createdAt: now - 3600_000,
    scopeKey: groupA,
    userJid: userA,
    task: 'invent',
    provider: 'zen',
    model: 'bot-zap',
    status: 'success',
    promptTokens: 120,
    completionTokens: 80,
    durationMs: 750,
    promptPreview: 'Crie uma espada mágica',
    responsePreview: '{"name":"Espada Relâmpago"}',
  });
  assert.equal(res1.ok, true);
  assert.ok(res1.id > 0);

  const res2 = repo.recordCall({
    createdAt: now - 1800_000,
    scopeKey: groupA,
    userJid: userB,
    task: 'roast',
    provider: 'zen',
    model: 'bot-zap',
    status: 'success',
    promptTokens: 200,
    completionTokens: 100,
    durationMs: 1200,
    promptPreview: 'Faça um roast do João',
    responsePreview: 'João perde até no cara ou coroa',
  });
  assert.equal(res2.ok, true);

  const res3 = repo.recordCall({
    createdAt: now - 600_000,
    scopeKey: groupB,
    userJid: userA,
    task: 'tarot',
    provider: 'template',
    model: 'template',
    status: 'fallback',
    promptTokens: 0,
    completionTokens: 0,
    durationMs: 0,
    promptPreview: 'Tiragem de cartas',
    responsePreview: 'A carta da Torre caiu...',
  });
  assert.equal(res3.ok, true);

  const res4 = repo.recordCall({
    createdAt: now - 100_000,
    scopeKey: groupB,
    userJid: userB,
    task: 'invent',
    provider: 'zen',
    model: 'bot-zap',
    status: 'error',
    promptTokens: 150,
    completionTokens: 0,
    durationMs: 5000,
    promptPreview: 'Crie um item misterioso',
    errorMessage: 'openai-timeout-5000ms',
  });
  assert.equal(res4.ok, true);

  // 2. Obter estatísticas globais
  const stats = repo.getStats({ fromTimestamp: now - 86_400_000, toTimestamp: now + 1000 });
  assert.ok(stats.summary);
  assert.ok(stats.summary.totalCalls >= 4);
  assert.ok(stats.summary.totalTokens >= 500);
  assert.ok(stats.summary.promptTokens >= 470);
  assert.ok(stats.summary.completionTokens >= 180);
  assert.ok(stats.summary.avgDurationMs > 0);
  assert.ok(stats.summary.fallbackCalls >= 1);

  // 3. Tarefas
  assert.ok(Array.isArray(stats.byTask));
  const inventTask = stats.byTask.find((t) => t.task === 'invent');
  assert.ok(inventTask);
  assert.ok(inventTask.calls >= 2);
  assert.ok(inventTask.totalTokens >= 270);

  // 4. Provedores e Modelos
  const zenProvider = stats.byProvider.find((p) => p.provider === 'zen');
  assert.ok(zenProvider);
  assert.ok(zenProvider.calls >= 3);

  // 5. Histórico Diário
  assert.ok(Array.isArray(stats.daily));
  assert.ok(stats.daily.length >= 1);

  // 6. Horas (0 a 23)
  assert.equal(stats.byHour.length, 24);

  // 7. Chamadas Recentes
  assert.ok(Array.isArray(stats.recentCalls));
  assert.ok(stats.recentCalls.length >= 4);
  const latest = stats.recentCalls[0];
  assert.ok(latest.task);
  assert.ok(latest.status);

  // 8. Filtro por grupo específico (groupA)
  const groupStats = repo.getStats({ scopeKey: groupA, fromTimestamp: now - 86_400_000 });
  assert.ok(groupStats.summary.totalCalls >= 2);
  for (const call of groupStats.recentCalls) {
    assert.equal(call.scopeKey, groupA);
  }
});

test('openaiChatComplete grava telemetria com tokens e latência via recordLlmCall', async () => {
  const repo = createFunLlmRepository({ getDatabase: getDb });
  setLlmMetricsRepository(repo);

  const now = Date.now();
  const mockFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: 'Resposta simulada com tokens' } }],
      usage: {
        prompt_tokens: 42,
        completion_tokens: 18,
        total_tokens: 60,
      },
    }),
  });

  const output = await openaiChatComplete({
    prompt: 'Olá bot de teste',
    task: 'test_task_tokens',
    scopeKey: 'test-group@g.us',
    userJid: 'test-user@s.whatsapp.net',
    fetchImpl: mockFetch,
  });

  assert.equal(output, 'Resposta simulada com tokens');

  const stats = repo.getStats({ fromTimestamp: now - 1000 });
  const recentTest = stats.recentCalls.find((c) => c.task === 'test_task_tokens');
  assert.ok(recentTest, 'Deve encontrar a chamada registrada no repositório');
  assert.equal(recentTest.promptTokens, 42);
  assert.equal(recentTest.completionTokens, 18);
  assert.equal(recentTest.totalTokens, 60);
  assert.equal(recentTest.status, 'success');
  assert.equal(recentTest.scopeKey, 'test-group@g.us');
  assert.equal(recentTest.userJid, 'test-user@s.whatsapp.net');
});

test('Dashboard API: GET /api/fun/llm/analytics retorna dados analíticos estruturados', async () => {
  const repo = createFunLlmRepository({ getDatabase: getDb });
  setLlmMetricsRepository(repo);

  // Inserir amostras
  repo.recordCall({
    task: 'flavor:casino_win',
    provider: 'zen',
    model: 'bot-zap',
    promptTokens: 80,
    completionTokens: 40,
    durationMs: 650,
  });

  const dummyFunModule = {
    _services: {
      repository: {},
      groupRepository: {
        listAllGroups: () => [{ jid: '1203639999@g.us', name: 'Grupo Amigos' }],
      },
      llmRepository: repo,
    },
  };

  const dummyConfig = {
    zenEnabled: true,
    zenBaseUrl: 'http://localhost:20128/v1',
    zenModel: 'bot-zap',
    dashboardPort: 0,
  };

  const server = await startFunDashboardServer({
    port: 0,
    getConfig: () => dummyConfig,
    funModule: dummyFunModule,
    getContactDisplayName: (jid) => (jid.includes('11') ? 'Carlos' : 'Anônimo'),
  });

  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/fun/llm/analytics?days=7`);
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.ok, true);
    assert.ok(body.summary, 'Deve conter summary');
    assert.ok(typeof body.summary.totalCalls === 'number');
    assert.ok(typeof body.summary.totalTokens === 'number');
    assert.ok(Array.isArray(body.daily));
    assert.ok(Array.isArray(body.byTask));
    assert.ok(Array.isArray(body.byProvider));
    assert.ok(Array.isArray(body.byHour));
    assert.equal(body.byHour.length, 24);
    assert.ok(Array.isArray(body.recentCalls));
    assert.ok(body.zenHealth);
  } finally {
    server.close();
  }
});

test('funLlmRepository: cálculo de P95 com amostras pequenas e poda de dados antigos', () => {
  const repo = createFunLlmRepository({ getDatabase: getDb });
  const uniqueTask = `p95_test_${Date.now()}`;

  // Inserir 20 chamadas com durações de 100 a 2000ms
  for (let i = 1; i <= 20; i++) {
    repo.recordCall({
      task: uniqueTask,
      durationMs: i * 100,
      createdAt: Date.now() - (i * 1000),
    });
  }

  const stats = repo.getStats({ limitRecent: 50 });
  assert.ok(stats.summary.p95DurationMs >= 1900, 'P95 de 20 itens deve ser o 19º ou 20º valor mais alto (>= 1900ms)');

  // Testar poda
  const pruneRes = repo.pruneOldCalls(365);
  assert.ok(typeof pruneRes.deleted === 'number');
});

test('serviços do bot Fun propagam task e scopeKey para chamadas LLM evitando fallback openai genérico', async () => {
  const { createPersonaSocialHintService } = await import('../fun/services/personaSocialHintService.js');
  const { createPersonaOpportunityDetector } = await import('../fun/services/personaOpportunityDetector.js');
  const { createGroupMemoryService } = await import('../fun/services/groupMemoryService.js');
  const { createLoreReconciliationService } = await import('../fun/services/loreReconciliationService.js');
  const { createEventBatchExtractor } = await import('../fun/events/eventBatchExtractor.js');

  const capturedCalls = [];
  const mockGenerateZen = async (params) => {
    capturedCalls.push(params);
    if (params.jsonMode || params.jsonOnly) {
      if (params.task === 'socialHints') return JSON.stringify({ hints: [] });
      if (params.task === 'personaOpportunity') return JSON.stringify({ action: 'pass', score: 10 });
      if (params.task === 'memory') return JSON.stringify({ facts: [] });
      if (params.task === 'loreReconciliation') return JSON.stringify({ removals: [] });
      if (params.task === 'events') return JSON.stringify({ operations: [] });
      return '{}';
    }
    return 'texto mock';
  };

  const testScope = '120363999999999999@g.us';

  // 1. personaSocialHintService
  const hintRepo = { upsertHints: () => 0, listRecentHints: () => [] };
  const hintService = createPersonaSocialHintService({
    repository: hintRepo,
    generateZen: mockGenerateZen,
  });
  // Simulate batch
  for (let i = 1; i <= 3; i++) {
    hintService.observeMessage({
      scopeKey: testScope,
      userJid: `user${i}@s.whatsapp.net`,
      text: `mensagem de teste ${i}`,
      funConfig: { personaSocialHintsBatchSize: 3, personaSocialHintsMinMessages: 3 },
    });
  }
  await hintService.flushScope(testScope, { personaSocialHintsMinMessages: 3 });

  const hintCall = capturedCalls.find((c) => c.task === 'socialHints');
  assert.ok(hintCall, 'personaSocialHintService deve enviar task socialHints');
  assert.equal(hintCall.scopeKey, testScope, 'personaSocialHintService deve enviar scopeKey');

  // 2. personaOpportunityDetector
  const oppDetector = createPersonaOpportunityDetector({
    autonomyPolicy: {
      evaluate: () => ({ eligible: true, score: 80 }),
      getScopeSnapshot: () => ({ inCooldown: false, cooldownRemainingMs: 0, budgetExhausted: false, hourlyCallsRemaining: 10 }),
    },
    generateZen: mockGenerateZen,
  });
  await oppDetector.evaluate({
    text: 'alguém sabe onde fica a quadra de vôlei?',
    authorJid: 'user1@s.whatsapp.net',
    authorLabel: 'Lucas',
    scopeKey: testScope,
    funConfig: { personaAutonomyEnabled: true, personaAutonomyLlmEnabled: true, personaAutonomyCandidateMinMessages: 0 },
  });
  const oppCall = capturedCalls.find((c) => c.task === 'personaOpportunity');
  assert.ok(oppCall, 'personaOpportunityDetector deve enviar task personaOpportunity');
  assert.equal(oppCall.scopeKey, testScope, 'personaOpportunityDetector deve enviar scopeKey');

  // 3. groupMemoryService
  const memRepo = {
    getRecentMemories: () => [],
    insertMemory: () => 1,
    listFacts: () => [],
    getPersona: () => ({ personaText: '' }),
  };
  const memService = createGroupMemoryService({
    memoryRepository: memRepo,
    generateZen: mockGenerateZen,
  });
  for (let i = 1; i <= 5; i++) {
    memService.observeMessage({
      scopeKey: testScope,
      userJid: `user${i}@s.whatsapp.net`,
      text: `aprendi a sacar por cima na quadra de volei ${i}`,
      funConfig: { memoryFlushMinMessages: 3 },
    });
  }
  await new Promise((r) => setTimeout(r, 60));
  const memCall = capturedCalls.find((c) => c.task === 'memory');
  assert.ok(memCall, 'groupMemoryService deve enviar task memory');
  assert.equal(memCall.scopeKey, testScope, 'groupMemoryService deve enviar scopeKey');

  // 4. loreReconciliationService
  const loreRepo = { listFacts: () => [{ id: '1', summary: 'fato antigo', created_at: Date.now() }], deleteFact: () => true };
  const loreService = createLoreReconciliationService({
    memoryRepository: loreRepo,
    generateZen: mockGenerateZen,
  });
  await loreService.observe({
    scopeKey: testScope,
    text: 'apaga essa história mentirosa da lore',
    funConfig: { loreReconciliationEnabled: true },
  });
  const loreCall = capturedCalls.find((c) => c.task === 'loreReconciliation');
  assert.ok(loreCall, 'loreReconciliationService deve enviar task loreReconciliation');
  assert.equal(loreCall.scopeKey, testScope, 'loreReconciliationService deve enviar scopeKey');

  // 5. eventBatchExtractor
  const eventExtractor = createEventBatchExtractor({
    generateZen: mockGenerateZen,
  });
  await eventExtractor.extractBatch({
    batch: [{ messageId: 'm1', authorJid: 'user1@s.whatsapp.net', text: 'vôlei amanhã 18h', timestamp: Date.now() }],
    contextCount: 0,
    funConfig: { groupEventsEnabled: true },
    scopeKey: testScope,
  });
  const eventCall = capturedCalls.find((c) => c.task === 'events');
  assert.ok(eventCall, 'eventBatchExtractor deve enviar task events');
  assert.equal(eventCall.scopeKey, testScope, 'eventBatchExtractor deve enviar scopeKey');
});
