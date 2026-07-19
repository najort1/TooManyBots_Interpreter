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

test('default zen model é glm_5_2 no proxy 3300', () => {
  assert.equal(DEFAULT_FUN_CONFIG.zenModel, 'glm_5_2');
  assert.equal(DEFAULT_FUN_CONFIG.zenBaseUrl, 'http://127.0.0.1:3300');
  assert.equal(DEFAULT_FUN_CONFIG.zenSendSamplingParams, false);
  const cfg = resolveFunConfig({});
  assert.equal(cfg.zenModel, 'glm_5_2');
  assert.equal(cfg.zenSendSamplingParams, false);
  assert.equal(cfg.memoryEnabled, true);
  assert.equal(cfg.memoryMaxFacts, 50);
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
  assert.equal(
    validateExtractedFact({
      kind: 'nope',
      summary: 'Fato longo o suficiente para passar no min length',
      subjects: [0],
    }),
    null
  );
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

test('groupMemoryService: Zen falha → Ollama no extract com format json', async () => {
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
    assert.ok(ollama >= 1, `ollama fallback esperado, got ${ollama}`);
    assert.ok(
      ollamaOptsLog.some((o) => o.format === 'json'),
      `format json no extract; opts=${JSON.stringify(ollamaOptsLog)}`
    );
    assert.ok(repo.countFacts(scope) >= 1);
    assert.ok(repo.listFacts(scope, { limit: 1 })[0].subjects.includes(u));
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
  repo.insertFact({
    scopeKey: scope,
    kind: 'event',
    summary: 'Fato cacheavel de teste de persona no grupo',
    subjects: [u],
    score: 70,
  });
  repo.setPersona(scope, 'Grupo caótico de testes', 1);

  const mem = createGroupMemoryService({
    memoryRepository: repo,
    getContactDisplayName: () => 'Tester',
  });
  const a = mem.buildLoreContext(scope, { limit: 3, funConfig: {} });
  const b = mem.buildLoreContext(scope, { limit: 3, funConfig: {} });
  assert.match(a, /<group_lore>/);
  assert.match(a, /Grupo caótico|Fato cacheavel|Tester/i);
  assert.equal(mem._personaCache.has(scope), true);
  assert.match(b, /group_lore/);
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

  // kind alucinado
  assert.equal(
    validateExtractedFact({
      kind: 'conspiracy_theory',
      summary: 'Algo bem longo o suficiente mas kind inventado',
      subjects: [0],
      score: 80,
    }),
    null
  );

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
    // prompt deve carregar MUITAS linhas [n], não 8
    const lineHits = (prompts[0].match(/^\[\d+\]/gm) || []).length;
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
