import { formatHelp } from '../../formatters/rankCard.js';

/**
 * Help vai no privado para não poluir o grupo.
 * No grupo, só um aviso curto.
 */
export async function handleHelpCommand({
  funConfig,
  reply,
  replyPrivate,
  isGroup,
}) {
  const text = formatHelp(funConfig.prefix || '/');
  const sendPrivate = typeof replyPrivate === 'function' ? replyPrivate : reply;

  try {
    await sendPrivate(text);
  } catch {
    // fallback: se falhar DM (ex.: sem chat aberto), manda no chat atual
    await reply(text);
    return { handled: true, private: false };
  }

  if (isGroup) {
    await reply('📬 Te enviei o *help* no privado. Guia de facções: `/comopanelinha`');
  }

  return { handled: true, private: true };
}
