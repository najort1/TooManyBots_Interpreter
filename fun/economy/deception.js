/**
 * Deceptibilidade: IA mente na narrativa; motor agenda/realiza com caps.
 */

import { clamp } from './math.js';

export const DECEPTION_MODES = Object.freeze([
  'none',
  'hype',
  'fog',
  'contrarian',
  'false_alarm',
]);

/**
 * Escolhe modo de decepção (determinístico a partir de knobs + personalidade).
 */
export function pickDeceptionMode({
  reg,
  companyRisk = 0.3,
  random = Math.random,
  forceMode = null,
} = {}) {
  if (forceMode && DECEPTION_MODES.includes(forceMode)) return forceMode;
  const rate = clamp(Number(reg?.deceptionRate) || 0.12, 0, 0.4);
  const p = rate * (0.5 + clamp(companyRisk, 0, 1));
  if (random() > p) return 'none';

  const roll = random();
  if (roll < 0.3) return 'hype';
  if (roll < 0.55) return 'fog';
  if (roll < 0.8) return 'contrarian';
  return 'false_alarm';
}

/**
 * Ajusta arquétipo efetivo / fila pós-notícia conforme modo.
 * Retorna { effectiveArchetype, journalDirection, smokeReason, followUp }
 */
export function applyDeceptionPlan({
  mode,
  archetypeId,
  trueDirection, // 'up' | 'down' | 'flat'
  primaryReason,
  category,
  companyId,
  now = Date.now(),
  random = Math.random,
}) {
  const plan = {
    mode: mode || 'none',
    effectiveArchetype: archetypeId,
    journalDirection: trueDirection,
    primaryReasonForAi: primaryReason,
    smokeReason: null,
    followUp: null,
    forceRumor: false,
  };

  if (mode === 'none' || !mode) return plan;

  if (mode === 'false_alarm') {
    plan.effectiveArchetype = 'rumor_only';
    plan.forceRumor = true;
    plan.journalDirection = trueDirection === 'down' ? 'down' : 'up';
    // 40% vira real depois
    if (random() < 0.4) {
      plan.followUp = {
        archetype: archetypeId === 'rumor_only' ? 'supply_shock' : archetypeId,
        category,
        companyId,
        fireAt: now + (45 + Math.floor(random() * 90)) * 60_000,
        maxShockPct: 10,
        reason: 'false_alarm_promote',
      };
    }
    return plan;
  }

  if (mode === 'fog') {
    const smokes = [
      'buy_pressure',
      'sell_pressure',
      'demand_up_supply_down',
      'demand_down_supply_up',
      'noise',
      'mean_reversion',
    ].filter((r) => r !== primaryReason);
    plan.smokeReason = smokes[Math.floor(random() * smokes.length)] || 'noise';
    plan.primaryReasonForAi = plan.smokeReason;
    return plan;
  }

  if (mode === 'hype') {
    plan.journalDirection = 'up';
    // se o mercado não subiu, ainda hipa; agenda mean-reversion / profit take
    plan.followUp = {
      archetype: 'profit_take',
      category,
      companyId,
      fireAt: now + (20 + Math.floor(random() * 50)) * 60_000,
      maxShockPct: 10,
      reason: 'hype_reversion',
    };
    return plan;
  }

  if (mode === 'contrarian') {
    plan.journalDirection = trueDirection === 'down' ? 'up' : 'down';
    plan.followUp = {
      archetype: trueDirection === 'up' ? 'profit_take' : 'demand_boom',
      category,
      companyId,
      fireAt: now + (15 + Math.floor(random() * 40)) * 60_000,
      maxShockPct: 12,
      reason: 'contrarian_trap',
    };
    return plan;
  }

  return plan;
}

/** Razões legíveis pro prompt (nunca números inventados). */
export const REASON_GUIDE = Object.freeze({
  buy_pressure: 'fila de compra / FOMO no bairro',
  sell_pressure: 'dump e pânico',
  demand_up_supply_down: 'escassez: demanda sobe e oferta some',
  demand_down_supply_up: 'sobra de estoque, ninguém quer',
  mean_reversion: 'preço voltando pro “normal” da casa',
  noise: 'ninguém sabe ao certo',
  meme_spike: 'onda meme / zap pirado',
  event_residual: 'eco do último boato/evento',
});
