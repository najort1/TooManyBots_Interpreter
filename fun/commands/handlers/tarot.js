/**
 * /tarot [pergunta]
 * Tiragem de arcanos + leitura (Zen/Ollama/template).
 */

export async function handleTarotCommand({
  userJid,
  scopeKey,
  tarotService,
  funConfig,
  reply,
  args,
}) {
  const p = funConfig.prefix || '/';

  if (!tarotService) {
    await reply('Tarô ainda não tá ligado neste bot.');
    return { handled: true };
  }

  const question = (args || []).join(' ').trim();
  const helpish =
    !question ||
    /^(help|ajuda|\?)$/i.test(question);

  if (helpish && !question) {
    // sem pergunta = leitura geral ok; só help explícito bloqueia
  }

  if (question && /^(help|ajuda|\?)$/i.test(question)) {
    await reply(
      [
        '🔮 *Tarô Fun*',
        `Uso: \`${p}tarot sua pergunta aqui\``,
        `Ou: \`${p}tarot\` — leitura geral do clima`,
        'Tiragem de *3 arcanos* (pode vir invertida).',
        'O bot marca a carta; o “vidente” (IA) interpreta em pt-BR, resumido.',
        '_É entretenimento, não consulta profissional._',
      ].join('\n')
    );
    return { handled: true };
  }

  await reply('🔮 Embaralhando… _não é papo de coach, é arcano com sotaque BR._');

  const result = await tarotService.reading({
    userJid,
    scopeKey,
    question,
    funConfig,
  });

  if (!result.ok) {
    if (result.reason === 'cooldown') {
      await reply(`As cartas pediram um tempo. Tenta de novo em *${result.retryIn}*.`);
      return { handled: true };
    }
    if (result.reason === 'question-too-long') {
      await reply(`Pergunta grande demais (máx *${result.max}* caracteres). Resume aí.`);
      return { handled: true };
    }
    if (result.reason === 'disabled') {
      await reply('Tarô desligado na config.');
      return { handled: true };
    }
    await reply('As cartas se espalharam no chão. Tenta de novo.');
    return { handled: true };
  }

  const body = [
    '🔮 *Tiragem*',
    result.question && result.question !== '(leitura geral)'
      ? `Pergunta: _${result.question}_`
      : 'Pergunta: _leitura geral_',
    '',
    result.drawText,
    '',
    '✨ *Leitura*',
    result.reading,
  ]
    .filter(Boolean)
    .join('\n');

  // WhatsApp costuma engasgar em textos enormes; já limitado a 3k na leitura + header
  await reply(body.slice(0, 3500));
  return { handled: true, result };
}
