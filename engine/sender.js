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
 * Envia botões (até 3 opções) ou texto numerado como alternativa.
 *
 * @param {object} sock     - Socket Baileys
 * @param {string} jid      - JID do destinatário
 * @param {object} options
 * @param {string} options.text        - texto da mensagem
 * @param {string} [options.footer]    - texto do rodapé
 * @param {Array}  options.buttons     - [{ id, text }] máximo 3 botões
 */
export async function sendButtons(sock, jid, { text, footer = '', buttons }) {
  // WhatsApp limita a 3 botões
  if (buttons.length <= 3) {
    try {
      await sock.sendMessage(jid, {
        text,
        footer,
        buttons: buttons.map(btn => ({
          buttonId: btn.id,
          buttonText: { displayText: btn.text },
          type: 1
        })),
        headerType: 1
      });
      console.log(`✅ Botões enviados para ${jid}`);
      return;
    } catch (err) {
      console.warn(`⚠️ Erro ao enviar botões para ${jid}:`, err.message);
    }
  }

  // Alternativa: texto numerado
  const lines = buttons.map((btn, idx) => `${idx + 1}. ${btn.text}`);
  const fallbackText = [
    text,
    footer ? `\n_${footer}_` : '',
    '',
    ...lines,
    '',
    '_Responda com o número ou texto da opção_'
  ].filter(Boolean).join('\n');
  
  await sock.sendMessage(jid, { text: fallbackText });
  console.log(`✅ Texto numerado enviado para ${jid}`);
}

/**
 * Envia uma lista como texto numerado (listas interativas não funcionam no Baileys).
 *
 * @param {object} sock     - Socket Baileys
 * @param {string} jid      - JID do destinatário
 * @param {object} options
 * @param {string} options.text        - texto do cabeçalho
 * @param {string} [options.title]     - ignorado (compatibilidade)
 * @param {string} [options.footer]    - texto do rodapé
 * @param {Array}  options.items       - [{ id, title, description }]
 */
export async function sendListMessage(sock, jid, { text, title = '', footer = '', items }) {
  // Listas interativas não funcionam - usar texto numerado sempre
  const lines = items.map((item, idx) => {
    const itemTitle = String(item.title ?? '').trim();
    const itemDescription = String(item.description ?? '').trim();
    if (!itemTitle) return '';
    if (!itemDescription) return `${idx + 1}. ${itemTitle}`;
    return `${idx + 1}. ${itemTitle}\n   _${itemDescription}_`;
  }).filter(Boolean);

  const messageText = [
    text,
    footer ? `\n_${footer}_` : '',
    '',
    ...lines,
    '',
    '_Responda com o número ou nome da opção_'
  ].filter(Boolean).join('\n');
  
  await sock.sendMessage(jid, { text: messageText });
  console.log(`✅ Lista como texto numerado enviada para ${jid} (${items.length} itens)`);
}

/**
 * Envia indicador de digitação, então opcionalmente para.
 */
export async function sendTyping(sock, jid, durationMs = 1000) {
  await sock.sendPresenceUpdate('composing', jid);
  await new Promise(r => setTimeout(r, durationMs));
  await sock.sendPresenceUpdate('paused', jid);
}
