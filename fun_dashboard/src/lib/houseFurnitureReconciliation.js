function placed(items) {
  return items.filter((item) => item.placed && !item.stolen);
}

export function reconcileFurnitureItems(previousItems, nextItems) {
  const previous = new Map(placed(previousItems).map((item) => [item.id, item]));
  const next = new Map(placed(nextItems).map((item) => [item.id, item]));
  const removeIds = [];
  const createItems = [];
  const updateItems = [];

  for (const [id] of previous) {
    if (!next.has(id)) removeIds.push(id);
  }
  for (const [id, item] of next) {
    const current = previous.get(id);
    if (!current) {
      createItems.push(item);
      continue;
    }
    if (current.itemId !== item.itemId) {
      removeIds.push(id);
      createItems.push(item);
      continue;
    }
    if (current.x !== item.x || current.y !== item.y || current.rotation !== item.rotation || current.rotated !== item.rotated) {
      updateItems.push(item);
    }
  }

  return { removeIds, createItems, updateItems };
}
