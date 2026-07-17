/**
 * Camada 1 — Motor econômico 100% determinístico.
 * Entrada: números + personalidade. Saída: preço. Nunca texto de IA.
 */

import { clamp, tanh, gauss, lerp } from './math.js';
import { companyForItem, getCompany } from './companies.js';

export const ENGINE_WEIGHTS = Object.freeze({
  flow: 0.35,
  sd: 0.3,
  shock: 0.25,
});

export const DEFAULT_ASSET_STATE = Object.freeze({
  supply: 1,
  demand: 1,
  eventShock: 0,
  volumeBuy: 0,
  volumeSell: 0,
});

/**
 * @param {object} input
 * @param {number} input.price
 * @param {number} input.basePrice
 * @param {object} input.personality — CompanyPersonality
 * @param {number} input.supply
 * @param {number} input.demand
 * @param {number} input.volumeBuy
 * @param {number} input.volumeSell
 * @param {number} input.eventShock
 * @param {object} [input.reg] — knobs do regulador
 * @param {() => number} [input.random]
 */
export function tickAsset(input) {
  const personality = input.personality || getCompany('burgerzap');
  const reg = input.reg || {};
  const random = input.random || Math.random;

  const price = Math.max(1, Math.floor(Number(input.price) || 1));
  const basePrice = Math.max(1, Math.floor(Number(input.basePrice) || price));
  const supply = clamp(Number(input.supply) || 1, 0.2, 3);
  const demand = clamp(Number(input.demand) || 1, 0.2, 3);
  const volumeBuy = Math.max(0, Number(input.volumeBuy) || 0);
  const volumeSell = Math.max(0, Number(input.volumeSell) || 0);
  let eventShock = Number(input.eventShock) || 0;

  const flowScale =
    Math.max(20, Number(reg.flowScale) || 500) * (personality.flowScaleMult || 1);
  const pressure = tanh((volumeBuy - volumeSell) / flowScale);

  const sdRaw = Math.log(demand / Math.max(supply, 1e-6));
  const sdSignal = clamp(sdRaw, -1.5, 1.5) / 1.5;
  const shockSignal = clamp(eventShock / 100, -0.4, 0.4);

  const volMult = Number(reg.volMult) || 1;
  const baseNoisePct = Number(reg.baseNoisePct) || 0.012;
  const risk = Number(personality.risk) || 0.3;
  let sigma = (Number(personality.volatility) || 0.4) * volMult * (0.6 + 0.4 * risk);

  // Uno: amortece noise pequeno
  let noise = gauss(random) * sigma * baseNoisePct;
  if (personality.id === 'uno_motors' && Math.abs(noise) < 0.008) {
    noise *= 0.5;
  }

  // PatoCoin meme spike ocasional
  if (personality.memeSpikes && random() < 0.02) {
    const sign = random() < 0.5 ? -1 : 1;
    noise = sign * (0.08 + random() * 0.27);
  } else if (personality.memeSpikes && Math.abs(noise) < 0.01 && random() < 0.1) {
    const sign = random() < 0.5 ? -1 : 1;
    noise = sign * (0.08 + random() * 0.2);
  }

  const meanRev = Number(personality.meanReversion) || 0;
  let reversion = meanRev * ((basePrice - price) / basePrice);

  // acima do base: mean-reversion mais forte (anti-foguete)
  const over = price / basePrice;
  if (over > 1.15) {
    reversion *= 1.4 + Math.min(2.5, (over - 1.15) * 2.2);
  }
  if (over > 1.8) {
    // puxão extra de correção quando já explodiu
    reversion += -0.04 * Math.min(2, over - 1.8);
  }

  // Satélite: se afundou, puxa mais forte
  if (personality.id === 'satelite_br' && price < basePrice * 0.75) {
    reversion *= 2;
  }

  let delta =
    ENGINE_WEIGHTS.flow * pressure +
    ENGINE_WEIGHTS.sd * sdSignal +
    ENGINE_WEIGHTS.shock * shockSignal +
    reversion +
    noise;

  // amortece alta quando já está caro
  if (delta > 0 && over > 1.25) {
    delta *= Math.max(0.2, 1.15 - over * 0.35);
  }

  const maxTick = Number(personality.maxTickDelta) || 0.12;
  delta = clamp(delta, -maxTick, maxTick);

  const floor = Math.max(1, Math.floor(basePrice * (Number(personality.floorMult) || 0.4)));
  const ceil = Math.max(floor + 1, Math.floor(basePrice * (Number(personality.ceilMult) || 2.2)));

  const raw = price * (1 + delta);
  let next = clamp(Math.round(raw), floor, ceil);

  // se preço legado estourou o teto novo, desce em passos (não instantâneo absurdo, mas firme)
  if (price > ceil) {
    const step = Math.max(1, Math.round((price - ceil) * 0.35));
    next = Math.max(ceil, price - step);
  }

  // decay do shock residual
  const shockDecay = Number(reg.shockDecay) || 0.85;
  eventShock = eventShock * shockDecay;
  if (Math.abs(eventShock) < 0.15) eventShock = 0;

  const primaryReason = pickPrimaryReason({
    pressure,
    sdSignal,
    shockSignal,
    reversion,
    noise,
    meme: personality.memeSpikes && Math.abs(noise) > 0.07,
  });

  return {
    previous: price,
    price: next,
    deltaPct: price > 0 ? ((next - price) / price) * 100 : 0,
    eventShock,
    supply,
    demand,
    reasons: {
      pressure,
      sdSignal,
      shockSignal,
      reversion,
      noise,
      sigma,
      delta,
    },
    primaryReason,
    floor,
    ceil,
  };
}

export function pickPrimaryReason({
  pressure,
  sdSignal,
  shockSignal,
  reversion,
  noise,
  meme = false,
}) {
  if (meme) return 'meme_spike';
  const scores = [
    { id: pressure >= 0 ? 'buy_pressure' : 'sell_pressure', v: Math.abs(pressure) * 0.35 },
    {
      id: sdSignal >= 0 ? 'demand_up_supply_down' : 'demand_down_supply_up',
      v: Math.abs(sdSignal) * 0.3,
    },
    { id: 'event_residual', v: Math.abs(shockSignal) * 0.25 },
    { id: 'mean_reversion', v: Math.abs(reversion) * 0.9 },
    { id: 'noise', v: Math.abs(noise) * 0.5 },
  ];
  scores.sort((a, b) => b.v - a.v);
  return scores[0]?.id || 'noise';
}

/**
 * Aplica ImpactVector amostrado do catálogo em um asset.
 */
export function applyImpactToAsset(asset, impact, personality, reg = {}) {
  const scale = Number(reg.eventImpactMult) || 1;
  const sens = Number(personality?.eventSensitivity) || 1;
  if (impact?.rumorOnly) {
    return {
      ...asset,
      applied: {
        supplyDelta: 0,
        demandDelta: 0,
        shockPct: 0,
        rumorOnly: true,
      },
    };
  }

  const supplyDelta = (Number(impact.supplyDelta) || 0) * scale;
  const demandDelta = (Number(impact.demandDelta) || 0) * scale;
  const shockPct = (Number(impact.shockPct) || 0) * scale * sens;

  const supply = clamp((Number(asset.supply) || 1) + supplyDelta, 0.2, 3);
  const demand = clamp((Number(asset.demand) || 1) + demandDelta, 0.2, 3);
  const eventShock = (Number(asset.eventShock) || 0) + shockPct;

  return {
    ...asset,
    supply,
    demand,
    eventShock,
    applied: { supplyDelta, demandDelta, shockPct, rumorOnly: false },
  };
}

/**
 * Fluxo de compra/venda (players).
 */
export function applyTradeFlow(asset, { side, qty = 1, price = 0, personality } = {}) {
  const p = personality || companyForItem(null);
  const kD = 0.04;
  const kS = 0.05;
  const q = Math.max(1, Math.floor(Number(qty) || 1));
  const px = Math.max(0, Number(price) || 0);
  let supply = Number(asset.supply) || 1;
  let demand = Number(asset.demand) || 1;
  let volumeBuy = Number(asset.volumeBuy) || 0;
  let volumeSell = Number(asset.volumeSell) || 0;

  if (side === 'buy') {
    demand = clamp(demand + kD * q, 0.2, 3);
    supply = clamp(supply - kS * q, 0.2, 3);
    volumeBuy += q * px;
  } else if (side === 'sell') {
    demand = clamp(demand - kD * q * 0.7, 0.2, 3);
    supply = clamp(supply + kS * q, 0.2, 3);
    volumeSell += q * px;
  }

  return { ...asset, supply, demand, volumeBuy, volumeSell, baseSupply: p.baseSupply };
}

/**
 * Decay lento de volume e mean-reversion de S/D para base da personalidade.
 */
export function decayAssetState(asset, personality, reg = {}) {
  const p = personality || getCompany('burgerzap');
  const volDecay = Number(reg.volumeDecay) || 0.72;
  return {
    ...asset,
    supply: lerp(Number(asset.supply) || 1, Number(p.baseSupply) || 1, 0.08),
    demand: lerp(Number(asset.demand) || 1, Number(p.baseDemand) || 1, 0.08),
    volumeBuy: (Number(asset.volumeBuy) || 0) * volDecay,
    volumeSell: (Number(asset.volumeSell) || 0) * volDecay,
    eventShock: (Number(asset.eventShock) || 0) * (Number(reg.shockDecay) || 0.85),
  };
}

export function applyPctClamped(price, pct, personality) {
  const base = Math.max(1, Math.floor(Number(price) || 1));
  const basePrice = Math.max(1, Math.floor(Number(personality?.basePrice) || base));
  const next = Math.max(1, Math.round(base * (1 + (Number(pct) || 0) / 100)));
  const floor = Math.max(1, Math.floor(basePrice * (Number(personality?.floorMult) || 0.4)));
  const ceil = Math.max(floor + 1, Math.floor(basePrice * (Number(personality?.ceilMult) || 3)));
  // usa floor/ceil relativos ao preço do item via personalidade (mult no base do item)
  const itemFloor = Math.max(1, Math.floor(base * (Number(personality?.floorMult) || 0.4)));
  const itemCeil = Math.max(itemFloor + 1, Math.floor(base * (Number(personality?.ceilMult) || 3) / Math.max(0.5, Number(personality?.floorMult) || 0.4)));
  // Prefer: clamp by mult of *current basePrice of item* passed as price context
  const f = Math.max(1, Math.floor((Number(personality?._itemBase) || base) * (Number(personality?.floorMult) || 0.4)));
  const c = Math.max(f + 1, Math.floor((Number(personality?._itemBase) || base) * (Number(personality?.ceilMult) || 3)));
  return clamp(next, f, c);
}

export function trendFrom(prev, next) {
  if (next > prev) return 'up';
  if (next < prev) return 'down';
  return 'flat';
}

/**
 * Passo completo: impacto de evento (se houver) + tick de preço.
 */
export function priceAfterEventAndTick({
  price,
  basePrice,
  assetState,
  impact,
  personality,
  reg,
  random = Math.random,
  applyDirectShock = true,
}) {
  let state = {
    supply: assetState?.supply ?? 1,
    demand: assetState?.demand ?? 1,
    eventShock: assetState?.eventShock ?? 0,
    volumeBuy: assetState?.volumeBuy ?? 0,
    volumeSell: assetState?.volumeSell ?? 0,
  };

  let applied = null;
  if (impact) {
    const next = applyImpactToAsset(state, impact, personality, reg);
    applied = next.applied;
    state = {
      supply: next.supply,
      demand: next.demand,
      eventShock: next.eventShock,
      volumeBuy: state.volumeBuy,
      volumeSell: state.volumeSell,
    };
  }

  const persona = {
    ...personality,
    _itemBase: basePrice,
  };

  // tick com basePrice do item (não da empresa)
  const tick = tickAsset({
    price,
    basePrice,
    personality: {
      ...persona,
      // floor/ceil em cima do basePrice do item
    },
    ...state,
    reg,
    random,
  });

  // floor/ceil já usam basePrice do item via tickAsset
  return {
    tick,
    state: {
      supply: tick.supply,
      demand: tick.demand,
      eventShock: tick.eventShock,
      volumeBuy: state.volumeBuy * (Number(reg?.volumeDecay) || 0.72),
      volumeSell: state.volumeSell * (Number(reg?.volumeDecay) || 0.72),
    },
    applied,
  };
}
