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
