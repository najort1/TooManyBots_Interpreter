/**
 * Polícia dinâmica do módulo Fun.
 *
 * Heat (existente) = atenção imediata (curto prazo).
 * Wanted = reputação criminal persistente (longo prazo).
 * Suspicion Score = combinação ponderada usada pela IA policial.
 *
 * Weights (Suspicion):
 *   40% Heat atual
 *   30% crimes nos últimos 7 dias
 *   20% riqueza *only if* já há atividade criminal
 *   10% eventos policiais / falhas recentes
 */

import { getDb } from '../../db/context.js';

const ANALYTICS_SCHEMA = 'analytics';

/** Decay de Wanted: −1 ponto a cada 12h (muito mais lento que Heat). */
export const WANTED_DECAY_MS = 12 * 60 * 60_000;

/** Thresholds de pontos → nível 0–5. */
export const WANTED_LEVEL_THRESHOLDS = Object.freeze([0, 8, 20, 40, 70, 110]);

export const POLICE_IMMUNITY_EFFECT = 'police_immunity';
export const POLICE_IMMUNITY_DURATION_MS = 3 * 24 * 60 * 60_000;
export const POLICE_IMMUNITY_MAX_USES = 20;
export const POLICE_IMMUNITY_WEEK_MS = 7 * 24 * 60 * 60_000;

const KEY_WANTED = 'wanted_points';
const KEY_WANTED_DECAY = 'wanted_decay_at';
const KEY_LAST_POLICE = 'last_police_event';
const KEY_IMMUNITY_WEEK = 'crime_immunity_pass_week';
const GLOBAL_JID = '__shop_global__';
const GLOBAL_SCOPE = '__global__';

function clamp01(n) {
  const x = Number(n) || 0;
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x;
}

/**
 * Converte pontos de Wanted em nível 0–5.
 * @param {number} points
 * @returns {number}
 */
export function wantedLevelFromPoints(points) {
  const p = Math.max(0, Math.floor(Number(points) || 0));
  let level = 0;
  for (let i = WANTED_LEVEL_THRESHOLDS.length - 1; i >= 0; i -= 1) {
    if (p >= WANTED_LEVEL_THRESHOLDS[i]) {
      level = i;
      break;
    }
  }
  return Math.min(5, level);
}

/**
 * Suspicion Score 0..1.
 * Riqueza só pesa se já houver perfil criminal (heat/crimes/wanted) —
 * rico honesto não vira prioridade máxima só por ter coins.
 *
 * @param {{ heat?: number, crimes7d?: number, wealth?: number, reportsScore?: number, wantedLevel?: number }} input
 */
export function computeSuspicionScore({
  heat = 0,
  crimes7d = 0,
  wealth = 0,
  reportsScore = 0,
  wantedLevel = 0,
} = {}) {
  // Normalizações com teto suave
  const heatN = clamp01((Number(heat) || 0) / 10);
  const crimesN = clamp01((Number(crimes7d) || 0) / 20);
  const wealthN = clamp01((Number(wealth) || 0) / 5000);
  const reportsN = clamp01(Number(reportsScore) || 0);
  const wantedN = clamp01((Number(wantedLevel) || 0) / 5);

  // Atividade criminal “liga” o peso de riqueza (honest rich ≈ safe)
  const criminalSignal = clamp01(heatN * 0.5 + crimesN * 0.7 + wantedN * 0.6 + reportsN * 0.4);
  const wealthWeighted = wealthN * criminalSignal;

  // 40% heat · 30% crimes7d · 20% wealth(gated) · 10% reports
  const score =
    heatN * 0.4 + crimesN * 0.3 + wealthWeighted * 0.2 + reportsN * 0.1;

  return Math.min(1, Math.max(0, Number(score.toFixed(4))));
}

/**
 * @param {{ getDatabase?: Function, repository?: object, effectsRepository?: object, chaosEventService?: object, random?: Function }} deps
 */
export function createPoliceService({
  getDatabase = getDb,
  repository = null,
  effectsRepository = null,
  chaosEventService = null,
  random = Math.random,
} = {}) {
  function cdGet(userJid, scopeKey, game) {
    try {
      const row = getDatabase()
        .prepare(
          `SELECT last_at FROM ${ANALYTICS_SCHEMA}.fun_casino_cooldowns
           WHERE user_jid = ? AND scope_key = ? AND game = ?`
        )
        .get(String(userJid || ''), String(scopeKey || ''), String(game || ''));
      return Number(row?.last_at) || 0;
    } catch {
      return 0;
    }
  }

  function cdSet(userJid, scopeKey, game, value) {
    try {
      getDatabase()
        .prepare(
          `INSERT INTO ${ANALYTICS_SCHEMA}.fun_casino_cooldowns (user_jid, scope_key, game, last_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(user_jid, scope_key, game) DO UPDATE SET last_at = excluded.last_at`
        )
        .run(
          String(userJid || ''),
          String(scopeKey || ''),
          String(game || ''),
          Math.max(0, Math.floor(Number(value) || 0))
        );
    } catch {
      /* ignore */
    }
  }

  /**
   * Conta crimes (sucesso + falha) nos últimos 7 dias via ledger.
   */
  function countCrimes7d(userJid, scopeKey, now = Date.now()) {
    const since = Number(now) - 7 * 24 * 60 * 60_000;
    try {
      const row = getDatabase()
        .prepare(
          `SELECT COUNT(*) AS cnt FROM ${ANALYTICS_SCHEMA}.fun_coin_ledger
           WHERE scope_key = ?
             AND created_at >= ?
             AND (
               (to_jid = ? AND (
                 reason LIKE 'heist-win:%'
                 OR reason = 'assault-win'
                 OR reason = 'assault-win-property'
                 OR reason LIKE 'heist-fail:%'
                 OR reason = 'assault-fail'
                 OR reason = 'police-bust'
               ))
               OR (from_jid = ? AND reason = 'assault-victim')
             )`
        )
        .get(String(scopeKey || ''), since, String(userJid || ''), String(userJid || ''));
      return Number(row?.cnt) || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Score 0..1 de “denúncias / eventos policiais” (falhas recentes + recência do último evento).
   */
  function computeReportsScore(userJid, scopeKey, now = Date.now()) {
    const since = Number(now) - 7 * 24 * 60 * 60_000;
    let fails = 0;
    try {
      const row = getDatabase()
        .prepare(
          `SELECT COUNT(*) AS cnt FROM ${ANALYTICS_SCHEMA}.fun_coin_ledger
           WHERE scope_key = ? AND to_jid = ? AND created_at >= ?
             AND (
               reason LIKE 'heist-fail:%'
               OR reason = 'assault-fail'
               OR reason = 'police-bust'
             )`
        )
        .get(String(scopeKey || ''), String(userJid || ''), since);
      fails = Number(row?.cnt) || 0;
    } catch {
      fails = 0;
    }
    const lastEvt = cdGet(userJid, scopeKey, KEY_LAST_POLICE);
    let recency = 0;
    if (lastEvt > 0) {
      const age = Math.max(0, Number(now) - lastEvt);
      // evento nas últimas 6h → peso alto; some em ~3 dias
      recency = clamp01(1 - age / (3 * 24 * 60 * 60_000));
    }
    return clamp01(fails / 8 + recency * 0.5);
  }

  function getWantedPoints(userJid, scopeKey, now = Date.now()) {
    let points = cdGet(userJid, scopeKey, KEY_WANTED);
    let lastDecay = cdGet(userJid, scopeKey, KEY_WANTED_DECAY);
    if (lastDecay <= 0) lastDecay = Number(now) || Date.now();
    const steps = Math.floor((Number(now) - lastDecay) / WANTED_DECAY_MS);
    if (steps > 0 && points > 0) {
      points = Math.max(0, points - steps);
      cdSet(userJid, scopeKey, KEY_WANTED, points);
      // avança o relógio de decay em múltiplos inteiros
      cdSet(userJid, scopeKey, KEY_WANTED_DECAY, lastDecay + steps * WANTED_DECAY_MS);
    } else if (cdGet(userJid, scopeKey, KEY_WANTED_DECAY) <= 0) {
      cdSet(userJid, scopeKey, KEY_WANTED_DECAY, Number(now) || Date.now());
    }
    return points;
  }

  function setWantedPoints(userJid, scopeKey, points, now = Date.now()) {
    const p = Math.max(0, Math.floor(Number(points) || 0));
    cdSet(userJid, scopeKey, KEY_WANTED, p);
    if (cdGet(userJid, scopeKey, KEY_WANTED_DECAY) <= 0) {
      cdSet(userJid, scopeKey, KEY_WANTED_DECAY, Number(now) || Date.now());
    }
    return p;
  }

  function addWantedPoints(userJid, scopeKey, delta, now = Date.now()) {
    const cur = getWantedPoints(userJid, scopeKey, now);
    return setWantedPoints(userJid, scopeKey, cur + Math.max(0, Math.floor(Number(delta) || 0)), now);
  }

  function getWantedLevel(userJid, scopeKey, now = Date.now()) {
    return wantedLevelFromPoints(getWantedPoints(userJid, scopeKey, now));
  }

  function markPoliceEvent(userJid, scopeKey, now = Date.now()) {
    cdSet(userJid, scopeKey, KEY_LAST_POLICE, Number(now) || Date.now());
  }

  function getLastPoliceEvent(userJid, scopeKey) {
    return cdGet(userJid, scopeKey, KEY_LAST_POLICE);
  }

  /**
   * Imunidade ativa: tempo restante E usos restantes (whichever first).
   * Expired passes são removidos automaticamente via effectsRepository.
   */
  function getImmunity(userJid, scopeKey, now = Date.now()) {
    if (!effectsRepository?.getEffect) {
      return { active: false, remainingUses: 0, expiresAt: 0 };
    }
    const e = effectsRepository.getEffect(userJid, scopeKey, POLICE_IMMUNITY_EFFECT, now);
    if (!e) return { active: false, remainingUses: 0, expiresAt: 0 };
    const remainingUses = Math.max(0, Number(e.charges) || 0);
    const expiresAt = Number(e.expiresAt) || 0;
    if (remainingUses <= 0 || (expiresAt > 0 && expiresAt < Number(now))) {
      // cleanup residual
      try {
        effectsRepository.clearEffect?.(userJid, scopeKey, POLICE_IMMUNITY_EFFECT);
      } catch {
        /* ignore */
      }
      return { active: false, remainingUses: 0, expiresAt: 0 };
    }
    return {
      active: true,
      remainingUses,
      expiresAt,
      effect: e,
    };
  }

  /**
   * Consome 1 uso do passe. Retorna imunidade pós-consumo.
   */
  function consumeImmunityUse(userJid, scopeKey, now = Date.now()) {
    const before = getImmunity(userJid, scopeKey, now);
    if (!before.active) return before;
    if (effectsRepository?.consumeCharge) {
      effectsRepository.consumeCharge(userJid, scopeKey, POLICE_IMMUNITY_EFFECT, now);
    }
    return getImmunity(userJid, scopeKey, now);
  }

  /**
   * Disponibilidade semanal global: 1 passe no servidor por semana.
   */
  function weekIndex(now = Date.now()) {
    return Math.floor(Number(now) / POLICE_IMMUNITY_WEEK_MS);
  }

  function isImmunityPassAvailable(now = Date.now()) {
    const soldWeek = cdGet(GLOBAL_JID, GLOBAL_SCOPE, KEY_IMMUNITY_WEEK);
    return soldWeek !== weekIndex(now);
  }

  function markImmunityPassSold(now = Date.now()) {
    cdSet(GLOBAL_JID, GLOBAL_SCOPE, KEY_IMMUNITY_WEEK, weekIndex(now));
  }

  function msUntilImmunityRestock(now = Date.now()) {
    const w = weekIndex(now);
    const next = (w + 1) * POLICE_IMMUNITY_WEEK_MS;
    return Math.max(0, next - Number(now));
  }

  /**
   * Ganha de Wanted por crime. Imunidade reduz (não zera) o ganho.
   */
  function wantedGainForCrime({ mode = 'player', success = true, immune = false } = {}) {
    let base = 1;
    if (success) {
      if (mode === 'bank') base = 3;
      else if (mode === 'shop') base = 1;
      else base = 2;
    } else {
      base = mode === 'bank' ? 2 : 1;
    }
    if (immune) {
      // polícia perde o rastro imediato, mas a reputação continua subindo devagar
      if (!success) return 0;
      return Math.max(1, Math.ceil(base * 0.5));
    }
    return base;
  }

  /**
   * Penalidade de chance por Wanted + Suspicion (além do Heat existente).
   * Wanted 3+ endurece assaltos; 5 = pressão máxima.
   */
  function policeChancePenalty(suspicion, wantedLevel) {
    const s = clamp01(suspicion);
    const w = Math.min(5, Math.max(0, Math.floor(Number(wantedLevel) || 0)));
    // Wanted 0: só um toque de suspicion; Wanted 5: até ~18% extra
    return Math.min(0.22, s * 0.05 + w * 0.025 + (w >= 3 ? 0.02 : 0) + (w >= 5 ? 0.03 : 0));
  }

  /**
   * Decide se a polícia intervém (bloqueia o crime).
   * Crimes pequenos / baixa suspicion frequentemente passam despercebidos.
   */
  function rollPoliceIntervention({
    suspicion = 0,
    wantedLevel = 0,
    windowCount = 1,
    mode = 'player',
    immune = false,
  } = {}) {
    if (immune) {
      return { intervene: false, chance: 0, reason: 'immune' };
    }
    const s = clamp01(suspicion);
    const w = Math.min(5, Math.max(0, Math.floor(Number(wantedLevel) || 0)));
    let p = s * 0.16 + w * 0.06;
    // janela 2h: crimes consecutivos disparam atenção
    if (windowCount >= 3) p += 0.07;
    if (windowCount >= 5) p += 0.1;
    // lojinha = crime menor → frequentemente passa
    if (mode === 'shop') p *= 0.5;
    if (mode === 'bank') p *= 1.2;
    if (w >= 4) p += 0.12;
    if (w >= 5) p += 0.12;
    // baixa suspicion + wanted 0: quase nunca
    if (s < 0.08 && w <= 0) p *= 0.25;
    p = Math.min(0.7, Math.max(0, p));
    const roll = typeof random === 'function' ? random() : Math.random();
    return {
      intervene: roll < p,
      chance: p,
      roll,
      reason: roll < p ? 'busted' : 'clear',
    };
  }

  /**
   * Avalia o perfil criminal completo (Suspicion + Wanted + imunidade + intervenção).
   * @param {{ userJid: string, scopeKey: string, heat?: number, mode?: string, windowCount?: number, now?: number }} args
   */
  function evaluate({
    userJid,
    scopeKey,
    heat = 0,
    mode = 'player',
    windowCount = 1,
    now = Date.now(),
  } = {}) {
    const u = String(userJid || '');
    const s = String(scopeKey || '');
    const immunity = getImmunity(u, s, now);
    const wantedPoints = getWantedPoints(u, s, now);
    const wantedLevel = wantedLevelFromPoints(wantedPoints);
    const crimes7d = countCrimes7d(u, s, now);
    const reportsScore = computeReportsScore(u, s, now);
    const wealth = Number(repository?.getUserStats?.(u, s)?.coins) || 0;

    // Chaos event pode desligar heat — suspicion ainda usa heat=0
    const heatEffective =
      chaosEventService?.isHeatDisabled?.(s, now) ? 0 : Math.max(0, Number(heat) || 0);

    const suspicion = computeSuspicionScore({
      heat: heatEffective,
      crimes7d,
      wealth,
      reportsScore,
      wantedLevel,
    });

    const chancePenalty = immunity.active
      ? 0
      : policeChancePenalty(suspicion, wantedLevel);

    const intervention = rollPoliceIntervention({
      suspicion,
      wantedLevel,
      windowCount,
      mode,
      immune: immunity.active,
    });

    return {
      suspicion,
      wantedPoints,
      wantedLevel,
      crimes7d,
      reportsScore,
      wealth,
      heat: heatEffective,
      immunity,
      immune: immunity.active,
      chancePenalty,
      intervention,
    };
  }

  /**
   * Aplica consequências pós-crime (wanted + opcional consume imunidade).
   */
  function afterCrime({
    userJid,
    scopeKey,
    mode = 'player',
    success = true,
    immune = false,
    policeBust = false,
    now = Date.now(),
  } = {}) {
    const u = String(userJid || '');
    const s = String(scopeKey || '');
    let immunityAfter = null;
    if (immune) {
      immunityAfter = consumeImmunityUse(u, s, now);
    }
    const gain = policeBust
      ? immune
        ? 1
        : 2 + (mode === 'bank' ? 1 : 0)
      : wantedGainForCrime({ mode, success, immune });
    const wantedPoints = gain > 0 ? addWantedPoints(u, s, gain, now) : getWantedPoints(u, s, now);
    if (policeBust) markPoliceEvent(u, s, now);
    return {
      wantedPoints,
      wantedLevel: wantedLevelFromPoints(wantedPoints),
      wantedGain: gain,
      immunity: immunityAfter || getImmunity(u, s, now),
    };
  }

  return {
    computeSuspicionScore,
    wantedLevelFromPoints,
    getWantedPoints,
    setWantedPoints,
    addWantedPoints,
    getWantedLevel,
    countCrimes7d,
    computeReportsScore,
    markPoliceEvent,
    getLastPoliceEvent,
    getImmunity,
    consumeImmunityUse,
    isImmunityPassAvailable,
    markImmunityPassSold,
    msUntilImmunityRestock,
    weekIndex,
    wantedGainForCrime,
    policeChancePenalty,
    rollPoliceIntervention,
    evaluate,
    afterCrime,
    constants: {
      WANTED_DECAY_MS,
      WANTED_LEVEL_THRESHOLDS,
      POLICE_IMMUNITY_EFFECT,
      POLICE_IMMUNITY_DURATION_MS,
      POLICE_IMMUNITY_MAX_USES,
      POLICE_IMMUNITY_WEEK_MS,
    },
  };
}
