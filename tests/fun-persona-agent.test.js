import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { DEFAULT_FUN_CONFIG } from '../fun/constants.js';
import { resolveFunConfig } from '../fun/config.js';
import { createFunEffectsRepository } from '../fun/db/funEffectsRepository.js';
import { createFunGroupRepository } from '../fun/db/funGroupRepository.js';
import { createFunMemoryRepository } from '../fun/db/funMemoryRepository.js';
import { createFunPersonaRepository } from '../fun/db/funPersonaRepository.js';
import { createChaosService } from '../fun/services/chaosService.js';
import { createLoreReconciliationService } from '../fun/services/loreReconciliationService.js';
import { createPersonaService } from '../fun/services/personaService.js';
import { createPersonaToolExecutor } from '../fun/services/personaToolExecutor.js';
import { parsePersonaEnvelope } from '../fun/services/personaToolProtocol.js';
import { createIdentityMap } from '../fun/utils/identity.js';

await initDb();

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

function uniqueJid(prefix = '5511') {
  return `${prefix}${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 90 + 10)}@s.whatsapp.net`;
}

test('persona agent: protocolo aceita só reply ou tool_call da allowlist', () => {
  assert.deepEqual(parsePersonaEnvelope('{"type":"reply","text":"oi"}').envelope, { type: 'reply', text: 'oi' });
  assert.equal(parsePersonaEnvelope('{"type":"tool_call","name":"start_russian","arguments":{}}').ok, true);
  assert.equal(parsePersonaEnvelope('<tool_call>start_russian</tool_call>').reason, 'invalid-json');
  assert.equal(parsePersonaEnvelope('{"type":"tool_call","name":"pay","arguments":{}}').reason, 'unknown-tool');
  assert.equal(parsePersonaEnvelope('{"type":"tool_call","name":"oracle","arguments":"oi"}').reason, 'invalid-arguments');
});

test('persona agent: configurações novas têm defaults e clamps seguros', () => {
  const cfg = resolveFunConfig({
    personaToolCooldownMs: 1,
    loreReconciliationCooldownMs: 999_999_999,
    loreReconciliationMaxCandidates: 999,
    loreReconciliationTimeoutMs: 1,
  });
  assert.equal(cfg.personaToolsEnabled, true);
  assert.equal(cfg.personaToolCooldownMs, 5_000);
  assert.equal(cfg.loreReconciliationCooldownMs, 24 * 60 * 60_000);
  assert.equal(cfg.loreReconciliationMaxCandidates, 100);
  assert.equal(cfg.loreReconciliationTimeoutMs, 5_000);
});

test('persona agent: roleta virtual não cria efeito persistente e humano continua jogando', async () => {
  const scope = uniqueGroup();
  const author = uniqueJid('5591');
  const effects = createFunEffectsRepository({ getDatabase: getDb });
  let randomCalls = 0;
  const chaos = createChaosService({
    repository: { getLeaderboard: () => [] },
    effectsRepository: effects,
    random: () => (++randomCalls === 1 ? 0.99 : 0),
  });
  const executor = createPersonaToolExecutor({ chaosService: chaos });
  const cfg = { ...DEFAULT_FUN_CONFIG, personaToolCooldownMs: 5_000, russianChambers: 6 };

  const opened = await executor.execute(
    { name: 'start_russian', arguments: {} },
    { scopeKey: scope, authorJid: author, text: 'bot bora resolver isso na roleta russa?', funConfig: cfg, now: 1_000_000 }
  );
  assert.equal(opened.ok, true);
  assert.match(opened.text, /Roleta russa/);
  assert.equal(effects.isXpBlocked(executor.VIRTUAL_RUSSIAN_ACTOR, scope, 1_001_000).blocked, false);

  const human = chaos.pullTrigger({ userJid: author, scopeKey: scope, funConfig: cfg, now: 1_003_000 });
  assert.equal(human.ok, true);
  assert.equal(human.died, true);
  assert.equal(effects.isXpBlocked(author, scope, 1_003_001).blocked, true);
});

test('persona agent: status do jornal apenas consulta e nunca publica', async () => {
  let published = 0;
  const executor = createPersonaToolExecutor({
    chaosService: createChaosService({ repository: { getLeaderboard: () => [] }, random: () => 0.99 }),
    newsService: { enabled: () => true, tryPublish: async () => { published += 1; } },
  });
  const result = await executor.execute(
    { name: 'group_status', arguments: {} },
    { scopeKey: uniqueGroup(), text: 'bot solta o jornal antes da hora', funConfig: DEFAULT_FUN_CONFIG }
  );
  assert.equal(result.ok, true);
  assert.match(result.text, /23:59/);
  assert.equal(published, 0);
});

test('persona agent: ações de caos respeitam o cooldown do comando existente', async () => {
  const chaos = createChaosService({ repository: { getLeaderboard: () => [] }, random: () => 0.99 });
  const executor = createPersonaToolExecutor({ chaosService: chaos });
  const scope = uniqueGroup();
  const author = uniqueJid();
  const cfg = { ...DEFAULT_FUN_CONFIG, personaToolCooldownMs: 5_000, chaosCooldownMs: 60_000 };
  const first = await executor.execute(
    { name: 'oracle', arguments: { question: 'vou ganhar?' } },
    { scopeKey: scope, authorJid: author, text: 'bot faz um oráculo pra mim?', funConfig: cfg, now: 1_000_000 }
  );
  const second = await executor.execute(
    { name: 'oracle', arguments: { question: 'vou ganhar?' } },
    { scopeKey: scope, authorJid: author, text: 'bot faz um oráculo pra mim?', funConfig: { ...cfg, personaToolCooldownMs: 5_000 }, now: 1_006_000 }
  );
  assert.equal(first.ok, true);
  assert.equal(second.reason, 'command-cooldown');
});

test('persona agent: tarot, ship e cancel reutilizam serviços seguros sem alterar economia', async () => {
  const scope = uniqueGroup();
  const author = uniqueJid('5593');
  const mentioned = uniqueJid('5594');
  const calls = [];
  const executor = createPersonaToolExecutor({
    chaosService: {
      checkCooldown: (kind) => ({ ok: true, kind }),
      cancelAbsurd: (label) => `${label} foi cancelado por usar meia molhada.`,
    },
    tarotService: {
      reading: async (input) => {
        calls.push(input);
        return { ok: true, question: input.question || '(leitura geral)', drawText: 'A Lua', reading: 'Observe os detalhes.' };
      },
    },
    relationshipService: {
      ship: (userA, userB) => ({ ok: true, userA, userB, percent: 88, label: 'Química forte' }),
    },
    getContactDisplayName: (jid) => (jid === author ? 'Ana' : 'Bia'),
  });
  const cfg = { ...DEFAULT_FUN_CONFIG, personaToolCooldownMs: 5_000 };

  const tarot = await executor.execute(
    { name: 'tarot', arguments: { question: 'qual é meu clima?' } },
    { scopeKey: scope, authorJid: author, text: 'bot faz uma tiragem de tarot?', funConfig: cfg, now: 1_000_000 }
  );
  assert.equal(tarot.ok, true);
  assert.match(tarot.text, /Tiragem/);
  assert.equal(calls[0].userJid, author);

  const ship = await executor.execute(
    { name: 'ship', arguments: { mode: 'author_and_mentioned' } },
    { scopeKey: scope, authorJid: author, mentionedJids: [mentioned], text: 'bot, faz um ship da gente', funConfig: cfg, now: 1_006_000 }
  );
  assert.equal(ship.ok, true);
  assert.match(ship.text, /88%/);
  assert.match(ship.text, /Ana × Bia/);

  const cancel = await executor.execute(
    { name: 'cancel', arguments: { target: 'mentioned' } },
    { scopeKey: scope, authorJid: author, mentionedJids: [mentioned], text: 'bot cancela ela aí', funConfig: cfg, now: 1_012_000 }
  );
  assert.equal(cancel.ok, true);
  assert.match(cancel.text, /Motivo 100% absurdo/);
});

test('persona agent: reação só usa ação SFW, alvo contextual e callback controlado', async () => {
  const scope = uniqueGroup();
  const author = uniqueJid('5595');
  const mentioned = uniqueJid('5596');
  const sent = [];
  const executor = createPersonaToolExecutor({
    chaosService: { checkCooldown: () => ({ ok: true }) },
    reactionMediaService: {
      getReaction: async (action) => ({ ok: true, action, url: 'https://media.example/hug.gif', mimeType: 'image/gif' }),
    },
    getContactDisplayName: () => 'Bia',
  });
  const cfg = { ...DEFAULT_FUN_CONFIG, personaToolCooldownMs: 5_000 };
  const result = await executor.execute(
    { name: 'reaction', arguments: { action: 'abraço', target: 'mentioned' } },
    {
      scopeKey: scope,
      authorJid: author,
      mentionedJids: [mentioned],
      text: 'bot manda um abraço pra ela',
      funConfig: cfg,
      now: 1_000_000,
      replyImageUrl: async (...args) => sent.push(args),
    }
  );
  assert.equal(result.ok, true);
  assert.equal(result.text, '');
  assert.match(result.summary, /SFW hug/);
  assert.deepEqual(sent[0], ['https://media.example/hug.gif', '*Eu* mandei hug para *Bia*.', 'image/gif']);

  const unsafe = await executor.execute(
    { name: 'reaction', arguments: { action: 'boquete', target: 'mentioned' } },
    { scopeKey: scope, authorJid: author, mentionedJids: [mentioned], text: 'bot manda uma reação', funConfig: cfg, now: 1_006_000 }
  );
  assert.equal(unsafe.ok, false);
  assert.equal(unsafe.reason, 'unsafe-action');
});

test('persona agent: tool_call recebe resultado e ganha fala final sem executar duas vezes', async () => {
  const previous = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    const personaRepository = createFunPersonaRepository({ getDatabase: getDb });
    const groupRepository = createFunGroupRepository({ getDatabase: getDb });
    const chaos = createChaosService({ repository: { getLeaderboard: () => [] }, random: () => 0.99 });
    const executor = createPersonaToolExecutor({ chaosService: chaos });
    const calls = [];
    const persona = createPersonaService({
      personaRepository,
      groupRepository,
      personaToolExecutor: executor,
      generateZen: async () => {
        calls.push(1);
        return calls.length === 1
          ? '{"type":"tool_call","name":"oracle","arguments":{"question":"vou vencer?"}}'
          : '{"type":"reply","text":"o universo falou, agora aguenta."}';
      },
    });
    const scope = uniqueGroup();
    const bot = uniqueJid('5599');
    let sent = '';
    const result = await persona.tryRespond({
      scopeKey: scope,
      text: 'bot, faz um oráculo pra mim?',
      authorJid: uniqueJid(),
      messageType: 'text',
      sock: { user: { id: `${bot.split('@')[0]}:0` }, sendMessage: async (_jid, payload) => { sent = payload.text; return { key: { id: 'agent-tool-1' } }; } },
      identityMap: createIdentityMap(),
      funConfig: { ...DEFAULT_FUN_CONFIG, worldQuietHoursEnabled: false, personaToolCooldownMs: 5_000 },
      now: 2_000_000,
    });
    assert.equal(result.responded, true);
    assert.equal(calls.length, 2);
    assert.match(sent, /Oráculo maluco/);
    assert.match(sent, /universo falou/);
  } finally {
    if (previous === undefined) process.env.FUN_DISABLE_LIVE_LLM = '1';
    else process.env.FUN_DISABLE_LIVE_LLM = previous;
  }
});

test('persona agent: reação envia mídia antes da fala final, sem dar socket ao modelo', async () => {
  const previous = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    const personaRepository = createFunPersonaRepository({ getDatabase: getDb });
    const groupRepository = createFunGroupRepository({ getDatabase: getDb });
    const executor = createPersonaToolExecutor({
      chaosService: { checkCooldown: () => ({ ok: true }) },
      reactionMediaService: {
        getReaction: async () => ({ ok: true, url: 'https://media.example/kiss.gif', mimeType: 'image/gif' }),
      },
    });
    const calls = [];
    const sent = [];
    const bot = uniqueJid('5598');
    const persona = createPersonaService({
      personaRepository,
      groupRepository,
      personaToolExecutor: executor,
      generateZen: async () => {
        calls.push(1);
        return calls.length === 1
          ? '{"type":"tool_call","name":"reaction","arguments":{"action":"kiss","target":"author"}}'
          : '{"type":"reply","text":"pronto, o beijo foi entregue sem burocracia 😌"}';
      },
    });
    const result = await persona.tryRespond({
      scopeKey: uniqueGroup(),
      text: 'bot manda um beijo pra mim',
      authorJid: uniqueJid(),
      messageType: 'text',
      sock: {
        user: { id: `${bot.split('@')[0]}:0` },
        sendMessage: async (_jid, payload) => {
          sent.push(payload);
          return { key: { id: `agent-reaction-${sent.length}` } };
        },
      },
      identityMap: createIdentityMap(),
      funConfig: { ...DEFAULT_FUN_CONFIG, worldQuietHoursEnabled: false, personaToolCooldownMs: 5_000 },
      now: 2_100_000,
    });
    assert.equal(result.responded, true);
    assert.equal(calls.length, 2);
    assert.deepEqual(sent[0].image, { url: 'https://media.example/kiss.gif' });
    assert.match(sent[1].text, /beijo foi entregue/);
  } finally {
    if (previous === undefined) process.env.FUN_DISABLE_LIVE_LLM = '1';
    else process.env.FUN_DISABLE_LIVE_LLM = previous;
  }
});

test('lore reconciliation: remove só ID indicado do mesmo grupo e regenera persona', async () => {
  const previous = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    const memory = createFunMemoryRepository({ getDatabase: getDb });
    const scope = uniqueGroup();
    const otherScope = uniqueGroup();
    const stale = memory.insertFact({ scopeKey: scope, summary: 'Rafa sempre perde o ônibus', subjects: [uniqueJid()], now: 3_000_000 });
    const other = memory.insertFact({ scopeKey: otherScope, summary: 'Fato de outro grupo', subjects: [uniqueJid()], now: 3_000_000 });
    let refreshes = 0;
    const service = createLoreReconciliationService({
      memoryRepository: memory,
      groupMemoryService: { refreshPersona: async () => { refreshes += 1; } },
      generateZen: async () => JSON.stringify({ removals: [{ factId: stale.id, reason: 'membro disse que isso ficou antigo' }, { factId: other.id, reason: 'tentativa cross-scope' }] }),
    });
    const result = await service.observe({
      scopeKey: scope,
      text: 'bot, esquece esse fato do ônibus, isso já está antigo',
      funConfig: { ...DEFAULT_FUN_CONFIG, loreReconciliationCooldownMs: 5_000 },
      now: 3_001_000,
    });
    assert.equal(result.ok, true);
    assert.equal(result.removed, 1);
    assert.equal(memory.getFact(stale.id), null);
    assert.ok(memory.getFact(other.id));
    assert.equal(refreshes, 1);
  } finally {
    if (previous === undefined) process.env.FUN_DISABLE_LIVE_LLM = '1';
    else process.env.FUN_DISABLE_LIVE_LLM = previous;
  }
});

test('lore reconciliation: JSON inválido ou ambíguo não remove nada', async () => {
  const previous = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    const memory = createFunMemoryRepository({ getDatabase: getDb });
    const scope = uniqueGroup();
    const fact = memory.insertFact({ scopeKey: scope, summary: 'Nina coleciona DVDs antigos', subjects: [uniqueJid()] });
    const service = createLoreReconciliationService({ memoryRepository: memory, generateZen: async () => '{not json' });
    const result = await service.observe({
      scopeKey: scope,
      text: 'isso está errado, esquece',
      funConfig: { ...DEFAULT_FUN_CONFIG, loreReconciliationCooldownMs: 5_000 },
      now: 4_000_000,
    });
    assert.equal(result.ok, true);
    assert.equal(result.removed, 0);
    assert.ok(memory.getFact(fact.id));
  } finally {
    if (previous === undefined) process.env.FUN_DISABLE_LIVE_LLM = '1';
    else process.env.FUN_DISABLE_LIVE_LLM = previous;
  }
});

// ── send_sticker ──────────────────────────────────────────────────────────────

import { STICKER_SLUGS, resolveStickerPath } from '../fun/services/personaStickerCatalog.js';

test('send_sticker: protocolo aceita send_sticker na allowlist', () => {
  const result = parsePersonaEnvelope('{"type":"tool_call","name":"send_sticker","arguments":{"slug":"joinha"}}');
  assert.equal(result.ok, true);
  assert.equal(result.envelope.name, 'send_sticker');
  assert.equal(result.envelope.arguments.slug, 'joinha');
});

test('send_sticker: rejeita slug inválido', async () => {
  const chaos = createChaosService({ repository: { getLeaderboard: () => [] } });
  const executor = createPersonaToolExecutor({ chaosService: chaos });
  const scope = uniqueGroup();
  const stickersSent = [];
  const ctx = {
    scopeKey: scope,
    authorJid: uniqueJid(),
    text: 'bot manda uma figurinha',
    funConfig: { ...DEFAULT_FUN_CONFIG },
    now: Date.now(),
    replySticker: async (buf) => stickersSent.push(buf),
  };
  const result = await executor.execute({ name: 'send_sticker', arguments: { slug: 'slug_inventado' } }, ctx);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid-slug');
  assert.equal(stickersSent.length, 0);
});

test('send_sticker: catálogo resolve arquivo para slugs conhecidos (existsSync)', () => {
  // Verifica que pelo menos os slugs presentes na pasta real resolvem para um caminho
  const resolvable = STICKER_SLUGS.filter((slug) => resolveStickerPath(slug) !== null);
  assert.ok(resolvable.length > 0, 'Deve haver ao menos um slug resolvível no disco');
});

test('send_sticker: replySticker é chamado e tool retorna ok', async () => {
  // Encontra o primeiro slug disponível no disco para testar o caminho feliz
  const slug = STICKER_SLUGS.find((s) => resolveStickerPath(s) !== null);
  if (!slug) {
    // Sem arquivos no disco (ex: CI sem assets) — testa só a guarda de unavailable
    const chaos = createChaosService({ repository: { getLeaderboard: () => [] } });
    const executor = createPersonaToolExecutor({ chaosService: chaos });
    const result = await executor.execute(
      { name: 'send_sticker', arguments: { slug: 'joinha' } },
      { scopeKey: uniqueGroup(), authorJid: uniqueJid(), text: 'oi', funConfig: DEFAULT_FUN_CONFIG, now: Date.now() }
    );
    // Sem replySticker → unavailable ou file-not-found
    assert.ok(['unavailable', 'file-not-found'].includes(result.reason));
    return;
  }

  const chaos = createChaosService({ repository: { getLeaderboard: () => [] } });
  const executor = createPersonaToolExecutor({ chaosService: chaos });
  const scope = uniqueGroup();
  const stickersSent = [];

  const result = await executor.execute(
    { name: 'send_sticker', arguments: { slug } },
    {
      scopeKey: scope,
      authorJid: uniqueJid(),
      text: 'manda figurinha bot',
      funConfig: { ...DEFAULT_FUN_CONFIG },
      now: Date.now(),
      replySticker: async (buf) => { stickersSent.push(buf); },
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.slug, slug);
  assert.equal(stickersSent.length, 1);
  assert.ok(Buffer.isBuffer(stickersSent[0]) && stickersSent[0].length > 0);
});

// ── Multi-Action / Multi-Bubble Protocol & Dispatch ────────────────────────────

test('multi-action: parsePersonaEnvelope aceita sequência multi-ação (texto + sticker + react)', () => {
  const payload = JSON.stringify({
    type: 'actions',
    actions: [
      { type: 'text', text: 'Aee parabéns mano! 🎉' },
      { type: 'sticker', slug: 'parabens' },
      { type: 'react', emoji: '🎂' },
      { type: 'text', text: 'Bora comemorar' },
    ],
  });
  const parsed = parsePersonaEnvelope(payload);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.envelope.type, 'actions');
  assert.equal(parsed.envelope.actions.length, 4);
  assert.equal(parsed.envelope.actions[0].type, 'text');
  assert.equal(parsed.envelope.actions[1].slug, 'parabens');
  assert.equal(parsed.envelope.actions[2].emoji, '🎂');
});

test('multi-action: despacha múltiplos balões e sticker com sock.sendMessage', async () => {
  const memory = createFunMemoryRepository({ getDatabase: getDb });
  const groups = createFunGroupRepository({ getDatabase: getDb });
  const persona = createFunPersonaRepository({ getDatabase: getDb });
  const scope = uniqueGroup();
  const messagesSent = [];

  const previous = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;

  try {
    const botJid = uniqueJid('5588');
    const authorJid = uniqueJid('5511');
    const mockSock = {
      user: { id: `${botJid.split('@')[0]}:0` },
      sendMessage: async (jid, content, opts) => {
        messagesSent.push({ jid, content, opts });
        return { key: { id: `msg_${messagesSent.length}` } };
      },
    };

    const service = createPersonaService({
      personaRepository: persona,
      groupRepository: groups,
      personaToolExecutor: { execute: async () => ({ ok: true }) },
      generateZen: async () => JSON.stringify({
        type: 'actions',
        actions: [
          { type: 'text', text: 'Aeeeee parabéns! 🎉' },
          { type: 'sticker', slug: 'parabens' },
          { type: 'text', text: 'Felicidades!' },
        ],
      }),
    });

    const res = await service.tryRespond({
      scopeKey: scope,
      authorJid,
      text: 'bot hoje é meu aniversario',
      messageType: 'text',
      sock: mockSock,
      identityMap: createIdentityMap(),
      now: Date.now(),
    });

    assert.equal(res.responded, true);
    assert.match(res.response, /Aeeeee parabéns/);
    assert.equal(messagesSent.length, 3);
    assert.equal(messagesSent[0].content.text, 'Aeeeee parabéns! 🎉');
    assert.ok(messagesSent[1].content.sticker);
    assert.equal(messagesSent[2].content.text, 'Felicidades!');
  } finally {
    if (previous === undefined) process.env.FUN_DISABLE_LIVE_LLM = '1';
    else process.env.FUN_DISABLE_LIVE_LLM = previous;
  }
});

test('multi-action: reply ao segundo ou terceiro balão continua a thread da persona', async () => {
  const previous = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;

  try {
    for (const targetBubble of [2, 3]) {
      const groups = createFunGroupRepository({ getDatabase: getDb });
      const persona = createFunPersonaRepository({ getDatabase: getDb });
      const scope = uniqueGroup();
      const botJid = uniqueJid('5588');
      const authorJid = uniqueJid('5511');
      let sentCount = 0;
      const mockSock = {
        user: { id: `${botJid.split('@')[0]}:0` },
        sendMessage: async () => ({ key: { id: `persona-bubble-${++sentCount}` } }),
      };

      const service = createPersonaService({
        personaRepository: persona,
        groupRepository: groups,
        personaToolExecutor: { execute: async () => ({ ok: true }) },
        generateZen: async () => JSON.stringify({
          type: 'actions',
          actions: [
            { type: 'text', text: 'primeiro balão' },
            { type: 'text', text: 'segundo balão' },
            { type: 'text', text: 'terceiro balão' },
          ],
        }),
      });

      const first = await service.tryRespond({
        scopeKey: scope,
        authorJid,
        text: 'bot manda três mensagens',
        messageType: 'text',
        sock: mockSock,
        identityMap: createIdentityMap(),
        now: 7_000_000 + targetBubble,
      });
      assert.equal(first.responded, true);

      const thread = persona.getActiveThread(scope, { now: 7_000_000 + targetBubble });
      assert.deepEqual(thread.anchorMessageIds, [
        'persona-bubble-1',
        'persona-bubble-2',
        'persona-bubble-3',
      ]);

      const reply = await service.tryRespond({
        scopeKey: scope,
        authorJid,
        text: `respondendo ao balão ${targetBubble}`,
        quotedParticipant: botJid,
        quotedMessageId: `persona-bubble-${targetBubble}`,
        messageType: 'extended-text',
        sock: mockSock,
        identityMap: createIdentityMap(),
        now: 7_000_100 + targetBubble,
      });

      assert.equal(reply.responded, true, `reply ao balão ${targetBubble} deve continuar a persona`);
      assert.equal(persona.getActiveThread(scope, { now: 7_000_100 + targetBubble }).turnCount, 1);
    }
  } finally {
    if (previous === undefined) process.env.FUN_DISABLE_LIVE_LLM = '1';
    else process.env.FUN_DISABLE_LIVE_LLM = previous;
  }
});

test('multi-action: envelope de ação única {"type":"sticker","slug":"entendi_nada"} envia sticker sem vazar JSON cru', async () => {
  const groups = createFunGroupRepository({ getDatabase: getDb });
  const persona = createFunPersonaRepository({ getDatabase: getDb });
  const scope = uniqueGroup();
  const messagesSent = [];

  const previous = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;

  try {
    const botJid = uniqueJid('5588');
    const authorJid = uniqueJid('5511');
    const mockSock = {
      user: { id: `${botJid.split('@')[0]}:0` },
      sendMessage: async (jid, content, opts) => {
        messagesSent.push({ jid, content, opts });
        return { key: { id: `msg_${messagesSent.length}` } };
      },
    };

    const service = createPersonaService({
      personaRepository: persona,
      groupRepository: groups,
      personaToolExecutor: { execute: async () => ({ ok: true }) },
      generateZen: async () => '{"type":"sticker","slug":"entendi_nada"}',
    });

    const res = await service.tryRespond({
      scopeKey: scope,
      authorJid,
      text: 'bot qual figurinha combina com isso?',
      messageType: 'text',
      sock: mockSock,
      identityMap: createIdentityMap(),
      now: Date.now(),
    });

    assert.equal(res.responded, true);
    assert.equal(messagesSent.length, 1);
    assert.ok(messagesSent[0].content.sticker, 'Deve enviar um sticker');
    assert.doesNotMatch(String(messagesSent[0].content.text || ''), /"type":"sticker"/, 'Não pode vazar JSON cru');
  } finally {
    if (previous === undefined) process.env.FUN_DISABLE_LIVE_LLM = '1';
    else process.env.FUN_DISABLE_LIVE_LLM = previous;
  }
});

test('anti-raw-json: JSON inválido ou desconhecido nunca vaza como texto no chat', async () => {
  const groups = createFunGroupRepository({ getDatabase: getDb });
  const persona = createFunPersonaRepository({ getDatabase: getDb });
  const scope = uniqueGroup();
  const messagesSent = [];

  const previous = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;

  try {
    const botJid = uniqueJid('5588');
    const authorJid = uniqueJid('5511');
    const mockSock = {
      user: { id: `${botJid.split('@')[0]}:0` },
      sendMessage: async (jid, content, opts) => {
        messagesSent.push({ jid, content, opts });
        return { key: { id: `msg_${messagesSent.length}` } };
      },
    };

    const service = createPersonaService({
      personaRepository: persona,
      groupRepository: groups,
      personaToolExecutor: { execute: async () => ({ ok: true }) },
      generateZen: async () => '{"corrupted_json_action": 123}',
    });

    const res = await service.tryRespond({
      scopeKey: scope,
      authorJid,
      text: 'bot?',
      messageType: 'text',
      sock: mockSock,
      identityMap: createIdentityMap(),
      now: Date.now(),
    });

    assert.equal(res.responded, true);
    assert.equal(res.usedFallback, true, 'Deve usar fallback natural em vez de vazar JSON');
    assert.doesNotMatch(messagesSent[0].content.text, /\{.*\}/, 'Mensagem enviada não pode ser JSON');
  } finally {
    if (previous === undefined) process.env.FUN_DISABLE_LIVE_LLM = '1';
    else process.env.FUN_DISABLE_LIVE_LLM = previous;
  }
});
