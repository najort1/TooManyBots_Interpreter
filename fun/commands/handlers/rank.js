import { formatLeaderboard } from '../../formatters/rankCard.js';
import { renderLeaderboardPng } from '../../formatters/rankCardImage.js';
import { displayNameOnly } from '../../utils/userLabel.js';

export async function handleRankCommand({
  userJid,
  scopeKey,
  rankService,
  funConfig,
  getContactDisplayName,
  reply,
  replyImage,
  effectiveRates,
}) {
  const limit = effectiveRates?.rankLimit || funConfig.rankLimit || 10;
  const entries = rankService.getLeaderboard(scopeKey, limit);
  const position = rankService.getUserRankPosition(userJid, scopeKey);

  const enriched = entries.map((entry) => ({
    ...entry,
    displayName: displayNameOnly(getContactDisplayName, entry.userJid),
  }));

  const text = formatLeaderboard({
    entries: enriched,
    yourRank: position.rank,
    yourTotal: position.total,
    limit,
  });

  if (funConfig.rankCardImage !== false && typeof replyImage === 'function' && enriched.length > 0) {
    try {
      const png = renderLeaderboardPng({
        title: 'RANK XP',
        theme: 'xp',
        entries: enriched,
        yourRank: position.rank,
        yourTotal: position.total,
      });
      await replyImage(png, `🏆 Top ${limit} XP`);
      return { handled: true, image: true };
    } catch {
      // fallback texto
    }
  }

  await reply(text);
  return { handled: true };
}
