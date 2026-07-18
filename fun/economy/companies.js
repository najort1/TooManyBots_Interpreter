/**
 * Personalidades de empresa → padrões de volatilidade naturais.
 * Itens do mercado herdam a personalidade da categoria.
 */

/** @typedef {object} CompanyPersonality
 * @property {string} id
 * @property {string} name
 * @property {string} emoji
 * @property {number} basePrice — âncora de índice (narrativa)
 * @property {number} baseSupply
 * @property {number} baseDemand
 * @property {number} risk — 0..1
 * @property {number} volatility — multiplica noise
 * @property {number} meanReversion — puxa para basePrice
 * @property {number} eventSensitivity
 * @property {number} floorMult
 * @property {number} ceilMult
 * @property {number} flowScaleMult — <1 = ilíquido (Peixaria)
 * @property {number} maxTickDelta — teto de |delta| por tick (Satélite)
 * @property {boolean} memeSpikes — PatoCoin
 * @property {number} dividendYield — âncora de yield (0 = só dinâmico; ver economy/dividends.js)
 * @property {string} flavor
 * @property {string} [blurb] — uma linha humana pro `/bolsa` (texto)
 * @property {string[]} categories — categorias de item que herdam esta persona
 */

/** @type {ReadonlyArray<CompanyPersonality>} */
export const COMPANIES = Object.freeze([
  {
    id: 'burgerzap',
    name: 'BurgerZap',
    emoji: '🍔',
    basePrice: 100,
    baseSupply: 1.1,
    baseDemand: 1.2,
    risk: 0.25,
    volatility: 0.35,
    meanReversion: 0.12,
    eventSensitivity: 0.7,
    floorMult: 0.55,
    ceilMult: 2.2,
    flowScaleMult: 1.0,
    maxTickDelta: 0.12,
    memeSpikes: false,
    dividendYield: 0.015,
    flavor: 'estável, fila no app, dividendos de rua',
    blurb: 'Lanche e licenças do beco. Estável, costuma pagar dividendo.',
    categories: ['licenca'],
  },
  {
    id: 'uno_motors',
    name: 'Uno Motors',
    emoji: '🚗',
    basePrice: 140,
    baseSupply: 1.2,
    baseDemand: 1.0,
    risk: 0.15,
    volatility: 0.2,
    meanReversion: 0.18,
    eventSensitivity: 0.5,
    floorMult: 0.65,
    ceilMult: 1.8,
    flowScaleMult: 1.1,
    maxTickDelta: 0.06,
    memeSpikes: false,
    dividendYield: 0.008,
    flavor: 'estável, metal e roda — paga quando o caixa respira',
    blurb: 'Carros e motos da rua. Calma, mexe pouco, paga quando sobra caixa.',
    categories: ['veiculo'],
  },
  {
    id: 'bombatech',
    name: 'BombaTech',
    emoji: '💣',
    basePrice: 90,
    baseSupply: 0.8,
    baseDemand: 1.1,
    risk: 0.85,
    volatility: 0.95,
    meanReversion: 0.1,
    eventSensitivity: 0.85,
    floorMult: 0.45,
    ceilMult: 2.4,
    flowScaleMult: 0.9,
    maxTickDelta: 0.12,
    memeSpikes: false,
    dividendYield: 0,
    flavor: 'arriscada — dividendo raro de guerra',
    blurb: 'Armas e munição. Volátil — sobe e desce com o caos do bairro.',
    categories: ['arma', 'municao'],
  },
  {
    id: 'peixaria',
    name: 'Peixaria do João',
    emoji: '🐟',
    basePrice: 40,
    baseSupply: 0.9,
    baseDemand: 0.9,
    risk: 0.55,
    volatility: 0.8,
    meanReversion: 0.1,
    eventSensitivity: 0.9,
    floorMult: 0.4,
    ceilMult: 2.2,
    flowScaleMult: 0.35,
    maxTickDelta: 0.12,
    memeSpikes: false,
    dividendYield: 0.002,
    flavor: 'pequena — às vezes sobra peixe pro sócio',
    blurb: 'Gasolina e peixe. Pequena, barata e imprevisível.',
    categories: ['combustivel'],
  },
  {
    id: 'satelite_br',
    name: 'Satélite BR',
    emoji: '🛰️',
    basePrice: 200,
    baseSupply: 1.4,
    baseDemand: 1.3,
    risk: 0.2,
    volatility: 0.25,
    meanReversion: 0.15,
    eventSensitivity: 0.4,
    floorMult: 0.7,
    ceilMult: 1.9,
    flowScaleMult: 1.2,
    maxTickDelta: 0.04,
    memeSpikes: false,
    dividendYield: 0.006,
    flavor: 'gigante — repasse lento e pesado',
    blurb: 'Defesa e colete. Cara, gigante, mexe devagar.',
    categories: ['defesa'],
  },
  {
    id: 'patocoin',
    name: 'PatoCoin',
    emoji: '🦆',
    basePrice: 25,
    baseSupply: 0.7,
    baseDemand: 1.0,
    risk: 0.95,
    volatility: 1.4,
    meanReversion: 0.06,
    eventSensitivity: 1.1,
    floorMult: 0.3,
    ceilMult: 3.5,
    flowScaleMult: 0.5,
    maxTickDelta: 0.18,
    memeSpikes: true,
    dividendYield: 0,
    flavor: 'meme — dividendo raríssimo e gordo',
    blurb: 'Meme do zap. Pode virar ouro ou virar pó.',
    categories: [], // não ancora categoria; entra em spikes aleatórios
  },
]);

const BY_ID = new Map(COMPANIES.map((c) => [c.id, c]));

/** categoria → company id */
const CATEGORY_TO_COMPANY = Object.freeze({
  licenca: 'burgerzap',
  combustivel: 'peixaria',
  municao: 'bombatech',
  arma: 'bombatech',
  veiculo: 'uno_motors',
  defesa: 'satelite_br',
});

export function getCompany(id) {
  return BY_ID.get(String(id || '')) || null;
}

export function listCompanies() {
  return [...COMPANIES];
}

export function companyForCategory(category) {
  const id = CATEGORY_TO_COMPANY[String(category || '').toLowerCase()];
  return (id && BY_ID.get(id)) || BY_ID.get('burgerzap');
}

export function companyForItem(item) {
  if (!item) return BY_ID.get('burgerzap');
  return companyForCategory(item.category);
}

export function categoriesForCompany(companyId) {
  const c = getCompany(companyId);
  if (!c) return [];
  return [...(c.categories || [])];
}

function normalizeToken(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_]/g, '');
}

/**
 * Resolve ticker/nome/prefixo → CompanyPersonality.
 * Ex.: bombatech, bomba, "pato", "uno motors"
 */
export function resolveCompanyToken(query) {
  const t = normalizeToken(query);
  if (!t) return null;
  const byId = getCompany(t);
  if (byId) return byId;

  const aliases = {
    burger: 'burgerzap',
    burgerzap: 'burgerzap',
    zap: 'burgerzap',
    hamburguer: 'burgerzap',
    uno: 'uno_motors',
    unomotors: 'uno_motors',
    motors: 'uno_motors',
    bomba: 'bombatech',
    bombatech: 'bombatech',
    tech: 'bombatech',
    peixe: 'peixaria',
    peixaria: 'peixaria',
    joao: 'peixaria',
    satelite: 'satelite_br',
    satelitebr: 'satelite_br',
    sat: 'satelite_br',
    pato: 'patocoin',
    patocoin: 'patocoin',
    meme: 'patocoin',
  };
  if (aliases[t]) return getCompany(aliases[t]);

  for (const c of COMPANIES) {
    const id = normalizeToken(c.id);
    const name = normalizeToken(c.name);
    if (id === t || name === t) return c;
    if (id.startsWith(t) || name.startsWith(t) || id.includes(t) || name.includes(t)) {
      return c;
    }
  }
  return null;
}

export { CATEGORY_TO_COMPANY };
