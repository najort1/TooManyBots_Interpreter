/**
 * engine/sender.js
 *
 * Abstração sobre os métodos de envio do Baileys.
 * Centraliza o envio de mensagens para que mudar a versão do Baileys
 * só exija alterações aqui.
 */

/**
 * Envia uma mensagem de texto simples.
 */
export async function sendTextMessage(sock, jid, text) {
  await sock.sendMessage(jid, { text });
}

/**
 * Envia uma lista interativa nativa do WhatsApp.
 *
 * @param {object} sock     - Socket Baileys
 * @param {string} jid      - JID do destinatário
 * @param {object} options
 * @param {string} options.text        - texto do cabeçalho acima da lista
 * @param {string} [options.title]     - rótulo do botão da lista (padrão: "Ver opções")
 * @param {string} [options.footer]    - texto do rodapé
 * @param {Array}  options.items       - [{ id, title, description }]
 */
export async function sendListMessage(sock, jid, { text, title = 'Ver opções', footer = '', items }) {
  const sections = [
    {
      title: 'Opções',
      rows: items.map(item => ({
        id:          item.id,
        title:       String(item.title).substring(0, 24),       // WhatsApp limit
        description: String(item.description ?? '').substring(0, 72),
      })),
    },
  ];

  await sock.sendMessage(jid, {
    listMessage: {
      title: text,
      text,
      footerText: footer,
      buttonText: title,
      listType: 1,
      sections,
    },
  });
}

/**
 * Envia indicador de digitação, então opcionalmente para.
 */
export async function sendTyping(sock, jid, durationMs = 1000) {
  await sock.sendPresenceUpdate('composing', jid);
  await new Promise(r => setTimeout(r, durationMs));
  await sock.sendPresenceUpdate('paused', jid);
}
