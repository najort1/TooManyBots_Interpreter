import test from 'node:test';
import assert from 'node:assert/strict';

import { openaiChatComplete } from '../fun/llm/openaiClient.js';

test('openaiChatComplete: proxy glm sem sampling não envia max_tokens nem temperature', async () => {
  let seenBody = null;
  const fetchImpl = async (_url, init = {}) => {
    seenBody = JSON.parse(String(init.body || '{}'));
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: 'Texto final limpo.',
            },
          },
        ],
      }),
    };
  };

  const out = await openaiChatComplete({
    baseUrl: 'http://127.0.0.1:3300',
    model: 'glm_5_2',
    system: 'Responda curto.',
    prompt: 'Teste.',
    maxTokens: 123,
    temperature: 0.9,
    sendSamplingParams: false,
    fetchImpl,
  });

  assert.equal(out, 'Texto final limpo.');
  assert.equal(seenBody.model, 'glm_5_2');
  assert.equal(Array.isArray(seenBody.messages), true);
  assert.equal('max_tokens' in seenBody, false);
  assert.equal('temperature' in seenBody, false);
});

test('openaiChatComplete: modo completo envia max_tokens e temperature', async () => {
  let seenBody = null;
  const fetchImpl = async (_url, init = {}) => {
    seenBody = JSON.parse(String(init.body || '{}'));
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: 'Texto final limpo.',
            },
          },
        ],
      }),
    };
  };

  await openaiChatComplete({
    baseUrl: 'http://127.0.0.1:3300',
    model: 'glm_5_2',
    prompt: 'Teste.',
    maxTokens: 321,
    temperature: 0.4,
    sendSamplingParams: true,
    fetchImpl,
  });

  assert.equal(seenBody.max_tokens, 321);
  assert.equal(seenBody.temperature, 0.4);
});

test('openaiChatComplete: envia áudio inline WAV e ignora URLs ou formatos não suportados', async () => {
  let seenBody = null;
  const fetchImpl = async (_url, init = {}) => {
    seenBody = JSON.parse(String(init.body || '{}'));
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'Entendi o áudio.' } }] }) };
  };

  await openaiChatComplete({
    prompt: 'Transcreva.',
    audios: [
      'data:audio/wav;base64,QUJDRA==',
      'https://example.com/audio.mp3',
      'data:audio/ogg;base64,T0dHUw==',
    ],
    fetchImpl,
  });

  const user = seenBody.messages.find((message) => message.role === 'user');
  assert.deepEqual(user.content.at(-1), {
    type: 'input_audio',
    input_audio: { data: 'QUJDRA==', format: 'wav' },
  });
  assert.equal(user.content.filter((part) => part.type === 'input_audio').length, 1);
});
