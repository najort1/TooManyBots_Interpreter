/**
 * engine/sender.js
 *
 * Abstração sobre os métodos de envio do Baileys.
 * Inclui guard de saída (rate limit / gap / typing) para reduzir ban.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import crypto from 'crypto';
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
 * @param {object} [options]
 * @param {string[]} [options.mentions] — JIDs a marcar (@) no WhatsApp
 * @param {object} [options.quoted] — WAMessage original para reply/citação (Baileys)
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

  const mentions = Array.isArray(opts.mentions)
    ? opts.mentions.map((m) => String(m || '').trim()).filter(Boolean)
    : [];
  const payload =
    mentions.length > 0 ? { text: body, mentions } : { text: body };

  // Só repassa o que o Baileys entende (evita skipGuard/guard no 3º arg)
  const sendOpts = { __sendSource: opts.__sendSource || 'service' };
  if (opts.quoted && typeof opts.quoted === 'object') {
    sendOpts.quoted = opts.quoted;
  }

  await sock.sendMessage(jid, payload, sendOpts);
  afterSend(jid, { text: body, skipGuard: Boolean(opts.skipGuard), guard: opts.guard });
  return { skipped: false };
}

function getTempDir() {
  const dir = path.join(os.tmpdir(), 'tmb-media');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ok */ }
  return dir;
}

let tempFileCounter = 0;

function isGifBuffer(buffer) {
  return buffer && buffer.length > 3 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46;
}

function runProcess(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (err) => reject(new Error(`spawn ${cmd}: ${err.message}`)));
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exit ${code}: ${stderr.slice(0, 300)}`));
    });
  });
}

/**
 * Converte GIF animado para MP4 via ffmpeg.
 * Retorna caminho do arquivo MP4 gerado.
 */
async function gifToMp4(gifBuffer) {
  const id = crypto.randomUUID();
  const inputPath = path.join(getTempDir(), `gif-${id}.gif`);
  const outputPath = path.join(getTempDir(), `gif-${id}.mp4`);

  fs.writeFileSync(inputPath, gifBuffer);
  try {
    await runProcess('ffmpeg', [
      '-y',
      '-i', inputPath,
      '-an',
      '-vf', 'fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      outputPath,
    ]);
    return outputPath;
  } finally {
    try { fs.unlinkSync(inputPath); } catch { /* ok */ }
  }
}

function bufferToTempFile(buffer, ext) {
  const name = `media-${Date.now()}-${++tempFileCounter}${ext}`;
  const filePath = path.join(getTempDir(), name);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

export async function sendImageMessage(
  sock,
  jid,
  { imageBuffer, imageUrl = '', caption = '', mimeType = '', mentions = [] },
  options = undefined
) {
  const opts = options && typeof options === 'object' ? options : {};
  const cap = String(caption ?? '').trim();
  const slot = await beforeSend(sock, jid, {
    text: cap || '[media]',
    skipGuard: Boolean(opts.skipGuard),
    skipTyping: true,
    guard: opts.guard,
  });
  if (!slot.ok) return { skipped: true, reason: slot.reason };

  const mentionList = Array.isArray(mentions)
    ? mentions.map((m) => String(m || '').trim()).filter(Boolean)
    : Array.isArray(opts.mentions)
      ? opts.mentions.map((m) => String(m || '').trim()).filter(Boolean)
      : [];

  let buffer = imageBuffer || null;
  if (!buffer && String(imageUrl || '').trim()) {
    try {
      const resp = await fetch(String(imageUrl).trim(), {
        headers: { 'User-Agent': 'TooManyBots-Fun/1.0 (https://github.com/anomalyco/TooManyBots_Interpreter)' },
      });
      if (resp.ok) buffer = Buffer.from(await resp.arrayBuffer());
    } catch { /* fallback */
    }
  }

  const sendOpts = { __sendSource: opts.__sendSource || 'service' };
  if (opts.quoted && typeof opts.quoted === 'object') sendOpts.quoted = opts.quoted;

  const isGif = buffer ? isGifBuffer(buffer) : /\.gif$/i.test(String(imageUrl));

  if (isGif && buffer) {
    const mp4Path = await gifToMp4(buffer);
    const mp4Payload = {
      video: { stream: fs.createReadStream(mp4Path) },
      gifPlayback: true,
      mimetype: 'video/mp4',
      caption: cap || undefined,
    };
    if (mentionList.length) mp4Payload.mentions = mentionList;

    try {
      await sock.sendMessage(jid, mp4Payload, sendOpts);
    } finally {
      try { fs.unlinkSync(mp4Path); } catch { /* ok */ }
    }
    afterSend(jid, { text: cap || '[gif]', skipGuard: Boolean(opts.skipGuard), guard: opts.guard });
    return { skipped: false, gifConverted: true };
  }

  if (buffer) {
    const ext = isGif ? '.gif' : '.png';
    const tempPath = bufferToTempFile(buffer, ext);
    const payload = {
      image: { stream: fs.createReadStream(tempPath) },
      mimetype: mimeType || (isGif ? 'image/gif' : 'image/png'),
      caption: cap || undefined,
    };
    if (mentionList.length) payload.mentions = mentionList;
    await sock.sendMessage(jid, payload, sendOpts);
    afterSend(jid, { text: cap || '[image]', skipGuard: Boolean(opts.skipGuard), guard: opts.guard });
    return { skipped: false };
  }

  if (String(imageUrl || '').trim()) {
    const url = String(imageUrl).trim();
    const payload = {
      image: { url },
      caption: cap || undefined,
    };
    if (mimeType) payload.mimetype = mimeType;
    if (mentionList.length) payload.mentions = mentionList;
    await sock.sendMessage(jid, payload, sendOpts);
    afterSend(jid, { text: cap || '[image-url]', skipGuard: Boolean(opts.skipGuard), guard: opts.guard });
    return { skipped: false };
  }

  throw new Error('image-payload-invalid');
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

  const sendOpts = { __sendSource: opts.__sendSource || 'service' };
  if (opts.quoted && typeof opts.quoted === 'object') {
    sendOpts.quoted = opts.quoted;
  }
  await sock.sendMessage(jid, { sticker: stickerBuffer }, sendOpts);
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
