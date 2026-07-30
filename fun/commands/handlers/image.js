function usage(prefix = '/') {
  return [
    `Uso: ${prefix}gerar <prompt>`,
    `ou: ${prefix}imaginar <prompt>`,
  ].join('\n');
}

function quotaCaption(kind, used, limit, remaining) {
  const mode = kind === 'gerar' ? 'com memória do grupo' : 'sem memória do grupo';
  return [
    `🖼️ *Imagem gerada* (${mode})`,
    `📊 Limite diário global: ${used}/${limit}`,
    `⏳ Restantes hoje: ${remaining}`,
  ].join('\n');
}

function quotaBlockedMessage(limit) {
  return [
    '🚫 Limite diário de geração de imagens atingido.',
    `Hoje o bot já gerou ${limit} imagem(ns) no total, somando todos os grupos.`,
    'O contador zera às 00h no horário de São Paulo.',
  ].join('\n');
}

function failMessage(result) {
  if (!result) return 'Falha ao gerar imagem agora. Tente novamente em instantes.';
  if (result.reason === 'empty-prompt') return 'Escreva o prompt da imagem após o comando.';
  if (result.reason === 'disabled') return 'Geração de imagens desabilitada no momento.';
  if (result.reason === 'quota-exceeded') return quotaBlockedMessage(result.limit || 25);
  if (result.reason === 'timeout') return 'A geração demorou demais e expirou. Tente um prompt menor ou mais direto.';
  return 'Falha ao gerar imagem agora. Tente novamente em instantes.';
}

async function handleImageLikeCommand(ctx, { withMemory, commandLabel }) {
  const {
    imageGenerationService,
    scopeKey,
    userJid,
    args = [],
    reply,
    replyImage,
    replyImageUrl,
    funConfig,
  } = ctx;

  if (!imageGenerationService) {
    await reply('Gerador de imagens indisponível no momento.');
    return { handled: true, reason: 'no-service' };
  }

  const prompt = String((args || []).join(' ') || '').trim();
  if (!prompt) {
    await reply(usage(funConfig?.prefix || '/'));
    return { handled: true, reason: 'empty-prompt' };
  }

  const result = await imageGenerationService.generateImage({
    scopeKey,
    userJid,
    prompt,
    command: commandLabel,
    withMemory,
    now: Date.now(),
  });

  if (!result?.ok) {
    await reply(failMessage(result));
    return { handled: true, result };
  }

  const caption = quotaCaption(commandLabel, result.used, result.limit, result.remaining);

  if (result.buffer && typeof replyImage === 'function') {
    await replyImage(result.buffer, caption);
    return { handled: true, result };
  }

  if (result.url && typeof replyImageUrl === 'function') {
    await replyImageUrl(result.url, caption, '');
    return { handled: true, result };
  }

  if (result.url) {
    await reply(`${caption}\n${result.url}`);
    return { handled: true, result };
  }

  await reply(`${caption}\n(Imagem gerada, mas sem forma de envio disponível neste contexto.)`);
  return { handled: true, result };
}

/**
 * /gerar <prompt>
 * Injeta lore do grupo no prompt antes de chamar a proxy.
 */
export async function handleGerarCommand(ctx) {
  return handleImageLikeCommand(ctx, { withMemory: true, commandLabel: 'gerar' });
}

/**
 * /imaginar <prompt>
 * Envia apenas o prompt do usuário, sem lore do grupo.
 */
export async function handleImaginarCommand(ctx) {
  return handleImageLikeCommand(ctx, { withMemory: false, commandLabel: 'imaginar' });
}
