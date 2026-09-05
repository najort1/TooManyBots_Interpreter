/**
 * Handlers de comando para Desafio Diário.
 *
 * Comandos:
 *  - /responder <palpite>  → tentativa de acertar
 *  - /dica                  → libera próxima dica
 *  - /trocar desafio        → vota para pular (3 votos = skip)
 *  - /desafio <sub>         → comandos de administração/teste
 */

/**
 * Constroi as funcoes de envio de imagem/texto e a referencia ao sharp,
 * reaproveitadas pelos handlers de responder/dica/trocar/desafio.
 */
async function buildImageCaps(ctx) {
  const { reply, replyImage } = ctx;
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
    // sharp indisponivel — pokemon sera enviado como sprite bruto (sem escurecer)
  }
  return { sendText, sendImage: sendImageFn, sharp: sharpFn };
}

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

  const { sendImage, sharp } = await buildImageCaps(ctx);

  const result = await dailyChallengeService.handleAnswer({
    scopeKey,
    userJid,
    guess,
    now: Date.now(),
    getContactDisplayName,
    sendImage,
    sharp,
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

  const { sendImage, sharp } = await buildImageCaps(ctx);

  const result = await dailyChallengeService.handleHint({
    scopeKey,
    now: Date.now(),
    sendImage,
    sharp,
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
  } = ctx;

  if (!dailyChallengeService) {
    await reply('Desafio diário indisponível no momento.');
    return { handled: true };
  }

  const { sendText, sendImage, sharp } = await buildImageCaps(ctx);

  const result = await dailyChallengeService.handleSkipVote({
    scopeKey,
    userJid,
    now: Date.now(),
    sendText,
    sendImage,
    sharp,
  });

  await reply(result.message);
  return { handled: true };
}

/**
 * /desafio <subcomando> — comandos de administração/teste
 *
 * Subcomandos:
 *   status       — exibe status do desafio atual
 *   forcar       — força lançamento imediato (opcional: tipo)
 *   expirar      — força expiração do desafio atual
 *   reiniciar    — expira o atual e lança novo
 */
export async function handleDesafioCommand(ctx) {
  const {
    dailyChallengeService,
    scopeKey,
    args = [],
    reply,
  } = ctx;

  if (!dailyChallengeService) {
    await reply('Desafio diário indisponível no momento.');
    return { handled: true };
  }

  const sub = (args[0] || '').toLowerCase().trim();

  const { sendText, sendImage, sharp } = await buildImageCaps(ctx);

  switch (sub) {
    case 'status': {
      const s = dailyChallengeService.getStatus(scopeKey);
      if (!s.active || !s.challenge) {
        await reply('Nenhum desafio ativo no momento.');
        return { handled: true };
      }
      const c = s.challenge;
      const remaining = dailyChallengeService.getHintCooldownRemaining
        ? dailyChallengeService.getHintCooldownRemaining(c.id, Date.now())
        : 0;
      const lines = [
        '📋 *Status do Desafio Diário*',
        `Tipo: \`${c.challengeType || '?'}\``,
        `Status: \`${c.status}\``,
        `Lançado: ${new Date(c.launchedAt).toLocaleString('pt-BR')}`,
        `Expira: ${new Date(c.expiresAt).toLocaleString('pt-BR')}`,
        `Cooldown dica: ${remaining > 0 ? Math.ceil(remaining / 1000) + 's' : 'pronta'}`,
        `Resposta: ||${c.answer}||`,
      ];
      await reply(lines.join('\n'));
      return { handled: true };
    }

    case 'forcar':
    case 'forcarlancar': {
      const typeArg = (args[1] || '').toLowerCase().trim();
      const TYPE_MAP = {
        game: 'guess_game',
        enigma: 'riddle',
        filme: 'guess_movie_emoji',
        cine: 'guess_movie_emoji',
        movie: 'guess_movie_emoji',
        quem: 'who_am_i',
        person: 'who_am_i',
        math: 'math_puzzle',
        matematica: 'math_puzzle',
        anagrama: 'word_scramble',
        palavra: 'word_scramble',
      };
      const validTypes = [
        'guess_game',
        'riddle',
        'pokemon',
        'guess_movie_emoji',
        'who_am_i',
        'math_puzzle',
        'word_scramble',
      ];
      const challengeType = TYPE_MAP[typeArg] || typeArg || null;

      // Expira qualquer desafio existente silenciosamente
      await dailyChallengeService.forceExpireChallenge?.({
        scopeKey,
        now: Date.now(),
        reason: 'force-launch',
      });

      const finalType = challengeType && validTypes.includes(challengeType)
        ? challengeType
        : dailyChallengeService.pickChallengeType(null);

      const result = await dailyChallengeService.launchChallenge({
        scopeKey,
        type: finalType,
        now: Date.now(),
        sendText,
        sendImage,
        sharp,
      });

      if (result?.ok) {
        await reply(`✅ Desafio lançado com sucesso! Tipo: \`${finalType}\``);
      } else {
        await reply(`❌ Falha ao lançar desafio: ${result?.reason || 'erro desconhecido'}`);
      }
      return { handled: true };
    }

    case 'expirar': {
      const result = await dailyChallengeService.forceExpireChallenge?.({
        scopeKey,
        now: Date.now(),
        reason: 'forced',
        announce: true,
        sendText,
        sendImage,
        sharp,
      });
      if (result?.ok) {
        await reply('✅ Desafio expirado e resposta anunciada.');
      } else {
        await reply(`Nada a expirar: ${result?.reason || 'nenhum desafio ativo'}`);
      }
      return { handled: true };
    }

    case 'reiniciar':
    case 'resetar': {
      // Expira existente silenciosamente
      await dailyChallengeService.forceExpireChallenge?.({
        scopeKey,
        now: Date.now(),
        reason: 'restart',
      });

      const type = dailyChallengeService.pickChallengeType(null);
      const result = await dailyChallengeService.launchChallenge({
        scopeKey,
        type,
        now: Date.now(),
        sendText,
        sendImage,
        sharp,
      });

      if (result?.ok) {
        await reply(`✅ Ciclo reiniciado! Novo desafio: \`${type}\``);
      } else {
        await reply(`❌ Falha: ${result?.reason || 'erro'}`);
      }
      return { handled: true };
    }

    default:
    case 'help':
    case 'ajuda': {
      await reply([
        '🎮 *Comandos de teste — Desafio Diário*',
        '',
        '`/desafio status` — Status do desafio atual',
        '`/desafio forcar [tipo]` — Força lançamento',
        '  Tipos: `game`, `riddle`, `pokemon`, `filme`, `quem`, `math`, `anagrama`',
        '`/desafio expirar` — Força expiração',
        '`/desafio reiniciar` — Expira + lança novo',
        '',
        'Comandos normais: `/responder`, `/dica`, `/skip`',
      ].join('\n'));
      return { handled: true };
    }
  }
}