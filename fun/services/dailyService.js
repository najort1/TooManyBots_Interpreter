/**
 * Claim diário + streak.
 */

export function createDailyService({ repository } = {}) {
  if (!repository) throw new Error('[fun/dailyService] repository required');

  function claimDaily({
    userJid,
    scopeKey,
    now = Date.now(),
    rewardXp = 150,
    rewardCoins = 50,
  } = {}) {
    return repository.claimDaily({
      userJid,
      scopeKey,
      now,
      rewardXp,
      rewardCoins,
    });
  }

  return {
    claimDaily,
  };
}
