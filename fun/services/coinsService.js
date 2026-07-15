export function createCoinsService({ repository } = {}) {
  if (!repository) throw new Error('[fun/coinsService] repository required');

  function getBalance(userJid, scopeKey) {
    const stats = repository.getUserStats(userJid, scopeKey) || repository.ensureUserRow(userJid, scopeKey);
    return Number(stats?.coins) || 0;
  }

  function transfer({ fromJid, toJid, scopeKey, amount, now = Date.now() }) {
    return repository.transferCoins({
      fromJid,
      toJid,
      scopeKey,
      amount,
      now,
      reason: 'pay',
    });
  }

  return {
    getBalance,
    transfer,
  };
}
