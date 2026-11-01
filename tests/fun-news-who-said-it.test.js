import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createIdentityMap } from '../fun/utils/identity.js';
import { createFunDailyChallengeRepository } from '../fun/db/funDailyChallengeRepository.js';
import { createFunNewsQuoteQuizRepository } from '../fun/db/funNewsQuoteQuizRepository.js';
import { createDailyChallengeService } from '../fun/services/dailyChallengeService.js';
import { createNewsService } from '../fun/services/newsService.js';
import { createFunNewsRepository } from '../fun/db/funNewsRepository.js';
import { createFunJournalMessageRepository } from '../fun/db/funJournalMessageRepository.js';
import { createFunSnapshotRepository } from '../fun/db/funSnapshotRepository.js';
import {
  handleResponderCommand,
  handleDesafioCommand,
} from '../fun/commands/handlers/dailyChallenge.js';

await initDb();

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

const BASE_CONFIG = {
  dailyChallengeEnabled: true,
  dailyChallengeStartHour: 8,
  dailyChallengeEndHour: 20,
  dailyChallengeDurationMs: 4 * 60 * 60 * 1000,
  dailyChallengeHintCooldownMs: 10 * 60 * 1000,
  dailyChallengeMaxAttemptsPerUser: 30,
  dailyChallengeAttemptCooldownMs: 5 * 1000,
  dailyChallengeSkipVotesRequired: 3,
  dailyChallengeRewardWeights: { boost_xp: 40, coins: 35, daily_bonus: 20, jackpot: 5 },
  dailyChallengeRewardCoinsMin: 20,
  dailyChallengeRewardCoinsMax: 50,
  dailyChallengeSpeedBonus: {
    fast: { max: 5, mult: 1.0 },
    medium: { max: 15, mult: 0.8 },
    slow: { max: 30, mult: 0.6 },
    late: { max: Infinity, mult: 0.4 },
  },
  dailyChallengeNewsEnabled: false,
  zenBaseUrl: 'http://127.0.0.1:3300',
  zenModel: 'mock',
  zenApiKey: '',
};

function createHarness({
  quoteQuizRepository = null,
  config = BASE_CONFIG,
  random = () => 0,
  identityMap = null,
  getContactDisplayName = (jid) => ({
    'ana@s.whatsapp.net': 'Ana Souza',
    'bia@s.whatsapp.net': 'Bia Souza',
  }[jid] || 'Alguém'),
} = {}) {
  const repository = createFunDailyChallengeRepository({ getDatabase: getDb });
  const statsCalls = [];
  const replies = [];
  const service = createDailyChallengeService({
    repository,
    quoteQuizRepository,
    identityMap,
    statsRepository: {
      addCoins(args) {
        statsCalls.push(args);
        return { ok: true };
      },
    },
    generateZen: async () => null,
    getContactDisplayName,
    getConfig: () => config,
    random,
  });
  return { service, repository, statsCalls, replies, quoteQuizRepository };
}

test('news quiz: elegibilidade do tipo who_said_it depende de quote armazenada (~36h)', () => {
  const scope = uniqueGroup();
  const quizRepository = createFunNewsQuoteQuizRepository({ getDatabase: getDb });
  // Sorteio variado: com random constante o pickOne devolve sempre pool[0]
  const { service } = createHarness({ quoteQuizRepository: quizRepository, random: Math.random });
  const now = Date.UTC(2026, 8, 3, 12, 0, 0);

  // Sem quote armazenada: tipo nunca entra no sorteio
  for (let i = 0; i < 20; i++) {
    assert.notEqual(service.pickChallengeType(null, scope, now), 'who_said_it');
  }

  // Com quote recente (jornal de ontem 23:59): tipo entra no sorteio
  quizRepository.saveTopQuote({
    scopeKey: scope,
    dayKey: '2026-09-02',
    quoteText: 'Eu avisei que isso ia dar ruim no churrasco de ontem.',
    authorJid: 'ana@s.whatsapp.net',
    authorName: 'Ana',
    score: 2,
    now: now - 12 * 60 * 60_000,
  });
  const picks = new Set();
  for (let i = 0; i < 60; i++) picks.add(service.pickChallengeType(null, scope, now));
  assert.ok(picks.has('who_said_it'), 'Tipo deveria ser elegível com quote recente');

  // Quote velha (> 36h): elegibilidade some de novo
  for (let i = 0; i < 20; i++) {
    assert.notEqual(service.pickChallengeType(null, scope, now + 40 * 60 * 60_000), 'who_said_it');
  }

  // Sem repositório injetado: elegibilidade sempre falsa
  const noRepoHarness = createHarness({ quoteQuizRepository: null });
  for (let i = 0; i < 20; i++) {
    assert.notEqual(noRepoHarness.service.pickChallengeType(null, scope, now), 'who_said_it');
  }
});

test('news quiz: launchWhoSaidIt monta desafio com quote, dicas e resposta-normalizada', async () => {
  const scope = uniqueGroup();
  const quizRepository = createFunNewsQuoteQuizRepository({ getDatabase: getDb });
  const { service, repository } = createHarness({ quoteQuizRepository: quizRepository });
  const now = Date.UTC(2026, 8, 3, 10, 0, 0);

  quizRepository.saveTopQuote({
    scopeKey: scope,
    dayKey: '2026-09-02',
    quoteText: 'Fui no mercado e voltei com um teclado novo, não me julguem.',
    authorJid: 'ana@s.whatsapp.net',
    authorName: 'Ana',
    score: 1.8,
    now: now - 10 * 60 * 60_000,
  });

  const launched = await service.launchChallenge({
    scopeKey: scope,
    type: 'who_said_it',
    now,
    sendText: async () => ({ key: { id: 'x' } }),
  });
  assert.equal(launched.ok, true, `launch falhou: ${launched?.reason}`);

  const challenge = repository.getActiveChallenge(scope);
  assert.equal(challenge.challengeType, 'who_said_it');
  assert.equal(challenge.challengeData.authorJid, 'ana@s.whatsapp.net');
  assert.equal(challenge.challengeData.authorName, 'Ana Souza');
  assert.equal(challenge.answer, 'ana souza');
  assert.ok(challenge.challengeData.aliases.includes('ana'));
  assert.ok(challenge.challengeData.hints.length === 3);

  // Sem quote: launch falha limpo
  const empty = await service.launchChallenge({
    scopeKey: uniqueGroup(),
    type: 'who_said_it',
    now,
    sendText: async () => ({ key: { id: 'y' } }),
  });
  assert.equal(empty.ok, false);
  assert.equal(empty.reason, 'launch-failed');
});

test('news quiz: validação de resposta — nome certo, menção certa e resposta errada', async () => {
  const scope = uniqueGroup();
  const quizRepository = createFunNewsQuoteQuizRepository({ getDatabase: getDb });
  // Peso 100% em coins: com random() => 0 o sorteio padrão cairia em boost_xp
  const { service, repository, statsCalls } = createHarness({
    quoteQuizRepository: quizRepository,
    config: { ...BASE_CONFIG, dailyChallengeRewardWeights: { coins: 100 } },
  });
  const now = Date.UTC(2026, 8, 3, 10, 0, 0);

  quizRepository.saveTopQuote({
    scopeKey: scope,
    dayKey: '2026-09-02',
    quoteText: 'Quem apagou as luzes do prédio ontem assuma já.',
    authorJid: 'ana@s.whatsapp.net',
    authorName: 'Ana',
    score: 1.2,
    now: now - 10 * 60 * 60_000,
  });

  const sendText = async () => ({ key: { id: 'x' } });
  await service.launchChallenge({ scopeKey: scope, type: 'who_said_it', now, sendText });

  // Errado
  const wrong = await service.handleAnswer({
    scopeKey: scope,
    userJid: 'bia@s.whatsapp.net',
    guess: 'Carlos',
    now: now + 60_000,
  });
  assert.equal(wrong.ok, false);

  // Certo por menção
  const byMention = await service.handleAnswer({
    scopeKey: scope,
    userJid: 'bia@s.whatsapp.net',
    guess: '@5511999998888',
    now: now + 120_000,
    mentionedJids: ['ana@s.whatsapp.net'],
  });
  assert.equal(byMention.ok, true, `menção deveria acertar: ${byMention.message}`);
  assert.match(byMention.message, /PARABENS, Bia Souza/);
  assert.ok(statsCalls.length >= 1, 'recompensa deveria ser aplicada pela maquinaria existente');

  // Certo por nome (novo desafio — o anterior foi completado)
  await service.forceExpireChallenge({ scopeKey: scope, now: now + 130_000 });
  await service.launchChallenge({ scopeKey: scope, type: 'who_said_it', now: now + 140_000, sendText });
  const byName = await service.handleAnswer({
    scopeKey: scope,
    userJid: 'bia@s.whatsapp.net',
    guess: 'ana',
    now: now + 150_000,
  });
  assert.equal(byName.ok, true, `nome deveria acertar: ${byName.message}`);

  // Menção errada não acerta
  await service.forceExpireChallenge({ scopeKey: scope, now: now + 160_000 });
  await service.launchChallenge({ scopeKey: scope, type: 'who_said_it', now: now + 170_000, sendText });
  const wrongMention = await service.handleAnswer({
    scopeKey: scope,
    userJid: 'bia@s.whatsapp.net',
    guess: '@5511999998888',
    now: now + 180_000,
    mentionedJids: ['carlos@s.whatsapp.net'],
  });
  assert.equal(wrongMention.ok, false);

  assert.equal(repository.getActiveChallenge(scope).challengeType, 'who_said_it');
});

test('news quiz: mensagem de lançamento usa a copy do QUIZ DO TIMES', async () => {
  const scope = uniqueGroup();
  const quizRepository = createFunNewsQuoteQuizRepository({ getDatabase: getDb });
  const { service } = createHarness({ quoteQuizRepository: quizRepository });
  const now = Date.UTC(2026, 8, 3, 10, 0, 0);

  quizRepository.saveTopQuote({
    scopeKey: scope,
    dayKey: '2026-09-02',
    quoteText: 'O grupo inteiro viu e ninguém avisou que era vídeo ao vivo.',
    authorJid: 'ana@s.whatsapp.net',
    authorName: 'Ana',
    score: 1,
    now: now - 10 * 60 * 60_000,
  });

  const sent = [];
  await service.launchChallenge({
    scopeKey: scope,
    type: 'who_said_it',
    now,
    sendText: async (to, text) => {
      sent.push(text);
      return { key: { id: 'x' } };
    },
  });

  assert.equal(sent.length, 1);
  assert.match(sent[0], /🧾 \*QUIZ DO TIMES — QUEM DISSE ESSA FRASE\?\*/);
  assert.match(sent[0], /“O grupo inteiro viu e ninguém avisou que era vídeo ao vivo\.”/);
  assert.match(sent[0], /\/responder @pessoa/);
});

test('news quiz: prune da tabela apaga quotes antigas', () => {
  const scope = uniqueGroup();
  const quizRepository = createFunNewsQuoteQuizRepository({ getDatabase: getDb });
  const now = Date.UTC(2026, 8, 3, 12, 0, 0);

  quizRepository.saveTopQuote({
    scopeKey: scope,
    dayKey: '2026-09-01',
    quoteText: 'Quote antiga que deve ser removida no prune do publish.',
    authorJid: 'ana@s.whatsapp.net',
    now: now - 5 * 24 * 60 * 60_000,
  });
  quizRepository.saveTopQuote({
    scopeKey: scope,
    dayKey: '2026-09-02',
    quoteText: 'Quote recente que deve ficar.',
    authorJid: 'bia@s.whatsapp.net',
    now: now - 12 * 60 * 60_000,
  });

  const pruned = quizRepository.pruneOlderThan(scope, now - 3 * 24 * 60 * 60_000);
  assert.equal(pruned, 1);
  const latest = quizRepository.getLatestQuote(scope, { sinceMs: 0, now });
  assert.equal(latest.dayKey, '2026-09-02');
  assert.equal(latest.authorJid, 'bia@s.whatsapp.net');
});

test('news quiz: tryPublish persiste a quote de maior score do dia', async () => {
  const scope = uniqueGroup();
  const newsRepository = createFunNewsRepository({ getDatabase: getDb });
  const journalMessageRepository = createFunJournalMessageRepository({ getDatabase: getDb });
  const snapshotRepository = createFunSnapshotRepository({ getDatabase: getDb });
  const quizRepository = createFunNewsQuoteQuizRepository({ getDatabase: getDb });
  const now = Date.UTC(2026, 8, 2, 23, 59, 30);

  const messages = [
    { id: 'a1', author: 'ana@s.whatsapp.net', text: 'A festa de ontem terminou em pizza às três da manhã.' },
    { id: 'a2', author: 'bia@s.whatsapp.net', text: 'Eu avisei que isso ia render fofoca quentíssima!' },
    { id: 'a3', author: 'carlos@s.whatsapp.net', text: 'Ninguém aqui tem paz, só prints e constrangimento.' },
    { id: 'a4', author: 'bia@s.whatsapp.net', text: 'O print do grupo já circula no privado, se preparem!' },
  ];
  messages.forEach((m, i) => {
    journalMessageRepository.recordMessage({
      scopeKey: scope,
      messageId: m.id,
      authorJid: m.author,
      text: m.text,
      now: now - (10 - i) * 1000,
    });
  });

  const newsService = createNewsService({
    newsRepository,
    journalMessageRepository,
    snapshotRepository,
    quoteQuizRepository: quizRepository,
    getContactDisplayName: (jid) => ({ ana: 'Ana', bia: 'Bia', carlos: 'Carlos' })[String(jid).split('@')[0]] || jid,
  });

  const published = await newsService.tryPublish(scope, {
    groupNewsEnabled: true,
    worldTimezone: 'UTC',
    groupNewsHour: 23,
    groupNewsMinute: 59,
  }, now);
  assert.equal(published.ok, true);

  // Persistência da quote é efeito de commit (pós-post)
  assert.equal(quizRepository.getLatestQuote(scope, { sinceMs: 0, now: now + 1000 }), null, 'nada persistido antes do commit');
  const commitResult = newsService.commitEdition(scope, published, {
    groupNewsEnabled: true,
    worldTimezone: 'UTC',
    groupNewsHour: 23,
    groupNewsMinute: 59,
  });
  assert.equal(commitResult.ok, true);

  const saved = quizRepository.getLatestQuote(scope, { sinceMs: 0, now: now + 1000 });
  assert.ok(saved, 'Quote do dia deveria ser persistida');
  assert.equal(saved.dayKey, published.newsDay);
  // Maior score: "O print..." tem "!" e 51 chars (1.425) vs "Eu avisei..." (1.392)
  assert.equal(saved.quoteText, messages[3].text, 'Quote de maior score (Bia, com exclamação) deveria vencer');
  assert.equal(saved.authorJid, 'bia@s.whatsapp.net');

  // Snapshot NUNCA guarda citações (política existente)
  const snap = snapshotRepository.getSnapshot(scope, published.newsDay);
  assert.ok(!JSON.stringify(snap.payload).includes('fofoca quentíssima'));
  assert.ok(!JSON.stringify(snap.payload).includes('se preparem'));
});

test('news quiz: menção canoniza LID ↔ PN pelo identityMap (autor @lid e autor PN)', async () => {
  const scope = uniqueGroup();
  const quizRepository = createFunNewsQuoteQuizRepository({ getDatabase: getDb });
  // identityMap REAL: lembra o par LID ↔ PN (mesmo mecanismo do QMP)
  const identityMap = createIdentityMap();
  identityMap.remember('281350775005409@lid', '5511999990001@s.whatsapp.net');
  const { service } = createHarness({
    quoteQuizRepository: quizRepository,
    identityMap,
    getContactDisplayName: (jid) =>
      ({ '5511999990001@s.whatsapp.net': 'Rafa', '281350775005409@lid': 'Rafa' }[jid] || 'Alguém'),
  });
  const now = Date.UTC(2026, 8, 3, 10, 0, 0);
  const sendText = async () => ({ key: { id: 'x' } });

  // Autor gravado como PN, resposta por menção LID (numerações diferentes)
  quizRepository.saveTopQuote({
    scopeKey: scope,
    dayKey: '2026-09-02',
    quoteText: 'Fui no mercado e voltei com um teclado novo, não me julguem.',
    authorJid: '5511999990001@s.whatsapp.net',
    authorName: 'Rafa',
    score: 1.4,
    now: now - 10 * 60 * 60_000,
  });
  await service.launchChallenge({ scopeKey: scope, type: 'who_said_it', now, sendText });
  const byLidMention = await service.handleAnswer({
    scopeKey: scope,
    userJid: 'bia@s.whatsapp.net',
    guess: '@281350775005409',
    now: now + 60_000,
    mentionedJids: ['281350775005409@lid'],
  });
  assert.equal(byLidMention.ok, true, `menção LID deveria casar com autor PN: ${byLidMention.message}`);

  // Vice-versa: autor gravado como LID, resposta por menção PN
  await service.forceExpireChallenge({ scopeKey: scope, now: now + 70_000 });
  quizRepository.saveTopQuote({
    scopeKey: scope,
    dayKey: '2026-09-02',
    quoteText: 'A fila do zap ficou maior que a fila do banco na hora do almoço.',
    authorJid: '281350775005409@lid',
    authorName: 'Rafa',
    score: 1.1,
    now: now + 80_000,
  });
  await service.launchChallenge({ scopeKey: scope, type: 'who_said_it', now: now + 90_000, sendText });
  const byPnMention = await service.handleAnswer({
    scopeKey: scope,
    userJid: 'bia@s.whatsapp.net',
    guess: '@5511999990001',
    now: now + 100_000,
    mentionedJids: ['5511999990001@s.whatsapp.net'],
  });
  assert.equal(byPnMention.ok, true, `menção PN deveria casar com autor LID: ${byPnMention.message}`);

  // Menção de outra pessoa continua não acertando
  await service.forceExpireChallenge({ scopeKey: scope, now: now + 110_000 });
  quizRepository.saveTopQuote({
    scopeKey: scope,
    dayKey: '2026-09-02',
    quoteText: 'Ninguém pagou a aposta do grupo e a dívida só cresce aqui.',
    authorJid: '281350775005409@lid',
    authorName: 'Rafa',
    score: 1.0,
    now: now + 120_000,
  });
  await service.launchChallenge({ scopeKey: scope, type: 'who_said_it', now: now + 130_000, sendText });
  const wrong = await service.handleAnswer({
    scopeKey: scope,
    userJid: 'bia@s.whatsapp.net',
    guess: '@5511999998888',
    now: now + 140_000,
    mentionedJids: ['5511999998888@s.whatsapp.net'],
  });
  assert.equal(wrong.ok, false);
});
