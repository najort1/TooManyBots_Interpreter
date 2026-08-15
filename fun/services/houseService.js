import { getHouseDefinition, getHouseItem, isHousePositionValid, listHouseItems } from '../shop/houses.js';

function dayKey(now) { return new Date(Number(now) || Date.now()).toISOString().slice(0, 10); }
function dayStart(now) { const date = new Date(Number(now) || Date.now()); return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()); }

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
  function place({ scopeKey, userJid, itemId, x, y, funConfig = {}, now = Date.now() }) {
    if (!enabled(funConfig)) return { ok: false, reason: 'disabled' };
    if (!isHousePositionValid(x, y)) return { ok: false, reason: 'invalid-position' };
    const item = getHouseItem(itemId);
    if (!item) return { ok: false, reason: 'unknown-item' };
    const current = provision({ scopeKey, userJid, now });
    if (current.items.length >= maxItems(funConfig)) return { ok: false, reason: 'item-cap', max: maxItems(funConfig) };
    const stats = repository.getUserStats(userJid, scopeKey) || repository.ensureUserRow(userJid, scopeKey, now);
    if ((Number(stats.coins) || 0) < item.cost) return { ok: false, reason: 'no-coins', need: item.cost, coins: Number(stats.coins) || 0 };
    if (item.cost > 0) repository.addCoins({ userJid, scopeKey, amount: -item.cost, now, reason: 'house-buy:' + item.id });
    const placed = houseRepository.insertItem({ scopeKey, ownerJid: userJid, itemId: item.id, x, y, now });
    return { ok: true, item: placed, definition: item, coins: repository.getUserStats(userJid, scopeKey)?.coins || 0 };
  }
  function move({ scopeKey, userJid, itemInstanceId, x, y, rotated = false, now = Date.now() }) {
    if (!isHousePositionValid(x, y)) return { ok: false, reason: 'invalid-position' };
    const item = houseRepository.getItem(itemInstanceId);
    if (!item || item.scopeKey !== String(scopeKey) || item.ownerJid !== String(userJid)) return { ok: false, reason: 'not-owned' };
    return { ok: true, item: houseRepository.updateItem(item.id, { x, y, rotated, placed: true }, now) };
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
  return { provision, getHouse, listCatalog: listHouseItems, place, move, remove, sell, clean, collect, upgradeSecurity };
}
