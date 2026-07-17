import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import {
  createFunModule,
  parseFunCommand,
  resolveFunConfig,
} from '../fun/index.js';
import { FUN_COMMANDS } from '../fun/constants.js';
import {
  drawTarotCards,
  formatTarotDraw,
  fallbackTarotReading,
  TAROT_MAJOR,
} from '../fun/services/tarotDeck.js';
import {
  createTarotService,
  sanitizeTarotText,
} from '../fun/services/tarotService.js';
import { createFunCasinoRepository } from '../fun/db/funCasinoRepository.js';
import { createFunStatsRepository, _resetDefaultFunStatsRepository } from '../fun/db/funStatsRepository.js';

await initDb();
_resetDefaultFunStatsRepository();

function uniqueJid(prefix = '5511') {
  return `${prefix}${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 90 + 10)}@s.whatsapp.net`;
}

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

test('parseFunCommand: aliases tarot', () => {
  assert.equal(parseFunCommand('/tarot vai dar certo?', '/').command, FUN_COMMANDS.TAROT);
  assert.equal(parseFunCommand('/taro oi', '/').command, FUN_COMMANDS.TAROT);
  assert.equal(parseFunCommand('/cartas', '/').command, FUN_COMMANDS.TAROT);
  assert.equal(parseFunCommand('/vidente', '/').command, FUN_COMMANDS.TAROT);
  // /oraculo agora é ORACLE (caos); tarô fica em /tarot /cartas /vidente
  assert.notEqual(parseFunCommand('/oraculo amor', '/').command, FUN_COMMANDS.TAROT);
  const p = parseFunCommand('/tarot ele gosta de mim?', '/');
  assert.deepEqual(p.args, ['ele', 'gosta', 'de', 'mim?']);
});

test('tarotDeck: 22 arcanos, tiragem 3, fallback', () => {
  assert.equal(TAROT_MAJOR.length, 22);
  let i = 0;
  const seq = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
  const cards = drawTarotCards(() => seq[Math.min(i++, seq.length - 1)], 3);
  assert.equal(cards.length, 3);
  assert.equal(new Set(cards.map((c) => c.id)).size, 3);
  assert.ok(cards[0].position);
  assert.ok(Array.isArray(cards[0].keywords));

  const text = formatTarotDraw(cards);
  assert.match(text, /Passado|Presente|Conselho/i);
  assert.match(text, /\*/);

  const fb = fallbackTarotReading('vou passar na prova?', cards);
  assert.match(fb, /prova|Tiragem/i);
  assert.ok(fb.length < 2000);
});

test('sanitizeTarotText: corta em 3k e limpa meta', () => {
  const long = `${'x'.repeat(3500)} fim`;
  const s = sanitizeTarotText(long, 3000);
  assert.ok(s.length <= 3001);
  assert.ok(s.endsWith('…') || s.length <= 3000);

  const meta = sanitizeTarotText('Claro! Aqui vai: as cartas dizem sim.', 3000);
  assert.match(meta, /cartas|sim/i);
  assert.ok(!/^claro/i.test(meta));
});

test('tarotService: reading com mock zen + cooldown', async () => {
  const prev = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;

  const casinoRepo = createFunCasinoRepository({ getDatabase: getDb });
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();

  let zenCalls = 0;
  const tarot = createTarotService({
    casinoRepository: casinoRepo,
    random: () => 0.01,
    generateZen: async () => {
      zenCalls += 1;
      return 'O Louco grita: salta, mas olha o buraco. Presente pede coragem mansa. Conselho: menos drama, mais passo.';
    },
    generateOllama: async () => {
      throw new Error('should-not-ollama');
    },
  });

  const scope = uniqueGroup();
  const u = uniqueJid('5591');
  const cfg = resolveFunConfig({
    tarotEnabled: true,
    tarotCooldownMs: 60_000,
    tarotMaxChars: 3000,
    zenEnabled: true,
    ollamaEnabled: false,
  });

  const r1 = await tarot.reading({
    userJid: u,
    scopeKey: scope,
    question: 'devo mandar msg?',
    funConfig: cfg,
  });
  assert.equal(r1.ok, true);
  assert.equal(r1.provider, 'zen');
  assert.equal(r1.cards.length, 3);
  assert.match(r1.reading, /Louco|coragem|passo/i);
  assert.equal(zenCalls, 1);

  const r2 = await tarot.reading({
    userJid: u,
    scopeKey: scope,
    question: 'de novo?',
    funConfig: cfg,
  });
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, 'cooldown');

  if (prev !== undefined) process.env.FUN_DISABLE_LIVE_LLM = prev;
  else delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('tarotService: template se LLM desligado', async () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const tarot = createTarotService({
    casinoRepository: null,
    random: () => 0,
  });
  const r = await tarot.reading({
    userJid: uniqueJid(),
    scopeKey: uniqueGroup(),
    question: 'e o emprego?',
    funConfig: resolveFunConfig({ tarotEnabled: true }),
  });
  assert.equal(r.ok, true);
  assert.equal(r.provider, 'template');
  assert.match(r.reading, /emprego|Tiragem|arcano|leitura/i);
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('facade: /tarot no grupo', async () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const groupJid = uniqueGroup();
  const userA = uniqueJid('5592');
  const sent = [];
  const funConfig = resolveFunConfig({
    enabled: true,
    requireGroupWhitelist: true,
    groupWhitelistJids: [groupJid],
    replyCommandsInPrivate: false,
    tarotEnabled: true,
    tarotCooldownMs: 0,
    ollamaEnabled: false,
    zenEnabled: false,
  });

  const funModule = createFunModule({
    getConfig: () => funConfig,
    getLogger: () => null,
    getDatabase: getDb,
    sendText: async (_s, jid, text) => {
      sent.push({ jid, text });
    },
  });
  funModule.init();

  await funModule.onIncomingMessage({
    sock: {},
    chatJid: groupJid,
    actorJid: userA,
    isGroup: true,
    text: '/tarot vou passar de ano?',
    messageType: 'text',
  });

  assert.ok(
    sent.some((m) => /Embaralhando|Tiragem|tarot|Leitura|arcano|cartas/i.test(m.text)),
    JSON.stringify(sent)
  );
  assert.ok(
    sent.some((m) => /Tiragem|Leitura|Passado|Presente|Conselho|Louco|Mago|Sol/i.test(m.text)),
    JSON.stringify(sent)
  );

  delete process.env.FUN_DISABLE_LIVE_LLM;
});
