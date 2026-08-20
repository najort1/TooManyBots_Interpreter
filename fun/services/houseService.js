import { getFootprintCells, getHouseDefinition, getHouseItem, getHouseStyleSlot, isHousePositionValid, isHouseStyle, listHouseItems } from '../shop/houses.js';

function dayKey(now) { return new Date(Number(now) || Date.now()).toISOString().slice(0, 10); }
function dayStart(now) { const date = new Date(Number(now) || Date.now()); return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()); }
function normalizeRotation(value) { return ((Math.floor(Number(value) || 0) % 4) + 4) % 4; }

function checkFootprintOverlap(placedItems, targetItemDef, targetX, targetY, targetRotation, excludeInstanceId = null) {
  const targetCells = getFootprintCells(targetX, targetY, targetItemDef, targetRotation);
  for (const cell of targetCells) {
    if (!isHousePositionValid(cell.x, cell.y)) {
      return { valid: false, reason: 'invalid-position' };
    }
  }

  // Mapear ocupação dos itens existentes colocados na casa
  for (const existingItem of placedItems) {
    if (excludeInstanceId && existingItem.id === excludeInstanceId) continue;
    const existingDef = getHouseItem(existingItem.itemId);
    if (!existingDef || isHouseStyle(existingDef)) continue;
    const existingCells = getFootprintCells(existingItem.x, existingItem.y, existingDef, existingItem.rotation);

    for (const targetCell of targetCells) {
      for (const existingCell of existingCells) {
        if (targetCell.x === existingCell.x && targetCell.y === existingCell.y) {
          // Se o item existente é uma superfície (ex: mesa) e o novo objeto é pequeno (1x1), permitimos empilhamento no zIndex superior
          const canStack = Boolean(existingDef.isSurface) && (targetItemDef.width || 1) === 1 && (targetItemDef.depth || 1) === 1;
          if (!canStack) {
            return { valid: false, reason: 'occupied-position' };
          }
        }
      }
    }
  }
  return { valid: true };
}

export function createHouseService({ repository, houseRepository } = {}) {
  if (!repository || !houseRepository) throw new Error('[fun/houses] repository obrigatório');
  const enabled = (config = {}) => config.housesEnabled !== false;
  const maxItems = (config = {}) => Math.max(1, Number(config.houseMaxItems) || 24);
  const dailyReward = (house) => Math.max(15, Math.floor(25 + (Number(house?.cleanliness) || 0) * 0.35 + (Number(house?.securityLevel) || 0) * 5));

  function provision({ scopeKey, userJid, now = Date.now() }) {
    let house = houseRepository.ensureHouse({ scopeKey, userJid, houseType: getHouseDefinition('casa_padrao').id, now });
    if (houseRepository.listItems(scopeKey, userJid).length === 0) {
      houseRepository.insertItem({ scopeKey, ownerJid: userJid, itemId: 'sofa_inicial', x: 1, y: 4, now });
      houseRepository.insertItem({ scopeKey, ownerJid: userJid, itemId: 'planta_inicial', x: 4, y: 1, now });
      house = houseRepository.getHouse(scopeKey, userJid);
    }
    return { house, items: houseRepository.listItems(scopeKey, userJid) };
  }
  function getHouse({ scopeKey, userJid, now = Date.now() }) {
    const provisioned = provision({ scopeKey, userJid, now });
    return { ...provisioned, catalog: listHouseItems() };
  }
  function listShop({ scopeKey, userJid, now = Date.now() }) {
    const current = provision({ scopeKey, userJid, now });
    const ownedIds = new Set(current.items.map((item) => item.itemId));
    return listHouseItems().map((item) => {
      const slot = getHouseStyleSlot(item);
      return {
        ...item,
        owned: isHouseStyle(item) ? item.cost <= 0 || ownedIds.has(item.id) : false,
        applied: Boolean(slot && current.house[slot] === item.id),
      };
    });
  }
  function place({ scopeKey, userJid, itemId, x, y, rotation = 0, funConfig = {}, now = Date.now() }) {
    if (!enabled(funConfig)) return { ok: false, reason: 'disabled' };
    const item = getHouseItem(itemId);
    if (!item) return { ok: false, reason: 'unknown-item' };
    if (isHouseStyle(item)) return { ok: false, reason: 'style-use-apply' };
    const normRot = normalizeRotation(rotation);
    const current = provision({ scopeKey, userJid, now });
    const placedItems = current.items.filter((entry) => entry.placed);
    const furnitureCount = placedItems.filter((entry) => !isHouseStyle(getHouseItem(entry.itemId))).length;
    if (furnitureCount >= maxItems(funConfig)) return { ok: false, reason: 'item-cap', max: maxItems(funConfig) };

    const overlapCheck = checkFootprintOverlap(placedItems, item, x, y, normRot);
    if (!overlapCheck.valid) return { ok: false, reason: overlapCheck.reason };

    const stats = repository.getUserStats(userJid, scopeKey) || repository.ensureUserRow(userJid, scopeKey, now);
    if ((Number(stats.coins) || 0) < item.cost) return { ok: false, reason: 'no-coins', need: item.cost, coins: Number(stats.coins) || 0 };
    if (item.cost > 0) repository.addCoins({ userJid, scopeKey, amount: -item.cost, now, reason: 'house-buy:' + item.id });
    const placed = houseRepository.insertItem({ scopeKey, ownerJid: userJid, itemId: item.id, x, y, rotation: normRot, now });
    return { ok: true, item: placed, definition: item, coins: repository.getUserStats(userJid, scopeKey)?.coins || 0 };
  }
  function move({ scopeKey, userJid, itemInstanceId, x, y, rotation, rotated, now = Date.now() }) {
    const item = houseRepository.getItem(itemInstanceId);
    if (!item || item.scopeKey !== String(scopeKey) || item.ownerJid !== String(userJid)) return { ok: false, reason: 'not-owned' };
    const itemDef = getHouseItem(item.itemId);
    if (isHouseStyle(itemDef)) return { ok: false, reason: 'style-use-apply' };
    const nextRotation = rotation == null ? (rotated == null ? item.rotation : (rotated ? 1 : 0)) : normalizeRotation(rotation);

    const placedItems = houseRepository.listItems(scopeKey, userJid, { placed: true });
    const overlapCheck = checkFootprintOverlap(placedItems, itemDef, x, y, nextRotation, item.id);
    if (!overlapCheck.valid) return { ok: false, reason: overlapCheck.reason };

    return { ok: true, item: houseRepository.updateItem(item.id, { x, y, rotation: nextRotation, placed: true }, now) };
  }
  function applyStyle({ scopeKey, userJid, itemId, funConfig = {}, now = Date.now() }) {
    if (!enabled(funConfig)) return { ok: false, reason: 'disabled' };
    const definition = getHouseItem(itemId);
    const slot = getHouseStyleSlot(definition);
    if (!definition || !slot) return { ok: false, reason: 'unknown-style' };
    const current = provision({ scopeKey, userJid, now });
    const owned = definition.cost <= 0 || current.items.some((item) => item.itemId === definition.id);
    if (!owned) {
      const stats = repository.getUserStats(userJid, scopeKey) || repository.ensureUserRow(userJid, scopeKey, now);
      const coins = Number(stats.coins) || 0;
      if (coins < definition.cost) return { ok: false, reason: 'no-coins', need: definition.cost, coins };
      repository.addCoins({ userJid, scopeKey, amount: -definition.cost, now, reason: 'house-style-buy:' + definition.id });
      try {
        houseRepository.insertItem({ scopeKey, ownerJid: userJid, itemId: definition.id, placed: false, now });
      } catch {
        repository.addCoins({ userJid, scopeKey, amount: definition.cost, now, reason: 'house-style-refund:' + definition.id });
        return { ok: false, reason: 'storage-error' };
      }
    }
    const house = houseRepository.updateHouse(scopeKey, userJid, { [slot]: definition.id }, now);
    return { ok: true, house, definition, purchased: !owned, coins: repository.getUserStats(userJid, scopeKey)?.coins || 0 };
  }
  function remove({ scopeKey, userJid, itemInstanceId, now = Date.now() }) {
    const item = houseRepository.getItem(itemInstanceId);
    if (!item || item.scopeKey !== String(scopeKey) || item.ownerJid !== String(userJid)) return { ok: false, reason: 'not-owned' };
    return { ok: true, item: houseRepository.updateItem(item.id, { placed: false }, now) };
  }
  function sell({ scopeKey, userJid, itemInstanceId, now = Date.now() }) {
    const item = houseRepository.getItem(itemInstanceId);
    if (!item || item.scopeKey !== String(scopeKey) || item.ownerJid !== String(userJid)) return { ok: false, reason: 'not-owned' };
    const definition = getHouseItem(item.itemId);
    if (!definition || definition.cost <= 0) return { ok: false, reason: 'not-sellable' };
    if (isHouseStyle(definition)) return { ok: false, reason: 'style-not-sellable' };
    const coins = Math.max(1, Math.floor(definition.cost * 0.5));
    houseRepository.deleteItem(item.id);
    repository.addCoins({ userJid, scopeKey, amount: coins, now, reason: 'house-sell:' + definition.id });
    return { ok: true, coins, item: { ...item, definition }, balance: repository.getUserStats(userJid, scopeKey)?.coins || 0 };
  }
  function clean({ scopeKey, userJid, funConfig = {}, now = Date.now() }) {
    if (!enabled(funConfig)) return { ok: false, reason: 'disabled' };
    const house = provision({ scopeKey, userJid, now }).house;
    const today = dayKey(now);
    if (house.lastCleanDay === today) return { ok: false, reason: 'cooldown', nextAt: dayStart(now) + 24 * 60 * 60_000 };
    const next = houseRepository.updateHouse(scopeKey, userJid, { cleanliness: Math.min(100, house.cleanliness + 25), lastCleanDay: today }, now);
    return { ok: true, house: next };
  }
  function collect({ scopeKey, userJid, funConfig = {}, now = Date.now() }) {
    if (!enabled(funConfig)) return { ok: false, reason: 'disabled' };
    const house = provision({ scopeKey, userJid, now }).house;
    const today = dayKey(now);
    if (house.lastCollectDay === today) return { ok: false, reason: 'cooldown', nextAt: dayStart(now) + 24 * 60 * 60_000 };
    const coins = dailyReward(house);
    repository.addCoins({ userJid, scopeKey, amount: coins, now, reason: 'house-collect' });
    const next = houseRepository.updateHouse(scopeKey, userJid, { cleanliness: Math.max(0, house.cleanliness - 8), lastCollectDay: today }, now);
    return { ok: true, coins, reason: 'house-collect', house: next, balance: repository.getUserStats(userJid, scopeKey)?.coins || 0 };
  }
  function upgradeSecurity({ scopeKey, userJid, funConfig = {}, now = Date.now() }) {
    const house = provision({ scopeKey, userJid, now }).house;
    const max = Math.max(0, Number(funConfig.houseSecurityMaxLevel) || 3);
    if (house.securityLevel >= max) return { ok: false, reason: 'security-max' };
    const cost = 200 * (house.securityLevel + 1);
    const stats = repository.getUserStats(userJid, scopeKey) || repository.ensureUserRow(userJid, scopeKey, now);
    if ((Number(stats.coins) || 0) < cost) return { ok: false, reason: 'no-coins', need: cost, coins: Number(stats.coins) || 0 };
    repository.addCoins({ userJid, scopeKey, amount: -cost, now, reason: 'house-security-upgrade' });
    return { ok: true, cost, house: houseRepository.updateHouse(scopeKey, userJid, { securityLevel: house.securityLevel + 1 }, now), coins: repository.getUserStats(userJid, scopeKey)?.coins || 0 };
  }
  function toggleState({ scopeKey, userJid, itemInstanceId, now = Date.now() }) {
    const item = houseRepository.getItem(itemInstanceId);
    if (!item || item.scopeKey !== String(scopeKey) || item.ownerJid !== String(userJid)) return { ok: false, reason: 'not-owned' };
    const itemDef = getHouseItem(item.itemId);
    if (!itemDef || !itemDef.hasStates) return { ok: false, reason: 'no-states' };
    const nextState = item.state === 1 ? 0 : 1;
    const updated = houseRepository.updateItem(item.id, { state: nextState }, now);
    return { ok: true, item: updated };
  }

  return { provision, getHouse, listCatalog: listHouseItems, listShop, place, move, toggleState, applyStyle, remove, sell, clean, collect, upgradeSecurity };
}
