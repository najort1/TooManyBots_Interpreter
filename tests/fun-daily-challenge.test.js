import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createFunDailyChallengeRepository } from '../fun/db/funDailyChallengeRepository.js';
import { createDailyChallengeService } from '../fun/services/dailyChallengeService.js';
import {
  handleResponderCommand,
  handleDicaCommand,
  handleTrocarDesafioCommand,
} from '../fun/commands/handlers/dailyChallenge.js';
import { createFunNewsRepository } from '../fun/db/funNewsRepository.js';
import { createNewsService } from '../fun/services/newsService.js';

await initDb();

function uniqueJid(prefix = '5511') {
  return `${prefix}${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 90 + 10)}@s.whatsapp.net`;
}

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

function createConfig(overrides = {}) {
  return {
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
    dailyChallengeRewardBoostXpDurationMs: 4 * 60 * 60 * 1000,
    dailyChallengeRewardDailyBonusMultiplier: 2,
    dailyChallengeRewardJackpotAmount: 100,
    dailyChallengeSpeedBonus: {
      fast: { max: 5, mult: 1.0 },
      medium: { max: 15, mult: 0.8 },
      slow: { max: 30, mult: 0.6 },
      late: { max: Infinity, mult: 0.4 },
    },
    dailyChallengeNewsEnabled: true,
    dailyChallengePokemonMaxGen: 386,
    dailyChallengeContentMemory: { pokemon: 30, game: 30, riddle: 50 },
    zenBaseUrl: 'http://127.0.0.1:3300',
    zenModel: 'mock',
    zenApiKey: '',
    zenSendSamplingParams: false,
    ...overrides,
  };
}

function createLogger() {
  const calls = [];
  return {
    calls,
    getLogger() {
      return {
        warn: (...args) => calls.push(args),
      };
    },
  };
}

function createServiceHarness({
  repository = null,
  statsRepository = null,
  effectsRepository = null,
  flavorService = null,
  generateZen = null,
  random = () => 0,
  config = createConfig(),
  getContactDisplayName = (jid) => `User-${String(jid).split('@')[0]}`,
} = {}) {
  const repo = repository || createFunDailyChallengeRepository({ getDatabase: getDb });
  const logger = createLogger();
  const statsCalls = [];
  const effectCalls = [];
  const stats =
    statsRepository ||
    {
      addCoins(args) {
        statsCalls.push(args);
        return { ok: true, coins: args.amount };
      },
    };
  const effects =
    effectsRepository ||
    {
      setTimedEffect(args) {
        effectCalls.push(args);
        return args;
      },
    };
  const service = createDailyChallengeService({
    repository: repo,
    statsRepository: stats,
    effectsRepository: effects,
    flavorService,
    generateZen,
    getContactDisplayName,
    getConfig: () => config,
    getLogger: logger.getLogger,
    random,
  });
  return { service, repository: repo, statsCalls, effectCalls, loggerCalls: logger.calls };
}

function makeChallenge({
  scopeKey,
  type = 'riddle',
  launchedAt,
  expiresAt,
  dateStr,
  answer = 'buraco',
  data = { riddle: 'O que e, o que e? Quanto mais se tira, maior fica?', answers: ['buraco'] },
}) {
  return {
    scopeKey,
    type,
    launchedAt,
    expiresAt,
    dateStr,
    answer,
    data,
  };
}

test('dailyChallenge repository: create/get/complete/leaderboards/stats', () => {
  const repo = createFunDailyChallengeRepository({ getDatabase: getDb });
  const scope = uniqueGroup();
  const now = Date.now();

  const id = repo.createChallenge({
    ...makeChallenge({
      scopeKey: scope,
      launchedAt: now,
      expiresAt: now + 1000,
      dateStr: '2099-01-01',
    }),
  });
  assert.ok(id > 0);

  const active = repo.getActiveChallenge(scope);
  assert.equal(active.id, id);
  assert.equal(active.status, 'active');

  repo.completeChallenge(id, 'u1@s.whatsapp.net', 'coins', 25, 45, now + 45_000);
  const today = repo.getTodayChallenge(scope, '2099-01-01');
  assert.equal(today.status, 'completed');
  assert.equal(today.completedByJid, 'u1@s.whatsapp.net');
  assert.equal(today.solveTimeSec, 45);

  const fastest = repo.getFastestLeaderboard(scope, 10);
  const wins = repo.getWinsLeaderboard(scope, 10);
  const stats = repo.getStats(scope);
  assert.equal(fastest[0].jid, 'u1@s.whatsapp.net');
  assert.equal(fastest[0].best, 45);
  assert.equal(wins[0].jid, 'u1@s.whatsapp.net');
  assert.equal(wins[0].wins, 1);
  assert.equal(stats.total >= 1, true);
  assert.equal(stats.solved >= 1, true);
  assert.equal(stats.fastestSec, 45);
});

test('dailyChallenge repository: skip vote UNIQUE, attempts and hints', () => {
  const repo = createFunDailyChallengeRepository({ getDatabase: getDb });
  const scope = uniqueGroup();
  const now = Date.now();
  const id = repo.createChallenge({
    ...makeChallenge({ scopeKey: scope, launchedAt: now, expiresAt: now + 60_000, dateStr: '2099-01-02' }),
  });

  repo.addAttempt({ challengeId: id, userJid: 'a@s.whatsapp.net', guess: 'x', correct: 0, now: now + 1 });
  repo.addAttempt({ challengeId: id, userJid: 'a@s.whatsapp.net', guess: 'y', correct: 0, now: now + 2 });
  assert.equal(repo.countUserAttempts(id, 'a@s.whatsapp.net'), 2);
  assert.equal(repo.getLastAttempt(id, 'a@s.whatsapp.net'), now + 2);

  assert.equal(repo.addSkipVote(id, 'a@s.whatsapp.net', now + 3), true);
  assert.equal(repo.addSkipVote(id, 'a@s.whatsapp.net', now + 4), false);
  assert.equal(repo.countSkipVotes(id), 1);

  repo.recordHint(id, 0, now + 5);
  repo.recordHint(id, 1, now + 6);
  assert.equal(repo.countHintsUsed(id), 2);
  assert.equal(repo.getLastHintIndex(id), 1);
  assert.equal(repo.getLastHintTime(id), now + 6);
});

test('dailyChallenge service: handleAnswer aplica anti-spam, limite e near-miss', async () => {
  const { service, repository } = createServiceHarness();
  const scope = uniqueGroup();
  const user = uniqueJid();
  const now = Date.now();
  repository.createChallenge({
    ...makeChallenge({ scopeKey: scope, launchedAt: now, expiresAt: now + 3600_000, dateStr: '2099-01-03' }),
  });
  const active = repository.getActiveChallenge(scope);

  repository.addAttempt({ challengeId: active.id, userJid: user, guess: 'x', correct: 0, now: now + 1000 });
  const cooldown = await service.handleAnswer({
    scopeKey: scope,
    userJid: user,
    guess: 'buraco',
    now: now + 3000,
  });
  assert.equal(cooldown.ok, false);
  assert.match(cooldown.message, /Aguarde/i);

  for (let i = 0; i < 29; i++) {
    repository.addAttempt({ challengeId: active.id, userJid: uniqueJid('5522'), guess: `g-${i}`, correct: 0, now: now + 4000 + i });
  }

  const near = await service.handleAnswer({
    scopeKey: scope,
    userJid: uniqueJid('5533'),
    guess: 'burac',
    now: now + 10_000,
  });
  assert.equal(near.ok, false);
  assert.match(near.message, /perto|perto/i);

  for (let i = 0; i < 30; i++) {
    repository.addAttempt({ challengeId: active.id, userJid: 'limit@s.whatsapp.net', guess: `t-${i}`, correct: 0, now: now + 20_000 + i });
  }
  const limit = await service.handleAnswer({
    scopeKey: scope,
    userJid: 'limit@s.whatsapp.net',
    guess: 'buraco',
    now: now + 30_000,
  });
  assert.equal(limit.ok, false);
  assert.match(limit.message, /30 tentativas/i);
});

test('dailyChallenge service: handleAnswer aceita alias e só primeiro vencedor ganha', async () => {
  const { service, repository, statsCalls, effectCalls } = createServiceHarness({
    random: () => 0.45,
  });
  const scope = uniqueGroup();
  const now = Date.now();
  repository.createChallenge({
    scopeKey: scope,
    type: 'guess_game',
    data: { game: 'League of Legends', aliases: ['lol', 'league of legends'], hints: ['h1', 'h2', 'h3'] },
    answer: 'league of legends',
    launchedAt: now,
    expiresAt: now + 3600_000,
    dateStr: '2099-01-04',
  });

  const first = await service.handleAnswer({
    scopeKey: scope,
    userJid: 'winner@s.whatsapp.net',
    guess: 'LoL',
    now: now + 120_000,
    getContactDisplayName: () => 'Winner',
  });
  assert.equal(first.ok, true);
  assert.match(first.message, /PARABENS/i);
  assert.equal(statsCalls.length, 1);
  assert.equal(effectCalls.length, 0);

  const second = await service.handleAnswer({
    scopeKey: scope,
    userJid: 'late@s.whatsapp.net',
    guess: 'League of Legends',
    now: now + 121_000,
  });
  assert.equal(second.ok, false);
  assert.match(second.message, /Nenhum desafio ativo/i);
});

test('dailyChallenge service: handleHint respeita primeira dica imediata e cooldown', async () => {
  const { service, repository } = createServiceHarness({
    generateZen: async () => 'dica llm',
  });
  const scope = uniqueGroup();
  const now = Date.now();
  repository.createChallenge({
    scopeKey: scope,
    type: 'guess_game',
    data: { game: 'Minecraft', aliases: ['mc'], hints: ['h1', 'h2', 'h3'] },
    answer: 'minecraft',
    launchedAt: now,
    expiresAt: now + 3600_000,
    dateStr: '2099-01-05',
  });
  const first = await service.handleHint({ scopeKey: scope, now: now + 1000 });
  assert.equal(first.ok, true);
  assert.match(first.message, /Dica 1/i);
  assert.match(first.message, /h1/);

  const blocked = await service.handleHint({ scopeKey: scope, now: now + 2_000 });
  assert.equal(blocked.ok, false);
  assert.match(blocked.message, /Proxima dica/i);

  const second = await service.handleHint({ scopeKey: scope, now: now + 10 * 60 * 1000 + 2_000 });
  assert.equal(second.ok, true);
  assert.match(second.message, /Dica 2/i);
  assert.match(second.message, /h2/);
});

test('dailyChallenge service: handleSkipVote exige 3 votos e lança novo tipo diferente', async () => {
  const { service, repository } = createServiceHarness({
    random: () => 0,
  });
  const scope = uniqueGroup();
  const now = Date.now();
  const messages = [];

  repository.createChallenge({
    scopeKey: scope,
    type: 'guess_game',
    data: { game: 'Minecraft', aliases: ['mc'], hints: ['h1', 'h2', 'h3'] },
    answer: 'minecraft',
    launchedAt: now,
    expiresAt: now + 3600_000,
    dateStr: '2099-01-06',
  });

  const sendText = async (_to, msg) => {
    messages.push(msg);
  };

  const v1 = await service.handleSkipVote({ scopeKey: scope, userJid: 'u1@s.whatsapp.net', now: now + 1, sendText, sendImage: null, sharp: null });
  const v2 = await service.handleSkipVote({ scopeKey: scope, userJid: 'u2@s.whatsapp.net', now: now + 2, sendText, sendImage: null, sharp: null });
  const v3 = await service.handleSkipVote({ scopeKey: scope, userJid: 'u3@s.whatsapp.net', now: now + 3, sendText, sendImage: null, sharp: null });

  assert.equal(v1.ok, false);
  assert.match(v1.message, /Faltam 2/i);
  assert.equal(v2.ok, false);
  assert.match(v2.message, /Faltam 1/i);
  assert.equal(v3.ok, true);
  assert.equal(v3.skipped, true);
  assert.ok(messages.some((m) => /DESAFIO PULADO/i.test(m)));

  const current = repository.getActiveChallenge(scope);
  assert.ok(current);
  assert.notEqual(current.challengeType, 'guess_game');
});

test('dailyChallenge service: processExpired expira e anuncia resposta', async () => {
  const { service, repository } = createServiceHarness();
  const scope = uniqueGroup();
  const now = Date.now();
  const messages = [];
  const id = repository.createChallenge({
    ...makeChallenge({ scopeKey: scope, launchedAt: now - 4000, expiresAt: now - 1000, dateStr: '2099-01-07' }),
  });
  repository.markLaunchPublished(id, now - 4000, now - 1000);

  const out = await service.processExpired({
    scopeKey: scope,
    now,
    sendText: async (_to, msg) => messages.push(msg),
  });
  assert.equal(out.ok, true);
  assert.equal(out.announced, true);
  assert.ok(messages.some((m) => /ENCERRADO/i.test(m)));
  const today = repository.getActiveChallenge(scope);
  assert.equal(today, null);
});

test('dailyChallenge service: tryLaunchToday agenda e lança desafio do dia', async () => {
  const now = new Date('2099-01-08T12:00:00.000Z').getTime();
  const { service, repository } = createServiceHarness({
    config: createConfig({ dailyChallengeStartHour: 0, dailyChallengeEndHour: 23 }),
    random: () => 0,
  });
  const scope = uniqueGroup();
  const messages = [];
  const out = await service.tryLaunchToday({
    scopeKey: scope,
    now,
    sendText: async (_to, msg) => messages.push(msg),
    sendImage: null,
    sharp: null,
  });
  assert.equal(out.ok, true);
  assert.ok(out.challenge);
  assert.ok(messages.length >= 1);
  assert.ok(repository.getActiveChallenge(scope));
});

test('dailyChallenge service: falha de imagem e texto mantém lançamento pendente sem expirar', async () => {
  const now = new Date('2099-01-09T12:00:00.000Z').getTime();
  const { service, repository } = createServiceHarness({
    config: createConfig({ dailyChallengeStartHour: 0, dailyChallengeEndHour: 23 }),
    random: () => 0,
  });
  const scope = uniqueGroup();
  const out = await service.tryLaunchToday({
    scopeKey: scope,
    now,
    sendText: async () => { throw new Error('texto indisponível'); },
    sendImage: async () => { throw new Error('imagem indisponível'); },
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'publish-failed');
  const active = repository.getActiveChallenge(scope);
  assert.equal(active.launchPublishedAt, 0);
  assert.equal(repository.getLaunchSchedule(scope, '2099-01-09').launched, false);
  const expired = await service.processExpired({ scopeKey: scope, now: now + 10 * 3600_000, sendText: async () => { throw new Error('não deve anunciar'); } });
  assert.deepEqual(expired, { ok: false, reason: 'pending-publication' });
  assert.equal(repository.getActiveChallenge(scope).id, active.id);
});

test('dailyChallenge service: retry pendente publica uma vez e recalcula o prazo', async () => {
  const now = new Date('2099-01-11T12:00:00.000Z').getTime();
  const { service, repository } = createServiceHarness({ config: createConfig({ dailyChallengeStartHour: 0, dailyChallengeEndHour: 23 }), random: () => 0 });
  const scope = uniqueGroup();
  repository.setLaunchSchedule(scope, '2099-01-11', 0);
  const id = repository.createChallenge(makeChallenge({ scopeKey: scope, launchedAt: now - 1000, expiresAt: now, dateStr: '2099-01-11' }));
  const messages = [];
  const out = await service.tryLaunchToday({ scopeKey: scope, now, sendText: async (_to, text) => messages.push(text) });
  assert.equal(out.ok, true);
  assert.equal(messages.length, 1);
  const active = repository.getActiveChallenge(scope);
  assert.equal(active.id, id);
  assert.equal(active.launchPublishedAt, now);
  assert.equal(active.expiresAt, now + 4 * 3600_000);
  assert.equal(repository.getLaunchSchedule(scope, '2099-01-11').launched, true);
  assert.deepEqual(await service.tryLaunchToday({ scopeKey: scope, now: now + 1, sendText: async () => messages.push('duplicada') }), { ok: false, reason: 'already-launched' });
  assert.equal(messages.length, 1);
});

test('dailyChallenge service: skipped é falha e retry Pokemon recompõe imagem e caption', async () => {
  const previousFetch = global.fetch;
  try {
    global.fetch = async (url) => ({ ok: /sprites\/pokemon\//.test(String(url)), async arrayBuffer() { return new Uint8Array([1, 2, 3]).buffer; } });
    const now = new Date('2099-01-12T12:00:00.000Z').getTime();
    const { service, repository } = createServiceHarness({ config: createConfig({ dailyChallengeStartHour: 0, dailyChallengeEndHour: 23 }) });
    const scope = uniqueGroup();
    repository.setLaunchSchedule(scope, '2099-01-12', 0);
    const id = repository.createChallenge(makeChallenge({ scopeKey: scope, type: 'pokemon', data: { pokemonId: 25, name: 'pikachu', hints: [] }, answer: 'pikachu', launchedAt: now - 1, expiresAt: now, dateStr: '2099-01-12' }));
    const skipped = await service.tryLaunchToday({ scopeKey: scope, now, sendText: async () => ({ skipped: true, reason: 'queue' }) });
    assert.equal(skipped.reason, 'publish-failed');
    assert.equal(repository.getActiveChallenge(scope).launchPublishedAt, 0);
    const images = [];
    const retried = await service.tryLaunchToday({ scopeKey: scope, now: now + 1000, sendText: async () => { throw new Error('texto não deve ser usado'); }, sendImage: async (_to, image, opts) => images.push({ image, opts }) });
    assert.equal(retried.ok, true);
    assert.equal(retried.challenge.id, id);
    assert.equal(images.length, 1);
    assert.ok(Buffer.isBuffer(images[0].image));
    assert.match(images[0].opts.caption, /POKEMON/i);
  } finally {
    global.fetch = previousFetch;
  }
});

test('dailyChallenge service: tryLaunchToday usa fallback local se Pokemon automático falhar', async () => {
  const prevFetch = global.fetch;
  const fetchCalls = [];
  try {
    global.fetch = async (url, options) => {
      fetchCalls.push({ url: String(url), options });
      assert.match(String(url), /raw\.githubusercontent\.com/i);
      assert.ok(options?.signal instanceof AbortSignal);
      throw new Error('sprite indisponivel');
    };

    const randomValues = [0, 0.99];
    const { service, repository } = createServiceHarness({
      config: createConfig({ dailyChallengeStartHour: 0, dailyChallengeEndHour: 23 }),
      random: () => randomValues.shift() ?? 0,
    });
    const scope = uniqueGroup();
    const now = new Date('2099-01-10T12:00:00.000Z').getTime();
    const images = [];

    const out = await service.tryLaunchToday({
      scopeKey: scope,
      now,
      sendText: async () => {},
      sendImage: async (...args) => images.push(args),
      sharp: null,
    });

    assert.equal(out.ok, true);
    assert.notEqual(out.challenge.challengeType, 'pokemon');
    assert.equal(fetchCalls.length, 8);
    assert.equal(images.length, 0);
    assert.equal(repository.getActiveChallenge(scope).challengeType, out.challenge.challengeType);
    assert.equal(repository.getLaunchSchedule(scope, '2099-01-10').launched, true);
  } finally {
    global.fetch = prevFetch;
  }
});

test('dailyChallenge service: falha de publicação do Pokemon não cria fallback local', async () => {
  const previousFetch = global.fetch;
  try {
    global.fetch = async (url) => {
      const target = String(url);
      if (/sprites\/pokemon\/1\.png/.test(target)) {
        return { ok: true, async arrayBuffer() { return new Uint8Array([1, 2, 3]).buffer; } };
      }
      if (/api\/v2\/pokemon\/1/.test(target)) {
        return { ok: true, async json() { return { name: 'bulbasaur' }; } };
      }
      throw new Error(`URL inesperada: ${target}`);
    };

    const randomValues = [0, 0.99, 0];
    const { service, repository } = createServiceHarness({
      config: createConfig({ dailyChallengeStartHour: 0, dailyChallengeEndHour: 23 }),
      random: () => randomValues.shift() ?? 0,
    });
    const scope = uniqueGroup();
    const now = new Date('2099-01-13T12:00:00.000Z').getTime();

    const out = await service.tryLaunchToday({
      scopeKey: scope,
      now,
      sendImage: async () => { throw new Error('imagem indisponível'); },
      sendText: async () => { throw new Error('texto indisponível'); },
      sharp: null,
    });

    assert.equal(out.ok, false);
    assert.equal(out.reason, 'publish-failed');
    assert.equal(out.challenge.challengeType, 'pokemon');
    const active = repository.getActiveChallenge(scope);
    assert.equal(active.challengeType, 'pokemon');
    assert.equal(active.launchPublishedAt, 0);
    const localChallenges = getDb().prepare(
      `SELECT COUNT(*) AS total FROM analytics.fun_daily_challenges
       WHERE scope_key = ? AND challenge_type IN ('guess_game', 'riddle')`
    ).get(scope);
    assert.equal(localChallenges.total, 0);
  } finally {
    global.fetch = previousFetch;
  }
});

test('dailyChallenge service: tryLaunchToday não relança quando já existe ativo', async () => {
  const now = new Date('2099-01-09T12:00:00.000Z').getTime();
  const { service, repository } = createServiceHarness({
    config: createConfig({ dailyChallengeStartHour: 0, dailyChallengeEndHour: 23 }),
    random: () => 0,
  });
  const scope = uniqueGroup();
  const id = repository.createChallenge({
    ...makeChallenge({ scopeKey: scope, launchedAt: now, expiresAt: now + 3600_000, dateStr: '2099-01-09' }),
  });
  repository.markLaunchPublished(id, now, now + 3600_000);
  const out = await service.tryLaunchToday({ scopeKey: scope, now, sendText: async () => {}, sendImage: null, sharp: null });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'exists');
});

test('dailyChallenge service: launch guess_game usa fallback quando LLM falha', async () => {
  const { service, repository } = createServiceHarness({
    generateZen: async () => 'sem-json-valido',
    random: () => 0,
  });
  const scope = uniqueGroup();
  const now = Date.now();
  const messages = [];
  const out = await service.launchChallenge({
    scopeKey: scope,
    type: 'guess_game',
    now,
    sendText: async (_to, msg) => messages.push(msg),
    sendImage: null,
    sharp: null,
  });
  assert.equal(out.ok, true);
  const active = repository.getActiveChallenge(scope);
  assert.equal(active.challengeType, 'guess_game');
  assert.ok(Array.isArray(active.challengeData.aliases));
  assert.ok(active.challengeData.aliases.length >= 1);
  assert.ok(messages.some((m) => /ADIVINHE O JOGO/i.test(m)));
});

test('dailyChallenge service: launch riddle usa Zen quando JSON valido', async () => {
  const { service, repository } = createServiceHarness({
    generateZen: async () => JSON.stringify({
      riddle: 'O que e, o que e? Fica cheio de paginas, mas nao e biblioteca?',
      answers: ['caderno', 'livro de notas'],
    }),
  });
  const scope = uniqueGroup();
  const now = Date.now();
  const messages = [];
  const out = await service.launchChallenge({
    scopeKey: scope,
    type: 'riddle',
    now,
    sendText: async (_to, msg) => messages.push(msg),
    sendImage: null,
    sharp: null,
  });
  assert.equal(out.ok, true);
  const active = repository.getActiveChallenge(scope);
  assert.equal(active.challengeType, 'riddle');
  assert.equal(active.challengeData.riddle, 'O que e, o que e? Fica cheio de paginas, mas nao e biblioteca?');
  assert.deepEqual(active.challengeData.answers, ['caderno', 'livro de notas']);
  assert.ok(messages.some((m) => /DESAFIO DO DIA — ENIGMA/i.test(m)));
  assert.ok(messages.some((m) => /Fica cheio de paginas/i.test(m)));
});

test('dailyChallenge service: launch riddle usa fallback quando Zen falha', async () => {
  const { service, repository } = createServiceHarness({
    generateZen: async () => 'sem-json-valido',
    random: () => 0,
  });
  const scope = uniqueGroup();
  const now = Date.now();
  const messages = [];
  const out = await service.launchChallenge({
    scopeKey: scope,
    type: 'riddle',
    now,
    sendText: async (_to, msg) => messages.push(msg),
    sendImage: null,
    sharp: null,
  });
  assert.equal(out.ok, true);
  const active = repository.getActiveChallenge(scope);
  assert.equal(active.challengeType, 'riddle');
  assert.equal(active.challengeData.riddle, 'O que e, o que e? Quanto mais se tira, maior fica?');
  assert.deepEqual(active.challengeData.answers, ['buraco', 'buraco negro']);
  assert.ok(messages.some((m) => /DESAFIO DO DIA — ENIGMA/i.test(m)));
});

test('dailyChallenge service: fallback de enigma não repete conteúdo já registrado', async () => {
  const { service, repository } = createServiceHarness({
    generateZen: async () => 'sem-json-valido',
    random: () => 0,
  });
  const scope = uniqueGroup();
  const firstRiddle = 'O que e, o que e? Quanto mais se tira, maior fica?';
  repository.recordContent(scope, 'riddle', firstRiddle);

  const out = await service.launchChallenge({
    scopeKey: scope,
    type: 'riddle',
    now: Date.now(),
    sendText: async () => {},
    sendImage: null,
    sharp: null,
  });

  assert.equal(out.ok, true);
  assert.notEqual(repository.getActiveChallenge(scope).challengeData.riddle, firstRiddle);
});

test('dailyChallenge service: launch riddle via LLM não repete enigma recente e faz retry se colidir', async () => {
  let callCount = 0;
  const duplicateRiddle = 'O que e, o que e? Quanto mais se tira, maior fica?';
  const newRiddle = 'O que e, o que e? Tem dentes mas nao morde?';

  const { service, repository } = createServiceHarness({
    generateZen: async () => {
      callCount++;
      if (callCount === 1) {
        return JSON.stringify({ riddle: duplicateRiddle, answers: ['buraco'] });
      }
      return JSON.stringify({ riddle: newRiddle, answers: ['pente'] });
    },
  });
  const scope = uniqueGroup();
  repository.recordContent(scope, 'riddle', duplicateRiddle);

  const out = await service.launchChallenge({
    scopeKey: scope,
    type: 'riddle',
    now: Date.now(),
    sendText: async () => {},
    sendImage: null,
    sharp: null,
  });

  assert.equal(out.ok, true);
  assert.equal(callCount, 2, 'deveria ter feito uma segunda chamada de retry ao LLM');
  assert.equal(repository.getActiveChallenge(scope).challengeData.riddle, newRiddle);
});

test('dailyChallenge service: enigmas em dias/períodos consecutivos para o mesmo escopo não se repetem', async () => {
  const { service, repository } = createServiceHarness({
    generateZen: async () => 'sem-json-valido',
    random: () => 0,
  });
  const scope = uniqueGroup();
  const selectedRiddles = new Set();

  for (let day = 1; day <= 3; day++) {
    const now = new Date(`2099-03-0${day}T12:00:00.000Z`).getTime();
    const out = await service.launchChallenge({
      scopeKey: scope,
      type: 'riddle',
      now,
      sendText: async () => {},
      sendImage: null,
      sharp: null,
    });
    assert.equal(out.ok, true);
    const active = repository.getActiveChallenge(scope);
    const riddleText = active.challengeData.riddle;

    assert.ok(!selectedRiddles.has(riddleText), `Dia ${day} repetiu o enigma: "${riddleText}"`);
    selectedRiddles.add(riddleText);

    // expira o desafio para permitir lançar no dia seguinte
    repository.expireChallenge(active.id, now + 5 * 3600_000);
  }

  assert.equal(selectedRiddles.size, 3, 'três dias consecutivos devem gerar 3 enigmas diferentes');
});

test('dailyChallenge service: launch pokemon usa fetch + sharp + responde por imagem', async () => {
  const prevFetch = global.fetch;
  try {
    global.fetch = async (url) => {
      if (/sprites\/pokemon\//i.test(String(url))) {
        return {
          ok: true,
          async arrayBuffer() {
            return new Uint8Array([1, 2, 3, 4]).buffer;
          },
        };
      }
      return {
        ok: true,
        async json() {
          return { name: 'pikachu' };
        },
      };
    };

    const sharp = () => ({
      async metadata() {
        return { width: 96, height: 96 };
      },
      ensureAlpha() {
        return this;
      },
      extractChannel() {
        return this;
      },
      threshold() {
        return this;
      },
      composite() {
        return this;
      },
      png() {
        return this;
      },
      async toBuffer() {
        return Buffer.from([9, 9, 9]);
      },
    });

    const { service, repository } = createServiceHarness({
      config: createConfig({ dailyChallengeStartHour: 0, dailyChallengeEndHour: 23 }),
      random: () => 0,
    });
    const scope = uniqueGroup();
    const images = [];
    const out = await service.launchChallenge({
      scopeKey: scope,
      type: 'pokemon',
      now: Date.now(),
      sendText: async () => {},
      sendImage: async (_to, buf, opts) => images.push({ buf, opts }),
      sharp,
    });
    assert.equal(out.ok, true);
    assert.equal(images.length, 1);
    assert.ok(Buffer.isBuffer(images[0].buf));
    assert.match(images[0].opts.caption, /POKEMON/i);
    const active = repository.getActiveChallenge(scope);
    assert.equal(active.challengeType, 'pokemon');
    assert.equal(active.challengeData.name, 'pikachu');
  } finally {
    global.fetch = prevFetch;
  }
});

test('dailyChallenge service: handleHint revela imagem colorida do pokemon na ultima dica', async () => {
  const prevFetch = global.fetch;
  try {
    global.fetch = async (url) => {
      if (/sprites\/pokemon\//i.test(String(url))) {
        return {
          ok: true,
          async arrayBuffer() {
            return new Uint8Array([1, 2, 3, 4]).buffer;
          },
        };
      }
      return {
        ok: true,
        async json() {
          return { name: 'bulbasaur' };
        },
      };
    };

    const { service, repository } = createServiceHarness({
      config: createConfig({ dailyChallengeStartHour: 0, dailyChallengeEndHour: 23 }),
      random: () => 0,
    });
    const scope = uniqueGroup();
    const now = Date.now();
    const images = [];
    const sendImage = async (_to, buf, opts) => images.push({ buf, opts });

    repository.createChallenge({
      scopeKey: scope,
      type: 'pokemon',
      data: { pokemonId: 1, name: 'bulbasaur', hints: [] },
      answer: 'bulbasaur',
      launchedAt: now,
      expiresAt: now + 3600_000,
      dateStr: '2099-02-01',
    });

    // avanca as duas primeiras dicas respeitando cooldown
    await service.handleHint({ scopeKey: scope, now: now + 1000, sendImage });
    await service.handleHint({ scopeKey: scope, now: now + 20 * 60 * 1000, sendImage });
    const last = await service.handleHint({
      scopeKey: scope,
      now: now + 40 * 60 * 1000,
      sendImage,
    });

    assert.equal(last.ok, true, 'ultima dica falhou: ' + JSON.stringify(last));
    assert.equal(last.sentImage, true, 'ultima dica deveria ter enviado imagem');
    assert.equal(images.length, 1, 'imagem colorida nao foi enviada na 3a dica');
    assert.ok(Buffer.isBuffer(images[0].buf));
  } finally {
    global.fetch = prevFetch;
  }
});

test('dailyChallenge service: handleAnswer revela imagem colorida do pokemon ao acertar', async () => {
  const prevFetch = global.fetch;
  try {
    global.fetch = async (url) => {
      if (/sprites\/pokemon\//i.test(String(url))) {
        return {
          ok: true,
          async arrayBuffer() {
            return new Uint8Array([5, 6, 7, 8]).buffer;
          },
        };
      }
      return {
        ok: true,
        async json() {
          return { name: 'charmander' };
        },
      };
    };

    const { service, repository } = createServiceHarness({
      config: createConfig({ dailyChallengeStartHour: 0, dailyChallengeEndHour: 23 }),
      random: () => 0,
    });
    const scope = uniqueGroup();
    const now = Date.now();
    const images = [];
    const sendImage = async (_to, buf, opts) => images.push({ buf, opts });

    repository.createChallenge({
      scopeKey: scope,
      type: 'pokemon',
      data: { pokemonId: 4, name: 'charmander', hints: [] },
      answer: 'charmander',
      launchedAt: now,
      expiresAt: now + 3600_000,
      dateStr: '2099-02-02',
    });

    const out = await service.handleAnswer({
      scopeKey: scope,
      userJid: uniqueJid(),
      guess: 'charmander',
      now: now + 30_000,
      getContactDisplayName: () => 'Treinador',
      sendImage,
    });

    assert.equal(out.ok, true, 'acerto falhou: ' + JSON.stringify(out));
    assert.match(out.message, /PARABENS/i);
    assert.equal(images.length, 1, 'imagem colorida deveria ser enviada ao acertar pokemon');
  } finally {
    global.fetch = prevFetch;
  }
});

test('dailyChallenge service: processExpired revela imagem colorida do pokemon ao expirar', async () => {
  const prevFetch = global.fetch;
  try {
    global.fetch = async (url) => {
      if (/sprites\/pokemon\//i.test(String(url))) {
        return {
          ok: true,
          async arrayBuffer() {
            return new Uint8Array([10, 11, 12]).buffer;
          },
        };
      }
      return {
        ok: true,
        async json() {
          return { name: 'squirtle' };
        },
      };
    };

    const { service, repository } = createServiceHarness({
      config: createConfig({ dailyChallengeStartHour: 0, dailyChallengeEndHour: 23 }),
      random: () => 0,
    });
    const scope = uniqueGroup();
    const now = Date.now();
    const images = [];
    const sendImage = async (_to, buf, opts) => images.push({ buf, opts });
    const sendText = async () => {};

    const id = repository.createChallenge({
      scopeKey: scope,
      type: 'pokemon',
      data: { pokemonId: 7, name: 'squirtle', hints: [] },
      answer: 'squirtle',
      launchedAt: now,
      expiresAt: now + 1000,
      dateStr: '2099-02-03',
    });
    repository.markLaunchPublished(id, now, now + 1000);

    const out = await service.processExpired({
      scopeKey: scope,
      now: now + 5000,
      sendText,
      sendImage,
    });

    assert.equal(out.ok, true, 'expiracao falhou: ' + JSON.stringify(out));
    assert.equal(out.announced, true);
    assert.equal(images.length, 1, 'imagem colorida deveria ser enviada ao expirar pokemon');
  } finally {
    global.fetch = prevFetch;
  }
});

test('dailyChallenge handlers: responder/dica/trocar delegam corretamente', async () => {
  const calls = [];
  const service = {
    async handleAnswer(args) {
      calls.push(['answer', args]);
      return { message: 'ok answer' };
    },
    async handleHint(args) {
      calls.push(['hint', args]);
      return { message: 'ok hint' };
    },
    async handleSkipVote(args) {
      calls.push(['skip', args]);
      return { message: 'ok skip' };
    },
  };
  const replies = [];

  await handleResponderCommand({
    dailyChallengeService: service,
    userJid: 'u@s.whatsapp.net',
    scopeKey: 'g@g.us',
    args: ['League', 'of', 'Legends'],
    reply: async (msg) => replies.push(msg),
    getContactDisplayName: () => 'U',
  });
  await handleDicaCommand({
    dailyChallengeService: service,
    scopeKey: 'g@g.us',
    reply: async (msg) => replies.push(msg),
  });
  await handleTrocarDesafioCommand({
    dailyChallengeService: service,
    scopeKey: 'g@g.us',
    userJid: 'u@s.whatsapp.net',
    reply: async (msg) => replies.push(msg),
  });

  assert.equal(calls[0][0], 'answer');
  assert.equal(calls[0][1].guess, 'League of Legends');
  assert.equal(calls[1][0], 'hint');
  assert.equal(calls[2][0], 'skip');
  assert.deepEqual(replies, ['ok answer', 'ok hint', 'ok skip']);
});

test('dailyChallenge news integration: getTodayStats null omite seção', async () => {
  const newsRepository = createFunNewsRepository({ getDatabase: getDb });
  const newsService = createNewsService({
    newsRepository,
    dailyChallengeService: {
      getTodayStats() {
        return null;
      },
    },
    flavorService: null,
  });
  const edition = await newsService.composeEdition(uniqueGroup(), {}, Date.now());
  assert.ok(!/DESAFIO DO DIA/i.test(edition.text));
});
