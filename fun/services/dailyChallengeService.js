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

const CHALLENGE_TYPES = ['guess_game', 'riddle', 'pokemon'];
const MAX_HINTS = 3;
const HINT_COOLDOWN_DEFAULT_MS = 10 * 60 * 1000;

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
  const generateZen = deps.generateZen;
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
    const baseUrl = c.zenBaseUrl || 'http://127.0.0.1:3300';
    const model = c.zenModel || 'gpt-oss:latest';
    const apiKey = c.zenApiKey || '';
    if (typeof generateZen !== 'function' || c.dailyChallengeEnabled === false) return null;
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
    try {
      const raw = await generateZen({
        baseUrl: c.zenBaseUrl || 'http://127.0.0.1:3300',
        model: c.zenModel || 'glm_5_2',
        system,
        prompt: userPrompt,
        timeoutMs,
        maxTokens: 180,
        temperature: 0.8,
        apiKey: c.zenApiKey || '',
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
    if (existing) return { ok: false, reason: 'exists' };

    const minutesNow = minutesOfDay(now);
    if (minutesNow < sched.targetMinute) return { ok: false, reason: 'not-window' };

    const result = await launchChallenge({
      scopeKey,
      type: pickChallengeType(null),
      now,
      sendText,
      sendImage,
      sharp,
    });
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
      payload = launchRiddle(scopeKey, now);
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

    if (payload.recordContent) {
      try {
        payload.recordContent();
      } catch { /* noop */ }
    }

    const challenge = repository.getActiveChallenge(scopeKey);
    await publishLaunchMessage({
      scopeKey,
      type,
      ch: challenge,
      payload,
      expiresAt,
      sendText,
      sendImage,
      image: payload.image || null,
    });

    return { ok: true, challenge: { id, type, challengeType: type } };
  }

  /* ---------- Guess the Game ---------- */

  async function tryLlmGuessGame() {
    const system =
      'Voce e um assistente de jogos. Gere UM jogo (eletronico ou de tabuleiro) ' +
      'conhecido e 3 dicas sobre ele em portugues brasileiro. ' +
      'REGRAS: o campo "game" deve conter o nome PRINCIPAL (sem ano, sem subtitulo). ' +
      'O campo "aliases" deve listar 2-5 formas alternativas como os brasileiros chamam. ' +
      'hint1: sutil; hint2: media; hint3: obvia. NUNCA inclua o nome do jogo nas dicas. ' +
      'Responda APENAS no formato JSON: ' +
      '{"game":"Nome","aliases":["a1","a2"],"hints":["h1","h2","h3"]}';
    const user = 'Gere um jogo popular agora.';
    return await tryLlmJson(system, user, 45000);
  }

  async function launchGuessGame(scopeKey, now) {
    const memoryLimit = cfg().dailyChallengeContentMemory?.game || 30;
    const llmGame = await tryLlmGuessGame();
    let game = null;
    if (llmGame?.game) {
      const filtered = filterGameName(llmGame.game);
      game = {
        game: filtered,
        aliases: (llmGame.aliases || []).map((a) => filterGameName(a) || a).filter(Boolean),
        hints: Array.isArray(llmGame.hints) ? llmGame.hints.slice(0, MAX_HINTS) : [],
      };
    }
    if (!game || !game.game) {
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

  function launchRiddle(scopeKey, now) {
    const memoryLimit = cfg().dailyChallengeContentMemory?.riddle || 50;
    const pick = pickNonRepeating(
      scopeKey,
      'riddle',
      RIDDLES.map((r, i) => ({ ...r, key: String(i) + ':' + normalizeAnswer((r.answers || [])[0] || '') })),
      memoryLimit
    );
    if (!pick) return null;
    const answers = (pick.answers || []).map(normalizeAnswer).filter(Boolean);
    const answer = answers[0] || '';
    const data = { riddle: pick.riddle, answers };

    return {
      answer,
      data,
      recordContent: () =>
        repository.recordContent(scopeKey, 'riddle', normalizeAnswer(pick.riddle || '')),
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
        const res = await fetch(url);
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf && buf.length > 0) return buf;
      } catch { /* tenta proxima */ }
    }
    return null;
  }

  async function fetchPokemonName(id) {
    try {
      const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${id}`);
      if (!res.ok) return null;
      const json = await res.json();
      return json?.name ? String(json.name) : null;
    } catch {
      return null;
    }
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
        const blackOverlay = Buffer.from(
          '<svg width="200" height="200"><rect width="200" height="200" fill="black" opacity="0.6"/></svg>'
        );
        image = await sharp(buf)
          .composite([{ input: blackOverlay, blend: 'over' }])
          .blur(2)
          .png()
          .toBuffer();
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
    if (!sendText && (!sendImage || !image)) return;
    const durationMin = Math.max(1, Math.round(((expiresAt || 0) - (ch?.launchedAt || 0)) / 60000));
    let body = '';
    if (type === 'guess_game') {
      const hints = (payload.data?.hints || []).slice(0, MAX_HINTS);
      const hintLines = hints
        .map((h, i) => `  ${i + 1}. ${h}`)
        .join('\n');
      body =
        `🎯 *${payload.title}*\n\n` +
        `Aqui estao as dicas:\n${hintLines || '  (sem dicas)'}\n\n` +
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
          await sendImage(scopeKey, image, { caption });
          return;
        } catch (err) {
          log({ err: err?.message }, 'dailyChallenge sendImage fail, caindo pra texto');
        }
      }
      body = caption;
    }
    if (sendText) {
      try {
        await sendText(scopeKey, body);
      } catch (err) {
        log({ err: err?.message }, 'dailyChallenge sendText fail');
      }
    }
  }

  /* ---------- expiracao ---------- */

  /**
   * Processa desafios expirados — anuncia resposta + encerra ciclo.
   */
  async function processExpired({ scopeKey, now, sendText }) {
    if (!scopeKey) return { ok: false, reason: 'no-scope' };
    const challenge = repository.getActiveChallenge(scopeKey);
    if (!challenge) return { ok: false, reason: 'no-active' };
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

  async function handleAnswer({ scopeKey, userJid, guess, now, getContactDisplayName: gcdn }) {
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

  async function handleHint({ scopeKey, now }) {
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
    repository.recordHint(challenge.id, hintIndex, ts);

    const text = await buildHintMessage(challenge, hintIndex);
    return { ok: true, message: `💡 *Dica ${hintIndex + 1}*\n\n${text}` };
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
      const llmHint = await llmText(
        'Voce esta ajudando em um jogo de enigmas. De uma dica SUTIL sobre a resposta ' +
          'do enigma, sem nunca dar a resposta diretamente. A dica deve ser curta (1-2 frases).',
        `Enigma: ${data.riddle || ''}`
      );
      if (llmHint) return llmHint;
      return 'Pense no que o enigma descreve — algo do cotidiano.';
    }
    if (type === 'pokemon') {
      const llmHint = await llmText(
        'Voce esta ajudando em um jogo "Quem e esse Pokemon?". De uma dica sobre o Pokemon ' +
          'sem dizer o nome dele. Pode mencionar tipo, habitat, cor ou caracteristica marcante.',
        `Pokemon: ${data.name || 'desconhecido'}`
      );
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
