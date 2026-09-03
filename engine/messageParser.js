/**
 * engine/messageParser.js
 *
 * Extrai um { text, listId } normalizado de um objeto de mensagem bruta do Baileys.
 * Manipula text, listResponseMessage, buttonsResponseMessage, extendedTextMessage, etc.
 */

function unwrapMessageContent(msgContent) {
  let content = msgContent;
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
 * @param {object} msg - mensagem bruta do Baileys messages.upsert
 * @returns {{
 *   id: string,
 *   text: string,
 *   listId: string|null,
 *   jid: string,
 *   isGroup: boolean,
 *   messageKey: object,
 *   messageType: string,
 *   mediaMimeType: string,
 *   mediaFileName: string,
 * } | null}
 */
export function parseMessage(msg) {
  // Ignorar mensagens de si mesmo (mensagens do próprio bot)
  if (msg.key?.fromMe) return null;

  // Ignorar transmissões de status
  const messageKey = msg.key ?? {};
  const remoteJid = messageKey.remoteJid ?? messageKey.remote_jid ?? '';
  if (remoteJid === 'status@broadcast') return null;
  if (!remoteJid) return null;
  // Baileys v7 usa o JID primário (LID) em remoteJid. remoteJidAlt é PN
  // legado e só deve servir à migração de dados, nunca substituir a identidade.
  const jid = remoteJid;
  const isGroup = remoteJid.endsWith('@g.us');

  let content = unwrapMessageContent(msg.message);
  if (!content) return null;

  // ── Resposta de botões ─────────────────────────────────────────────────────
  if (content.buttonsResponseMessage) {
    const br = content.buttonsResponseMessage;
    return {
      id: msg.key.id,
      jid,
      isGroup,
      messageKey,
      messageType: 'button',
      mediaMimeType: '',
      mediaFileName: '',
      text: br.selectedDisplayText ?? br.selectedButtonId ?? '',
      listId: br.selectedButtonId ?? null,
    };
  }

  // ── Resposta de botão de modelo ────────────────────────────────────────────────
  if (content.templateButtonReplyMessage) {
    const tb = content.templateButtonReplyMessage;
    return {
      id: msg.key.id,
      jid,
      isGroup,
      messageKey,
      messageType: 'template-button',
      mediaMimeType: '',
      mediaFileName: '',
      text: tb.selectedDisplayText ?? tb.selectedId ?? '',
      listId: null,
    };
  }

  // ── Texto estendido (links, mensagens citadas) ───────────────────────────────
  if (content.extendedTextMessage) {
    return {
      id: msg.key.id,
      jid,
      isGroup,
      messageKey,
      messageType: 'extended-text',
      mediaMimeType: '',
      mediaFileName: '',
      text: content.extendedTextMessage.text ?? '',
      listId: null,
    };
  }

  // ── Álbum (múltiplas mídias em uma mensagem) ──────────────────────────────────
  if (content.albumMessage) {
    const firstMsg = unwrapMessageContent(content.albumMessage.messages?.[0]) || {};
    const caption =
      content.albumMessage.caption ||
      firstMsg.imageMessage?.caption ||
      firstMsg.videoMessage?.caption ||
      firstMsg.documentMessage?.caption ||
      '';
    const mime =
      firstMsg.imageMessage?.mimetype ||
      firstMsg.videoMessage?.mimetype ||
      firstMsg.documentMessage?.mimetype ||
      'image/jpeg';
    return {
      id: msg.key.id,
      jid,
      isGroup,
      messageKey,
      messageType: 'album',
      mediaMimeType: String(mime).trim(),
      mediaFileName: '',
      text: caption,
      listId: null,
    };
  }

  // ── Texto simples ────────────────────────────────────────────────────────────
  if (content.conversation) {
    return {
      id: msg.key.id,
      jid,
      isGroup,
      messageKey,
      messageType: 'text',
      mediaMimeType: '',
      mediaFileName: '',
      text: content.conversation,
      listId: null,
    };
  }

  if (content.imageMessage) {
    return {
      id: msg.key.id,
      jid,
      isGroup,
      messageKey,
      messageType: 'image',
      mediaMimeType: String(content.imageMessage.mimetype || '').trim(),
      mediaFileName: String(content.imageMessage.fileName || '').trim(),
      text: content.imageMessage.caption ?? '',
      listId: null,
    };
  }

  if (content.videoMessage) {
    return {
      id: msg.key.id,
      jid,
      isGroup,
      messageKey,
      messageType: content.videoMessage.gifPlayback ? 'gif' : 'video',
      mediaMimeType: String(content.videoMessage.mimetype || '').trim(),
      mediaFileName: String(content.videoMessage.fileName || '').trim(),
      text: content.videoMessage.caption ?? '',
      listId: null,
    };
  }

  if (content.stickerMessage) {
    return {
      id: msg.key.id,
      jid,
      isGroup,
      messageKey,
      messageType: 'sticker',
      mediaMimeType: String(content.stickerMessage.mimetype || 'image/webp').trim(),
      mediaFileName: '',
      text: '',
      listId: null,
    };
  }

  if (content.documentMessage) {
    const mime = String(content.documentMessage.mimetype || '').trim().toLowerCase();
    const isImage = mime.startsWith('image/');
    const isVideo = mime.startsWith('video/') || mime === 'image/gif';
    return {
      id: msg.key.id,
      jid,
      isGroup,
      messageKey,
      messageType: isImage ? 'document-image' : isVideo ? 'document-video' : 'document',
      mediaMimeType: String(content.documentMessage.mimetype || '').trim(),
      mediaFileName: String(content.documentMessage.fileName || '').trim(),
      text: content.documentMessage.caption ?? content.documentMessage.title ?? '',
      listId: null,
    };
  }

  // ── Outros tipos ainda não suportados no parser ────────────────────────────────────
  return {
    id: msg.key.id,
    jid,
    isGroup,
    messageKey,
    messageType: 'unknown',
    mediaMimeType: '',
    mediaFileName: '',
    text: '',
    listId: null,
  };
}
