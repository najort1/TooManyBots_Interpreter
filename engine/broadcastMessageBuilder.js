import { BROADCAST_LIMITS } from '../config/constants.js';

const ALLOWED_IMAGE_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

function toText(value) {
  return String(value ?? '').trim();
}

export function parseBroadcastImageDataUrl(dataUrl, declaredMimeType = '') {
  const raw = String(dataUrl ?? '').trim();
  if (!raw) return null;

  const match = raw.match(/^data:([^;]+);base64,([a-z0-9+/=]+)$/i);
  if (!match) {
    throw new Error('imageDataUrl invalido');
  }

  const inferredMimeType = String(match[1] || '').toLowerCase();
  const mimeType = String(declaredMimeType || inferredMimeType).toLowerCase();
  if (!ALLOWED_IMAGE_MIME.has(mimeType)) {
    throw new Error('Tipo de imagem nao suportado');
  }

  const base64 = match[2];
  const imageBuffer = Buffer.from(base64, 'base64');
  if (!imageBuffer.length) {
    throw new Error('Imagem vazia');
  }
  if (imageBuffer.length > BROADCAST_LIMITS.IMAGE_MAX_BYTES) {
    throw new Error(`Imagem excede limite de ${Math.floor(BROADCAST_LIMITS.IMAGE_MAX_BYTES / (1024 * 1024))}MB`);
  }

  return { imageBuffer, mimeType };
}

export function buildBroadcastMessage(input = {}) {
  const text = toText(input.text);
  if (text.length > BROADCAST_LIMITS.MESSAGE_TEXT_MAX) {
    throw new Error(`Texto excede limite de ${BROADCAST_LIMITS.MESSAGE_TEXT_MAX} caracteres`);
  }

  const image = parseBroadcastImageDataUrl(input.imageDataUrl, input.mimeType);
  if (!text && !image) {
    throw new Error('Informe texto ou imagem para o envio');
  }

  return {
    kind: image ? 'image' : 'text',
    text,
    imageBuffer: image?.imageBuffer ?? null,
    mimeType: image?.mimeType ?? '',
    fileName: toText(input.fileName),
  };
}
