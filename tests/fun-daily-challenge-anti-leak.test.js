/**
 * Testes REAIS anti-vazamento de resposta no Desafio Diário.
 *
 * Valida fixes aplicados nesta sessão:
 *  1. Lançamento de guess_game NAO publica dicas (fix bug dicas obvias)
 *  2. Dicas de riddle/pokemon geradas por LLM NAO vazam resposta nem sinonimos
 *  3. Dicas progressivas nao se repetem
 *  4. Fallback estatico tambem nao vaza
 *
 * Cobertura:
 *  - 10 jogos guess_game LLM real (valida fix #1 + dicas internas nao vazam nome)
 *  - 10 riddles tricky (fix #2)
 *  - 10 pokemons tricky (fix #2)
 *
 * Pré-requisitos:
 *  - Proxy ZEN reachable em http://127.0.0.1:3300
 *  - `FUN_DISABLE_LIVE_LLM` removido durante execução
 *
 * Testes skipam automaticamente se ZEN offline.
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
    dailyChallengeHintCooldownMs: 1, // 1ms pra acelerar dicas progressivas (0 cai em fallback 10min)
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

/** Remove FUN_DISABLE_LIVE_LLM durante execução e restaura depois. */
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

/** Normaliza texto: remove acentos, lowercase, alfanumerico apenas. */
function normalizeForLeakCheck(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Checa se resposta (ou sinonimo) aparece na dica. */
function assertNoLeak(hintBody, answer, sinonimos = []) {
  const normHint = normalizeForLeakCheck(hintBody);
  const tokens = normHint.split(/\s+/);

  // 1. palavra exata da resposta nao pode aparecer
  const normAnswer = normalizeForLeakCheck(answer);
  if (!normAnswer) return;
  const answerTokens = normAnswer.split(/\s+/).filter(Boolean);
  if (answerTokens.length > 1) {
    const joined = answerTokens.join(' ');
    if (normHint.includes(joined)) {
      assert.fail(`dica vazou resposta completa "${answer}": ${hintBody}`);
    }
  }
  for (const t of answerTokens) {
    if (t.length < 4) continue; // skip tokens curtos genericos ("chu")
    if (tokens.includes(t)) {
      assert.fail(`dica vazou token "${t}" da resposta "${answer}": ${hintBody}`);
    }
  }

  // 2. sinonimos obvios nao podem aparecer
  for (const sin of sinonimos) {
    const normSin = normalizeForLeakCheck(sin);
    if (!normSin) continue;
    const sinTokens = normSin.split(/\s+/).filter(Boolean);
    if (sinTokens.length === 1 && tokens.includes(sinTokens[0])) {
      assert.fail(`dica vazou sinonimo "${sin}" da resposta "${answer}": ${hintBody}`);
    } else if (sinTokens.length > 1 && normHint.includes(sinTokens.join(' '))) {
      assert.fail(`dica vazou sinonimo composto "${sin}": ${hintBody}`);
    }
  }
}

function stripHintPrefix(msg) {
  return String(msg).replace(/^💡 \*Dica \d+\*\s*\n\n/, '');
}

/* ============================================================ */
/*  FIX #1 — Lancamento guess_game publica apenas a dica 1     */
/*  (dica 1 e sutil por design; dicas 2 e 3 ficam no /dica)    */
/* ============================================================ */

test(
  'FIX#1: lancamento guess_game publica apenas a dica 1 (dicas 2 e 3 ocultas)',
  { skip: !zenReachable ? 'ZEN proxy offline em ' + ZEN_BASE : false, timeout: 90000 },
  withLiveLlm(async () => {
    const { service, repository } = createService({ random: () => 0.5 });
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

    assert.equal(out.ok, true, 'launch falhou: ' + JSON.stringify(out));
    const active = repository.getActiveChallenge(scope);
    assert.equal(active.challengeType, 'guess_game');
    const hints = active.challengeData?.hints || [];
    assert.ok(Array.isArray(hints) && hints.length >= 3, 'LLM deveria gerar 3 hints internas');
    const body = messages.filter((m) => /ADIVINHE O JOGO/i.test(m)).join('\n---\n');
    assert.ok(body, 'sem anuncio de lancamento');

    // dica 1 deve aparecer no lancamento (sutil por design)
    const hint1 = String(hints[0] || '').trim();
    if (hint1.length >= 8) {
      assert.ok(
        body.includes(hint1),
        `FIX#1 (revisao): dica 1 nao apareceu no lancamento: "${hint1.slice(0, 60)}..."`
      );
    }

    // dicas 2 e 3 NAO devem aparecer no lancamento
    for (let i = 1; i < hints.length; i++) {
      const h = String(hints[i] || '').trim();
      if (h.length < 8) continue; // skip dicas curtas demais pra falso positivo
      assert.ok(
        !body.includes(h),
        `FIX#1 falhou: lancamento publicou dica #${i + 1} "${h.slice(0, 60)}..."`
      );
    }
    assert.match(body, /\/dica/i, 'lancamento deve orientar uso do /dica');

    // dica 1 deve estar registrada como liberada: proximo /dica avanca para dica 2
    assert.equal(repository.countHintsUsed(active.id), 1, 'dica 1 deveria constar como liberada');
    assert.equal(repository.getLastHintIndex(active.id), 0, 'lastHintIndex deveria ser 0');
  })
);

test(
  'FIX#1 (10 jogos): lancamento guess_game publica so dica 1 em 10 rodadas',
  { skip: !zenReachable ? 'ZEN proxy offline' : false, timeout: 600000 },
  withLiveLlm(async () => {
    for (let i = 0; i < 10; i++) {
      const { service, repository } = createService({ random: () => i / 10 });
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
      assert.equal(out.ok, true, `jogo ${i + 1}/10 falhou: ${JSON.stringify(out)}`);
      const active = repository.getActiveChallenge(scope);
      const hints = active.challengeData?.hints || [];
      const body = messages.filter((m) => /ADIVINHE O JOGO/i.test(m)).join('\n---\n');

      // dicas 2 e 3 (indices 1+) nao devem aparecer
      for (let j = 1; j < hints.length; j++) {
        const h = String(hints[j] || '').trim();
        if (h.length < 8) continue;
        assert.ok(
          !body.includes(h),
          `jogo ${i + 1}/10 FIX#1 falhou: vazou dica #${j + 1} "${h.slice(0, 60)}..."`
        );
      }
      // bonus: dicas internas do LLM tbm nao devem vazear nome do jogo
      const gameName = normalizeForLeakCheck(active.challengeData?.game || active.answer);
      if (gameName.length >= 4) {
        for (const h of hints) {
          assertNoLeak(h, gameName, []);
        }
      }
    }
  })
);

/* ============================================================ */
/*  FIX #2 — riddle dicas nao vazam resposta (10 casos tricky) */
/* ============================================================ */

const RIDDLE_CASES = [
  { riddle: 'O que e, o que e? Voa sem asas, chora sem olhos?', answer: 'nuvem', sinonimos: ['vapor', 'fumaca', 'neblina', 'coberto'] },
  { riddle: 'O que e, o que e? Tem dentes mas nao morde?', answer: 'pente', sinonimos: ['engrenagem', 'penteado'] },
  { riddle: 'O que e, o que e? Cai em pe e corre deitado?', answer: 'chuva', sinonimos: ['agua da chuva', 'temporal'] },
  { riddle: 'O que e, o que e? Tem maos mas nao apalpa?', answer: 'relogio', sinonimos: ['relogio de pulso'] },
  { riddle: 'O que e, o que e? Tem pescoco mas nao tem cabeca?', answer: 'garrafa', sinonimos: ['garrafa de vidro'] },
  { riddle: 'O que e, o que e? Quanto mais se tira, maior fica?', answer: 'buraco', sinonimos: ['buraco negro', 'cova'] },
  { riddle: 'O que e, o que e? Tem folhas mas nao e arvore?', answer: 'livro', sinonimos: ['caderno', 'revista'] },
  { riddle: 'O que e, o que e? Tem raiz mas nao e planta?', answer: 'dente', sinonimos: ['dente de leite'] },
  { riddle: 'O que e, o que e? Quando recebe, da?', answer: 'espelho', sinonimos: ['reflexo', 'mirror'] },
  { riddle: 'O que e, o que e? Tem costas mas nao tem peito?', answer: 'cadeira', sinonimos: ['banco', 'assento'] },
];

for (let idx = 0; idx < RIDDLE_CASES.length; idx++) {
  const caso = RIDDLE_CASES[idx];
  test(
    `FIX#2 riddle ${idx + 1}/10 (${caso.answer}) — 3 dicas LLM nao vazam`,
    { skip: !zenReachable ? 'ZEN proxy offline' : false, timeout: 180000 },
    withLiveLlm(async () => {
      const { service, repository } = createService({ random: () => idx / 10 });
      const scope = uniqueGroup();
      const now = Date.now();
      repository.createChallenge({
        scopeKey: scope,
        type: 'riddle',
        data: { riddle: caso.riddle, answers: [caso.answer] },
        answer: caso.answer,
        launchedAt: now,
        expiresAt: now + 3600_000,
        dateStr: '2099-01-01',
      });

      const dicas = [];
      let cur = now + 1000;
      for (let i = 0; i < 3; i++) {
        const out = await service.handleHint({ scopeKey: scope, now: cur });
        assert.equal(out.ok, true, `dica ${i + 1}/${caso.answer} falhou: ${JSON.stringify(out)}`);
        const body = stripHintPrefix(out.message);
        assert.ok(body.length >= 10, `dica ${i + 1}/${caso.answer} muito curta: "${body}"`);
        dicas.push(body);
        cur += 1000;
      }
      for (const d of dicas) {
        assertNoLeak(d, caso.answer, caso.sinonimos);
      }
    })
  );
}

/* ============================================================ */
/*  FIX #2 — pokemon dicas nao vazam nome (10 casos tricky)    */
/* ============================================================ */

const POKEMON_CASES = [
  { id: 25, name: 'pikachu', sinonimos: ['pika', 'chu', 'rato eletrico', 'amarelo', 'mascara amarela'] },
  { id: 6, name: 'charizard', sinonimos: ['char', 'dragao', 'lagarto de fogo'] },
  { id: 150, name: 'mewtwo', sinonimos: ['mew', 'clone', 'pokemon genetico'] },
  { id: 94, name: 'gengar', sinonimos: ['fantasma', 'sombras'] },
  { id: 9, name: 'blastoise', sinonimos: ['tartaruga', 'tis', 'togue'] },
  { id: 3, name: 'venusaur', sinonimos: ['venus', 'sapo', 'planta'] },
  { id: 143, name: 'snorlax', sinonimos: ['gordo', 'dorminhoco', 'sono'] },
  { id: 149, name: 'dragonite', sinonimos: ['dragao', 'danny', 'dragaozinho'] },
  { id: 28, name: 'sandslash', sinonimos: ['rato', 'espinho', 'deserto'] },
  { id: 52, name: 'meowth', sinonimos: ['gato', 'gatinho', 'moeda'] },
];

for (let idx = 0; idx < POKEMON_CASES.length; idx++) {
  const caso = POKEMON_CASES[idx];
  test(
    `FIX#2 pokemon ${idx + 1}/10 (${caso.name}) — 3 dicas LLM nao vazam nome`,
    { skip: !zenReachable ? 'ZEN proxy offline' : false, timeout: 180000 },
    withLiveLlm(async () => {
      const { service, repository } = createService({ random: () => idx / 10 });
      const scope = uniqueGroup();
      const now = Date.now();
      repository.createChallenge({
        scopeKey: scope,
        type: 'pokemon',
        data: { pokemonId: caso.id, name: caso.name, hints: [] },
        answer: caso.name,
        launchedAt: now,
        expiresAt: now + 3600_000,
        dateStr: '2099-01-02',
      });

      const dicas = [];
      let cur = now + 1000;
      for (let i = 0; i < 3; i++) {
        const out = await service.handleHint({ scopeKey: scope, now: cur, sendImage: null, sharp: null });
        assert.equal(out.ok, true, `dica ${i + 1}/${caso.name} falhou: ${JSON.stringify(out)}`);
        const body = stripHintPrefix(out.message);
        assert.ok(body.length >= 10, `dica ${i + 1}/${caso.name} muito curta: "${body}"`);
        dicas.push(body);
        cur += 1000;
      }
      for (const d of dicas) {
        assertNoLeak(d, caso.name, caso.sinonimos);
      }
    })
  );
}

/* ============================================================ */
/*  FIX #2 — regressao: dicas progressivas nao se repetem      */
/* ============================================================ */

test(
  'REGRESSAO: 3 dicas progressivas riddle nao se repetem (quando LLM responde)',
  { skip: !zenReachable ? 'ZEN proxy offline' : false, timeout: 120000 },
  withLiveLlm(async () => {
    const { service, repository } = createService();
    const scope = uniqueGroup();
    const now = Date.now();
    repository.createChallenge({
      scopeKey: scope,
      type: 'riddle',
      data: { riddle: 'O que e, o que e? Quanto mais se tira, maior fica?', answers: ['buraco'] },
      answer: 'buraco',
      launchedAt: now,
      expiresAt: now + 3600_000,
      dateStr: '2099-01-03',
    });

    const FALLBACK_MARKER = 'pense no que o enigma descreve';
    const llmHints = [];
    let cur = now + 1000;
    for (let i = 0; i < 3; i++) {
      const out = await service.handleHint({ scopeKey: scope, now: cur });
      assert.equal(out.ok, true, `dica ${i + 1} falhou: ${JSON.stringify(out)}`);
      const body = stripHintPrefix(out.message).toLowerCase();
      if (!body.includes(FALLBACK_MARKER)) llmHints.push(body);
      cur += 1000;
    }

    // se LLM foi offline em todas as 3, skip valido (nao eh bug do prompt)
    if (llmHints.length === 0) {
      console.warn('WARN: LLM offline em todas as 3 dicas — fallback estatico identico eh esperado. Skip regressao.');
      return;
    }

    // ao menos as dicas LLM distinctas entre si
    for (let i = 0; i < llmHints.length; i++) {
      for (let j = i + 1; j < llmHints.length; j++) {
        assert.ok(
          !llmHints[i].startsWith(llmHints[j].slice(0, 30)) &&
            !llmHints[j].startsWith(llmHints[i].slice(0, 30)),
          `dicas LLM se repetiram: "${llmHints[i].slice(0, 60)}" vs "${llmHints[j].slice(0, 60)}"`
        );
      }
    }
  })
);

/* ============================================================ */
/*  FIX #2 — fallback estatico tambem nao vaza                 */
/* ============================================================ */

test(
  'FIX#2 fallback: dica riddle com LLM desligado nao vaza resposta',
  { timeout: 10000 },
  async () => {
    const prev = process.env.FUN_DISABLE_LIVE_LLM;
    process.env.FUN_DISABLE_LIVE_LLM = '1';
    try {
      const { service, repository } = createService();
      const scope = uniqueGroup();
      const now = Date.now();
      repository.createChallenge({
        scopeKey: scope,
        type: 'riddle',
        data: { riddle: 'O que e, o que e? Voa sem asas, chora sem olhos?', answers: ['nuvem'] },
        answer: 'nuvem',
        launchedAt: now,
        expiresAt: now + 3600_000,
        dateStr: '2099-01-04',
      });

      const out = await service.handleHint({ scopeKey: scope, now: now + 1000 });
      assert.equal(out.ok, true);
      const body = stripHintPrefix(out.message);
      assertNoLeak(body, 'nuvem', ['vapor', 'fumaca', 'neblina']);
    } finally {
      if (prev !== undefined) process.env.FUN_DISABLE_LIVE_LLM = prev;
      else delete process.env.FUN_DISABLE_LIVE_LLM;
    }
  }
);
