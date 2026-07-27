/**
 * Catálogo de cartas colecionáveis — parse dos arquivos em fun/assets/cards/.
 * Nome: "CACHORRO AQUATICO TIER 2.jpg" → espécie, variante, tier.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CARDS_DIR = path.resolve(__dirname, '../assets/cards');

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

/** Peso de drop por tier (quanto maior, mais comum). */
export const TIER_DROP_WEIGHTS = Object.freeze({
  1: 50,
  2: 28,
  3: 14,
  4: 6,
  5: 2,
});

export const PACK_COST = 30;
/** Máx. packs por comando — limita grid de reveal a 4 imagens. */
export const MAX_PACKS_PER_OPEN = 4;

/** @type {Map<string, import('./cards.js').CardDef> | null} */
let catalogCache = null;

/**
 * @typedef {object} CardDef
 * @property {string} key        — id estável (slug do arquivo sem extensão)
 * @property {string} species    — ex.: CACHORRO
 * @property {string} variant    — resto do nome (ex.: AQUATICO)
 * @property {string} displayName — espécie + variante
 * @property {number} tier       — 1..5
 * @property {string} imageFile  — nome do arquivo
 * @property {string} imagePath  — path absoluto
 */

/**
 * @param {string} filename
 * @returns {CardDef | null}
 */
export function parseCardFilename(filename) {
  const raw = String(filename || '').trim();
  if (!raw) return null;
  const ext = path.extname(raw).toLowerCase();
  if (!IMAGE_EXT.has(ext)) return null;
  const base = path.basename(raw, ext).trim();
  const m = base.match(/^(.+?)\s+TIER\s+(\d+)\s*$/i);
  if (!m) return null;
  const tier = Math.min(5, Math.max(1, Math.floor(Number(m[2]) || 0)));
  if (!tier) return null;
  const rest = String(m[1] || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!rest) return null;
  const words = rest.split(' ');
  const species = words[0] || 'CACHORRO';
  const variant = words.slice(1).join(' ') || species;
  const key = slugifyCardKey(base);
  return {
    key,
    species,
    variant,
    displayName: rest,
    tier,
    imageFile: path.basename(raw),
    imagePath: path.join(CARDS_DIR, path.basename(raw)),
  };
}

export function slugifyCardKey(base) {
  return String(base || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

/**
 * Carrega (e cacheia) o catálogo a partir do disco.
 * @param {{ force?: boolean, dir?: string }} [opts]
 * @returns {CardDef[]}
 */
export function loadCardCatalog(opts = {}) {
  if (catalogCache && !opts.force) {
    return [...catalogCache.values()];
  }
  const dir = opts.dir || CARDS_DIR;
  /** @type {Map<string, CardDef>} */
  const map = new Map();
  let files = [];
  try {
    files = fs.readdirSync(dir);
  } catch {
    catalogCache = map;
    return [];
  }
  for (const file of files) {
    const def = parseCardFilename(file);
    if (!def) continue;
    // path absoluto real
    def.imagePath = path.join(dir, def.imageFile);
    if (!map.has(def.key)) map.set(def.key, def);
  }
  catalogCache = map;
  return [...map.values()];
}

export function getCardCatalog() {
  if (!catalogCache) loadCardCatalog();
  return catalogCache || new Map();
}

/** @param {string} key */
export function getCardDef(key) {
  const cat = getCardCatalog();
  return cat.get(String(key || '')) || null;
}

/** @param {number} tier */
export function listCardsByTier(tier) {
  const t = Math.min(5, Math.max(1, Math.floor(Number(tier) || 1)));
  return loadCardCatalog().filter((c) => c.tier === t);
}

/**
 * Sorteia uma carta do catálogo com peso por tier.
 * @param {() => number} [random]
 * @returns {CardDef | null}
 */
export function rollRandomCard(random = Math.random) {
  const all = loadCardCatalog();
  if (!all.length) return null;

  const byTier = new Map();
  for (const c of all) {
    if (!byTier.has(c.tier)) byTier.set(c.tier, []);
    byTier.get(c.tier).push(c);
  }

  let totalW = 0;
  const tiers = [];
  for (const [tier, list] of byTier) {
    if (!list.length) continue;
    const w = TIER_DROP_WEIGHTS[tier] ?? 1;
    totalW += w;
    tiers.push({ tier, list, w });
  }
  if (!totalW) return null;

  let r = random() * totalW;
  let chosenList = tiers[0].list;
  for (const row of tiers) {
    r -= row.w;
    if (r <= 0) {
      chosenList = row.list;
      break;
    }
  }
  const idx = Math.floor(random() * chosenList.length);
  return chosenList[Math.min(chosenList.length - 1, Math.max(0, idx))] || null;
}

/** Estrelas / label de raridade. */
export function tierLabel(tier) {
  const t = Math.min(5, Math.max(1, Math.floor(Number(tier) || 1)));
  return `${'★'.repeat(t)}${'☆'.repeat(5 - t)} T${t}`;
}

export function formatCardLine(card, { shortId = true } = {}) {
  if (!card) return '• (carta inválida)';
  const id = shortId ? String(card.id || '').slice(0, 8) : String(card.id || '');
  const fav = card.favorite ? ' ⭐' : '';
  const listed = card.listed ? ' 📌' : '';
  return `• \`${id}\` *${card.displayName || card.cardName}* ${tierLabel(card.tier)}${fav}${listed}`;
}

/** Invalida cache (testes). */
export function _resetCardCatalogCache() {
  catalogCache = null;
}
