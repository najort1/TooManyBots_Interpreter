import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LLM_FEATURES,
  LLM_FEATURE_METADATA,
  isLlmFeatureEnabled,
  normalizeLlmFeatures,
  getLlmFeaturesStatus,
} from '../fun/llm/llmGovernance.js';
import { normalizeFunConfig, loadFunUserConfig, saveFunUserConfig } from '../fun/config.js';
import { generateQuizQuestions, FALLBACK_QUESTIONS } from '../fun/games/engines/quizRoyaleEngine.js';
import { createFlavorService } from '../fun/llm/flavorService.js';
import { startFunDashboardServer } from '../fun/dashboard/server.js';

describe('Governança Centralizada de LLM (fun/llm/llmGovernance)', () => {
  test('DEFAULT_LLM_FEATURES possui todas as features habilitadas por padrão', () => {
    assert.strictEqual(typeof DEFAULT_LLM_FEATURES, 'object');
    const expectedKeys = [
      'persona',
      'memory',
      'socialHints',
      'loreReconciliation',
      'flavor',
      'groupNews',
      'levelUp',
      'market',
      'dailyChallenge',
      'tarot',
      'qmp',
      'quizRoyale',
      'events',
      'selfHeal',
      'profile',
    ];

    for (const key of expectedKeys) {
      assert.strictEqual(DEFAULT_LLM_FEATURES[key], true, `Feature ${key} deve ser true por padrão`);
      assert.ok(LLM_FEATURE_METADATA[key], `Metadados de ${key} devem existir`);
      assert.ok(LLM_FEATURE_METADATA[key].name, `Nome de ${key} deve existir`);
      assert.ok(LLM_FEATURE_METADATA[key].fallback, `Fallback de ${key} deve existir`);
    }
  });

  test('Master Switch (zenEnabled=false) desativa TODAS as funcionalidades de LLM', () => {
    const configWithMasterOff = {
      zenEnabled: false,
      llmFeatures: {
        persona: true,
        quizRoyale: true,
        tarot: true,
      },
    };

    for (const key of Object.keys(DEFAULT_LLM_FEATURES)) {
      assert.strictEqual(
        isLlmFeatureEnabled(configWithMasterOff, key),
        false,
        `Feature ${key} deve estar desabilitada quando o Master Switch estiver OFF`
      );
    }

    const status = getLlmFeaturesStatus(configWithMasterOff);
    assert.strictEqual(status.masterEnabled, false);
    for (const item of status.items) {
      assert.strictEqual(item.active, false, `Item ${item.id} não pode estar active quando master=false`);
    }
  });

  test('Switches granulares desativam apenas a funcionalidade específica quando Master está ON', () => {
    const config = {
      zenEnabled: true,
      llmFeatures: {
        quizRoyale: false,
        tarot: false,
        persona: true,
      },
    };

    assert.strictEqual(isLlmFeatureEnabled(config, 'quizRoyale'), false);
    assert.strictEqual(isLlmFeatureEnabled(config, 'tarot'), false);
    assert.strictEqual(isLlmFeatureEnabled(config, 'persona'), true);
    assert.strictEqual(isLlmFeatureEnabled(config, 'memory'), true);
    assert.strictEqual(isLlmFeatureEnabled(config, 'flavor'), true);

    const status = getLlmFeaturesStatus(config);
    assert.strictEqual(status.masterEnabled, true);

    const quizItem = status.items.find((i) => i.id === 'quizRoyale');
    assert.strictEqual(quizItem?.enabled, false);
    assert.strictEqual(quizItem?.active, false);

    const personaItem = status.items.find((i) => i.id === 'persona');
    assert.strictEqual(personaItem?.enabled, true);
    assert.strictEqual(personaItem?.active, true);
  });

  test('normalizeFunConfig normaliza e preserva llmFeatures', () => {
    const raw = {
      zenEnabled: true,
      llmFeatures: {
        quizRoyale: false,
        persona: 'invalid-string', // deve converter para boolean
      },
    };

    const normalized = normalizeFunConfig(raw);
    assert.strictEqual(normalized.zenEnabled, true);
    assert.strictEqual(normalized.llmFeatures.quizRoyale, false);
    assert.strictEqual(normalized.llmFeatures.persona, true);
    assert.strictEqual(normalized.llmFeatures.flavor, true);
    assert.strictEqual(normalized.llmFeatures.dailyChallenge, true);
  });

  test('saveFunUserConfig preserva groupWhitelistJids existente em atualizações parciais', () => {
    const current = loadFunUserConfig();
    assert.ok(Array.isArray(current.groupWhitelistJids));
    const previousWhitelist = [...current.groupWhitelistJids];

    // Salva apenas alteração de LLM sem passar groupWhitelistJids
    const saved = saveFunUserConfig({
      zenEnabled: current.zenEnabled,
      llmFeatures: current.llmFeatures,
    });

    assert.deepStrictEqual(saved.groupWhitelistJids, previousWhitelist);
    const reloaded = loadFunUserConfig();
    assert.deepStrictEqual(reloaded.groupWhitelistJids, previousWhitelist);
  });
});

describe('Integração de LLM nos motores e serviços', () => {
  test('Quiz Royale Engine: desativa chamada LLM e usa fallback quando quizRoyale está desligado', async () => {
    let zenCalled = false;
    const mockGenerateZen = async () => {
      zenCalled = true;
      return '{"questions":[]}';
    };

    // Cenário 1: Feature desabilitada individualmente
    const questionsFeatureOff = await generateQuizQuestions({
      count: 8,
      funConfig: {
        zenEnabled: true,
        llmFeatures: { quizRoyale: false },
      },
      generateZen: mockGenerateZen,
    });

    assert.strictEqual(zenCalled, false, 'Não deve chamar generateZen quando quizRoyale=false');
    assert.strictEqual(questionsFeatureOff.length, 8);
    // Perguntas devem vir de FALLBACK_QUESTIONS
    assert.ok(FALLBACK_QUESTIONS.some((fb) => fb.question === questionsFeatureOff[0].question));

    // Cenário 2: Master Switch desabilitado
    zenCalled = false;
    const questionsMasterOff = await generateQuizQuestions({
      count: 8,
      funConfig: {
        zenEnabled: false,
        llmFeatures: { quizRoyale: true },
      },
      generateZen: mockGenerateZen,
    });

    assert.strictEqual(zenCalled, false, 'Não deve chamar generateZen quando zenEnabled=false');
    assert.strictEqual(questionsMasterOff.length, 8);

    // Cenário 3: Feature habilitada -> deve chamar generateZen
    zenCalled = false;
    await generateQuizQuestions({
      count: 8,
      funConfig: {
        zenEnabled: true,
        llmFeatures: { quizRoyale: true },
      },
      generateZen: mockGenerateZen,
    });

    assert.strictEqual(zenCalled, true, 'Deve chamar generateZen quando master e feature estiverem ativos');
  });

  test('FlavorService: desativa chamada LLM e usa template quando flavor ou master está desligado', async () => {
    let zenCalls = 0;
    let mockResponse = 'Mandou muito bem no jogo e levou a melhor agora';
    const mockGenerateZen = async () => {
      zenCalls++;
      return mockResponse;
    };

    let currentCfg = {
      zenEnabled: true,
      llmFeatures: { flavor: false, groupNews: true },
      flavorTimeoutMs: 1500,
    };

    const flavor = createFlavorService({
      getConfig: () => currentCfg,
      zenGenerate: mockGenerateZen,
      allowLiveLlm: true,
    });

    // 1. Feature 'flavor' desligada: deve retornar template sem chamar generateZen
    const resOff = await flavor.line('casino_win', { user: 'Alice', val: '100' });
    assert.strictEqual(zenCalls, 0, 'Não deve chamar generateZen com flavor=false');
    assert.ok(typeof resOff === 'string' && resOff.length > 0);

    // 2. Feature 'flavor' ligada: deve chamar generateZen
    currentCfg = {
      zenEnabled: true,
      llmFeatures: { flavor: true, groupNews: true },
      flavorTimeoutMs: 1500,
    };
    const resOn = await flavor.line('casino_win', { user: 'Alice', val: '100' });
    assert.strictEqual(zenCalls, 1, 'Deve chamar generateZen com flavor=true');
    assert.strictEqual(resOn, 'Mandou muito bem no jogo e levou a melhor agora');

    // 3. Feature 'groupNews' desligada: group_times não deve chamar LLM
    zenCalls = 0;
    currentCfg = {
      zenEnabled: true,
      llmFeatures: { flavor: true, groupNews: false },
      flavorTimeoutMs: 1500,
    };
    const newsOff = await flavor.chaosLine('group_times', { events: 'Hoje teve evento' });
    assert.strictEqual(zenCalls, 0, 'Não deve chamar generateZen com groupNews=false');
    assert.ok(typeof newsOff === 'string' && newsOff.length > 0);

    // 4. Master Switch desligado (zenEnabled=false): group_times não deve chamar LLM mesmo com groupNews=true
    zenCalls = 0;
    currentCfg = {
      zenEnabled: false,
      llmFeatures: { flavor: true, groupNews: true },
      flavorTimeoutMs: 1500,
    };
    const masterOffNews = await flavor.chaosLine('group_times', { events: 'Hoje teve evento' });
    assert.strictEqual(zenCalls, 0, 'Não deve chamar generateZen com zenEnabled=false');
    assert.ok(typeof masterOffNews === 'string' && masterOffNews.length > 0);

    // 5. Toggle de Level Up / XP (levelUp): desativa geração de IA no level_up quando false
    zenCalls = 0;
    currentCfg = {
      zenEnabled: true,
      llmFeatures: { flavor: true, levelUp: false },
      flavorTimeoutMs: 1500,
    };
    const levelUpOff = await flavor.italicLine('level_up', { level: 5, user: 'Bob' });
    assert.strictEqual(zenCalls, 0, 'Não deve chamar generateZen quando levelUp=false');

    // 6. Toggle de Level Up / XP (levelUp): aciona IA no level_up quando true
    zenCalls = 0;
    mockResponse = 'Subiu de nível com estilo e agora ninguém segura mais';
    currentCfg = {
      zenEnabled: true,
      llmFeatures: { flavor: true, levelUp: true },
      flavorTimeoutMs: 1500,
    };
    const levelUpOn = await flavor.italicLine('level_up', { level: 5, user: 'Bob' });
    assert.strictEqual(zenCalls, 1, 'Deve chamar generateZen quando levelUp=true');
    assert.ok(levelUpOn.includes('Subiu de nível com estilo e agora ninguém segura mais'));
  });
});

describe('Dashboard API: /api/fun/llm/config', () => {
  test('GET e POST /api/fun/llm/config controlam o estado do LLM e refletem em tempo de execução', async () => {
    let mockRuntimeConfig = {
      zenEnabled: true,
      zenBaseUrl: 'http://localhost:20128/v1',
      zenModel: 'bot-zap',
      llmFeatures: {
        ...DEFAULT_LLM_FEATURES,
      },
    };

    let updateCalledWith = null;

    const fakeFunModule = {
      _services: {
        repository: {},
        groupRepository: {},
      },
    };

    const server = await startFunDashboardServer({
      port: 0,
      getConfig: () => mockRuntimeConfig,
      updateConfig: (next) => {
        updateCalledWith = next;
        mockRuntimeConfig = next;
      },
      saveConfig: (next) => {
        mockRuntimeConfig = next;
        return next;
      },
      funModule: fakeFunModule,
    });

    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // 1. GET /api/fun/llm/config
      const getRes = await fetch(`${baseUrl}/api/fun/llm/config`);
      assert.strictEqual(getRes.status, 200);
      const getJson = await getRes.json();
      assert.strictEqual(getJson.ok, true);
      assert.strictEqual(getJson.zenEnabled, true);
      assert.strictEqual(getJson.masterEnabled, true);
      assert.ok(Array.isArray(getJson.items));
      assert.strictEqual(getJson.items.length, Object.keys(DEFAULT_LLM_FEATURES).length);

      // 2. POST /api/fun/llm/config desligando Master Switch
      const postMasterOffRes = await fetch(`${baseUrl}/api/fun/llm/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zenEnabled: false }),
      });
      assert.strictEqual(postMasterOffRes.status, 200);
      const postMasterOffJson = await postMasterOffRes.json();
      assert.strictEqual(postMasterOffJson.zenEnabled, false);
      assert.strictEqual(postMasterOffJson.masterEnabled, false);
      assert.strictEqual(updateCalledWith?.zenEnabled, false);

      // 3. POST /api/fun/llm/config ligando Master e desligando feature específica (tarot e quizRoyale)
      const postFeatureRes = await fetch(`${baseUrl}/api/fun/llm/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          zenEnabled: true,
          llmFeatures: { tarot: false, quizRoyale: false },
        }),
      });
      assert.strictEqual(postFeatureRes.status, 200);
      const postFeatureJson = await postFeatureRes.json();
      assert.strictEqual(postFeatureJson.zenEnabled, true);
      assert.strictEqual(postFeatureJson.llmFeatures.tarot, false);
      assert.strictEqual(postFeatureJson.llmFeatures.quizRoyale, false);
      assert.strictEqual(postFeatureJson.llmFeatures.persona, true);
      assert.strictEqual(updateCalledWith?.llmFeatures?.tarot, false);
      assert.strictEqual(updateCalledWith?.llmFeatures?.quizRoyale, false);
    } finally {
      server.close();
    }
  });
});
