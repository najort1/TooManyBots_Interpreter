/**
 * Returns the cost of the products that are present in a draft but are not yet
 * owned. Multiple modular pieces from the same product are charged only once.
 */
export function getPendingAvatarPurchaseTotal(slots, catalog) {
  const catalogByItemId = new Map((catalog || []).map((item) => [item.id, item]));
  const pendingProducts = new Set();
  let total = 0;

  for (const itemId of Object.values(slots || {})) {
    const item = catalogByItemId.get(itemId);
    if (!item || item.owned || item.cost === 0 || pendingProducts.has(item.sourceProductId)) continue;
    pendingProducts.add(item.sourceProductId);
    total += Number(item.cost) || 0;
  }

  return total;
}

/**
 * Prevents a draft from selecting a level-locked or unaffordable item before
 * the user reaches the confirmation step.
 */
export function getAvatarSelectionBlockReason(item, slots, avatar) {
  if (item.owned) return null;
  if (item.cost === 0) return 'level';
  const nextSlots = { ...slots, [item.slot]: item.id };
  return getPendingAvatarPurchaseTotal(nextSlots, avatar.catalog) > avatar.coins ? 'coins' : null;
}
