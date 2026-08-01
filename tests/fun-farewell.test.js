import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import {
  _resetDefaultFunStatsRepository,
  createFunStatsRepository,
} from '../fun/db/funStatsRepository.js';
import { createFunNewsRepository } from '../fun/db/funNewsRepository.js';
import { createFunFarewellRepository } from '../fun/db/funFarewellRepository.js';
import { createNewsService } from '../fun/services/newsService.js';
import { createFarewellService } from '../fun/services/farewellService.js';
import { collectDayFacts, factsToSnapshotPayload, bucketEvents } from '../fun/services/news/newsFacts.js';
import { renderEdition } from '../fun/services/news/newsRender.js';
import { parseFunCommand } from '../fun/commands/router.js';
import { handleDespedirCommand } from '../fun/commands/handlers/despedir.js';
import { handleDespedidaRankCommand } from '../fun/commands/handlers/despedidaRank.js';

await initDb();
_resetDefaultFunStatsRepository();

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

function uniqueJid(prefix = '5511') {
  return `${prefix}${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 90 + 10)}@s.whatsapp.net`;
}

function setup() {
  const repository = createFunStatsRepository({ getDatabase: getDb });
  repository.ensureFunSchema();
  const newsRepository = createFunNewsRepository({ getDatabase: getDb });
  const farewellRepository = createFunFarewellRepository({ getDatabase: getDb });
  const newsService = createNewsService({ newsRepository, flavorService: null });
  const farewellService = createFarewellService({
    farewellRepository,
    newsService,
    getContactDisplayName: (jid) => String(jid).split('@')[0],
  });
  return { repository, newsRepository, farewellRepository, newsService, farewellService };
}

test('despedir: registro incrementa contador por usuario+grupo', () => {
  const { farewellRepository } = setup();
  const scope = uniqueGroup();
  const u = uniqueJid();

  farewellRepository.recordFarewell({ scopeKey: scope, userJid: u });
  farewellRepository.recordFarewell({ scopeKey: scope, userJid: u });
  farewellRepository.recordFarewell({ scopeKey: scope, userJid: u });

  const row = farewellRepository.getCount(scope, u);
  assert.equal(row.count, 3);
  assert.ok(row.lastAt > 0);
});

test('despedir: isolamento entre grupos e usuarios', () => {
  const { farewellRepository } = setup();
  const scopeA = uniqueGroup();
  const scopeB = uniqueGroup();
  const u1 = uniqueJid('5511');
  const u2 = uniqueJid('5512');

  farewellRepository.recordFarewell({ scopeKey: scopeA, userJid: u1 });
  farewellRepository.recordFarewell({ scopeKey: scopeA, userJid: u1 });
  farewellRepository.recordFarewell({ scopeKey: scopeA, userJid: u2 });
  farewellRepository.recordFarewell({ scopeKey: scopeB, userJid: u1 });

  assert.equal(farewellRepository.getCount(scopeA, u1).count, 2);
  assert.equal(farewellRepository.getCount(scopeA, u2).count, 1);
  assert.equal(farewellRepository.getCount(scopeB, u1).count, 1);
  assert.equal(farewellRepository.getCount(scopeA, uniqueJid()).count, 0);
});

test('despedida: ranking ordenado por count desc e desempate lastAt asc', () => {
  const { farewellRepository } = setup();
  const scope = uniqueGroup();
  const uA = uniqueJid('1');
  const uB = uniqueJid('2');
  const uC = uniqueJid('3');

  const t0 = 1_000_000;
  farewellRepository.recordFarewell({ scopeKey: scope, userJid: uC, now: t0 });
  farewellRepository.recordFarewell({ scopeKey: scope, userJid: uA, now: t0 + 100 });
  farewellRepository.recordFarewell({ scopeKey: scope, userJid: uA, now: t0 + 200 });
  farewellRepository.recordFarewell({ scopeKey: scope, userJid: uB, now: t0 + 300 });
  farewellRepository.recordFarewell({ scopeKey: scope, userJid: uB, now: t0 + 400 });

  const rank = farewellRepository.listRanking(scope, 10);
  // 2 despedidas: uA e uB; desempate = lastAt ASC -> uA (200) antes de uB (400)
  assert.equal(rank.length, 3);
  assert.equal(rank[0].userJid, uA);
  assert.equal(rank[0].count, 2);
  assert.equal(rank[1].userJid, uB);
  assert.equal(rank[1].count, 2);
  assert.equal(rank[2].userJid, uC);
  assert.equal(rank[2].count, 1);

  assert.equal(farewellRepository.totalByGroup(scope), 5);
});

test('despedir: sem cooldown — permite multiplas chamadas consecutivas', () => {
  const { farewellService } = setup();
  const scope = uniqueGroup();
  const u = uniqueJid();

  for (let i = 0; i < 5; i++) {
    farewellService.register({ scopeKey: scope, userJid: u, now: Date.now() + i });
  }
  const pos = farewellService.getUserPosition(u, scope);
  assert.equal(pos.count, 5);
  assert.equal(pos.rank, 1);
});

test('despedir handler: envia SOMENTE o poema (sem mensagens extras)', async () => {
  const { farewellService } = setup();
  const scope = uniqueGroup();
  const u = uniqueJid();
  const sent = [];

  await handleDespedirCommand({
    userJid: u,
    scopeKey: scope,
    farewellService,
    reply: (body) => { sent.push(String(body)); },
  });

  assert.equal(sent.length, 1, 'handler deve enviar exatamente uma mensagem');
  const msg = sent[0];
  // Pistas do poema fornecido
  assert.ok(msg.includes('Despeço-me do grupo em claro lamento'));
  assert.ok(msg.includes('E deixo o grupo em seu novo cenário'));
  // Nada típico de flavor/header
  assert.ok(!msg.includes('🏆'));
  assert.ok(!msg.toLowerCase().includes('registrad'));
  assert.ok(!msg.toLowerCase().includes('adeus, '));
});

test('despedir handler: registra no repositorio e no newsService', async () => {
  const { farewellService, newsRepository } = setup();
  const scope = uniqueGroup();
  const u = uniqueJid();

  await handleDespedirCommand({
    userJid: u,
    scopeKey: scope,
    farewellService,
    reply: () => {},
  });

  // contador persistido
  assert.equal(farewellService.getUserPosition(u, scope).count, 1);
  // evento logado para o jornal
  const events = newsRepository.listSince(scope, 0);
  const despedir = events.filter((e) => e.eventType === 'despedir');
  assert.equal(despedir.length, 1);
  assert.equal(despedir[0].userJid, u);
});

test('despedida rank handler: exibe ranking e total do grupo', async () => {
  const { farewellService } = setup();
  const scope = uniqueGroup();
  const uA = uniqueJid('1');
  const uB = uniqueJid('2');
  farewellService.register({ scopeKey: scope, userJid: uA });
  farewellService.register({ scopeKey: scope, userJid: uA });
  farewellService.register({ scopeKey: scope, userJid: uB });

  const sent = [];
  await handleDespedidaRankCommand({
    userJid: uA,
    scopeKey: scope,
    farewellService,
    args: ['rank'],
    funConfig: { rankLimit: 10 },
    reply: (body) => { sent.push(String(body)); },
  });

  assert.equal(sent.length, 1);
  const msg = sent[0];
  assert.ok(msg.includes('RANKING DE DESPEDIDAS'));
  assert.ok(msg.includes('Total no grupo: *3*'));
  assert.ok(msg.includes('*2* despedidas'), 'uA deve aparecer com count=2');
  // posicao do proprio usuario que chamou (uA)
  assert.ok(msg.includes('Você: *2* despedidas (#1)'));
});

test('parser: /despedir rank continua mapeando para despedir com subcomando', () => {
  const parsed = parseFunCommand('/despedir rank');
  assert.equal(parsed?.command, 'despedir');
  assert.deepEqual(parsed?.args, ['rank']);
});

test('despedir rank handler: `/despedir rank` mostra ranking em vez de poema', async () => {
  const { farewellService } = setup();
  const scope = uniqueGroup();
  const uA = uniqueJid('1');
  farewellService.register({ scopeKey: scope, userJid: uA });
  farewellService.register({ scopeKey: scope, userJid: uA });

  const sent = [];
  await handleDespedirCommand({
    userJid: uA,
    scopeKey: scope,
    farewellService,
    args: ['rank'],
    funConfig: { rankLimit: 10 },
    reply: (body) => { sent.push(String(body)); },
  });

  assert.equal(sent.length, 1);
  assert.ok(sent[0].includes('RANKING DE DESPEDIDAS'));
  assert.ok(!sent[0].includes('Despeço-me do grupo em claro lamento'));
});

test('despedida rank handler: estado vazio avisa sem usuarios', async () => {
  const { farewellService } = setup();
  const scope = uniqueGroup();
  const sent = [];
  await handleDespedidaRankCommand({
    userJid: uniqueJid(),
    scopeKey: scope,
    farewellService,
    args: [],
    reply: (body) => { sent.push(String(body)); },
  });
  assert.ok(sent[0].includes('Ninguém se despediu'));
});

test('snapshot diario: metrics de despedidas presentes no payload', () => {
  const { farewellService, newsRepository } = setup();
  const scope = uniqueGroup();
  const uA = uniqueJid('1');
  const uB = uniqueJid('2');
  farewellService.register({ scopeKey: scope, userJid: uA });
  farewellService.register({ scopeKey: scope, userJid: uA });
  farewellService.register({ scopeKey: scope, userJid: uB });

  // coleta fatos do dia a partir dos eventos de newsRepository
  const events = newsRepository.listSince(scope, 0);
  const buckets = bucketEvents(events);
  assert.ok(buckets.despedir && buckets.despedir.length === 3);

  const facts = collectDayFacts({
    scopeKey: scope,
    now: Date.now(),
    deps: { newsRepository },
  });

  assert.equal(facts.totals.despedidas, 3);
  assert.equal(facts.society.despedidas, 3);
  assert.equal(facts.society.topFarewellUsers.length, 2);
  assert.equal(facts.society.topFarewellUsers[0].count, 2);
  assert.equal(facts.society.topFarewellUsers[0].jid, uA);

  const payload = factsToSnapshotPayload(facts);
  assert.equal(payload.society.despedidas, 3);
  assert.equal(payload.totals.despedidas, 3);
});

test('jornal: renderiza secao Society com despedidas quando houver', () => {
  const { farewellService, newsRepository } = setup();
  const scope = uniqueGroup();
  const uA = uniqueJid('1');
  farewellService.register({ scopeKey: scope, userJid: uA });
  farewellService.register({ scopeKey: scope, userJid: uA });

  const facts = collectDayFacts({
    scopeKey: scope,
    now: Date.now(),
    deps: { newsRepository },
  });

  const text = renderEdition(facts, {}, {
    getContactDisplayName: (jid) => String(jid).split('@')[0],
    random: () => 0.5,
    dayLabel: '2099-01-01',
  });

  // secao Society contendo despedidas
  assert.ok(text.includes('despedida'), 'jornal deve mencionar despedidas');
  // stats do dia tambem
  assert.ok(text.includes('2 despedidas'));
  // nome do top despedidor aparece
  assert.ok(text.includes(uA.split('@')[0]));
});

test('parser: /despedir e /despedida rank mapeiam para canonicos corretos', () => {
  assert.equal(parseFunCommand('/despedir')?.command, 'despedir');
  assert.equal(parseFunCommand('/adeus')?.command, 'despedir');
  assert.equal(parseFunCommand('/dispensar')?.command, 'despedir');
  const r = parseFunCommand('/despedida rank');
  assert.equal(r?.command, 'despedida_rank');
  assert.deepEqual(r?.args, ['rank']);
  // alias legacy de demissao de emprego NAO conflita
  assert.equal(parseFunCommand('/demitir sim')?.command, 'resign');
});
