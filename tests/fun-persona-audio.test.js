import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createFunGroupRepository } from '../fun/db/funGroupRepository.js';
import { createFunPersonaRepository } from '../fun/db/funPersonaRepository.js';
import { createPersonaService } from '../fun/services/personaService.js';
import { createIdentityMap } from '../fun/utils/identity.js';

await initDb();

let sequence = 0;
function uniqueGroup() {
  sequence += 1;
  return `1203639999${String(sequence).padStart(8, '0')}@g.us`;
}

function createService({ generateZen, personaTtsService, audioTranscoder, downloadMedia } = {}) {
  return {
    repository: createFunPersonaRepository({ getDatabase: getDb }),
    service: createPersonaService({
      personaRepository: createFunPersonaRepository({ getDatabase: getDb }),
      groupRepository: createFunGroupRepository({ getDatabase: getDb }),
      personaToolExecutor: { execute: async () => ({ ok: false }) },
      generateZen,
      personaTtsService,
      audioTranscoder,
      downloadMedia,
    }),
  };
}

function socket(messages, returnValue = { key: { id: 'message-1' } }) {
  return {
    user: { id: '559999999999@s.whatsapp.net' },
    sendMessage: async (_jid, payload) => {
      messages.push(payload);
      return returnValue;
    },
  };
}

function socketWithoutMessageId(messages) {
  return {
    user: { id: '559999999999@s.whatsapp.net' },
    sendMessage: async (_jid, payload) => {
      messages.push(payload);
      return undefined;
    },
  };
}

async function withLiveLlm(run) {
  const previous = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    await run();
  } finally {
    if (previous === undefined) process.env.FUN_DISABLE_LIVE_LLM = '1';
    else process.env.FUN_DISABLE_LIVE_LLM = previous;
  }
}

test('persona audio: preserva a transcrição narrada na resposta e na thread', async () => {
  await withLiveLlm(async () => {
    const repository = createFunPersonaRepository({ getDatabase: getDb });
    const scope = uniqueGroup();
    const messages = [];
    const service = createPersonaService({
      personaRepository: repository,
      groupRepository: createFunGroupRepository({ getDatabase: getDb }),
      personaToolExecutor: { execute: async () => ({ ok: false }) },
      generateZen: async () => '{"type":"audio","text":"A resposta narrada da persona."}',
      personaTtsService: {
        isAvailable: () => true,
        synthesize: async () => ({ ok: true, buffer: Buffer.from('ogg'), mimeType: 'audio/ogg; codecs=opus' }),
      },
    });

    const result = await service.tryRespond({
      scopeKey: scope,
      authorJid: '551199999999@s.whatsapp.net',
      text: 'bot responde em áudio',
      messageType: 'text',
      funConfig: {},
      sock: socket(messages),
      identityMap: createIdentityMap(),
      now: 1_000_000,
    });

    assert.equal(result.responded, true);
    assert.equal(result.response, 'A resposta narrada da persona.');
    assert.equal(messages[0].ptt, true);
    assert.equal(messages[0].mimetype, 'audio/ogg; codecs=opus');
    assert.equal(repository.getActiveThread(scope, { now: 1_000_000 }).context.at(-1).text, 'A resposta narrada da persona.');
  });
});

test('persona audio: falha de TTS envia a mesma fala como texto', async () => {
  await withLiveLlm(async () => {
    const messages = [];
    const { service } = createService({
      generateZen: async () => '{"type":"audio","text":"Não vou ficar em silêncio."}',
      personaTtsService: { isAvailable: () => true, synthesize: async () => ({ ok: false, reason: 'generation-error' }) },
    });

    const result = await service.tryRespond({
      scopeKey: uniqueGroup(),
      authorJid: '551199999999@s.whatsapp.net',
      text: 'bot responde',
      messageType: 'text',
      funConfig: {},
      sock: socket(messages),
      identityMap: createIdentityMap(),
      now: 1_100_000,
    });

    assert.equal(result.responded, true);
    assert.equal(result.response, 'Não vou ficar em silêncio.');
    assert.deepEqual(messages, [{ text: 'Não vou ficar em silêncio.' }]);
  });
});

test('persona dispatch: envio bem-sucedido sem key.id confirma a resposta', async () => {
  const messages = [];
  const { service } = createService();
  const result = await service.tryRespond({
    scopeKey: uniqueGroup(),
    authorJid: '551199999999@s.whatsapp.net',
    text: 'bot responde',
    messageType: 'text',
    funConfig: {},
    sock: socketWithoutMessageId(messages),
    identityMap: createIdentityMap(),
    now: 1_200_000,
  });

  assert.equal(result.responded, true);
  assert.equal(messages.length, 1);
  assert.deepEqual(result.responseMessageIds, []);
});

test('persona audio input: exige mídia real, converte para WAV e usa prompt explícito', async () => {
  await withLiveLlm(async () => {
    let request = null;
    const messages = [];
    const { service } = createService({
      generateZen: async (input) => {
        request = input;
        return 'Entendi sua mensagem de voz.';
      },
      audioTranscoder: {
        toWav: async () => Buffer.from('converted-wav'),
      },
      downloadMedia: async () => ({ ok: true, buffer: Buffer.from('incoming-ogg'), mimeType: 'audio/ogg; codecs=opus' }),
    });
    const noPayload = await service.tryRespond({
      scopeKey: uniqueGroup(),
      authorJid: '551199999999@s.whatsapp.net',
      text: 'bot',
      messageType: 'ptt',
      funConfig: {},
      sock: socket(messages),
      identityMap: createIdentityMap(),
    });
    assert.equal(noPayload.reason, 'message-type');

    const rawMessage = {
      key: { id: 'incoming-audio', remoteJid: uniqueGroup() },
      message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus', url: 'https://invalid.example/audio', mediaKey: Buffer.from('key') } },
    };
    const result = await service.tryRespond({
      scopeKey: rawMessage.key.remoteJid,
      authorJid: '551199999999@s.whatsapp.net',
      text: 'bot',
      messageType: 'ptt',
      rawMessage,
      funConfig: {},
      sock: socket(messages),
      identityMap: createIdentityMap(),
    });

    assert.equal(result.responded, true);
    assert.match(request.prompt, /bot/);
    assert.equal(request.audios.length, 1);
    assert.match(request.audios[0], /^data:audio\/wav;base64,/);
  });
});
