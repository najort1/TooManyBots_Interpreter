/**
 * Download de mídia Baileys (mensagem atual ou citada).
 */

import { downloadMediaMessage } from '@whiskeysockets/baileys';

function unwrapContent(message) {
  let content = message;
  if (!content) return null;
  if (content.ephemeralMessage?.message) content = content.ephemeralMessage.message;
  if (content.viewOnceMessage?.message) content = content.viewOnceMessage.message;
  if (content.viewOnceMessageV2?.message) content = content.viewOnceMessageV2.message;
  if (content.viewOnceMessageV2Extension?.message) {
    content = content.viewOnceMessageV2Extension.message;
  }
  return content;
}

/**
 * Extrai tipo/mime da mídia embutida (ou quoted).
 */
export function inspectMediaContent(content) {
  const c = unwrapContent(content);
  if (!c) return null;

  if (c.imageMessage) {
    return {
      kind: 'image',
      messageType: 'image',
      mimeType: String(c.imageMessage.mimetype || 'image/jpeg'),
      node: { imageMessage: c.imageMessage },
    };
  }
  if (c.videoMessage) {
    return {
      kind: 'video',
      messageType: c.videoMessage.gifPlayback ? 'gif' : 'video',
      mimeType: String(c.videoMessage.mimetype || 'video/mp4'),
      node: { videoMessage: c.videoMessage },
    };
  }
  if (c.stickerMessage) {
    return {
      kind: 'sticker',
      messageType: 'sticker',
      mimeType: String(c.stickerMessage.mimetype || 'image/webp'),
      node: { stickerMessage: c.stickerMessage },
    };
  }
  if (c.documentMessage) {
    const mime = String(c.documentMessage.mimetype || '').toLowerCase();
    if (mime.startsWith('image/') || mime.startsWith('video/') || mime === 'image/gif') {
      return {
        kind: mime.startsWith('video/') || mime === 'image/gif' ? 'video' : 'image',
        messageType: mime.startsWith('video/') || mime === 'image/gif' ? 'document-video' : 'document-image',
        mimeType: String(c.documentMessage.mimetype || ''),
        node: { documentMessage: c.documentMessage },
      };
    }
  }
  return null;
}

function getContextInfo(content) {
  const c = unwrapContent(content) || {};
  return (
    c.extendedTextMessage?.contextInfo ||
    c.imageMessage?.contextInfo ||
    c.videoMessage?.contextInfo ||
    c.documentMessage?.contextInfo ||
    c.buttonsResponseMessage?.contextInfo ||
    c.templateButtonReplyMessage?.contextInfo ||
    null
  );
}

/**
 * Resolve mídia da mensagem atual ou da citada (reply).
 * @returns {{ media: object, source: 'self'|'quoted' } | null}
 */
export function resolveMediaFromRawMessage(rawMsg) {
  if (!rawMsg?.message) return null;
  const self = inspectMediaContent(rawMsg.message);
  if (self) return { media: self, source: 'self' };

  const ctx = getContextInfo(rawMsg.message);
  const quoted = ctx?.quotedMessage;
  if (quoted) {
    const q = inspectMediaContent(quoted);
    if (q) return { media: q, source: 'quoted', quotedParticipant: ctx.participant || '' };
  }
  return null;
}

/**
 * Baixa buffer da mídia resolvida.
 */
export async function downloadResolvedMedia({
  rawMsg,
  sock,
  logger = null,
  maxBytes = 12 * 1024 * 1024,
}) {
  const resolved = resolveMediaFromRawMessage(rawMsg);
  if (!resolved) return { ok: false, reason: 'no-media' };

  // Baileys downloadMediaMessage espera um msg-like com key + message
  let msgForDownload = rawMsg;
  if (resolved.source === 'quoted') {
    msgForDownload = {
      key: rawMsg.key,
      message: resolved.media.node,
    };
  }

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
