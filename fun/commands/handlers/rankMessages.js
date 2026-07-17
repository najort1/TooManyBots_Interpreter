import { nameOf, displayNameOnly } from '../../utils/userLabel.js';
import { renderLeaderboardPng } from '../../formatters/rankCardImage.js';

export async function handleRankMessagesCommand({
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
  const entries = rankService.getMessagesLeaderboard(scopeKey, limit);
  const position = rankService.getUserMessagesRankPosition(userJid, scopeKey);

  const lines = [`💬 *Top mensagens* (top ${limit})`, ''];

  if (!entries.length) {
    lines.push('Ainda ninguém falou o suficiente. Manda um alô no grupo!');
  } else {
    for (const entry of entries) {
      const medal =
        entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : entry.rank === 3 ? '🥉' : `${entry.rank}.`;
      const label = nameOf(getContactDisplayName, entry.userJid);
      const title = String(entry.title || '').trim();
      const labelWithTitle = title ? `${label} · ${title}` : label;
      const n = Number(entry.messageCount) || 0;
      lines.push(`${medal} *${labelWithTitle}* — *${n}* msg${n === 1 ? '' : 's'}`);
    }
  }

  if (position.rank != null) {
    lines.push('');
    lines.push(
      `Sua posição: *#${position.rank}*${position.total ? `/${position.total}` : ''} · *${position.stats?.messageCount || 0}* msgs`
    );
  } else if (position.stats) {
    lines.push('');
    lines.push(`Você ainda não entrou no ranking · *${position.stats.messageCount || 0}* msgs`);
  }

  if (funConfig.rankCardImage !== false && typeof replyImage === 'function' && entries.length > 0) {
    try {
      const enriched = entries.map((e) => ({
        ...e,
        displayName: displayNameOnly(getContactDisplayName, e.userJid),
      }));
      const png = renderLeaderboardPng({
        title: 'TOP MSG',
        theme: 'messages',
        entries: enriched,
        yourRank: position.rank,
        yourTotal: position.total,
        yourExtra: position.stats ? `${position.stats.messageCount || 0} MSG` : '',
      });
      await replyImage(png, `💬 Top ${limit} mensagens`);
      return { handled: true, image: true };
    } catch {
      // fallback texto
    }
  }

  await reply(lines.join('\n'));
  return { handled: true };
}
