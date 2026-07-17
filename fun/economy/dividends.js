/**
 * Yield dinâmico de dividendos por personalidade + saúde da cotação.
 *
 * - Estáveis (Uno, Satélite, BurgerZap): pagam com frequência, yield moderado.
 * - Arriscadas (Bomba, Peixaria): ocasional, yield médio.
 * - PatoCoin: raro, mas yield alto quando cai (prêmio de raridade).
 */

import { clamp, lerp } from './math.js';
import { getCompany } from './companies.js';

/**
 * @typedef {object} DividendProfile
 * @property {number} base — yield mínimo quando elegível (0..1)
 * @property {number} max — teto de yield num payout
 * @property {number} payChance — chance de pagar quando o período venceu (0..1)
 * @property {boolean} rare — se true, payouts raros mas gordos
 * @property {string} label — texto curto pro board
 */

/** @type {Readonly<Record<string, DividendProfile>>} */
export const DIVIDEND_PROFILES = Object.freeze({
  burgerzap: Object.freeze({
    base: 0.012,
    max: 0.028,
    payChance: 0.88,
    rare: false,
    label: 'dividendo de rua',
  }),
  uno_motors: Object.freeze({
    base: 0.008,
    max: 0.02,
    payChance: 0.78,
    rare: false,
    label: 'caixa de metal',
  }),
  satelite_br: Object.freeze({
    base: 0.006,
    max: 0.016,
    payChance: 0.72,
    rare: false,
    label: 'repasse de gigante',
  }),
  peixaria: Object.freeze({
    base: 0.002,
    max: 0.014,
    payChance: 0.38,
    rare: false,
    label: 'peixe do dia',
  }),
  bombatech: Object.freeze({
    base: 0,
    max: 0.018,
    payChance: 0.22,
    rare: false,
    label: 'bônus de guerra',
  }),
  patocoin: Object.freeze({
    base: 0.04,
    max: 0.1,
    payChance: 0.07,
    rare: true,
    label: 'drop raro de pato',
  }),
});

const FALLBACK = Object.freeze({
  base: 0,
  max: 0.01,
  payChance: 0.15,
  rare: false,
  label: 'repasse',
});

/**
 * Saúde da cotação 0..1 — perto do base e não foguete = melhor caixa.
 * Abaixo de ~0.55 do base: empresa “sangrando”, yield some.
 */
export function priceHealth(price, basePrice) {
  const p = Math.max(1, Number(price) || 1);
  const b = Math.max(1, Number(basePrice) || p);
  const ratio = p / b;
  if (ratio < 0.55) return 0;
  if (ratio < 0.85) return lerp(0.15, 0.55, (ratio - 0.55) / 0.3);
  if (ratio <= 1.25) return lerp(0.55, 1, (ratio - 0.85) / 0.4);
  // caro demais: caixa tensionada, yield cai
  if (ratio <= 1.8) return lerp(1, 0.35, (ratio - 1.25) / 0.55);
  return 0.2;
}

export function getDividendProfile(companyOrId) {
  const id =
    typeof companyOrId === 'string'
      ? companyOrId
      : String(companyOrId?.id || '');
  const company = typeof companyOrId === 'object' ? companyOrId : getCompany(id);
  const fromMap = DIVIDEND_PROFILES[id] || FALLBACK;

  // catálogo pode puxar o floor (ex.: burgerzap 0.015)
  const catalogBase = Number(company?.dividendYield);
  const base =
    Number.isFinite(catalogBase) && catalogBase > fromMap.base
      ? catalogBase
      : fromMap.base;

  return {
    ...fromMap,
    base: clamp(base, 0, fromMap.max),
    max: fromMap.max,
  };
}

/**
 * Yield efetivo se HOUVER payout (sem rolar chance).
 * PatoCoin: sempre na faixa alta (raro ⇒ gordo).
 * Estáveis: base → max conforme health e risco baixo.
 */
export function computeDividendYield({
  company,
  price,
  basePrice,
  demand: demandIn = 1,
  random = Math.random,
} = {}) {
  const c = company || getCompany('burgerzap');
  const profile = getDividendProfile(c);
  const health = priceHealth(price ?? c.basePrice, basePrice ?? c.basePrice);
  if (health <= 0 && !profile.rare) return 0;

  const risk = clamp(Number(c.risk) || 0.3, 0, 1);
  const demand = clamp(Number(demandIn) || 1, 0.2, 3);
  const demandBoost = clamp((demand - 1) * 0.15, -0.1, 0.2);

  if (profile.rare) {
    // raro: yield alto sempre que pagar; health só afina entre 70–100% do max
    const t = clamp(0.7 + health * 0.3 + demandBoost * 0.5, 0.65, 1);
    // micro-variação pra não ser sempre o mesmo número
    const jitter = 0.92 + random() * 0.08;
    return clamp(profile.max * t * jitter, profile.base, profile.max);
  }

  // normais: mistura base/max com health e anti-risco
  const stability = 1 - risk * 0.55;
  const t = clamp(health * stability + demandBoost, 0, 1);
  let y = lerp(profile.base, profile.max, t);
  // se health zerou e base > 0 ainda, sem payout de fato (caller usa payChance)
  if (health < 0.2) y *= health / 0.2;
  return clamp(y, 0, profile.max);
}

/**
 * Yield “de vitrine” (determinístico) pro /bolsa — sem RNG.
 */
export function indicativeDividendYield({ company, price, basePrice, demand = 1 } = {}) {
  return computeDividendYield({
    company,
    price,
    basePrice,
    demand,
    random: () => 0.5,
  });
}

/**
 * Rola se paga e com qual yield.
 * @returns {{ pays: boolean, yield: number, rare: boolean, chance: number, health: number }}
 */
export function rollDividendPayout({
  company,
  price,
  basePrice,
  demand = 1,
  eventShock = 0,
  random = Math.random,
} = {}) {
  const c = company || getCompany('burgerzap');
  const profile = getDividendProfile(c);
  const health = priceHealth(price ?? c.basePrice, basePrice ?? c.basePrice);

  let chance = profile.payChance;
  // saúde melhora a chance; empresa sangrando quase não paga (exceto rare com health 0 → chance residual baixa)
  if (profile.rare) {
    chance *= 0.55 + health * 0.9;
    // spike de meme residual: leve boost de chance se shock absurdo
    if (Math.abs(Number(eventShock) || 0) > 8) chance *= 1.25;
  } else {
    if (health <= 0) {
      return { pays: false, yield: 0, rare: false, chance: 0, health: 0 };
    }
    chance *= 0.55 + health * 0.7;
  }
  chance = clamp(chance, 0, 0.95);

  if (random() > chance) {
    return { pays: false, yield: 0, rare: profile.rare, chance, health };
  }

  const y = computeDividendYield({
    company: c,
    price,
    basePrice,
    demand,
    random,
  });
  if (y <= 0) {
    return { pays: false, yield: 0, rare: profile.rare, chance, health };
  }
  return { pays: true, yield: y, rare: profile.rare, chance, health };
}

/**
 * Texto curto pro board.
 */
export function formatYieldHint(company, yieldPct, profile) {
  const p = profile || getDividendProfile(company);
  const pct = (Number(yieldPct) || 0) * 100;
  if (p.rare) {
    if (pct <= 0) return ' · 🦆 raro · até ' + (p.max * 100).toFixed(0) + '%';
    return ` · 🦆 raro · ~${pct.toFixed(0)}%`;
  }
  if (pct <= 0.05) return '';
  return ` · 💸 ${pct.toFixed(1)}%`;
}
