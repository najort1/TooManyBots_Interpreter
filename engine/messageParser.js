/**
 * engine/messageParser.js
 *
 * Extrai um { text, listId } normalizado de um objeto de mensagem bruta do Baileys.
 * Manipula text, listResponseMessage, buttonsResponseMessage, extendedTextMessage, etc.
 */

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
  const senderPn = messageKey.senderPn ?? messageKey.sender_pn ?? '';
  const jid = remoteJid.endsWith('@lid') && senderPn ? senderPn : remoteJid;
  const isGroup = remoteJid.endsWith('@g.us');

  let content = msg.message;
  if (!content) return null;

  if (content.ephemeralMessage?.message) {
    content = content.ephemeralMessage.message;
  }
  if (content.viewOnceMessage?.message) {
    content = content.viewOnceMessage.message;
  }
  if (content.viewOnceMessageV2?.message) {
    content = content.viewOnceMessageV2.message;
  }
  if (content.viewOnceMessageV2Extension?.message) {
    content = content.viewOnceMessageV2Extension.message;
  }

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
