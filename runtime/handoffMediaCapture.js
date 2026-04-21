import fs from 'fs';
import path from 'path';

export function createHandoffMediaCaptureController({
  handoffMediaDir,
  allowedIncomingImageMime,
  downloadMediaMessage,
  getLogger,
  getConfig,
  getIngestionRuntimeCounters,
} = {}) {
  function sanitizeMediaFileName(value) {
    return String(value ?? '')
      .replace(/[^\w.-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 90);
  }

  function extensionFromMimeType(mimeType) {
    if (mimeType === 'image/jpeg') return '.jpg';
    if (mimeType === 'image/png') return '.png';
    if (mimeType === 'image/webp') return '.webp';
    if (mimeType === 'image/gif') return '.gif';
    return '.bin';
  }

  function saveIncomingHandoffImage({ buffer, mimeType, fileName = '' }) {
    fs.mkdirSync(handoffMediaDir, { recursive: true });
    const ext = extensionFromMimeType(mimeType);
    const base = sanitizeMediaFileName(fileName).replace(/\.[^.]+$/, '') || 'incoming';
    const mediaId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${base}${ext}`;
    const mediaPath = path.resolve(handoffMediaDir, mediaId);
    fs.writeFileSync(mediaPath, buffer);
    return {
      mediaId,
      mediaPath,
      mediaUrl: `/api/handoff/media/${encodeURIComponent(mediaId)}`,
    };
  }

  async function captureIncomingImageForDashboard({ msg, sock, mimeType, fileName }) {
    const normalizedMime = String(mimeType || '').toLowerCase();
    if (!allowedIncomingImageMime.has(normalizedMime)) return null;

    try {
      const buffer = await downloadMediaMessage(
        msg,
        'buffer',
        {},
        {
          logger: getLogger(),
          reuploadRequest: sock?.updateMediaMessage,
        }
      );

      if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
        return null;
      }
      const maxAllowedBytes = Math.max(64 * 1024, Number(getConfig()?.incomingMediaMaxBytes ?? (8 * 1024 * 1024)));
      if (buffer.length > maxAllowedBytes) {
        getIngestionRuntimeCounters().mediaTooLargeDropped += 1;
        return null;
      }

      return saveIncomingHandoffImage({
        buffer,
        mimeType: normalizedMime,
        fileName,
      });
    } catch {
      return null;
    }
  }

  return {
    saveIncomingHandoffImage,
    captureIncomingImageForDashboard,
  };
}
