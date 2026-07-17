/**
 * Catálogo de arquétipos de evento — física econômica versionada.
 * Histórias vêm da IA; magnitudes vêm daqui.
 *
 * Balance (2026-07): choques menores, mais peso em queda/normalização,
 * foco empresa sempre coerente com a categoria do item.
 */

import { sampleRange, pickWeighted, clamp } from './math.js';
import {
  categoriesForCompany,
  companyForCategory,
  getCompany,
} from './companies.js';

/** @typedef {object} EventArchetype
 * @property {string} id
 * @property {string} label
 * @property {[number, number]} supplyDelta
 * @property {[number, number]} demandDelta
 * @property {[number, number]} shockPct
 * @property {number} weight
 * @property {string[]} goodForCompanies
 * @property {string[]} goodForCategories
 * @property {boolean} [rumorOnly]
 * @property {string} defaultCategory
 * @property {'up'|'down'|'flat'} [bias]
 */

/** @type {Readonly<Record<string, EventArchetype>>} */
export const EVENT_ARCHETYPES = Object.freeze({
  supply_shock: {
    id: 'supply_shock',
    label: 'Choque de oferta',
    supplyDelta: [-0.25, -0.1],
    demandDelta: [0, 0.08],
    shockPct: [4, 10],
    weight: 0.85,
    bias: 'up',
    goodForCompanies: ['bombatech', 'peixaria', 'uno_motors'],
    goodForCategories: ['combustivel', 'municao', 'arma', 'veiculo'],
    defaultCategory: 'combustivel',
  },
  demand_boom: {
    id: 'demand_boom',
    label: 'Boom de demanda',
    supplyDelta: [-0.06, 0],
    demandDelta: [0.12, 0.28],
    shockPct: [3, 9],
    weight: 0.65,
    bias: 'up',
    goodForCompanies: ['burgerzap', 'bombatech', 'patocoin'],
    goodForCategories: ['veiculo', 'arma', 'defesa', 'combustivel'],
    defaultCategory: 'veiculo',
  },
  demand_slump: {
    id: 'demand_slump',
    label: 'Demanda morre',
    supplyDelta: [0.05, 0.18],
    demandDelta: [-0.35, -0.15],
    shockPct: [-12, -5],
    weight: 1.35,
    bias: 'down',
    goodForCompanies: ['uno_motors', 'burgerzap', 'satelite_br', 'bombatech'],
    goodForCategories: ['veiculo', 'arma', 'defesa', 'municao'],
    defaultCategory: 'veiculo',
  },
  liquidity_flood: {
    id: 'liquidity_flood',
    label: 'Enchente de estoque',
    supplyDelta: [0.18, 0.4],
    demandDelta: [-0.12, 0],
    shockPct: [-14, -5],
    weight: 1.3,
    bias: 'down',
    goodForCompanies: ['peixaria', 'bombatech', 'uno_motors'],
    goodForCategories: ['municao', 'arma', 'combustivel', 'veiculo'],
    defaultCategory: 'municao',
  },
  meme_spike: {
    id: 'meme_spike',
    label: 'Onda meme',
    supplyDelta: [-0.1, -0.03],
    demandDelta: [0.2, 0.45],
    shockPct: [6, 14],
    weight: 0.25,
    bias: 'up',
    goodForCompanies: ['patocoin', 'bombatech'],
    goodForCategories: ['arma', 'municao', 'defesa'],
    defaultCategory: 'arma',
  },
  soft_recovery: {
    id: 'soft_recovery',
    label: 'Normalização',
    supplyDelta: [0.04, 0.12],
    demandDelta: [-0.08, 0.04],
    shockPct: [-5, 3],
    weight: 1.15,
    bias: 'flat',
    goodForCompanies: ['burgerzap', 'uno_motors', 'satelite_br'],
    goodForCategories: ['combustivel', 'veiculo', 'defesa', 'municao'],
    defaultCategory: 'combustivel',
  },
  blitz_luxury: {
    id: 'blitz_luxury',
    label: 'Operação no luxo',
    supplyDelta: [-0.12, -0.04],
    demandDelta: [0.05, 0.18],
    shockPct: [4, 10],
    weight: 0.55,
    bias: 'up',
    goodForCompanies: ['satelite_br', 'bombatech'],
    goodForCategories: ['arma', 'defesa'],
    defaultCategory: 'arma',
  },
  austerity_soft: {
    id: 'austerity_soft',
    label: 'Aperto de cinto',
    supplyDelta: [0, 0.1],
    demandDelta: [-0.28, -0.1],
    shockPct: [-12, -4],
    weight: 1.2,
    bias: 'down',
    goodForCompanies: ['burgerzap', 'uno_motors', 'peixaria', 'bombatech'],
    goodForCategories: ['veiculo', 'combustivel', 'defesa', 'arma'],
    defaultCategory: 'veiculo',
  },
  liquidity_wave: {
    id: 'liquidity_wave',
    label: 'Onda de grana',
    supplyDelta: [-0.04, 0.04],
    demandDelta: [0.08, 0.2],
    shockPct: [2, 7],
    weight: 0.45,
    bias: 'up',
    goodForCompanies: ['burgerzap', 'patocoin', 'peixaria'],
    goodForCategories: ['combustivel', 'municao', 'veiculo'],
    defaultCategory: 'combustivel',
  },
  quiet_week: {
    id: 'quiet_week',
    label: 'Semana morna',
    supplyDelta: [0.02, 0.08],
    demandDelta: [-0.08, -0.02],
    shockPct: [-4, 2],
    weight: 0.9,
    bias: 'flat',
    goodForCompanies: ['satelite_br', 'uno_motors', 'burgerzap'],
    goodForCategories: ['veiculo', 'defesa', 'combustivel'],
    defaultCategory: 'defesa',
  },
  rumor_only: {
    id: 'rumor_only',
    label: 'Só boato',
    supplyDelta: [0, 0],
    demandDelta: [0, 0],
    shockPct: [0, 0],
    weight: 0.7,
    bias: 'flat',
    goodForCompanies: ['patocoin', 'bombatech', 'peixaria'],
    goodForCategories: ['arma', 'municao', 'combustivel', 'defesa'],
    defaultCategory: 'arma',
    rumorOnly: true,
  },
  profit_take: {
    id: 'profit_take',
    label: 'Realização de lucro',
    supplyDelta: [0.08, 0.22],
    demandDelta: [-0.22, -0.08],
    shockPct: [-12, -4],
    weight: 1.4,
    bias: 'down',
    goodForCompanies: ['bombatech', 'patocoin', 'burgerzap', 'uno_motors'],
    goodForCategories: ['arma', 'municao', 'veiculo', 'defesa'],
    defaultCategory: 'arma',
  },
});

export const ARCHETYPE_IDS = Object.freeze(Object.keys(EVENT_ARCHETYPES));

export function getArchetype(id) {
  return EVENT_ARCHETYPES[String(id || '')] || null;
}

/**
 * Textos de fallback (LLM off).
 */
export const TEMPLATE_EVENT_SEEDS = Object.freeze([
  {
    archetype: 'supply_shock',
    category: 'combustivel',
    companyId: 'peixaria',
    title: 'Posto da região seca',
    body: [
      'Acordou cedo quem queria encher o galão.',
      'O posto da avenida abriu com a bomba “sem produto”.',
      'Gente brigando por funil, moto sem gasolina no meio da rua.',
      'No paralelo o litro sumiu — ou virou luxo.',
      'Quem tem tanque cheio vira celebridade.',
      'Combustível de rua sobe um pouco. O bairro zoa no grupo.',
    ].join('\n'),
  },
  {
    archetype: 'liquidity_flood',
    category: 'municao',
    companyId: 'bombatech',
    title: 'Contrabando de cartucho',
    body: [
      'Dizem que entrou carga. Dizem baixo, mas todo mundo ouviu.',
      'Caixa de cartucho aparece em quantidade suspeita.',
      'De repente sobra munição onde ontem só tinha desculpa.',
      'Preço recua, estoque incha.',
      'Mercado informal enche o bolso de quem vende volume.',
      'Munição mais barata por enquanto.',
    ].join('\n'),
  },
  {
    archetype: 'demand_slump',
    category: 'veiculo',
    companyId: 'uno_motors',
    title: 'Inflação come o bolso',
    body: [
      'Pão subiu, passagem subiu, e o povo ainda quer carro de filme.',
      'No mercado de rua a grana sumiu primeiro.',
      'Veículo e rifle param de girar.',
      'Vendedor baixa a postura pra não ficar com pátio lotado.',
      'Quem esperou “pra ver” talvez tenha acertado o timing.',
      'Itens caros freiam. O bolso agradece.',
    ].join('\n'),
  },
  {
    archetype: 'profit_take',
    category: 'arma',
    companyId: 'bombatech',
    title: 'Galeria esfria depois da alta',
    body: [
      'Quem comprou cedo já realizou. O resto fica olhando o gráfico torto.',
      'Vendedor para de falar “última unidade” e começa a falar “promocão”.',
      'Arma e munição perdem o FOMO da manhã.',
      'O bairro respira. O ego de quem pagou o topo, não.',
      'Mercado corrige. Ninguém admite que comprou no pico.',
      'Hoje o aço desce um degrau.',
    ].join('\n'),
  },
  {
    archetype: 'demand_boom',
    category: 'veiculo',
    companyId: 'uno_motors',
    title: 'Corrida de moto no fim de semana',
    body: [
      'Sábado à noite a avenida virou autódromo improvisado.',
      'Grito de escapamento, aposta no zap.',
      'Demanda por duas rodas sobe junto com o volume do som.',
      'Oficina e mercado de rua anotam o preço novo.',
      'Quem tem moto vira astro; quem não tem, filma.',
      'Fim de semana de corrida: bolso um pouco mais leve.',
    ].join('\n'),
  },
  {
    archetype: 'austerity_soft',
    category: 'arma',
    companyId: 'bombatech',
    title: 'Blitze e bolso vazio',
    body: [
      'Centro fechado em blitze. Luz no rosto, nervoso no ar.',
      'Quem andava “preparado” preferiu deixar o kit em casa.',
      'No underground sobra conversa e falta grana.',
      'Preço de arma não aguenta o clima de fiscalização.',
      'Rumor: “tá quente”. Mercado: “então ninguém compra”.',
      'Hoje o aço esfria.',
    ].join('\n'),
  },
  {
    archetype: 'meme_spike',
    category: 'arma',
    companyId: 'patocoin',
    title: 'PatoCoin viraliza no grupo',
    body: [
      'Ninguém sabe por quê. Todo mundo jura que sabe.',
      'Print de gráfico torto, sticker de pato, FOMO coletivo.',
      'Do nada o bairro trata peixeira como “ativo”.',
      'Quem comprou cedo grita no zap.',
      'Pode ser ouro. Pode ser armadilha.',
      'Onda meme curta — sobe um pouco, pergunta depois.',
    ].join('\n'),
  },
  {
    archetype: 'soft_recovery',
    category: 'combustivel',
    companyId: 'burgerzap',
    title: 'Semana morna no bazar',
    body: [
      'Nem fila, nem blitze, nem caminhão tombado.',
      'O mercado respira. Preço anda de lado.',
      'Quem vivia de susto reclama que “tá sem conteúdo”.',
      'Vendedor varre a calçada e finge que o gráfico importa.',
      'Às vezes o drama é não ter drama.',
      'Normalização chata — e saudável pro bolso.',
    ].join('\n'),
  },
  {
    archetype: 'liquidity_flood',
    category: 'arma',
    companyId: 'bombatech',
    title: 'Lote barato no desmanche',
    body: [
      'Chegou um lote. Ninguém sabe de onde. Todo mundo sabe o preço: barato.',
      'Peixeira e canivete com desconto de quem não pergunta origem.',
      'Excesso puxa o valor pra baixo.',
      'Vendedor pede pra levar duas.',
      'Hoje o aço tá em promoção.',
      'A vergonha de quem pagou caro ontem, inclusa.',
    ].join('\n'),
  },
]);

export function sampleImpactFromArchetype(archetypeId, random = Math.random) {
  const arch = getArchetype(archetypeId);
  if (!arch) return null;
  return {
    archetype: arch.id,
    supplyDelta: sampleRange(arch.supplyDelta, random),
    demandDelta: sampleRange(arch.demandDelta, random),
    shockPct: sampleRange(arch.shockPct, random),
    rumorOnly: Boolean(arch.rumorOnly),
    label: arch.label,
    bias: arch.bias || 'flat',
  };
}

/**
 * Resolve foco coerente: categoria define a empresa (não o contrário solto).
 */
export function resolveEventFocus(archetypeId, proposal = {}, random = Math.random) {
  const arch = getArchetype(archetypeId) || EVENT_ARCHETYPES.soft_recovery;
  let category = String(proposal.category || '').toLowerCase();
  const allowedCats = arch.goodForCategories || [];

  if (category && allowedCats.length && !allowedCats.includes(category)) {
    category = '';
  }

  if (!category) {
    const pool = allowedCats.length
      ? allowedCats
      : [arch.defaultCategory, 'combustivel', 'municao', 'arma', 'veiculo', 'defesa'].filter(
          Boolean
        );
    category = pool[Math.floor(random() * pool.length)] || arch.defaultCategory || 'combustivel';
  }

  // empresa SEMPRE alinhada à categoria do item (evita "Uno Motors · arma")
  const fromCat = companyForCategory(category);
  let companyId = fromCat?.id || 'burgerzap';

  // se a IA pediu empresa que casa com a categoria, ok; senão ignora
  const proposed = String(proposal.companyId || proposal.focusCompany || '').toLowerCase();
  if (proposed && getCompany(proposed)) {
    const cats = categoriesForCompany(proposed);
    if (cats.includes(category)) companyId = proposed;
  }

  return {
    companyId,
    category,
    company: getCompany(companyId),
  };
}

/**
 * @param {string[]} recentArchetypes
 * @param {() => number} random
 * @param {string|null} biasId
 * @param {number} [overheat=0] — 0..2+ quanto o mercado está acima do base
 */
export function pickArchetypeWeighted(
  recentArchetypes = [],
  random = Math.random,
  biasId = null,
  overheat = 0
) {
  if (biasId && getArchetype(biasId)) {
    if (random() < 0.45) return biasId;
  }
  const recent = recentArchetypes.slice(-8);
  const heat = clamp(Number(overheat) || 0, 0, 3);

  const entries = ARCHETYPE_IDS.map((id) => {
    const arch = EVENT_ARCHETYPES[id];
    let w = arch.weight;
    const times = recent.filter((x) => x === id).length;
    if (times > 0) w *= Math.pow(0.4, times);

    // mercado quente → favorece queda / normalização
    if (heat > 0.25) {
      if (arch.bias === 'down') w *= 1 + heat * 1.6;
      if (arch.bias === 'up') w *= Math.max(0.15, 1 - heat * 0.55);
      if (arch.bias === 'flat') w *= 1 + heat * 0.35;
    }
    // mercado frio (preços no chão) → um pouco mais de alta
    if (heat < -0.15) {
      if (arch.bias === 'up') w *= 1.25;
      if (arch.bias === 'down') w *= 0.7;
    }

    return { id, weight: w, archetype: id };
  });
  const picked = pickWeighted(entries, random);
  return picked?.id || 'soft_recovery';
}

/** Cap de exibição / sanity (choque real é ainda menor no motor). */
export function clampShockPct(pct) {
  return clamp(Math.round(Number(pct) || 0), -18, 18);
}
