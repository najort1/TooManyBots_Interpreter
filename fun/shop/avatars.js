export const AVATAR_SLOTS = Object.freeze(['hair_face', 'outfit', 'optional_accessory']);

export const AVATAR_ITEMS = Object.freeze([
  { id: 'base_face', name: 'Cara do Beco', emoji: '🙂', slot: 'hair_face', unlockLevel: 1, cost: 0, category: 'free' },
  { id: 'cabelo_caos', name: 'Cabelo do caos', emoji: '💇', slot: 'hair_face', unlockLevel: 3, cost: 0, category: 'level' },
  { id: 'oculos_pixel', name: 'Óculos pixel', emoji: '🤓', slot: 'hair_face', unlockLevel: 1, cost: 180, category: 'premium' },
  { id: 'cabelo_cacheado', name: 'Cachos do Beco', emoji: '🌀', slot: 'hair_face', unlockLevel: 2, cost: 0, category: 'level' },
  { id: 'franja_azul', name: 'Franja azul', emoji: '💙', slot: 'hair_face', unlockLevel: 5, cost: 0, category: 'level' },
  { id: 'bone_beco', name: 'Boné do Beco', emoji: '🧢', slot: 'hair_face', unlockLevel: 1, cost: 230, category: 'premium' },
  { id: 'bandana_pixel', name: 'Bandana pixel', emoji: '🎗️', slot: 'hair_face', unlockLevel: 1, cost: 260, category: 'premium' },
  { id: 'mascara_misterio', name: 'Máscara do mistério', emoji: '🎭', slot: 'hair_face', unlockLevel: 8, cost: 0, category: 'level' },
  { id: 'cabelo_rosa', name: 'Cabelo chiclete', emoji: '🌸', slot: 'hair_face', unlockLevel: 1, cost: 320, category: 'premium' },
  { id: 'chapeu_pescador', name: 'Chapéu pescador', emoji: '👒', slot: 'hair_face', unlockLevel: 12, cost: 0, category: 'level' },
  { id: 'camiseta_beco', name: 'Camiseta do Beco', emoji: '👕', slot: 'outfit', unlockLevel: 1, cost: 0, category: 'free' },
  { id: 'jaqueta_neon', name: 'Jaqueta neon', emoji: '🧥', slot: 'outfit', unlockLevel: 5, cost: 0, category: 'level' },
  { id: 'terno_suspeito', name: 'Terno suspeito', emoji: '🕴️', slot: 'outfit', unlockLevel: 1, cost: 420, category: 'premium' },
  { id: 'moletom_nuvem', name: 'Moletom nuvem', emoji: '☁️', slot: 'outfit', unlockLevel: 2, cost: 0, category: 'level' },
  { id: 'camisa_xadrez', name: 'Camisa xadrez', emoji: '🟥', slot: 'outfit', unlockLevel: 1, cost: 240, category: 'premium' },
  { id: 'uniforme_arcade', name: 'Uniforme arcade', emoji: '🕹️', slot: 'outfit', unlockLevel: 6, cost: 0, category: 'level' },
  { id: 'vestido_aurora', name: 'Vestido aurora', emoji: '🌅', slot: 'outfit', unlockLevel: 1, cost: 360, category: 'premium' },
  { id: 'macacao_oficina', name: 'Macacão da oficina', emoji: '🔧', slot: 'outfit', unlockLevel: 9, cost: 0, category: 'level' },
  { id: 'jaqueta_colegial', name: 'Jaqueta colegial', emoji: '🏅', slot: 'outfit', unlockLevel: 1, cost: 440, category: 'premium' },
  { id: 'traje_astral', name: 'Traje astral', emoji: '🚀', slot: 'outfit', unlockLevel: 14, cost: 0, category: 'level' },
  { id: 'sem_acessorio', name: 'Sem acessório', emoji: '➖', slot: 'optional_accessory', unlockLevel: 1, cost: 0, category: 'free' },
  { id: 'corrente_brilho', name: 'Corrente de brilho', emoji: '📿', slot: 'optional_accessory', unlockLevel: 4, cost: 0, category: 'level' },
  { id: 'coroa_papel', name: 'Coroa de papel', emoji: '👑', slot: 'optional_accessory', unlockLevel: 1, cost: 520, category: 'premium' },
  { id: 'fones_neon', name: 'Fones neon', emoji: '🎧', slot: 'optional_accessory', unlockLevel: 1, cost: 280, category: 'premium' },
  { id: 'mochila_lateral', name: 'Mochila lateral', emoji: '🎒', slot: 'optional_accessory', unlockLevel: 4, cost: 0, category: 'level' },
  { id: 'asas_pixel', name: 'Asas pixel', emoji: '🪽', slot: 'optional_accessory', unlockLevel: 1, cost: 650, category: 'premium' },
  { id: 'cachecol_estrelas', name: 'Cachecol de estrelas', emoji: '🧣', slot: 'optional_accessory', unlockLevel: 7, cost: 0, category: 'level' },
  { id: 'bolsa_cogumelo', name: 'Bolsa cogumelo', emoji: '🍄', slot: 'optional_accessory', unlockLevel: 1, cost: 330, category: 'premium' },
  { id: 'aura_vinil', name: 'Aura de vinil', emoji: '💿', slot: 'optional_accessory', unlockLevel: 11, cost: 0, category: 'level' },
]);

const BY_ID = new Map(AVATAR_ITEMS.map((item) => [item.id, item]));

export function getAvatarItem(id) {
  return BY_ID.get(String(id || '').trim()) || null;
}

export function listAvatarItems() {
  return [...AVATAR_ITEMS];
}

export function isAvatarSlot(slot) {
  return AVATAR_SLOTS.includes(String(slot || ''));
}
