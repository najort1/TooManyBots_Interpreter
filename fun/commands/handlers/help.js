import { formatHelp } from '../../formatters/rankCard.js';

/**
 * Help vai no privado para não poluir o grupo.
 * Com replyCommandsInPrivate, não avisa no grupo (já é o modo padrão).
 */
export async function handleHelpCommand({
  funConfig,
  reply,
  replyPrivate,
  replyToChat,
  isGroup,
  preferPrivate,
}) {
  const text = formatHelp(funConfig.prefix || '/');
  const sendPrivate = typeof replyPrivate === 'function' ? replyPrivate : reply;
  const toGroup =
    typeof replyToChat === 'function'
      ? replyToChat
      : async (body) => {
          // quando reply já é DM, ainda precisamos de canal pro grupo
          if (preferPrivate || funConfig?.replyCommandsInPrivate) return;
          await reply(body);
        };

  try {
    await sendPrivate(text);
  } catch {
    await reply(text);
    return { handled: true, private: false };
  }

  // Aviso curto só se o grupo ainda espera respostas públicas
  if (isGroup && !preferPrivate && !funConfig?.replyCommandsInPrivate) {
    await toGroup('📬 Te enviei o *help* no privado. Guia de facções: `/comopanelinha`');
  }

  return { handled: true, private: true };
}
