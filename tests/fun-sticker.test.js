import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { parseFunCommand } from '../fun/index.js';
import { FUN_COMMANDS } from '../fun/constants.js';
import { parseMessage } from '../engine/messageParser.js';
import {
  imageBufferToSticker,
  convertToSticker,
  isStickerMediaType,
  isAnimatedMediaType,
} from '../fun/utils/stickerConvert.js';
import {
  inspectMediaContent,
  unwrapContent,
  findContextInfo,
  resolveMediaFromRawMessage,
  resolveAllMediaFromRawMessage,
  downloadResolvedMedia,
  downloadAllResolvedMedia,
} from '../fun/utils/mediaDownload.js';
import { handleStickerCommand } from '../fun/commands/handlers/sticker.js';
import { sendStickerMessage } from '../engine/sender.js';

test('parseFunCommand: fig aliases', () => {
  assert.equal(parseFunCommand('/fig', '/').command, FUN_COMMANDS.STICKER);
  assert.equal(parseFunCommand('/figurinha', '/').command, FUN_COMMANDS.STICKER);
  assert.equal(parseFunCommand('/sticker', '/').command, FUN_COMMANDS.STICKER);
  assert.equal(parseFunCommand('/s', '/').command, FUN_COMMANDS.STICKER);
});

test('media type helpers', () => {
  assert.equal(isStickerMediaType('image', 'image/jpeg'), true);
  assert.equal(isStickerMediaType('video', 'video/mp4'), true);
  assert.equal(isStickerMediaType('gif', 'video/mp4'), true);
  assert.equal(isStickerMediaType('sticker', 'image/webp'), true);
  assert.equal(isStickerMediaType('document-image', 'image/png'), true);
  assert.equal(isStickerMediaType('document-video', 'video/mp4'), true);
  assert.equal(isStickerMediaType('', 'image/webp'), true);
  assert.equal(isStickerMediaType('', 'video/webm'), true);
  assert.equal(isStickerMediaType('unknown', 'text/plain'), false);

  assert.equal(isAnimatedMediaType('video', 'video/mp4'), true);
  assert.equal(isAnimatedMediaType('gif', 'video/mp4'), true);
  assert.equal(isAnimatedMediaType('document-video', 'video/mp4'), true);
  assert.equal(isAnimatedMediaType('image', 'image/png'), false);
  assert.equal(isAnimatedMediaType('', 'image/gif'), true);
  assert.equal(isAnimatedMediaType('', 'video/mp4'), true);
});

test('unwrapContent: desembrulha contêineres aninhados (ephemeral + viewOnce + documentWithCaption)', () => {
  const nested = {
    ephemeralMessage: {
      message: {
        viewOnceMessageV2: {
          message: {
            imageMessage: { mimetype: 'image/png', url: 'https://test' },
          },
        },
      },
    },
  };
  const unwrapped = unwrapContent(nested);
  assert.ok(unwrapped.imageMessage);
  assert.equal(unwrapped.imageMessage.mimetype, 'image/png');

  const docNested = {
    documentWithCaptionMessage: {
      message: {
        documentMessage: { mimetype: 'image/jpeg', fileName: 'photo.jpg' },
      },
    },
  };
  const unwrappedDoc = unwrapContent(docNested);
  assert.ok(unwrappedDoc.documentMessage);
  assert.equal(unwrappedDoc.documentMessage.fileName, 'photo.jpg');
});

test('parseMessage: reconhece imagem com legenda, albumMessage e documentWithCaption', () => {
  // Imagem com legenda /fig
  const imgMsg = {
    key: { id: 'img-1', remoteJid: 'group@g.us', fromMe: false },
    message: {
      imageMessage: { caption: '/fig', mimetype: 'image/jpeg' },
    },
  };
  const parsedImg = parseMessage(imgMsg);
  assert.equal(parsedImg.text, '/fig');
  assert.equal(parsedImg.messageType, 'image');

  // Album com múltiplas imagens
  const albumMsg = {
    key: { id: 'album-1', remoteJid: 'group@g.us', fromMe: false },
    message: {
      albumMessage: {
        caption: '/fig',
        messages: [
          { imageMessage: { caption: '/fig', mimetype: 'image/png' } },
          { imageMessage: { mimetype: 'image/jpeg' } },
        ],
      },
    },
  };
  const parsedAlbum = parseMessage(albumMsg);
  assert.equal(parsedAlbum.text, '/fig');
  assert.equal(parsedAlbum.messageType, 'album');

  // Documento com legenda
  const docMsg = {
    key: { id: 'doc-1', remoteJid: 'group@g.us', fromMe: false },
    message: {
      documentWithCaptionMessage: {
        message: {
          documentMessage: { caption: '/fig', mimetype: 'image/jpeg', fileName: 'photo.jpg' },
        },
      },
    },
  };
  const parsedDoc = parseMessage(docMsg);
  assert.equal(parsedDoc.text, '/fig');
  assert.equal(parsedDoc.messageType, 'document-image');
});

test('inspectMediaContent + quoted resolve', () => {
  const imageMsg = {
    key: { id: '1', remoteJid: 'x@g.us' },
    message: {
      imageMessage: { mimetype: 'image/jpeg', caption: '/fig' },
    },
  };
  const self = resolveMediaFromRawMessage(imageMsg);
  assert.equal(self.source, 'self');
  assert.equal(self.media.messageType, 'image');

  const quoted = {
    key: { id: '2', remoteJid: 'x@g.us' },
    message: {
      extendedTextMessage: {
        text: '/fig',
        contextInfo: {
          stanzaId: 'original-msg-123',
          participant: '551199999999@s.whatsapp.net',
          quotedMessage: {
            videoMessage: { mimetype: 'video/mp4', gifPlayback: true },
          },
        },
      },
    },
  };
  const q = resolveMediaFromRawMessage(quoted);
  assert.equal(q.source, 'quoted');
  assert.equal(q.media.messageType, 'gif');
  assert.equal(q.quotedKey.id, 'original-msg-123');
  assert.equal(q.quotedParticipant, '551199999999@s.whatsapp.net');
});

test('resolveMediaFromRawMessage: quoted image resolution in nested viewOnce/ephemeral message', () => {
  const quotedImage = {
    key: { id: 'reply-1', remoteJid: 'group@g.us' },
    message: {
      extendedTextMessage: {
        text: '/fig',
        contextInfo: {
          stanzaId: 'orig-img-456',
          participant: '551188888888@s.whatsapp.net',
          quotedMessage: {
            ephemeralMessage: {
              message: {
                viewOnceMessageV2: {
                  message: {
                    imageMessage: { mimetype: 'image/png', url: 'https://example.com/img.png' },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
  const resolved = resolveMediaFromRawMessage(quotedImage);
  assert.ok(resolved);
  assert.equal(resolved.source, 'quoted');
  assert.equal(resolved.media.kind, 'image');
  assert.equal(resolved.media.messageType, 'image');
  assert.equal(resolved.media.mimeType, 'image/png');
  assert.equal(resolved.quotedKey.id, 'orig-img-456');
  assert.equal(resolved.quotedParticipant, '551188888888@s.whatsapp.net');
});

test('resolveAllMediaFromRawMessage: single image', () => {
  const msg = {
    key: { id: '1', remoteJid: 'group@g.us' },
    message: {
      imageMessage: { mimetype: 'image/jpeg', caption: '/fig' },
    },
  };
  const all = resolveAllMediaFromRawMessage(msg);
  assert.equal(all.length, 1);
  assert.equal(all[0].source, 'self');
  assert.equal(all[0].media.messageType, 'image');
});

test('resolveAllMediaFromRawMessage: quoted message with single image', () => {
  const msg = {
    key: { id: '2', remoteJid: 'group@g.us' },
    message: {
      extendedTextMessage: {
        text: '/fig',
        contextInfo: {
          stanzaId: 'quoted-id-999',
          quotedMessage: {
            imageMessage: { mimetype: 'image/jpeg' },
          },
        },
      },
    },
  };
  const all = resolveAllMediaFromRawMessage(msg);
  assert.equal(all.length, 1);
  assert.equal(all[0].source, 'quoted');
  assert.equal(all[0].media.messageType, 'image');
  assert.equal(all[0].quotedKey.id, 'quoted-id-999');
});

test('resolveAllMediaFromRawMessage: album message with multiple images', () => {
  const albumMsg = {
    key: { id: 'album-1', remoteJid: 'group@g.us' },
    message: {
      albumMessage: {
        messages: [
          { imageMessage: { mimetype: 'image/jpeg' } },
          { imageMessage: { mimetype: 'image/png' } },
          { imageMessage: { mimetype: 'image/webp' } },
        ],
      },
    },
  };
  const all = resolveAllMediaFromRawMessage(albumMsg);
  assert.equal(all.length, 3);
  assert.equal(all[0].source, 'album');
  assert.equal(all[0].albumIndex, 0);
  assert.equal(all[0].media.mimeType, 'image/jpeg');

  assert.equal(all[1].source, 'album');
  assert.equal(all[1].albumIndex, 1);
  assert.equal(all[1].media.mimeType, 'image/png');

  assert.equal(all[2].source, 'album');
  assert.equal(all[2].albumIndex, 2);
  assert.equal(all[2].media.mimeType, 'image/webp');
});

test('resolveAllMediaFromRawMessage: quoted album message', () => {
  const quotedAlbum = {
    key: { id: 'reply-album', remoteJid: 'group@g.us' },
    message: {
      extendedTextMessage: {
        text: '/fig',
        contextInfo: {
          stanzaId: 'album-target',
          quotedMessage: {
            albumMessage: {
              messages: [
                { imageMessage: { mimetype: 'image/jpeg' } },
                { imageMessage: { mimetype: 'image/png' } },
              ],
            },
          },
        },
      },
    },
  };
  const all = resolveAllMediaFromRawMessage(quotedAlbum);
  assert.equal(all.length, 2);
  assert.equal(all[0].source, 'album');
  assert.equal(all[0].albumIndex, 0);
  assert.equal(all[1].source, 'album');
  assert.equal(all[1].albumIndex, 1);
});

test('resolveAllMediaFromRawMessage: empty when no media', () => {
  const textOnly = {
    key: { id: 'text-1', remoteJid: 'group@g.us' },
    message: {
      conversation: '/fig sem foto',
    },
  };
  const all = resolveAllMediaFromRawMessage(textOnly);
  assert.equal(all.length, 0);

  const nullMsg = resolveAllMediaFromRawMessage(null);
  assert.equal(nullMsg.length, 0);
});

test('imageBufferToSticker gera webp via sharp', async () => {
  // PNG 2x2 vermelho mínimo
  const { default: sharp } = await import('sharp');
  const png = await sharp({
    create: {
      width: 64,
      height: 64,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  const webp = await imageBufferToSticker(png);
  assert.ok(Buffer.isBuffer(webp));
  assert.ok(webp.length > 50);
  // RIFF....WEBP
  assert.equal(webp.toString('ascii', 0, 4), 'RIFF');
  assert.equal(webp.toString('ascii', 8, 12), 'WEBP');

  const conv = await convertToSticker(png, { messageType: 'image', mimeType: 'image/png' });
  assert.equal(conv.animated, false);
  assert.ok(conv.buffer.length > 50);
});

test('handleStickerCommand: sem mídia pede uso', async () => {
  const sent = [];
  const r = await handleStickerCommand({
    funConfig: { prefix: '/' },
    reply: async (t) => sent.push(t),
    replyToChat: async (t) => sent.push(t),
    replySticker: async () => {},
    rawMessage: { key: {}, message: { conversation: '/fig' } },
    sock: {},
  });
  assert.equal(r.handled, true);
  assert.equal(r.reason, 'no-media');
  assert.ok(sent.some((t) => /Não achei|legenda|figurinha/i.test(t)));
});

test('handleStickerCommand: sem rawMessage pede formato', async () => {
  const sent = [];
  const r = await handleStickerCommand({
    funConfig: { prefix: '/' },
    reply: async (t) => sent.push(t),
    replyToChat: async (t) => sent.push(t),
    replySticker: async () => {},
    rawMessage: null,
    sock: {},
  });
  assert.equal(r.handled, true);
  assert.equal(r.reason, 'no-raw-message');
  assert.ok(sent.some((t) => /Figurinha|legenda/i.test(t)));
});

test('handleStickerCommand: sem replySticker retorna indisponivel', async () => {
  const sent = [];
  const r = await handleStickerCommand({
    funConfig: { prefix: '/' },
    reply: async (t) => sent.push(t),
    replyToChat: async (t) => sent.push(t),
    replySticker: null,
    rawMessage: { key: {}, message: { conversation: '/fig' } },
    sock: {},
  });
  assert.equal(r.handled, true);
  assert.equal(r.reason, 'no-sticker-sender');
});

test('handleStickerCommand: multi-image convert and batch response simulation', async () => {
  const { default: sharp } = await import('sharp');
  
  // Criar 3 imagens de teste
  const png1 = await sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 255, g: 0, b: 0 } },
  }).png().toBuffer();

  const png2 = await sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 0, g: 255, b: 0 } },
  }).png().toBuffer();

  const png3 = await sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 0, g: 0, b: 255 } },
  }).png().toBuffer();

  const stickers = [];
  const replies = [];

  // Converter individualmente cada buffer
  for (const png of [png1, png2, png3]) {
    const { buffer, animated } = await convertToSticker(png, { messageType: 'image', mimeType: 'image/png' });
    stickers.push(buffer);
    assert.equal(animated, false);
    assert.equal(buffer.toString('ascii', 8, 12), 'WEBP');
  }

  assert.equal(stickers.length, 3);
  for (const st of stickers) {
    assert.ok(Buffer.isBuffer(st));
    assert.equal(st.toString('ascii', 0, 4), 'RIFF');
  }
});

test('sendStickerMessage: validação de buffer e opções de envio', async () => {
  const dummySock = {
    sendMessage: async (jid, payload, opts) => {
      assert.ok(jid);
      assert.ok(payload.sticker);
      return { key: { id: 'sent-sticker' } };
    },
  };

  // Rejeita buffer inválido/vazio
  await assert.rejects(
    async () => sendStickerMessage(dummySock, 'test@g.us', null),
    /sticker-buffer-invalid/
  );
  await assert.rejects(
    async () => sendStickerMessage(dummySock, 'test@g.us', Buffer.alloc(0)),
    /sticker-buffer-invalid/
  );

  // Buffer válido envia com skipGuard
  const fakeSticker = Buffer.from('RIFF1234WEBPVP8 ');
  const res = await sendStickerMessage(dummySock, 'test@g.us', fakeSticker, { skipGuard: true });
  assert.equal(res.skipped, false);
});
