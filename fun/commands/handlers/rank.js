import { formatLeaderboard } from '../../formatters/rankCard.js';
import { renderRankCardPng } from '../../formatters/rankCardImage.js';

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

  const enriched = entries.map(entry => ({
    ...entry,
    displayName:
      typeof getContactDisplayName === 'function'
        ? getContactDisplayName(entry.userJid)
        : '',
  }));

  const text = formatLeaderboard({
    entries: enriched,
    yourRank: position.rank,
    yourTotal: position.total,
    limit,
  });

  if (funConfig.rankCardImage !== false && typeof replyImage === 'function' && enriched.length > 0) {
    try {
      const png = renderRankCardPng({
        title: 'RANK DO GRUPO',
        entries: enriched,
        yourRank: position.rank,
        yourTotal: position.total,
      });
      await replyImage(png, `🏆 Top ${limit} do grupo`);
      return { handled: true, image: true };
    } catch {
      // fallback texto
    }
  }

  await reply(text);
  return { handled: true };
}
