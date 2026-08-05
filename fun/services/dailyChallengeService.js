/**
 * Servico de Desafio Diario do modulo fun.
 *
 * Responsabilidades:
 *  - Lancar um desafio aleatorio por dia em horario aleatorio (por escopo)
 *  - Processar expiracao anunciando resposta correta
 *  - Validar respostas (apenas primeiro acerto ganha)
 *  - Gerar dicas com cooldown progressivo
 *  - Votacao de skip (3 votos)
 *  - Recompensas ponderadas com multiplicador de velocidade
 *  - Ranking duplo (mais rapidos / mais vitorias)
 *  - Estatisticas para o jornal diario (getTodayStats)
 *
 * Tipos de desafio:
 *  - guess_game (adivinhe o jogo em 3 dicas) — LLM com fallback local
 *  - riddle (enigmas estaticos)
 *  - pokemon (Who's That Pokemon — imagem escurecida)
 */

import { RIDDLES } from './data/riddles.js';
import { FALLBACK_GAMES } from './data/guessGameFallback.js';
import { openaiChatComplete } from '../llm/openaiClient.js';
import { resolveZenEndpoint } from '../llm/zenEndpoint.js';

const CHALLENGE_TYPES = ['guess_game', 'riddle', 'pokemon'];
const LOCAL_CHALLENGE_TYPES = ['guess_game', 'riddle'];
const MAX_HINTS = 3;
const HINT_COOLDOWN_DEFAULT_MS = 10 * 60 * 1000;
const POKEMON_FETCH_TIMEOUT_MS = 5000;

const REWARD_EMOJI = {
  boost_xp: '⭐',
  coins: '🪙',
  daily_bonus: '🎁',
  jackpot: '🎰',
};

const REWARD_LABEL = {
  boost_xp: 'Boost de XP',
  coins: 'Moedas',
  daily_bonus: 'Bonus de Daily',
  jackpot: 'Jackpot',
};

/* ---------- utilidades de normalizacao ---------- */

const ACCENTS = /[\u0300-\u036f]/g;

function stripAccents(s) {
  return String(s || '').normalize('NFD').replace(ACCENTS, '');
}

function normalizeAnswer(s) {
  return stripAccents(s)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** filtra ano/edicao/subtitulo: "Call of Duty: Modern Warfare II (2022)" -> "Call of Duty" */
function filterGameName(name) {
  let n = String(name || '').trim();
  n = n.replace(/\s*\(\d{4}\)\s*/g, '').trim();
  n = n.replace(/\s*:\s.*$/, '').trim();
  n = n.replace(/\s+—\s.*$/, '').trim();
  n = n.replace(/\s+-\s.*$/, '').trim();
  return n || String(name || '').trim();
}

/** distancia de Levenshtein O(n*m) */
function levenshteinDistance(a, b) {
  const A = String(a || '');
  const B = String(b || '');
  if (A === B) return 0;
  const n = A.length;
  const m = B.length;
  if (n === 0) return m;
  if (m === 0) return n;
  const prev = new Array(m + 1);
  const curr = new Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    curr[0] = i;
    for (let j = 1; j <= m; j++) {
      const cost = A.charCodeAt(i - 1) === B.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= m; j++) prev[j] = curr[j];
  }
  return prev[m];
}

function pickOne(arr, random) {
  const r = (random && typeof random === 'function') ? random() : Math.random();
  const list = Array.isArray(arr) ? arr : [];
  if (list.length === 0) return null;
  return list[Math.floor(r * list.length)];
}

function randomInt(min, max, random) {
  const lo = Math.floor(min);
  const hi = Math.floor(max);
  const r = (random && typeof random === 'function') ? random() : Math.random();
  return lo + Math.floor(r * (hi - lo + 1));
}

function dateStrFor(now) {
  const d = new Date(now);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function minutesOfDay(now) {
  const d = new Date(now);
  return d.getHours() * 60 + d.getMinutes();
}

function computeSpeedMultiplier(solveTimeSec, speedCfg) {
  const secs = Number(solveTimeSec) || 0;
  const fastMaxSec = (Number(speedCfg?.fast?.max) || 5) * 60;
  const medMaxSec = (Number(speedCfg?.medium?.max) || 15) * 60;
  const slowMaxSec = (Number(speedCfg?.slow?.max) || 30) * 60;
  if (secs <= fastMaxSec) return Number(speedCfg?.fast?.mult ?? 1.0);
  if (secs <= medMaxSec) return Number(speedCfg?.medium?.mult ?? 0.8);
  if (secs <= slowMaxSec) return Number(speedCfg?.slow?.mult ?? 0.6);
  return Number(speedCfg?.late?.mult ?? 0.4);
}

function formatDuration(ms) {
  if (!ms || ms <= 0) return '0s';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m${rem > 0 ? ` ${rem}s` : ''}`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function formatSolveTime(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m} min${rem > 0 ? ` ${rem}s` : ''}`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/* ---------- factory ---------- */

/**
 * @param {object} deps
 * @param {object} deps.repository        funDailyChallengeRepository
 * @param {object} deps.statsRepository    funStatsRepository (awardXp/addCoins)
 * @param {object} [deps.effectsRepository] funEffectsRepository (setTimedEffect)
 * @param {object} [deps.flavorService]   flavorService (dicas LLM)
 * @param {function} [deps.generateZen]   openai/zen generation
 * @param {function} [deps.generateOllama] ollama generation
 * @param {() => object} deps.getConfig   resolveFunConfig
 * @param {function} [deps.getContactDisplayName]
 * @param {object} [deps.getLogger]
 * @param {function} [deps.random]        fn() -> [0,1)
 */
export function createDailyChallengeService(deps = {}) {
  const repository = deps.repository;
  if (!repository) throw new Error('dailyChallengeService: repository obrigatorio');

  const statsRepository = deps.statsRepository;
  const effectsRepository = deps.effectsRepository;
  const flavorService = deps.flavorService;
  const generateZen = deps.generateZen || openaiChatComplete;
  const getConfig = deps.getConfig || (() => ({}));
  const getContactDisplayName = deps.getContactDisplayName || (() => 'alguem');
  const logger = deps.getLogger?.() || null;
  const random = deps.random || Math.random;

  const log = (...args) => {
    try {
      logger?.warn?.(...args);
    } catch { /* noop */ }
  };

  function cfg() {
    return getConfig() || {};
  }

  /* ---------- LLM helpers ---------- */

  async function tryLlmJson(system, userPrompt, timeoutMs = 45000) {
    const c = cfg();
    const { baseUrl, model, apiKey } = resolveZenEndpoint(c);
    if (typeof generateZen !== 'function' || c.dailyChallengeEnabled === false || c.zenEnabled === false) return null;
    if (process.env.FUN_DISABLE_LIVE_LLM === '1' && generateZen === openaiChatComplete) return null;
    try {
      const raw = await generateZen({
        baseUrl,
        model,
        system,
        prompt: userPrompt,
        timeoutMs,
        maxTokens: 400,
        temperature: 0.9,
        apiKey,
        sendSamplingParams: c.zenSendSamplingParams === true,
        jsonMode: true,
      });
      if (!raw) return null;
      const text = String(raw).trim();
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start < 0 || end <= start) return null;
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    } catch (err) {
      log({ err: err?.message }, 'dailyChallenge llm json fail');
      return null;
    }
  }

  async function llmText(system, userPrompt, timeoutMs = 30000) {
    const c = cfg();
    if (c.dailyChallengeEnabled === false || c.zenEnabled === false) return null;
    // prioriza flavorService se disposer de line
    if (flavorService && typeof flavorService.line === 'function') {
      try {
        const out = await flavorService.line('daily_challenge_hint', {
          system,
          userPrompt,
          scopeKey: null,
        });
        const txt = (out || '').toString().trim();
        if (txt && !/^\[.+\]$/.test(txt)) return txt;
      } catch { /* cai pra generateZen */ }
    }
    if (typeof generateZen !== 'function') return null;
    if (process.env.FUN_DISABLE_LIVE_LLM === '1' && typeof generateZen === 'function' && generateZen.name === 'openaiChatComplete') return null;
    const { baseUrl, model, apiKey } = resolveZenEndpoint(c);
    try {
      const raw = await generateZen({
        baseUrl,
        model,
        system,
        prompt: userPrompt,
        timeoutMs,
        maxTokens: 180,
        temperature: 0.8,
        apiKey,
        sendSamplingParams: c.zenSendSamplingParams === true,
      });
      const txt = raw ? String(raw).trim() : '';
      return txt || null;
    } catch (err) {
      log({ err: err?.message }, 'dailyChallenge llm text fail');
      return null;
    }
  }

  /* ---------- selecao de tipo (evita repetir o anterior) ---------- */

  function pickChallengeType(excludeType) {
    const pool = CHALLENGE_TYPES.filter((t) => t !== excludeType);
    return pickOne(pool, random) || CHALLENGE_TYPES[0];
  }

  /* ---------- dedup de conteudo ---------- */

  function pickNonRepeating(scopeKey, contentType, universe, memoryLimit) {
    const recent = repository.getRecentContent(scopeKey, contentType, memoryLimit || 30);
    const recentSet = new Set(recent.map((v) => normalizeAnswer(v)));
    const available = universe.filter((item) => {
      const key = normalizeAnswer(item.key || item.game || item.riddle || item.name || '');
      return !recentSet.has(key);
    });
    const pool = available.length > 0 ? available : universe;
    return pickOne(pool, random);
  }

  /* ---------- recompensas ---------- */

  function pickRewardType() {
    const c = cfg();
    const weights = c.dailyChallengeRewardWeights || {
      boost_xp: 40,
      coins: 35,
      daily_bonus: 20,
      jackpot: 5,
    };
    const total = Object.values(weights).reduce((a, b) => a + Number(b || 0), 0);
    if (total <= 0) return 'coins';
    let r = random() * total;
    for (const [type, w] of Object.entries(weights)) {
      r -= Number(w || 0);
      if (r < 0) return type;
    }
    return 'coins';
  }

  function applyReward(userJid, scopeKey, rewardType, mult) {
    const c = cfg();
    const m = Math.max(0, Number(mult) || 0);
    try {
      if (rewardType === 'boost_xp') {
        const dur = Math.round((c.dailyChallengeRewardBoostXpDurationMs || 4 * 3600_000) * m);
        if (effectsRepository?.setTimedEffect) {
          effectsRepository.setTimedEffect({
            userJid,
            scopeKey,
            effectKey: 'xp_boost',
            durationMs: dur,
            payload: { source: 'daily_challenge', mult: m },
          });
        }
        return { type: rewardType, label: `${REWARD_LABEL.boost_xp} (${formatDuration(dur)})` };
      }
      if (rewardType === 'coins') {
        const base = randomInt(
          c.dailyChallengeRewardCoinsMin ?? 20,
          c.dailyChallengeRewardCoinsMax ?? 50,
          random
        );
        const amount = Math.max(1, Math.round(base * m));
        if (statsRepository?.addCoins) {
          statsRepository.addCoins({ userJid, scopeKey, amount, reason: 'daily_challenge' });
        }
        return { type: rewardType, label: `${amount} moedas`, value: amount };
      }
      if (rewardType === 'daily_bonus') {
        const bonusMult = (c.dailyChallengeRewardDailyBonusMultiplier || 2) * m;
        if (effectsRepository?.setTimedEffect) {
          effectsRepository.setTimedEffect({
            userJid,
            scopeKey,
            effectKey: 'daily_bonus',
            durationMs: 36 * 3600_000,
            payload: { multiplier: bonusMult, source: 'daily_challenge' },
          });
        }
        return {
          type: rewardType,
          label: `${REWARD_LABEL.daily_bonus} (x${bonusMult.toFixed(2)})`,
        };
      }
      if (rewardType === 'jackpot') {
        const amount = Number(c.dailyChallengeRewardJackpotAmount) || 100;
        if (statsRepository?.addCoins) {
          statsRepository.addCoins({
            userJid,
            scopeKey,
            amount,
            reason: 'daily_challenge_jackpot',
          });
        }
        return {
          type: rewardType,
          label: `${REWARD_EMOJI.jackpot} Jackpot! ${amount} moedas`,
          value: amount,
        };
      }
    } catch (err) {
      log({ err: err?.message }, 'dailyChallenge applyReward fail');
    }
    return { type: rewardType, label: REWARD_LABEL[rewardType] || rewardType };
  }

  /* ---------- agendamento diario ---------- */

  function scheduleToday(scopeKey, now) {
    const c = cfg();
    const startH = Number(c.dailyChallengeStartHour ?? 8);
    const endH = Number(c.dailyChallengeEndHour ?? 20);
    const lo = Math.max(0, Math.min(23, startH)) * 60;
    const hi = Math.max(lo + 30, Math.min(24 * 60 - 1, endH * 60));
    const target = randomInt(lo, hi, random);
    const ds = dateStrFor(now);
    repository.setLaunchSchedule(scopeKey, ds, target);
    return target;
  }

  /* ---------- lancamento ---------- */

  /**
   * Tenta lancar o desafio de hoje se for a hora certa.
   */
  async function tryLaunchToday({ scopeKey, now, sendText, sendImage, sharp }) {
    const c = cfg();
    if (c.dailyChallengeEnabled === false) return { ok: false, reason: 'disabled' };
    if (!scopeKey) return { ok: false, reason: 'no-scope' };

    const ds = dateStrFor(now);
    let sched = repository.getLaunchSchedule(scopeKey, ds);
    if (!sched) {
      scheduleToday(scopeKey, now);
      sched = repository.getLaunchSchedule(scopeKey, ds);
    }
    if (!sched || sched.launched) return { ok: false, reason: 'already-launched' };

    const existing = repository.getActiveChallenge(scopeKey);
    if (existing) {
      if (existing.launchPublishedAt === 0) {
        const result = await retryPendingLaunch({ scopeKey, challenge: existing, now, sendText, sendImage, sharp });
        if (result.ok) repository.markScheduleLaunched(scopeKey, ds);
        return result;
      }
      return { ok: false, reason: 'exists' };
    }

    const minutesNow = minutesOfDay(now);
    if (minutesNow < sched.targetMinute) return { ok: false, reason: 'not-window' };

    const type = pickChallengeType(null);
    let result = await launchChallenge({
      scopeKey,
      type,
      now,
      sendText,
      sendImage,
      sharp,
    });
    if (!result?.ok && type === 'pokemon' && !result?.challenge?.id) {
      for (const localType of LOCAL_CHALLENGE_TYPES) {
        result = await launchChallenge({
          scopeKey,
          type: localType,
          now,
          sendText,
          sendImage,
          sharp,
        });
        if (result?.ok) break;
      }
    }
    if (result?.ok) {
      repository.markScheduleLaunched(scopeKey, ds);
    }
    return result;
  }

  async function launchChallenge({ scopeKey, type, now, sendText, sendImage, sharp }) {
    const c = cfg();
    const duration = Number(c.dailyChallengeDurationMs) || 4 * 3600_000;
    const launchedAt = Number(now) || Date.now();
    const expiresAt = launchedAt + duration;
    const ds = dateStrFor(launchedAt);

    let payload = null;
    if (type === 'guess_game') {
      payload = await launchGuessGame(scopeKey, now);
    } else if (type === 'riddle') {
      payload = await launchRiddle(scopeKey, now);
    } else if (type === 'pokemon') {
      payload = await launchPokemon(scopeKey, now, sendImage, sharp);
    } else {
      return { ok: false, reason: 'unknown-type' };
    }
    if (!payload) return { ok: false, reason: 'launch-failed' };

    const answer = payload.answer;
    const data = payload.data || {};
    const id = repository.createChallenge({
      scopeKey,
      type,
      data,
      answer,
      launchedAt,
      expiresAt,
      dateStr: ds,
    });
    if (!id) return { ok: false, reason: 'insert-failed' };

    const challenge = repository.getActiveChallenge(scopeKey);
    const published = await publishLaunchMessage({
      scopeKey,
      type,
      ch: challenge,
      payload,
      expiresAt,
      sendText,
      sendImage,
      image: payload.image || null,
    });
    if (!published.ok) {
      log({ scopeKey, challengeId: id, type, channel: published.channel || null, reason: published.reason }, 'dailyChallenge launch publish failed');
      return { ok: false, reason: 'publish-failed', challenge: { id, type, challengeType: type } };
    }
    repository.markLaunchPublished(id, launchedAt, expiresAt);
    recordPublishedLaunch(challenge, payload, launchedAt);
    return { ok: true, challenge: { id, type, challengeType: type } };
  }

  /* ---------- Guess the Game ---------- */

  async function tryLlmGuessGame(recentGames = []) {
    const recentList = Array.isArray(recentGames) ? recentGames.slice(0, 40) : [];
    const recentTxt = recentList.length
      ? `\n\nNUNCA repita um jogo desta lista de recentes (normalize sem acentos/maiúsculas):\n${recentList.map((g) => `  - ${g}`).join('\n')}\n`
      : '';
    const system =
      'Voce e um curador de jogos para um desafio diário de WhatsApp em português brasileiro. ' +
      'Gere UM jogo (eletrônico, de tabuleiro, indie, retrô, AAA, cult, brasileiro ou nicho). ' +
      'REQUSITOS DE VARIEDADE:' +
      '  - Fuja dos óbvios (Minecraft, Fortnite, Call of Duty, GTA, FIFA, Free Fire) salvo raríssima exceção.' +
      '  - Varie o gênero (RPG, plataforma, puzzle, corrida, luta, simulador, estratégia, party, survival, horror, metroidvania, roguelike, visual novel).' +
      '  - Varie a plataforma (PC, console, mobile, arcade, tabletop).' +
      '  - Varie a época (anos 80, 90, 2000, 2010, 2020).' +
      '  - Inclua indies, cult, e jogos brasileiros quando possível.' +
      '  - Seja criativo: jogos incomuns, pouco conhecidos e aclamados pela crítica são BEM-VINDOS.' +
      'REGRAS TÉCNICAS:' +
      '  - O campo "game" deve conter o nome PRINCIPAL (sem ano, sem subtitulo).' +
      '  - O campo "aliases" deve listar 2-5 formas alternativas como os brasileiros chamam.' +
      '  - hint1: sutil; hint2: media; hint3: obvia.' +
      '  - NUNCA inclua o nome do jogo nas dicas.' +
      'Responda APENAS no formato JSON:' +
      ' {"game":"Nome","aliases":["a1","a2"],"hints":["h1","h2","h3"]}' + recentTxt;
    const user = 'Gere um jogo variado e criativo agora. Evite o óbvio.';
    return await tryLlmJson(system, user, 45000);
  }

  async function tryLlmRiddle() {
    const system =
      'Voce e um criador de enigmas para WhatsApp. Gere UM enigma curto e inteligente em portugues brasileiro. ' +
      'REGRAS: o campo "riddle" deve conter o enigma completo, pronto para ser enviado ao grupo. ' +
      'O campo "answers" deve conter de 1 a 3 respostas aceitas em minusculo, incluindo variacoes comuns. ' +
      'O enigma NAO pode conter a resposta literal, partes obvias da resposta, nem entregar a resposta de forma direta. ' +
      'Evite repetir enigmas muito classicos de forma identica; varie o estilo e o objeto. ' +
      'Responda APENAS no formato JSON: ' +
      '{"riddle":"O que e, o que e?...","answers":["resposta1","resposta2"]}';
    const user = 'Gere um enigma popular, claro e respondível agora.';
    return await tryLlmJson(system, user, 45000);
  }

  async function launchGuessGame(scopeKey, now) {
    const memoryLimit = cfg().dailyChallengeContentMemory?.game || 30;
    const recent = repository.getRecentContent(scopeKey, 'game', memoryLimit);
    const recentSet = new Set(recent.map((v) => normalizeAnswer(v)));

    const llmGame = await tryLlmGuessGame(recent);
    let game = null;
    if (llmGame?.game) {
      const filtered = filterGameName(llmGame.game);
      const filteredNorm = normalizeAnswer(filtered);
      /* Se o LLM retornar um jogo que já saiu recentemente, tenta uma 2a chamada
         antes de cair no fallback local — evita repetição imediata. */
      let candidate = { game: filtered, aliases: (llmGame.aliases || []).map((a) => filterGameName(a) || a).filter(Boolean), hints: Array.isArray(llmGame.hints) ? llmGame.hints.slice(0, MAX_HINTS) : [] };
      if (recentSet.has(filteredNorm)) {
        const retry = await tryLlmGuessGame(recent);
        if (retry?.game) {
          const rNorm = normalizeAnswer(filterGameName(retry.game));
          if (!recentSet.has(rNorm)) {
            candidate = {
              game: filterGameName(retry.game),
              aliases: (retry.aliases || []).map((a) => filterGameName(a) || a).filter(Boolean),
              hints: Array.isArray(retry.hints) ? retry.hints.slice(0, MAX_HINTS) : [],
            };
          }
        }
      }
      game = candidate;
    }
    if (!game || !game.game || recentSet.has(normalizeAnswer(game.game))) {
      const pick = pickNonRepeating(
        scopeKey,
        'game',
        FALLBACK_GAMES.map((g) => ({ ...g, key: g.game })),
        memoryLimit
      );
      if (!pick) return null;
      game = {
        game: pick.game,
        aliases: pick.aliases || [pick.game],
        hints: pick.hints || [],
      };
    }

    const aliases = Array.from(
      new Set([game.game, ...(game.aliases || [])].map(normalizeAnswer).filter(Boolean))
    );
    const answer = normalizeAnswer(game.game);
    const data = {
      game: game.game,
      aliases,
      hints: (game.hints || []).slice(0, MAX_HINTS),
    };

    return {
      answer,
      data,
      recordContent: () => repository.recordContent(scopeKey, 'game', answer),
      kind: 'guess_game',
      title: 'DESAFIO DO DIA — ADIVINHE O JOGO',
      header: '🎯',
      instructions: '3 dicas. Acerte o jogo!',
    };
  }

  /* ---------- Riddle ---------- */

  async function launchRiddle(scopeKey, now) {
    const memoryLimit = cfg().dailyChallengeContentMemory?.riddle || 50;
    const llmRiddle = await tryLlmRiddle();
    let riddle = null;
    if (llmRiddle?.riddle) {
      const answers = Array.isArray(llmRiddle.answers)
        ? llmRiddle.answers.map(normalizeAnswer).filter(Boolean)
        : [];
      if (answers.length > 0) {
        riddle = {
          riddle: String(llmRiddle.riddle || '').trim(),
          answers,
        };
      }
    }
    if (!riddle || !riddle.riddle) {
      const pick = pickNonRepeating(
        scopeKey,
        'riddle',
        RIDDLES.map((r, i) => ({ ...r, key: String(i) + ':' + normalizeAnswer((r.answers || [])[0] || '') })),
        memoryLimit
      );
      if (!pick) return null;
      riddle = {
        riddle: pick.riddle,
        answers: (pick.answers || []).map(normalizeAnswer).filter(Boolean),
      };
    }
    const answer = riddle.answers[0] || '';
    const data = { riddle: riddle.riddle, answers: riddle.answers };

    return {
      answer,
      data,
      recordContent: () =>
        repository.recordContent(scopeKey, 'riddle', normalizeAnswer(riddle.riddle || '')),
      kind: 'riddle',
      title: 'DESAFIO DO DIA — ENIGMA',
      header: '🧩',
      instructions: 'Resolva o enigma!',
    };
  }

  /* ---------- Pokemon ---------- */

  async function fetchPokemonSprite(id) {
    const urls = [
      `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`,
    ];
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(POKEMON_FETCH_TIMEOUT_MS),
        });
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf && buf.length > 0) return buf;
      } catch { /* tenta proxima */ }
    }
    return null;
  }

  async function fetchPokemonName(id) {
    try {
      const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${id}`, {
        signal: AbortSignal.timeout(POKEMON_FETCH_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const json = await res.json();
      return json?.name ? String(json.name) : null;
    } catch {
      return null;
    }
  }

  /**
   * Gera o SVG do fundo "explosao" estilo anime (Who's That Pokemon):
   * gradiente vermelho/laranja com um estouro de raios claros no centro.
   */
  function buildBurstSvg(width, height, spikes = 26) {
    const cx = width / 2;
    const cy = height / 2;
    const outerR = Math.max(width, height) * 0.68;
    const innerR = Math.max(width, height) * 0.2;
    const pts = [];
    for (let i = 0; i < spikes * 2; i++) {
      const angle = (Math.PI * i) / spikes - Math.PI / 2;
      const r = i % 2 === 0 ? outerR : innerR;
      pts.push(`${(cx + r * Math.cos(angle)).toFixed(1)},${(cy + r * Math.sin(angle)).toFixed(1)}`);
    }
    const points = pts.join(' ');
    return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#ff3131"/>
          <stop offset="100%" stop-color="#ff9224"/>
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#bg)"/>
      <polygon points="${points}" fill="#bfe0ff"/>
      <polygon points="${points}" fill="#ffffff" opacity="0.30"/>
    </svg>`;
  }

  /**
   * Constroi a cena completa "Quem e esse Pokemon?": fundo em explosao
   * (estilo anime) com a silhueta navy do pokemon centralizada por cima.
   *
   * IMPORTANTE (correcao do bug do quadrado azul solido):
   * a versao anterior extraia o canal alpha do sprite como imagem em
   * escala de cinza (brilho = forma) e tentava usa-la como mascara num
   * blend 'dest-in'. Esse blend so enxerga TRANSPARENCIA real (canal
   * alpha), nao brilho — como a mascara nao tinha canal alpha, o sharp
   * tratava tudo como 100% opaco e o 'dest-in' preservava o retangulo
   * inteiro, gerando um quadrado solido sem nenhuma forma.
   * Aqui extraimos o alpha binarizado como dado RAW e o anexamos
   * diretamente como o canal alpha real de uma imagem navy solida
   * (joinChannel), entao a transparencia da silhueta e verdadeira e
   * qualquer composite 'over' subsequente respeita a forma do pokemon.
   */
  async function buildPokemonSilhouetteScene(spriteBuf, sharp) {
    const CANVAS_W = 720;
    const CANVAS_H = 420;

    const meta = await sharp(spriteBuf).metadata();
    const width = Math.max(1, Number(meta?.width) || 96);
    const height = Math.max(1, Number(meta?.height) || 96);

    const alphaRaw = await sharp(spriteBuf)
      .ensureAlpha()
      .extractChannel('alpha')
      .threshold(1)
      .raw()
      .toBuffer();

    const navyRgb = await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 10, g: 14, b: 46 },
      },
    })
      .raw()
      .toBuffer();

    const untrimmed = await sharp(navyRgb, { raw: { width, height, channels: 3 } })
      .joinChannel(alphaRaw, { raw: { width, height, channels: 1 } })
      .png()
      .toBuffer();

    // Corta a margem transparente ao redor do pokemon: os sprites da
    // PokeAPI ficam alinhados numa "linha de chao" comum dentro do frame
    // 96x96, entao a forma visivel raramente esta centralizada no frame
    // (ex.: Pikachu ocupa so ~39x45 dos 96x96). Sem o trim, o que fica
    // centralizado no fundo e o frame inteiro (com a folga), nao o
    // pokemon em si — por isso ele aparecia pequeno e deslocado.
    const trimmed = await sharp(untrimmed).trim().toBuffer();

    const silhouetteSize = Math.round(CANVAS_H * 0.85);
    const silhouette = await sharp(trimmed)
      .resize(silhouetteSize, silhouetteSize, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();

    const burstSvg = buildBurstSvg(CANVAS_W, CANVAS_H);
    const burstBuf = await sharp(Buffer.from(burstSvg)).png().toBuffer();

    return sharp(burstBuf)
      .composite([{ input: silhouette, gravity: 'center' }])
      .png()
      .toBuffer();
  }

  async function launchPokemon(scopeKey, now, sendImage, sharp) {
    const memoryLimit = cfg().dailyChallengeContentMemory?.pokemon || 30;
    const maxGen = Number(cfg().dailyChallengePokemonMaxGen) || 386;
    const recent = repository.getRecentContent(scopeKey, 'pokemon', memoryLimit);
    const recentSet = new Set(recent.map((v) => normalizeAnswer(v)));

    let id = null;
    let name = null;
    let buf = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = randomInt(1, Math.max(1, maxGen), random);
      const cachedName = null;
      if (recentSet.has(normalizeAnswer(String(candidate)))) continue;
      const sprite = await fetchPokemonSprite(candidate);
      if (!sprite) continue;
      const fetchedName = await fetchPokemonName(candidate);
      if (fetchedName && recentSet.has(normalizeAnswer(fetchedName))) continue;
      id = candidate;
      name = fetchedName || `pokemon-${candidate}`;
      buf = sprite;
      break;
    }

    if (!id || !buf) return null;

    let image = buf;
    if (sharp && typeof sharp === 'function') {
      try {
        image = await buildPokemonSilhouetteScene(buf, sharp);
      } catch (err) {
        log({ err: err?.message }, 'dailyChallenge sharp overlay fail');
        image = buf;
      }
    }

    const answer = normalizeAnswer(name);
    const data = { pokemonId: id, name, hints: [] };

    return {
      answer,
      data,
      image,
      recordContent: () => repository.recordContent(scopeKey, 'pokemon', answer),
      kind: 'pokemon',
      title: 'DESAFIO DO DIA — QUEM E ESSE POKEMON?',
      header: '🎮',
      instructions: 'Adivinhe o nome do Pokemon!',
    };
  }

  function payloadFromChallenge(challenge, image = null) {
    const data = challenge?.challengeData || {};
    const type = challenge?.challengeType;
    if (type === 'guess_game') return { data, image, title: 'DESAFIO DO DIA — ADIVINHE O JOGO' };
    if (type === 'riddle') return { data, image, title: 'DESAFIO DO DIA — ENIGMA' };
    return { data, image, title: 'DESAFIO DO DIA — QUEM E ESSE POKEMON?' };
  }

  function recordPublishedLaunch(challenge, payload, launchedAt) {
    try {
      payload.recordContent?.();
      if (challenge?.challengeType === 'guess_game' && challenge.id && payload?.data?.hints?.[0]) {
        repository.recordHint(challenge.id, 0, launchedAt, String(payload.data.hints[0]));
      }
    } catch (err) {
      log({ err: err?.message }, 'dailyChallenge record published launch fail');
    }
  }

  async function retryPendingLaunch({ scopeKey, challenge, now, sendText, sendImage, sharp }) {
    let image = null;
    if (challenge.challengeType === 'pokemon') {
      const sprite = await fetchPokemonSprite(challenge.challengeData?.pokemonId);
      if (sprite) {
        image = sprite;
        if (typeof sharp === 'function') {
          try { image = await buildPokemonSilhouetteScene(sprite, sharp); } catch { image = sprite; }
        }
      }
    }
    const launchedAt = Number(now) || Date.now();
    const expiresAt = launchedAt + (Number(cfg().dailyChallengeDurationMs) || 4 * 3600_000);
    const payload = payloadFromChallenge(challenge, image);
    const published = await publishLaunchMessage({ scopeKey, type: challenge.challengeType, ch: { ...challenge, launchedAt }, payload, expiresAt, sendText, sendImage, image });
    if (!published.ok) {
      log({ scopeKey, challengeId: challenge.id, type: challenge.challengeType, channel: published.channel || null, attempt: 'retry', reason: published.reason }, 'dailyChallenge pending launch publish failed');
      return { ok: false, reason: 'publish-failed', challenge: { id: challenge.id, type: challenge.challengeType, challengeType: challenge.challengeType } };
    }
    const marked = repository.markLaunchPublished(challenge.id, launchedAt, expiresAt);
    if (!marked.changes) return { ok: false, reason: 'publish-race' };
    recordPublishedLaunch(challenge, payload, launchedAt);
    return { ok: true, challenge: { id: challenge.id, type: challenge.challengeType, challengeType: challenge.challengeType } };
  }

  /* ---------- mensagem de lancamento ---------- */

  async function publishLaunchMessage({
    scopeKey,
    type,
    ch,
    payload,
    expiresAt,
    sendText,
    sendImage,
    image,
  }) {
    if (!sendText && (!sendImage || !image)) return { ok: false, reason: 'no-transport' };
    const durationMin = Math.max(1, Math.round(((expiresAt || 0) - (ch?.launchedAt || 0)) / 60000));
    let body = '';
    if (type === 'guess_game') {
      const firstHint = payload?.data?.hints?.[0];
      const hintBlock = firstHint
        ? `💡 *Dica 1 (de 3):* ${firstHint}\n\n` +
          `Próximas dicas em /dica (1 a cada 10 min).\n\n`
        : `Use /dica para revelar as 3 dicas progressivamente (1 a cada 10 min).\n\n`;
      body =
        `🎯 *${payload.title}*\n\n` +
        hintBlock +
        `⏳ *Tempo:* ${durationMin} min\n🎁 *Recompensa:* surpresa!\n\n` +
        `💬 *Responda:* /responder <palpite>\n💡 *Dica:* /dica\n🔄 *Pular (3 votos):* /trocar desafio`;
    } else if (type === 'riddle') {
      body =
        `🧩 *${payload.title}*\n\n` +
        `${payload.data?.riddle || ''}\n\n` +
        `⏳ *Tempo:* ${durationMin} min\n🎁 *Recompensa:* surpresa!\n\n` +
        `💬 *Responda:* /responder <palpite>\n💡 *Dica:* /dica\n🔄 *Pular (3 votos):* /trocar desafio`;
    } else {
      const caption =
        `🎮 *${payload.title}*\n\n` +
        `⏳ *Tempo:* ${durationMin} min\n🎁 *Recompensa:* surpresa!\n\n` +
        `💬 *Responda:* /responder <nome>\n💡 *Dica:* /dica\n🔄 *Pular (3 votos):* /trocar desafio`;
      if (sendImage && image) {
        try {
          const result = await sendImage(scopeKey, image, { caption });
          if (!result?.skipped) return { ok: true, channel: 'image' };
          log({ scopeKey, type, channel: 'image', reason: result.reason }, 'dailyChallenge sendImage skipped');
        } catch (err) {
          log({ scopeKey, type, channel: 'image', reason: err?.message }, 'dailyChallenge sendImage fail, caindo pra texto');
        }
      }
      body = caption;
    }
    if (!sendText) return { ok: false, reason: 'no-text-transport' };
    try {
      const result = await sendText(scopeKey, body);
      if (!result?.skipped) return { ok: true, channel: 'text' };
      log({ scopeKey, type, channel: 'text', reason: result.reason }, 'dailyChallenge sendText skipped');
      return { ok: false, reason: result.reason || 'text-skipped', channel: 'text' };
    } catch (err) {
      log({ scopeKey, type, channel: 'text', reason: err?.message }, 'dailyChallenge sendText fail');
      return { ok: false, reason: err?.message || 'text-failed', channel: 'text' };
    }
  }

  /* ---------- expiracao ---------- */

  /**
   * Processa desafios expirados — anuncia resposta + encerra ciclo.
   */
  async function processExpired({ scopeKey, now, sendText, sendImage, sharp }) {
    if (!scopeKey) return { ok: false, reason: 'no-scope' };
    const challenge = repository.getActiveChallenge(scopeKey);
    if (!challenge) return { ok: false, reason: 'no-active' };
    if (challenge.launchPublishedAt === 0) return { ok: false, reason: 'pending-publication' };
    if (Number(challenge.expiresAt || 0) > Number(now || Date.now())) {
      return { ok: false, reason: 'not-yet' };
    }
    repository.expireChallenge(challenge.id, now);
    try {
      await sendText?.(
        scopeKey,
        `⏰ *DESAFIO DO DIA — ENCERRADO*\n\n` +
          `Ninguem conseguiu resolver hoje.\n\n` +
          `A resposta correta era: *${displayAnswer(challenge)}*\n\n` +
          `Amanha tem mais! 🎯`
      );
    } catch (err) {
      log({ err: err?.message }, 'dailyChallenge processExpired send fail');
    }
    /* Pokemon: revela a imagem colorida ao expirar. */
    if (challenge.challengeType === 'pokemon') {
      await revealPokemonImage(challenge, sendImage, sharp);
    }
    return { ok: true, announced: true };
  }

  function displayAnswer(challenge) {
    const t = challenge?.challengeType;
    if (t === 'guess_game') {
      return challenge?.challengeData?.game || challenge?.answer || '';
    }
    if (t === 'riddle') {
      const answers = challenge?.challengeData?.answers || [];
      return answers[0] || challenge?.answer || '';
    }
    if (t === 'pokemon') {
      return challenge?.challengeData?.name || challenge?.answer || '';
    }
    return challenge?.answer || '';
  }

  /* ---------- resposta (/responder) ---------- */

  async function handleAnswer({
    scopeKey,
    userJid,
    guess,
    now,
    getContactDisplayName: gcdn,
    sendImage,
    sharp,
  }) {
    const c = cfg();
    const ts = Number(now) || Date.now();
    const challenge = repository.getActiveChallenge(scopeKey);
    if (!challenge) {
      return { ok: false, message: 'Nenhum desafio ativo agora.' };
    }
    if (challenge.status !== 'active') {
      return { ok: false, message: 'O desafio ja foi encerrado! Alguem ja acertou.' };
    }

    if (ts > challenge.expiresAt) {
      return { ok: false, message: 'O desafio ja expirou.' };
    }

    /* anti-spam: cooldown individual de 5s */
    const lastAttempt = repository.getLastAttempt(challenge.id, userJid);
    const cooldownMs = Number(c.dailyChallengeAttemptCooldownMs) || 5000;
    if (lastAttempt && ts - lastAttempt < cooldownMs) {
      const remaining = cooldownMs - (ts - lastAttempt);
      return {
        ok: false,
        message: `Calma! Aguarde ${Math.ceil(remaining / 1000)}s entre tentativas.`,
      };
    }

    /* anti-spam: limite de 30 tentativas por usuario */
    const maxAttempts = Number(c.dailyChallengeMaxAttemptsPerUser) || 30;
    const usedAttempts = repository.countUserAttempts(challenge.id, userJid);
    if (usedAttempts >= maxAttempts) {
      return {
        ok: false,
        message: `Voce ja usou suas ${maxAttempts} tentativas neste desafio.`,
      };
    }

    const normGuess = normalizeAnswer(guess);
    const correct = isCorrectGuess(challenge, normGuess);

    repository.addAttempt({
      challengeId: challenge.id,
      userJid,
      guess: String(guess || ''),
      correct: correct ? 1 : 0,
      now: ts,
    });

    if (!correct) {
      return { ok: false, message: buildWrongFeedback(challenge, normGuess) };
    }

    /* acertou — apenas primeiro ganha */
    const solveTimeSec = Math.max(0, Math.round((ts - challenge.launchedAt) / 1000));
    const rewardType = pickRewardType();
    const mult = computeSpeedMultiplier(solveTimeSec, c.dailyChallengeSpeedBonus);
    const reward = applyReward(userJid, scopeKey, rewardType, mult);
    repository.completeChallenge(
      challenge.id,
      userJid,
      reward.type,
      reward.value || 0,
      solveTimeSec,
      ts
    );
    const name = (gcdn || getContactDisplayName)(userJid) || 'alguem';

    /* Pokemon: revela a imagem colorida ao acertar. */
    if (challenge.challengeType === 'pokemon') {
      await revealPokemonImage(challenge, sendImage, sharp);
    }

    return {
      ok: true,
      message:
        `🏆 *PARABENS, ${name}!*\n\n` +
          `Voce acertou o desafio em ${formatSolveTime(solveTimeSec)}!\n` +
          `${REWARD_EMOJI[reward.type] || '🎁'} Recompensa: ${reward.label}\n\n` +
          `📊 Voce foi o mais rapido do dia!`,
    };
  }

  function isCorrectGuess(challenge, normGuess) {
    if (!normGuess) return false;
    if (normalizeAnswer(challenge.answer) === normGuess) return true;
    const data = challenge.challengeData || {};
    if (Array.isArray(data.aliases)) {
      for (const a of data.aliases) {
        if (normalizeAnswer(a) === normGuess) return true;
      }
    }
    if (Array.isArray(data.answers)) {
      for (const a of data.answers) {
        if (normalizeAnswer(a) === normGuess) return true;
      }
    }
    return false;
  }

  function buildWrongFeedback(challenge, normGuess) {
    const target = normalizeAnswer(displayAnswer(challenge));
    const dist = levenshteinDistance(normGuess, target);
    if (dist > 0 && dist <= 2) {
      return '🔥 Voce passou muito perto! Tente novamente.';
    }
    if (dist > 2 && dist <= 4) {
      return '❄️ Frio... tente de novo.';
    }
    return '❌ Resposta incorreta. Tente novamente!';
  }

  /* ---------- dica (/dica) ---------- */

  async function handleHint({ scopeKey, now, sendImage, sharp }) {
    const c = cfg();
    const ts = Number(now) || Date.now();
    const challenge = repository.getActiveChallenge(scopeKey);
    if (!challenge) {
      return { ok: false, message: 'Nenhum desafio ativo agora.' };
    }
    if (challenge.status !== 'active') {
      return { ok: false, message: 'O desafio ja foi encerrado.' };
    }

    const hintsUsed = repository.countHintsUsed(challenge.id);
    if (hintsUsed >= MAX_HINTS) {
      return { ok: false, message: 'Todas as dicas ja foram liberadas!' };
    }

    /* cooldown — 1a dica imediata, demais respeitam 10 min */
    if (hintsUsed > 0) {
      const cooldownMs = Number(c.dailyChallengeHintCooldownMs) || HINT_COOLDOWN_DEFAULT_MS;
      const lastHintTime = repository.getLastHintTime(challenge.id);
      if (lastHintTime && ts - lastHintTime < cooldownMs) {
        const remaining = cooldownMs - (ts - lastHintTime);
        return {
          ok: false,
          message: `Proxima dica em ${formatDuration(remaining)}. Volte mais tarde!`,
        };
      }
    }

    const hintIndex = repository.getLastHintIndex(challenge.id) + 1;

    const text = await buildHintMessage(challenge, hintIndex);

    repository.recordHint(challenge.id, hintIndex, ts, text);

    /* Pokemon: na ULTIMA dica revelamos a imagem colorida (sem escurecer). */
    const isPokemonLastHint =
      challenge.challengeType === 'pokemon' && hintIndex === MAX_HINTS - 1;
    if (isPokemonLastHint) {
      const revealed = await revealPokemonImage(challenge, sendImage, sharp);
      if (revealed) {
        return {
          ok: true,
          message: `💡 *Dica ${hintIndex + 1}*\n\n${text}\n\nRevelacao a seguir! Pokemon mostrado acima.`,
          sentImage: true,
        };
      }
    }

    return { ok: true, message: `💡 *Dica ${hintIndex + 1}*\n\n${text}` };
  }

  /**
   * Baixa o sprite oficial (colorido) do pokemon do desafio e envia como imagem.
   * Usado na revelacao da 3a dica, no acerto e na expiracao.
   * Retorna true quando conseguiu enviar a imagem.
   */
  async function revealPokemonImage(challenge, sendImage, /* sharp */) {
    if (typeof sendImage !== 'function') return false;
    const id = challenge?.challengeData?.pokemonId;
    if (!id) return false;
    try {
      const sprite = await fetchPokemonSprite(id);
      if (!sprite) return false;
      await sendImage(challenge.scopeKey, sprite, { caption: '' });
      return true;
    } catch (err) {
      log({ err: err?.message }, 'dailyChallenge reveal pokemon image fail');
      return false;
    }
  }

  async function buildHintMessage(challenge, hintIndex) {
    const type = challenge.challengeType;
    const data = challenge.challengeData || {};
    if (type === 'guess_game') {
      const hints = Array.isArray(data.hints) ? data.hints : [];
      if (hints[hintIndex]) return String(hints[hintIndex]);
      return 'Sem mais dicas pre-definidas para este jogo.';
    }
    if (type === 'riddle') {
      const answer = (data.answers || [])[0] || challenge.answer || '';
      const prior = repository.getHints(challenge.id);
      const system =
        'Voce e o mestre de um jogo de enigmas no WhatsApp. ' +
        'Sua tarefa e dar UMA dica sobre a resposta correta do enigma.\n\n' +
        'REGRAS OBRIGATORIAS:\n' +
        '- NUNCA diga, revele, soletre ou parafraseie diretamente a resposta.\n' +
        '- ABSOLUTAMENTE PROIBIDO usar a palavra da resposta (ou variacoes/derivacoes) em qualquer parte da dica, mesmo dentro de metáforas ou analogias.\n' +
        '- PROIBIDO usar sinonimo obvio da resposta (ex.: resposta "nuvem" -> proibido dizer "nuvem","coberto","fumaça no céu","vapor"; resposta "espada" -> proibido "cortante","lâmina","aço").\n' +
        '- PROIBIDO copiar/reusar palavras-chave do propio enigma — inverta a perspectiva (fale de habit, contexto, origem, categoria ampla) em vez de reformular a mesma metáfora.\n' +
        '- Nao de dicas obvias que entreguem a resposta.\n' +
        '- Nao repita nenhuma dica ja dada (liste-as abaixo e evite conteudo similar).\n' +
        '- A dica deve ser SUTIL, curta (1-2 frases) e progressiva: quanto maior o numero da dica, mais especifica, mas nunca obvia.\n' +
        '- Responda apenas com a dica, sem prefixos como "Dica:" ou "Resposta:".\n' +
        '- Responda em portugues brasileiro.\n' +
        '- ANTES de responder, verifique mentalmente: minha dica contém a palavra resposta ou um sinonimo obvio? Se sim, reescreva.';
      const user =
        `Enigma: ${data.riddle || ''}\n` +
        `Resposta correta (para voce saber, NUNCA revele): ${answer}\n` +
        `Numero desta dica: ${hintIndex + 1}\n` +
        (prior.length
          ? `Dicas JA dadas (NAO repita nem use conteudo similar):\n${prior.map((h) => `  - ${h.text}`).join('\n')}\n`
          : 'Nenhuma dica dada ainda.\n') +
        `De a ${hintIndex + 1}a dica:`;
      const llmHint = await llmText(system, user);
      if (llmHint) return llmHint;
      return 'Pense no que o enigma descreve — algo do cotidiano.';
    }
    if (type === 'pokemon') {
      const answer = data.name || challenge.answer || '';
      const prior = repository.getHints(challenge.id);
      const system =
        'Voce e o mestre de um jogo "Quem e esse Pokemon?" no WhatsApp. ' +
        'Sua tarefa e dar UMA dica sobre o Pokemon sem dizer o nome dele.\n\n' +
        'REGRAS OBRIGATORIAS:\n' +
        '- NUNCA diga, soletre ou revele o nome do Pokemon.\n' +
        '- ABSOLUTAMENTE PROIBIDO usar o nome do Pokemon (ou derivacoes/silabas recognizaveis) em qualquer parte da dica, mesmo dentro de metáforas.\n' +
        '- PROIBIDO usar sinonimo obvio ou descricao literal que entregue a resposta (ex.: se nome e "pikachu", proibido dizer "pikachu","pika","chu","rato eletrico amarelo", "mascara amarela").\n' +
        '- Pode mencionar tipo, habitat, cor, geracao ou caracteristica marcante — mas com SUTILEZA, nunca direto.\n' +
        '- Nao repita nenhuma dica ja dada (liste-as abaixo e evite conteudo similar).\n' +
        '- A dica deve ser curta (1-2 frases) e progressiva: quanto maior o numero da dica, mais especifica, mas nunca obvia.\n' +
        '- Responda apenas com a dica, sem prefixos como "Dica:" ou "Pokemon:".\n' +
        '- Responda em portugues brasileiro.\n' +
        '- ANTES de responder, verifique mentalmente: minha dica contém o nome ou um sinonimo obvio? Se sim, reescreva.';
      const user =
        `Pokemon sorteado (para voce saber, NUNCA revele o nome): ${answer}\n` +
        `Numero desta dica: ${hintIndex + 1}\n` +
        (prior.length
          ? `Dicas JA dadas (NAO repita nem use conteudo similar):\n${prior.map((h) => `  - ${h.text}`).join('\n')}\n`
          : 'Nenhuma dica dada ainda.\n') +
        `De a ${hintIndex + 1}a dica:`;
      const llmHint = await llmText(system, user);
      if (llmHint) return llmHint;
      return 'Observe a silhueta e as cores.';
    }
    return 'Sem dica disponivel para este desafio.';
  }

  /* ---------- skip (/trocar desafio) ---------- */

  async function handleSkipVote({ scopeKey, userJid, now, sendText, sendImage, sharp }) {
    const c = cfg();
    const ts = Number(now) || Date.now();
    const challenge = repository.getActiveChallenge(scopeKey);
    if (!challenge) {
      return { ok: false, message: 'Nenhum desafio ativo agora.' };
    }
    if (challenge.status !== 'active') {
      return { ok: false, message: 'O desafio ja foi encerrado.' };
    }

    const inserted = repository.addSkipVote(challenge.id, userJid, ts);
    if (!inserted) {
      const votes = repository.countSkipVotes(challenge.id);
      const required = Number(c.dailyChallengeSkipVotesRequired) || 3;
      return { ok: false, message: `Voce ja votou. Votos: ${votes}/${required}.` };
    }

    const votes = repository.countSkipVotes(challenge.id);
    const required = Number(c.dailyChallengeSkipVotesRequired) || 3;
    if (votes < required) {
      return {
        ok: false,
        message: `🔄 Voto registrado! Faltam ${required - votes} voto(s) para pular.`,
      };
    }

    /* atingiu votos — pula */
    repository.skipChallenge(challenge.id, ts);
    try {
      await sendText?.(
        scopeKey,
        `🔄 *DESAFIO PULADO!*\n\n` +
          `${required} pessoas votaram para pular.\n` +
          `A resposta era: *${displayAnswer(challenge)}*\n\n` +
          `Lancando novo desafio...`
      );
    } catch (err) {
      log({ err: err?.message }, 'dailyChallenge skip announce fail');
    }

    const newType = pickChallengeType(challenge.challengeType);
    const launched = await launchChallenge({
      scopeKey,
      type: newType,
      now: ts,
      sendText,
      sendImage,
      sharp,
    });
    if (launched?.ok) {
      return { ok: true, message: 'Novo desafio lancado!', skipped: true };
    }
    return { ok: false, message: 'Nao foi possivel lancar novo desafio agora.' };
  }

  /* ---------- status / stats ---------- */

  function getStatus(scopeKey) {
    const challenge = repository.getActiveChallenge(scopeKey);
    if (!challenge) return { active: false, challenge: null };
    return { active: true, challenge };
  }

  function getHintCooldownRemaining(challengeId, now) {
    const c = cfg();
    const ts = Number(now) || Date.now();
    const hintsUsed = repository.countHintsUsed(challengeId);
    if (hintsUsed === 0) return 0;
    if (hintsUsed >= MAX_HINTS) return 0;
    const cooldownMs = Number(c.dailyChallengeHintCooldownMs) || HINT_COOLDOWN_DEFAULT_MS;
    const lastTime = repository.getLastHintTime(challengeId);
    if (!lastTime) return 0;
    return Math.max(0, cooldownMs - (ts - lastTime));
  }

  function getTodayStats(scopeKey, now = Date.now()) {
    const c = cfg();
    if (c.dailyChallengeNewsEnabled === false) return null;
    const ds = dateStrFor(now);
    const challenge = repository.getTodayChallenge(scopeKey, ds);
    if (!challenge) return null;
    const stats = repository.getStats(scopeKey);
    const fastest = repository.getFastestLeaderboard(scopeKey, 5);
    const wins = repository.getWinsLeaderboard(scopeKey, 5);
    return {
      date: ds,
      type: challenge.challengeType,
      status: challenge.status,
      solved: challenge.status === 'completed',
      winnerJid: challenge.completedByJid || '',
      winnerName: challenge.completedByJid
        ? getContactDisplayName(challenge.completedByJid)
        : '',
      solveTimeSec: challenge.solveTimeSec || 0,
      answer: displayAnswer(challenge),
      totalSolved: stats.solved || 0,
      fastestSec: stats.fastestSec || 0,
      fastest,
      wins,
    };
  }

  /* ---------- hook de conquistas (vazio por enquanto) ---------- */
  function _fireAchievementHooks() { /* futuro: achievementService.unlock(...) */ }

  return {
    tryLaunchToday,
    processExpired,
    pickChallengeType,
    launchChallenge,
    handleAnswer,
    handleHint,
    handleSkipVote,
    getStatus,
    getHintCooldownRemaining,
    scheduleToday,
    getTodayStats,
  };
}
