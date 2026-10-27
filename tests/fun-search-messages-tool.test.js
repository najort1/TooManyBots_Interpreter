import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createFunJournalMessageRepository } from '../fun/db/funJournalMessageRepository.js';
import { createPersonaToolExecutor } from '../fun/services/personaToolExecutor.js';
import { createChaosService } from '../fun/services/chaosService.js';
import {
  PERSONA_TOOL_DEFINITIONS,
  buildPersonaToolManifest,
  parsePersonaEnvelope,
  shouldDisplayPersonaToolOutput,
} from '../fun/services/personaToolProtocol.js';
import { DEFAULT_FUN_CONFIG } from '../fun/constants.js';

await initDb();

function uniqueGroup() {
  return `120363ser${String(Date.now()).slice(-9)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

let jidCounter = 0;
function uniqueJid(seed = '') {
  jidCounter += 1;
  return `551197${String(Date.now()).slice(-6)}${String(jidCounter).padStart(4, '0')}${seed}@s.whatsapp.net`;
}

function createExecutorWithJournal({ getDatabase = getDb, funConfig } = {}) {
  const journal = createFunJournalMessageRepository({ getDatabase });
  const chaos = createChaosService({ repository: { getLeaderboard: () => [] } });
  const executor = createPersonaToolExecutor({
    chaosService: chaos,
    journalMessageRepository: journal,
  });
  return { executor, journal };
}

test('persona tools: search_messages está na allowlist com schema, readOnly e fullOutput=false', () => {
  const def = PERSONA_TOOL_DEFINITIONS.search_messages;
  assert.ok(def, 'definição presente em PERSONA_TOOL_DEFINITIONS');
  assert.equal(def.fullOutput, false);
  assert.equal(shouldDisplayPersonaToolOutput('search_messages'), false);
  assert.ok(!def.sideEffect);
  assert.deepEqual(def.schema.author.values, ['author', 'mentioned', 'quoted']);
  assert.match(
    buildPersonaToolManifest(),
    /- search_messages \{query:texto, author:author\|mentioned\|quoted, limit:texto\}: Busca mensagens humanas/
  );

  const parsed = parsePersonaEnvelope(
    JSON.stringify({ type: 'tool_call', name: 'search_messages', arguments: { query: 'churrasco' } })
  );
  assert.equal(parsed.ok, true);
  assert.equal(parsed.envelope.arguments.query, 'churrasco');
  // limite clamped pelo schema (type string, max 16)
  const parsedLimit = parsePersonaEnvelope(
    JSON.stringify({ type: 'tool_call', name: 'search_messages', arguments: { limit: '999999' } })
  );
  assert.equal(parsedLimit.ok, true);
  assert.equal(parsedLimit.envelope.arguments.limit, '999999');
});

test('search_messages: sem query e sem autor → erro amigável pedindo critério', async () => {
  const { executor } = createExecutorWithJournal();
  const scope = uniqueGroup();
  const result = await executor.execute(
    { name: 'search_messages', arguments: {} },
    { scopeKey: scope, authorJid: uniqueJid(), funConfig: { ...DEFAULT_FUN_CONFIG }, now: Date.now() }
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing-criteria');
  assert.match(result.text, /critério|criterio|termo|autor/i);
});

test('search_messages: acha por termo, ignora bot e retorna os mais recentes', async () => {
  const { executor, journal } = createExecutorWithJournal();
  const scope = uniqueGroup();
  const now = Date.now();
  const ana = uniqueJid('ana');
  const bot = 'bot@s.whatsapp.net';

  assert.equal(journal.recordMessage({ scopeKey: scope, messageId: 'm1', authorJid: ana, text: 'quem trouxe o churrasco de ontem?', source: 'human', now: now - 60_000 }).ok, true);
  assert.equal(journal.recordMessage({ scopeKey: scope, messageId: 'm2', authorJid: ana, text: 'CHURRASCO hoje sim!', source: 'human', now: now - 30_000 }).ok, true);
  // mensagem do bot com a mesma palavra NÃO pode entrar
  assert.equal(journal.recordMessage({ scopeKey: scope, messageId: 'm3', authorJid: bot, text: 'CHURRASCO automatizado do jornal', source: 'bot', now: now - 20_000 }).ok, true);
  // fora da janela de retenção (coachada para antes do since) não pode entrar
  assert.equal(journal.recordMessage({ scopeKey: scope, messageId: 'm4', authorJid: ana, text: 'churrasco antigo demais', source: 'human', now: now - 10 * 24 * 60 * 60_000 }).ok, true);

  const result = await executor.execute(
    { name: 'search_messages', arguments: { query: 'churrasco' } },
    {
      scopeKey: scope,
      authorJid: uniqueJid('eu'),
      funConfig: { ...DEFAULT_FUN_CONFIG, groupNewsMessageRetentionDays: 3 },
      getContactDisplayName: (jid) => (jid === ana ? 'Ana' : jid),
      now,
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.length, 2);
  // mais recente primeiro
  assert.match(result.data[0].text, /CHURRASCO hoje sim/);
  assert.equal(result.data[0].authorLabel, 'Ana');
  assert.equal(result.data[1].authorLabel, 'Ana');
  assert.match(result.summary, /Encontrei 2 mensagens/);
  assert.match(result.summary, /~3 dias/);
  assert.match(result.text, /Ana: CHURRASCO hoje sim/);
  assert.ok(!result.text.includes('automatizado'));
});

test('search_messages: filtro por autor via author=author (o próprio usuário)', async () => {
  const { executor, journal } = createExecutorWithJournal();
  const scope = uniqueGroup();
  const now = Date.now();
  const author = uniqueJid('eu');
  const outro = uniqueJid('outro');

  journal.recordMessage({ scopeKey: scope, messageId: 'a1', authorJid: author, text: 'minha fala exclusiva 1', source: 'human', now: now - 50_000 });
  journal.recordMessage({ scopeKey: scope, messageId: 'a2', authorJid: author, text: 'minha fala exclusiva 2', source: 'human', now: now - 40_000 });
  journal.recordMessage({ scopeKey: scope, messageId: 'a3', authorJid: outro, text: 'minha fala exclusiva do outro', source: 'human', now: now - 30_000 });

  const result = await executor.execute(
    { name: 'search_messages', arguments: { author: 'author' } },
    {
      scopeKey: scope,
      authorJid: author,
      funConfig: { ...DEFAULT_FUN_CONFIG },
      getContactDisplayName: (jid) => (jid === author ? 'Eu Mesmo' : 'Outro'),
      now,
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.length, 2);
  for (const item of result.data) {
    assert.equal(item.authorJid, author);
    assert.equal(item.authorLabel, 'Eu Mesmo');
  }
});

test('search_messages: author=mentioned usa a primeira menção do ctx', async () => {
  const { executor, journal } = createExecutorWithJournal();
  const scope = uniqueGroup();
  const now = Date.now();
  const alvo = uniqueJid('alvo');
  const falante = uniqueJid('falante');

  journal.recordMessage({ scopeKey: scope, messageId: 'm1', authorJid: alvo, text: 'falei uma vez importante', source: 'human', now: now - 40_000 });
  journal.recordMessage({ scopeKey: scope, messageId: 'm2', authorJid: falante, text: 'ruído do falante importante', source: 'human', now: now - 30_000 });

  const result = await executor.execute(
    { name: 'search_messages', arguments: { author: 'mentioned' } },
    {
      scopeKey: scope,
      authorJid: uniqueJid('pedinte'),
      mentionedJids: [alvo],
      funConfig: { ...DEFAULT_FUN_CONFIG },
      getContactDisplayName: (jid) => (jid === alvo ? 'Alvo' : 'Falante'),
      now,
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].authorJid, alvo);
  assert.match(result.data[0].text, /falei uma vez/);
});

test('search_messages: author=quoted usa o quotedParticipant do ctx', async () => {
  const { executor, journal } = createExecutorWithJournal();
  const scope = uniqueGroup();
  const now = Date.now();
  const citado = uniqueJid('citado');

  journal.recordMessage({ scopeKey: scope, messageId: 'q1', authorJid: citado, text: 'mensagem que foi reply', source: 'human', now: now - 20_000 });
  journal.recordMessage({ scopeKey: scope, messageId: 'q2', authorJid: citado, text: 'outra do citado fora da janela?', source: 'human', now: now - 10_000 });

  const result = await executor.execute(
    { name: 'search_messages', arguments: { author: 'quoted' } },
    {
      scopeKey: scope,
      authorJid: uniqueJid('replicante'),
      quotedParticipant: citado,
      funConfig: { ...DEFAULT_FUN_CONFIG },
      getContactDisplayName: () => 'Citado',
      now,
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.length, 2);
  assert.ok(result.data.every((item) => item.authorJid === citado));
});

test('search_messages: author sem alvo resolúvel → erro amigável', async () => {
  const { executor } = createExecutorWithJournal();
  const scope = uniqueGroup();
  const result = await executor.execute(
    { name: 'search_messages', arguments: { author: 'mentioned' } },
    {
      scopeKey: scope,
      authorJid: uniqueJid(),
      mentionedJids: [],
      funConfig: { ...DEFAULT_FUN_CONFIG },
      now: Date.now(),
    }
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing-target');
  assert.match(result.text, /Não identifiquei o autor/i);
});

test('search_messages: vazio → ok:false com texto amigável', async () => {
  const { executor, journal } = createExecutorWithJournal();
  const scope = uniqueGroup();
  journal.recordMessage({ scopeKey: scope, messageId: 'x1', authorJid: uniqueJid(), text: 'palavra aleatória nada a ver', source: 'human', now: Date.now() - 5_000 });

  const result = await executor.execute(
    { name: 'search_messages', arguments: { query: 'palavrainexistente' } },
    { scopeKey: scope, authorJid: uniqueJid(), funConfig: { ...DEFAULT_FUN_CONFIG }, now: Date.now() }
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no-results');
  assert.match(result.text, /Não achei nada/i);
  assert.match(result.text, /janela de ~\d+ dias/);
});

test('search_messages: acento-insensível (stripDiacritics) no termo', async () => {
  const { executor, journal } = createExecutorWithJournal();
  const scope = uniqueGroup();
  const now = Date.now();
  journal.recordMessage({ scopeKey: scope, messageId: 'd1', authorJid: uniqueJid(), text: 'vou organizar a revisão', source: 'human', now: now - 10_000 });

  const result = await executor.execute(
    { name: 'search_messages', arguments: { query: 'revisão' } },
    { scopeKey: scope, authorJid: uniqueJid(), funConfig: { ...DEFAULT_FUN_CONFIG }, now }
  );
  assert.equal(result.ok, true);
  assert.match(result.data[0].text, /revisão/);
});

test('search_messages: group-only guard do execute continua valendo', async () => {
  const { executor } = createExecutorWithJournal();
  const result = await executor.execute(
    { name: 'search_messages', arguments: { query: 'qualquer' } },
    { scopeKey: '5511999990000@s.whatsapp.net', authorJid: uniqueJid(), funConfig: { ...DEFAULT_FUN_CONFIG }, now: Date.now() }
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'group-only');
});

test('search_messages: sem journalMessageRepository → unavailable amigável', async () => {
  const chaos = createChaosService({ repository: { getLeaderboard: () => [] } });
  const executor = createPersonaToolExecutor({ chaosService: chaos });
  const result = await executor.execute(
    { name: 'search_messages', arguments: { query: 'algo' } },
    { scopeKey: uniqueGroup(), authorJid: uniqueJid(), funConfig: { ...DEFAULT_FUN_CONFIG }, now: Date.now() }
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unavailable');
  assert.match(result.text, /Não consegui folhear/i);
});

test('search_messages: janela usa funConfig.groupNewsMessageRetentionDays e imune a não-números', async () => {
  const { executor, journal } = createExecutorWithJournal();
  const scope = uniqueGroup();
  const now = Date.now();
  journal.recordMessage({ scopeKey: scope, messageId: 'w1', authorJid: uniqueJid('win'), text: 'dentro de cinco dias', source: 'human', now: now - 5 * 24 * 60 * 60_000 });

  const cfg = { ...DEFAULT_FUN_CONFIG, groupNewsMessageRetentionDays: 7 };
  const resultSeven = await executor.execute(
    { name: 'search_messages', arguments: { query: 'cinco dias' } },
    { scopeKey: scope, authorJid: uniqueJid(), funConfig: cfg, now }
  );
  assert.equal(resultSeven.ok, true);
  assert.match(resultSeven.summary, /~7 dias/);

  const resultThree = await executor.execute(
    { name: 'search_messages', arguments: { query: 'dentro de cinco' } },
    { scopeKey: scope, authorJid: uniqueJid(), funConfig: { ...DEFAULT_FUN_CONFIG }, now }
  );
  assert.equal(resultThree.ok, false);
  assert.match(resultThree.text, /janela de ~3 dias/);
});

test('persona tools: protocolo aceita números para campos string (ex: limit: 5)', () => {
  const parsed = parsePersonaEnvelope(
    JSON.stringify({ type: 'tool_call', name: 'search_messages', arguments: { limit: 5 } })
  );
  assert.equal(parsed.ok, true);
  assert.equal(parsed.envelope.arguments.limit, '5');
});

test('search_messages: respeita args.limit clamped entre 1 e 20', async () => {
  const { executor, journal } = createExecutorWithJournal();
  const scope = uniqueGroup();
  const now = Date.now();
  const user = uniqueJid('usr');

  for (let i = 1; i <= 5; i++) {
    journal.recordMessage({
      scopeKey: scope,
      messageId: `msg-${i}`,
      authorJid: user,
      text: `mensagem de teste número ${i}`,
      source: 'human',
      now: now - (10 - i) * 1000,
    });
  }

  const resultLimit2 = await executor.execute(
    { name: 'search_messages', arguments: { query: 'mensagem de teste', limit: 2 } },
    { scopeKey: scope, authorJid: user, funConfig: { ...DEFAULT_FUN_CONFIG }, now }
  );
  assert.equal(resultLimit2.ok, true);
  assert.equal(resultLimit2.data.length, 2);
  assert.match(resultLimit2.data[0].text, /número 5/);
  assert.match(resultLimit2.data[1].text, /número 4/);

  const resultLimitString = await executor.execute(
    { name: 'search_messages', arguments: { query: 'mensagem de teste', limit: '3' } },
    { scopeKey: scope, authorJid: user, funConfig: { ...DEFAULT_FUN_CONFIG }, now }
  );
  assert.equal(resultLimitString.ok, true);
  assert.equal(resultLimitString.data.length, 3);
});

test('search_messages: stopwords ignoradas e exige todos os tokens significativos (.every())', async () => {
  const { executor, journal } = createExecutorWithJournal();
  const scope = uniqueGroup();
  const now = Date.now();
  const user = uniqueJid('user');

  journal.recordMessage({
    scopeKey: scope,
    messageId: 'sw1',
    authorJid: user,
    text: 'ele vai com ela para a praia',
    source: 'human',
    now: now - 30_000,
  });

  journal.recordMessage({
    scopeKey: scope,
    messageId: 'sw2',
    authorJid: user,
    text: 'vai ter jogo de futebol na quarta feira',
    source: 'human',
    now: now - 20_000,
  });

  journal.recordMessage({
    scopeKey: scope,
    messageId: 'sw3',
    authorJid: user,
    text: 'vai ter futebol no domingo com a galera',
    source: 'human',
    now: now - 10_000,
  });

  const result = await executor.execute(
    { name: 'search_messages', arguments: { query: 'vai ter futebol no domingo com' } },
    { scopeKey: scope, authorJid: user, funConfig: { ...DEFAULT_FUN_CONFIG }, now }
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.length, 1);
  assert.match(result.data[0].text, /futebol no domingo/);
});

test('search_messages: janela traz as mensagens mais recentes primeiro quando há muitas mensagens', async () => {
  const { executor, journal } = createExecutorWithJournal();
  const scope = uniqueGroup();
  const now = Date.now();
  const user = uniqueJid('u');

  // Grava 10 mensagens antigas com a palavra "raridade"
  for (let i = 1; i <= 10; i++) {
    journal.recordMessage({
      scopeKey: scope,
      messageId: `old-${i}`,
      authorJid: user,
      text: `mensagem antiga com raridade ${i}`,
      source: 'human',
      now: now - 3600_000 * 20 + i * 1000,
    });
  }
  // Grava 300 mensagens recentes comuns sem "raridade"
  for (let i = 1; i <= 300; i++) {
    journal.recordMessage({
      scopeKey: scope,
      messageId: `rec-${i}`,
      authorJid: user,
      text: `conversa recente comum ${i}`,
      source: 'human',
      now: now - 3600_000 * 5 + i * 1000,
    });
  }
  // Grava uma mensagem recentíssima com "raridade"
  journal.recordMessage({
    scopeKey: scope,
    messageId: 'rec-special',
    authorJid: user,
    text: 'conversa de hoje com raridade máxima',
    source: 'human',
    now: now - 10_000,
  });

  const result = await executor.execute(
    { name: 'search_messages', arguments: { query: 'raridade' } },
    { scopeKey: scope, authorJid: user, funConfig: { ...DEFAULT_FUN_CONFIG }, now }
  );

  assert.equal(result.ok, true);
  assert.match(result.data[0].text, /raridade máxima/);
});
