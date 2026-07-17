/**
 * Camada 4 — Regulador invisível.
 * Ajusta knobs; nunca aparece como “patch” pro player.
 */

import { clamp } from './math.js';

export function defaultRegulatorKnobs() {
  return {
    volMult: 1,
    eventImpactMult: 1,
    eventFreqMult: 1,
    rewardMult: 1,
    restockMult: 1,
    flowScale: 500,
    baseNoisePct: 0.012,
    deceptionRate: 0.12,
    shockDecay: 0.85,
    volumeDecay: 0.72,
    lastRegulateAt: 0,
    narrativeSeeds: [],
    scheduledShocks: [],
    recentArchetypes: [],
    recentFingerprints: [],
    truthLog: [],
  };
}

export function clampKnobs(reg) {
  const r = { ...defaultRegulatorKnobs(), ...reg };
  r.volMult = clamp(r.volMult, 0.5, 1.8);
  r.eventImpactMult = clamp(r.eventImpactMult, 0.55, 1.45);
  r.eventFreqMult = clamp(r.eventFreqMult, 0.5, 1.8);
  r.rewardMult = clamp(r.rewardMult, 0.7, 1.35);
  r.restockMult = clamp(r.restockMult, 0.7, 1.4);
  r.flowScale = clamp(r.flowScale, 80, 5000);
  r.baseNoisePct = clamp(r.baseNoisePct, 0.004, 0.04);
  r.deceptionRate = clamp(r.deceptionRate, 0.02, 0.28);
  r.shockDecay = clamp(r.shockDecay, 0.7, 0.95);
  r.volumeDecay = clamp(r.volumeDecay, 0.5, 0.9);
  if (!Array.isArray(r.narrativeSeeds)) r.narrativeSeeds = [];
  if (!Array.isArray(r.scheduledShocks)) r.scheduledShocks = [];
  if (!Array.isArray(r.recentArchetypes)) r.recentArchetypes = [];
  if (!Array.isArray(r.recentFingerprints)) r.recentFingerprints = [];
  if (!Array.isArray(r.truthLog)) r.truthLog = [];
  return r;
}

/**
 * @param {object} metrics
 * @param {number} metrics.circulatingCoins
 * @param {number} metrics.baselineCoins — âncora do scope
 * @param {number} metrics.gini
 * @param {number} metrics.mintSink — gerado - removido (24h), relativo opcional
 * @param {number} metrics.activePlayers
 * @param {number} metrics.investedValue
 * @param {number} metrics.avgAbsDeltaPct — 0..1 (ex 0.08 = 8%)
 * @param {number} metrics.eventsLast24h
 * @param {object} reg
 * @param {number} now
 */
export function regulate(metrics, reg, now = Date.now()) {
  let r = clampKnobs(reg);
  const M = Math.max(1, Number(metrics.circulatingCoins) || 1);
  const baseline = Math.max(1, Number(metrics.baselineCoins) || M);
  const mintSink = Number(metrics.mintSink) || 0;
  const gini = clamp(Number(metrics.gini) || 0.35, 0, 1);
  const avgVol = clamp(Number(metrics.avgAbsDeltaPct) || 0.05, 0, 1);
  const seeds = [];

  // coins demais / inflação
  if (mintSink > 0.15 * M || M > baseline * 1.3) {
    r.rewardMult *= 0.95;
    r.eventFreqMult *= 1.1;
    r.restockMult *= 0.95;
    seeds.push('austerity_soft');
  }
  // deflação / coins sumindo
  if (mintSink < -0.15 * M || M < baseline * 0.7) {
    r.rewardMult *= 1.05;
    r.eventImpactMult *= 0.92;
    r.restockMult *= 1.05;
    seeds.push('liquidity_wave');
  }
  // vol alta
  if (avgVol > 0.12) {
    r.volMult *= 0.92;
    r.eventImpactMult *= 0.9;
    seeds.push('quiet_week');
  }
  // mercado morto
  if (avgVol < 0.03) {
    r.volMult *= 1.08;
    r.eventFreqMult *= 1.15;
    r.deceptionRate = Math.min(0.25, r.deceptionRate + 0.02);
    seeds.push('meme_spike');
  }
  // riqueza concentrada
  if (gini > 0.55) {
    r.rewardMult *= 1.03;
    seeds.push('blitz_luxury');
  }

  for (const s of seeds) {
    if (!r.narrativeSeeds.includes(s)) r.narrativeSeeds.push(s);
  }
  r.narrativeSeeds = r.narrativeSeeds.slice(-6);
  r.lastRegulateAt = now;
  return clampKnobs(r);
}

/**
 * Gini aproximado a partir de saldos.
 */
export function computeGini(balances) {
  const xs = (balances || [])
    .map((n) => Math.max(0, Number(n) || 0))
    .filter((n) => n >= 0)
    .sort((a, b) => a - b);
  const n = xs.length;
  if (n === 0) return 0;
  if (n === 1) return 0;
  const sum = xs.reduce((a, b) => a + b, 0);
  if (sum <= 0) return 0;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += (2 * (i + 1) - n - 1) * xs[i];
  }
  return clamp(acc / (n * sum), 0, 1);
}

export function computeAvgAbsDelta(priceRows) {
  const rows = priceRows || [];
  if (!rows.length) return 0.05;
  let sum = 0;
  let n = 0;
  for (const r of rows) {
    const p = Number(r.price) || 0;
    const prev = Number(r.previousPrice) || 0;
    if (prev > 0 && p > 0) {
      sum += Math.abs((p - prev) / prev);
      n++;
    }
  }
  return n ? sum / n : 0.05;
}

/**
 * Escala intervalo de próximo evento pelo eventFreqMult.
 */
export function scaleEventWaitMs(baseWaitMs, reg) {
  // mult > 1 = mais eventos (wait menor), mas nunca mais rápido que 50% do intervalo base
  // mult < 1 = menos eventos
  let mult = Number(reg?.eventFreqMult) || 1;
  mult = Math.min(1.35, Math.max(0.55, mult));
  // mercado super aquecido: espaça mais (não bombardeia com +% de novo)
  const heat = Number(reg?.marketOverheat) || 0;
  if (heat > 0.35) mult *= Math.max(0.55, 1 - heat * 0.25);
  return Math.max(90 * 60_000, Math.floor(baseWaitMs / mult));
}

export function pushRecentArchetype(reg, archetypeId) {
  const r = clampKnobs(reg);
  r.recentArchetypes = [...r.recentArchetypes, archetypeId].slice(-16);
  return r;
}

export function pushFingerprint(reg, fp) {
  const r = clampKnobs(reg);
  if (fp) r.recentFingerprints = [...r.recentFingerprints, fp].slice(-24);
  return r;
}

export function pushTruthLog(reg, entry) {
  const r = clampKnobs(reg);
  r.truthLog = [...r.truthLog, { ...entry, at: entry.at || Date.now() }].slice(-40);
  return r;
}

export function popNarrativeSeed(reg) {
  const r = clampKnobs(reg);
  const seed = r.narrativeSeeds.shift() || null;
  return { reg: r, seed };
}

/**
 * Agenda shock futuro (decepção / mean reversion).
 */
export function scheduleShock(reg, shock) {
  const r = clampKnobs(reg);
  r.scheduledShocks = [
    ...r.scheduledShocks,
    {
      id: shock.id || `sh_${Date.now()}`,
      archetype: shock.archetype || 'profit_take',
      category: shock.category || '',
      companyId: shock.companyId || '',
      fireAt: Number(shock.fireAt) || Date.now() + 30 * 60_000,
      maxShockPct: clamp(Number(shock.maxShockPct) || 10, 3, 14),
      reason: shock.reason || 'deception',
    },
  ].slice(-12);
  return r;
}

export function takeDueShocks(reg, now = Date.now()) {
  const r = clampKnobs(reg);
  const due = r.scheduledShocks.filter((s) => Number(s.fireAt) <= now);
  r.scheduledShocks = r.scheduledShocks.filter((s) => Number(s.fireAt) > now);
  return { reg: r, due };
}
