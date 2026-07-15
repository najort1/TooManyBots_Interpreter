import { downloadResolvedMedia } from '../../utils/mediaDownload.js';
import { convertToSticker, isStickerMediaType } from '../../utils/stickerConvert.js';

/**
 * /fig · /sticker · /figurinha
 * Envie imagem/vídeo/GIF com a legenda do comando, ou responda a uma mídia com /fig.
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
    await say('Envio de figurinha indisponível neste momento.');
    return { handled: true, reason: 'no-sticker-sender' };
  }

  if (!rawMessage) {
    await say(
      [
        '🎨 *Figurinha*',
        `Envie uma *imagem*, *GIF* ou *vídeo* com a legenda \`${p}fig\`,`,
        `ou *responda* uma mídia com \`${p}fig\`.`,
      ].join('\n')
    );
    return { handled: true, reason: 'no-raw-message' };
  }

  await say('⏳ Gerando figurinha…');

  const downloaded = await downloadResolvedMedia({
    rawMsg: rawMessage,
    sock,
    logger: getLogger?.() || null,
    maxBytes: Number(funConfig?.stickerMaxBytes) || 12 * 1024 * 1024,
  });

  if (!downloaded.ok) {
    if (downloaded.reason === 'no-media') {
      await say(
        [
          'Não achei imagem/vídeo nesta mensagem.',
          `Envie a mídia com legenda \`${p}fig\` ou responda a ela com \`${p}fig\`.`,
        ].join('\n')
      );
      return { handled: true, reason: 'no-media' };
    }
    if (downloaded.reason === 'media-too-large') {
      await say('Arquivo grande demais (máx. ~12 MB). Manda um menor.');
      return { handled: true, reason: 'media-too-large' };
    }
    await say('Não consegui baixar a mídia. Tenta de novo.');
    return { handled: true, reason: downloaded.reason };
  }

  try {
    const { buffer, animated } = await convertToSticker(downloaded.buffer, {
      messageType: downloaded.messageType,
      mimeType: downloaded.mimeType,
    });
    await replySticker(buffer);
    return { handled: true, animated, bytes: buffer.length };
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.includes('ffmpeg-not-found')) {
      await say('Pra figurinha animada precisa do *ffmpeg* instalado no servidor.');
      return { handled: true, reason: 'ffmpeg-not-found' };
    }
    if (msg.includes('sharp-unavailable')) {
      await say('Conversão de imagem indisponível (sharp).');
      return { handled: true, reason: 'sharp-unavailable' };
    }
    if (msg.includes('media-too-large')) {
      await say('Mídia grande demais pra virar figurinha.');
      return { handled: true, reason: 'media-too-large' };
    }
    getLogger?.()?.warn?.(
      { err: { message: msg } },
      'Fun sticker convert failed'
    );
    await say('Não deu pra gerar a figurinha. Tenta outra mídia.');
    return { handled: true, reason: 'convert-failed', error: msg };
  }
}
