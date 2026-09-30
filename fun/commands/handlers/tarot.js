/**
 * /tarot [pergunta]
 * Tiragem de arcanos + leitura (Zen/Ollama/template).
 */
import { fmt } from '../../messages/index.js';

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
        '🔮 *Tarô Oracular*',
        `Uso: \`${p}tarot sua pergunta aqui\``,
        `Ou: \`${p}tarot\` — leitura oracular do momento presente`,
        'Tiragem clássica de *3 arcanos* com posições e dignidades (direta ou invertida).',
        'Interpretação oracular profunda e séria sobre suas escolhas e tendências.',
        '_O tarô reflete estados de consciência e autoconhecimento; suas decisões pertencem ao seu livre-arbítrio._',
      ].join('\n')
    );
    return { handled: true };
  }

  await reply('🔮 *Embaralhando os arcanos sagrados...* Silencie a mente e concentre-se na sua intenção.');

  const result = await tarotService.reading({
    userJid,
    scopeKey,
    question,
    funConfig,
  });

  if (!result.ok) {
    if (result.reason === 'cooldown') {
      await reply(fmt.cooldown('tarot', result.retryInMs || result.retryIn));
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
    await reply('As cartas silenciaram neste momento. Tente novamente em instantes.');
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
