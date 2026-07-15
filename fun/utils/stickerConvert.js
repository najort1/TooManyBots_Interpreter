/**
 * Converte imagem → WebP sticker e vídeo/GIF → WebP animado (WhatsApp).
 * Depende de: sharp (imagem) e ffmpeg no PATH (animado).
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const STICKER_SIZE = 512;
const MAX_ANIM_SECONDS = 6;
const MAX_INPUT_BYTES = 12 * 1024 * 1024;

export function isStickerMediaType(messageType = '', mimeType = '') {
  const t = String(messageType || '').toLowerCase();
  const m = String(mimeType || '').toLowerCase();
  if (['image', 'video', 'gif', 'sticker', 'document-image', 'document-video'].includes(t)) {
    return true;
  }
  if (m.startsWith('image/') || m.startsWith('video/')) return true;
  return false;
}

export function isAnimatedMediaType(messageType = '', mimeType = '') {
  const t = String(messageType || '').toLowerCase();
  const m = String(mimeType || '').toLowerCase();
  if (t === 'video' || t === 'gif' || t === 'document-video') return true;
  if (m === 'image/gif' || m.startsWith('video/')) return true;
  return false;
}

async function loadSharp() {
  try {
    const mod = await import('sharp');
    return mod.default || mod;
  } catch {
    throw new Error('sharp-unavailable');
  }
}

/**
 * Imagem estática → WebP 512x512 (contain + fundo transparente).
 */
export async function imageBufferToSticker(inputBuffer) {
  if (!Buffer.isBuffer(inputBuffer) || inputBuffer.length === 0) {
    throw new Error('empty-buffer');
  }
  if (inputBuffer.length > MAX_INPUT_BYTES) {
    throw new Error('media-too-large');
  }

  const sharp = await loadSharp();
  const out = await sharp(inputBuffer, { animated: false, failOn: 'none' })
    .rotate()
    .resize(STICKER_SIZE, STICKER_SIZE, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .webp({
      quality: 90,
      alphaQuality: 90,
      effort: 4,
    })
    .toBuffer();

  if (!out?.length) throw new Error('convert-failed');
  return out;
}

function runFfmpeg(args, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        // ignore
      }
      reject(new Error('ffmpeg-timeout'));
    }, timeoutMs);

    proc.stderr?.on('data', (chunk) => {
      stderr += String(chunk || '');
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(err?.code === 'ENOENT' ? 'ffmpeg-not-found' : err?.message || 'ffmpeg-error'));
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ ok: true });
      else reject(new Error(`ffmpeg-exit-${code}: ${stderr.slice(-200)}`));
    });
  });
}

/**
 * Vídeo/GIF → WebP animado (até 6s, 512px, ~15fps).
 */
export async function videoBufferToAnimatedSticker(inputBuffer, { mimeType = '' } = {}) {
  if (!Buffer.isBuffer(inputBuffer) || inputBuffer.length === 0) {
    throw new Error('empty-buffer');
  }
  if (inputBuffer.length > MAX_INPUT_BYTES) {
    throw new Error('media-too-large');
  }

  const tmpDir = path.join(os.tmpdir(), 'fun-stickers');
  fs.mkdirSync(tmpDir, { recursive: true });
  const id = randomUUID();
  const ext = String(mimeType).includes('gif')
    ? '.gif'
    : String(mimeType).includes('webm')
      ? '.webm'
      : '.mp4';
  const inPath = path.join(tmpDir, `${id}-in${ext}`);
  const outPath = path.join(tmpDir, `${id}-out.webp`);

  try {
    fs.writeFileSync(inPath, inputBuffer);

    // scale + pad transparente; corta em MAX_ANIM_SECONDS
    const vf = [
      `scale=${STICKER_SIZE}:${STICKER_SIZE}:force_original_aspect_ratio=decrease:flags=lanczos`,
      `pad=${STICKER_SIZE}:${STICKER_SIZE}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`,
      'fps=15',
      'format=yuva420p',
    ].join(',');

    await runFfmpeg([
      '-y',
      '-i',
      inPath,
      '-t',
      String(MAX_ANIM_SECONDS),
      '-an',
      '-vf',
      vf,
      '-loop',
      '0',
      '-c:v',
      'libwebp',
      '-quality',
      '55',
      '-compression_level',
      '4',
      '-preset',
      'default',
      outPath,
    ]);

    const out = fs.readFileSync(outPath);
    if (!out?.length) throw new Error('convert-failed');
    // WhatsApp costuma recusar stickers animados muito grandes
    if (out.length > 900 * 1024) {
      // segunda passada mais agressiva
      await runFfmpeg([
        '-y',
        '-i',
        inPath,
        '-t',
        '4',
        '-an',
        '-vf',
        [
          `scale=512:512:force_original_aspect_ratio=decrease`,
          `pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000`,
          'fps=12',
          'format=yuva420p',
        ].join(','),
        '-loop',
        '0',
        '-c:v',
        'libwebp',
        '-quality',
        '40',
        '-compression_level',
        '6',
        outPath,
      ]);
      const out2 = fs.readFileSync(outPath);
      if (!out2?.length) throw new Error('convert-failed');
      return out2;
    }
    return out;
  } finally {
    try {
      fs.unlinkSync(inPath);
    } catch {
      // ignore
    }
    try {
      fs.unlinkSync(outPath);
    } catch {
      // ignore
    }
  }
}

/**
 * @param {Buffer} buffer
 * @param {{ messageType?: string, mimeType?: string }} meta
 */
export async function convertToSticker(buffer, meta = {}) {
  const animated = isAnimatedMediaType(meta.messageType, meta.mimeType);
  if (animated) {
    return {
      buffer: await videoBufferToAnimatedSticker(buffer, { mimeType: meta.mimeType }),
      animated: true,
    };
  }
  return {
    buffer: await imageBufferToSticker(buffer),
    animated: false,
  };
}
