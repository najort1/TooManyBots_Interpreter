import { GoogleGenAI } from '@google/genai';
import { createAudioTranscoder } from '../utils/audioTranscode.js';

function wavHeader(dataLength, { sampleRate = 24_000, channels = 1, bitsPerSample = 16 } = {}) {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * bitsPerSample / 8;
  const blockAlign = channels * bitsPerSample / 8;
  header.write('RIFF', 0); header.writeUInt32LE(36 + dataLength, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22); header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28); header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34); header.write('data', 36); header.writeUInt32LE(dataLength, 40);
  return header;
}

export function pcmToWav(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('empty-pcm');
  return Buffer.concat([wavHeader(buffer.length, options), buffer]);
}

export function createGeminiTtsService({
  apiKey = process.env.GEMINI_API_KEY,
  generateClient = (key) => new GoogleGenAI({ apiKey: key }),
  audioTranscoder = createAudioTranscoder(),
  logger = null,
} = {}) {
  const configured = Boolean(String(apiKey || '').trim());

  return {
    isAvailable() {
      return configured;
    },
    async synthesize(text, { voiceName = 'Puck', model = 'gemini-3.1-flash-tts-preview', temperature = 1 } = {}) {
      const cleanText = String(text || '').trim();
      if (!cleanText) return { ok: false, reason: 'empty-text' };
      if (!configured) return { ok: false, reason: 'missing-api-key' };
      try {
        const ai = generateClient(apiKey);
        const response = await ai.models.generateContent({
          model,
          config: {
            temperature,
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
          },
          contents: [{ role: 'user', parts: [{ text: cleanText.slice(0, 2_000) }] }],
        });
        const parts = response?.candidates?.[0]?.content?.parts || [];
        const inline = parts.find((part) => part?.inlineData?.data)?.inlineData;
        if (!inline?.data) return { ok: false, reason: 'empty-response' };
        const pcm = Buffer.from(inline.data, 'base64');
        const mimeType = String(inline.mimeType || 'audio/L16;rate=24000');
        const rate = Number(mimeType.match(/rate=(\d+)/i)?.[1]) || 24_000;
        const bits = Number(mimeType.match(/L(\d+)/i)?.[1]) || 16;
        const wav = pcmToWav(pcm, { sampleRate: rate, bitsPerSample: bits });
        const buffer = await audioTranscoder.toOggOpus(wav, { mimeType: 'audio/wav' });
        return { ok: true, buffer, mimeType: 'audio/ogg; codecs=opus' };
      } catch (error) {
        logger?.debug?.('[personaTts] synthesis failed: %s', String(error?.message || error));
        return { ok: false, reason: 'generation-error' };
      }
    },
  };
}
