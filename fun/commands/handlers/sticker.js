import { downloadAllResolvedMedia } from '../../utils/mediaDownload.js';
import { convertToSticker, isStickerMediaType } from '../../utils/stickerConvert.js';
import { fmt } from '../../messages/index.js';

/**
 * /fig · /sticker · /figurinha
 * Envie imagem/vídeo/GIF com a legenda do comando, ou responda a uma mídia com /fig.
 * Suporta múltiplas imagens em uma mensagem (álbum) e resposta a mensagem citada.
 */
export async function handleStickerCommand({
  funConfig,
  reply,
  replyToChat,
  replySticker,
  sock,
  rawMessage,
  getLogger,
}) {
  const p = funConfig?.prefix || '/';
  // status no mesmo chat da mídia (não no DM de rank)
  const say = typeof replyToChat === 'function' ? replyToChat : reply;

  if (typeof replySticker !== 'function') {
    await say(fmt.notAvailable({ command: 'fig' }));
    return { handled: true, reason: 'no-sticker-sender' };
  }

  if (!rawMessage) {
    await say(
      [
        '🎨 *Figurinha*',
        `Envie uma *imagem*, *GIF* ou *vídeo* com a legenda \`${p}fig\`,`,
        `ou *responda* uma mídia com \`${p}fig\`.`,
        `Também suporta *álbuns* (múltiplas imagens de uma vez).`,
      ].join('\n')
    );
    return { handled: true, reason: 'no-raw-message' };
  }

  await say('⏳ Gerando figurinha(s)…');

  const downloaded = await downloadAllResolvedMedia({
    rawMsg: rawMessage,
    sock,
    logger: getLogger?.() || null,
    maxBytes: Number(funConfig?.stickerMaxBytes) || 12 * 1024 * 1024,
  });

  // Filtra apenas os downloads bem-sucedidos
  const successful = downloaded.filter((d) => d.ok);
  const failed = downloaded.filter((d) => !d.ok);

  if (successful.length === 0) {
    // Todos falharam - usa a primeira razão de erro
    const firstFail = failed[0] || { reason: 'unknown' };
    if (firstFail.reason === 'no-media') {
      await say(
        [
          'Não achei imagem/vídeo nesta mensagem.',
          `Envie a mídia com legenda \`${p}fig\` ou responda a ela com \`${p}fig\`.`,
          `Também funciona com álbuns (múltiplas imagens).`,
        ].join('\n')
      );
      return { handled: true, reason: 'no-media' };
    }
    if (firstFail.reason === 'media-too-large') {
      await say('Arquivo grande demais (máx. ~12 MB). Manda um menor.');
      return { handled: true, reason: 'media-too-large' };
    }
    await say('Não consegui baixar a mídia. Tenta de novo.');
    return { handled: true, reason: firstFail.reason };
  }

  const results = [];
  let successCount = 0;
  let failCount = 0;

  for (const item of successful) {
    try {
      const { buffer, animated } = await convertToSticker(item.buffer, {
        messageType: item.messageType,
        mimeType: item.mimeType,
      });
      await replySticker(buffer);
      successCount++;
      results.push({ animated, bytes: buffer.length, source: item.source, albumIndex: item.albumIndex });
    } catch (err) {
      const msg = String(err?.message || err);
      failCount++;
      results.push({ error: msg, source: item.source, albumIndex: item.albumIndex });
      getLogger?.()?.warn?.(
        { err: { message: msg } },
        'Fun sticker convert failed for item'
      );
    }
  }

  if (successCount > 0) {
    if (successCount > 1) {
      await say(`✅ ${successCount} figurinha(s) criada(s)!`);
    }
    return { handled: true, successCount, failCount, results };
  }

  // Se chegou aqui, todas falharam na conversão
  const firstError = results.find(r => r.error)?.error || 'convert-failed';
  if (firstError.includes('ffmpeg-not-found')) {
    await say('Figurinha animada não disponível no momento.');
    return { handled: true, reason: 'ffmpeg-not-found' };
  }
  if (firstError.includes('sharp-unavailable')) {
    await say('Conversão de imagem indisponível (sharp).');
    return { handled: true, reason: 'sharp-unavailable' };
  }
  if (firstError.includes('media-too-large')) {
    await say('Mídia grande demais pra virar figurinha.');
    return { handled: true, reason: 'media-too-large' };
  }
  await say('Não foi possível gerar a(s) figurinha(s). Tente outra mídia.');
  return { handled: true, reason: 'convert-failed', error: firstError };
}