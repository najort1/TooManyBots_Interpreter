import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createFunDailyChallengeRepository } from '../fun/db/funDailyChallengeRepository.js';
import { createDailyChallengeService } from '../fun/services/dailyChallengeService.js';
import { handleDesafioCommand } from '../fun/commands/handlers/dailyChallenge.js';

await initDb();

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

function createConfig(overrides = {}) {
  return {
    dailyChallengeEnabled: true,
    dailyChallengeStartHour: 8,
    dailyChallengeEndHour: 20,
    dailyChallengeDurationMs: 4 * 60 * 60 * 1000,
    dailyChallengeHintCooldownMs: 0, // sem cooldown em testes
    dailyChallengeMaxAttemptsPerUser: 30,
    dailyChallengeAttemptCooldownMs: 0,
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
    ...overrides,
  };
}

function createServiceHarness(overrides = {}) {
  const repo = createFunDailyChallengeRepository({ getDatabase: getDb });
  const service = createDailyChallengeService({
    repository: repo,
    statsRepository: { addCoins: () => ({ ok: true }) },
    effectsRepository: { setTimedEffect: () => {} },
    getContactDisplayName: (jid) => `User-${String(jid).split('@')[0]}`,
    getConfig: () => createConfig(overrides),
  });
  return { service, repository: repo };
}

test('dailyChallenge: Cine Emoji (guess_movie_emoji) lança, gera dicas e aceita resposta com aliases', async () => {
  const { service, repository } = createServiceHarness();
  const scope = uniqueGroup();
  const now = Date.now();
  const messages = [];

  const launched = await service.launchChallenge({
    scopeKey: scope,
    type: 'guess_movie_emoji',
    now,
    sendText: async (_to, msg) => { messages.push(msg); return { ok: true }; },
  });

  assert.equal(launched.ok, true);
  assert.equal(launched.challenge.type, 'guess_movie_emoji');
  assert.equal(messages.length, 1);
  assert.match(messages[0], /CINE EMOJI/i);
  assert.match(messages[0], /Enigma:/i);

  // Testa dica
  const hint1 = await service.handleHint({ scopeKey: scope, now });
  assert.equal(hint1.ok, true);
  assert.match(hint1.message, /Dica 1/i);

  // Testa resposta com alias ou nome
  const active = repository.getActiveChallenge(scope);
  assert.ok(active.challengeData.movie);
  assert.ok(active.challengeData.aliases.length > 0);

  const answerTest = active.challengeData.movie;
  const answered = await service.handleAnswer({
    scopeKey: scope,
    userJid: '5511999990001@s.whatsapp.net',
    guess: answerTest,
    now: now + 5000,
  });

  assert.equal(answered.ok, true);
  assert.match(answered.message, /PARABENS/i);
});

test('dailyChallenge: Quem Sou Eu? (who_am_i) lança enigma em 1ª pessoa e valida resposta', async () => {
  const { service, repository } = createServiceHarness();
  const scope = uniqueGroup();
  const now = Date.now();
  const messages = [];

  const launched = await service.launchChallenge({
    scopeKey: scope,
    type: 'who_am_i',
    now,
    sendText: async (_to, msg) => { messages.push(msg); return { ok: true }; },
  });

  assert.equal(launched.ok, true);
  assert.equal(launched.challenge.type, 'who_am_i');
  assert.match(messages[0], /QUEM SOU EU\?/i);

  // Dica 1
  const hint1 = await service.handleHint({ scopeKey: scope, now });
  assert.equal(hint1.ok, true);
  assert.match(hint1.message, /Dica 1/i);

  // Resposta correta
  const active = repository.getActiveChallenge(scope);
  const correctName = active.challengeData.name;
  assert.ok(correctName);

  const answered = await service.handleAnswer({
    scopeKey: scope,
    userJid: '5511999990002@s.whatsapp.net',
    guess: correctName,
    now: now + 10000,
  });

  assert.equal(answered.ok, true);
  assert.match(answered.message, /PARABENS/i);
});

test('dailyChallenge: Enigma Matemático (math_puzzle) calcula equações e valida número', async () => {
  const { service, repository } = createServiceHarness();
  const scope = uniqueGroup();
  const now = Date.now();
  const messages = [];

  const launched = await service.launchChallenge({
    scopeKey: scope,
    type: 'math_puzzle',
    now,
    sendText: async (_to, msg) => { messages.push(msg); return { ok: true }; },
  });

  assert.equal(launched.ok, true);
  assert.equal(launched.challenge.type, 'math_puzzle');
  assert.match(messages[0], /EQUAÇÃO LÓGICA/i);
  assert.match(messages[0], /= \?/i);

  const active = repository.getActiveChallenge(scope);
  const correctAnswer = active.challengeData.answer;
  assert.ok(correctAnswer);

  // Erro intencional
  const wrong = await service.handleAnswer({
    scopeKey: scope,
    userJid: '5511999990003@s.whatsapp.net',
    guess: '99999',
    now: now + 1000,
  });
  assert.equal(wrong.ok, false);

  // Resposta correta (respeitando intervalo após a tentativa anterior)
  const answered = await service.handleAnswer({
    scopeKey: scope,
    userJid: '5511999990003@s.whatsapp.net',
    guess: correctAnswer,
    now: now + 10000,
  });

  assert.equal(answered.ok, true);
  assert.match(answered.message, /PARABENS/i);
});

test('dailyChallenge: Anagrama (word_scramble) apresenta letras embaralhadas e tema', async () => {
  const { service, repository } = createServiceHarness();
  const scope = uniqueGroup();
  const now = Date.now();
  const messages = [];

  const launched = await service.launchChallenge({
    scopeKey: scope,
    type: 'word_scramble',
    now,
    sendText: async (_to, msg) => { messages.push(msg); return { ok: true }; },
  });

  assert.equal(launched.ok, true);
  assert.equal(launched.challenge.type, 'word_scramble');
  assert.match(messages[0], /ANAGRAMA/i);
  assert.match(messages[0], /Tema:/i);
  assert.match(messages[0], /Letras:/i);

  const active = repository.getActiveChallenge(scope);
  const correctWord = active.challengeData.word;
  assert.ok(correctWord);

  const answered = await service.handleAnswer({
    scopeKey: scope,
    userJid: '5511999990004@s.whatsapp.net',
    guess: correctWord.toUpperCase(), // caixa alta para testar normalização
    now: now + 4000,
  });

  assert.equal(answered.ok, true);
  assert.match(answered.message, /PARABENS/i);
});

test('dailyChallenge handlers: /desafio forcar aceita novos apelidos de tipos', async () => {
  const { service, repository } = createServiceHarness();
  const scope = uniqueGroup();
  const replies = [];

  const ctx = {
    dailyChallengeService: service,
    scopeKey: scope,
    userJid: '5511999990005@s.whatsapp.net',
    args: ['forcar', 'filme'],
    reply: async (msg) => { replies.push(msg); },
  };

  const res = await handleDesafioCommand(ctx);
  assert.equal(res.handled, true);
  assert.ok(replies.some((msg) => /guess_movie_emoji/i.test(msg)));

  const active = repository.getActiveChallenge(scope);
  assert.equal(active.challengeType, 'guess_movie_emoji');
});
