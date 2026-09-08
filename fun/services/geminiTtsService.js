import { GoogleGenAI } from '@google/genai';
import { createAudioTranscoder } from '../utils/audioTranscode.js';

export const GEMINI_TTS_VOICES = Object.freeze({
  PUCK: 'Puck',
  CHARON: 'Charon',
  KORE: 'Kore',
  FENRIR: 'Fenrir',
  AOEDE: 'Aoede',
  ZEPHYR: 'Zephyr',
});

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

/**
 * Normaliza opções de voz simples ou multi-speaker para o formato do Gemini TTS.
 * Suporta:
 * - voiceName: 'Puck' (single-voice)
 * - voices: ['Puck', 'Zephyr'] ou [{ speaker: 'Speaker 1', voiceName: 'Puck' }, ...]
 * - speakers: { 'Speaker 1': 'Puck', 'Speaker 2': 'Zephyr' }
 * - speakerVoiceConfigs / multiSpeakerVoiceConfig (formato oficial do SDK)
 */
export function normalizeSpeechConfig(options = {}) {
  // 1. Objeto multiSpeakerVoiceConfig completo direto
  if (options.multiSpeakerVoiceConfig?.speakerVoiceConfigs?.length) {
    return {
      isMultiSpeaker: true,
      speechConfig: {
        multiSpeakerVoiceConfig: {
          speakerVoiceConfigs: options.multiSpeakerVoiceConfig.speakerVoiceConfigs,
        },
      },
    };
  }

  // 2. Lista speakerVoiceConfigs
  if (Array.isArray(options.speakerVoiceConfigs) && options.speakerVoiceConfigs.length > 0) {
    if (options.speakerVoiceConfigs.length === 1 && !options.forceMultiSpeaker) {
      const single = options.speakerVoiceConfigs[0];
      const voiceName = single?.voiceConfig?.prebuiltVoiceConfig?.voiceName || options.voiceName || 'Puck';
      return {
        isMultiSpeaker: false,
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      };
    }
    return {
      isMultiSpeaker: true,
      speechConfig: {
        multiSpeakerVoiceConfig: {
          speakerVoiceConfigs: options.speakerVoiceConfigs,
        },
      },
    };
  }

  // 3. Normalização de voices / speakers
  const rawList = options.voices || options.speakers;
  if (rawList) {
    let normalized = [];
    if (Array.isArray(rawList)) {
      normalized = rawList
        .map((item, index) => {
          if (typeof item === 'string') {
            return {
              speaker: `Speaker ${index + 1}`,
              voiceConfig: { prebuiltVoiceConfig: { voiceName: item } },
            };
          }
          if (item && typeof item === 'object') {
            if (item.voiceConfig?.prebuiltVoiceConfig?.voiceName) {
              return {
                speaker: String(item.speaker || `Speaker ${index + 1}`),
                voiceConfig: item.voiceConfig,
              };
            }
            const vName = item.voiceName || item.voice || item.name || 'Puck';
            const sName = item.speaker || item.name || `Speaker ${index + 1}`;
            return {
              speaker: String(sName),
              voiceConfig: { prebuiltVoiceConfig: { voiceName: String(vName) } },
            };
          }
          return null;
        })
        .filter(Boolean);
    } else if (typeof rawList === 'object') {
      normalized = Object.entries(rawList).map(([speaker, voice]) => {
        const vName = typeof voice === 'object' ? (voice?.voiceName || voice?.voice || 'Puck') : voice;
        return {
          speaker: String(speaker),
          voiceConfig: { prebuiltVoiceConfig: { voiceName: String(vName || 'Puck') } },
        };
      });
    }

    if (normalized.length > 1 || (normalized.length === 1 && options.forceMultiSpeaker)) {
      return {
        isMultiSpeaker: true,
        speechConfig: {
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: normalized,
          },
        },
      };
    }
    if (normalized.length === 1) {
      const vName = normalized[0]?.voiceConfig?.prebuiltVoiceConfig?.voiceName || 'Puck';
      return {
        isMultiSpeaker: false,
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: vName },
          },
        },
      };
    }
  }

  // 4. Default: single speaker com voiceName ou Puck
  const voiceName = String(options.voiceName || 'Puck');
  return {
    isMultiSpeaker: false,
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: { voiceName },
      },
    },
  };
}

/**
 * Constrói prompt para síntese multi-speaker com diretor de áudio e transcrição dramática.
 */
export function formatMultiSpeakerPrompt({
  audioProfile = null,
  directorNote = null,
  scene = '',
  sampleContext = '',
  transcript = '',
} = {}) {
  const sections = [
    'Read the following transcript based on the audio profile and director\'s note.',
  ];

  if (audioProfile) {
    sections.push('', '# Audio Profile');
    if (typeof audioProfile === 'string') {
      sections.push(audioProfile.trim());
    } else if (typeof audioProfile === 'object') {
      for (const [speaker, profile] of Object.entries(audioProfile)) {
        sections.push(`For ${speaker}: ${profile}`);
      }
    }
  }

  if (directorNote) {
    sections.push('', '# Director\'s note');
    if (typeof directorNote === 'string') {
      sections.push(directorNote.trim());
    } else if (typeof directorNote === 'object') {
      for (const [speaker, note] of Object.entries(directorNote)) {
        sections.push(`For ${speaker}: ${note}`);
      }
    }
  }

  if (scene) {
    sections.push('', '## Scene:', String(scene).trim());
  }

  if (sampleContext) {
    sections.push('', '## Sample Context:', String(sampleContext).trim());
  }

  sections.push('', '## Transcript:');
  if (typeof transcript === 'string') {
    sections.push(transcript.trim());
  } else if (Array.isArray(transcript)) {
    for (const turn of transcript) {
      if (typeof turn === 'string') {
        sections.push(turn);
      } else if (turn && typeof turn === 'object') {
        const toneTag = turn.tone ? ` [${turn.tone}]` : '';
        sections.push(`${turn.speaker || 'Speaker 1'}:${toneTag} ${turn.text || ''}`);
      }
    }
  }

  return sections.join('\n').trim();
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

    /**
     * Sintetiza voz via Gemini TTS, suportando:
     * - Modo single-speaker clássico ({ voiceName: 'Puck' })
     * - Modo multi-speaker com 2+ vozes ({ voices: ['Puck', 'Zephyr'] } ou { speakers: [...] })
     * - Prompt estruturado ou texto simples
     */
    async synthesize(textOrOptions, options = {}) {
      let text = '';
      let opts = {};

      if (typeof textOrOptions === 'string') {
        text = textOrOptions;
        opts = options || {};
      } else if (textOrOptions && typeof textOrOptions === 'object') {
        opts = { ...textOrOptions, ...(options || {}) };
        if (opts.text) {
          text = opts.text;
        } else if (opts.transcript) {
          text = formatMultiSpeakerPrompt(opts);
        }
      }

      const cleanText = String(text || '').trim();
      if (!cleanText) return { ok: false, reason: 'empty-text' };
      if (!configured) return { ok: false, reason: 'missing-api-key' };

      const model = opts.model || 'gemini-3.1-flash-tts-preview';
      const temperature = typeof opts.temperature === 'number' ? opts.temperature : 1;
      const { speechConfig, isMultiSpeaker } = normalizeSpeechConfig(opts);

      try {
        const ai = generateClient(apiKey);
        const response = await ai.models.generateContent({
          model,
          config: {
            temperature,
            responseModalities: ['AUDIO'],
            speechConfig,
          },
          contents: [{ role: 'user', parts: [{ text: cleanText }] }],
        });

        const parts = response?.candidates?.[0]?.content?.parts || [];
        const audioParts = parts.filter((part) => part?.inlineData?.data);
        if (!audioParts.length) return { ok: false, reason: 'empty-response' };

        const pcmBuffers = audioParts.map((part) => Buffer.from(part.inlineData.data, 'base64'));
        const pcm = Buffer.concat(pcmBuffers);
        const mimeType = String(audioParts[0]?.inlineData?.mimeType || 'audio/L16;rate=24000');
        const rate = Number(mimeType.match(/rate=(\d+)/i)?.[1]) || 24_000;
        const bits = Number(mimeType.match(/L(\d+)/i)?.[1]) || 16;
        const wav = pcmToWav(pcm, { sampleRate: rate, bitsPerSample: bits });

        let buffer = wav;
        let finalMimeType = 'audio/wav';

        if (audioTranscoder?.toOggOpus) {
          try {
            buffer = await audioTranscoder.toOggOpus(wav, { mimeType: 'audio/wav' });
            finalMimeType = 'audio/ogg; codecs=opus';
          } catch (transcodeErr) {
            logger?.warn?.(
              '[geminiTts] transcode to ogg failed, keeping wav: %s',
              String(transcodeErr?.message || transcodeErr)
            );
          }
        }

        return {
          ok: true,
          buffer,
          mimeType: finalMimeType,
          isMultiSpeaker,
        };
      } catch (error) {
        logger?.debug?.('[personaTts] synthesis failed: %s', String(error?.message || error));
        return { ok: false, reason: 'generation-error' };
      }
    },
  };
}
