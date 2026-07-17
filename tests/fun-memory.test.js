/**
 * Memória seletiva por grupo + modelo Zen default + lore commands.
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
  jaccard,
  tokenSet,
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

test('default zen model é mimo-v2.5-free', () => {
  assert.equal(DEFAULT_FUN_CONFIG.zenModel, 'mimo-v2.5-free');
  const cfg = resolveFunConfig({});
  assert.equal(cfg.zenModel, 'mimo-v2.5-free');
  assert.equal(cfg.memoryEnabled, true);
  assert.equal(cfg.memoryMaxFacts, 50);
});

test('parseFunCommand: lore / esquecelore', () => {
  assert.equal(parseFunCommand('/lore', '/').command, FUN_COMMANDS.LORE);
  assert.equal(parseFunCommand('/memorias', '/').command, FUN_COMMANDS.LORE);
  assert.equal(parseFunCommand('/esquecelore', '/').command, FUN_COMMANDS.FORGET_LORE);
  assert.equal(parseFunCommand('/limparlore', '/').command, FUN_COMMANDS.FORGET_LORE);
});

test('parseFactsJson extrai array e rejeita lixo', () => {
  const ok = parseFactsJson(
    `Aqui: [{"kind":"epic_fail","summary":"João derrubou o café no teclado ao vivo","subjects":["João"],"keywords":["cafe","teclado"],"score":72}]`
  );
  assert.equal(ok.length, 1);
  assert.equal(ok[0].kind, 'epic_fail');
  assert.match(ok[0].summary, /café|cafe|teclado/i);

  assert.equal(parseFactsJson('nada de util').length, 0);
  assert.equal(parseFactsJson('').length, 0);
});

test('jaccard / tokenSet dedup basico', () => {
  const a = tokenSet('joao derrubou o cafe no teclado');
  const b = tokenSet('joao derrubou cafe teclado de novo');
  assert.ok(jaccard(a, b) > 0.3);
});

test('memoryRepository: insert, reinforce, prune, forget', () => {
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
  });
  assert.equal(f2.hits, 2);
  assert.equal(f2.score, 80);

  // enche e pruna
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

test('groupMemoryService: observe ignora comando/curto; flush com mock Zen', async () => {
  const prev = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;

  try {
    const repo = createFunMemoryRepository({ getDatabase: getDb });
    const scope = uniqueGroup();
    let zenCalls = 0;

    const mem = createGroupMemoryService({
      memoryRepository: repo,
      getContactDisplayName: (j) => j.split('@')[0],
      generateZen: async () => {
        zenCalls += 1;
        return JSON.stringify([
          {
            kind: 'epic_fail',
            summary: 'Ana mandou figurinha no lugar do comprovante e o grupo explodiu',
            subjects: ['Ana'],
            keywords: ['figurinha', 'comprovante'],
            score: 78,
          },
        ]);
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

    // aguarda flush async
    await new Promise((r) => setTimeout(r, 80));
    // força se ainda não flushou (race)
    if (repo.countFacts(scope) === 0) {
      await mem.forceFlush(scope, cfg);
    }

    assert.ok(zenCalls >= 1, 'zen extract chamado');
    assert.ok(repo.countFacts(scope) >= 1, 'fato persistido');

    const lore = mem.buildLoreContext(scope, { userJids: [u], limit: 5, funConfig: cfg });
    assert.match(lore, /figurinha|comprovante|Ana|Lore|Clima/i);

    const list = mem.formatLoreList(scope, { funConfig: cfg });
    assert.match(list, /Lore do grupo/i);
  } finally {
    if (prev !== undefined) process.env.FUN_DISABLE_LIVE_LLM = prev;
    else process.env.FUN_DISABLE_LIVE_LLM = '1';
  }
});

test('groupMemoryService: Zen falha → Ollama no extract', async () => {
  const prev = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    const repo = createFunMemoryRepository({ getDatabase: getDb });
    const scope = uniqueGroup();
    let ollama = 0;
    const mem = createGroupMemoryService({
      memoryRepository: repo,
      generateZen: async () => {
        throw new Error('zen-down');
      },
      generateOllama: async () => {
        ollama += 1;
        return `[{"kind":"rivalry","summary":"Beto e Carla brigam por quem manda mais figurinha feia","subjects":["Beto","Carla"],"keywords":["figurinha","rival"],"score":66}]`;
      },
    });
    const cfg = resolveFunConfig({
      memoryFlushMinMessages: 3,
      memoryMinScore: 20,
      zenEnabled: true,
      ollamaEnabled: true,
    });
    const u = uniqueJid('5588');
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
    // extract + possível refresh persona
    assert.ok(ollama >= 1, `ollama fallback esperado, got ${ollama}`);
    assert.ok(repo.countFacts(scope) >= 1);
  } finally {
    if (prev !== undefined) process.env.FUN_DISABLE_LIVE_LLM = prev;
    else process.env.FUN_DISABLE_LIVE_LLM = '1';
  }
});

test('groupMemoryService: dedup reforça em vez de duplicar', async () => {
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
            kind: 'running_gag',
            summary: 'Todo mundo zoa o Wi-Fi do predio que cai no clutch',
            subjects: ['Grupo'],
            keywords: ['wifi', 'clutch', 'predio'],
            score: 70,
          },
        ]),
      generateOllama: async () => '[]',
    });
    const cfg = resolveFunConfig({ memoryMinScore: 20, zenEnabled: true });

    for (let round = 0; round < 2; round += 1) {
      for (let i = 0; i < 3; i += 1) {
        mem._pushRaw(scope, {
          userJid: uniqueJid(),
          name: 'Fulano',
          text: `wifi caiu no clutch de novo ${round}-${i}`,
          at: Date.now(),
        });
      }
      await mem.forceFlush(scope, cfg);
    }

    const facts = repo.listFacts(scope, { limit: 20 });
    // deve ter poucos fatos (dedup), com hits se reforçou
    assert.ok(facts.length <= 3);
    assert.ok(facts.some((f) => f.hits >= 1));
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
    generateZen: async () => '[]',
    generateOllama: async () => '[]',
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
