export async function handleRankCoinsCommand({
  userJid,
  scopeKey,
  rankService,
  funConfig,
  getContactDisplayName,
  reply,
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
      const label =
        (typeof getContactDisplayName === 'function' && getContactDisplayName(entry.userJid)) ||
        entry.userJid.split('@')[0];
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

  await reply(lines.join('\n'));
  return { handled: true };
}
