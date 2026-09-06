import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const MAX_AUDIO_BYTES = 16 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;

function assertAudioBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('empty-audio-buffer');
  }
  if (buffer.length > MAX_AUDIO_BYTES) {
    throw new Error('audio-too-large');
  }
}

function extensionFromMimeType(mimeType = '') {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.includes('ogg')) return '.ogg';
  if (mime.includes('wav')) return '.wav';
  if (mime.includes('mpeg') || mime.includes('mp3')) return '.mp3';
  if (mime.includes('webm')) return '.webm';
  if (mime.includes('mp4') || mime.includes('m4a')) return '.m4a';
  return '.bin';
}

function runFfmpeg(args, { timeoutMs = DEFAULT_TIMEOUT_MS, spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawnImpl('ffmpeg', args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        // ignore process termination races
      }
      reject(new Error('ffmpeg-timeout'));
    }, timeoutMs);

    proc.stderr?.on('data', (chunk) => {
      stderr += String(chunk || '');
      if (stderr.length > 4_000) stderr = stderr.slice(-4_000);
    });
    proc.once('error', (error) => {
      clearTimeout(timer);
      reject(new Error(error?.code === 'ENOENT' ? 'ffmpeg-not-found' : error?.message || 'ffmpeg-error'));
    });
    proc.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg-exit-${code}: ${stderr.slice(-200)}`));
    });
  });
}

/**
 * Converte buffers de áudio em formatos compatíveis com provedores de LLM e
 * mensagens de voz do WhatsApp. O ffmpeg já é uma dependência operacional do
 * projeto para stickers animados; falhas de conversão devem ser tratadas pelo
 * chamador como um recurso opcional indisponível.
 */
export function createAudioTranscoder({
  timeoutMs = DEFAULT_TIMEOUT_MS,
  tempDir = path.join(os.tmpdir(), 'fun-audio'),
  runFfmpegImpl = runFfmpeg,
} = {}) {
  async function transcode(buffer, {
    mimeType = '',
    outputExtension,
    outputArgs,
  }) {
    assertAudioBuffer(buffer);
    fs.mkdirSync(tempDir, { recursive: true });

    const id = randomUUID();
    const inputPath = path.join(tempDir, `${id}-input${extensionFromMimeType(mimeType)}`);
    const outputPath = path.join(tempDir, `${id}-output${outputExtension}`);
    try {
      fs.writeFileSync(inputPath, buffer);
      await runFfmpegImpl([
        '-y',
        '-i', inputPath,
        '-vn',
        ...outputArgs,
        outputPath,
      ], { timeoutMs });
      const output = fs.readFileSync(outputPath);
      if (!output.length) throw new Error('empty-audio-output');
      return output;
    } finally {
      try {
        fs.unlinkSync(inputPath);
      } catch {
        // input cleanup is best-effort
      }
      try {
        fs.unlinkSync(outputPath);
      } catch {
        // output cleanup is best-effort
      }
    }
  }

  return {
    toWav(buffer, { mimeType = '' } = {}) {
      return transcode(buffer, {
        mimeType,
        outputExtension: '.wav',
        outputArgs: ['-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le'],
      });
    },
    toOggOpus(buffer, { mimeType = 'audio/wav' } = {}) {
      return transcode(buffer, {
        mimeType,
        outputExtension: '.ogg',
        outputArgs: ['-ac', '1', '-ar', '24000', '-c:a', 'libopus', '-b:a', '32k'],
      });
    },
  };
}
