export const AVATAR_SLOTS = Object.freeze(['hair_face', 'outfit', 'optional_accessory']);

export const AVATAR_ITEMS = Object.freeze([
  { id: 'base_face', name: 'Cara do Beco', emoji: '🙂', slot: 'hair_face', unlockLevel: 1, cost: 0, category: 'free' },
  { id: 'cabelo_caos', name: 'Cabelo do caos', emoji: '💇', slot: 'hair_face', unlockLevel: 3, cost: 0, category: 'level' },
  { id: 'oculos_pixel', name: 'Óculos pixel', emoji: '🤓', slot: 'hair_face', unlockLevel: 1, cost: 180, category: 'premium' },
  { id: 'camiseta_beco', name: 'Camiseta do Beco', emoji: '👕', slot: 'outfit', unlockLevel: 1, cost: 0, category: 'free' },
  { id: 'jaqueta_neon', name: 'Jaqueta neon', emoji: '🧥', slot: 'outfit', unlockLevel: 5, cost: 0, category: 'level' },
  { id: 'terno_suspeito', name: 'Terno suspeito', emoji: '🕴️', slot: 'outfit', unlockLevel: 1, cost: 420, category: 'premium' },
  { id: 'sem_acessorio', name: 'Sem acessório', emoji: '➖', slot: 'optional_accessory', unlockLevel: 1, cost: 0, category: 'free' },
  { id: 'corrente_brilho', name: 'Corrente de brilho', emoji: '📿', slot: 'optional_accessory', unlockLevel: 4, cost: 0, category: 'level' },
  { id: 'coroa_papel', name: 'Coroa de papel', emoji: '👑', slot: 'optional_accessory', unlockLevel: 1, cost: 520, category: 'premium' },
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
