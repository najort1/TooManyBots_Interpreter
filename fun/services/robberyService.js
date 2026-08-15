import { getHouseItem } from '../shop/houses.js';

function dayStart(now) { const date = new Date(Number(now) || Date.now()); return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()); }

export function createRobberyService({ repository, houseRepository, policeService = null, random = Math.random } = {}) {
  if (!repository || !houseRepository) throw new Error('[fun/robbery] repository obrigatório');
  function rob({ scopeKey, robberJid, ownerJid, funConfig = {}, now = Date.now() }) {
    if (funConfig.robberyEnabled === false) return { ok: false, result: 'blocked', reason: 'disabled' };
    if (!scopeKey || !robberJid || !ownerJid || String(robberJid) === String(ownerJid)) return { ok: false, result: 'blocked', reason: 'invalid-target' };
    const last = houseRepository.lastRobbery(scopeKey, robberJid);
    const cooldown = Math.max(0, Number(funConfig.houseRobberyCooldownMs) || 0);
    if (last && now - last < cooldown) return { ok: false, result: 'blocked', reason: 'cooldown', nextAt: last + cooldown };
    const max = Math.max(0, Number(funConfig.houseRobberyDailyMax) || 2);
    if (houseRepository.countRobberiesSince(scopeKey, robberJid, dayStart(now)) >= max) return { ok: false, result: 'blocked', reason: 'daily-cap' };
    const house = houseRepository.getHouse(scopeKey, ownerJid);
    const candidates = houseRepository.listItems(scopeKey, ownerJid, { placed: null }).filter((item) => getHouseItem(item.itemId)?.category === 'decor');
    if (!house || !candidates.length) { houseRepository.addRobbery({ scopeKey, robberJid, ownerJid, result: 'blocked', now }); return { ok: false, result: 'blocked', reason: 'nothing-to-steal' }; }
    const chance = Math.max(0.08, Math.min(0.8, (Number(funConfig.assaultBaseChance) || 0.38) - (Number(house.securityLevel) || 0) * 0.1));
    if (Number(random()) < chance) {
      const item = candidates[Math.min(candidates.length - 1, Math.floor(Number(random()) * candidates.length))];
      const stolen = houseRepository.updateItem(item.id, { ownerJid: robberJid, placed: false, stolen: true }, now);
      houseRepository.addRobbery({ scopeKey, robberJid, ownerJid, itemInstanceId: item.id, result: 'success', now });
      const police = policeService?.afterCrime?.({ userJid: robberJid, scopeKey, mode: 'player', success: true, now });
      return { ok: true, result: 'success', item: stolen, wantedDelta: police?.wantedGain || 0 };
    }
    const stats = repository.getUserStats(robberJid, scopeKey) || repository.ensureUserRow(robberJid, scopeKey, now);
    const available = Number(stats.coins) || 0;
    const min = Math.max(0, Number(funConfig.assaultFailFineMin) || 10);
    const maxFine = Math.max(min, Number(funConfig.assaultFailFineMax) || 200);
    const pct = Math.max(0, Number(funConfig.assaultFailFinePct) || 0.05);
    const fine = Math.min(available, Math.max(min, Math.min(maxFine, Math.floor(available * pct) || min)));
    if (fine > 0) repository.addCoins({ userJid: robberJid, scopeKey, amount: -fine, now, reason: 'house-robbery-fine' });
    houseRepository.addRobbery({ scopeKey, robberJid, ownerJid, result: 'fail', now });
    const police = policeService?.afterCrime?.({ userJid: robberJid, scopeKey, mode: 'player', success: false, now });
    return { ok: true, result: 'fail', fine, wantedDelta: police?.wantedGain || 0 };
  }
  return { rob };
}
