import { listAvatarProducts } from '../../shared/avatar/domain.js';

export const AVATAR_SLOTS = Object.freeze(['body', 'hair_face', 'outfit', 'optional_accessory']);

export const AVATAR_ITEMS = Object.freeze(listAvatarProducts().filter((entry) => entry.legacySlot).map((entry) => Object.freeze({
  id: entry.id,
  name: entry.name,
  emoji: entry.emoji,
  slot: entry.legacySlot,
  unlockLevel: entry.unlockLevel,
  cost: entry.cost,
  category: entry.category,
})));

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
