import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createFunGroupRepository } from '../fun/db/funGroupRepository.js';
import { createFunPersonaRepository } from '../fun/db/funPersonaRepository.js';
import { createPersonaService } from '../fun/services/personaService.js';
import { createPersonaToolExecutor } from '../fun/services/personaToolExecutor.js';
import { createGeminiTtsService } from '../fun/services/geminiTtsService.js';
import { createIdentityMap } from '../fun/utils/identity.js';

await initDb();

let sequence = 0;
function uniqueGroup() {
  sequence += 1;
  return `1203639999${String(sequence).padStart(8, '0')}@g.us`;
}

function createService({ generateZen, personaTtsService, audioTranscoder, downloadMedia, personaToolExecutor } = {}) {
  return {
    repository: createFunPersonaRepository({ getDatabase: getDb }),
    service: createPersonaService({
      personaRepository: createFunPersonaRepository({ getDatabase: getDb }),
      groupRepository: createFunGroupRepository({ getDatabase: getDb }),
      personaToolExecutor: personaToolExecutor || createPersonaToolExecutor({ chaosService: {} }),
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

test('persona TTS: envia a fala inteira ao SDK sem corte local', async () => {
  let request = null;
  const text = 'fala longa e completa '.repeat(140).trim();
  const service = createGeminiTtsService({
    apiKey: 'test-key',
    generateClient: () => ({
      models: {
        generateContent: async (input) => {
          request = input;
          return {
            candidates: [{
              content: { parts: [{ inlineData: { data: Buffer.from('pcm').toString('base64'), mimeType: 'audio/L16;rate=24000' } }] },
            }],
          };
        },
      },
    }),
    audioTranscoder: { toOggOpus: async () => Buffer.from('ogg') },
  });

  const result = await service.synthesize(text);

  assert.equal(result.ok, true);
  assert.equal(request.contents[0].parts[0].text, text);
  assert.ok(text.length > 2_000);
});

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

test('persona audio: a ação narrada longa chega inteira à síntese', async () => {
  await withLiveLlm(async () => {
    const spokenText = 'Essa parte precisa ser narrada sem perder nenhum detalhe importante. '.repeat(25).trim();
    let synthesizedText = '';
    const messages = [];
    const { service } = createService({
      generateZen: async () => JSON.stringify({ type: 'audio', text: spokenText }),
      personaTtsService: {
        isAvailable: () => true,
        synthesize: async (text) => {
          synthesizedText = text;
          return { ok: true, buffer: Buffer.from('ogg'), mimeType: 'audio/ogg; codecs=opus' };
        },
      },
    });

    const result = await service.tryRespond({
      scopeKey: uniqueGroup(),
      authorJid: '551199999999@s.whatsapp.net',
      text: 'bot manda um áudio explicando tudo',
      messageType: 'text',
      funConfig: { personaMaxChars: 0 },
      sock: socket(messages),
      identityMap: createIdentityMap(),
      now: 1_050_000,
    });

    assert.equal(result.responded, true);
    assert.equal(result.response, spokenText);
    assert.equal(synthesizedText, spokenText);
    assert.ok(spokenText.length > 280);
    assert.equal(messages[0].ptt, true);
  });
});

test('persona audio: falha de TTS envia a mesma fala como texto com aviso no topo', async () => {
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
    assert.equal(result.response, 'Tentou usar (audio) mas falhou\n\nNão vou ficar em silêncio.');
    assert.deepEqual(messages, [{ text: 'Tentou usar (audio) mas falhou\n\nNão vou ficar em silêncio.' }]);
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

test('persona audio: converte reply de texto para áudio quando usuário pede expressamente em áudio', async () => {
  await withLiveLlm(async () => {
    const messages = [];
    let synthesizedText = '';
    const { service } = createService({
      generateZen: async () => '{"type":"reply","text":"Cantei uma rima pra você agora."}',
      personaTtsService: {
        isAvailable: () => true,
        synthesize: async (text) => {
          synthesizedText = text;
          return { ok: true, buffer: Buffer.from('ogg'), mimeType: 'audio/ogg; codecs=opus' };
        },
      },
    });

    const result = await service.tryRespond({
      scopeKey: uniqueGroup(),
      authorJid: '551199999999@s.whatsapp.net',
      text: 'bot canta a música em áudio',
      messageType: 'text',
      funConfig: {},
      sock: socket(messages),
      identityMap: createIdentityMap(),
      now: 1_200_000,
    });

    assert.equal(result.responded, true);
    assert.equal(synthesizedText, 'Cantei uma rima pra você agora.');
    assert.equal(messages[0].ptt, true);
  });
});

test('persona audio: rejeita alegação falsa de envio de áudio quando áudio não foi despachado', async () => {
  await withLiveLlm(async () => {
    const messages = [];
    const { service } = createService({
      generateZen: async () => '{"type":"reply","text":"Pronto, mandei o áudio de verdade dessa vez!"}',
      personaTtsService: { isAvailable: () => false },
    });

    const result = await service.tryRespond({
      scopeKey: uniqueGroup(),
      authorJid: '551199999999@s.whatsapp.net',
      text: 'bot você tá vivo?',
      messageType: 'text',
      funConfig: {},
      sock: socket(messages),
      identityMap: createIdentityMap(),
      now: 1_300_000,
    });

    assert.equal(result.responded, true);
    // Como a persona alegou que mandou áudio em texto puro e sem TTS disponível, a claim é barrada
    assert.equal(result.response, 'Não consegui confirmar essa ação agora.');
    assert.deepEqual(messages, [{ text: 'Não consegui confirmar essa ação agora.' }]);
  });
});

test('persona audio: tool send_voice envia áudio quando bem-sucedida', async () => {
  await withLiveLlm(async () => {
    const messages = [];
    let generations = 0;
    const { service } = createService({
      generateZen: async () => (++generations === 1)
        ? '{"type":"tool_call","name":"send_voice","arguments":{"text":"Soltando o rap do grupo!"}}'
        : '{"type":"reply","text":"mandei a braba no áudio"}',
      personaTtsService: {
        isAvailable: () => true,
        synthesize: async (text) => ({ ok: true, buffer: Buffer.from('ogg'), mimeType: 'audio/ogg; codecs=opus' }),
      },
    });

    const result = await service.tryRespond({
      scopeKey: uniqueGroup(),
      authorJid: '551199999999@s.whatsapp.net',
      text: 'bot use sua tool de enviar audio e mande o rap',
      messageType: 'text',
      funConfig: {},
      sock: socket(messages),
      identityMap: createIdentityMap(),
      now: 1_400_000,
    });

    assert.equal(result.responded, true);
    const audioMsg = messages.find((m) => m.ptt === true);
    assert.ok(audioMsg, 'deve ter enviado mensagem com ptt: true');
  });
});

test('persona audio: tool send_voice com falha de TTS avisa no topo que tentou usar mas falhou', async () => {
  await withLiveLlm(async () => {
    const messages = [];
    let generations = 0;
    const { service } = createService({
      generateZen: async () => (++generations === 1)
        ? '{"type":"tool_call","name":"send_voice","arguments":{"text":"Tentativa de cantar."}}'
        : '{"type":"reply","text":"mandei aí"}',
      personaTtsService: {
        isAvailable: () => true,
        synthesize: async () => ({ ok: false, reason: 'generation-error' }),
      },
    });

    const result = await service.tryRespond({
      scopeKey: uniqueGroup(),
      authorJid: '551199999999@s.whatsapp.net',
      text: 'bot manda o áudio',
      messageType: 'text',
      funConfig: {},
      sock: socket(messages),
      identityMap: createIdentityMap(),
      now: 1_500_000,
    });

    assert.equal(result.responded, true);
    const textMsg = messages.find((m) => typeof m.text === 'string' && m.text.includes('Tentou usar (audio) mas falhou'));
    assert.ok(textMsg, 'deve conter o indicativo no topo de que a tool de áudio falhou');
  });
});
