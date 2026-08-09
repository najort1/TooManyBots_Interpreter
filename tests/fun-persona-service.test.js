/**
 * Persona (Bot Membro Vivo) — testes unitários de detecção/guardas, threads
 * e janela/perfil. Determinístico: FUN_DISABLE_LIVE_LLM=1 + banco SQLite
 * temporário via initDb.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.FUN_DISABLE_LIVE_LLM = '1';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createFunPersonaRepository } from '../fun/db/funPersonaRepository.js';
import { createFunGroupRepository } from '../fun/db/funGroupRepository.js';
import { createPersonaService } from '../fun/services/personaService.js';
import { createIdentityMap, loadGroupIdentity } from '../fun/utils/identity.js';
import { DEFAULT_FUN_CONFIG } from '../fun/constants.js';

await initDb();

const baseConfig = { ...DEFAULT_FUN_CONFIG, worldQuietHoursEnabled: false };

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

function uniqueJid(prefix = '5511') {
  return `${prefix}${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 90 + 10)}@s.whatsapp.net`;
}

function makeSock(botJid) {
  const botLocal = String(botJid || '').split('@')[0];
  return { user: { id: `${botLocal}:0` } };
}

function setup(cfg = baseConfig, botJid, threadContextService = null, deps = {}) {
  const personaRepository = createFunPersonaRepository({ getDatabase: getDb });
  const groupRepository = createFunGroupRepository({ getDatabase: getDb });
  const botJ = botJid || uniqueJid('5599');
  const sock = makeSock(botJ);
  const identityMap = createIdentityMap();
  const svc = createPersonaService({
    personaRepository,
    groupRepository,
    threadContextService,
    personaSocialHintService: deps.personaSocialHintService,
    profileService: deps.profileService,
    generateZen: deps.generateZen,
    getLogger: () => null,
    random: () => 0.5,
  });
  return { svc, personaRepository, groupRepository, sock, botJ, identityMap, cfg };
}

// ============================================================
// US1: Detecção de menção + guardas
// ============================================================

test('detectTrigger: "bot" como palavra inteira, não "botão"/"robô"/"botox"/"bota"', () => {
  const { svc } = setup();
  assert.equal(svc.detectTrigger({ text: 'bot, o que acha?', mentionedJids: [] }).mention, true);
  assert.equal(svc.detectTrigger({ text: 'BOT em maiusculo', mentionedJids: [] }).mention, true);
  assert.equal(svc.detectTrigger({ text: 'essa é a botão mais forte', mentionedJids: [] }).mention, false);
  assert.equal(svc.detectTrigger({ text: 'vi um robô', mentionedJids: [] }).mention, false);
  assert.equal(svc.detectTrigger({ text: 'botox no rosto', mentionedJids: [] }).mention, false);
  assert.equal(svc.detectTrigger({ text: 'bota isso ali', mentionedJids: [] }).mention, false);
});

test('detectTrigger: aceita apenas vocativos inequívocos e rejeita referências a bot', () => {
  const { svc } = setup();
  for (const text of ['bot?', 'bot, me ajuda', 'bot me ajuda', 'ei bot, tudo bem']) {
    assert.equal(svc.detectTrigger({ text }).mention, true, text);
  }
  for (const text of ['esse bot travou', 'o bot respondeu', 'um bot faz isso', 'todo streamer usa bot', 'botão quebrado']) {
    assert.equal(svc.detectTrigger({ text }).mention, false, text);
  }
});

test('loadGroupIdentity resolve LID de bot para @mention e reply', async () => {
  const { svc, botJ, identityMap } = setup();
  const botLid = '999999999999999@lid';
  const sock = {
    groupMetadata: async () => ({ participants: [{ id: botJ, lid: botLid }] }),
  };

  assert.equal(identityMap.resolve(botLid), '');
  await loadGroupIdentity(sock, uniqueGroup(), identityMap);
  assert.equal(identityMap.resolve(botLid), botJ);
  assert.equal(svc.detectTrigger({ text: 'oi', mentionedJids: [botLid], botJid: botJ, identityMap }).atMention, true);
  assert.equal(identityMap.resolve(botLid), botJ, 'reply quoted usa a mesma resolução canônica');
});

test('detectTrigger: @marcação via identityMap (LID→SID)', () => {
  const { svc, botJ, identityMap } = setup();
  const lidJid = '999999999999999@s.whatsapp.net';
  identityMap.remember(lidJid, botJ);
  const r = svc.detectTrigger({ text: 'eai', mentionedJids: [lidJid], botJid: botJ, identityMap });
  assert.equal(r.atMention, true);

  const r2 = svc.detectTrigger({ text: 'eai', mentionedJids: ['111@s.whatsapp.net'], botJid: botJ, identityMap });
  assert.equal(r2.atMention, false);
});

test('tryRespond: feature desligada no grupo → silencia', async () => {
  const { svc, sock, identityMap, groupRepository, cfg } = setup();
  const scope = uniqueGroup();
  groupRepository.upsertGroupSettings({ groupJid: scope, personaEnabled: false });
  const r = await svc.tryRespond({
    scopeKey: scope, text: 'bot?', mentionedJids: [], authorJid: uniqueJid(),
    sock, identityMap, groupSettings: { personaEnabled: false }, funConfig: cfg,
  });
  assert.equal(r.responded, false);
  assert.equal(r.reason, 'disabled-group');
});

test('tryRespond: feature desligada globalmente → silencia', async () => {
  const { svc, sock, identityMap } = setup({ ...baseConfig, personaEnabled: false });
  const scope = uniqueGroup();
  const r = await svc.tryRespond({
    scopeKey: scope, text: 'bot?', mentionedJids: [], authorJid: uniqueJid(),
    sock, identityMap, funConfig: { ...baseConfig, personaEnabled: false },
  });
  assert.equal(r.responded, false);
  assert.equal(r.reason, 'disabled-global');
});

test('tryRespond: anti self-loop (autor = bot)', async () => {
  const { svc, sock, botJ, identityMap, cfg } = setup();
  const scope = uniqueGroup();
  const r = await svc.tryRespond({
    scopeKey: scope, text: 'bot?', mentionedJids: [], authorJid: botJ,
    sock, identityMap, funConfig: cfg,
  });
  assert.equal(r.responded, false);
  assert.equal(r.reason, 'self-loop');
});

test('REGRESSAO persona: menção ao LID próprio responde sem identityMap', async () => {
  const { svc, sock, botJ, identityMap, cfg } = setup();
  const botLid = '999999999999999@lid';
  sock.user.lid = botLid;
  sock.user.pn = botJ;
  sock.sendMessage = async () => {};

  const r = await svc.tryRespond({
    scopeKey: uniqueGroup(), text: 'me responde', mentionedJids: [botLid],
    authorJid: uniqueJid(), sock, identityMap, funConfig: cfg, now: 1_000_000,
  });

  assert.equal(identityMap.resolve(botLid), '');
  assert.equal(r.responded, true);
});

test('REGRESSAO persona: reply LID próprio continua thread sem identityMap', async () => {
  const { svc, sock, botJ, identityMap, cfg, personaRepository } = setup();
  const botLid = '999999999999999@lid';
  const scope = uniqueGroup();
  const now = 2_000_000;
  sock.user.lid = botLid;
  sock.user.pn = botJ;
  sock.sendMessage = async () => {};

  const initial = await svc.tryRespond({
    scopeKey: scope, text: 'bot eai', authorJid: uniqueJid(),
    sock, identityMap, funConfig: cfg, now,
  });
  const reply = await svc.tryRespond({
    scopeKey: scope, text: 'kkkk concordo', quotedParticipant: botLid,
    messageType: 'extended-text', authorJid: uniqueJid(), sock, identityMap,
    funConfig: cfg, now: now + 1,
  });

  assert.equal(identityMap.resolve(botLid), '');
  assert.equal(initial.responded, true);
  assert.equal(reply.responded, true);
  assert.equal(personaRepository.getActiveThread(scope, { now: now + 1 }).turnCount, 1);
});

test('REGRESSAO persona: auto mensagem pelo LID próprio não responde', async () => {
  const { svc, sock, botJ, identityMap, cfg } = setup();
  const botLid = '999999999999999@lid';
  sock.user.lid = botLid;
  sock.user.pn = botJ;
  sock.sendMessage = async () => {};

  const r = await svc.tryRespond({
    scopeKey: uniqueGroup(), text: 'bot?', authorJid: botLid,
    sock, identityMap, funConfig: cfg,
  });

  assert.equal(r.responded, false);
  assert.equal(r.reason, 'self-loop');
});

test('REGRESSAO persona: @menção real em extended-text responde com texto neutro', async () => {
  const { svc, sock, botJ, identityMap, cfg } = setup();
  const scope = uniqueGroup();
  sock.sendMessage = async () => {};

  const mention = await svc.tryRespond({
    scopeKey: scope, text: 'me responde', mentionedJids: [botJ], messageType: 'extended-text', authorJid: uniqueJid(),
    sock, identityMap, funConfig: cfg, now: 1_000_000,
  });

  assert.equal(mention.responded, true);
});

test('REGRESSAO persona: reply extended-text ao bot continua thread e incrementa turnCount', async () => {
  const { svc, sock, botJ, identityMap, cfg, personaRepository } = setup();
  const scope = uniqueGroup();
  const now = 2_000_000;
  sock.sendMessage = async () => {};

  const initial = await svc.tryRespond({
    scopeKey: scope, text: 'bot eai', mentionedJids: [], authorJid: uniqueJid(),
    sock, identityMap, funConfig: cfg, now,
  });
  const reply = await svc.tryRespond({
    scopeKey: scope, text: 'kkkk concordo', quotedParticipant: botJ, messageType: 'extended-text', authorJid: uniqueJid(),
    sock, identityMap, funConfig: cfg, now: now + 1,
  });

  assert.equal(initial.responded, true);
  assert.equal(reply.responded, true);
  assert.equal(personaRepository.getActiveThread(scope, { now: now + 1 }).turnCount, 1);
});

test('REGRESSAO Spec 002: ancora a resposta da persona pelo ID retornado pelo socket', async () => {
  const anchors = [];
  const threadContextService = { anchorResponse: (input) => anchors.push(input) };
  const { svc, sock, identityMap, cfg } = setup(baseConfig, undefined, threadContextService);
  const scope = uniqueGroup();
  sock.sendMessage = async () => ({ key: { id: 'bot-response-001' } });

  const result = await svc.tryRespond({
    scopeKey: scope,
    text: 'bot, fala de cinema',
    authorJid: uniqueJid(),
    sock,
    identityMap,
    funConfig: cfg,
    now: 4_000_000,
    responseContextPack: { threadContext: { threadKey: 'cinema' } },
  });

  assert.equal(result.responded, true);
  assert.deepEqual(anchors, [{ scopeKey: scope, threadKey: 'cinema', anchorMessageId: 'bot-response-001', now: 4_000_000 }]);
});

test('tryRespond: sem cooldown por padrão — chamadas vocativas seguidas respondem', async () => {
  const scope = uniqueGroup();
  const { svc, sock, identityMap, cfg } = setup();
  const now = 3_000_000;
  sock.sendMessage = async () => {};
  const r1 = await svc.tryRespond({
    scopeKey: scope, text: 'bot eai', mentionedJids: [], authorJid: uniqueJid(),
    sock, identityMap, funConfig: cfg, now,
  });
  const r2 = await svc.tryRespond({
    scopeKey: scope, text: 'bot de novo', mentionedJids: [], authorJid: uniqueJid(),
    sock, identityMap, funConfig: cfg, now: now + 1,
  });

  assert.equal(r1.responded, true);
  assert.equal(r2.responded, true, 'cooldown desabilitado por padrão (personaCooldownMs=0)');
});

test('tryRespond: cooldown configurado (> 0) ainda bloqueia chamadas seguidas', async () => {
  const scope = uniqueGroup();
  const { svc, sock, identityMap, cfg } = setup();
  const now = 3_000_000;
  sock.sendMessage = async () => {};
  const withCooldown = { ...cfg, personaCooldownMs: 60_000 };
  const r1 = await svc.tryRespond({
    scopeKey: scope, text: 'bot eai', mentionedJids: [], authorJid: uniqueJid(),
    sock, identityMap, funConfig: withCooldown, now,
  });
  const r2 = await svc.tryRespond({
    scopeKey: scope, text: 'bot de novo', mentionedJids: [], authorJid: uniqueJid(),
    sock, identityMap, funConfig: withCooldown, now: now + 1,
  });

  assert.equal(r1.responded, true);
  assert.equal(r2.responded, false);
  assert.equal(r2.reason, 'cooldown');
});

test('tryRespond: responde mesmo durante quiet hours (persona não dorme)', async () => {
  const { svc, sock, identityMap } = setup({
    ...baseConfig,
    worldQuietHoursEnabled: true,
    worldQuietHourStart: 1,
    worldQuietHourEnd: 6,
  });
  const scope = uniqueGroup();
  sock.sendMessage = async () => {};
  const now = new Date('2026-08-02T02:30:00-03:00').getTime();
  const r = await svc.tryRespond({
    scopeKey: scope, text: 'bot?', mentionedJids: [], authorJid: uniqueJid(),
    sock, identityMap, funConfig: {
      ...baseConfig, worldQuietHoursEnabled: true, worldQuietHourStart: 1, worldQuietHourEnd: 6,
    }, now,
  });
  assert.equal(r.responded, true, 'persona deve responder mesmo durante quiet hours');
});

test('tryRespond: fallback sem LLM (FUN_DISABLE_LIVE_LLM=1)', async () => {
  const { svc, sock, identityMap, cfg } = setup();
  const scope = uniqueGroup();
  sock.sendMessage = async () => {};
  const r = await svc.tryRespond({
    scopeKey: scope, text: 'bot, conta uma piada', mentionedJids: [], authorJid: uniqueJid(),
    sock, identityMap, funConfig: cfg,
  });
  assert.equal(r.responded, true);
  assert.equal(r.usedFallback, true);
  assert.ok(r.response.length > 0);
});

test('persona: prompt recebe autor, reply, identidade e pistas de contexto', async () => {
  const previous = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    let request = null;
    const authorJid = uniqueJid('5512');
    const profileService = {
      displayName: () => 'Nina',
      buildIdentityBlock: () => '<user_identity>\n- Nina: cinéfila · título: Crítica\n</user_identity>',
    };
    const { svc, sock, identityMap, cfg } = setup(baseConfig, undefined, null, {
      profileService,
      generateZen: async (input) => {
        request = input;
        return 'Nina, esse filme é tua cara. Vai sem medo kkk.';
      },
    });
    sock.sendMessage = async () => ({ key: { id: 'persona-ctx-1' } });

    const response = await svc.tryRespond({
      scopeKey: uniqueGroup(),
      text: 'bot, esse filme presta?',
      quotedText: 'o filme antigo é melhor',
      authorJid,
      sock,
      identityMap,
      funConfig: cfg,
      now: 9_000_000,
      responseContextPack: {
        groupIdentity: { groupLoreSummary: 'Nina sempre puxa discussão de cinema.' },
        confirmedFacts: [{ factText: 'Nina coleciona DVDs antigos.' }],
        inferredSignals: [{ factText: 'Nina prefere terror.', riskFlags: [] }],
        socialSignals: [{ factText: 'Nina entra na zoeira sobre filme.', riskFlags: [] }],
        riskFlags: [],
      },
    });

    assert.equal(response.responded, true);
    assert.equal(response.usedFallback, false);
    assert.equal(request.prompt, '[Nina]: bot, esse filme presta?\n\nEm resposta a: "o filme antigo é melhor"');
    assert.match(request.system, /<user_identity>/);
    assert.match(request.system, /Nina sempre puxa discussão de cinema/);
    assert.match(request.system, /Nina prefere terror/);
    assert.match(request.system, /Nina entra na zoeira sobre filme/);
    assert.equal(request.maxTokens, 360);
  } finally {
    if (previous === undefined) process.env.FUN_DISABLE_LIVE_LLM = '1';
    else process.env.FUN_DISABLE_LIVE_LLM = previous;
  }
});

test('REGRESSAO persona: turno do membro na thread guarda o nome e o prompt mostra o interlecutor real', async () => {
  const previous = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    let request = null;
    const authorJid = uniqueJid('5513');
    const profileService = {
      displayName: () => 'Nina',
      buildIdentityBlock: () => '',
    };
    const { svc, sock, identityMap, cfg, personaRepository, botJ } = setup(baseConfig, undefined, null, {
      profileService,
      generateZen: async (input) => {
        request = input;
        return 'Nina, a investigação te pegou kkk';
      },
    });
    sock.sendMessage = async () => ({ key: { id: 'persona-name-1' } });
    const scope = uniqueGroup();

    // 1ª chamada abre thread — turno do membro deve guardar name:'Nina'
    await svc.tryRespond({
      scopeKey: scope,
      text: 'bot, a investigação tá avançando',
      authorJid,
      sock,
      identityMap,
      funConfig: cfg,
      now: 9_300_000,
    });
    const thread1 = personaRepository.getActiveThread(scope, { now: 9_300_000 });
    const memberRows = thread1?.context.filter((c) => c.role === 'membro');
    assert.ok(memberRows.length >= 1, 'thread deve ter turno do membro');
    assert.equal(memberRows[0].name, 'Nina', 'turno deve reter o nome resolvido do autor');

    // 2ª chamada (reply ao bot = continuação) carrega a thread persistida →
    // a 2ª geração deve mostrar o interlocutor pelo nome, não "membro".
    request = null;
    await svc.tryRespond({
      scopeKey: scope,
      text: 'kkkk concordo, bot',
      authorJid,
      quotedParticipant: botJ,
      sock,
      identityMap,
      funConfig: cfg,
      now: 9_400_000,
    });
    assert.ok(request, '2ª geração deve ter sido chamada (continuação)');
    assert.ok(request.system.includes('- Nina:'), 'system deve mostrar o nome do interlocutor, não "membro"');
    assert.ok(!request.system.includes('- membro:'), 'sem rótulo genérico "membro" nas trocas');
  } finally {
    if (previous === undefined) process.env.FUN_DISABLE_LIVE_LLM = '1';
    else process.env.FUN_DISABLE_LIVE_LLM = previous;
  }
});

test('persona: envia hints positivos, neutros e negativos elegíveis, 10 por tipo e em ordem de confiança', async () => {
  const previous = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    let request = null;
    const scope = uniqueGroup();
    const hints = [
      ...Array.from({ length: 12 }, (_, i) => ({
        hintText: `positive-${i}`,
        confidence: 100 - i,
        socialSignal: 'positive',
        updatedAt: i,
      })),
      ...Array.from({ length: 12 }, (_, i) => ({
        hintText: `neutral-${i}`,
        confidence: 90 - i,
        socialSignal: 'neutral',
        updatedAt: i,
      })),
      ...Array.from({ length: 12 }, (_, i) => ({
        hintText: `negative-${i}`,
        confidence: 80 - i,
        socialSignal: 'negative',
        updatedAt: i,
      })),
      { hintText: 'low-confidence', confidence: 44, socialSignal: 'negative', updatedAt: 999 },
    ];
    const { svc, sock, identityMap, cfg } = setup(baseConfig, undefined, null, {
      personaSocialHintService: { getHints: () => hints },
      generateZen: async (input) => {
        request = input;
        return 'resposta com contexto social';
      },
    });
    sock.sendMessage = async () => ({ key: { id: 'persona-social-hints-1' } });

    const result = await svc.tryRespond({
      scopeKey: scope,
      text: 'bot, continua a conversa',
      authorJid: uniqueJid(),
      sock,
      identityMap,
      funConfig: cfg,
    });

    assert.equal(result.responded, true);
    assert.match(request.system, /Pistas sociais inferidas e temporárias/);
    assert.match(request.system, /positive-0/);
    assert.match(request.system, /neutral-0/);
    assert.match(request.system, /negative-0/);
    assert.doesNotMatch(request.system, /low-confidence/);
    assert.equal((request.system.match(/\[positive · confiança/g) || []).length, 10);
    assert.equal((request.system.match(/\[neutral · confiança/g) || []).length, 10);
    assert.equal((request.system.match(/\[negative · confiança/g) || []).length, 10);
    assert.ok(request.system.indexOf('positive-0') < request.system.indexOf('positive-1'));
    assert.ok(request.system.indexOf('neutral-0') < request.system.indexOf('neutral-1'));
    assert.ok(request.system.indexOf('negative-0') < request.system.indexOf('negative-1'));
  } finally {
    if (previous === undefined) process.env.FUN_DISABLE_LIVE_LLM = '1';
    else process.env.FUN_DISABLE_LIVE_LLM = previous;
  }
});

test('persona: system permite acompanhar humor adulto contextual com limites', async () => {
  const previous = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    let request = null;
    const { svc, sock, identityMap, cfg } = setup(baseConfig, undefined, null, {
      generateZen: async (input) => {
        request = input;
        return 'Isso virou lenda do grupo, deixa a novela render kkk.';
      },
    });
    sock.sendMessage = async () => ({ key: { id: 'persona-adult-humor-1' } });

    const response = await svc.tryRespond({
      scopeKey: uniqueGroup(),
      text: 'bot, aquele date ainda rende piada demais',
      authorJid: uniqueJid(),
      sock,
      identityMap,
      funConfig: cfg,
      now: 9_050_000,
    });

    assert.equal(response.responded, true);
    assert.match(request.system, /humor adulto contextual/i);
    assert.match(request.system, /nunca sexualize menores/i);
    assert.match(request.system, /pedido para parar/i);
  } finally {
    if (previous === undefined) process.env.FUN_DISABLE_LIVE_LLM = '1';
    else process.env.FUN_DISABLE_LIVE_LLM = previous;
  }
});

test('persona: repete o Zen até zenMaxRetries antes do fallback', async () => {
  const previous = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    let calls = 0;
    const { svc, sock, identityMap, cfg } = setup(
      { ...baseConfig, zenMaxRetries: 3 },
      undefined,
      null,
      {
        generateZen: async () => {
          calls += 1;
          if (calls < 4) throw new Error('zen-indisponível');
          return 'Na quarta foi, agora fala sério kkk.';
        },
      }
    );
    sock.sendMessage = async () => ({ key: { id: 'persona-retry-1' } });

    const response = await svc.tryRespond({
      scopeKey: uniqueGroup(),
      text: 'bot, insiste aí',
      authorJid: uniqueJid(),
      sock,
      identityMap,
      funConfig: cfg,
      now: 9_100_000,
    });

    assert.equal(calls, 4);
    assert.equal(response.responded, true);
    assert.equal(response.usedFallback, false);
  } finally {
    if (previous === undefined) process.env.FUN_DISABLE_LIVE_LLM = '1';
    else process.env.FUN_DISABLE_LIVE_LLM = previous;
  }
});

test('tryRespond: sem gatilho (texto neutro)', async () => {
  const { svc, sock, identityMap, cfg } = setup();
  const scope = uniqueGroup();
  const r = await svc.tryRespond({
    scopeKey: scope, text: 'bom dia pessoal', mentionedJids: [], authorJid: uniqueJid(),
    sock, identityMap, funConfig: cfg,
  });
  assert.equal(r.responded, false);
  assert.equal(r.reason, 'no-trigger');
});

test('tryRespond: envia mensagem e abre thread (US1 completo)', async () => {
  const { svc, sock, identityMap, cfg, personaRepository } = setup();
  const scope = uniqueGroup();
  let sent = null;
  sock.sendMessage = async (jid, payload) => { sent = { jid, payload }; };
  const r = await svc.tryRespond({
    scopeKey: scope, text: 'bot, o que vc acha disso?', mentionedJids: [], authorJid: uniqueJid(),
    sock, identityMap, funConfig: cfg,
  });
  assert.equal(r.responded, true);
  assert.equal(sent.jid, scope);
  assert.ok(sent.payload.text.length > 0);

  const thread = personaRepository.getActiveThread(scope, { ttlMs: 30 * 60_000 });
  assert.ok(thread, 'thread deve ser criada');
  assert.equal(thread.turnCount, 0);
});

// ============================================================
// US2: Threads de conversa (continuação, limite, expiração)
// ============================================================

test('thread: primeira resposta cria thread', async () => {
  const { svc, sock, identityMap, cfg, personaRepository } = setup();
  const scope = uniqueGroup();
  sock.sendMessage = async () => {};
  await svc.tryRespond({
    scopeKey: scope, text: 'bot eai', authorJid: uniqueJid(),
    sock, identityMap, funConfig: cfg,
  });
  const t = personaRepository.getActiveThread(scope);
  assert.ok(t, 'thread ativa existe');
  assert.equal(t.turnCount, 0);
  assert.equal(t.maxTurns, 0, '0 = sem limite de turnos por padrão');
});

test('thread: continuar via reply ao bot incrementa turn_count', async () => {
  const { svc, sock, botJ, identityMap, cfg, personaRepository } = setup();
  const scope = uniqueGroup();
  sock.sendMessage = async () => {};
  const t0 = Date.now();
  await svc.tryRespond({
    scopeKey: scope, text: 'bot eai', authorJid: uniqueJid('1'),
    sock, identityMap, funConfig: cfg, now: t0,
  });
  const r2 = await svc.tryRespond({
    scopeKey: scope, text: 'kkkk concordo', authorJid: uniqueJid('2'),
    quotedParticipant: botJ, sock, identityMap, funConfig: cfg, now: t0 + 70_000,
  });
  assert.equal(r2.responded, true);
  const t = personaRepository.getActiveThread(scope);
  assert.equal(t.turnCount, 1);
});

test('thread: sem limite de turnos por padrão — chat continua além de 3 turnos', async () => {
  const { svc, sock, botJ, identityMap, cfg, personaRepository } = setup();
  const scope = uniqueGroup();
  sock.sendMessage = async () => {};
  let now = Date.now();
  await svc.tryRespond({ scopeKey: scope, text: 'bot', authorJid: uniqueJid(), sock, identityMap, funConfig: cfg, now });
  now += 70_000;
  await svc.tryRespond({ scopeKey: scope, text: 'rs', authorJid: uniqueJid(), quotedParticipant: botJ, sock, identityMap, funConfig: cfg, now });
  now += 70_000;
  await svc.tryRespond({ scopeKey: scope, text: 'kkk', authorJid: uniqueJid(), quotedParticipant: botJ, sock, identityMap, funConfig: cfg, now });
  now += 70_000;
  const r4 = await svc.tryRespond({ scopeKey: scope, text: 'heh', authorJid: uniqueJid(), quotedParticipant: botJ, sock, identityMap, funConfig: cfg, now });
  now += 70_000;
  const r5 = await svc.tryRespond({ scopeKey: scope, text: 'mais um', authorJid: uniqueJid(), quotedParticipant: botJ, sock, identityMap, funConfig: cfg, now });

  const t = personaRepository.getActiveThread(scope);
  assert.ok(t.turnCount >= 4, `turnCount deve crescer sem teto, atual=${t.turnCount}`);
  assert.equal(r4.responded, true, '4º turno deve responder (sem teto de turnos)');
  assert.equal(r5.responded, true, '5º turno deve responder (sem teto de turnos)');
});

test('thread: maxTurns configurado (> 0) ainda encerra a conversa', async () => {
  const { svc, sock, botJ, identityMap, cfg, personaRepository } = setup();
  const scope = uniqueGroup();
  sock.sendMessage = async () => {};
  const limited = { ...cfg, personaMaxTurns: 3 };
  let now = Date.now();
  await svc.tryRespond({ scopeKey: scope, text: 'bot', authorJid: uniqueJid(), sock, identityMap, funConfig: limited, now });
  now += 70_000;
  await svc.tryRespond({ scopeKey: scope, text: 'rs', authorJid: uniqueJid(), quotedParticipant: botJ, sock, identityMap, funConfig: limited, now });
  now += 70_000;
  await svc.tryRespond({ scopeKey: scope, text: 'kkk', authorJid: uniqueJid(), quotedParticipant: botJ, sock, identityMap, funConfig: limited, now });
  now += 70_000;
  await svc.tryRespond({ scopeKey: scope, text: 'heh', authorJid: uniqueJid(), quotedParticipant: botJ, sock, identityMap, funConfig: limited, now });
  now += 70_000;

  const t = personaRepository.getActiveThread(scope);
  assert.ok(t.turnCount >= 3, `turnCount deve ser >= 3, atual=${t.turnCount}`);

  const blocked = await svc.tryRespond({
    scopeKey: scope, text: 'eai', authorJid: uniqueJid(), quotedParticipant: botJ,
    sock, identityMap, funConfig: limited, now,
  });
  assert.equal(blocked.responded, false);
  assert.equal(blocked.reason, 'thread-limit');
});

test('thread: expira por TTL — reply antigo não reabre', async () => {
  const { svc, sock, botJ, identityMap, cfg } = setup();
  const scope = uniqueGroup();
  sock.sendMessage = async () => {};
  const t0 = 1_000_000;
  await svc.tryRespond({ scopeKey: scope, text: 'bot', authorJid: uniqueJid(), sock, identityMap, funConfig: cfg, now: t0 });

  const future = t0 + 31 * 60_000;
  const r = await svc.tryRespond({
    scopeKey: scope, text: 'voltando', authorJid: uniqueJid(), quotedParticipant: botJ,
    sock, identityMap, funConfig: cfg, now: future,
  });
  assert.equal(r.responded, false);
  assert.equal(r.reason, 'no-trigger');
});

test('thread: contexto da conversa armazenado', async () => {
  const { svc, sock, identityMap, cfg, personaRepository } = setup();
  const scope = uniqueGroup();
  sock.sendMessage = async () => {};
  await svc.tryRespond({
    scopeKey: scope, text: 'bot pergunta algo', authorJid: uniqueJid('1'),
    sock, identityMap, funConfig: cfg,
  });
  const t = personaRepository.getActiveThread(scope);
  assert.ok(t.context.length >= 1, 'contexto deve ter ao menos a troca inicial');
  assert.ok(t.context.some((c) => c.role === 'membro' || c.role === 'bot'));
});

// ============================================================
// US3: Janela rolante + perfil de voz
// ============================================================

test('observeMessage: adiciona à janela por grupo', () => {
  const { svc, cfg } = setup();
  const scope = uniqueGroup();
  svc.observeMessage({ scopeKey: scope, userJid: uniqueJid(), text: 'salve galera', funConfig: cfg });
  svc.observeMessage({ scopeKey: scope, userJid: uniqueJid(), text: 'tudo certo?', funConfig: cfg });
  const w = svc._windows.get(scope);
  assert.ok(w.msgs.length >= 2);
});

test('observeMessage: isolamento entre grupos', () => {
  const { svc, cfg } = setup();
  const a = uniqueGroup();
  const b = uniqueGroup();
  svc.observeMessage({ scopeKey: a, userJid: uniqueJid(), text: 'gíria do grupo A', funConfig: cfg });
  svc.observeMessage({ scopeKey: b, userJid: uniqueJid(), text: 'gíria do grupo B', funConfig: cfg });
  const wa = svc._windows.get(a);
  const wb = svc._windows.get(b);
  assert.ok(wa.msgs.every((m) => m.text.includes('A')));
  assert.ok(wb.msgs.every((m) => m.text.includes('B')));
});

test('observeMessage: feature desligada → skip', () => {
  const { svc } = setup({ ...baseConfig, personaEnabled: false });
  const r = svc.observeMessage({
    scopeKey: uniqueGroup(), userJid: uniqueJid(), text: 'oi',
    funConfig: { ...baseConfig, personaEnabled: false },
  });
  assert.equal(r.observed, false);
});

test('observeMessage: mensagem curta → skip', () => {
  const { svc, cfg } = setup();
  const r = svc.observeMessage({
    scopeKey: uniqueGroup(), userJid: uniqueJid(), text: 'k',
    funConfig: cfg,
  });
  assert.equal(r.observed, false);
});

test('observeMessage: mídia/sistema não alimenta janela da persona', () => {
  const { svc, cfg } = setup();
  const r = svc.observeMessage({
    scopeKey: uniqueGroup(), userJid: uniqueJid(), text: 'legenda',
    messageType: 'image', funConfig: cfg,
  });
  assert.equal(r.observed, false);
  assert.equal(r.reason, 'type');
});

test('tryRespond: ignora mensagens não-texto', async () => {
  const { svc, sock, identityMap, cfg } = setup();
  const r = await svc.tryRespond({
    scopeKey: uniqueGroup(), text: 'bot olha isso', messageType: 'image', authorJid: uniqueJid(),
    sock, identityMap, funConfig: cfg,
  });
  assert.equal(r.responded, false);
  assert.equal(r.reason, 'message-type');
});

test('tryRespond: guarda in-flight evita resposta duplicada concorrente', async () => {
  const { svc, sock, identityMap, cfg } = setup({ ...baseConfig, personaEnabled: true });
  const scope = uniqueGroup();
  svc._inFlightScopes.add(scope);
  const r = await svc.tryRespond({
    scopeKey: scope, text: 'bot eai', authorJid: uniqueJid(),
    sock, identityMap, funConfig: cfg,
  });
  assert.equal(r.responded, false);
  assert.equal(r.reason, 'in-flight');
  svc._inFlightScopes.delete(scope);
});

test('janela: limite de tamanho (≤100)', () => {
  const { svc, cfg } = setup();
  const scope = uniqueGroup();
  for (let i = 0; i < 120; i++) {
    svc.observeMessage({ scopeKey: scope, userJid: uniqueJid(), text: `msg ${i} do grupo`, funConfig: cfg });
  }
  const w = svc._windows.get(scope);
  assert.ok(w.msgs.length <= 100, `deve ser ≤100, atual=${w.msgs.length}`);
});

test('perfil: derivação persiste top_tokens/emojis/avg_len', () => {
  const { svc, cfg, personaRepository } = setup();
  const scope = uniqueGroup();
  const msgs = ['kkkk saudades mano 🔥', 'que saudade do zap 😂', 'kkkk fml', 'mds mano que gambi', 'salve salve família 🔥'];
  for (const t of msgs) {
    svc.observeMessage({ scopeKey: scope, userJid: uniqueJid(), text: t, funConfig: cfg });
  }
  const result = svc.deriveAndPersistProfile(scope, cfg);
  assert.equal(result.ok, true);
  const profile = personaRepository.getProfile(scope);
  assert.ok(profile);
  assert.ok(profile.topTokens.length > 0, 'deve ter top tokens');
  assert.ok(profile.emojis.length > 0, 'deve ter emojis');
  assert.ok(profile.avgLen > 0);
  assert.ok(profile.styleLines.length > 0);
});

test('perfil: style_lines anonimizadas (sem JIDs/números)', () => {
  const { svc, cfg, personaRepository } = setup();
  const scope = uniqueGroup();
  const phoneJid = '5581994623991@s.whatsapp.net';
  for (let i = 0; i < 5; i++) {
    svc.observeMessage({
      scopeKey: scope, userJid: uniqueJid(),
      text: `eai ${phoneJid} bom dia grupo kkk`,
      funConfig: cfg,
    });
  }
  svc.deriveAndPersistProfile(scope, cfg);
  const profile = personaRepository.getProfile(scope);
  for (const line of profile.styleLines) {
    assert.ok(!line.includes(phoneJid), `style_line não deve conter JID: ${line}`);
    assert.ok(!line.includes('5581994623991'), `não deve conter número: ${line}`);
  }
});

test('perfil: persiste entre "reinícios" (recria service)', () => {
  const { svc, cfg, personaRepository, groupRepository } = setup();
  const scope = uniqueGroup();
  for (let i = 0; i < 5; i++) {
    svc.observeMessage({ scopeKey: scope, userJid: uniqueJid(), text: `msg ${i} kk`, funConfig: cfg });
  }
  svc.deriveAndPersistProfile(scope, cfg);

  const svc2 = createPersonaService({ personaRepository, groupRepository, getLogger: () => null });
  const block = svc2.buildStyleBlock(scope, cfg);
  assert.ok(block.includes('Vocabulário'), 'perfil persistido deve estar disponível após reinício');
});

test('perfil: grupos diferentes não misturam estilos', () => {
  const { svc, cfg, personaRepository } = setup();
  const a = uniqueGroup();
  const b = uniqueGroup();
  for (let i = 0; i < 5; i++) {
    svc.observeMessage({ scopeKey: a, userJid: uniqueJid(), text: 'giriaa cro cri cro', funConfig: cfg });
    svc.observeMessage({ scopeKey: b, userJid: uniqueJid(), text: 'giriab zee bao zee', funConfig: cfg });
  }
  svc.deriveAndPersistProfile(a, cfg);
  svc.deriveAndPersistProfile(b, cfg);
  const pa = personaRepository.getProfile(a);
  const pb = personaRepository.getProfile(b);
  assert.ok(pa.topTokens.includes('cro'));
  assert.ok(!pa.topTokens.includes('zee'));
  assert.ok(pb.topTokens.includes('zee'));
  assert.ok(!pb.topTokens.includes('cro'));
});

test('maybeDeriveProfile: deriva na 1ª chamada, debounce nas seguintes, deriva de novo após intervalo', () => {
  const cfg = { ...baseConfig, personaDeriveIntervalMs: 60_000 };
  const { svc, personaRepository } = setup(cfg);
  const scope = uniqueGroup();
  for (let i = 0; i < 5; i++) {
    svc.observeMessage({ scopeKey: scope, userJid: uniqueJid(), text: `msg ${i} do grupo`, funConfig: cfg });
  }
  const t0 = Date.now();
  assert.equal(svc.maybeDeriveProfile(scope, cfg, t0).ok, true, '1ª chamada deve derivar');
  assert.ok(personaRepository.getProfile(scope), 'perfil deve ser persistido');
  assert.equal(svc.maybeDeriveProfile(scope, cfg, t0 + 59_999).reason, 'debounced', 'dentro do intervalo não deriva');
  assert.equal(svc.maybeDeriveProfile(scope, cfg, t0 + 60_001).ok, true, 'após o intervalo deriva de novo');
});

test('maybeDeriveProfile: janela insuficiente não deriva', () => {
  const { svc, personaRepository } = setup();
  const scope = uniqueGroup();
  for (let i = 0; i < 3; i++) {
    svc.observeMessage({ scopeKey: scope, userJid: uniqueJid(), text: `msg ${i} do grupo`, funConfig: baseConfig });
  }
  assert.equal(svc.maybeDeriveProfile(scope, baseConfig).reason, 'insufficient');
  assert.equal(personaRepository.getProfile(scope), null, 'não deve criar perfil sem amostra suficiente');
});

test('perfil: risada gigante colapsa para "kkk" e token de tópico único não entra', () => {
  const { svc, cfg, personaRepository } = setup();
  const scope = uniqueGroup();
  const bigLaugh = 'k'.repeat(47);
  const msgs = [`${bigLaugh} mane`, 'que isso ai', 'kkkk e tal', 'iamos embora', 'so pra testar, valeu'];
  for (const t of msgs) svc.observeMessage({ scopeKey: scope, userJid: uniqueJid(), text: t, funConfig: cfg });
  svc.deriveAndPersistProfile(scope, cfg);
  const profile = personaRepository.getProfile(scope);
  assert.ok(profile.topTokens.includes('kkk'), 'risada deve colapsar para o token canônico kkk');
  assert.equal(profile.topTokens.find((t) => t.length > 8), undefined, 'não deve incluir token gigante de risada');
  assert.ok(!profile.topTokens.includes('mane'), 'token presente em 1 só mensagem é tópico, não estilo');
  assert.ok(!profile.topTokens.includes('pra'), 'stopword/sinal sem cobertura não deve entrar');
});

test('observeMessage: comandos com prefixo não alimentam janela', () => {
  const { svc, cfg } = setup();
  const scope = uniqueGroup();
  const r1 = svc.observeMessage({ scopeKey: scope, userJid: uniqueJid(), text: '/trabalhar', funConfig: cfg });
  const r2 = svc.observeMessage({ scopeKey: scope, userJid: uniqueJid(), text: '/sorte', funConfig: cfg });
  assert.equal(r1.reason, 'command');
  assert.equal(r2.reason, 'command');
  assert.equal(svc._windows.get(scope), undefined, 'só comandos não devem criar janela de aprendizado');
});

test('perfil: style_lines excluem comandos e amostram autores distintos', () => {
  const { svc, cfg, personaRepository } = setup();
  const scope = uniqueGroup();
  const msgs = ['/trabalhar', 'bora galera kkk', 'esse dia foi bom demais!', 'kkkkkk vivemos', 'nunca mais volto nesse lugar', 'amanha tem mais um dia'];
  for (const t of msgs) svc.observeMessage({ scopeKey: scope, userJid: uniqueJid(), text: t, funConfig: cfg });
  svc.deriveAndPersistProfile(scope, cfg);
  const profile = personaRepository.getProfile(scope);
  assert.ok(profile.styleLines.length > 0, 'deve ter amostras de tom');
  for (const line of profile.styleLines) {
    assert.ok(!line.startsWith('/'), `style_line não deve ser comando: ${line}`);
  }
});

// ============================================================
// F1 + F3: vocabulário acumulado, dígitos descartados, placeholders filtrados
// ============================================================

test('F1 extractTokens: descarta tokens puramente numéricos (IDs/timestamps)', () => {
  const { svc, cfg, personaRepository } = setup();
  const scope = uniqueGroup();
  // "174994885714120" era o ruído que aparecia como 1º token do vocabulário no prompt real.
  const msgs = [
    '174994885714120 bitcoin preço atual',
    'pesquisa o preço do bitcoin internet',
    'bitcoin bitcoin preço preço atual',
    'internet internet bitcoin preço',
    'preço do bitcoin na internet atual',
  ];
  for (const t of msgs) svc.observeMessage({ scopeKey: scope, userJid: uniqueJid(), text: t, funConfig: cfg });
  svc.deriveAndPersistProfile(scope, cfg);
  const profile = personaRepository.getProfile(scope);
  assert.ok(!profile.topTokens.includes('174994885714120'), 'número cravo não deve virar vocabulário');
  assert.ok(profile.topTokens.includes('bitcoin'), 'termo real entra');
  assert.ok(profile.topTokens.includes('preco'), 'preço (sem acento) entra');
});

test('F1: acumula vocabulário entre derivações com decay temporal', () => {
  const cfg = { ...baseConfig, personaTokenHalfLifeMs: 7 * 24 * 60 * 60 * 1000 };
  const { svc, personaRepository } = setup(cfg);
  const scope = uniqueGroup();
  const DAY = 24 * 60 * 60 * 1000;
  // base > 0: o serviço usa o idiom `Number(now) || Date.now()`, então 0 seria
  // tratado como "sem timestamp" e viraria relógio real, quebrando o determinismo.
  const BASE = 1_000_000_000;

  // batch A — histórico antigo (5 msgs recorrentes em "salve mano").
  for (let i = 0; i < 5; i += 1) {
    svc.observeMessage({ scopeKey: scope, userJid: uniqueJid(), text: 'salve mano mano', funConfig: cfg, now: BASE });
  }
  assert.equal(svc.deriveAndPersistProfile(scope, cfg, BASE).ok, true, '1ª deriva do batch A');
  const afterA = personaRepository.getProfile(scope);
  assert.ok(afterA.topTokens.includes('salve'), 'batch A entra no perfil');
  assert.ok(afterA.tokenCounts && typeof afterA.tokenCounts === 'object', 'tokenCounts persistido');

  // batch B — 12 dias depois (acima da meia-vida de 7d): windowMs 24h filtra A da janela,
  // mas o acúmulo vem do perfil persistido (não da janela). "bitcoin" é o novo recorrente.
  for (let i = 0; i < 5; i += 1) {
    svc.observeMessage({ scopeKey: scope, userJid: uniqueJid(), text: 'bitcoin preço preço', funConfig: cfg, now: BASE + 12 * DAY });
  }
  assert.equal(svc.deriveAndPersistProfile(scope, cfg, BASE + 12 * DAY).ok, true, '2ª deriva do batch B');
  const finalProfile = personaRepository.getProfile(scope);
  assert.ok(finalProfile.topTokens.includes('bitcoin'), 'batch B entra no perfil');
  // histórico de A decaído mas ainda presente (palavra recorrente do grupo ao longo do tempo)
  assert.ok(finalProfile.topTokens.includes('salve'), 'vocabulário histórico persiste (acumulado, não sobrescrito)');
  // contagens de salve decaíram: peso final < peso inicial (5), bitcoin > salve.
  const salveWeight = Number(finalProfile.tokenCounts?.salve) || 0;
  const bitcoinWeight = Number(finalProfile.tokenCounts?.bitcoin) || 0;
  assert.ok(salveWeight > 0 && salveWeight < 5, `salve decaído (0 < w < 5), atual=${salveWeight}`);
  assert.ok(bitcoinWeight >= 5, `bitcoin batch B conservado (>=5), atual=${bitcoinWeight}`);
});

test('F3 memorySignalText: descarta placeholders de memória e mantém fatos reais', async () => {
  const previous = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    let request = null;
    const { svc, sock, identityMap, cfg } = setup(baseConfig, undefined, null, {
      generateZen: async (input) => { request = input; return 'kk nem venho mano'; },
    });
    sock.sendMessage = async () => ({ key: { id: 'ph-1' } });
    const r = await svc.tryRespond({
      scopeKey: uniqueGroup(),
      text: 'bot, lembra de algo?',
      authorJid: uniqueJid(),
      sock, identityMap, funConfig: cfg, now: 9_200_000,
      responseContextPack: {
        inferredSignals: [
          { factText: 'evento recente do grupo' },          // placeholder → descarta
          { factText: 'Nina coleciona DVDs antigos' },       // real → mantém
          { factText: 'interação social no grupo' },         // placeholder → descarta
        ],
        riskFlags: [],
      },
    });
    assert.equal(r.responded, true);
    assert.match(request.system, /Nina coleciona DVDs antigos/, 'fato real entra no prompt');
    assert.doesNotMatch(request.system, /Pistas de memória incertas:[\s\S]*evento recente do grupo/, 'placeholder NÃO entra na seção de pistas');
    // contagem de bullets de pistas: só deve aparecer o fato real (1 linha), não 3.
    const pistasBlock = request.system.match(/Pistas de memória incertas[\s\S]*?(?:\n{2}|$)/);
    if (pistasBlock) {
      const bullets = pistasBlock[0].match(/^- /gm) || [];
      assert.equal(bullets.length, 1, `só o fato real deve virar pista, atual=${bullets.length}`);
    }
  } finally {
    if (previous === undefined) process.env.FUN_DISABLE_LIVE_LLM = '1';
    else process.env.FUN_DISABLE_LIVE_LLM = previous;
  }
});
