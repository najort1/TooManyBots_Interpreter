/**
 * Correio dos Leitores — /carta <texto>
 *
 * Registra uma carta pra redação do The Group Times (Jornal das 23:59).
 * Validações de texto, filtro de sensibilidade e rate-limit ficam no
 * newsService.recordLetter (fonte única); aqui só traduzimos o resultado
 * pra copy sarcasticamente jornalística.
 */

const LETTER_CONFIRMATION =
  '📬 *Sua carta foi enviada à redação do The Group Times!*\n\n' +
  'Se sobreviver ao corte do editor-chefe (e ao desdém do comentarista residente), ' +
  'aparece na seção *CARTAS DOS LEITORES* da próxima edição.\n' +
  '_A redação não se responsabiliza por respostas sarcásticas._';

const LETTER_REJECTIONS = {
  'too-long':
    '✉️ Isso é um romance, não uma carta. Limite de 300 caracteres — resume com raiva e manda de novo.',
  sensitive:
    '🕵️ Carta retida pelo setor de segurança da redação: dados sensíveis (documento, telefone, senha) não vão pro jornal. Reescreve sem isso.',
  cooldown:
    '⏳ Devagar, correspondente! Só entra uma carta sua a cada 10 minutos — a caixa de entrada é pequena e o café é caro.',
  'daily-limit':
    '📮 Cota diária esgotada: no máximo 3 cartas por leitor por dia. O editor já pediu atestado médico.',
};

export async function handleCartaCommand({
  scopeKey,
  isGroup,
  userJid,
  args = [],
  reply,
  newsService,
  funConfig = {},
  msgTimeMs,
}) {
  if (!isGroup) {
    await reply('O correio dos leitores funciona só no *grupo* — carta anônima de DM a redação não aceita.');
    return { handled: true, reason: 'not-group' };
  }

  const text = (args || []).join(' ').trim();
  if (!text) {
    await reply(
      '📝 Escreve a carta, leitor! Ex.: `/carta o editorial de ontem foi uma covardia com o Carlão`.'
    );
    return { handled: true, reason: 'empty-text' };
  }

  const result = newsService?.recordLetter?.(scopeKey, {
    authorJid: userJid,
    text,
    now: Number(msgTimeMs) || Date.now(),
    funConfig,
  });

  if (!result?.ok) {
    const reason = String(result?.reason || 'letter-error');
    await reply(
      LETTER_REJECTIONS[reason] ||
        '🕯️ O correio está fechado agora (falha interna). Tenta de novo mais tarde.'
    );
    return { handled: true, reason };
  }

  await reply(LETTER_CONFIRMATION);
  return { handled: true, letterId: result.letter?.id || '' };
}
