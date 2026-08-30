/**
 * Download de mídia Baileys (mensagem atual, citada ou álbum).
 */

import { downloadMediaMessage, downloadContentFromMessage } from '@whiskeysockets/baileys';

/**
 * Desembrulha recursivamente contêineres de mensagem do Baileys/WhatsApp
 * (ephemeral, viewOnce, documentWithCaption, edited, etc.).
 */
export function unwrapContent(message) {
  let content = message;
  let depth = 0;
  while (content && typeof content === 'object' && depth < 10) {
    depth++;
    if (content.ephemeralMessage?.message) {
      content = content.ephemeralMessage.message;
      continue;
    }
    if (content.viewOnceMessage?.message) {
      content = content.viewOnceMessage.message;
      continue;
    }
    if (content.viewOnceMessageV2?.message) {
      content = content.viewOnceMessageV2.message;
      continue;
    }
    if (content.viewOnceMessageV2Extension?.message) {
      content = content.viewOnceMessageV2Extension.message;
      continue;
    }
    if (content.documentWithCaptionMessage?.message) {
      content = content.documentWithCaptionMessage.message;
      continue;
    }
    if (content.editedMessage?.message) {
      content = content.editedMessage.message;
      continue;
    }
    if (content.deviceSentMessage?.message) {
      content = content.deviceSentMessage.message;
      continue;
    }
    if (content.botInvokeMessage?.message) {
      content = content.botInvokeMessage.message;
      continue;
    }
    break;
  }
  return content;
}

/**
 * Extrai tipo/mime da mídia embutida (ou quoted).
 */
export function inspectMediaContent(content) {
  if (!content || typeof content !== 'object') return null;
  const c = unwrapContent(content);
  if (!c || typeof c !== 'object') return null;

  if (c.imageMessage) {
    return {
      kind: 'image',
      messageType: 'image',
      mimeType: String(c.imageMessage.mimetype || 'image/jpeg'),
      node: { imageMessage: c.imageMessage },
      mediaData: c.imageMessage,
    };
  }
  if (c.videoMessage) {
    return {
      kind: 'video',
      messageType: c.videoMessage.gifPlayback ? 'gif' : 'video',
      mimeType: String(c.videoMessage.mimetype || 'video/mp4'),
      node: { videoMessage: c.videoMessage },
      mediaData: c.videoMessage,
    };
  }
  if (c.ptvMessage) {
    return {
      kind: 'video',
      messageType: 'video',
      mimeType: String(c.ptvMessage.mimetype || 'video/mp4'),
      node: { ptvMessage: c.ptvMessage },
      mediaData: c.ptvMessage,
    };
  }
  if (c.stickerMessage) {
    return {
      kind: 'sticker',
      messageType: 'sticker',
      mimeType: String(c.stickerMessage.mimetype || 'image/webp'),
      node: { stickerMessage: c.stickerMessage },
      mediaData: c.stickerMessage,
    };
  }
  if (c.documentMessage) {
    const mime = String(c.documentMessage.mimetype || '').toLowerCase();
    const fileName = String(c.documentMessage.fileName || '').toLowerCase();
    const isImg = mime.startsWith('image/') || /\.(png|jpe?g|webp|bmp|svg)$/i.test(fileName);
    const isVid = mime.startsWith('video/') || mime === 'image/gif' || /\.(mp4|gif|webm|mkv|mov)$/i.test(fileName);
    if (isImg || isVid) {
      return {
        kind: isVid ? 'video' : 'image',
        messageType: isVid ? 'document-video' : 'document-image',
        mimeType: String(c.documentMessage.mimetype || (isVid ? 'video/mp4' : 'image/jpeg')),
        node: { documentMessage: c.documentMessage },
        mediaData: c.documentMessage,
      };
    }
  }

  // Verifica recursivamente nós aninhados caso haja outro wrapper
  for (const key of Object.keys(c)) {
    const val = c[key];
    if (val && typeof val === 'object' && key !== 'contextInfo' && key !== 'quotedMessage') {
      const unwrapped = unwrapContent(val);
      if (unwrapped && unwrapped !== c) {
        if (unwrapped.imageMessage || unwrapped.videoMessage || unwrapped.stickerMessage || unwrapped.documentMessage || unwrapped.ptvMessage) {
          const found = inspectMediaContent(unwrapped);
          if (found) return found;
        }
      }
    }
  }

  return null;
}

/**
 * Busca de forma abrangente e recursiva o contextInfo em qualquer nó da mensagem.
 */
export function findContextInfo(message) {
  if (!message || typeof message !== 'object') return null;
  const queue = [message];
  const seen = new Set();

  while (queue.length) {
    const node = queue.shift();
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);

    if (node.contextInfo && typeof node.contextInfo === 'object') {
      return node.contextInfo;
    }
    if (node.quotedMessage && typeof node.quotedMessage === 'object') {
      return node;
    }

    for (const val of Object.values(node)) {
      if (val && typeof val === 'object') {
        queue.push(val);
      }
    }
  }
  return null;
}

/**
 * Extrai a chave da mensagem citada (quoted) se disponível.
 */
function getQuotedMessageKey(rawMsg, ctx) {
  const stanzaId = ctx?.stanzaId;
  const participant = ctx?.participant || ctx?.participantPn || '';
  const remoteJid = rawMsg?.key?.remoteJid || rawMsg?.key?.remote_jid || '';
  return {
    id: stanzaId || rawMsg?.key?.id || '',
    remoteJid,
    fromMe: false,
    participant: participant || undefined,
  };
}

/**
 * Extrai o nó message do objeto WAMessage ou do próprio objeto.
 */
function getRawMessageContent(rawMsg) {
  if (!rawMsg) return null;
  if (rawMsg.message && typeof rawMsg.message === 'object') {
    return rawMsg.message;
  }
  return rawMsg;
}

/**
 * Resolve mídia da mensagem atual ou da citada (reply).
 * @returns {{ media: object, source: 'self'|'quoted', quotedKey?: object, quotedParticipant?: string } | null}
 */
export function resolveMediaFromRawMessage(rawMsg) {
  if (!rawMsg) return null;
  const msgContent = getRawMessageContent(rawMsg);
  const self = inspectMediaContent(msgContent);
  if (self) return { media: self, source: 'self' };

  const ctx = findContextInfo(msgContent);
  const quoted = ctx?.quotedMessage;
  if (quoted) {
    const q = inspectMediaContent(quoted);
    if (q) {
      const quotedKey = getQuotedMessageKey(rawMsg, ctx);
      return {
        media: q,
        source: 'quoted',
        quotedKey,
        quotedParticipant: ctx.participant || '',
      };
    }
  }
  return null;
}

/**
 * Resolve TODAS as mídias de uma mensagem (incluindo álbuns e mensagens citadas).
 * @returns {Array<{ media: object, source: 'self'|'quoted'|'album', quotedKey?: object, quotedParticipant?: string, albumIndex?: number }>}
 */
export function resolveAllMediaFromRawMessage(rawMsg) {
  if (!rawMsg) return [];
  const msgContent = getRawMessageContent(rawMsg);
  if (!msgContent) return [];

  const results = [];
  const content = unwrapContent(msgContent);
  if (!content) return results;

  // 1. Verifica albumMessage direto (múltiplas mídias em uma mensagem)
  if (content.albumMessage) {
    const album = content.albumMessage;
    const messages = album.messages || [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const media = inspectMediaContent(msg);
      if (media) {
        results.push({
          media,
          source: 'album',
          albumIndex: i,
          quotedKey: null,
          quotedParticipant: '',
        });
      }
    }
    if (results.length > 0) return results;
  }

  // 2. Mídia direta na mensagem atual
  const self = inspectMediaContent(msgContent);
  if (self) {
    results.push({ media: self, source: 'self', quotedKey: null, quotedParticipant: '' });
  }

  // 3. Mídia na mensagem citada (reply)
  const ctx = findContextInfo(msgContent);
  const quoted = ctx?.quotedMessage;
  if (quoted) {
    const quotedContent = unwrapContent(quoted);
    // Verifica se a mensagem citada é um álbum
    if (quotedContent?.albumMessage) {
      const album = quotedContent.albumMessage;
      const messages = album.messages || [];
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const media = inspectMediaContent(msg);
        if (media) {
          results.push({
            media,
            source: 'album',
            albumIndex: i,
            quotedKey: getQuotedMessageKey(rawMsg, ctx),
            quotedParticipant: ctx?.participant || '',
          });
        }
      }
    } else {
      const q = inspectMediaContent(quoted);
      if (q) {
        const quotedKey = getQuotedMessageKey(rawMsg, ctx);
        results.push({
          media: q,
          source: 'quoted',
          quotedKey,
          quotedParticipant: ctx?.participant || '',
        });
      }
    }
  }

  return results;
}

/**
 * Função utilitária para baixar buffer com fallback inteligente:
 * 1º tenta Baileys downloadMediaMessage (que suporta reuploadRequest)
 * 2º fallback para Baileys downloadContentFromMessage usando os dados brutos da mídia
 */
async function fetchMediaBuffer(msgForDownload, mediaItem, sock, logger) {
  // Tentativa 1: downloadMediaMessage
  try {
    const buffer = await downloadMediaMessage(
      msgForDownload,
      'buffer',
      {},
      {
        logger: logger || undefined,
        reuploadRequest: sock?.updateMediaMessage?.bind?.(sock) || sock?.updateMediaMessage,
      }
    );
    if (buffer && Buffer.isBuffer(buffer) && buffer.length > 0) {
      return buffer;
    }
  } catch (err1) {
    logger?.debug?.({ err: err1?.message || String(err1) }, 'downloadMediaMessage failed, trying downloadContentFromMessage fallback');
  }

  // Tentativa 2: downloadContentFromMessage direto
  try {
    const mediaData = mediaItem.media?.mediaData || Object.values(mediaItem.media?.node || {})[0];
    if (mediaData && (mediaData.url || mediaData.directPath || mediaData.mediaKey)) {
      let mediaType = mediaItem.media?.kind === 'video' ? 'video' : mediaItem.media?.kind === 'sticker' ? 'sticker' : 'image';
      if (mediaItem.media?.messageType === 'document-image' || mediaItem.media?.messageType === 'document-video') {
        mediaType = 'document';
      }
      const stream = await downloadContentFromMessage(mediaData, mediaType);
      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);
      if (buffer && buffer.length > 0) {
        return buffer;
      }
    }
  } catch (err2) {
    logger?.debug?.({ err: err2?.message || String(err2) }, 'downloadContentFromMessage fallback failed');
  }

  return null;
}

/**
 * Baixa buffer de uma mídia resolvida.
 */
export async function downloadResolvedMedia({
  rawMsg,
  sock,
  logger = null,
  maxBytes = 12 * 1024 * 1024,
}) {
  const resolved = resolveMediaFromRawMessage(rawMsg);
  if (!resolved) return { ok: false, reason: 'no-media' };

  let msgForDownload = rawMsg;
  if (resolved.source === 'quoted') {
    msgForDownload = {
      key: resolved.quotedKey || rawMsg.key,
      message: resolved.media.node,
    };
  }

  try {
    const buffer = await fetchMediaBuffer(msgForDownload, resolved, sock, logger);

    if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
      return { ok: false, reason: 'empty-download' };
    }
    if (buffer.length > maxBytes) {
      return { ok: false, reason: 'media-too-large', size: buffer.length };
    }

    return {
      ok: true,
      buffer,
      messageType: resolved.media.messageType,
      mimeType: resolved.media.mimeType,
      source: resolved.source,
    };
  } catch (err) {
    return {
      ok: false,
      reason: 'download-failed',
      error: err?.message || String(err),
    };
  }
}

/**
 * Baixa buffers de múltiplas mídias resolvidas.
 * Processa sequencialmente para manter estabilidade.
 */
export async function downloadAllResolvedMedia({
  rawMsg,
  sock,
  logger = null,
  maxBytes = 12 * 1024 * 1024,
}) {
  const allMedia = resolveAllMediaFromRawMessage(rawMsg);
  if (allMedia.length === 0) return [{ ok: false, reason: 'no-media' }];

  const results = [];
  for (const mediaItem of allMedia) {
    let msgForDownload = rawMsg;
    if (mediaItem.source === 'quoted' || mediaItem.source === 'album') {
      msgForDownload = {
        key: mediaItem.quotedKey || rawMsg.key,
        message: mediaItem.media.node,
      };
    } else if (mediaItem.source === 'self') {
      msgForDownload = rawMsg;
    }

    try {
      const buffer = await fetchMediaBuffer(msgForDownload, mediaItem, sock, logger);

      if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
        results.push({ ok: false, reason: 'empty-download', mediaItem });
        continue;
      }
      if (buffer.length > maxBytes) {
        results.push({ ok: false, reason: 'media-too-large', size: buffer.length, mediaItem });
        continue;
      }

      results.push({
        ok: true,
        buffer,
        messageType: mediaItem.media.messageType,
        mimeType: mediaItem.media.mimeType,
        source: mediaItem.source,
        albumIndex: mediaItem.albumIndex,
      });
    } catch (err) {
      results.push({
        ok: false,
        reason: 'download-failed',
        error: err?.message || String(err),
        mediaItem,
      });
    }
  }

  return results;
}