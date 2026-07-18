/**
 * Conquistas — contadores + unlock idempotente.
 */

import { ACHIEVEMENTS } from '../constants.js';

export function createAchievementService({
  achievementRepository,
  repository,
} = {}) {
  function enabled(funConfig = {}) {
    return funConfig.achievementsEnabled !== false;
  }

  function catalog() {
    return Object.values(ACHIEVEMENTS);
  }

  function getDef(id) {
    return ACHIEVEMENTS[id] || null;
  }

  function listUser(scopeKey, userJid) {
    const unlocked = achievementRepository.listUnlocked(scopeKey, userJid);
    return unlocked
      .map((u) => {
        const def = getDef(u.achievementId);
        return def ? { ...def, unlockedAt: u.unlockedAt } : null;
      })
      .filter(Boolean);
  }

  function tryUnlock(userJid, scopeKey, achievementId, now = Date.now()) {
    const def = getDef(achievementId);
    if (!def) return null;
    const r = achievementRepository.unlock({
      userJid,
      scopeKey,
      achievementId,
      now,
    });
    if (!r.ok) return null;
    return def;
  }

  /**
   * @param {string} event — coins|stock_buy|crash_loss|crash_win|cancel|divorce|marry|assault_win|assault_fail|property_buy|property_collect
   * @param {object} ctx
   * @returns {Array<object>} defs desbloqueadas agora
   */
  function check(userJid, scopeKey, event, ctx = {}, funConfig = {}, now = Date.now()) {
    if (!enabled(funConfig)) return [];
    const unlocked = [];
    const push = (id) => {
      const def = tryUnlock(userJid, scopeKey, id, now);
      if (def) unlocked.push(def);
    };

    switch (String(event || '')) {
      case 'coins': {
        const coins =
          ctx.coins != null
            ? Number(ctx.coins)
            : Number(repository.getUserStats(userJid, scopeKey)?.coins) || 0;
        if (coins >= 2000) push('coins_2k');
        break;
      }
      case 'stock_buy':
        push('first_share');
        break;
      case 'crash_loss': {
        const streak = achievementRepository.addProgress({
          userJid,
          scopeKey,
          counterKey: 'crash_lose_streak',
          delta: 1,
          now,
        });
        if (streak >= 5) push('crash_unlucky_5');
        break;
      }
      case 'crash_win': {
        achievementRepository.setProgress({
          userJid,
          scopeKey,
          counterKey: 'crash_lose_streak',
          value: 0,
          now,
        });
        if (Number(ctx.mult) >= 5) push('longshot_win');
        break;
      }
      case 'cancel': {
        const n = achievementRepository.addProgress({
          userJid,
          scopeKey,
          counterKey: 'cancel_count',
          delta: 1,
          now,
        });
        if (n >= 10) push('cancel_10');
        break;
      }
      case 'divorce': {
        const n = achievementRepository.addProgress({
          userJid,
          scopeKey,
          counterKey: 'divorce_count',
          delta: 1,
          now,
        });
        if (n >= 3) push('divorce_3');
        break;
      }
      case 'marry': {
        const n = achievementRepository.addProgress({
          userJid,
          scopeKey,
          counterKey: 'marry_count',
          delta: 1,
          now,
        });
        if (n >= 3) push('marry_3');
        break;
      }
      case 'assault_win': {
        const n = achievementRepository.addProgress({
          userJid,
          scopeKey,
          counterKey: 'assault_win',
          delta: 1,
          now,
        });
        if (n >= 15) push('assault_win_15');
        break;
      }
      case 'assault_fail': {
        const n = achievementRepository.addProgress({
          userJid,
          scopeKey,
          counterKey: 'assault_fail',
          delta: 1,
          now,
        });
        if (n >= 10) push('assault_fail_10');
        break;
      }
      case 'property_buy':
        push('first_property');
        break;
      case 'property_collect': {
        const add = Math.max(0, Math.floor(Number(ctx.amount) || 0));
        if (add > 0) {
          const total = achievementRepository.addProgress({
            userJid,
            scopeKey,
            counterKey: 'collect_total',
            delta: add,
            now,
          });
          if (total >= 500) push('collect_500');
        }
        break;
      }
      default:
        break;
    }

    // recheck coins se balance mudou
    if (event !== 'coins' && ctx.recheckCoins) {
      unlocked.push(...check(userJid, scopeKey, 'coins', ctx, funConfig, now));
    }

    return unlocked;
  }

  function formatList(scopeKey, userJid) {
    const got = listUser(scopeKey, userJid);
    const gotIds = new Set(got.map((g) => g.id));
    const missing = catalog().filter((c) => !gotIds.has(c.id));
    const lines = ['🏆 *Conquistas*', ''];
    if (got.length) {
      lines.push(...got.map((g) => `${g.icon} *${g.name}* — ${g.description}`));
    } else {
      lines.push('_Nenhuma ainda. Mexe no bot que aparece._');
    }
    if (missing.length) {
      lines.push('', '*Em aberto* (até 5)');
      for (const m of missing.slice(0, 5)) {
        lines.push(`${m.icon} ${m.name} — _${m.description}_`);
      }
    }
    return lines.join('\n');
  }

  function formatAnnounce(defs, userLabel) {
    if (!defs?.length) return '';
    return defs
      .map(
        (d) =>
          `🏆 *CONQUISTA* ${d.icon} *${d.name}* para ${userLabel}!\n_${d.description}_`
      )
      .join('\n\n');
  }

  return {
    enabled,
    catalog,
    getDef,
    listUser,
    check,
    formatList,
    formatAnnounce,
  };
}
