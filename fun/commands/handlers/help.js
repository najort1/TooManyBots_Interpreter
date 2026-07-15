import { formatHelp } from '../../formatters/rankCard.js';

/**
 * Help:
 * - replyCommandsInPrivate=false → texto completo no grupo (sem DM).
 * - replyCommandsInPrivate=true  → tenta privado; se falhar, manda no grupo.
 */
export async function handleHelpCommand({
  funConfig,
  reply,
  replyPrivate,
  replyToChat,
  isGroup,
}) {
  const text = formatHelp(funConfig.prefix || '/');
  const wantPrivate = funConfig?.replyCommandsInPrivate !== false && isGroup;

  // Modo público: tudo no chat atual
  if (!wantPrivate) {
    await reply(text);
    return { handled: true, private: false };
  }

  const sendPrivate = typeof replyPrivate === 'function' ? replyPrivate : null;
  const toGroup = typeof replyToChat === 'function' ? replyToChat : reply;

  if (!sendPrivate) {
    await reply(text);
    return { handled: true, private: false };
  }

  try {
    await sendPrivate(text);
  } catch {
    await toGroup(text);
    return { handled: true, private: false };
  }

  // DM aceito pelo cliente — aviso curto no grupo (help completo no PV)
  await toGroup('📬 Te enviei o *help* no privado. Guia de facções: `/comopanelinha`');
  return { handled: true, private: true };
}
