import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createFunModule, parseFunCommand, resolveFunConfig } from '../fun/index.js';
import { createFunImageGenerationRepository } from '../fun/db/funImageGenerationRepository.js';
import {
  createImageGenerationService,
  dateStrForSaoPaulo,
} from '../fun/services/imageGenerationService.js';
import { handleGerarCommand, handleImaginarCommand } from '../fun/commands/handlers/image.js';

await initDb();

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

function uniqueJid(suffix = '11') {
  return `5511999${String(Date.now()).slice(-6)}${suffix}@s.whatsapp.net`;
}

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}

function errorResponse(status, body = 'boom') {
  return {
    ok: false,
    status,
    text: async () => body,
  };
}

function binaryImageResponse(bytes, contentType = 'image/jpeg') {
  const buffer = Buffer.from(bytes);
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => String(name).toLowerCase() === 'content-type' ? contentType : null },
    arrayBuffer: async () => buffer,
  };
}

function makeMockGeminiClient({
  imageData = Buffer.from('gemini-image-bytes').toString('base64'),
  text = 'Olha o desenho gerado',
  shouldThrow = null,
} = {}) {
  return {
    interactions: {
      create: async (params) => {
        if (shouldThrow) throw shouldThrow;
        return {
          params,
          steps: [
            {
              type: 'model_output',
              content: [
                { type: 'text', text },
                { type: 'image', data: imageData },
              ],
            },
          ],
        };
      },
    },
  };
}

function makeService({ fetchImpl, aiClient, getConfig, groupMemoryService, repository } = {}) {
  const repo = repository || createFunImageGenerationRepository({ getDatabase: getDb });
  return createImageGenerationService({
    repository: repo,
    fetchImpl,
    aiClient,
    getConfig:
      getConfig ||
      (() =>
        resolveFunConfig({
          imageGenDailyLimit: 25,
          imageGenProvider: 'gemini',
          imageGenApiKey: 'test-key',
          imageGenModel: 'models/gemini-3.1-flash-lite-image',
        })),
    groupMemoryService,
  });
}

function makeMemoryRepo() {
  const rows = [];
  return {
    countByDate(dateStr) {
      return rows.filter((row) => row.dateStr === dateStr).length;
    },
    register(entry) {
      rows.push({ id: rows.length + 1, ...entry });
      return { id: rows.length };
    },
    listByDate(dateStr, limit = 100) {
      return rows.filter((row) => row.dateStr === dateStr).slice(-limit).reverse();
    },
    pruneBefore(beforeMs) {
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        if ((rows[i].created_at || 0) < beforeMs) rows.splice(i, 1);
      }
      return before - rows.length;
    },
  };
}

test('parseFunCommand: gerar e imaginar mapeiam corretamente', () => {
  assert.deepEqual(parseFunCommand('/gerar gato mago', '/'), {
    command: 'gerar',
    args: ['gato', 'mago'],
  });
  assert.deepEqual(parseFunCommand('/imaginar cidade neon', '/'), {
    command: 'imaginar',
    args: ['cidade', 'neon'],
  });
  assert.equal(parseFunCommand('/imagine castelo', '/').command, 'imaginar');
});

test('imageGenerationService: suporta geracao nativa do Gemini com @google/genai', async () => {
  const mockAi = makeMockGeminiClient({
    imageData: Buffer.from('gemini-png-bytes').toString('base64'),
    text: 'Um gato cibernetico',
  });

  const service = makeService({
    aiClient: mockAi,
  });

  const out = await service.generateImage({
    scopeKey: uniqueGroup(),
    userJid: uniqueJid('12'),
    prompt: 'gato cibernetico',
    now: Date.UTC(2026, 6, 30, 16, 0, 0),
  });

  assert.equal(out.ok, true);
  assert.equal(Buffer.isBuffer(out.buffer), true);
  assert.equal(out.buffer.toString(), 'gemini-png-bytes');
  assert.equal(out.text, 'Um gato cibernetico');
  assert.equal(out.format, 'b64_json');
});

test('imageGenerationService: /gerar usa o modelo Zen principal e reaproveita endpoint/chave do Zen', async () => {
  const pngB64 = Buffer.from('png-bytes-here').toString('base64');
  let request = null;
  const service = makeService({
    getConfig: () =>
      resolveFunConfig({
        zenBaseUrl: 'http://localhost:20128/v1',
        zenApiKey: 'zen-test-key',
      }),
    fetchImpl: async (url, options) => {
      request = { url, options };
      return jsonResponse({ data: [{ b64_json: pngB64 }] });
    },
  });

  const out = await service.generateImage({
    scopeKey: uniqueGroup(),
    userJid: uniqueJid('12'),
    prompt: 'dragao roxo',
    now: Date.UTC(2026, 6, 30, 16, 0, 0),
  });

  assert.equal(out.ok, true);
  assert.equal(Buffer.isBuffer(out.buffer), true);
  assert.equal(out.buffer.toString(), 'png-bytes-here');
  assert.equal(out.url, '');
  assert.equal(out.format, 'b64_json');
  assert.equal(request.url, 'http://localhost:20128/v1/images/generations?response_format=binary');
  assert.equal(request.options.headers.Authorization, 'Bearer zen-test-key');
  assert.deepEqual(JSON.parse(request.options.body), {
    prompt: 'dragao roxo',
    model: 'ag/gemini-3.1-flash-image',
    size: '1K',
  });
});

test('imageGenerationService: usa retorno binário do Zen quando b64_json chega vazio', async () => {
  const requests = [];
  const service = makeService({
    getConfig: () => resolveFunConfig({ zenBaseUrl: 'http://localhost:20128/v1', zenApiKey: 'zen-test-key' }),
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (requests.length === 1) return jsonResponse({ data: [{ b64_json: '', revised_prompt: 'capivara astronauta' }] });
      return binaryImageResponse('zen-binary-image');
    },
  });

  const out = await service.generateImage({
    scopeKey: uniqueGroup(),
    userJid: uniqueJid('12'),
    prompt: 'capivara astronauta',
    now: Date.UTC(2026, 6, 30, 16, 0, 0),
  });

  assert.equal(out.ok, true);
  assert.equal(out.buffer.toString(), 'zen-binary-image');
  assert.equal(out.format, 'binary');
  assert.equal(requests.length, 2);
  assert.match(requests[1].url, /\/images\/generations\?response_format=binary$/);
  assert.equal(JSON.parse(requests[1].options.body).response_format, undefined);
});

test('imageGenerationService: troca para o modelo Zen alternativo após respostas vazias', async () => {
  const requests = [];
  const service = makeService({
    getConfig: () => resolveFunConfig({
      zenBaseUrl: 'http://localhost:20128/v1',
      zenApiKey: 'zen-test-key',
      imageGenFallbackModels: ['gemini/gemini-3.1-flash-image-preview'],
      imageGenPrimaryAttempts: 1,
    }),
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (requests.length === 1) return jsonResponse({ data: [{ b64_json: '', revised_prompt: 'vazio' }] });
      return jsonResponse({ data: [{ b64_json: Buffer.from('fallback-model-image').toString('base64') }] });
    },
  });

  const out = await service.generateImage({
    scopeKey: uniqueGroup(),
    userJid: uniqueJid('12'),
    prompt: 'capivara astronauta',
    now: Date.UTC(2026, 6, 30, 16, 0, 0),
  });

  assert.equal(out.ok, true);
  assert.equal(out.buffer.toString(), 'fallback-model-image');
  assert.equal(requests.length, 2);
  assert.equal(JSON.parse(requests[0].options.body).model, 'ag/gemini-3.1-flash-image');
  assert.equal(JSON.parse(requests[1].options.body).model, 'gemini/gemini-3.1-flash-image-preview');
});

test('image commands: usam perfil e lore confirmada da pessoa marcada sem expor JID', async () => {
  const generated = [];
  const mentionedJid = '551199999999@s.whatsapp.net';
  const common = {
    scopeKey: uniqueGroup(),
    userJid: uniqueJid('12'),
    args: ['como', 'você', 'imagina', '@551199999999'],
    mentionedJids: [mentionedJid],
    profileService: {
      displayName: () => 'Nina',
      getProfile: () => ({
        empty: false,
        nickname: 'Ninoca',
        title: 'Rainha das Figurinhas',
        bio: 'cinéfila e torcedora do Bahia',
        extras: 'adora gatos; vive desenhando',
      }),
    },
    groupMemoryService: {
      getFactsForSubjects: () => [{
        kind: 'running_gag',
        summary: 'Nina sempre chega com uma figurinha de gato na hora errada',
        subjects: [mentionedJid],
      }],
    },
    imageGenerationService: {
      generateImage: async (input) => {
        generated.push(input);
        return { ok: true, buffer: Buffer.from('image'), used: 1, limit: 25, remaining: 24 };
      },
    },
    reply: async () => {},
    replyImage: async () => {},
    funConfig: { prefix: '/' },
  };

  await handleGerarCommand(common);
  await handleImaginarCommand(common);

  assert.equal(generated.length, 2);
  for (const input of generated) {
    assert.match(input.prompt, /@Nina/);
    assert.match(input.mentionedContext, /Membro mencionado: Nina/);
    assert.match(input.mentionedContext, /Rainha das Figurinhas/);
    assert.match(input.mentionedContext, /adora gatos/);
    assert.match(input.mentionedContext, /figurinha de gato/);
    assert.doesNotMatch(input.mentionedContext, /551199999999/);
  }
  assert.equal(generated[0].withMemory, true);
  assert.equal(generated[1].withMemory, false);
});

test('imageGenerationService: configuração explícita de imagem continua vencendo o Zen', () => {
  const config = resolveFunConfig({
    zenBaseUrl: 'http://localhost:20128/v1',
    zenApiKey: 'zen-key',
    imageGenBaseUrl: 'http://image.example/v1',
    imageGenApiKey: 'image-key',
  });

  assert.equal(config.imageGenBaseUrl, 'http://image.example/v1');
  assert.equal(config.imageGenApiKey, 'image-key');
});

test('imageGenerationService: /gerar injeta lore do grupo no prompt final', async () => {
  let seenInput = '';
  const mockAi = {
    interactions: {
      create: async (params) => {
        seenInput = params.input;
        return {
          steps: [
            {
              type: 'model_output',
              content: [
                { type: 'image', data: Buffer.from('img').toString('base64') },
              ],
            },
          ],
        };
      },
    },
  };

  const groupMemoryService = {
    buildLoreContext: () => '<group_lore>fato antigo do grupo</group_lore>',
  };

  const service = makeService({
    aiClient: mockAi,
    groupMemoryService,
  });

  const out = await service.generateImage({
    scopeKey: uniqueGroup(),
    userJid: uniqueJid('13'),
    prompt: 'um robo sambando',
    command: 'gerar',
    withMemory: true,
    now: Date.UTC(2026, 6, 30, 17, 0, 0),
  });

  assert.equal(out.ok, true);
  assert.match(seenInput, /um robo sambando/);
  assert.match(seenInput, /<group_lore>fato antigo do grupo<\/group_lore>/);
});

test('imageGenerationService: /imaginar nao injeta lore', async () => {
  let seenInput = '';
  const mockAi = {
    interactions: {
      create: async (params) => {
        seenInput = params.input;
        return {
          steps: [
            {
              type: 'model_output',
              content: [
                { type: 'image', data: Buffer.from('img').toString('base64') },
              ],
            },
          ],
        };
      },
    },
  };

  const service = makeService({
    aiClient: mockAi,
    groupMemoryService: {
      buildLoreContext: () => '<group_lore>nao deveria entrar</group_lore>',
    },
  });

  const out = await service.generateImage({
    scopeKey: uniqueGroup(),
    userJid: uniqueJid('14'),
    prompt: 'cidade futurista',
    command: 'imaginar',
    withMemory: false,
    now: Date.UTC(2026, 6, 30, 18, 0, 0),
  });

  assert.equal(out.ok, true);
  assert.equal(seenInput, 'cidade futurista');
});

test('imageGenerationService: bloqueia prompt vazio', async () => {
  const service = makeService({
    aiClient: makeMockGeminiClient(),
  });
  const out = await service.generateImage({
    scopeKey: uniqueGroup(),
    userJid: uniqueJid('15'),
    prompt: '   ',
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'empty-prompt');
});

test('imageGenerationService: mapeia rate-limit 429 para quota-exceeded', async () => {
  const err = new Error('Resource exhausted / rate-limit exceeded');
  err.status = 429;
  const service = makeService({
    aiClient: makeMockGeminiClient({ shouldThrow: err }),
  });

  const out = await service.generateImage({
    scopeKey: uniqueGroup(),
    userJid: uniqueJid('16'),
    prompt: 'tempestade no mar',
    now: Date.UTC(2026, 6, 30, 19, 0, 0),
  });

  assert.equal(out.ok, false);
  assert.equal(out.reason, 'quota-exceeded');
});

test('imageGenerationService: falha quando resposta do Gemini nao traz imagem', async () => {
  const mockAi = {
    interactions: {
      create: async () => ({
        steps: [
          {
            type: 'model_output',
            content: [{ type: 'text', text: 'Nao consegui desenhar' }],
          },
        ],
      }),
    },
  };
  const service = makeService({
    aiClient: mockAi,
  });
  const out = await service.generateImage({
    scopeKey: uniqueGroup(),
    userJid: uniqueJid('17'),
    prompt: 'ilha flutuante',
    now: Date.UTC(2026, 6, 30, 20, 0, 0),
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'no-image');
});

test('imageGenerationService: quota global soma grupos diferentes no mesmo dia', async () => {
  const limit = 2;
  const now = Date.UTC(2026, 6, 30, 12, 0, 0);
  const service = makeService({
    repository: makeMemoryRepo(),
    aiClient: makeMockGeminiClient(),
    getConfig: () => resolveFunConfig({ imageGenDailyLimit: limit }),
  });

  const groupA = uniqueGroup();
  const groupB = uniqueGroup();
  const r1 = await service.generateImage({ scopeKey: groupA, userJid: uniqueJid('19'), prompt: 'a', now });
  const r2 = await service.generateImage({ scopeKey: groupB, userJid: uniqueJid('20'), prompt: 'b', now: now + 1000 });
  const r3 = await service.generateImage({ scopeKey: groupA, userJid: uniqueJid('21'), prompt: 'c', now: now + 2000 });

  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  assert.equal(r3.ok, false);
  assert.equal(r3.reason, 'quota-exceeded');
  assert.equal(r3.limit, limit);
});

test('imageGenerationService: quota reseta ao virar o dia em America/Sao_Paulo', async () => {
  const limit = 1;
  const service = makeService({
    repository: makeMemoryRepo(),
    aiClient: makeMockGeminiClient(),
    getConfig: () => resolveFunConfig({ imageGenDailyLimit: limit }),
  });

  // 2026-07-30 23:59:30 em Sao Paulo ~= 2026-07-31T02:59:30Z
  const beforeMidnightSp = Date.UTC(2026, 6, 31, 2, 59, 30);
  const afterMidnightSp = Date.UTC(2026, 6, 31, 3, 0, 30);
  const a = await service.generateImage({
    scopeKey: uniqueGroup(),
    userJid: uniqueJid('22'),
    prompt: 'lua',
    now: beforeMidnightSp,
  });
  const b = await service.generateImage({
    scopeKey: uniqueGroup(),
    userJid: uniqueJid('23'),
    prompt: 'sol',
    now: afterMidnightSp,
  });

  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.notEqual(a.dateStr, b.dateStr);
  assert.equal(dateStrForSaoPaulo(beforeMidnightSp), '2026-07-30');
  assert.equal(dateStrForSaoPaulo(afterMidnightSp), '2026-07-31');
});

test('imageGenerationService: getDailyStatus reflete usado e restante', async () => {
  const now = Date.UTC(2026, 7, 1, 15, 0, 0);
  const service = makeService({
    aiClient: makeMockGeminiClient(),
    getConfig: () => resolveFunConfig({ imageGenDailyLimit: 3 }),
  });
  await service.generateImage({ scopeKey: uniqueGroup(), userJid: uniqueJid('24'), prompt: '1', now });
  await service.generateImage({ scopeKey: uniqueGroup(), userJid: uniqueJid('25'), prompt: '2', now: now + 1000 });

  const status = service.getDailyStatus({ now: now + 2000 });
  assert.equal(status.limit, 3);
  assert.equal(status.used >= 2, true);
  assert.equal(status.remaining, status.limit - status.used);
});

test('fun route: /gerar sem prompt responde uso e quota excedida responde mensagem clara', async () => {
  const msgs = [];
  const module = createFunModule({
    getDatabase: getDb,
    getConfig: () => resolveFunConfig({ groupWhitelistJids: [], requireGroupWhitelist: false }),
    sendText: async (_sock, _jid, msg) => msgs.push(msg),
    imageGenerationService: {
      async generateImage() {
        return { ok: false, reason: 'quota-exceeded', limit: 25 };
      },
    },
  });

  await module.onIncomingMessage({
    sock: {},
    chatJid: uniqueGroup(),
    actorJid: uniqueJid('28'),
    isGroup: true,
    text: '/gerar',
    reply: async (msg) => msgs.push(msg),
  });

  await module.onIncomingMessage({
    sock: {},
    chatJid: uniqueGroup(),
    actorJid: uniqueJid('29'),
    isGroup: true,
    text: '/imaginar astronauta',
    reply: async (msg) => msgs.push(msg),
  });

  assert.match(msgs[0], /Uso: \/gerar <prompt>/);
  assert.match(msgs[1], /Limite diário de geração de imagens atingido/);
});
