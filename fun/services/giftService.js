function dayStart(now) { const date = new Date(Number(now) || Date.now()); return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()); }

export function createGiftService({ repository, houseRepository } = {}) {
  if (!repository || !houseRepository) throw new Error('[fun/gift] repository obrigatório');
  function give({ scopeKey, giverJid, recipientJid, itemInstanceId = '', coins = 0, funConfig = {}, now = Date.now() }) {
    if (funConfig.giftsEnabled === false) return { ok: false, reason: 'disabled' };
    if (!scopeKey || !giverJid || !recipientJid || String(giverJid) === String(recipientJid)) return { ok: false, reason: 'invalid-recipient' };
    const max = Math.max(1, Number(funConfig.houseGiftDailyMax) || 3);
    const count = houseRepository.countGiftsSince(scopeKey, giverJid, dayStart(now));
    if (count >= max) return { ok: false, reason: 'daily-cap', max, count };
    const amount = Math.max(0, Math.floor(Number(coins) || 0));
    if (!itemInstanceId && amount <= 0) return { ok: false, reason: 'empty-gift' };
    let item = null;
    if (itemInstanceId) {
      item = houseRepository.getItem(itemInstanceId);
      if (!item || item.scopeKey !== String(scopeKey) || item.ownerJid !== String(giverJid)) return { ok: false, reason: 'not-owned' };
      houseRepository.updateItem(item.id, { ownerJid: recipientJid, placed: false }, now);
    }
    if (amount > 0) {
      const transfer = repository.transferCoins({ fromJid: giverJid, toJid: recipientJid, scopeKey, amount, now, reason: 'house-gift' });
      if (!transfer.ok) {
        if (item) houseRepository.updateItem(item.id, { ownerJid: giverJid, placed: item.placed }, now);
        return { ok: false, reason: transfer.reason, coins: transfer.fromCoins || 0 };
      }
    }
    const gift = houseRepository.addGift({ scopeKey, giverJid, recipientJid, itemInstanceId: item?.id || '', coins: amount, now });
    return { ok: true, gift, item: item ? houseRepository.getItem(item.id) : null };
  }
  return { give };
}
