/**
 * Leaderboard XP / coins e posição do usuário no scope (grupo).
 */

export function createRankService({ repository } = {}) {
  if (!repository) throw new Error('[fun/rankService] repository required');

  function getLeaderboard(scopeKey, limit = 10) {
    return repository.getLeaderboard(scopeKey, limit);
  }

  function getCoinsLeaderboard(scopeKey, limit = 10) {
    return repository.getCoinsLeaderboard(scopeKey, limit);
  }

  function getUserRankPosition(userJid, scopeKey) {
    return repository.getUserRankPosition(userJid, scopeKey);
  }

  function getUserCoinsRankPosition(userJid, scopeKey) {
    return repository.getUserCoinsRankPosition(userJid, scopeKey);
  }

  function getProfile(userJid, scopeKey) {
    const position = repository.getUserRankPosition(userJid, scopeKey);
    const stats = position.stats || repository.getUserStats(userJid, scopeKey);
    return {
      stats: stats || null,
      rank: position.rank,
      total: position.total,
    };
  }

  return {
    getLeaderboard,
    getCoinsLeaderboard,
    getUserRankPosition,
    getUserCoinsRankPosition,
    getProfile,
  };
}
