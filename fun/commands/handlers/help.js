import { formatHelp } from '../../formatters/rankCard.js';

/**
 * Help:
 * - replyCommandsInPrivate=false → texto completo no chat atual.
 * - replyCommandsInPrivate=true  → tenta privado; se falhar/timeout → texto completo no grupo.
 *   (nunca deixa só o aviso “te enviei no privado” sem o conteúdo.)
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
  const toGroup = typeof replyToChat === 'function' ? replyToChat : reply;

  if (!wantPrivate) {
    await reply(text);
    return { handled: true, private: false };
  }

  const sendPrivate = typeof replyPrivate === 'function' ? replyPrivate : null;
  if (!sendPrivate) {
    await toGroup(text);
    return { handled: true, private: false };
  }

  try {
    await Promise.race([
      sendPrivate(text),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('dm-timeout')), 8_000);
      }),
    ]);
  } catch (err) {
    console.warn(`[fun/help] DM falhou (${err?.message || 'erro'}) — help completo no grupo`);
    await toGroup(text);
    return { handled: true, private: false };
  }

  // DM “ok” no Baileys — ainda assim avisa no grupo (e se o PV não entregar, manda o full no grupo)
  // Estratégia: aviso curto + dica. Se o user não abriu o bot, o full no grupo é mais confiável.
  // Preferência: full no grupo só se DM for incerto → mandamos full no grupo SEMPRE que private mode
  // gerava silêncio. Compromisso: full no grupo quando DM ok, sem o aviso mentiroso sozinho.
  await toGroup(text);
  return { handled: true, private: true, mirroredGroup: true };
}
