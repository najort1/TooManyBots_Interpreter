/**
 * engine/messageParser.js
 *
 * Extrai um { text, listId } normalizado de um objeto de mensagem bruta do Baileys.
 * Manipula text, listResponseMessage, buttonsResponseMessage, extendedTextMessage, etc.
 */

/**
 * @param {object} msg - mensagem bruta do Baileys messages.upsert
 * @returns {{ text: string, listId: string|null, jid: string } | null}
 */
export function parseMessage(msg) {
  // Ignorar mensagens de si mesmo (mensagens do próprio bot)
  if (msg.key?.fromMe) return null;

  // Ignorar transmissões de status
  const jid = msg.key?.remoteJid ?? '';
  if (jid === 'status@broadcast') return null;
  if (!jid) return null;

  const content = msg.message;
  if (!content) return null;

  // ── Resposta de lista (usuário selecionou da lista interativa) ──────────────────
  if (content.listResponseMessage) {
    const lr = content.listResponseMessage;
    return {
      jid,
      text:   lr.title ?? lr.singleSelectReply?.selectedRowId ?? '',
      listId: lr.singleSelectReply?.selectedRowId ?? null,
    };
  }

  // ── Resposta de botões ─────────────────────────────────────────────────────
  if (content.buttonsResponseMessage) {
    const br = content.buttonsResponseMessage;
    return {
      jid,
      text:   br.selectedDisplayText ?? br.selectedButtonId ?? '',
      listId: null,
    };
  }

  // ── Resposta de botão de modelo ────────────────────────────────────────────────
  if (content.templateButtonReplyMessage) {
    const tb = content.templateButtonReplyMessage;
    return {
      jid,
      text:   tb.selectedDisplayText ?? tb.selectedId ?? '',
      listId: null,
    };
  }

  // ── Texto estendido (links, mensagens citadas) ───────────────────────────────
  if (content.extendedTextMessage) {
    return {
      jid,
      text:   content.extendedTextMessage.text ?? '',
      listId: null,
    };
  }

  // ── Texto simples ────────────────────────────────────────────────────────────
  if (content.conversation) {
    return {
      jid,
      text:   content.conversation,
      listId: null,
    };
  }

  // ── Imagem / áudio / etc. — tratar como vazio por enquanto ────────────────────────
  return { jid, text: '', listId: null };
}
