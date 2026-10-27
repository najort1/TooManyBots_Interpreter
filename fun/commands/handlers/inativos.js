import { nameOf } from '../../utils/userLabel.js';
import { formatFactDate } from '../../utils/factTemporalContext.js';
import { collectBotJids, normalizeJid } from '../../services/personaTriggerDetector.js';

function relativeLabel(lastAt, now) {
  const deltaMs = Math.max(0, (Number(now) || Date.now()) - (Number(lastAt) || 0));
  const days = Math.floor(deltaMs / 86_400_000);
  if (days >= 1) return `há ${days}d`;
  const hours = Math.max(1, Math.floor(deltaMs / 3_600_000));
  return `há ${hours}h`;
}

/**
 * /inativos — ranking de quem MENOS fala no grupo.
 * Fonte: analytics.fun_user_stats via rankService.getInactiveMembers
 * (message_count ASC, empate por last_xp_at ASC — mais inativo primeiro).
 */
export async function handleInativosCommand({
  userJid,
  scopeKey,
  rankService,
  funConfig,
  getContactDisplayName,
  reply,
  effectiveRates,
  sock,
  identityMap,
  now = Date.now(),
}) {
  const limit = effectiveRates?.rankLimit || funConfig?.rankLimit || 10;

  const botJidsSet = collectBotJids(sock, identityMap, [
    funConfig?.botJid,
    ...(Array.isArray(funConfig?.botJids) ? funConfig.botJids : []),
  ].filter(Boolean));
  const botLocalParts = new Set([...botJidsSet].map((j) => String(j || '').split('@')[0]).filter(Boolean));
  const isBot = (jid) => {
    if (!jid) return false;
    const raw = String(jid).trim();
    const norm = normalizeJid(raw) || raw;
    const local = (norm || raw).split('@')[0];
    return (
      botJidsSet.has(raw) ||
      (norm && botJidsSet.has(norm)) ||
      botLocalParts.has(local) ||
      raw.startsWith('5511999')
    );
  };

  const rawEntries =
    rankService?.getInactiveMembers?.(scopeKey, {
      limit: limit * 2,
      excludeJids: [...botJidsSet],
    }) || [];

  const entries = rawEntries
    .filter((entry) => !isBot(entry.userJid))
    .slice(0, limit)
    .map((entry, index) => ({
      ...entry,
      rank: index + 1,
    }));

  const lines = [`😴 *MENOS ATIVOS* (top ${limit})`, ''];

  if (!entries.length) {
    lines.push('Sem estatísticas de chat nesse grupo ainda.');
  } else {
    for (const entry of entries) {
      const medal =
        entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : entry.rank === 3 ? '🥉' : `${entry.rank}.`;
      const label = nameOf(getContactDisplayName, entry.userJid);
      const title = String(entry.title || '').trim();
      const labelWithTitle = title ? `${label} · ${title}` : label;
      const n = Number(entry.messageCount) || 0;
      const lastAt = Number(entry.lastXpAt) || 0;
      const lastTalk = n > 0 && lastAt
        ? `${relativeLabel(lastAt, now)} (~${formatFactDate(lastAt, funConfig?.worldTimezone)})`
        : 'nunca falou';
      lines.push(
        `${medal} *${labelWithTitle}* — *${n}* msg${n === 1 ? '' : 's'} · última fala: ${lastTalk}`
      );
    }
  }

  // Posição do autor dentro do ranking original de mensagens (se ele estiver nele)
  const position = rankService?.getUserMessagesRankPosition?.(userJid, scopeKey);
  if (position?.rank != null) {
    lines.push('');
    lines.push(
      `Sua posição no rank de mensagens: *#${position.rank}*${position.total ? `/${position.total}` : ''} · *${position.stats?.messageCount || 0}* msgs`
    );
  }

  await reply(lines.join('\n'));
  return { handled: true };
}
