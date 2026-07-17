import { nameOf, displayNameOnly } from '../../utils/userLabel.js';
import { renderLeaderboardPng } from '../../formatters/rankCardImage.js';

export async function handleRankCoinsCommand({
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
  const entries = rankService.getCoinsLeaderboard(scopeKey, limit);
  const position = rankService.getUserCoinsRankPosition(userJid, scopeKey);

  const lines = [`🪙 *Ranking de coins* (top ${limit})`, ''];

  if (!entries.length) {
    lines.push('Ninguém tem coins ainda. Use `/daily` ou `/trabalhar`!');
  } else {
    for (const entry of entries) {
      const medal =
        entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : entry.rank === 3 ? '🥉' : `${entry.rank}.`;
      const label = nameOf(getContactDisplayName, entry.userJid);
      const title = String(entry.title || '').trim();
      const labelWithTitle = title ? `${label} · ${title}` : label;
      lines.push(`${medal} *${labelWithTitle}* — *${entry.coins}* coins`);
    }
  }

  if (position.rank != null) {
    lines.push('');
    lines.push(
      `Sua posição: *#${position.rank}*${position.total ? `/${position.total}` : ''} · *${position.stats?.coins || 0}* coins`
    );
  }

  if (funConfig.rankCardImage !== false && typeof replyImage === 'function' && entries.length > 0) {
    try {
      const enriched = entries.map((e) => ({
        ...e,
        displayName: displayNameOnly(getContactDisplayName, e.userJid),
      }));
      const png = renderLeaderboardPng({
        title: 'RANK COINS',
        theme: 'coins',
        entries: enriched,
        yourRank: position.rank,
        yourTotal: position.total,
        yourExtra: position.stats ? `${position.stats.coins || 0}C` : '',
      });
      await replyImage(png, `🪙 Top ${limit} coins`);
      return { handled: true, image: true };
    } catch {
      // fallback texto
    }
  }

  await reply(lines.join('\n'));
  return { handled: true };
}
