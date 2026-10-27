import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LLM_FEATURES,
  DEFAULT_LLM_MODELS,
  LLM_FEATURE_METADATA,
  isLlmFeatureEnabled,
  normalizeLlmFeatures,
  normalizeLlmModels,
  resolveLlmModel,
  getLlmFeaturesStatus,
} from '../fun/llm/llmGovernance.js';
import { normalizeFunConfig, loadFunUserConfig, saveFunUserConfig } from '../fun/config.js';
import { generateQuizQuestions, FALLBACK_QUESTIONS } from '../fun/games/engines/quizRoyaleEngine.js';
import { createFlavorService } from '../fun/llm/flavorService.js';
import { startFunDashboardServer } from '../fun/dashboard/server.js';
import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createFunMemoryRepository } from '../fun/db/funMemoryRepository.js';
import { createGroupMemoryService } from '../fun/services/groupMemoryService.js';
import { createPersonaSocialHintService } from '../fun/services/personaSocialHintService.js';
import { createFunPersonaSocialHintRepository } from '../fun/db/funPersonaSocialHintRepository.js';
import { createPersonaService } from '../fun/services/personaService.js';
import { createFunPersonaRepository } from '../fun/db/funPersonaRepository.js';
import { createFunGroupRepository } from '../fun/db/funGroupRepository.js';

await initDb();

function uniqueJid(prefix = '5511') {
  return `${prefix}${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 90 + 10)}@s.whatsapp.net`;
}

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

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
      'chemistry',
    ];

    for (const key of expectedKeys) {
      // socialHints desativado por padrão (experimento): substituído por chemistry.
      const expectedDefault = key === 'selfHeal' || key === 'socialHints' ? false : true;
      assert.strictEqual(DEFAULT_LLM_FEATURES[key], expectedDefault, `Feature ${key} deve ser ${expectedDefault} por padrão`);
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

    // 7. Cenário de Ship / Relacionamentos: aciona IA mesmo quando flavor=false se chemistry ou persona estiver ativo
    zenCalls = 0;
    mockResponse = 'Clima tenso no grupo mas todo mundo sabe que combina';
    currentCfg = {
      zenEnabled: true,
      llmFeatures: { flavor: false, chemistry: true, persona: true },
      flavorTimeoutMs: 1500,
    };
    const shipWithFlavorOff = await flavor.italicLine('ship', { a: 'Alice', b: 'Bob', percent: 80, label: 'Química forte' });
    assert.strictEqual(zenCalls, 1, 'Deve chamar generateZen para ship mesmo com flavor=false quando chemistry=true');
    assert.ok(shipWithFlavorOff.includes('Clima tenso no grupo mas todo mundo sabe que combina'));

    // 8. Se chemistry, persona e flavor estiverem todos false: ship não chama LLM
    zenCalls = 0;
    currentCfg = {
      zenEnabled: true,
      llmFeatures: { flavor: false, chemistry: false, persona: false },
      flavorTimeoutMs: 1500,
    };
    const shipAllOff = await flavor.italicLine('ship', { a: 'Alice', b: 'Bob', percent: 80, label: 'Química forte' });
    assert.strictEqual(zenCalls, 0, 'Não deve chamar generateZen para ship quando chemistry, persona e flavor forem false');
    assert.ok(typeof shipAllOff === 'string' && shipAllOff.length > 0);
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

describe('Overrides de modelo por funcionalidade (llmModels)', () => {
  test('DEFAULT_LLM_MODELS cobre todas as chaves de feature, vazias (herdam zenModel)', () => {
    assert.strictEqual(typeof DEFAULT_LLM_MODELS, 'object');
    for (const key of Object.keys(DEFAULT_LLM_FEATURES)) {
      assert.ok(
        Object.hasOwn(DEFAULT_LLM_MODELS, key),
        `DEFAULT_LLM_MODELS deve possuir a chave ${key}`
      );
      assert.strictEqual(DEFAULT_LLM_MODELS[key], '', `Override de ${key} deve iniciar vazio`);
    }
    assert.ok(LLM_FEATURE_METADATA.personaOpportunity, 'Metadados de personaOpportunity devem existir');
    assert.strictEqual(DEFAULT_LLM_FEATURES.personaOpportunity, true);
  });

  test('normalizeLlmModels descarta chaves inválidas e valores não-string', () => {
    const normalized = normalizeLlmModels({
      persona: '  modelo-limpo  ',
      memory: 42,
      chemistry: null,
      inexistente: 'ignorado',
    });

    assert.deepStrictEqual(Object.keys(normalized).sort(), Object.keys(DEFAULT_LLM_MODELS).sort());
    assert.strictEqual(normalized.persona, 'modelo-limpo');
    assert.strictEqual(normalized.memory, '');
    assert.strictEqual(normalized.chemistry, '');
    assert.strictEqual(normalized.tarot, '');
    assert.ok(!Object.hasOwn(normalized, 'inexistente'));

    const empty = normalizeLlmModels('lixo');
    assert.deepStrictEqual(empty, { ...DEFAULT_LLM_MODELS });
  });

  test('normalizeLlmModels trunca valores acima de 160 caracteres', () => {
    const normalized = normalizeLlmModels({ flavor: 'x'.repeat(400) });
    assert.strictEqual(normalized.flavor.length, 160);
  });

  test('resolveLlmModel devolve zenModel quando não há override', () => {
    const cfg = { zenModel: 'modelo-padrao' };
    assert.strictEqual(resolveLlmModel(cfg, 'persona'), 'modelo-padrao');
    assert.strictEqual(resolveLlmModel(cfg, 'socialHints'), 'modelo-padrao');
    assert.strictEqual(resolveLlmModel(cfg, 'memory'), 'modelo-padrao');
    assert.strictEqual(resolveLlmModel(cfg, 'chemistry'), 'modelo-padrao');
    assert.strictEqual(resolveLlmModel(cfg, 'quizRoyale'), 'modelo-padrao');
    assert.strictEqual(resolveLlmModel(cfg, 'tarot'), 'modelo-padrao');
    assert.strictEqual(resolveLlmModel(cfg, 'profile'), 'modelo-padrao');
    assert.strictEqual(resolveLlmModel(cfg, 'personaOpportunity'), 'modelo-padrao');
  });

  test('resolveLlmModel respeita override de persona sem afetar as demais', () => {
    const cfg = { zenModel: 'modelo-padrao', llmModels: { persona: 'modelo-y' } };
    assert.strictEqual(resolveLlmModel(cfg, 'persona'), 'modelo-y');
    assert.strictEqual(resolveLlmModel(cfg, 'socialHints'), 'modelo-padrao');
    assert.strictEqual(resolveLlmModel(cfg, 'memory'), 'modelo-padrao');
    assert.strictEqual(resolveLlmModel(cfg, 'qmp'), 'modelo-padrao');
  });

  test('resolveLlmModel ignora override vazio ou só com espaços', () => {
    const cfg = { zenModel: 'modelo-padrao', llmModels: { socialHints: '   ' } };
    assert.strictEqual(resolveLlmModel(cfg, 'socialHints'), 'modelo-padrao');
  });

  test('resolveLlmModel respeita override de socialHints/Memory/Chemistry/Tarot/Profile', () => {
    const cfg = {
      zenModel: 'modelo-padrao',
      llmModels: {
        persona: 'modelo-persona',
        socialHints: 'modelo-social',
        memory: 'modelo-memory',
        chemistry: 'modelo-chemistry',
        loreReconciliation: 'modelo-lore',
        tarot: 'modelo-tarot',
        profile: 'modelo-profile',
        personaOpportunity: 'modelo-opportunity',
        quizRoyale: 'modelo-quiz',
      },
    };
    assert.strictEqual(resolveLlmModel(cfg, 'persona'), 'modelo-persona');
    assert.strictEqual(resolveLlmModel(cfg, 'socialHints'), 'modelo-social');
    assert.strictEqual(resolveLlmModel(cfg, 'memory'), 'modelo-memory');
    assert.strictEqual(resolveLlmModel(cfg, 'chemistry'), 'modelo-chemistry');
    assert.strictEqual(resolveLlmModel(cfg, 'loreReconciliation'), 'modelo-lore');
    assert.strictEqual(resolveLlmModel(cfg, 'tarot'), 'modelo-tarot');
    assert.strictEqual(resolveLlmModel(cfg, 'profile'), 'modelo-profile');
    assert.strictEqual(resolveLlmModel(cfg, 'personaOpportunity'), 'modelo-opportunity');
    assert.strictEqual(resolveLlmModel(cfg, 'quizRoyale'), 'modelo-quiz');
  });

  test('resolveLlmModel mantém compatibilidade legada com qmpZenModel', () => {
    const cfg = { zenModel: 'modelo-padrao', qmpZenModel: 'modelo-qmp-legado' };
    assert.strictEqual(resolveLlmModel(cfg, 'qmp'), 'modelo-qmp-legado');
    assert.strictEqual(resolveLlmModel(cfg, 'persona'), 'modelo-padrao');

    const overrideWins = {
      zenModel: 'modelo-padrao',
      qmpZenModel: 'modelo-qmp-legado',
      llmModels: { qmp: 'modelo-qmp-novo' },
    };
    assert.strictEqual(resolveLlmModel(overrideWins, 'qmp'), 'modelo-qmp-novo');
  });

  test('resolveLlmModel limpa o override e volta a herdar zenModel', () => {
    const cfg = { zenModel: 'modelo-padrao', llmModels: { persona: '' } };
    assert.strictEqual(resolveLlmModel(cfg, 'persona'), 'modelo-padrao');
  });

  test('normalizeFunConfig normaliza llmModels e getLlmFeaturesStatus expõe modelos por item', () => {
    const normalized = normalizeFunConfig({
      zenModel: 'modelo-padrao',
      llmModels: { persona: 'modelo-persona', qmp: 7 },
    });
    assert.strictEqual(normalized.llmModels.persona, 'modelo-persona');
    assert.strictEqual(normalized.llmModels.qmp, '');

    const status = getLlmFeaturesStatus({
      zenModel: 'modelo-padrao',
      qmpZenModel: 'modelo-qmp-legado',
      llmModels: { persona: 'modelo-persona' },
    });
    assert.strictEqual(status.defaultModel, 'modelo-padrao');
    assert.strictEqual(status.llmModels.persona, 'modelo-persona');
    assert.strictEqual(status.items.length, Object.keys(DEFAULT_LLM_FEATURES).length);

    const personaItem = status.items.find((item) => item.id === 'persona');
    assert.strictEqual(personaItem.modelOverride, 'modelo-persona');
    assert.strictEqual(personaItem.effectiveModel, 'modelo-persona');
    assert.strictEqual(personaItem.defaultModel, 'modelo-padrao');

    const qmpItem = status.items.find((item) => item.id === 'qmp');
    assert.strictEqual(qmpItem.modelOverride, 'modelo-qmp-legado');
    assert.strictEqual(qmpItem.effectiveModel, 'modelo-qmp-legado');

    const tarotItem = status.items.find((item) => item.id === 'tarot');
    assert.strictEqual(tarotItem.modelOverride, '');
    assert.strictEqual(tarotItem.effectiveModel, 'modelo-padrao');
  });

  test('saveFunUserConfig preserva overrides de modelo em atualização parcial', () => {
    const current = loadFunUserConfig();
    const saved = saveFunUserConfig({
      zenEnabled: current.zenEnabled,
      llmFeatures: current.llmFeatures,
      llmModels: { persona: 'modelo-parcial' },
    });

    assert.strictEqual(saved.llmModels.persona, 'modelo-parcial');

    const reloaded = loadFunUserConfig();
    assert.strictEqual(reloaded.llmModels.persona, 'modelo-parcial');
    assert.strictEqual(
      reloaded.llmModels.socialHints,
      current.llmModels.socialHints,
      'Overrides já gravados sobrevivem a merges parciais'
    );

    // limpar o override volta ao estado herdado
    const cleared = saveFunUserConfig({
      zenEnabled: reloaded.zenEnabled,
      llmFeatures: reloaded.llmFeatures,
      llmModels: { persona: '' },
    });
    assert.strictEqual(cleared.llmModels.persona, '');
  });
});

describe('Propagação real do modelo por funcionalidade nos serviços', () => {
  const modelConfig = {
    zenEnabled: true,
    zenModel: 'modelo-padrao',
    zenMaxRetries: 0,
    llmFeatures: { ...DEFAULT_LLM_FEATURES },
    llmModels: {
      persona: 'modelo-y',
      socialHints: 'modelo-x',
      memory: 'modelo-x',
      flavor: 'modelo-z',
    },
  };

  test('personaService: respond envia model de persona nas chamadas generateZen', async () => {
    const prevLiveLlm = process.env.FUN_DISABLE_LIVE_LLM;
    delete process.env.FUN_DISABLE_LIVE_LLM;
    try {
      const seenModels = [];
      const personaRepository = createFunPersonaRepository({ getDatabase: getDb });
      const groupRepository = createFunGroupRepository({ getDatabase: getDb });
      const scope = uniqueGroup();
      const botJid = uniqueJid('5599');
      const svc = createPersonaService({
        personaRepository,
        groupRepository,
        generateZen: async (params) => {
          seenModels.push(params.model);
          return JSON.stringify({ type: 'reply', text: 'cheguei' });
        },
        getLogger: () => null,
        random: () => 0.5,
      });

      const result = await svc.generateResponse({
        text: 'bot, me responde',
        scopeKey: scope,
        funConfig: { ...modelConfig, zenMaxRetries: 0 },
        authorJid: uniqueJid(),
        authorLabel: 'Ana',
        sock: { user: { id: `${String(botJid).split('@')[0]}:0` } },
        maxChars: 200,
      });

      assert.ok(seenModels.length > 0, 'generateZen deve ter sido chamado');
      for (const model of seenModels) {
        assert.strictEqual(model, 'modelo-y', 'Todas as chamadas da persona usam o override de persona');
      }
    } finally {
      process.env.FUN_DISABLE_LIVE_LLM = prevLiveLlm;
    }
  });

  test('personaService: tool loop usa o override de persona em TODAS as iterações', async () => {
    const prevLiveLlm = process.env.FUN_DISABLE_LIVE_LLM;
    delete process.env.FUN_DISABLE_LIVE_LLM;
    try {
      const seenModels = [];
      const personaRepository = createFunPersonaRepository({ getDatabase: getDb });
      const groupRepository = createFunGroupRepository({ getDatabase: getDb });
      const scope = uniqueGroup();
      const botJid = uniqueJid('5599');
      const calls = [];
      const svc = createPersonaService({
        personaRepository,
        groupRepository,
        personaToolExecutor: {
          execute: async (call) => {
            calls.push(call?.name);
            return { ok: true, summary: 'Grupo com 4 membros' };
          },
        },
        // 1ª chamada: tool_call → 2ª chamada (pós-tool): reply
        generateZen: async (params) => {
          seenModels.push(params.model);
          if (seenModels.length === 1) {
            return JSON.stringify({ type: 'tool_call', name: 'group_status', arguments: {} });
          }
          return JSON.stringify({ type: 'reply', text: 'o grupo está com 4 membros' });
        },
        getLogger: () => null,
        random: () => 0.5,
      });

      // `zenModel` global difere do override de persona: qualquer regressão que
      // volte a usar o global (no respond ou no tool loop) falha aqui.
      const cfg = {
        ...modelConfig,
        zenModel: 'modelo-global-nao-usado',
        llmModels: { ...modelConfig.llmModels, persona: 'modelo-y' },
        zenMaxRetries: 0,
      };

      const result = await svc.generateResponse({
        text: 'bot, como está o grupo?',
        scopeKey: scope,
        funConfig: cfg,
        authorJid: uniqueJid(),
        authorLabel: 'Ana',
        sock: { user: { id: `${String(botJid).split('@')[0]}:0` } },
        maxChars: 200,
      });

      assert.deepStrictEqual(calls, ['group_status'], 'a tool deve ter sido executada uma vez');
      assert.strictEqual(seenModels.length, 2, 'tool loop gera exatamente 2 chamadas LLM');
      for (const model of seenModels) {
        assert.strictEqual(model, 'modelo-y', 'Cada iteração do tool loop usa o override de persona');
      }
      assert.ok(
        String(result?.text || '').includes('4 membros'),
        'a resposta final deve consumir o resultado real da tool'
      );
    } finally {
      process.env.FUN_DISABLE_LIVE_LLM = prevLiveLlm;
    }
  });

  test('personaSocialHintService: envia model de socialHints', async () => {
    const prevLiveLlm = process.env.FUN_DISABLE_LIVE_LLM;
    delete process.env.FUN_DISABLE_LIVE_LLM;
    try {
      const seenModels = [];
      const repository = createFunPersonaSocialHintRepository({ getDatabase: getDb });
      const scope = uniqueGroup();
      const cfg = {
        ...modelConfig,
        personaSocialHintsEnabled: true,
        personaSocialHintsBatchSize: 3,
        llmFeatures: { ...DEFAULT_LLM_FEATURES, socialHints: true },
      };
      const users = [uniqueJid(), uniqueJid(), uniqueJid()];
      const texts = ['mensagem um do grupo', 'mensagem dois do grupo', 'mensagem tres do grupo'];

      // A 3ª mensagem agenda o flush automaticamente (fire-and-forget). O mock
      // sinaliza a conclusão via `llmDone`, então o teste espera o lote terminar
      // antes de afirmar sobre o modelo usado.
      let llmDone;
      const llmDonePromise = new Promise((resolve) => { llmDone = resolve; });
      const svc = createPersonaSocialHintService({
        repository,
        getContactDisplayName: (jid) => jid,
        generateZen: async (params) => {
          seenModels.push(params.model);
          llmDone();
          return JSON.stringify({
            hints: [{ participants: [0], hint: 'curte piada interna', confidence: 90, socialSignal: 'positive' }],
          });
        },
      });

      texts.forEach((text, index) => {
        svc.observeMessage({ scopeKey: scope, userJid: users[index], text, funConfig: cfg, now: 1000 + index });
      });

      await Promise.race([
        llmDonePromise,
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
      await svc.flushScope(scope, cfg, 3000).catch(() => null);
      assert.strictEqual(seenModels.length, 1);
      assert.strictEqual(seenModels[0], 'modelo-x');
    } finally {
      process.env.FUN_DISABLE_LIVE_LLM = prevLiveLlm;
    }
  });

  test('groupMemoryService: extract envia memory e o resumo de persona envia persona', async () => {
    const prev = process.env.FUN_DISABLE_LIVE_LLM;
    delete process.env.FUN_DISABLE_LIVE_LLM;
    try {
      const seenModels = [];
      const repo = createFunMemoryRepository({ getDatabase: getDb });
      const scope = uniqueGroup();
      const ana = uniqueJid('5517');
      const mem = createGroupMemoryService({
        memoryRepository: repo,
        generateZen: async (params) => {
          seenModels.push({ task: params.task, model: params.model });
          if (params?.jsonMode) {
            return JSON.stringify({
              facts: [{
                kind: 'running_gag',
                summary: 'Ana abre tese sobre pizza no grupo',
                subjects: [0],
                keywords: ['pizza'],
                score: 74,
              }],
            });
          }
          return '• Pizza virou debate nacional no grupo';
        },
      });

      const cfg = { ...modelConfig, memoryMinScore: 20, memoryFlushMinMessages: 3 };
      for (let i = 0; i < 3; i += 1) {
        mem._pushRaw(scope, { userJid: ana, name: 'Ana', text: `pizza de novo ${i}`, at: 1000 + i });
      }

      await mem.forceFlush(scope, cfg);

      const extractCall = seenModels.find((call) => call.task === 'memory');
      assert.ok(extractCall, 'deve existir chamada de task memory');
      assert.strictEqual(extractCall.model, 'modelo-x');

      const personaCall = seenModels.find((call) => call.task === 'persona');
      assert.ok(personaCall, 'deve existir chamada de task persona');
      assert.strictEqual(personaCall.model, 'modelo-y');
    } finally {
      process.env.FUN_DISABLE_LIVE_LLM = prev;
    }
  });

  test('groupMemoryService: mudança de modelo de persona invalida o cache sem mascarar', async () => {
    const prevLiveLlm = process.env.FUN_DISABLE_LIVE_LLM;
    delete process.env.FUN_DISABLE_LIVE_LLM;
    try {
      const repo = createFunMemoryRepository({ getDatabase: getDb });
      const scope = uniqueGroup();
      const ana = uniqueJid('5521');
      const personaModels = [];
      const mem = createGroupMemoryService({
        memoryRepository: repo,
        generateZen: async (params) => {
          if (params?.jsonMode) {
            return JSON.stringify({
              facts: [{
                kind: 'running_gag',
                summary: 'Ana defende pizza com unhas e dentes no grupo',
                subjects: [0],
                keywords: ['pizza'],
                score: 74,
              }],
            });
          }
          personaModels.push(params.model);
          return `• bullet gerado por ${params.model}`;
        },
      });

      const firstCfg = {
        ...modelConfig,
        memoryMinScore: 20,
        memoryFlushMinMessages: 3,
        llmModels: { ...DEFAULT_LLM_MODELS, persona: 'modelo-persona-um', memory: 'modelo-x' },
      };
      for (let i = 0; i < 3; i += 1) {
        mem._pushRaw(scope, { userJid: ana, name: 'Ana', text: `pizza outra vez ${i}`, at: 2000 + i });
      }
      await mem.forceFlush(scope, firstCfg);

      const cachedFirst = mem.getPersonaCached(scope);
      assert.strictEqual(cachedFirst.model, 'modelo-persona-um');
      assert.ok(cachedFirst.personaText.includes('modelo-persona-um'));

      // Troca o override de persona: o cache marcado com o modelo anterior
      // precisa ser invalidado em vez de devolver o texto defasado.
      const secondCfg = {
        ...firstCfg,
        llmModels: { ...DEFAULT_LLM_MODELS, persona: 'modelo-persona-dois', memory: 'modelo-x' },
      };
      for (let i = 0; i < 3; i += 1) {
        mem._pushRaw(scope, { userJid: ana, name: 'Ana', text: `pizza de novo ${i}`, at: 4000 + i });
      }
      await mem.forceFlush(scope, secondCfg);

      assert.deepStrictEqual(personaModels, ['modelo-persona-um', 'modelo-persona-dois']);
      const cachedSecond = mem.getPersonaCached(scope);
      assert.strictEqual(cachedSecond.model, 'modelo-persona-dois');
      assert.ok(cachedSecond.personaText.includes('modelo-persona-dois'));
    } finally {
      process.env.FUN_DISABLE_LIVE_LLM = prevLiveLlm;
    }
  });

  test('flavorService: usa flavor por padrão, groupNews em group_times e levelUp em level_up', async () => {
    const seen = [];
    const mockGenerateZen = async (params) => {
      seen.push({ model: params.model, featureKeyHint: params.system?.includes('jornal') || params.jsonMode });
      return 'texto generico sem echo de placar';
    };

    const currentCfg = {
      ...modelConfig,
      flavorTimeoutMs: 1500,
      llmFeatures: { ...DEFAULT_LLM_FEATURES, flavor: true, groupNews: true, levelUp: true },
    };

    const flavor = createFlavorService({
      getConfig: () => currentCfg,
      zenGenerate: mockGenerateZen,
      allowLiveLlm: true,
    });

    await flavor.line('casino_win', { user: 'Alice', val: '100' });
    assert.strictEqual(seen.at(-1)?.model, 'modelo-z', 'flavor padrão usa llmModels.flavor');

    await flavor.chaosLine('group_times', { events: 'Hoje teve evento' });
    assert.strictEqual(seen.at(-1)?.model, 'modelo-padrao', 'group_times herda o global (sem override groupNews)');

    await flavor.italicLine('level_up', { level: 5, user: 'Bob' });
    assert.strictEqual(seen.at(-1)?.model, 'modelo-padrao', 'level_up herda o global (sem override levelUp)');
  });

  test('quizRoyaleEngine: envia model de quizRoyale no generateZen', async () => {
    const seenModels = [];
    await generateQuizQuestions({
      count: 8,
      funConfig: {
        ...modelConfig,
        llmModels: { ...DEFAULT_LLM_MODELS, quizRoyale: 'modelo-quiz' },
      },
      generateZen: async (params) => {
        seenModels.push(params.model);
        return JSON.stringify({
          questions: [{
            question: 'Qual o melhor meme?',
            options: ['A', 'B', 'C', 'D'],
            correctIndex: 0,
            category: 'Memes',
            explanation: 'sim',
          }],
        });
      },
    });

    assert.strictEqual(seenModels.length, 1);
    assert.strictEqual(seenModels[0], 'modelo-quiz');
  });

  test('quizRoyaleEngine: releitura via getConfig aplica o modelo ao vivo', async () => {
    const seenModels = [];
    let liveModel = 'modelo-quiz-dois';
    await generateQuizQuestions({
      count: 8,
      funConfig: { ...modelConfig, llmModels: { quizRoyale: 'modelo-quiz-um' } },
      getConfig: () => ({
        ...modelConfig,
        llmModels: { ...DEFAULT_LLM_MODELS, quizRoyale: liveModel },
      }),
      generateZen: async (params) => {
        seenModels.push(params.model);
        return JSON.stringify({
          questions: [{
            question: 'Qual o melhor meme?',
            options: ['A', 'B', 'C', 'D'],
            correctIndex: 0,
            category: 'Memes',
            explanation: 'sim',
          }],
        });
      },
    });

    // `funConfig` do prop está defasado: a leitura viva via getConfig vence.
    assert.strictEqual(seenModels[0], 'modelo-quiz-dois');
  });
});

describe('Dashboard API: modelos por funcionalidade em tempo real', () => {
  test('GET e POST /api/fun/llm/config persistem llmModels, zenModel e refletem por item', async () => {
    let mockRuntimeConfig = {
      zenEnabled: true,
      zenBaseUrl: 'http://localhost:20128/v1',
      zenModel: 'modelo-padrao',
      qmpZenModel: '',
      llmFeatures: { ...DEFAULT_LLM_FEATURES },
      llmModels: { ...DEFAULT_LLM_MODELS },
    };

    let updateCalledWith = null;
    let savedCount = 0;

    const server = await startFunDashboardServer({
      port: 0,
      getConfig: () => mockRuntimeConfig,
      updateConfig: (next) => {
        updateCalledWith = next;
        mockRuntimeConfig = next;
      },
      saveConfig: (next) => {
        savedCount += 1;
        mockRuntimeConfig = next;
        return next;
      },
      funModule: { _services: { repository: {}, groupRepository: {} } },
    });

    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // 1. GET inicial — defaults sem override
      let res = await fetch(`${baseUrl}/api/fun/llm/config`);
      assert.strictEqual(res.status, 200);
      let json = await res.json();
      assert.strictEqual(json.ok, true);
      assert.strictEqual(json.zenModel, 'modelo-padrao');
      assert.ok(Array.isArray(json.suggestedModels));
      assert.ok(
        json.suggestedModels.some((item) => item.id === 'modelo-padrao' && item.source === 'default'),
        'suggestedModels deve incluir o modelo atual como default'
      );
      const personaItem = json.items.find((item) => item.id === 'persona');
      assert.strictEqual(personaItem.modelOverride, '');
      assert.strictEqual(personaItem.effectiveModel, 'modelo-padrao');

      // 2. POST com modelo global novo
      res = await fetch(`${baseUrl}/api/fun/llm/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zenModel: 'modelo-global-novo' }),
      });
      assert.strictEqual(res.status, 200);
      json = await res.json();
      assert.strictEqual(json.zenModel, 'modelo-global-novo');
      assert.strictEqual(json.persisted, true);
      assert.strictEqual(json.appliedImmediately, true);
      assert.ok(savedCount > 0, 'saveConfig deve ter sido chamado');
      assert.ok(updateCalledWith, 'updateConfig deve ter sido chamado');

      // 3. Override só de persona — merge parcial preserva os outros
      res = await fetch(`${baseUrl}/api/fun/llm/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ llmModels: { persona: 'modelo-y' } }),
      });
      assert.strictEqual(res.status, 200);
      json = await res.json();
      assert.strictEqual(json.llmModels.persona, 'modelo-y');
      assert.strictEqual(json.llmModels.socialHints, '');
      assert.strictEqual(updateCalledWith.llmModels.persona, 'modelo-y');

      const persona = json.items.find((item) => item.id === 'persona');
      assert.strictEqual(persona.modelOverride, 'modelo-y');
      assert.strictEqual(persona.effectiveModel, 'modelo-y');
      assert.strictEqual(persona.defaultModel, 'modelo-global-novo');
      const tarot = json.items.find((item) => item.id === 'tarot');
      assert.strictEqual(tarot.effectiveModel, 'modelo-global-novo');

      // 4. Limpar o override (string vazia) volta a herdar o global
      res = await fetch(`${baseUrl}/api/fun/llm/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ llmModels: { persona: '' } }),
      });
      assert.strictEqual(res.status, 200);
      json = await res.json();
      assert.strictEqual(json.llmModels.persona, '');
      const personaAfterClear = json.items.find((item) => item.id === 'persona');
      assert.strictEqual(personaAfterClear.effectiveModel, 'modelo-global-novo');

      // 5. Override de QMP novo vence o legado qmpZenModel
      mockRuntimeConfig.qmpZenModel = 'modelo-qmp-legado';
      mockRuntimeConfig.llmModels = { ...(mockRuntimeConfig.llmModels || {}), qmp: 'modelo-qmp-novo' };
      res = await fetch(`${baseUrl}/api/fun/llm/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ llmModels: { qmp: 'modelo-qmp-novo' } }),
      });
      assert.strictEqual(res.status, 200);
      json = await res.json();
      assert.strictEqual(json.llmModels.qmp, 'modelo-qmp-novo');
      const qmp = json.items.find((item) => item.id === 'qmp');
      assert.strictEqual(qmp.effectiveModel, 'modelo-qmp-novo');

      // 6. Limpar llmModels.qmp também zera o legado qmpZenModel
      res = await fetch(`${baseUrl}/api/fun/llm/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ llmModels: { qmp: '' } }),
      });
      assert.strictEqual(res.status, 200);
      json = await res.json();
      assert.strictEqual(json.llmModels.qmp, '');
      assert.strictEqual(updateCalledWith.qmpZenModel, '', 'qmpZenModel legado deve ser zerado');
      assert.strictEqual(
        json.items.find((item) => item.id === 'qmp').effectiveModel,
        'modelo-global-novo',
        'override limpo não pode continuar vítima do qmpZenModel legado'
      );

      // 6. persistência: o último payload entregue ao saveConfig é o estado final
      assert.strictEqual(updateCalledWith.llmModels.qmp, '');
      assert.strictEqual(updateCalledWith.llmModels.persona, '');
      assert.strictEqual(updateCalledWith.zenModel, 'modelo-global-novo');

      // 7. GET devolve exatamente o estado persistido (leitura ao vivo)
      res = await fetch(`${baseUrl}/api/fun/llm/config`);
      assert.strictEqual(res.status, 200);
      json = await res.json();
      assert.strictEqual(json.zenModel, 'modelo-global-novo');
      assert.strictEqual(json.llmModels.persona, '');
      assert.strictEqual(json.llmModels.qmp, '');
      assert.strictEqual(json.items.find((item) => item.id === 'persona').effectiveModel, 'modelo-global-novo');
    } finally {
      server.close();
    }
  });
});
