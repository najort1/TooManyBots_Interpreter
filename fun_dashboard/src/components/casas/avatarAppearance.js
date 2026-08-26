import {
  getAvatarVisualKey as createAvatarVisualKey,
  getAvatarItem,
  getAvatarProduct,
  normalizeAvatarSlots,
} from '../../../../shared/avatar/domain.js';
import { migrateLegacyAvatarState } from '../../../../shared/avatar/legacyMigration.js';
import { getAvatarPalette } from './avatar/recipes.js';

/** @param {string} top */
export function getAvatarOutfitColor(top) {
  return getAvatarPalette({ top }).top;
}

/** @param {string} slot @param {string} itemId */
export function hasAvatarVisual(slot, itemId) {
  const product = getAvatarProduct(itemId);
  if (product?.legacySlot === slot) {
    return Object.entries(product.grants).every(([grantedSlot, grantedItemId]) => (
      grantedItemId === 'none' || getAvatarItem(grantedItemId)?.slot === grantedSlot
    ));
  }

  return getAvatarItem(itemId)?.slot === slot;
}

/** @param {{ slots?: Record<string, string> } | null | undefined} avatar */
export function getAvatarVisualKey(avatar) {
  const source = avatar?.slots || {};
  const slots = 'hair_face' in source || 'outfit' in source
    ? migrateLegacyAvatarState({ slots: source }).slots
    : normalizeAvatarSlots(source);
  return createAvatarVisualKey({ slots });
}
