import { formatFactDate } from '../../utils/factTemporalContext.js';

/**
 * /atualizacao — repete a última atualização anunciada via dashboard
 * (analytics.fun_changelog_broadcasts, dry_run = 0 e ok_count > 0).
 * O messageText é a mensagem pronta formatada pelo changelogService.
 */
export async function handleAtualizacaoCommand({
  changelogService,
  funConfig,
  reply,
}) {
  const entry = changelogService?.getLastBroadcast?.();

  if (!entry) {
    await reply('Nenhuma atualização foi anunciada por aqui ainda. ⏳');
    return { handled: true };
  }

  const messageText = String(entry.messageText || '').trim();
  if (messageText) {
    await reply(messageText);
    return { handled: true };
  }

  // fallback raro: broadcast gravado sem message_text — monta do title/version/body
  const title = String(entry.title || '').trim();
  const version = String(entry.version || '').replace(/^v/i, '').trim();
  const body = String(entry.body || '').trim();
  const createdLabel = Number(entry.createdAt)
    ? formatFactDate(Number(entry.createdAt), funConfig?.worldTimezone)
    : '';
  const headerBits = [
    '📢 *Atualização*',
    title ? `*${title}*` : '',
    version || createdLabel ? `_${[version ? `v${version}` : '', createdLabel].filter(Boolean).join(' · ')}_` : '',
    '',
    body,
  ]
    .filter((line, index) => line !== '' || index === 3)
    .join('\n')
    .trim();

  if (headerBits) {
    await reply(headerBits);
    return { handled: true };
  }

  await reply('Nenhuma atualização foi anunciada por aqui ainda. ⏳');
  return { handled: true };
}
