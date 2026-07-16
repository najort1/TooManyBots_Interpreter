/**
 * Loja: gasta coins em benefícios reais.
 */

import { getShopItem, listShopItems } from '../shop/catalog.js';

export function createShopService({
  repository,
  effectsRepository,
} = {}) {
  if (!repository) throw new Error('[fun/shopService] repository required');
  if (!effectsRepository) throw new Error('[fun/shopService] effectsRepository required');

  function list() {
    return listShopItems();
  }

  function purchase({
    userJid,
    scopeKey,
    itemId,
    titleText = '',
    funConfig = {},
    now = Date.now(),
  } = {}) {
    const item = getShopItem(itemId);
    if (!item) return { ok: false, reason: 'unknown-item' };

    const u = String(userJid || '').trim();
    const s = String(scopeKey || '').trim();
    if (!u || !s) return { ok: false, reason: 'invalid-identity' };

    let cleanTitle = '';
    if (item.kind === 'title') {
      const maxLen = Number(funConfig.titleMaxLen) || 16;
      cleanTitle = String(titleText || '')
        .trim()
        .replace(/[\n\r\t]/g, ' ')
        .replace(/\s+/g, ' ')
        .slice(0, maxLen);
      if (!cleanTitle) {
        return { ok: false, reason: 'title-required', maxLen };
      }
    }

    const stats = repository.ensureUserRow(u, s, now);
    if ((Number(stats.coins) || 0) < item.price) {
      return {
        ok: false,
        reason: 'insufficient-funds',
        coins: Number(stats.coins) || 0,
        price: item.price,
      };
    }

    // Unlock permanente é por usuário (ex.: chave de armas) — não vende de novo
    if (item.kind === 'permanent' || item.payload?.permanent) {
      const owned = effectsRepository.getEffect(u, s, item.effectKey, now);
      if (owned) {
        return { ok: false, reason: 'already-owned', item };
      }
    }

    const debited = repository.addCoins({
      userJid: u,
      scopeKey: s,
      amount: -item.price,
      now,
      reason: `shop:${item.id}`,
    });
    if (!debited.ok) {
      return { ok: false, reason: 'spend-failed' };
    }

    if (item.kind === 'timed') {
      effectsRepository.setTimedEffect({
        userJid: u,
        scopeKey: s,
        effectKey: item.effectKey,
        durationMs: item.durationMs,
        payload: item.payload || {},
        now,
      });
    } else if (item.kind === 'permanent' || item.payload?.permanent) {
      // 1 charge permanente por userJid+scope — nunca consumida; só esse usuário beneficia
      effectsRepository.addCharges({
        userJid: u,
        scopeKey: s,
        effectKey: item.effectKey,
        charges: 1,
        payload: { ...(item.payload || {}), permanent: true },
        now,
      });
    } else if (item.kind === 'charge') {
      effectsRepository.addCharges({
        userJid: u,
        scopeKey: s,
        effectKey: item.effectKey,
        charges: item.charges || 1,
        payload: item.payload || {},
        now,
      });
    } else if (item.kind === 'instant' && item.payload?.xp) {
      repository.awardXp({
        userJid: u,
        scopeKey: s,
        amount: Number(item.payload.xp) || 0,
        now,
        cooldownMs: 0,
      });
    } else if (item.kind === 'title') {
      repository.setTitle({
        userJid: u,
        scopeKey: s,
        title: cleanTitle,
        now,
      });
    }

    const coins = repository.getUserStats(u, s)?.coins || 0;
    return {
      ok: true,
      item,
      coins,
      title: cleanTitle || null,
    };
  }

  return {
    list,
    buy: purchase,
  };
}
