/**
 * Catálogo estático do bairro. Casas não são ativos de mercado: os preços são
 * deliberadamente fixos para manter a economia previsível.
 */

export const HOUSE_GRID = Object.freeze({ columns: 6, rows: 8 });

export const HOUSE_CATALOG = Object.freeze([
  {
    id: 'casa_padrao',
    name: 'Casa do Beco',
    emoji: '🏠',
    cost: 0,
    category: 'house',
    capacity: 24,
    incomePerTick: 0,
    cleanlinessPerTick: 0,
    durability: 100,
    securityLevel: 0,
  },
]);

export const HOUSE_ITEMS = Object.freeze([
  { id: 'sofa_inicial', name: 'Sofá de entrada', emoji: '🛋️', cost: 0, category: 'decor', capacity: 1, incomePerTick: 0, cleanlinessPerTick: 0, durability: 100, securityLevel: 0 },
  { id: 'planta_inicial', name: 'Planta sobrevivente', emoji: '🪴', cost: 0, category: 'decor', capacity: 1, incomePerTick: 0, cleanlinessPerTick: 1, durability: 100, securityLevel: 0 },
  { id: 'tapete_rua', name: 'Tapete da rua', emoji: '🟫', cost: 75, category: 'decor', capacity: 1, incomePerTick: 0, cleanlinessPerTick: 0, durability: 100, securityLevel: 0 },
  { id: 'luminaria_neon', name: 'Luminária neon', emoji: '💡', cost: 160, category: 'decor', capacity: 1, incomePerTick: 0, cleanlinessPerTick: 0, durability: 100, securityLevel: 0 },
  { id: 'estante_caotica', name: 'Estante caótica', emoji: '🗄️', cost: 240, category: 'decor', capacity: 1, incomePerTick: 0, cleanlinessPerTick: 0, durability: 100, securityLevel: 0 },
  { id: 'tv_tubo', name: 'TV de tubo', emoji: '📺', cost: 320, category: 'decor', capacity: 1, incomePerTick: 0, cleanlinessPerTick: 0, durability: 100, securityLevel: 0 },
  { id: 'geladeira_premium', name: 'Geladeira premium', emoji: '🧊', cost: 480, category: 'decor', capacity: 1, incomePerTick: 0, cleanlinessPerTick: 0, durability: 100, securityLevel: 0 },
  { id: 'gato_sindico', name: 'Gato síndico', emoji: '🐈', cost: 700, category: 'pet', capacity: 1, incomePerTick: 0, cleanlinessPerTick: -1, durability: 100, securityLevel: 0 },
  { id: 'camera_porta', name: 'Câmera de porta', emoji: '📹', cost: 360, category: 'security', capacity: 1, incomePerTick: 0, cleanlinessPerTick: 0, durability: 100, securityLevel: 1 },
]);

const HOUSE_BY_ID = new Map(HOUSE_CATALOG.map((item) => [item.id, item]));
const ITEM_BY_ID = new Map(HOUSE_ITEMS.map((item) => [item.id, item]));

export function getHouseDefinition(id) {
  return HOUSE_BY_ID.get(String(id || '').trim()) || null;
}

export function getHouseItem(id) {
  return ITEM_BY_ID.get(String(id || '').trim()) || null;
}

export function listHouseItems() {
  return [...HOUSE_ITEMS];
}

export function isHousePositionValid(x, y) {
  const column = Math.floor(Number(x));
  const row = Math.floor(Number(y));
  return Number.isInteger(column) && Number.isInteger(row) &&
    column >= 0 && column < HOUSE_GRID.columns && row >= 0 && row < HOUSE_GRID.rows;
}
