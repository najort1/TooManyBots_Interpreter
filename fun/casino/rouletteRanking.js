export function createRouletteRanking({ casinoRepository, funConfig, now }) {
  function getDailyRanking(scopeKey, limit = 3) {
    try {
      const leaderboard = casinoRepository.getLeaderboard(scopeKey, limit);
      return leaderboard.map((r, i) => ({
        rank: i + 1,
        userJid: r.userJid,
        profit: r.profit,
        games: r.games,
      }));
    } catch {
      return [];
    }
  }

  function formatDailyRanking(ranking) {
    if (!ranking || !ranking.length) return null;
    const lines = ranking.map(
      (r) => `${r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : '🥉'} Jogador ${r.userJid.split('@')[0].slice(0, 8)}: ${r.profit > 0 ? '+' : ''}${r.profit} (${r.games} jogos)`
    );
    return [`🏆 *Melhores do dia*`, ...lines].join('\n');
  }

  function formatBigWin(stake, payout, choice, scopeKey) {
    const profit = payout - stake;
    if (profit < 500) return null;
    if (profit >= 20000) {
      return `🚨 *A MESA PAROU!* Um jogador acertou *${choiceLabel(choice)}* e levou *+${payout}* moedas!`;
    }
    if (profit >= 5000) {
      return `💰 *MEGA ACERTO!* Alguém ganhou *+${payout}* moedas na roleta!`;
    }
    return `🎉 *Grande vitória!* +${payout} moedas!`;
  }

  return {
    getDailyRanking,
    formatDailyRanking,
    formatBigWin,
  };
}
