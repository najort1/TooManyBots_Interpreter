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

function makeService({ fetchImpl, getConfig, groupMemoryService, repository } = {}) {
  const repo = repository || createFunImageGenerationRepository({ getDatabase: getDb });
  return createImageGenerationService({
    repository: repo,
    fetchImpl,
    getConfig: getConfig || (() => resolveFunConfig({ imageGenDailyLimit: 25 })),
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

test('imageGenerationService: suporta resposta b64_json', async () => {
  const pngB64 = Buffer.from('png-bytes-here').toString('base64');
  const service = makeService({
    fetchImpl: async () => jsonResponse({ data: [{ b64_json: pngB64 }] }),
    getConfig: () => resolveFunConfig({ imageGenResponseFormat: 'b64_json' }),
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
});

test('imageGenerationService: /gerar injeta lore do grupo no prompt final', async () => {
  let seenPrompt = '';
  const groupMemoryService = {
    buildLoreContext: () => '<group_lore>fato antigo do grupo</group_lore>',
  };
  const service = makeService({
    groupMemoryService,
    fetchImpl: async (_url, init = {}) => {
      seenPrompt = JSON.parse(String(init.body || '{}')).prompt;
      return jsonResponse({ data: [{ url: 'http://cdn.local/memory.png' }] });
    },
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
  assert.match(seenPrompt, /um robo sambando/);
  assert.match(seenPrompt, /<group_lore>fato antigo do grupo<\/group_lore>/);
});

test('imageGenerationService: /imaginar nao injeta lore', async () => {
  let seenPrompt = '';
  const service = makeService({
    groupMemoryService: {
      buildLoreContext: () => '<group_lore>nao deveria entrar</group_lore>',
    },
    fetchImpl: async (_url, init = {}) => {
      seenPrompt = JSON.parse(String(init.body || '{}')).prompt;
      return jsonResponse({ data: [{ url: 'http://cdn.local/no-lore.png' }] });
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
  assert.equal(seenPrompt, 'cidade futurista');
});

test('imageGenerationService: bloqueia prompt vazio', async () => {
  const service = makeService({ fetchImpl: async () => jsonResponse({ data: [{ url: 'http://x/y.png' }] }) });
  const out = await service.generateImage({
    scopeKey: uniqueGroup(),
    userJid: uniqueJid('15'),
    prompt: '   ',
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'empty-prompt');
});

test('imageGenerationService: falha em HTTP 500 com reason http-500', async () => {
  const service = makeService({
    fetchImpl: async () => errorResponse(500, 'server exploded'),
  });

  const out = await service.generateImage({
    scopeKey: uniqueGroup(),
    userJid: uniqueJid('16'),
    prompt: 'tempestade no mar',
    now: Date.UTC(2026, 6, 30, 19, 0, 0),
  });

  assert.equal(out.ok, false);
  assert.equal(out.reason, 'http-500');
  assert.match(out.error, /server exploded/);
});

test('imageGenerationService: falha quando resposta nao traz data de imagem', async () => {
  const service = makeService({
    fetchImpl: async () => jsonResponse({ data: [] }),
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

test('imageGenerationService: rejeita URL insegura retornada pela API', async () => {
  const service = makeService({
    fetchImpl: async () => jsonResponse({ data: [{ url: 'javascript:alert(1)' }] }),
  });
  const out = await service.generateImage({
    scopeKey: uniqueGroup(),
    userJid: uniqueJid('18'),
    prompt: 'cachorro de terno',
    now: Date.UTC(2026, 6, 30, 21, 0, 0),
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'unsafe-url');
});

test('imageGenerationService: quota global soma grupos diferentes no mesmo dia', async () => {
  const limit = 2;
  const now = Date.UTC(2026, 6, 30, 12, 0, 0);
  const service = makeService({
    repository: makeMemoryRepo(),
    getConfig: () => resolveFunConfig({ imageGenDailyLimit: limit }),
    fetchImpl: async () => jsonResponse({ data: [{ url: 'http://cdn.local/shared.png' }] }),
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
    getConfig: () => resolveFunConfig({ imageGenDailyLimit: limit }),
    fetchImpl: async () => jsonResponse({ data: [{ url: 'http://cdn.local/reset.png' }] }),
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
    getConfig: () => resolveFunConfig({ imageGenDailyLimit: 3 }),
    fetchImpl: async () => jsonResponse({ data: [{ url: 'http://cdn.local/status.png' }] }),
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
