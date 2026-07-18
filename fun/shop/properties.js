/**
 * Catálogo de negócios (renda passiva em buffer).
 * Valores recalibrados à economia real (daily 50c, heist ~150–340c).
 */

/** @typedef {'low'|'medium'|'high'} SecurityLevel */

/**
 * @typedef {object} PropertyDef
 * @property {string} id
 * @property {string} name
 * @property {string} emoji
 * @property {number} cost
 * @property {number} incomePerTick
 * @property {number} bufferCap
 * @property {SecurityLevel} security
 * @property {string} description
 * @property {number} stealRatio — fração do buffer roubável no assalto
 * @property {number} damageMin
 * @property {number} damageMax
 */

/** @type {ReadonlyArray<PropertyDef>} */
export const PROPERTIES = Object.freeze([
  {
    id: 'barraca',
    name: 'Barraca de Pastel',
    emoji: '🥟',
    cost: 900,
    incomePerTick: 8,
    bufferCap: 80,
    security: 'low',
    description: 'Entrada barata. Rende pouco e todo mundo sabe onde fica o caixa.',
    stealRatio: 0.55,
    damageMin: 12,
    damageMax: 25,
  },
  {
    id: 'cassino_clandestino',
    name: 'Cassino Clandestino',
    emoji: '🎰',
    cost: 4500,
    incomePerTick: 28,
    bufferCap: 280,
    security: 'medium',
    description: 'Meio-jogo. Rende bem, mas a Receita cospe no chão quando passa.',
    stealRatio: 0.35,
    damageMin: 10,
    damageMax: 20,
  },
  {
    id: 'firma_lavagem',
    name: 'Firma de Lavagem',
    emoji: '🧼',
    cost: 14000,
    incomePerTick: 55,
    bufferCap: 550,
    security: 'high',
    description: 'Late-game BombaTech. Caixa gordo, segurança alta.',
    stealRatio: 0.18,
    damageMin: 6,
    damageMax: 14,
  },
]);

const BY_ID = new Map(PROPERTIES.map((p) => [p.id, p]));

/** aliases de compra: pastel → barraca */
const ALIASES = Object.freeze({
  barraca: 'barraca',
  pastel: 'barraca',
  pastell: 'barraca',
  cassino: 'cassino_clandestino',
  cassino_clandestino: 'cassino_clandestino',
  clandestino: 'cassino_clandestino',
  firma: 'firma_lavagem',
  lavagem: 'firma_lavagem',
  firma_lavagem: 'firma_lavagem',
  bombatech: 'firma_lavagem',
});

export function listProperties() {
  return [...PROPERTIES];
}

export function getProperty(id) {
  const key = String(id || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_]/g, '');
  if (!key) return null;
  const resolved = ALIASES[key] || key;
  return BY_ID.get(resolved) || null;
}

export function securityLabel(level) {
  if (level === 'high') return 'Alta';
  if (level === 'medium') return 'Média';
  return 'Baixa';
}
