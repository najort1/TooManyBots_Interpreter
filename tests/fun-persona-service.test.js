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

function setup(cfg = baseConfig, botJid, threadContextService = null) {
  const personaRepository = createFunPersonaRepository({ getDatabase: getDb });
  const groupRepository = createFunGroupRepository({ getDatabase: getDb });
  const botJ = botJid || uniqueJid('5599');
  const sock = makeSock(botJ);
  const identityMap = createIdentityMap();
  const svc = createPersonaService({
    personaRepository,
    groupRepository,
    threadContextService,
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

test('tryRespond: cooldown bloqueia duas chamadas textuais vocativas seguidas', async () => {
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
  assert.equal(t.maxTurns, 3);
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

test('thread: limite de turnos encerra (max 3); reply além do limite bloqueia', async () => {
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
  await svc.tryRespond({ scopeKey: scope, text: 'heh', authorJid: uniqueJid(), quotedParticipant: botJ, sock, identityMap, funConfig: cfg, now });
  now += 70_000;

  const t = personaRepository.getActiveThread(scope);
  assert.ok(t.turnCount >= 3, `turnCount deve ser >= 3, atual=${t.turnCount}`);

  const blocked = await svc.tryRespond({
    scopeKey: scope, text: 'eai', authorJid: uniqueJid(), quotedParticipant: botJ,
    sock, identityMap, funConfig: cfg, now,
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
