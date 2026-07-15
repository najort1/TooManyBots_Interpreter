export async function handleRankMessagesCommand({
  userJid,
  scopeKey,
  rankService,
  funConfig,
  getContactDisplayName,
  reply,
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
      const label =
        (typeof getContactDisplayName === 'function' && getContactDisplayName(entry.userJid)) ||
        entry.userJid.split('@')[0];
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

  await reply(lines.join('\n'));
  return { handled: true };
}
