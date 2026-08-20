/**
 * Catálogo estático do bairro. Casas não são ativos de mercado: os preços são
 * deliberadamente fixos para manter a economia previsível.
 */

export const HOUSE_GRID = Object.freeze({ columns: 6, rows: 8 });

export const HOUSE_STYLE_SLOTS = Object.freeze({
  wallpaper: 'wallStyle',
  floor: 'floorStyle',
  window: 'windowStyle',
});

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
  { id: 'sofa_inicial', name: 'Sofá de entrada', emoji: '🛋️', cost: 0, kind: 'furniture', category: 'decor', description: 'O primeiro conforto do beco.', capacity: 1, incomePerTick: 0, cleanlinessPerTick: 0, durability: 100, securityLevel: 0, width: 2, depth: 1, sitHeight: 0.4 },
  { id: 'planta_inicial', name: 'Planta sobrevivente', emoji: '🪴', cost: 0, kind: 'furniture', category: 'decor', description: 'Folhas vivas em vaso de terracota.', capacity: 1, incomePerTick: 0, cleanlinessPerTick: 1, durability: 100, securityLevel: 0, width: 1, depth: 1 },
  { id: 'tapete_rua', name: 'Tapete da rua', emoji: '🧶', cost: 75, kind: 'furniture', category: 'decor', description: 'Trama artesanal com franjas.', capacity: 1, incomePerTick: 0, cleanlinessPerTick: 0, durability: 100, securityLevel: 0, width: 2, depth: 2, isSurface: true, stackHeight: 0.01 },
  { id: 'mesa_cafe', name: 'Mesa de café', emoji: '☕', cost: 120, kind: 'furniture', category: 'decor', description: 'Mesa baixa de madeira com caneca.', capacity: 1, incomePerTick: 0, cleanlinessPerTick: 0, durability: 100, securityLevel: 0, width: 2, depth: 1, isSurface: true, stackHeight: 0.6 },
  { id: 'vaso_flores', name: 'Vaso florido', emoji: '💐', cost: 130, kind: 'furniture', category: 'decor', description: 'Um ponto de cor para qualquer canto.', capacity: 1, incomePerTick: 0, cleanlinessPerTick: 1, durability: 100, securityLevel: 0, width: 1, depth: 1 },
  { id: 'luminaria_neon', name: 'Luminária neon', emoji: '💡', cost: 160, kind: 'furniture', category: 'decor', description: 'Luz ambiente azul-ciano.', capacity: 1, incomePerTick: 0, cleanlinessPerTick: 0, durability: 100, securityLevel: 0, width: 1, depth: 1, hasStates: true },
  { id: 'puff_estrela', name: 'Puff estrela', emoji: '⭐', cost: 175, kind: 'furniture', category: 'decor', description: 'Assento macio em forma de estrela.', capacity: 1, incomePerTick: 0, cleanlinessPerTick: 0, durability: 100, securityLevel: 0, width: 1, depth: 1, sitHeight: 0.3 },
  { id: 'poltrona_vintage', name: 'Poltrona vintage', emoji: '🪑', cost: 230, kind: 'furniture', category: 'decor', description: 'Poltrona funda com acabamento vinho.', capacity: 1, incomePerTick: 0, cleanlinessPerTick: 0, durability: 100, securityLevel: 0, width: 1, depth: 1, sitHeight: 0.4 },
  { id: 'estante_caotica', name: 'Estante caótica', emoji: '🗄️', cost: 240, kind: 'furniture', category: 'decor', description: 'Livros, segredos e nenhuma ordem.', capacity: 1, incomePerTick: 0, cleanlinessPerTick: 0, durability: 100, securityLevel: 0, width: 2, depth: 1, isSurface: true, stackHeight: 1.2 },
  { id: 'tv_tubo', name: 'TV de tubo', emoji: '📺', cost: 320, kind: 'furniture', category: 'decor', description: 'Chiado retrô e tela turquesa.', capacity: 1, incomePerTick: 0, cleanlinessPerTick: 0, durability: 100, securityLevel: 0, width: 1, depth: 1, hasStates: true },
  { id: 'cama_nuvem', name: 'Cama nuvem', emoji: '🛏️', cost: 380, kind: 'furniture', category: 'decor', description: 'Cobertor claro e travesseiros fofos.', capacity: 1, incomePerTick: 0, cleanlinessPerTick: 0, durability: 100, securityLevel: 0, width: 2, depth: 2, layFlat: true, sitHeight: 0.3 },
  { id: 'jukebox_neon', name: 'Jukebox neon', emoji: '🎶', cost: 440, kind: 'furniture', category: 'decor', description: 'Música e brilho para a sala.', capacity: 1, incomePerTick: 0, cleanlinessPerTick: 0, durability: 100, securityLevel: 0, width: 1, depth: 1, hasStates: true },
  { id: 'geladeira_premium', name: 'Geladeira premium', emoji: '🧊', cost: 480, kind: 'furniture', category: 'decor', description: 'Fria por dentro, sofisticada por fora.', capacity: 1, incomePerTick: 0, cleanlinessPerTick: 0, durability: 100, securityLevel: 0, width: 1, depth: 1, hasStates: true },
  { id: 'gato_sindico', name: 'Gato síndico', emoji: '🐈', cost: 700, kind: 'furniture', category: 'pet', description: 'Fiscaliza a casa e derruba objetos.', capacity: 1, incomePerTick: 0, cleanlinessPerTick: -1, durability: 100, securityLevel: 0, width: 1, depth: 1 },
  { id: 'camera_porta', name: 'Câmera de porta', emoji: '📹', cost: 360, kind: 'furniture', category: 'security', description: 'Olho eletrônico do beco.', capacity: 1, incomePerTick: 0, cleanlinessPerTick: 0, durability: 100, securityLevel: 1, width: 1, depth: 1 },

  { id: 'parede_beco', name: 'Violeta do beco', emoji: '🟪', cost: 0, kind: 'wallpaper', category: 'wallpaper', description: 'Listras violetas clássicas.' },
  { id: 'parede_menta', name: 'Folhagem menta', emoji: '🌿', cost: 0, kind: 'wallpaper', category: 'wallpaper', description: 'Verde suave com folhas discretas.' },
  { id: 'parede_tijolo', name: 'Tijolo queimado', emoji: '🧱', cost: 190, kind: 'wallpaper', category: 'wallpaper', description: 'Tijolos quentes com rejunte escuro.' },
  { id: 'parede_noite_neon', name: 'Noite neon', emoji: '🌃', cost: 330, kind: 'wallpaper', category: 'wallpaper', description: 'Azul profundo com filetes luminosos.' },

  { id: 'piso_lilas', name: 'Ladrilho lilás', emoji: '🔳', cost: 0, kind: 'floor', category: 'floor', description: 'O piso original da casa.' },
  { id: 'piso_madeira', name: 'Madeira clara', emoji: '🪵', cost: 0, kind: 'floor', category: 'floor', description: 'Tábuas quentes e aconchegantes.' },
  { id: 'piso_xadrez', name: 'Xadrez café', emoji: '◩', cost: 220, kind: 'floor', category: 'floor', description: 'Contraste clássico em dois tons.' },
  { id: 'piso_galaxia', name: 'Galáxia', emoji: '🌌', cost: 360, kind: 'floor', category: 'floor', description: 'Azul cósmico com brilho sutil.' },

  { id: 'janela_classica', name: 'Janela clássica', emoji: '🪟', cost: 0, kind: 'window', category: 'window', description: 'Quatro vidros e moldura clara.' },
  { id: 'janela_arco', name: 'Janela em arco', emoji: '🌤️', cost: 0, kind: 'window', category: 'window', description: 'Arco alto com luz dourada.' },
  { id: 'janela_panoramica', name: 'Janela panorâmica', emoji: '🏙️', cost: 260, kind: 'window', category: 'window', description: 'Mais vidro, mais bairro.' },
  { id: 'janela_neon', name: 'Janela neon', emoji: '💠', cost: 340, kind: 'window', category: 'window', description: 'Moldura ciano com reflexos rosados.' },
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

export function isHouseStyle(item) {
  return Boolean(item && HOUSE_STYLE_SLOTS[item.kind]);
}

export function getHouseStyleSlot(item) {
  return item ? HOUSE_STYLE_SLOTS[item.kind] || null : null;
}

export function getFootprintDimensions(item, rotation = 0) {
  const normRot = ((Math.floor(Number(rotation) || 0) % 4) + 4) % 4;
  const w = Math.max(1, Number(item?.width) || 1);
  const d = Math.max(1, Number(item?.depth) || 1);
  if (normRot === 1 || normRot === 3) {
    return { width: d, depth: w };
  }
  return { width: w, depth: d };
}

export function getFootprintCells(x, y, item, rotation = 0) {
  const { width, depth } = getFootprintDimensions(item, rotation);
  const cells = [];
  const startX = Math.floor(Number(x) || 0);
  const startY = Math.floor(Number(y) || 0);
  for (let dx = 0; dx < width; dx++) {
    for (let dy = 0; dy < depth; dy++) {
      cells.push({ x: startX + dx, y: startY + dy });
    }
  }
  return cells;
}

export function isHousePositionValid(x, y) {
  const column = Math.floor(Number(x));
  const row = Math.floor(Number(y));
  return Number.isInteger(column) && Number.isInteger(row) &&
    column >= 0 && column < HOUSE_GRID.columns && row >= 0 && row < HOUSE_GRID.rows;
}
