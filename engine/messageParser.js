/**
 * engine/messageParser.js
 *
 * Extrai um { text, listId } normalizado de um objeto de mensagem bruta do Baileys.
 * Manipula text, listResponseMessage, buttonsResponseMessage, extendedTextMessage, etc.
 */

/**
 * @param {object} msg - mensagem bruta do Baileys messages.upsert
 * @returns {{ id: string, text: string, listId: string|null, jid: string, isGroup: boolean, messageKey: object } | null}
 */
export function parseMessage(msg) {
  // Ignorar mensagens de si mesmo (mensagens do próprio bot)
  if (msg.key?.fromMe) return null;

  // Ignorar transmissões de status
  const remoteJid = msg.key?.remoteJid ?? '';
  if (remoteJid === 'status@broadcast') return null;
  if (!remoteJid) return null;
  const jid = remoteJid.endsWith('@lid') && msg.key?.senderPn ? msg.key.senderPn : remoteJid;
  const isGroup = remoteJid.endsWith('@g.us');
  const messageKey = msg.key ?? {};

  const content = msg.message;
  if (!content) return null;

  // ── Resposta de botões ─────────────────────────────────────────────────────
  if (content.buttonsResponseMessage) {
    const br = content.buttonsResponseMessage;
    return {
      id: msg.key.id,
      jid,
      isGroup,
      messageKey,
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
      text: content.conversation,
      listId: null,
    };
  }

  // ── Imagem / áudio / etc. — tratar como vazio por enquanto ────────────────────────
  return { id: msg.key.id, jid, isGroup, messageKey, text: '', listId: null };
}
