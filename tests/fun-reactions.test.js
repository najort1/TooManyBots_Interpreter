import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createFunModule, parseFunCommand, resolveFunConfig } from '../fun/index.js';
import {
  createReactionMediaService,
  getReactionProviderOrder,
  normalizeReactionAction,
} from '../fun/services/reactionMediaService.js';

await initDb();

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

function uniqueJid(suffix) {
  return `5511999${String(Date.now()).slice(-6)}${suffix}@s.whatsapp.net`;
}

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}

test('reactionMediaService: anime usa Nekos.best antes de waifu.pics', async () => {
  const calls = [];
  const service = createReactionMediaService({
    fetchImpl: async (url) => {
      calls.push(String(url));
      return jsonResponse({
        results: [{ url: 'https://cdn.nekos.best/hug.gif' }],
      });
    },
  });

  assert.equal(normalizeReactionAction('abraço'), 'hug');
  assert.deepEqual(getReactionProviderOrder('hug'), [
    'nekos_best',
    'purrbot',
    'waifu_pics',
    'nekobot',
  ]);

  const result = await service.getReaction('hug', {
    funConfig: { reactionProviderTimeoutMs: 1000 },
  });

  assert.equal(result.ok, true);
  assert.equal(result.provider, 'nekos.best');
  assert.equal(result.url, 'https://cdn.nekos.best/hug.gif');
  assert.equal(calls.length, 1);
  assert.match(calls[0], /nekos\.best\/api\/v2\/hug/);
});

test('reactionMediaService: anime sem endpoint no Nekos.best cai para purrbot (2a fonte)', async () => {
  const calls = [];
  const service = createReactionMediaService({
    fetchImpl: async (url) => {
      calls.push(String(url));
      return jsonResponse({ link: 'https://purrbot.site/img/sfw/lick.gif' });
    },
  });

  const result = await service.getReaction('lick', {
    funConfig: { reactionProviderTimeoutMs: 1000 },
  });

  assert.equal(result.ok, true);
  assert.equal(result.provider, 'purrbot');
  assert.equal(result.url, 'https://purrbot.site/img/sfw/lick.gif');
  assert.equal(calls.length, 1);
  assert.match(calls[0], /purrbot\.site\/v2\/img\/sfw\/lick\/gif/);
});

test('reactionMediaService: memes usam Nekos.best como provedor primario', async () => {
  const calls = [];
  const service = createReactionMediaService({
    random: () => 0,
    fetchImpl: async (url) => {
      calls.push(String(url));
      return jsonResponse({
        results: [{ url: 'https://nekos.best/api/v2/laugh/001.gif' }],
      });
    },
  });

  const result = await service.getReaction('laugh', {
    funConfig: {
      reactionProviderTimeoutMs: 1000,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.provider, 'nekos.best');
  assert.equal(result.url, 'https://nekos.best/api/v2/laugh/001.gif');
  assert.equal(calls.length, 1);
  assert.match(calls[0], /nekos\.best\/api\/v2\/laugh/);
});

test('reactionMediaService: meme sem suporte no Nekos.best cai para Tenor', async () => {
  const calls = [];
  const service = createReactionMediaService({
    random: () => 0,
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (url.includes('waifu.pics')) return jsonResponse({ url: 'https://i.waifu.pics/sus.gif' });
      return jsonResponse({
        results: [
          {
            media_formats: {
              tinygif: { url: 'https://media.tenor.com/sus.gif' },
            },
          },
        ],
      });
    },
  });

  const result = await service.getReaction('sus', {
    funConfig: {
      tenorApiKey: 'test-key',
      tenorClientKey: 'test-client',
      reactionProviderTimeoutMs: 1000,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.provider, 'tenor');
  assert.equal(result.url, 'https://media.tenor.com/sus.gif');
  assert.equal(calls.length, 1);
  assert.match(calls[0], /tenor\.googleapis\.com/);
});

test('facade: comando /hug envia imagem por Buffer (download proprio) com handler de reacao', async () => {
  const groupJid = uniqueGroup();
  const userA = uniqueJid('01');
  const userB = uniqueJid('02');
  const images = [];
  const funConfig = resolveFunConfig({
    enabled: true,
    cooldownMs: 0,
    requireGroupWhitelist: true,
    groupWhitelistJids: [groupJid],
    mentionUsers: false,
    replyQuoted: false,
  });

  assert.equal(parseFunCommand('/hug @Bob', '/').command, 'reaction');

  const originalFetch = globalThis.fetch;
  // Simula um GIF de 1x1 pixel via fetch (evita requisicao real)
  globalThis.fetch = async (url) => {
    const gifBuf = Buffer.from(
      'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
      'base64'
    );
    return {
      ok: true,
      arrayBuffer: async () => gifBuf.buffer.slice(gifBuf.byteOffset, gifBuf.byteOffset + gifBuf.byteLength),
    };
  };

  const funModule = createFunModule({
    getConfig: () => funConfig,
    getLogger: () => null,
    getDatabase: getDb,
    sendImage: async (_sock, jid, payload) => {
      images.push({ jid, ...payload });
    },
    getContactDisplayName: (jid) => (jid === userA ? 'Alice' : jid === userB ? 'Bob' : ''),
    listContacts: () => [
      { jid: userA, name: 'Alice' },
      { jid: userB, name: 'Bob' },
    ],
    reactionMediaService: {
      getReaction: async (action) => ({
        ok: true,
        action,
        kind: 'anime',
        provider: 'nekos.best',
        url: 'https://cdn.nekos.best/hug.gif',
        mimeType: 'image/gif',
      }),
    },
  });
  funModule.init();

  await funModule.onIncomingMessage({
    sock: {},
    chatJid: groupJid,
    actorJid: userA,
    isGroup: true,
    text: '/hug @Bob',
    messageType: 'text',
    mentionedJids: [userB],
  });

  globalThis.fetch = originalFetch;

  assert.equal(images.length, 1);
  assert.equal(images[0].jid, groupJid);
  assert.ok(Buffer.isBuffer(images[0].imageBuffer), 'deve enviar Buffer próprio');
  assert.equal(images[0].mimeType, 'image/gif');
  assert.match(images[0].caption, /Alice/);
  assert.match(images[0].caption, /Bob/);
  assert.doesNotMatch(images[0].caption, /fonte/);
});

test('reactionMediaService: NSFW action usa purrbot_nsfw como provider unico', async () => {
  const calls = [];
  const service = createReactionMediaService({
    fetchImpl: async (url) => {
      calls.push(String(url));
      return jsonResponse({ link: 'https://purrbot.site/img/nsfw/anal.gif' });
    },
  });

  assert.deepEqual(getReactionProviderOrder('anal'), ['purrbot_nsfw']);
  assert.deepEqual(getReactionProviderOrder('blowjob'), ['purrbot_nsfw']);

  const result = await service.getReaction('anal', {
    funConfig: { reactionProviderTimeoutMs: 1000 },
  });

  assert.equal(result.ok, true);
  assert.equal(result.provider, 'purrbot');
  assert.equal(result.url, 'https://purrbot.site/img/nsfw/anal.gif');
  assert.equal(calls.length, 1);
  assert.match(calls[0], /purrbot\.site\/v2\/img\/nsfw\/anal\/gif/);
});

test('reactionMediaService: NSFW neko usa endpoint neko/gif', async () => {
  const calls = [];
  const service = createReactionMediaService({
    fetchImpl: async (url) => {
      calls.push(String(url));
      return jsonResponse({ link: 'https://purrbot.site/img/nsfw/neko.gif' });
    },
  });

  const result = await service.getReaction('neko', {
    funConfig: { reactionProviderTimeoutMs: 1000 },
  });

  assert.equal(result.ok, true);
  assert.equal(result.url, 'https://purrbot.site/img/nsfw/neko.gif');
  assert.match(calls[0], /purrbot\.site\/v2\/img\/nsfw\/neko\/gif/);
});

test('reactionMediaService: provider order SFW com purrbot como segunda opcao', async () => {
  const calls = [];
  const service = createReactionMediaService({
    fetchImpl: async (url) => {
      calls.push(String(url));
      return jsonResponse({
        results: [{ url: 'https://cdn.nekos.best/hug.gif' }],
      });
    },
  });

  assert.deepEqual(getReactionProviderOrder('hug'), [
    'nekos_best',
    'purrbot',
    'waifu_pics',
    'nekobot',
  ]);

  const result = await service.getReaction('hug', {
    funConfig: { reactionProviderTimeoutMs: 1000 },
  });

  assert.equal(result.ok, true);
  assert.equal(result.provider, 'nekos.best');
  assert.equal(calls.length, 1);
  assert.match(calls[0], /nekos\.best\/api\/v2\/hug/);
});
