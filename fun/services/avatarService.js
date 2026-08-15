import { getAvatarItem, isAvatarSlot, listAvatarItems } from '../shop/avatars.js';

export function createAvatarService({ repository, avatarRepository } = {}) {
  if (!repository || !avatarRepository) throw new Error('[fun/avatar] repository obrigatório');
  const enabled = (config = {}) => config.avatarEnabled !== false;
  function state({ scopeKey, userJid, now = Date.now() }) { return avatarRepository.ensure(scopeKey, userJid, now); }
  function isOwned(item, current, level) { return item.cost === 0 && Number(level) >= item.unlockLevel || current.unlocked.includes(item.id); }
  function get({ scopeKey, userJid, now = Date.now() }) {
    const current = state({ scopeKey, userJid, now });
    const stats = repository.getUserStats(userJid, scopeKey) || repository.ensureUserRow(userJid, scopeKey, now);
    const catalog = listAvatarItems().map((item) => ({ ...item, owned: isOwned(item, current, Number(stats.level) || 1) }));
    return { ...current, level: Number(stats.level) || 1, catalog };
  }
  function equip({ scopeKey, userJid, itemId, funConfig = {}, now = Date.now() }) {
    if (!enabled(funConfig)) return { ok: false, reason: 'disabled' };
    const item = getAvatarItem(itemId);
    if (!item || !isAvatarSlot(item.slot)) return { ok: false, reason: 'unknown-item' };
    const current = state({ scopeKey, userJid, now });
    const stats = repository.getUserStats(userJid, scopeKey) || repository.ensureUserRow(userJid, scopeKey, now);
    if (!isOwned(item, current, Number(stats.level) || 1)) return { ok: false, reason: 'not-owned', item };
    const saved = avatarRepository.save(scopeKey, userJid, { slots: { ...current.slots, [item.slot]: item.id }, unlocked: current.unlocked }, now);
    return { ok: true, state: saved, item };
  }
  function buy({ scopeKey, userJid, itemId, funConfig = {}, now = Date.now() }) {
    if (!enabled(funConfig)) return { ok: false, reason: 'disabled' };
    const item = getAvatarItem(itemId);
    if (!item || item.cost <= 0) return { ok: false, reason: 'not-purchasable' };
    const current = state({ scopeKey, userJid, now });
    if (current.unlocked.includes(item.id)) return { ok: false, reason: 'already-owned', item };
    const stats = repository.getUserStats(userJid, scopeKey) || repository.ensureUserRow(userJid, scopeKey, now);
    if ((Number(stats.coins) || 0) < item.cost) return { ok: false, reason: 'no-coins', need: item.cost, coins: Number(stats.coins) || 0 };
    repository.addCoins({ userJid, scopeKey, amount: -item.cost, now, reason: 'avatar-buy:' + item.id });
    const saved = avatarRepository.save(scopeKey, userJid, { slots: current.slots, unlocked: [...current.unlocked, item.id] }, now);
    return { ok: true, item, state: saved, coins: repository.getUserStats(userJid, scopeKey)?.coins || 0 };
  }
  return { get, equip, buy };
}
