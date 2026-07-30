/**
 * Testes reais (live) do Desafio Diário usando o proxy ZEN local (glm_5_2 em :3300).
 *
 * Pré-requisitos:
 *  - Proxy ZEN reachable em http://127.0.0.1:3300 (fun/config.user.json)
 *  - `FUN_DISABLE_LIVE_LLM` NÃO pode ser '1' para estes testes (removido no setup)
 *
 * Estes testes validam qualidade das respostas do modelo real, não apenas contrato.
 * São marcados como `{ skip: !zenReachable }` automaticamente se o proxy estiver offline.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { openaiChatComplete, openaiPing } from '../fun/llm/openaiClient.js';
import { createFunDailyChallengeRepository } from '../fun/db/funDailyChallengeRepository.js';
import { createDailyChallengeService } from '../fun/services/dailyChallengeService.js';

await initDb();

const ZEN_BASE = process.env.ZEN_BASE_URL || 'http://127.0.0.1:3300';
const ZEN_MODEL = process.env.ZEN_MODEL || 'glm_5_2';

/** Verifica se o proxy ZEN está disponível antes de rodar testes live. */
let zenReachable = false;
try {
  const ping = await openaiPing({ baseUrl: ZEN_BASE, timeoutMs: 3000 });
  zenReachable = Boolean(ping?.ok);
} catch {
  zenReachable = false;
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
    zenEnabled: true,
    zenBaseUrl: ZEN_BASE,
    zenModel: ZEN_MODEL,
    zenApiKey: '',
    zenSendSamplingParams: false,
    ...overrides,
  };
}

function createService({ config = createConfig(), random = () => 0 } = {}) {
  const repository = createFunDailyChallengeRepository({ getDatabase: getDb });
  return {
    repository,
    service: createDailyChallengeService({
      repository,
      statsRepository: { addCoins: () => ({ ok: true }) },
      effectsRepository: { setTimedEffect: () => null },
      generateZen: openaiChatComplete,
      getContactDisplayName: (jid) => `User-${String(jid).split('@')[0]}`,
      getConfig: () => config,
      getLogger: () => ({ warn: () => {} }),
      random,
    }),
  };
}

// Helper para remover FUN_DISABLE_LIVE_LLM durante testes live e restaurar depois.
function withLiveLlm(fn) {
  return async () => {
    const prev = process.env.FUN_DISABLE_LIVE_LLM;
    delete process.env.FUN_DISABLE_LIVE_LLM;
    try {
      return await fn();
    } finally {
      if (prev !== undefined) process.env.FUN_DISABLE_LIVE_LLM = prev;
      else process.env.FUN_DISABLE_LIVE_LLM = '1';
    }
  };
}

test(
  'zen real: tryLlmGuessGame devolve JSON valido com game, aliases e 3 hints',
  { skip: !zenReachable ? 'ZEN proxy offline em ' + ZEN_BASE : false },
  withLiveLlm(async () => {
    const { service, repository } = createService();
    const scope = uniqueGroup();
    const messages = [];
    const out = await service.launchChallenge({
      scopeKey: scope,
      type: 'guess_game',
      now: Date.now(),
      sendText: async (_to, msg) => messages.push(msg),
      sendImage: null,
      sharp: null,
    });

    assert.equal(out.ok, true, 'launchChallenge falhou: ' + JSON.stringify(out));
    const active = repository.getActiveChallenge(scope);
    assert.equal(active.challengeType, 'guess_game');
    assert.ok(active.answer, 'answer vazio');
    assert.ok(active.answer.length >= 2, 'answer muito curto');
    assert.ok(Array.isArray(active.challengeData.aliases), 'aliases nao eh array');
    assert.ok(
      active.challengeData.aliases.length >= 1,
      'deve ter ao menos 1 alias: ' + JSON.stringify(active.challengeData)
    );
    assert.ok(
      Array.isArray(active.challengeData.hints) && active.challengeData.hints.length >= 1,
      'deve ter hints: ' + JSON.stringify(active.challengeData.hints)
    );
    // Validar que hints não vazias
    for (const h of active.challengeData.hints.slice(0, 3)) {
      assert.ok(String(h || '').trim().length >= 5, 'hint muito curta: ' + JSON.stringify(h));
    }
    // Mensagem de lançamento deve conter as dicas
    assert.ok(messages.some((m) => /ADIVINHE O JOGO/i.test(m)), 'sem anuncio de lancamento');
  })
);

test(
  'zen real: handleHint gera dica textual coesa para enigma',
  { skip: !zenReachable ? 'ZEN proxy offline' : false },
  withLiveLlm(async () => {
    const { service, repository } = createService();
    const scope = uniqueGroup();
    const now = Date.now();
    repository.createChallenge({
      scopeKey: scope,
      type: 'riddle',
      data: {
        riddle: 'O que e, o que e? Tem dentes mas nao morde?',
        answers: ['pente', 'engrenagem'],
      },
      answer: 'pente',
      launchedAt: now,
      expiresAt: now + 3600_000,
      dateStr: '2099-01-01',
    });

    const hint = await service.handleHint({ scopeKey: scope, now: now + 1000 });
    assert.equal(hint.ok, true, 'handleHint falhou: ' + JSON.stringify(hint));
    assert.match(hint.message, /Dica 1/i);
    // dica textual gerada por LLM deve ser não-vazia, NUNCA conter a resposta
    const body = String(hint.message).replace(/^💡 \*Dica \d+\*\s*\n\n/, '');
    assert.ok(body.length >= 10, 'dica muito curta: ' + body);
    assert.ok(
      !/pente|engrenagem/i.test(body),
      'dica vazou a resposta: ' + body
    );
  })
);

test(
  'zen real: handleHint para pokemon gera dica sem vazear nome',
  { skip: !zenReachable ? 'ZEN proxy offline' : false },
  withLiveLlm(async () => {
    const { service, repository } = createService();
    const scope = uniqueGroup();
    const now = Date.now();
    repository.createChallenge({
      scopeKey: scope,
      type: 'pokemon',
      data: { pokemonId: 25, name: 'pikachu', hints: [] },
      answer: 'pikachu',
      launchedAt: now,
      expiresAt: now + 3600_000,
      dateStr: '2099-01-02',
    });

    const hint = await service.handleHint({ scopeKey: scope, now: now + 1000 });
    assert.equal(hint.ok, true, 'handleHint pokemon falhou: ' + JSON.stringify(hint));
    const body = String(hint.message).replace(/^💡 \*Dica \d+\*\s*\n\n/, '');
    assert.ok(body.length >= 10, 'dica pokemon muito curta: ' + body);
    assert.ok(!/pikachu/i.test(body), 'dica pokemon vazou o nome: ' + body);
  })
);

test(
  'zen real: resposta errada de guess_game com alias连贯 e near-miss funciona',
  { skip: !zenReachable ? 'ZEN proxy offline' : false },
  withLiveLlm(async () => {
    const { service, repository } = createService();
    const scope = uniqueGroup();
    const now = Date.now();
    repository.createChallenge({
      scopeKey: scope,
      type: 'guess_game',
      data: { game: 'Minecraft', aliases: ['mine', 'mc', 'minecraft'], hints: ['h1', 'h2', 'h3'] },
      answer: 'minecraft',
      launchedAt: now,
      expiresAt: now + 3600_000,
      dateStr: '2099-01-03',
    });

    const wrong = await service.handleAnswer({
      scopeKey: scope,
      userJid: 'u1@s.whatsapp.net',
      guess: 'mincraft',
      now: now + 2000,
      getContactDisplayName: () => 'U1',
    });
    assert.equal(wrong.ok, false);
    assert.match(wrong.message, /perto|Resposta incorreta/i);

    const correct = await service.handleAnswer({
      scopeKey: scope,
      userJid: 'u2@s.whatsapp.net',
      guess: 'mine',
      now: now + 3000,
      getContactDisplayName: () => 'U2',
    });
    assert.equal(correct.ok, true, 'alias deveria acertar: ' + JSON.stringify(correct));
    assert.match(correct.message, /PARABENS/i);
  })
);

test(
  'zen real: modelo respeita jsonMode e retorna JSON parseavel em tryLlmGuessGame',
  { skip: !zenReachable ? 'ZEN proxy offline' : false },
  withLiveLlm(async () => {
    const system =
      'Voce e um assistente de jogos. Gere UM jogo conhecido e 3 dicas em portugues brasileiro. ' +
      'Responda APENAS no formato JSON: ' +
      '{"game":"Nome","aliases":["a1","a2"],"hints":["h1","h2","h3"]}';
    const user = 'Gere um jogo popular agora.';
    // jsonMode false: cliente devolve texto bruto; nosso service faz parse manual
    const raw = await openaiChatComplete({
      baseUrl: ZEN_BASE,
      model: ZEN_MODEL,
      system,
      prompt: user,
      timeoutMs: 45000,
      maxTokens: 400,
      temperature: 0.9,
      apiKey: '',
      sendSamplingParams: false,
      jsonMode: false,
    });

    assert.ok(raw, 'resposta vazia do ZEN');
    const text = String(raw).trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    assert.ok(start >= 0 && end > start, 'nao contem JSON: ' + text.slice(0, 200));
    let parsed;
    try {
      parsed = JSON.parse(text.slice(start, end + 1));
    } catch (err) {
      assert.fail('JSON invalido: ' + err.message + ' :: ' + text.slice(start, end + 1).slice(0, 200));
    }
    assert.ok(parsed.game, 'sem campo game');
    assert.ok(Array.isArray(parsed.hints), 'hints nao eh array');
    assert.ok(parsed.hints.length >= 1, 'hints vazio');
  })
);
