import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createFunNewsRepository } from '../fun/db/funNewsRepository.js';
import { createFunJournalMessageRepository } from '../fun/db/funJournalMessageRepository.js';
import { createFunStatsRepository } from '../fun/db/funStatsRepository.js';
import { createNewsService } from '../fun/services/newsService.js';

await initDb();

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

const ANA_JID = '5511999990001@s.whatsapp.net';
const BIA_JID = '5511999990002@s.whatsapp.net';
const CARLOS_JID = '5511999990003@s.whatsapp.net';

function mockStats() {
  const calls = [];
  return {
    calls,
    addCoins(args) {
      calls.push(args);
      return { ok: true, coins: 150 };
    },
  };
}

function buildNewsService({
  statsRepository = null,
  scope,
  now,
  messages = [],
  funConfigOverrides = {},
  flavorService = null,
  newsRepository: newsRepositoryOverride = null,
}) {
  const journalMessageRepository = createFunJournalMessageRepository({ getDatabase: getDb });
  messages.forEach((m, i) => {
    journalMessageRepository.recordMessage({
      scopeKey: scope,
      messageId: m.id,
      authorJid: m.author,
      text: m.text,
      now: now - (20 - i) * 1000,
    });
  });
  return createNewsService({
    newsRepository: newsRepositoryOverride || createFunNewsRepository({ getDatabase: getDb }),
    journalMessageRepository,
    statsRepository,
    flavorService:
      flavorService || {
        async line() {
          return [
            'CAPA: Destaque sob contrato estruturado',
            'INTRO: O dia rendeu pauta de sobra na redação.',
            'DETALHES: A fila andou e ninguém escapou.',
            'FORESHADOW: Amanhã tem mais.',
          ].join('\n');
        },
        lastProvider: () => 'zen',
      },
    getContactDisplayName: (jid) =>
      ({ [ANA_JID]: 'Ana Souza', [BIA_JID]: 'Bia Souza', [CARLOS_JID]: 'Carlos Lima' })[jid] || jid,
  });
}

const PUBLISH_CONFIG = {
  groupNewsEnabled: true,
  worldTimezone: 'UTC',
  groupNewsHour: 23,
  groupNewsMinute: 59,
  groupNewsMaxChars: 2500,
};

test('spotlight: resolveNewsSpotlightAuthor — primário na melhor quote, fallback no mais ativo, skip sem dados', () => {
  const service = createNewsService({
    newsRepository: createFunNewsRepository({ getDatabase: getDb }),
  });

  // Primário: quote de maior score (quotes[0])
  const primary = service.resolveNewsSpotlightAuthor({
    quotes: [
      { name: 'Ana', authorJid: ANA_JID, text: 'frase top', score: 2.5 },
      { name: 'Bia', authorJid: BIA_JID, text: 'outra frase', score: 1.1 },
    ],
    messages: [
      { source: 'human', authorJid: BIA_JID },
      { source: 'human', authorJid: BIA_JID },
    ],
  });
  assert.equal(primary.authorJid, ANA_JID);
  assert.equal(primary.source, 'top-quote');

  // Fallback: autor com mais mensagens humanas no dia (bot é ignorado)
  const fallback = service.resolveNewsSpotlightAuthor({
    quotes: [],
    messages: [
      { source: 'human', authorJid: BIA_JID },
      { source: 'human', authorJid: ANA_JID },
      { source: 'human', authorJid: BIA_JID },
      { source: 'human', authorJid: ANA_JID },
      { source: 'human', authorJid: BIA_JID },
      { source: 'bot', authorJid: 'bot@s.whatsapp.net' },
    ],
  });
  assert.equal(fallback.authorJid, BIA_JID);
  assert.equal(fallback.source, 'top-messages');
  assert.equal(fallback.count, 3);

  // Skip: sem dados estruturados
  assert.equal(service.resolveNewsSpotlightAuthor({ quotes: [], messages: [] }), null);
  assert.equal(service.resolveNewsSpotlightAuthor(null), null);
});

test('spotlight: primário — linha com âncora @JID no tryPublish; crédito só no commit (reason/now corretos)', async () => {
  const scope = uniqueGroup();
  const now = Date.UTC(2026, 8, 2, 23, 59, 30);
  const statsRepository = mockStats();
  const messages = [
    { id: 'p1', author: BIA_JID, text: 'Eu avisei que isso ia dar ruim no churrasco!' },
    { id: 'p2', author: ANA_JID, text: 'O print do grupo inteiro já circula no privado do pessoal, se preparem agora!' },
    { id: 'p3', author: ANA_JID, text: 'Ninguém aqui tem paz, só prints e constrangimento à noite.' },
    { id: 'p4', author: BIA_JID, text: 'A festa de ontem terminou em pizza às três da manhã, confia.' },
  ];
  const newsService = buildNewsService({ statsRepository, scope, now, messages });

  const published = await newsService.tryPublish(scope, { ...PUBLISH_CONFIG }, now);
  assert.equal(published.ok, true);

  // NADA é creditado nem marcado antes do post/commit
  assert.equal(statsRepository.calls.length, 0, 'tryPublish não pode creditar');
  const metaBefore = createFunNewsRepository({ getDatabase: getDb }).getNewsMeta(scope);
  assert.equal(metaBefore.lastDailyNewsDay, '', 'dia não pode ser marcado no tryPublish');

  // Maior score: frase da Ana com "!" e mais comprida vence
  // Âncora no padrão da casa: @<parte numérica do JID> + nome legível junto
  assert.match(published.text, /\n\n⭐ \*DESTAQUE DO DIA\*: @5511999990001 \(Ana Souza\)$/);
  assert.ok(published.mentions.includes(ANA_JID), 'JID do homenageado entra nas mentions');
  assert.equal(published.spotlight.source, 'top-quote');
  assert.equal(published.spotlight.committed, false);

  const commitResult = await Promise.resolve(
    newsService.commitEdition(scope, published, { ...PUBLISH_CONFIG })
  );
  assert.equal(commitResult.ok, true);
  assert.equal(commitResult.spotlight.credited, true);

  assert.equal(statsRepository.calls.length, 1, 'exatamente um crédito de destaque');
  const call = statsRepository.calls[0];
  assert.equal(call.userJid, ANA_JID);
  assert.equal(call.scopeKey, scope);
  assert.equal(call.amount, 50);
  assert.equal(call.now, now, 'ledger deve cair no targetNow do jornal (dia certo)');
  assert.equal(call.reason, 'news-spotlight');
});

test('spotlight: fallback — sem quotes elegíveis, autor com mais mensagens é homenageado', async () => {
  const scope = uniqueGroup();
  const now = Date.UTC(2026, 8, 2, 23, 59, 30);
  const statsRepository = mockStats();
  const messages = [
    { id: 'b1', author: BIA_JID, text: 'oi' },
    { id: 'b2', author: BIA_JID, text: 'kkk' },
    { id: 'b3', author: ANA_JID, text: 'boa' },
    { id: 'b4', author: BIA_JID, text: 'vou' },
    { id: 'b5', author: ANA_JID, text: 'tchau' },
  ];
  const newsService = buildNewsService({ statsRepository, scope, now, messages });

  const published = await newsService.tryPublish(scope, { ...PUBLISH_CONFIG }, now);
  assert.equal(published.ok, true);
  assert.equal(published.spotlight.source, 'top-messages');
  assert.match(published.text, /⭐ \*DESTAQUE DO DIA\*: @5511999990002 \(Bia Souza\)/);
  assert.ok(published.mentions.includes(BIA_JID));

  const commitResult = newsService.commitEdition(scope, published, { ...PUBLISH_CONFIG });
  assert.equal(commitResult.ok, true);
  assert.equal(statsRepository.calls.length, 1);
  assert.equal(statsRepository.calls[0].userJid, BIA_JID);
  assert.equal(statsRepository.calls[0].reason, 'news-spotlight');
});

test('spotlight: skip — dia sem dados (prosa da LLM não vale) não credita nem renderiza linha', async () => {
  const scope = uniqueGroup();
  const now = Date.UTC(2026, 8, 2, 23, 59, 30);
  const statsRepository = mockStats();
  const newsService = buildNewsService({ statsRepository, scope, now, messages: [] });

  const published = await newsService.tryPublish(scope, { ...PUBLISH_CONFIG }, now);
  assert.equal(published.ok, true);
  assert.equal(statsRepository.calls.length, 0, 'nenhum crédito sem participante do dia');
  assert.doesNotMatch(published.text, /DESTAQUE DO DIA/);
  assert.equal(published.spotlight, null);

  // Commit sem destaque é no-op válido
  const commitResult = newsService.commitEdition(scope, published, { ...PUBLISH_CONFIG });
  assert.equal(commitResult.ok, true);
  assert.equal(commitResult.spotlight, null);
  assert.equal(statsRepository.calls.length, 0);
});

test('spotlight: post falho (sem commit) não marca dia nem credita; tick seguinte recompõe e credita uma vez', async () => {
  const scope = uniqueGroup();
  const now = Date.UTC(2026, 8, 2, 23, 59, 30);
  const statsRepository = mockStats();
  const messages = [
    { id: 'f1', author: ANA_JID, text: 'O print do grupo inteiro já circula no privado do pessoal, se preparem agora!' },
    { id: 'f2', author: BIA_JID, text: 'A festa de ontem terminou em pizza às três da manhã, confia.' },
    { id: 'f3', author: ANA_JID, text: 'Ninguém aqui tem paz, só prints e constrangimento à noite.' },
    { id: 'f4', author: BIA_JID, text: 'Eu avisei que isso ia dar ruim no churrasco de ontem à noite!' },
  ];
  const newsService = buildNewsService({ statsRepository, scope, now, messages });
  const newsRepository = createFunNewsRepository({ getDatabase: getDb });

  // "Post falho": tryPublish rodou mas o commit nunca foi chamado
  const first = await newsService.tryPublish(scope, { ...PUBLISH_CONFIG }, now);
  assert.equal(first.ok, true);
  assert.equal(statsRepository.calls.length, 0, 'coins NÃO creditados sem commit');
  assert.equal(newsRepository.getNewsMeta(scope).lastDailyNewsDay, '', 'dia NÃO marcado sem commit');

  // Tick seguinte recompõe a edição (não é barrado por already-today)
  const again = await newsService.tryPublish(scope, { ...PUBLISH_CONFIG }, now + 15_000);
  assert.equal(again.ok, true, 'recomposição deve ser permitida quando o post falhou');
  assert.equal(again.newsDay, first.newsDay);

  // Agora o post sucede e o commit roda: crédito único
  const commitResult = newsService.commitEdition(scope, again, { ...PUBLISH_CONFIG });
  assert.equal(commitResult.ok, true);
  assert.equal(commitResult.spotlight.credited, true);
  assert.equal(statsRepository.calls.length, 1);
  assert.equal(statsRepository.calls[0].now, now + 15_000, 'crédito cai no targetNow da edição recomposta');
  assert.equal(newsRepository.getNewsMeta(scope).lastDailyNewsDay, first.newsDay);

  // Commit duplicado: sem segundo crédito
  const duplicate = newsService.commitEdition(scope, first, { ...PUBLISH_CONFIG });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.reason, 'already-committed');
  assert.equal(statsRepository.calls.length, 1, 'sem duplo crédito');

  // Depois do commit, o gate already-today volta a valer
  const blocked = await newsService.tryPublish(scope, { ...PUBLISH_CONFIG }, now + 60_000);
  assert.equal(blocked.reason, 'already-today');
});

test('spotlight: commit falho (addCoins lançando) não invalida a edição publicada', async () => {
  const scope = uniqueGroup();
  const now = Date.UTC(2026, 8, 2, 23, 59, 30);
  const calls = [];
  const statsRepository = {
    addCoins(args) {
      calls.push(args);
      throw new Error('ledger em chamas');
    },
  };
  const messages = [
    { id: 'c1', author: ANA_JID, text: 'O print do grupo inteiro já circula no privado do pessoal, se preparem agora!' },
    { id: 'c2', author: BIA_JID, text: 'A festa de ontem terminou em pizza às três da manhã, confia.' },
    { id: 'c3', author: ANA_JID, text: 'Ninguém aqui tem paz, só prints e constrangimento à noite.' },
    { id: 'c4', author: BIA_JID, text: 'Eu avisei que isso ia dar ruim no churrasco de ontem à noite!' },
  ];
  const newsService = buildNewsService({ statsRepository, scope, now, messages });
  const newsRepository = createFunNewsRepository({ getDatabase: getDb });

  const published = await newsService.tryPublish(scope, { ...PUBLISH_CONFIG }, now);
  assert.equal(published.ok, true);
  assert.match(published.text, /⭐ \*DESTAQUE DO DIA\*/);

  // Commit: crédito falha, mas os demais efeitos (dia marcado) seguem e a
  // edição JÁ publicada permanece válida.
  const commitResult = newsService.commitEdition(scope, published, { ...PUBLISH_CONFIG });
  assert.equal(commitResult.ok, true);
  assert.equal(commitResult.spotlight.credited, false);
  assert.equal(calls.length, 1, 'tentativa de crédito aconteceu');
  assert.equal(newsRepository.getNewsMeta(scope).lastDailyNewsDay, published.newsDay, 'dia marcado mesmo com crédito falho');
});

test('spotlight: flag desligada e valor custom — config respeitada, orçamento respeitado', async () => {
  const now = Date.UTC(2026, 8, 2, 23, 59, 30);
  const messages = [
    { id: 'd1', author: ANA_JID, text: 'O print do grupo inteiro já circula no privado do pessoal, se preparem agora!' },
    { id: 'd2', author: BIA_JID, text: 'A festa de ontem terminou em pizza às três da manhã, confia.' },
    { id: 'd3', author: ANA_JID, text: 'Ninguém aqui tem paz, só prints e constrangimento à noite.' },
    { id: 'd4', author: BIA_JID, text: 'Eu avisei que isso ia dar ruim no churrasco de ontem à noite!' },
  ];

  // Flag desligada: nada de crédito nem linha
  const scopeOff = uniqueGroup();
  const statsOff = mockStats();
  const offService = buildNewsService({ statsRepository: statsOff, scope: scopeOff, now, messages });
  const off = await offService.tryPublish(scopeOff, { ...PUBLISH_CONFIG, groupNewsSpotlightEnabled: false }, now);
  assert.equal(off.ok, true);
  assert.doesNotMatch(off.text, /DESTAQUE DO DIA/);
  const offCommit = offService.commitEdition(scopeOff, off, { ...PUBLISH_CONFIG, groupNewsSpotlightEnabled: false });
  assert.equal(offCommit.ok, true);
  assert.equal(statsOff.calls.length, 0);

  // Valor custom de coins + budget apertado: crédito ocorre no commit, linha é cortada
  const scopeTight = uniqueGroup();
  const statsTight = mockStats();
  const tightService = buildNewsService({ statsRepository: statsTight, scope: scopeTight, now, messages });
  const tight = await tightService.tryPublish(scopeTight, { ...PUBLISH_CONFIG, groupNewsSpotlightCoins: 25, groupNewsMaxChars: 120 }, now);
  assert.equal(tight.ok, true);
  assert.ok(!tight.text.includes('DESTAQUE DO DIA'), 'linha fora do budget é omitida');
  const tightCommit = tightService.commitEdition(scopeTight, tight, { ...PUBLISH_CONFIG, groupNewsSpotlightCoins: 25, groupNewsMaxChars: 120 });
  assert.equal(tightCommit.ok, true);
  assert.equal(statsTight.calls[0].amount, 25, 'valor custom entra no crédito');
});

test('spotlight: integração real — cai no fun_coin_ledger com reason e created_at do targetNow', async () => {
  const scope = uniqueGroup();
  const now = Date.UTC(2026, 8, 2, 23, 59, 30);
  const messages = [
    { id: 'r1', author: CARLOS_JID, text: 'O print do grupo inteiro já circula no privado do pessoal, se preparem agora!' },
    { id: 'r2', author: ANA_JID, text: 'A festa de ontem terminou em pizza às três da manhã, confia.' },
    { id: 'r3', author: CARLOS_JID, text: 'Ninguém aqui tem paz, só prints e constrangimento à noite.' },
    { id: 'r4', author: ANA_JID, text: 'Eu avisei que isso ia dar ruim no churrasco de ontem à noite!' },
  ];
  const statsRepository = createFunStatsRepository({ getDatabase: getDb });
  const newsService = buildNewsService({ statsRepository, scope, now, messages });

  const published = await newsService.tryPublish(scope, { ...PUBLISH_CONFIG }, now);
  assert.equal(published.ok, true);
  const commitResult = newsService.commitEdition(scope, published, { ...PUBLISH_CONFIG });
  assert.equal(commitResult.ok, true);
  assert.equal(commitResult.spotlight.credited, true);

  const row = getDb()
    .prepare(
      `SELECT amount, reason, created_at FROM analytics.fun_coin_ledger
       WHERE scope_key = ? AND reason = 'news-spotlight' ORDER BY created_at DESC LIMIT 1`
    )
    .get(scope);
  assert.ok(row, 'entrada deveria existir no ledger');
  assert.equal(row.amount, 50);
  assert.equal(row.created_at, now);
  assert.match(published.text, /⭐ \*DESTAQUE DO DIA\*: @5511999990003 \(Carlos Lima\)/);
  assert.ok(published.mentions.includes(CARLOS_JID));
});

test('spotlight: recomposição tem teto por (escopo,dia) — setNewsDay sempre falhando → 2 composições e recompose-limit', async () => {
  const scope = uniqueGroup();
  const now = Date.UTC(2026, 8, 2, 23, 59, 30);
  const statsRepository = mockStats();
  const realNewsRepository = createFunNewsRepository({ getDatabase: getDb });
  const breakingRepository = {
    ...realNewsRepository,
    setNewsDay: () => {
      throw new Error('meta em chamas');
    },
  };
  let llmCalls = 0;
  const messages = [
    { id: 'x1', author: ANA_JID, text: 'O print do grupo inteiro já circula no privado do pessoal, se preparem agora!' },
    { id: 'x2', author: BIA_JID, text: 'A festa de ontem terminou em pizza às três da manhã, confia.' },
    { id: 'x3', author: ANA_JID, text: 'Ninguém aqui tem paz, só prints e constrangimento à noite.' },
    { id: 'x4', author: BIA_JID, text: 'Eu avisei que isso ia dar ruim no churrasco de ontem à noite!' },
  ];
  const newsService = buildNewsService({
    statsRepository,
    scope,
    now,
    messages,
    newsRepository: breakingRepository,
    flavorService: {
      async line() {
        llmCalls += 1;
        return [
          'CAPA: Teto de recomposição em ação',
          'INTRO: O dia rendeu pauta de sobra na redação.',
          'DETALHES: A fila andou e ninguém escapou.',
          'FORESHADOW: Amanhã tem mais.',
        ].join('\n');
      },
      lastProvider: () => 'zen',
    },
  });

  // 1ª composição + commit (setNewsDay lança)
  const first = await newsService.tryPublish(scope, { ...PUBLISH_CONFIG }, now);
  assert.equal(first.ok, true);
  const commit1 = newsService.commitEdition(scope, first, { ...PUBLISH_CONFIG });
  assert.equal(commit1.ok, false);
  assert.equal(commit1.reason, 'set-news-day-failed');

  // 2ª recomposição (ainda permitida) + commit (falha de novo)
  const second = await newsService.tryPublish(scope, { ...PUBLISH_CONFIG }, now + 15_000);
  assert.equal(second.ok, true);
  const commit2 = newsService.commitEdition(scope, second, { ...PUBLISH_CONFIG });
  assert.equal(commit2.ok, false);

  // 3ª tentativa: bloqueada SEM queimar LLM/capa
  const third = await newsService.tryPublish(scope, { ...PUBLISH_CONFIG }, now + 30_000);
  assert.equal(third.ok, false);
  assert.equal(third.reason, 'recompose-limit');
  assert.equal(llmCalls, 2, '3ª tentativa não pode compor de novo');
  // Sem duplo crédito entre as recomposições (dedup durável segura o 2º)
  assert.equal(statsRepository.calls.length, 1);
});

test('spotlight: dedup durável do crédito sobrevive a restart (fun_daily_events)', async () => {
  const scope = uniqueGroup();
  const now = Date.UTC(2026, 8, 2, 23, 59, 30);
  const statsRepository = mockStats();
  const messages = [
    { id: 'd1', author: ANA_JID, text: 'O print do grupo inteiro já circula no privado do pessoal, se preparem agora!' },
    { id: 'd2', author: BIA_JID, text: 'A festa de ontem terminou em pizza às três da manhã, confia.' },
    { id: 'd3', author: ANA_JID, text: 'Ninguém aqui tem paz, só prints e constrangimento à noite.' },
    { id: 'd4', author: BIA_JID, text: 'Eu avisei que isso ia dar ruim no churrasco de ontem à noite!' },
  ];
  const newsRepository = createFunNewsRepository({ getDatabase: getDb });
  const instanceA = buildNewsService({ statsRepository, scope, now, messages, newsRepository });

  const published = await instanceA.tryPublish(scope, { ...PUBLISH_CONFIG }, now);
  const commitA = instanceA.commitEdition(scope, published, { ...PUBLISH_CONFIG });
  assert.equal(commitA.ok, true);
  assert.equal(commitA.spotlight.credited, true);
  assert.equal(statsRepository.calls.length, 1);

  // Evento durável gravado em fun_daily_events
  const events = newsRepository.listSince(scope, now - 60_000);
  const creditEvent = events.find(
    (event) => event.eventType === 'news-spotlight-credit' && event.payload?.newsDay === published.newsDay
  );
  assert.ok(creditEvent, 'evento news-spotlight-credit deveria estar no fun_daily_events');
  assert.equal(creditEvent.payload.amount, 50);

  // Nova instância (Sets zerados — simula restart) com o MESMO resultado:
  // o dedup durável impede o segundo crédito.
  const instanceB = buildNewsService({ statsRepository, scope, now, messages: [], newsRepository });
  const replay = {
    ...published,
    spotlight: { ...published.spotlight, committed: false, credited: false, coins: 0 },
  };
  const commitB = instanceB.commitEdition(scope, replay, { ...PUBLISH_CONFIG });
  assert.equal(commitB.ok, true);
  assert.equal(statsRepository.calls.length, 1, 'dedup durável impediu o segundo crédito');
  assert.equal(commitB.spotlight.credited, true, 'telemetria reflete que o crédito já existia');
});

test('spotlight: crédito pendente ({ok:false}) + setNewsDay falhando → re-tick realista retenta e credita', async () => {
  // Sequência REALISTA (a retry via re-commit do MESMO resultado só existe
  // quando setNewsDay também falha: com setNewsDay ok o gate already-today
  // fecha e nenhum novo result é gerado). Aqui: addCoins {ok:false} E
  // setNewsDay lançando no commit 1 → dia aberto → re-tick (B1) → credita.
  const scope = uniqueGroup();
  const now = Date.UTC(2026, 8, 2, 23, 59, 30);
  const calls = [];
  let failFirstCredit = true;
  const statsRepository = {
    addCoins(args) {
      calls.push(args);
      if (failFirstCredit) {
        failFirstCredit = false;
        return { ok: false, coins: 0 };
      }
      return { ok: true, coins: 60 };
    },
  };
  let failFirstSetNewsDay = true;
  const realNewsRepository = createFunNewsRepository({ getDatabase: getDb });
  const newsRepository = {
    ...realNewsRepository,
    setNewsDay: (...args) => {
      if (failFirstSetNewsDay) {
        failFirstSetNewsDay = false;
        throw new Error('meta em chamas');
      }
      return realNewsRepository.setNewsDay(...args);
    },
  };
  const messages = [
    { id: 's1', author: ANA_JID, text: 'O print do grupo inteiro já circula no privado do pessoal, se preparem agora!' },
    { id: 's2', author: BIA_JID, text: 'A festa de ontem terminou em pizza às três da manhã, confia.' },
    { id: 's3', author: ANA_JID, text: 'Ninguém aqui tem paz, só prints e constrangimento à noite.' },
    { id: 's4', author: BIA_JID, text: 'Eu avisei que isso ia dar ruim no churrasco de ontem à noite!' },
  ];
  const newsService = buildNewsService({ statsRepository, scope, now, messages, newsRepository });

  // Commit 1: addCoins {ok:false} (creditSettled:false) E setNewsDay lançando
  // → commit ok:false, dia segue aberto, sem evento durável de crédito.
  const published = await newsService.tryPublish(scope, { ...PUBLISH_CONFIG }, now);
  assert.equal(published.ok, true);
  const commit1 = newsService.commitEdition(scope, published, { ...PUBLISH_CONFIG });
  assert.equal(commit1.ok, false);
  assert.equal(commit1.reason, 'set-news-day-failed');
  assert.equal(commit1.spotlight.credited, false);
  assert.equal(commit1.spotlight.settled, false);
  assert.equal(realNewsRepository.getNewsMeta(scope).lastDailyNewsDay, '', 'dia segue aberto pro re-tick');

  // Re-tick (2ª composição, dentro do teto do B1) + commit 2: credita agora
  const again = await newsService.tryPublish(scope, { ...PUBLISH_CONFIG }, now + 15_000);
  assert.equal(again.ok, true);
  const commit2 = newsService.commitEdition(scope, again, { ...PUBLISH_CONFIG });
  assert.equal(commit2.ok, true);
  assert.equal(commit2.spotlight.credited, true);
  assert.equal(commit2.spotlight.settled, true);
  assert.equal(calls.length, 2, 'crédito foi retentado exatamente uma vez');
  assert.equal(calls[0].reason, 'news-spotlight');
  assert.equal(realNewsRepository.getNewsMeta(scope).lastDailyNewsDay, again.newsDay, 'dia marcado no commit que concluiu');

  // 3ª composição do dia: gate already-today fechou no commit que concluiu —
  // nada de queimar LLM de novo (o teto recompose-limit cobre o caso em que
  // o commit NUNCA conclui; ver teste do setNewsDay sempre falhando).
  const third = await newsService.tryPublish(scope, { ...PUBLISH_CONFIG }, now + 30_000);
  assert.equal(third.ok, false);
  assert.equal(third.reason, 'already-today');
  assert.equal(calls.length, 2);
});

test('spotlight: crédito pendente com dia marcado loga warn explícito (não é silencioso)', async () => {
  const scope = uniqueGroup();
  const now = Date.UTC(2026, 8, 2, 23, 59, 30);
  const statsRepository = {
    addCoins: () => ({ ok: false, coins: 0 }),
  };
  const messages = [
    { id: 'w1', author: ANA_JID, text: 'O print do grupo inteiro já circula no privado do pessoal, se preparem agora!' },
    { id: 'w2', author: BIA_JID, text: 'A festa de ontem terminou em pizza às três da manhã, confia.' },
    { id: 'w3', author: ANA_JID, text: 'Ninguém aqui tem paz, só prints e constrangimento à noite.' },
    { id: 'w4', author: BIA_JID, text: 'Eu avisei que isso ia dar ruim no churrasco de ontem à noite!' },
  ];
  const newsService = buildNewsService({ statsRepository, scope, now, messages });
  const newsRepository = createFunNewsRepository({ getDatabase: getDb });

  const originalWarn = console.warn;
  const warns = [];
  console.warn = (...args) => {
    warns.push(args.map((part) => String(part)).join(' '));
  };
  let published;
  let commitResult;
  try {
    published = await newsService.tryPublish(scope, { ...PUBLISH_CONFIG }, now);
    commitResult = newsService.commitEdition(scope, published, { ...PUBLISH_CONFIG });
  } finally {
    console.warn = originalWarn;
  }

  // Comportamento intencional e já testado: dia é marcado mesmo com crédito
  // pendente — mas agora com warn explícito (nada silencioso).
  assert.equal(commitResult.ok, true);
  assert.equal(commitResult.spotlight.credited, false);
  assert.equal(commitResult.spotlight.settled, false);
  assert.equal(newsRepository.getNewsMeta(scope).lastDailyNewsDay, published.newsDay);
  const pendingWarn = warns.find((line) => line.includes('spotlight credit PENDING'));
  assert.ok(pendingWarn, `deveria logar warn de crédito pendente; warns=${JSON.stringify(warns)}`);
  assert.match(pendingWarn, /re-commit pode retentar/);
});
