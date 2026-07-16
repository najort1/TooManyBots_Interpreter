/**
 * engine/sender.js
 *
 * Abstração sobre os métodos de envio do Baileys.
 * Inclui guard de saída (rate limit / gap / typing) para reduzir ban.
 */

import { delay } from '../utils/async.js';
import { getDefaultOutboundGuard } from './outboundGuard.js';

function withSendSource(options, source) {
  const base = options && typeof options === 'object' ? { ...options } : {};
  if (!base.__sendSource) {
    base.__sendSource = source;
  }
  return base;
}

async function applyTyping(sock, jid, typingMs) {
  if (!sock || !jid || !typingMs || typingMs <= 0) return;
  if (typeof sock.sendPresenceUpdate !== 'function') return;
  try {
    await sock.sendPresenceUpdate('composing', jid);
    await delay(typingMs);
    await sock.sendPresenceUpdate('paused', jid);
  } catch {
    // presence é best-effort
  }
}

/**
 * @param {object} [options]
 * @param {boolean} [options.skipGuard]
 * @param {boolean} [options.skipTyping]
 * @param {import('./outboundGuard.js').createOutboundGuard extends Function ? any : any} [options.guard]
 */
async function beforeSend(sock, jid, { text = '', skipGuard = false, skipTyping = false, guard } = {}) {
  if (skipGuard) {
    return { ok: true, typingMs: 0 };
  }
  const g = guard || getDefaultOutboundGuard();
  const slot = await g.acquire(jid, { text, skipTyping });
  if (!slot.ok) {
    if (slot.reason === 'identical-text') {
      console.warn(`[outbound] skip texto idêntico → ${jid} (${slot.reason})`);
      return slot;
    }
    const err = new Error(`outbound-${slot.reason || 'blocked'}`);
    err.code = slot.reason;
    err.waitedMs = slot.waitedMs;
    throw err;
  }
  if (!skipTyping && slot.typingMs > 0) {
    await applyTyping(sock, jid, slot.typingMs);
  }
  return slot;
}

function afterSend(jid, { text = '', skipGuard = false, guard } = {}) {
  if (skipGuard) return;
  const g = guard || getDefaultOutboundGuard();
  g.record(jid, { text });
}

/**
 * Envia uma mensagem de texto simples.
 */
export async function sendTextMessage(sock, jid, text, options = undefined) {
  const opts = options && typeof options === 'object' ? options : {};
  const body = String(text ?? '');
  const slot = await beforeSend(sock, jid, {
    text: body,
    skipGuard: Boolean(opts.skipGuard),
    skipTyping: Boolean(opts.skipTyping),
    guard: opts.guard,
  });
  if (!slot.ok) return { skipped: true, reason: slot.reason };

  await sock.sendMessage(jid, { text: body }, withSendSource(opts, 'service'));
  afterSend(jid, { text: body, skipGuard: Boolean(opts.skipGuard), guard: opts.guard });
  return { skipped: false };
}

export async function sendImageMessage(
  sock,
  jid,
  { imageBuffer, caption = '', mimeType = '' },
  options = undefined
) {
  const opts = options && typeof options === 'object' ? options : {};
  const cap = String(caption ?? '').trim();
  const slot = await beforeSend(sock, jid, {
    text: cap || '[image]',
    skipGuard: Boolean(opts.skipGuard),
    skipTyping: true, // mídia sem typing longo
    guard: opts.guard,
  });
  if (!slot.ok) return { skipped: true, reason: slot.reason };

  const payload = {
    image: imageBuffer,
    caption: cap || undefined,
  };
  if (mimeType) {
    payload.mimetype = mimeType;
  }
  await sock.sendMessage(jid, payload, withSendSource(opts, 'service'));
  afterSend(jid, { text: cap || '[image]', skipGuard: Boolean(opts.skipGuard), guard: opts.guard });
  return { skipped: false };
}

/**
 * Envia figurinha (WebP estático ou animado).
 * @param {Buffer} stickerBuffer
 */
export async function sendStickerMessage(sock, jid, stickerBuffer, options = undefined) {
  if (!stickerBuffer || !Buffer.isBuffer(stickerBuffer) || stickerBuffer.length === 0) {
    throw new Error('sticker-buffer-invalid');
  }
  const opts = options && typeof options === 'object' ? options : {};
  const slot = await beforeSend(sock, jid, {
    text: '[sticker]',
    skipGuard: Boolean(opts.skipGuard),
    skipTyping: true,
    guard: opts.guard,
  });
  if (!slot.ok) return { skipped: true, reason: slot.reason };

  await sock.sendMessage(
    jid,
    { sticker: stickerBuffer },
    withSendSource(opts, 'service')
  );
  afterSend(jid, { text: '[sticker]', skipGuard: Boolean(opts.skipGuard), guard: opts.guard });
  return { skipped: false };
}

export async function sendBroadcastMessage(sock, jid, message, options = undefined) {
  if (!message || typeof message !== 'object') {
    throw new Error('Mensagem de broadcast invalida');
  }

  if (message.kind === 'image') {
    if (!message.imageBuffer || !Buffer.isBuffer(message.imageBuffer)) {
      throw new Error('Imagem de broadcast invalida');
    }
    await sendImageMessage(
      sock,
      jid,
      {
        imageBuffer: message.imageBuffer,
        caption: message.text || '',
        mimeType: message.mimeType || '',
      },
      withSendSource(options, 'broadcast')
    );
    return;
  }

  await sendTextMessage(sock, jid, String(message.text || ''), withSendSource(options, 'broadcast'));
}

/**
 * Envia botões (até 3 opções) ou texto numerado como alternativa.
 */
export async function sendButtons(sock, jid, { text, footer = '', buttons }) {
  if (buttons.length <= 3) {
    try {
      const body = String(text || '');
      const slot = await beforeSend(sock, jid, { text: body });
      if (!slot.ok) return { skipped: true, reason: slot.reason };

      await sock.sendMessage(jid, {
        text,
        footer,
        buttons: buttons.map((btn) => ({
          buttonId: btn.id,
          buttonText: { displayText: btn.text },
          type: 1,
        })),
        headerType: 1,
      });
      afterSend(jid, { text: body });
      console.log(`✅ Botões enviados para ${jid}`);
      return { skipped: false };
    } catch (err) {
      if (String(err?.message || '').startsWith('outbound-')) throw err;
      console.warn(`⚠️ Erro ao enviar botões para ${jid}:`, err.message);
    }
  }

  const lines = buttons.map((btn, idx) => `${idx + 1}. ${btn.text}`);
  const fallbackText = [
    text,
    footer ? `\n_${footer}_` : '',
    '',
    ...lines,
    '',
    '_Responda com o número ou texto da opção_',
  ]
    .filter(Boolean)
    .join('\n');

  await sendTextMessage(sock, jid, fallbackText);
  console.log(`✅ Texto numerado enviado para ${jid}`);
  return { skipped: false };
}

/**
 * Envia uma lista como texto numerado.
 */
export async function sendListMessage(sock, jid, { text, title = '', footer = '', items }) {
  void title;
  const lines = items
    .map((item, idx) => {
      const itemTitle = String(item.title ?? '').trim();
      const itemDescription = String(item.description ?? '').trim();
      if (!itemTitle) return '';
      if (!itemDescription) return `${idx + 1}. ${itemTitle}`;
      return `${idx + 1}. ${itemTitle}\n   _${itemDescription}_`;
    })
    .filter(Boolean);

  const messageText = [
    text,
    footer ? `\n_${footer}_` : '',
    '',
    ...lines,
    '',
    '_Responda com o número ou nome da opção_',
  ]
    .filter(Boolean)
    .join('\n');

  await sendTextMessage(sock, jid, messageText);
  console.log(`✅ Lista como texto numerado enviada para ${jid} (${items.length} itens)`);
}

/**
 * Envia indicador de digitação, então opcionalmente para.
 */
export async function sendTyping(sock, jid, durationMs = 1000) {
  await applyTyping(sock, jid, durationMs);
}
