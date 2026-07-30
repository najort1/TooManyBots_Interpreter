/**
 * Handlers de comando para Desafio Diário.
 *
 * Comandos:
 *  - /responder <palpite>  → tentativa de acertar
 *  - /dica                  → libera próxima dica
 *  - /trocar desafio        → vota para pular (3 votos = skip)
 */

/**
 * /responder <palpite>
 */
export async function handleResponderCommand(ctx) {
  const {
    dailyChallengeService,
    userJid,
    scopeKey,
    args = [],
    reply,
    getContactDisplayName,
  } = ctx;

  if (!dailyChallengeService) {
    await reply('Desafio diário indisponível no momento.');
    return { handled: true };
  }

  const guess = (args || []).join(' ').trim();
  if (!guess) {
    await reply('Uso: /responder <palpite>');
    return { handled: true };
  }

  const result = await dailyChallengeService.handleAnswer({
    scopeKey,
    userJid,
    guess,
    now: Date.now(),
    getContactDisplayName,
  });

  await reply(result.message);
  return { handled: true };
}

/**
 * /dica
 */
export async function handleDicaCommand(ctx) {
  const {
    dailyChallengeService,
    scopeKey,
    reply,
  } = ctx;

  if (!dailyChallengeService) {
    await reply('Desafio diário indisponível no momento.');
    return { handled: true };
  }

  const result = await dailyChallengeService.handleHint({
    scopeKey,
    now: Date.now(),
  });

  await reply(result.message);
  return { handled: true };
}

/**
 * /trocar desafio (ou /pular, /skip)
 */
export async function handleTrocarDesafioCommand(ctx) {
  const {
    dailyChallengeService,
    scopeKey,
    userJid,
    reply,
    replyImage,
  } = ctx;

  if (!dailyChallengeService) {
    await reply('Desafio diário indisponível no momento.');
    return { handled: true };
  }

  const sendText = async (to, msg) => reply(msg);
  let sendImageFn = null;
  if (typeof replyImage === 'function') {
    sendImageFn = async (to, buf, opts) => replyImage(buf, opts?.caption || '');
  }

  let sharpFn = null;
  try {
    const m = await import('sharp');
    sharpFn = m.default || m;
  } catch {
    // sharp indisponível — pokémon será pulado no skip (só guess_game/riddle)
  }

  const result = await dailyChallengeService.handleSkipVote({
    scopeKey,
    userJid,
    now: Date.now(),
    sendText,
    sendImage: sendImageFn,
    sharp: sharpFn,
  });

  await reply(result.message);
  return { handled: true };
}