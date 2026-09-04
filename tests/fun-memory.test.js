/**
 * Memória seletiva por grupo + entity IDs + lore commands.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import {
  createFunStatsRepository,
  _resetDefaultFunStatsRepository,
} from '../fun/db/funStatsRepository.js';
import { createFunMemoryRepository } from '../fun/db/funMemoryRepository.js';
import {
  createGroupMemoryService,
  parseFactsJson,
  validateExtractedFact,
  jaccard,
  tokenSet,
  keywordSignature,
  inferSubjectIndicesFromSummary,
  looseParseFacts,
} from '../fun/services/groupMemoryService.js';
import { parseFunCommand, resolveFunConfig } from '../fun/index.js';
import { FUN_COMMANDS, DEFAULT_FUN_CONFIG } from '../fun/constants.js';
import {
  handleLoreCommand,
  handleForgetLoreCommand,
} from '../fun/commands/handlers/memory.js';

await initDb();
_resetDefaultFunStatsRepository();

function uniqueJid(prefix = '5511') {
  return `${prefix}${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 90 + 10)}@s.whatsapp.net`;
}

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

test('default Zen usa bot-zap no endpoint padronizado', () => {
  assert.equal(DEFAULT_FUN_CONFIG.zenModel, 'bot-zap');
  assert.equal(DEFAULT_FUN_CONFIG.zenBaseUrl, 'http://localhost:20128/v1');
  assert.equal(DEFAULT_FUN_CONFIG.zenSendSamplingParams, false);
  const cfg = resolveFunConfig({});
  assert.equal(cfg.zenModel, 'bot-zap');
  assert.equal(cfg.zenSendSamplingParams, false);
  assert.equal(cfg.memoryEnabled, true);
  assert.equal(cfg.memoryMaxFacts, DEFAULT_FUN_CONFIG.memoryMaxFacts);
});

test('parseFunCommand: lore / esquecelore', () => {
  assert.equal(parseFunCommand('/lore', '/').command, FUN_COMMANDS.LORE);
  assert.equal(parseFunCommand('/memorias', '/').command, FUN_COMMANDS.LORE);
  assert.equal(parseFunCommand('/esquecelore', '/').command, FUN_COMMANDS.FORGET_LORE);
  assert.equal(parseFunCommand('/limparlore', '/').command, FUN_COMMANDS.FORGET_LORE);
});

test('parseFactsJson: subjects por ID numérico; rejeita nomes', () => {
  const ok = parseFactsJson(
    `{"facts":[{"kind":"epic_fail","summary":"João derrubou o café no teclado ao vivo","subjects":[0],"keywords":["cafe","teclado"],"score":72}]}`,
    { batchSize: 3 }
  );
  assert.equal(ok.length, 1);
  assert.equal(ok[0].kind, 'epic_fail');
  assert.deepEqual(ok[0].subjectIndices, [0]);
  assert.match(ok[0].summary, /café|cafe|teclado/i);

  // nomes em subjects → descarta (zero confusão de pessoa)
  const bad = parseFactsJson(
    `[{"kind":"event","summary":"Maria pagou o almoço do grupo inteiro","subjects":["Maria"],"score":70}]`,
    { batchSize: 2 }
  );
  assert.equal(bad.length, 0);

  assert.equal(parseFactsJson('nada de util').length, 0);
  assert.equal(parseFactsJson('').length, 0);
});

test('validateExtractedFact: schema rígido', () => {
  assert.equal(
    validateExtractedFact({ kind: 'event', summary: 'curto', subjects: [0] }),
    null
  );
  // kind desconhecido → event (não descarta)
  const mappedNope = validateExtractedFact({
    kind: 'nope',
    summary: 'Fato longo o suficiente para passar no min length',
    subjects: [0],
  });
  assert.ok(mappedNope);
  assert.equal(mappedNope.kind, 'event');
  const v = validateExtractedFact(
    {
      kind: 'epic_fail',
      summary: 'Pedro bateu o carro no poste da esquina kkk',
      subjects: ['[1]', 0],
      keywords: ['carro'],
      score: 80,
    },
    { batchSize: 4 }
  );
  assert.ok(v);
  assert.deepEqual(v.subjectIndices, [1, 0]);
});

test('parseFactsJson: tolera JSON malformado (subjects":, sem valor)', () => {
  // caso típico do glm_5_2 no proxy 3300: ele emite "subjects":, sem valor.
  // O parser tem que extrair via regex e ainda inferir o subject do summary.
  const raw =
    '{"facts":[{"kind":"running_gag","summary":"natasha jurou q ia voltar a treinar e n foi, marina confirmou q é sempre assim","subjects":,"keywords":["academia","treino"],"score":70}]}';
  const batch = [
    { idx: 0, name: 'Marina', text: 'vcs foram na academia?' },
    { idx: 1, name: 'Lucas', text: 'fui' },
    { idx: 2, name: 'Marina', text: 'kkk' },
    { idx: 3, name: 'natasha🕷️', text: 'pior q eu falei q ia voltar a treinar e nada' },
    { idx: 4, name: 'Marina', text: 'sempre assim natasha' },
  ];
  const facts = parseFactsJson(raw, { batchSize: 5, batch });
  assert.equal(facts.length, 1, 'fato recuperado de JSON quebrado');
  assert.equal(facts[0].kind, 'running_gag');
  assert.match(facts[0].summary, /natasha|treinar/i);
  // subject inferido do summary → natasha (idx 3)
  assert.deepEqual(facts[0].subjectIndices, [3], 'subject inferido pelo nome no summary');
  assert.equal(facts[0].subjectInferred, true);
});

test('parseFactsJson: tolera múltiplos facts com JSON quebrado (regex)', () => {
  const raw =
    '{"facts":[{"kind":"event","summary":"Paulo consegue desconto de estudante pra quem não tem carteira","subjects":,"keywords":["desconto"],"score":45},{"kind":"running_gag","summary":"natasha já avisando q o desconto vai acabar cmg","subjects":,"keywords":["desconto"],"score":45}]}';
  const batch = [
    { idx: 0, name: 'Paulo', text: 'melhor comprar online' },
    { idx: 1, name: 'Paulo', text: '@all ve ai' },
    { idx: 2, name: 'Paulo', text: 'ai agt compra' },
    { idx: 3, name: 'Paulo', text: 'quem n tiver carteira de estudante eu consigo aquele desconto' },
    { idx: 4, name: 'natasha🕷️', text: 'essa eu sei q vai acabar cmg tá' },
  ];
  const facts = parseFactsJson(raw, { batchSize: 5, batch });
  assert.equal(facts.length, 2);
  // Paulo = idx 0, natasha = idx 4 — inferidos do summary
  const pauloFact = facts.find((f) => /desconto de estudante/i.test(f.summary));
  const natashaFact = facts.find((f) => /acabar cmg/i.test(f.summary));
  assert.ok(pauloFact, 'fato do Paulo recuperado');
  assert.ok(natashaFact, 'fato da natasha recuperado');
  assert.deepEqual(pauloFact.subjectIndices, [0], 'Paulo inferido do summary');
  assert.deepEqual(natashaFact.subjectIndices, [4], 'natasha inferida do summary');
  assert.equal(pauloFact.subjectInferred, true);
  assert.equal(natashaFact.subjectInferred, true);
});

test('parseFactsJson: JSON válido continua funcionando como antes', () => {
  const raw = JSON.stringify({
    facts: [
      {
        kind: 'rivalry',
        summary: 'Beto e Carla brigam por figurinha feia',
        subjects: [0],
        keywords: ['figurinha'],
        score: 60,
      },
    ],
  });
  const facts = parseFactsJson(raw, { batchSize: 3 });
  assert.equal(facts.length, 1);
  assert.deepEqual(facts[0].subjectIndices, [0]);
  assert.equal(facts[0].subjectInferred, false);
});

test('inferSubjectIndicesFromSummary: acha o nome do autor no summary', () => {
  const batch = [
    { name: 'Marina', text: 'foram?' },
    { name: 'Lucas', text: 'fui' },
    { name: 'natasha🕷️', text: 'essa eu sei q vai acabar cmg tá' },
  ];
  const inf = inferSubjectIndicesFromSummary(
    'Natasha jurou que ia treinar mas já sabe que vai acabar com ela mesma',
    batch
  );
  assert.ok(inf, 'inferencia retornou objeto');
  assert.equal(inf.inferred, true);
  assert.deepEqual(inf.indices, [2], 'idx 2 = natasha');
});

test('inferSubjectIndicesFromSummary: sem match → null (não inventa)', () => {
  const batch = [
    { name: 'Marina', text: 'foram?' },
    { name: 'Lucas', text: 'fui' },
  ];
  const inf = inferSubjectIndicesFromSummary(
    'alguem aleatorio falou algo sem nome proprio do batch',
    batch
  );
  assert.equal(inf, null, 'sem match claro → null');
});

test('looseParseFacts: extrai mesmo com vírgula trailing e aspas escapadas', () => {
  const raw =
    '{"facts":[{"kind":"epic_fail","summary":"eduardo caiu no golpe do \\"link falso\\"","subjects":[0],"keywords":["golpe","link"],"score":55}]}';
  const out = looseParseFacts(raw);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'epic_fail');
  assert.match(out[0].summary, /link falso/);
  assert.deepEqual(out[0].subjects, [0]);
  assert.deepEqual(out[0].keywords, ['golpe', 'link']);
  assert.equal(out[0].score, 55);
});

test('groupMemoryService: extract recebe clima atual e identidade do lote', async () => {
  const prev = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    const repo = createFunMemoryRepository({ getDatabase: getDb });
    const scope = uniqueGroup();
    const ana = uniqueJid('5517');
    let input = null;
    repo.setPersona(scope, '• O grupo transforma toda pizza em debate nacional.', 1);
    const mem = createGroupMemoryService({
      memoryRepository: repo,
      profileService: {
        buildIdentityBlock: (group, ids) =>
          group === scope && ids.includes(ana)
            ? '<user_identity>\n- Aninha: nick: Aninha · rainha da pizza\n</user_identity>'
            : '',
      },
      generateZen: async (opts) => {
        if (opts?.jsonMode) {
          input = opts;
          return JSON.stringify({
            facts: [{
              kind: 'running_gag',
              summary: 'Aninha abriu outra discussão séria sobre pizza no grupo',
              subjects: [0],
              keywords: ['pizza'],
              score: 74,
            }],
          });
        }
        return '• Pizza sempre vira tese de doutorado no grupo';
      },
    });
    const cfg = resolveFunConfig({ memoryEnabled: true, memoryMinScore: 20, zenEnabled: true });
    for (let i = 0; i < 3; i += 1) {
      mem._pushRaw(scope, {
        userJid: ana,
        name: 'Ana',
        text: `pizza de novo ${i}`,
        at: Date.now() + i,
      });
    }
    await mem.forceFlush(scope, cfg);
    assert.match(input.prompt, /Clima atual consolidado/);
    assert.match(input.prompt, /pizza em debate nacional/i);
    assert.match(input.prompt, /<user_identity>/);
    assert.match(input.prompt, /Aninha/);
  } finally {
    if (prev !== undefined) process.env.FUN_DISABLE_LIVE_LLM = prev;
    else process.env.FUN_DISABLE_LIVE_LLM = '1';
  }
});

test('groupMemoryService: prompt preserva humor adulto contextual sem detalhes gráficos', async () => {
  const prev = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    const repo = createFunMemoryRepository({ getDatabase: getDb });
    const scope = uniqueGroup();
    const ana = uniqueJid('5519');
    let input = null;
    const mem = createGroupMemoryService({
      memoryRepository: repo,
      generateZen: async (opts) => {
        if (!opts?.jsonMode) return '• A piada do date ruim segue viva no grupo';
        input = opts;
        return JSON.stringify({
          facts: [{
            kind: 'running_gag',
            summary: 'Ana sempre puxa a piada interna do date ruim',
            subjects: [0],
            keywords: ['date', 'piada'],
            score: 72,
          }],
        });
      },
    });
    const cfg = resolveFunConfig({ memoryMinScore: 20, zenEnabled: true });
    for (const text of ['aquele date foi uma novela kkk', 'a piada do date voltou', 'a Ana puxou o bordão de novo']) {
      mem._pushRaw(scope, { userJid: ana, name: 'Ana', text, at: Date.now() });
    }

    const result = await mem.forceFlush(scope, cfg);
    assert.equal(result.ok, true);
    assert.equal(result.inserted, 1);
    assert.match(input.system, /humor adulto entre participantes/i);
    assert.match(input.system, /menor de idade, coerção, exploração, assédio direcionado/i);
    assert.match(input.prompt, /humor adulto entre participantes não invalidam/i);
    assert.match(repo.listFacts(scope, { limit: 1 })[0].summary, /date ruim/i);
  } finally {
    if (prev !== undefined) process.env.FUN_DISABLE_LIVE_LLM = prev;
    else process.env.FUN_DISABLE_LIVE_LLM = '1';
  }
});

test('groupMemoryService: persona SEM limite de caracteres (envia tudo pro modelo)', async () => {
  // Usuário pediu para remover todos os cortes — persona vai completo pro
  // modelo, sem .slice(0, personaMax). O prompt de extração ainda menciona o
  // teto configurado (instrução de tamanho), mas o texto persistido é a saída
  // completa do modelo.
  const prev = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    const repo = createFunMemoryRepository({ getDatabase: getDb });
    const scope = uniqueGroup();
    let input = null;
    repo.insertFact({
      scopeKey: scope,
      kind: 'running_gag',
      summary: 'O grupo discute pizza como se fosse assunto de Estado',
      subjects: [uniqueJid('5518')],
      score: 75,
    });
    const mem = createGroupMemoryService({
      memoryRepository: repo,
      generateZen: async (opts) => {
        input = opts;
        return `• ${'x'.repeat(600)}`;
      },
    });
    const cfg = resolveFunConfig({ memoryPersonaMaxChars: 500, zenEnabled: true });
    const result = await mem.refreshPersona(scope, cfg);

    assert.equal(result.ok, true);
    assert.match(input.system, /limite de caracteres informado/i);
    assert.doesNotMatch(input.system, /450 caracteres/i);
    // prompt continua sugerindo o teto, mas o texto persistido vai completo.
    assert.match(input.prompt, /≤500 chars/);
    assert.equal(result.text.length, 602);
  } finally {
    if (prev !== undefined) process.env.FUN_DISABLE_LIVE_LLM = prev;
    else process.env.FUN_DISABLE_LIVE_LLM = '1';
  }
});

test('groupMemoryService: extrai fato de JSON quebrado do Zen (anti-perda)', async () => {
  // antes da correção, glm_5_2 no proxy 3300 mandava "subjects":, e o parser descartava TUDO.
  // Agora extrai via regex e infere subject.
  const prev = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    const repo = createFunMemoryRepository({ getDatabase: getDb });
    const scope = uniqueGroup();
    const u = uniqueJid('5533');
    const mem = createGroupMemoryService({
      memoryRepository: repo,
      getContactDisplayName: () => 'Natasha',
      generateZen: async () =>
        '{"facts":[{"kind":"running_gag","summary":"Natasha jurou q ia treinar e n foi, sempre assim","subjects":,"keywords":["treino"],"score":70}]}',
      generateOllama: async () => '{"facts":[]}',
    });
    const cfg = resolveFunConfig({ memoryMinScore: 30, zenEnabled: true });
    mem._pushRaw(scope, {
      userJid: u,
      name: 'Natasha',
      text: 'essa eu sei q vai acabar cmg tá',
      at: Date.now(),
    });
    mem._pushRaw(scope, {
      userJid: uniqueJid('5534'),
      name: 'Marina',
      text: 'kkk sempre assim natasha',
      at: Date.now() + 1000,
    });
    mem._pushRaw(scope, {
      userJid: uniqueJid('5535'),
      name: 'Lucas',
      text: 'vamo amanha de novo',
      at: Date.now() + 2000,
    });
    const r = await mem.forceFlush(scope, cfg);
    assert.equal(r.ok, true);
    assert.ok(r.inserted >= 1 || r.reinforced >= 1, 'fato recuperado e gravado');
    const facts = repo.listFacts(scope, { limit: 5 });
    assert.equal(facts.length, 1, '1 fato no banco (recuperado de JSON quebrado)');
    assert.match(facts[0].summary, /Natasha|treinar/i);
  } finally {
    if (prev !== undefined) process.env.FUN_DISABLE_LIVE_LLM = prev;
    else process.env.FUN_DISABLE_LIVE_LLM = '1';
  }
});

test('jaccard / keywordSignature dedup basico', () => {
  const a = tokenSet('joao derrubou o cafe no teclado');
  const b = tokenSet('joao derrubou cafe teclado de novo');
  assert.ok(jaccard(a, b) > 0.3);
  const sig = keywordSignature(['wifi', 'clutch', 'predio'], 'wifi cai no clutch');
  assert.ok(sig.includes('wifi') || sig.includes('clutch'));
});

test('memoryRepository: insert, reinforce overwrite summary, prune, forget', () => {
  const repo = createFunMemoryRepository({ getDatabase: getDb });
  const scope = uniqueGroup();

  const f1 = repo.insertFact({
    scopeKey: scope,
    kind: 'running_gag',
    summary: 'Grupo zoa o atraso eterno do Pedro no daily',
    subjects: [uniqueJid('5591')],
    keywords: ['atraso', 'pedro', 'daily'],
    score: 70,
  });
  assert.ok(f1?.id);

  const f2 = repo.reinforceFact(f1.id, {
    summary: 'Pedro atrasa o daily e vira piada recorrente',
    score: 80,
    keywords: ['atraso'],
    overwriteSummary: true,
  });
  assert.equal(f2.hits, 2);
  assert.equal(f2.score, 80);
  assert.match(f2.summary, /piada recorrente/i);
  assert.ok(f2.lastSeenAt >= f1.lastSeenAt);

  for (let i = 0; i < 12; i += 1) {
    repo.insertFact({
      scopeKey: scope,
      kind: 'event',
      summary: `Fato fraco numero ${i} sem graca especial no grupo`,
      score: 10 + i,
    });
  }
  const pruned = repo.pruneToCap(scope, 8);
  assert.ok(pruned >= 1);
  assert.ok(repo.countFacts(scope) <= 8);

  const n = repo.deleteByScope(scope);
  assert.ok(n >= 1);
  assert.equal(repo.countFacts(scope), 0);
});

test('shouldFlushBuffer / flushDueScopes: trigger é SOMENTE contagem — tempo/idade não extrai', async () => {
  const prev = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    const repo = createFunMemoryRepository({ getDatabase: getDb });
    const scope = uniqueGroup();
    const jid = uniqueJid('5599');
    let zenCalls = 0;

    const mem = createGroupMemoryService({
      memoryRepository: repo,
      getContactDisplayName: () => 'Gabriel',
      generateZen: async () => {
        zenCalls += 1;
        return JSON.stringify({
          facts: [
            {
              kind: 'epic_fail',
              summary: 'Gabriel jurou que ia treinar e sumiu por tres semanas',
              subjects: [0],
              keywords: ['treino'],
              score: 70,
            },
          ],
        });
      },
      generateOllama: async () => {
        throw new Error('ollama-off');
      },
      random: () => 0,
    });

    const cfg = resolveFunConfig({
      memoryEnabled: true,
      memoryFlushMinMessages: 40,
      memoryBufferSize: 50,
      memoryMinMsgChars: 8,
      memoryMinScore: 20,
      zenEnabled: true,
      ollamaEnabled: false,
    });

    // msgs “antigas” (15 min) com flushMin=40 — NÃO devem disparar extract por idade
    const t0 = Date.now() - 15 * 60_000;
    for (let i = 0; i < 5; i += 1) {
      mem.observeMessage({
        scopeKey: scope,
        userJid: jid,
        text: `conversa engraçada numero ${i} com conteudo suficiente`,
        funConfig: cfg,
        now: t0 + i * 1000,
        isGroup: true,
      });
    }
    await new Promise((r) => setTimeout(r, 50));

    assert.equal(zenCalls, 0, 'observe com <40 msgs não pode chamar a LLM por tempo/idade');
    const stats = mem.getBufferStats().find((s) => s.scopeKey === scope);
    assert.ok(stats);
    assert.equal(stats.size, 5, 'buffer permanece intacto até bater o limite de msgs');

    // world tick NÃO extrai buffer abaixo do limite, mesmo com msgs velhas
    const due = await mem.flushDueScopes(cfg, Date.now());
    assert.equal(due.flushed, 0);
    assert.equal(zenCalls, 0, 'flushDueScopes não extrai abaixo do limite de msgs');

    // critério puro: contagem decide
    const o = { flushMin: 40 };
    assert.equal(mem.shouldFlushBuffer({ flushing: false, msgs: [] }, o), false);
    assert.equal(
      mem.shouldFlushBuffer(
        { flushing: false, msgs: Array.from({ length: 39 }, () => ({ at: t0 })) },
        o
      ),
      false
    );
    assert.equal(
      mem.shouldFlushBuffer(
        { flushing: false, msgs: Array.from({ length: 40 }, () => ({ at: Date.now() })) },
        o
      ),
      true,
      '40 msgs disparam flush independente da idade'
    );

    assert.equal(repo.listFacts(scope, { limit: 10, minScore: 0 }).length, 0);
  } finally {
    if (prev === undefined) delete process.env.FUN_DISABLE_LIVE_LLM;
    else process.env.FUN_DISABLE_LIVE_LLM = prev;
  }
});

test('groupMemoryService: observe ignora comando/curto; flush com mock Zen + IDs', async () => {
  const prev = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;

  try {
    const repo = createFunMemoryRepository({ getDatabase: getDb });
    const scope = uniqueGroup();
    let zenCalls = 0;
    /** @type {object[]} */
    const zenOptsLog = [];

    const mem = createGroupMemoryService({
      memoryRepository: repo,
      getContactDisplayName: (j) => (j.includes('5599') ? 'Ana' : j.split('@')[0]),
      generateZen: async (opts) => {
        zenCalls += 1;
        zenOptsLog.push(opts || {});
        // extract usa jsonMode; persona não — devolve shape adequado
        if (opts?.jsonMode) {
          return JSON.stringify({
            facts: [
              {
                kind: 'epic_fail',
                summary: 'Ana mandou figurinha no lugar do comprovante e o grupo explodiu',
                subjects: [0],
                keywords: ['figurinha', 'comprovante'],
                score: 78,
              },
            ],
          });
        }
        return '• Grupo zoa figurinha no comprovante';
      },
      generateOllama: async () => {
        throw new Error('should-not-ollama');
      },
    });

    const cfg = resolveFunConfig({
      memoryEnabled: true,
      memoryFlushMinMessages: 3,
      memoryBufferSize: 10,
      memoryMinMsgChars: 10,
      memoryMinScore: 30,
      zenEnabled: true,
      ollamaEnabled: true,
    });

    assert.equal(
      mem.observeMessage({
        scopeKey: scope,
        userJid: uniqueJid(),
        text: '/lore',
        funConfig: cfg,
        isGroup: true,
      }).reason,
      'command'
    );

    assert.equal(
      mem.observeMessage({
        scopeKey: scope,
        userJid: uniqueJid(),
        text: 'ok',
        funConfig: cfg,
        isGroup: true,
      }).reason,
      'short'
    );

    const u = uniqueJid('5599');
    for (let i = 0; i < 3; i += 1) {
      mem.observeMessage({
        scopeKey: scope,
        userJid: u,
        text: `Gente a Ana mandou figurinha no comprovante de novo kkkk ${i}`,
        funConfig: cfg,
        isGroup: true,
        now: Date.now() + i,
      });
    }

    await new Promise((r) => setTimeout(r, 80));
    if (repo.countFacts(scope) === 0) {
      await mem.forceFlush(scope, cfg);
    }

    assert.ok(zenCalls >= 1, 'zen extract chamado');
    assert.ok(
      zenOptsLog.some((o) => o.jsonMode === true),
      `jsonMode no Zen extract; opts=${JSON.stringify(zenOptsLog)}`
    );
    assert.ok(repo.countFacts(scope) >= 1, 'fato persistido');

    const facts = repo.listFacts(scope, { limit: 5 });
    assert.ok(facts[0].subjects.includes(u), 'subject mapeado para JID');

    const lore = mem.buildLoreContext(scope, { userJids: [u], limit: 5, funConfig: cfg });
    assert.match(lore, /<group_lore>/);
    assert.match(lore, /figurinha|comprovante|Ana/i);
    assert.match(lore, /NUNCA altere o sujeito|PROIBIDO conectar/i);

    const list = mem.formatLoreList(scope, { funConfig: cfg });
    assert.match(list, /Lore do grupo/i);
  } finally {
    if (prev !== undefined) process.env.FUN_DISABLE_LIVE_LLM = prev;
    else process.env.FUN_DISABLE_LIVE_LLM = '1';
  }
});

test('groupMemoryService: Zen falha → extract retorna vazio sem chamar Ollama', async () => {
  const prev = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    const repo = createFunMemoryRepository({ getDatabase: getDb });
    const scope = uniqueGroup();
    let ollama = 0;
    /** @type {object[]} */
    const ollamaOptsLog = [];
    const u = uniqueJid('5588');
    const mem = createGroupMemoryService({
      memoryRepository: repo,
      getContactDisplayName: () => 'Beto',
      generateZen: async () => {
        throw new Error('zen-down');
      },
      generateOllama: async (opts) => {
        ollama += 1;
        ollamaOptsLog.push(opts || {});
        if (opts?.format === 'json') {
          return JSON.stringify({
            facts: [
              {
                kind: 'rivalry',
                summary: 'Beto e Carla brigam por quem manda mais figurinha feia',
                subjects: [0],
                keywords: ['figurinha', 'rival'],
                score: 66,
              },
            ],
          });
        }
        return '• Rivalidade de figurinha feia';
      },
    });
    const cfg = resolveFunConfig({
      memoryFlushMinMessages: 3,
      memoryMinScore: 20,
      zenEnabled: true,
      ollamaEnabled: true,
    });
    for (let i = 0; i < 3; i += 1) {
      mem._pushRaw(scope, {
        userJid: u,
        name: 'Beto',
        text: `figurinha feia war round ${i}`,
        at: Date.now(),
      });
    }
    const r = await mem.forceFlush(scope, cfg);
    assert.equal(r.ok, true);
    assert.equal(ollama, 0, 'Ollama está descontinuado como fallback do extract');
    assert.equal(ollamaOptsLog.length, 0);
    assert.equal(repo.countFacts(scope), 0);
  } finally {
    if (prev !== undefined) process.env.FUN_DISABLE_LIVE_LLM = prev;
    else process.env.FUN_DISABLE_LIVE_LLM = '1';
  }
});

test('groupMemoryService: descarta fato se LLM devolver nome em subjects', async () => {
  const prev = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    const repo = createFunMemoryRepository({ getDatabase: getDb });
    const scope = uniqueGroup();
    const mem = createGroupMemoryService({
      memoryRepository: repo,
      generateZen: async () =>
        JSON.stringify([
          {
            kind: 'event',
            summary: 'Alguem inventou um mico sem ID valido de sujeito',
            subjects: ['João'],
            score: 90,
          },
        ]),
      generateOllama: async () => '[]',
    });
    const cfg = resolveFunConfig({ memoryMinScore: 20, zenEnabled: true });
    for (let i = 0; i < 3; i += 1) {
      mem._pushRaw(scope, {
        userJid: uniqueJid(),
        name: 'Joao',
        text: `mico aleatorio ${i} bem longo o suficiente`,
        at: Date.now(),
      });
    }
    await mem.forceFlush(scope, cfg);
    assert.equal(repo.countFacts(scope), 0, 'nome solto não persiste');
  } finally {
    if (prev !== undefined) process.env.FUN_DISABLE_LIVE_LLM = prev;
    else process.env.FUN_DISABLE_LIVE_LLM = '1';
  }
});

test('groupMemoryService: dedup reforça e sobrescreve summary', async () => {
  const prev = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    const repo = createFunMemoryRepository({ getDatabase: getDb });
    const scope = uniqueGroup();
    const u = uniqueJid('5533');
    let round = 0;
    const mem = createGroupMemoryService({
      memoryRepository: repo,
      getContactDisplayName: () => 'Fulano',
      generateZen: async () => {
        round += 1;
        return JSON.stringify({
          facts: [
            {
              kind: 'running_gag',
              summary:
                round === 1
                  ? 'Todo mundo zoa o Wi-Fi do predio que cai no clutch'
                  : 'Wi-Fi do predio cai no clutch e vira meme recorrente',
              subjects: [0],
              keywords: ['wifi', 'clutch', 'predio'],
              score: 70,
            },
          ],
        });
      },
      generateOllama: async () => '{"facts":[]}',
    });
    const cfg = resolveFunConfig({ memoryMinScore: 20, zenEnabled: true });

    for (let r = 0; r < 2; r += 1) {
      for (let i = 0; i < 3; i += 1) {
        mem._pushRaw(scope, {
          userJid: u,
          name: 'Fulano',
          text: `wifi caiu no clutch de novo ${r}-${i}`,
          at: Date.now(),
        });
      }
      await mem.forceFlush(scope, cfg);
    }

    const facts = repo.listFacts(scope, { limit: 20 });
    assert.ok(facts.length <= 3);
    assert.ok(facts.some((f) => f.hits >= 2));
    assert.ok(facts.some((f) => /meme recorrente|wifi|clutch/i.test(f.summary)));
  } finally {
    if (prev !== undefined) process.env.FUN_DISABLE_LIVE_LLM = prev;
    else process.env.FUN_DISABLE_LIVE_LLM = '1';
  }
});

test('groupMemoryService: anti-fusão — fatos de pessoas diferentes nunca se fundem', async () => {
  const prev = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    const repo = createFunMemoryRepository({ getDatabase: getDb });
    const scope = uniqueGroup();
    const fulano = uniqueJid('5511');
    const sicrano = uniqueJid('5522');
    const names = { [fulano]: 'Fulano', [sicrano]: 'Sicrano' };
    let round = 0;
    const mem = createGroupMemoryService({
      memoryRepository: repo,
      getContactDisplayName: (j) => names[j] || j.split('@')[0],
      generateZen: async () => {
        round += 1;
        return JSON.stringify({
          facts: [
            {
              kind: 'epic_fail',
              summary:
                round === 1
                  ? 'Fulano perdeu tudo no cassino ontem'
                  : 'Sicrano perdeu tudo no cassino ontem',
              subjects: [0],
              keywords: ['cassino'],
              score: 80,
            },
          ],
        });
      },
      generateOllama: async () => '{"facts":[]}',
    });
    const cfg = resolveFunConfig({ memoryMinScore: 20, zenEnabled: true });

    // flush 1: mico do Fulano
    for (let i = 0; i < 3; i += 1) {
      mem._pushRaw(scope, {
        userJid: fulano,
        name: 'Fulano',
        text: `perdi tudo no cassino ${i}`,
        at: Date.now(),
      });
    }
    await mem.forceFlush(scope, cfg);

    // flush 2: texto quase idêntico, mas autor é o Sicrano
    for (let i = 0; i < 3; i += 1) {
      mem._pushRaw(scope, {
        userJid: sicrano,
        name: 'Sicrano',
        text: `perdi tudo no cassino ${i}`,
        at: Date.now(),
      });
    }
    await mem.forceFlush(scope, cfg);

    const facts = repo.listFacts(scope, { limit: 20, minScore: 0 });
    assert.equal(facts.length, 2, 'eventos de pessoas diferentes ficam separados');
    assert.ok(facts.every((f) => f.hits === 1), 'não reforçou um com o texto do outro');
    assert.ok(facts.some((f) => f.subjects.includes(fulano)));
    assert.ok(facts.some((f) => f.subjects.includes(sicrano)));
  } finally {
    if (prev !== undefined) process.env.FUN_DISABLE_LIVE_LLM = prev;
    else process.env.FUN_DISABLE_LIVE_LLM = '1';
  }
});

test('groupMemoryService: reforço com texto divergente não sobrescreve summary nem infla score', async () => {
  const prev = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    const repo = createFunMemoryRepository({ getDatabase: getDb });
    const scope = uniqueGroup();
    const u = uniqueJid('5544');
    let round = 0;
    const mem = createGroupMemoryService({
      memoryRepository: repo,
      getContactDisplayName: () => 'Gabriel',
      generateZen: async () => {
        round += 1;
        return JSON.stringify({
          facts: [
            {
              kind: 'running_gag',
              summary:
                round === 1
                  ? 'Gabriel admitiu ter tido uma queda pela Fada Madrinha e Eduardo cravou: comedor de furry'
                  : 'Gabriel chamou Eduardo de comedor de furry',
              subjects: [0],
              keywords: ['furry', 'comedor'],
              score: round === 1 ? 88 : 72,
            },
          ],
        });
      },
      generateOllama: async () => '{"facts":[]}',
    });
    const cfg = resolveFunConfig({ memoryMinScore: 20, zenEnabled: true });

    for (let r = 0; r < 2; r += 1) {
      for (let i = 0; i < 3; i += 1) {
        mem._pushRaw(scope, {
          userJid: u,
          name: 'Gabriel',
          text: `meme do furry round ${r}-${i}`,
          at: Date.now(),
        });
      }
      await mem.forceFlush(scope, cfg);
    }

    const facts = repo.listFacts(scope, { limit: 20, minScore: 0 });
    assert.equal(facts.length, 1, 'mesma pessoa + keywords iguais → reforça (1 fato)');
    assert.equal(facts[0].hits, 2);
    assert.match(
      facts[0].summary,
      /Fada Madrinha/,
      'summary original preservado — texto conflitante não sobrescreve'
    );
    assert.equal(facts[0].score, 88, 'score não infla com texto divergente');
  } finally {
    if (prev !== undefined) process.env.FUN_DISABLE_LIVE_LLM = prev;
    else process.env.FUN_DISABLE_LIVE_LLM = '1';
  }
});

test('handlers: /lore e /esquecelore tudo sim', async () => {
  const repo = createFunMemoryRepository({ getDatabase: getDb });
  const scope = uniqueGroup();
  const subject = uniqueJid('5577');
  repo.insertFact({
    scopeKey: scope,
    kind: 'nickname',
    summary: 'Fulano é chamado de Rei do Daily no grupo',
    subjects: [subject],
    score: 60,
  });

  const mem = createGroupMemoryService({
    memoryRepository: repo,
    getContactDisplayName: () => 'Fulano',
    generateZen: async () => '{"facts":[]}',
    generateOllama: async () => '{"facts":[]}',
  });

  const replies = [];
  const reply = async (t) => replies.push(String(t));

  await handleLoreCommand({
    scopeKey: scope,
    isGroup: true,
    groupMemoryService: mem,
    funConfig: resolveFunConfig({}),
    reply,
  });
  assert.ok(replies.some((r) => /Lore|Daily|Rei/i.test(r)));

  await handleForgetLoreCommand({
    userJid: uniqueJid(),
    scopeKey: scope,
    isGroup: true,
    groupMemoryService: mem,
    funConfig: resolveFunConfig({}),
    reply,
    args: ['tudo', 'sim'],
  });
  assert.equal(repo.countFacts(scope), 0);
  assert.ok(replies.some((r) => /apagada|Removi/i.test(r)));
});

test('handlers: esquecelore @user remove só o sujeito', async () => {
  const repo = createFunMemoryRepository({ getDatabase: getDb });
  const scope = uniqueGroup();
  const a = uniqueJid('5561');
  const b = uniqueJid('5562');
  repo.insertFact({
    scopeKey: scope,
    kind: 'event',
    summary: 'Historia so do A no grupo',
    subjects: [a],
    score: 55,
  });
  repo.insertFact({
    scopeKey: scope,
    kind: 'event',
    summary: 'Historia so do B no grupo',
    subjects: [b],
    score: 55,
  });
  const mem = createGroupMemoryService({ memoryRepository: repo });
  const replies = [];

  await handleForgetLoreCommand({
    userJid: uniqueJid(),
    scopeKey: scope,
    isGroup: true,
    groupMemoryService: mem,
    funConfig: resolveFunConfig({}),
    getContactDisplayName: (j) => (j === a ? 'Alpha' : 'Beta'),
    listContacts: () => [],
    reply: async (t) => replies.push(t),
    args: [],
    mentionedJids: [a],
  });

  assert.equal(repo.countFacts(scope), 1);
  const left = repo.listFacts(scope, { limit: 10 });
  assert.equal(left[0].subjects.includes(b), true);
});

test('buildLoreContext: persona cache hit', () => {
  const repo = createFunMemoryRepository({ getDatabase: getDb });
  const scope = uniqueGroup();
  const u = uniqueJid('5510');
  const factCreatedAt = Date.UTC(2026, 7, 28, 20, 0, 0);
  const promptNow = Date.UTC(2026, 8, 1, 12, 0, 0);
  repo.insertFact({
    scopeKey: scope,
    kind: 'event',
    summary: 'Fato cacheavel de teste de persona no grupo',
    subjects: [u],
    score: 70,
    now: factCreatedAt,
  });
  repo.setPersona(scope, 'Grupo caótico de testes', 1);

  const mem = createGroupMemoryService({
    memoryRepository: repo,
    getContactDisplayName: () => 'Tester',
  });
  const contextOptions = {
    limit: 3,
    funConfig: { worldTimezone: 'UTC' },
    now: promptNow,
  };
  const a = mem.buildLoreContext(scope, contextOptions);
  const b = mem.buildLoreContext(scope, contextOptions);
  assert.match(a, /<group_lore>/);
  assert.match(a, /Grupo caótico|Fato cacheavel|Tester/i);
  assert.match(a, /data_atual=2026-09-01/);
  assert.match(a, /data_do_fato=2026-08-28/);
  assert.match(a, /fuso=UTC/);
  assert.match(a, /"amanhã".*data_do_fato/);
  assert.equal(mem._personaCache.has(scope), true);
  assert.match(b, /group_lore/);
});

test('buildPersonaLoreContext: envia todos os fatos sem ranking, score mínimo ou corte', () => {
  const repo = createFunMemoryRepository({ getDatabase: getDb });
  const scope = uniqueGroup();
  const authors = new Map();
  const summaries = Array.from({ length: 15 }, (_, index) => {
    const author = uniqueJid(`552${index}`);
    authors.set(author, `Pessoa${index}`);
    const summary = `Fato integral ${index}: ${'x'.repeat(90)} fim-${index}`;
    repo.insertFact({
      scopeKey: scope,
      kind: index % 2 ? 'running_gag' : 'event',
      summary,
      subjects: [author],
      score: index === 14 ? 1 : 80 - index,
    });
    return summary;
  });
  const mem = createGroupMemoryService({
    memoryRepository: repo,
    getContactDisplayName: (jid) => authors.get(jid) || '',
  });

  const lore = mem.buildPersonaLoreContext(scope, { funConfig: {} });

  assert.match(lore, /^<group_lore>\n/);
  assert.match(lore, /\nFatos:\n/);
  assert.match(lore, /\[event\] \(Autor: Pessoa0\): Fato integral 0/);
  for (const summary of summaries) {
    assert.ok(lore.includes(summary), `fato deve entrar integralmente: ${summary.slice(-8)}`);
  }
  assert.match(lore, /fim-14/);
  assert.match(lore, /<\/group_lore>$/);
});

/* ——— Anti-alucinação (garantias de pipeline, sem LLM real) ——— */

test('anti-alucinação: defaults de contexto grande (≤40k chars)', () => {
  assert.ok(DEFAULT_FUN_CONFIG.memoryBufferSize >= 80);
  assert.ok(DEFAULT_FUN_CONFIG.memoryFlushMinMessages >= 30);
  assert.ok(DEFAULT_FUN_CONFIG.memoryExtractMaxChars <= 40_000);
  assert.ok(DEFAULT_FUN_CONFIG.memoryExtractMaxChars >= 20_000);
  const cfg = resolveFunConfig({});
  assert.ok(cfg.memoryBufferSize >= 80);
  assert.ok(cfg.memoryExtractMaxChars <= 40_000);
  // clamp: não deixa estourar 40k mesmo se config.user pedir 999999
  const capped = resolveFunConfig({ memoryExtractMaxChars: 999_999 });
  assert.equal(capped.memoryExtractMaxChars, 40_000);
});

test('parseFactsJson: resgata JSON GLM quebrado (fact + subject vazio)', () => {
  // caso real em produção (2026-07-26): modelo manda schema inventado + JSON inválido
  const broken =
    '{"facts":[{"subject":,"fact":"Gabriel se considera adulto e \'arrombado\', só faltando ser rico — e ainda por cima sem carro"}]}';
  const batch = [
    { name: 'Gabriel', text: 'adulto e arrombado', userJid: '5511g@s.whatsapp.net' },
    { name: 'Eduardo', text: 'kk', userJid: '5511e@s.whatsapp.net' },
  ];
  const got = parseFactsJson(broken, { batchSize: 2, batch, maxFacts: 4 });
  assert.equal(got.length, 1);
  assert.match(got[0].summary, /Gabriel|adulto|arrombado/i);
  assert.deepEqual(got[0].subjectIndices, [0]);
  assert.equal(got[0].kind, 'event');
  assert.equal(got[0].subjectInferred, true);
});

test('parseFactsJson: kind humor + subjects vazio + score 0-1 (GLM live)', () => {
  // segundo caso real: kind inventado, subjects":,, score fracional
  const broken =
    '{"facts":[{"kind":"humor","summary":"Gabriel se declara adulto e \'arrombado\', dizendo que só falta ser rico, e ainda por cima sem carro","subjects":,"keywords":["adulto","arrombado","rico","sem carro"],"score":0.8}]}';
  const batch = [
    { name: 'Gabriel', text: 'adulto', userJid: 'g@s.whatsapp.net' },
    { name: 'Eduardo', text: 'kk', userJid: 'e@s.whatsapp.net' },
  ];
  const got = parseFactsJson(broken, { batchSize: 2, batch });
  assert.equal(got.length, 1);
  assert.equal(got[0].kind, 'running_gag');
  assert.equal(got[0].score, 80);
  assert.deepEqual(got[0].subjectIndices, [0]);
  assert.ok(got[0].keywords.includes('adulto'));
});

test('parseFactsJson: subjects escalar + aliases de summary', () => {
  const batch = [
    { name: 'Marina', text: 'academia', userJid: 'm@s.whatsapp.net' },
    { name: 'Lucas', text: 'ok', userJid: 'l@s.whatsapp.net' },
  ];
  // subjects como número (não array)
  const scalar = parseFactsJson(
    JSON.stringify({
      facts: [
        {
          kind: 'epic_fail',
          summary: 'Marina faltou na academia de novo depois de jurar que ia',
          subjects: 0,
          score: 70,
        },
      ],
    }),
    { batchSize: 2, batch }
  );
  assert.equal(scalar.length, 1);
  assert.deepEqual(scalar[0].subjectIndices, [0]);
  assert.equal(scalar[0].subjectInferred, false);

  // alias "fact" em JSON válido
  const alias = parseFactsJson(
    JSON.stringify({
      facts: [
        {
          fact: 'Lucas disse que ia voltar a treinar e sumiu por 3 semanas',
          subject: 1,
          score: 65,
        },
      ],
    }),
    { batchSize: 2, batch }
  );
  assert.equal(alias.length, 1);
  assert.match(alias[0].summary, /Lucas|treinar/i);
  assert.deepEqual(alias[0].subjectIndices, [1]);
});

test('anti-alucinação: descarta índice fora do batch / CPF / kind inventado', () => {
  // subject [99] com batch de 5 → null
  assert.equal(
    validateExtractedFact(
      {
        kind: 'epic_fail',
        summary: 'Fato com subject inventado fora do batch de mensagens',
        subjects: [99],
        score: 90,
      },
      { batchSize: 5 }
    ),
    null
  );

  // CPF no summary → sensível
  assert.equal(
    validateExtractedFact({
      kind: 'event',
      summary: 'O CPF dele e 123.456.789-09 vazou no grupo',
      subjects: [0],
      score: 80,
    }),
    null
  );

  // kind alucinado → mapeia para event (não descarta o fato)
  const kindMapped = validateExtractedFact({
    kind: 'conspiracy_theory',
    summary: 'Algo bem longo o suficiente mas kind inventado',
    subjects: [0],
    score: 80,
  });
  assert.ok(kindMapped);
  assert.equal(kindMapped.kind, 'event');

  // kind "humor" (GLM) → running_gag; score 0.8 → 80
  const humor = validateExtractedFact({
    kind: 'humor',
    summary: 'Gabriel se declara adulto e arrombado so falta ser rico',
    subjects: [0],
    score: 0.8,
  });
  assert.ok(humor);
  assert.equal(humor.kind, 'running_gag');
  assert.equal(humor.score, 80);

  // subjects mistos: nome + ID válido → fica só o ID
  const mixed = validateExtractedFact(
    {
      kind: 'rivalry',
      summary: 'Jonas zoou o Eduardo por so cair coroa na moeda',
      subjects: ['Jonas', 2, 'Eduardo'],
      score: 70,
    },
    { batchSize: 8 }
  );
  assert.ok(mixed);
  assert.deepEqual(mixed.subjectIndices, [2]);

  // parseFactsJson: só o fato com subject válido sobrevive
  const parsed = parseFactsJson(
    JSON.stringify({
      facts: [
        {
          kind: 'event',
          summary: 'Inventei que o Hélio comprou um jato particular no grupo',
          subjects: ['Hélio'],
          score: 99,
        },
        {
          kind: 'epic_fail',
          summary: 'Eduardo jura que caiu so coroa tipo 1 em 300',
          subjects: [0],
          keywords: ['coroa', 'moeda'],
          score: 75,
        },
        {
          kind: 'event',
          summary: 'Subject index fora do range nao pode passar',
          subjects: [50],
          score: 80,
        },
      ],
    }),
    { batchSize: 8 }
  );
  assert.equal(parsed.length, 1);
  assert.deepEqual(parsed[0].subjectIndices, [0]);
  assert.match(parsed[0].summary, /coroa/i);
});

test('anti-alucinação: mapSubjectsToJids não troca autor (batch multi-pessoa)', () => {
  const repo = createFunMemoryRepository({ getDatabase: getDb });
  const mem = createGroupMemoryService({ memoryRepository: repo });
  const eduardo = uniqueJid('5501');
  const jonas = uniqueJid('5502');
  const batch = [
    { userJid: eduardo, name: 'Eduardo', text: 'tava caindo so coroa', at: 1 },
    { userJid: jonas, name: 'Jonas Marques', text: 'KAKAKA bem vindo ao clube', at: 2 },
    { userJid: eduardo, name: 'Eduardo', text: 'Eu criei o perfil', at: 3 },
  ];

  // subjects [0] → só Eduardo
  assert.deepEqual(mem.mapSubjectsToJids(batch, [0]), [eduardo]);
  // subjects [1] → só Jonas (não vaza Eduardo)
  assert.deepEqual(mem.mapSubjectsToJids(batch, [1]), [jonas]);
  // subjects [0,1] → ambos, ordem de aparição
  assert.deepEqual(mem.mapSubjectsToJids(batch, [0, 1]), [eduardo, jonas]);
  // índice fantasma → vazio (não inventa JID)
  assert.deepEqual(mem.mapSubjectsToJids(batch, [9]), []);
  assert.deepEqual(mem.mapSubjectsToJids(batch, []), []);
});

test('anti-alucinação: packBatchForExtract respeita teto e reindexa sem inventar msg', () => {
  const repo = createFunMemoryRepository({ getDatabase: getDb });
  const mem = createGroupMemoryService({ memoryRepository: repo });
  const jid = uniqueJid('5503');
  const msgs = [];
  for (let i = 0; i < 80; i += 1) {
    msgs.push({
      userJid: jid,
      name: `User${i}`,
      text: `mensagem de conversa numero ${i} com bastante texto pra encher o prompt `.repeat(3),
      at: i,
    });
  }

  const packed = mem.packBatchForExtract(msgs, {
    msgMaxChars: 400,
    extractMaxChars: 8_000,
  });
  assert.ok(packed.length >= 12, `esperava várias msgs, got ${packed.length}`);
  assert.ok(packed.length < msgs.length, 'deve cortar as mais antigas sob teto baixo');

  // IDs no format são 0..n-1 do packed (não índices fantasma do batch original)
  const lines = packed
    .map((m, i) => {
      const name = String(m.name || '?').slice(0, 40);
      return `[${i}] ${name}: ${m.text}`;
    })
    .join('\n');
  assert.ok(lines.length <= 8_000 + 500); // folga de formatação
  assert.match(lines, /^\[0\]/);
  assert.doesNotMatch(lines, /\[80\]|\[99\]/);

  // última msg do pack = mais recente do input
  assert.equal(packed[packed.length - 1].at, 79);
});

test('anti-alucinação: flush com batch grande não grava subject errado nem fato sem ID', async () => {
  const prev = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    const repo = createFunMemoryRepository({ getDatabase: getDb });
    const scope = uniqueGroup();
    const eduardo = uniqueJid('5511');
    const jonas = uniqueJid('5512');
    /** @type {string[]} */
    const prompts = [];

    const mem = createGroupMemoryService({
      memoryRepository: repo,
      getContactDisplayName: (j) => (j === eduardo ? 'Eduardo' : j === jonas ? 'Jonas' : '?'),
      generateZen: async (opts) => {
        if (opts?.jsonMode) {
          prompts.push(String(opts.prompt || ''));
          // LLM "maluca": 1 fato ok (Jonas id 1 no trecho final), 1 com nome, 1 com idx fora
          return JSON.stringify({
            facts: [
              {
                kind: 'running_gag',
                summary: 'Jonas zoa Eduardo por so cair coroa na flip',
                subjects: [1],
                keywords: ['coroa', 'flip'],
                score: 80,
              },
              {
                kind: 'event',
                summary: 'Hélio comprou jato particular segundo a IA sonhadora',
                subjects: ['Hélio'],
                score: 99,
              },
              {
                kind: 'event',
                summary: 'Fato com id de mensagem que nao existe no batch',
                subjects: [999],
                score: 90,
              },
            ],
          });
        }
        return '• Jonas zoa coroa do Eduardo';
      },
      generateOllama: async () => '{"facts":[]}',
    });

    const cfg = resolveFunConfig({
      memoryEnabled: true,
      memoryMinScore: 30,
      memoryBufferSize: 100,
      memoryFlushMinMessages: 40,
      zenEnabled: true,
    });

    // 50 msgs alternando Eduardo/Jonas — contexto grande como produção
    for (let i = 0; i < 50; i += 1) {
      const isEdu = i % 2 === 0;
      mem._pushRaw(scope, {
        userJid: isEdu ? eduardo : jonas,
        name: isEdu ? 'Eduardo' : 'Jonas',
        text: isEdu
          ? `Realmente tava dando so coroa flip ${i}`
          : `KAKAKA bem vindo ao clube flip ${i}`,
        at: Date.now() + i,
      });
    }

    const r = await mem.forceFlush(scope, cfg);
    assert.equal(r.ok, true);
    assert.ok(r.batchSize >= 40, `batch grande esperado, got ${r.batchSize}`);
    assert.ok(prompts.length >= 1, 'prompt enviado ao Zen');
    // prompt deve carregar MUITAS linhas [n], não 8.
    // Formato novo: cada linha é "[HH:MM] [N] Nome: ..." (com timestamp) ou "[N] Nome: ..." (sem).
    const lineHits = (prompts[0].match(/(?:^\[?\d{1,2}:\d{2}\]? )?\[\d+\] /gm) || []).length;
    assert.ok(lineHits >= 40, `prompt com ≥40 msgs, got ${lineHits}`);

    const facts = repo.listFacts(scope, { limit: 10 });
    // só 1 fato válido (o dos subjects:[1]); alucinações descartadas
    assert.equal(facts.length, 1, `só 1 fato válido, got ${facts.length}`);
    assert.deepEqual(facts[0].subjects, [jonas], 'autor = Jonas (id 1), não Eduardo nem Hélio');
    assert.equal(facts[0].subjects.includes(eduardo), false);
    assert.match(facts[0].summary, /coroa|Jonas|Eduardo/i);
  } finally {
    if (prev !== undefined) process.env.FUN_DISABLE_LIVE_LLM = prev;
    else process.env.FUN_DISABLE_LIVE_LLM = '1';
  }
});

test('anti-alucinação: facts vazios / lixo da LLM não poluem banco', async () => {
  const prev = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    const repo = createFunMemoryRepository({ getDatabase: getDb });
    const scope = uniqueGroup();
    const mem = createGroupMemoryService({
      memoryRepository: repo,
      generateZen: async (opts) => {
        if (opts?.jsonMode) {
          return 'Claro! Aqui vai um resumo: o grupo e legal e o Eduardo e o melhor. {"facts":[]}';
        }
        return '• clima ok';
      },
      generateOllama: async () =>
        JSON.stringify({
          facts: [
            {
              kind: 'event',
              summary: 'ok',
              subjects: [0],
              score: 90,
            },
          ],
        }),
    });
    const cfg = resolveFunConfig({ memoryMinScore: 20, zenEnabled: true, ollamaEnabled: true });
    for (let i = 0; i < 5; i += 1) {
      mem._pushRaw(scope, {
        userJid: uniqueJid('5590'),
        name: 'X',
        text: `conversa normal sem mico especial numero ${i}`,
        at: Date.now() + i,
      });
    }
    await mem.forceFlush(scope, cfg);
    // Zen devolveu facts:[] (mesmo com blá-blá) → nada; Ollama summary "ok" curto → descarta
    assert.equal(repo.countFacts(scope), 0);
  } finally {
    if (prev !== undefined) process.env.FUN_DISABLE_LIVE_LLM = prev;
    else process.env.FUN_DISABLE_LIVE_LLM = '1';
  }
});

/* ——— Cota por Membro (Cap 120) e Extração com Contexto e Desacoplamento Autor/Sujeito ——— */

test('pruneToCapWithMemberQuota: garante até 5 fatos independentes com score >= 80 por membro', () => {
  const repo = createFunMemoryRepository({ getDatabase: getDb });
  const scope = uniqueGroup();

  const alpha = uniqueJid('5501'); // Hiper-ativo
  const beta = uniqueJid('5502');  // 5 fatos bons (score >= 80)
  const gama = uniqueJid('5503');  // 3 fatos bons (score >= 80)
  const delta = uniqueJid('5504'); // fatos fracos (score < 80)

  // Beta: 5 fatos independentes com score >= 80
  const betaFactSummaries = [
    'Beta derrubou a sopa de legumes no chao da cozinha',
    'Beta comprou uma bicicleta amarela sem freio nenhum',
    'Beta perdeu o voo para Fortaleza no feriado passado',
    'Beta adotou um papagaio que aprendeu a xingar os vizinhos',
    'Beta ganhou um trofeu de xadrez na escola no ano passado',
  ];
  const betaIds = [];
  for (let i = 0; i < betaFactSummaries.length; i++) {
    const f = repo.insertFact({
      scopeKey: scope,
      kind: 'event',
      summary: betaFactSummaries[i],
      subjects: [beta],
      score: 82 + i * 2, // 82, 84, 86, 88, 90
    });
    betaIds.push(f.id);
  }

  // Gama: 3 fatos independentes com score >= 80
  const gamaFactSummaries = [
    'Gama esqueceu o capacete na padaria do bairro',
    'Gama ganhou cinquenta reais na raspadinha da loterica',
    'Gama dormiu no onibus e acordou no ponto final da linha',
  ];
  const gamaIds = [];
  for (let i = 0; i < gamaFactSummaries.length; i++) {
    const f = repo.insertFact({
      scopeKey: scope,
      kind: 'event',
      summary: gamaFactSummaries[i],
      subjects: [gama],
      score: 85 + i,
    });
    gamaIds.push(f.id);
  }

  // Delta: 10 fatos fracos (score 60)
  for (let i = 0; i < 10; i++) {
    repo.insertFact({
      scopeKey: scope,
      kind: 'event',
      summary: `Delta falou algo generico sem graca numero ${i} no grupo`,
      subjects: [delta],
      score: 60,
    });
  }

  // Alpha: 110 fatos (scores variados de 70 a 95)
  for (let i = 0; i < 110; i++) {
    repo.insertFact({
      scopeKey: scope,
      kind: 'running_gag',
      summary: `Alpha mandou mais uma piada do dia numero ${i} com detalhes`,
      subjects: [alpha],
      score: 70 + (i % 25), // 70 a 94
    });
  }

  // Total de fatos inseridos: 5 + 3 + 10 + 110 = 128 fatos (> 120 cap)
  const totalBefore = repo.countFacts(scope);
  assert.equal(totalBefore, 128);

  // Executa pruning para o cap de 120
  const pruned = repo.pruneToCapWithMemberQuota(scope, 120, {
    minFactsPerMember: 5,
    minScoreQuota: 80,
  });

  assert.equal(pruned, 8, 'exatamente 8 fatos removidos para bater o cap de 120');
  assert.equal(repo.countFacts(scope), 120, 'cap de 120 respeitado');

  // Todos os 5 fatos do Beta continuam intactos (protegidos pela cota)
  for (const bId of betaIds) {
    const f = repo.getFact(bId);
    assert.ok(f, `fato ${bId} do membro Beta deve ser protegido pela cota`);
  }

  // Todos os 3 fatos do Gama continuam intactos (protegidos pela cota)
  for (const gId of gamaIds) {
    const f = repo.getFact(gId);
    assert.ok(f, `fato ${gId} do membro Gama deve ser protegido pela cota`);
  }
});

test('pruneToCapWithMemberQuota: cota exige independencia semantica (fatos redundantes nao ocupam multiplos slots)', () => {
  const repo = createFunMemoryRepository({ getDatabase: getDb });
  const scope = uniqueGroup();

  const user = uniqueJid('5508');
  // 2 fatos quase idênticos
  const f1 = repo.insertFact({
    scopeKey: scope,
    kind: 'epic_fail',
    summary: 'Pedro perdeu a chave do carro no estacionamento do shopping ontem',
    subjects: [user],
    score: 95,
  });
  const f2 = repo.insertFact({
    scopeKey: scope,
    kind: 'epic_fail',
    summary: 'Pedro perdeu a chave do carro no estacionamento do shopping ontem a noite',
    subjects: [user],
    score: 90,
  });

  // Insere outros fatos para forçar poda com cap baixo
  for (let i = 0; i < 6; i++) {
    repo.insertFact({
      scopeKey: scope,
      kind: 'event',
      summary: `Outro fato diferente numero ${i} com bom conteudo relevante`,
      subjects: [uniqueJid(`559${i}`)],
      score: 85,
    });
  }

  // Total 8 fatos. Poda para 6 com cota 5:
  // Como f1 e f2 são quase idênticos, apenas f1 é protegido pela cota de independência; f2 pode ser podado.
  repo.pruneToCapWithMemberQuota(scope, 6, {
    minFactsPerMember: 5,
    minScoreQuota: 80,
    independenceThreshold: 0.55,
  });

  assert.equal(repo.countFacts(scope), 6);
  assert.ok(repo.getFact(f1.id), 'f1 de maior score protegido');
});

test('groupMemoryService: extrai fato com target de terceiro e validação cruzada autor vs sujeito', () => {
  const carlos = uniqueJid('5511');
  const pedro = uniqueJid('5512');
  const participants = [
    { pId: 'P0', index: 0, userJid: carlos, name: 'Carlos', firstName: 'Carlos' },
    { pId: 'P1', index: 1, userJid: pedro, name: 'Pedro', firstName: 'Pedro' },
  ];

  const batch = [
    { userJid: carlos, name: 'Carlos', text: 'O Pedro bateu a moto no poste ontem kkkk', at: 1 },
    { userJid: pedro, name: 'Pedro', text: 'Nem me lembra disso mano kkk', at: 2 },
  ];

  // Caso 1: Modelo usa formato target ["P1"]
  const jsonWithTarget = JSON.stringify({
    facts: [
      {
        kind: 'epic_fail',
        summary: 'Pedro bateu a moto no poste ontem a tarde',
        target: ['P1'],
        evidence_msg: 0,
        score: 85,
      },
    ],
  });

  const parsed1 = parseFactsJson(jsonWithTarget, { batchSize: 2, batch, participants });
  assert.equal(parsed1.length, 1);
  assert.equal(parsed1[0].evidenceMsg, 0);

  const mem = createGroupMemoryService({ memoryRepository: createFunMemoryRepository({ getDatabase: getDb }) });
  const jids1 = mem.mapSubjectsToJids(batch, parsed1[0], participants);
  assert.deepEqual(jids1, [pedro], 'target P1 mapeado para o Pedro (não Carlos)');

  // Caso 2: Modelo confuso colocou subjects: [0] (índice da mensagem de Carlos)
  // mas o summary cita explicitamente Pedro e não cita Carlos:
  // A validação cruzada anti-atribuição reatribui para Pedro!
  const jsonWithAuthorMistake = JSON.stringify({
    facts: [
      {
        kind: 'epic_fail',
        summary: 'Pedro bateu a moto no poste e ralou o braco',
        subjects: [0], // Carlos enviou a mensagem 0
        score: 80,
      },
    ],
  });

  const parsed2 = parseFactsJson(jsonWithAuthorMistake, { batchSize: 2, batch, participants });
  assert.equal(parsed2.length, 1);
  const jids2 = mem.mapSubjectsToJids(batch, parsed2[0], participants);
  assert.deepEqual(jids2, [pedro], 'validação cruzada reatribui para Pedro ao detectar citação clara de Pedro');
});

test('groupMemoryService: formatBatchLinesWithContext inclui contexto de quotes e menções', () => {
  const ana = uniqueJid('5521');
  const beto = uniqueJid('5522');
  const participants = [
    { pId: 'P0', index: 0, userJid: ana, name: 'Ana', firstName: 'Ana' },
    { pId: 'P1', index: 1, userJid: beto, name: 'Beto', firstName: 'Beto' },
  ];

  const batch = [
    {
      userJid: ana,
      name: 'Ana',
      text: 'mas você nem pagou a conta ainda kkk',
      at: Date.UTC(2026, 8, 3, 14, 30, 0),
      quotedText: 'vou comprar outro videogame',
      quotedParticipant: beto,
      quotedParticipantName: 'Beto',
      mentionedJids: [beto],
    },
  ];

  const mem = createGroupMemoryService({ memoryRepository: createFunMemoryRepository({ getDatabase: getDb }) });
  const formatted = mem.formatBatchLinesWithContext(batch, participants);

  assert.match(formatted, /\[P0\] Ana/);
  assert.match(formatted, /em resposta a \[P1\] Beto: "vou comprar outro videogame"/);
  assert.match(formatted, /mas você nem pagou a conta ainda/);
});
