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
import { buildPersonaToolManifest, parsePersonaEnvelope, shouldDisplayPersonaToolOutput } from '../fun/services/personaToolProtocol.js';
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
  const manifest = buildPersonaToolManifest();
  assert.match(manifest, /Nunca diga que vai usar, tentar ou chamar uma tool/i);
  assert.match(manifest, /chame group_status/i);
  assert.match(manifest, /encadear tools/i);
});

test('persona agent: classificação de tools que exibem ou omitem output completo', () => {
  // Tools de contexto/leitura/RAG omitem output completo para evitar dumps brutos
  assert.equal(shouldDisplayPersonaToolOutput('lore'), false);
  assert.equal(shouldDisplayPersonaToolOutput('lore_add'), false);
  assert.equal(shouldDisplayPersonaToolOutput('lore_update'), false);
  assert.equal(shouldDisplayPersonaToolOutput('lore_remove'), false);
  assert.equal(shouldDisplayPersonaToolOutput('recent_conversation'), false);
  assert.equal(shouldDisplayPersonaToolOutput('group_identity'), false);
  assert.equal(shouldDisplayPersonaToolOutput('daily_challenge_status'), false);
  assert.equal(shouldDisplayPersonaToolOutput('reaction'), false);
  assert.equal(shouldDisplayPersonaToolOutput('send_sticker'), false);

  // Tools de entretenimento/geração/ajuda exibem output completo
  assert.equal(shouldDisplayPersonaToolOutput('oracle'), true);
  assert.equal(shouldDisplayPersonaToolOutput('tarot'), true);
  assert.equal(shouldDisplayPersonaToolOutput('ship'), true);
  assert.equal(shouldDisplayPersonaToolOutput('cancel'), true);
  assert.equal(shouldDisplayPersonaToolOutput('illuminati'), true);
  assert.equal(shouldDisplayPersonaToolOutput('gossip'), true);
  assert.equal(shouldDisplayPersonaToolOutput('start_russian'), true);
  assert.equal(shouldDisplayPersonaToolOutput('pull_russian'), true);
  assert.equal(shouldDisplayPersonaToolOutput('daily_challenge_hint'), true);
  assert.equal(shouldDisplayPersonaToolOutput('group_status'), true);
  assert.equal(shouldDisplayPersonaToolOutput('help'), true);

  // Inexistente ou inválida
  assert.equal(shouldDisplayPersonaToolOutput(''), false);
  assert.equal(shouldDisplayPersonaToolOutput('desconhecida'), false);
});

test('persona agent: áudio é aceito no protocolo e só aparece no manifesto quando TTS está disponível', () => {
  const rootAudio = parsePersonaEnvelope('{"type":"audio","text":"fala narrada"}');
  const actionAudio = parsePersonaEnvelope('{"type":"actions","actions":[{"type":"audio","text":"fala narrada"}]}');
  assert.deepEqual(rootAudio.envelope.actions, [{ type: 'audio', text: 'fala narrada' }]);
  assert.deepEqual(actionAudio.envelope.actions, [{ type: 'audio', text: 'fala narrada' }]);
  assert.equal(parsePersonaEnvelope('{"type":"audio","text":""}').reason, 'empty-audio');
  assert.doesNotMatch(buildPersonaToolManifest(), /"type":"audio"/);
  assert.match(buildPersonaToolManifest({ audioEnabled: true }), /"type":"audio"/);
});

test('persona agent: protocolo preserva respostas longas sem teto e respeita teto explícito', () => {
  const longText = 'resposta longa '.repeat(250);
  const reply = parsePersonaEnvelope(JSON.stringify({ type: 'reply', text: longText }));
  const audio = parsePersonaEnvelope(JSON.stringify({ type: 'audio', text: longText }));
  const capped = parsePersonaEnvelope(JSON.stringify({ type: 'reply', text: longText }), { maxChars: 280 });

  assert.equal(reply.envelope.text, longText.trim());
  assert.equal(audio.envelope.actions[0].text, longText.trim());
  assert.equal(capped.envelope.text.length, 280);
});


test('persona agent: limite de caracteres pode ser desativado sem reduzir o orçamento de tokens', () => {
  const unrestricted = resolveFunConfig({ personaMaxChars: 0, zenPersonaMaxTokens: 2_000 });
  const capped = resolveFunConfig({ personaMaxChars: 280 });

  assert.equal(unrestricted.personaMaxChars, 0);
  assert.equal(unrestricted.zenPersonaMaxTokens, 2_000);
  assert.equal(capped.personaMaxChars, 280);
});


test('persona agent: configurações novas têm defaults e clamps seguros', () => {
  const cfg = resolveFunConfig({
    personaToolCooldownMs: 1,
    personaAgentMaxToolCalls: 99,
    personaAgentDeadlineMs: 1,
    personaTimeoutMs: 1,
    loreReconciliationCooldownMs: 999_999_999,
    loreReconciliationMaxCandidates: 999,
    loreReconciliationTimeoutMs: 1,
  });
  const defaultCfg = resolveFunConfig({});
  const minCallsCfg = resolveFunConfig({ personaAgentMaxToolCalls: 0 });
  const maxDeadlineCfg = resolveFunConfig({ personaAgentDeadlineMs: 999_999 });
  const maxPersonaTimeoutCfg = resolveFunConfig({ personaTimeoutMs: 999_999 });
  assert.equal(DEFAULT_FUN_CONFIG.personaAgentDeadlineMs, 60_000);
  assert.equal(DEFAULT_FUN_CONFIG.personaTimeoutMs, 35_000);
  assert.equal(DEFAULT_FUN_CONFIG.personaAgentMaxToolCalls, 3);
  assert.equal(defaultCfg.personaAgentDeadlineMs, 60_000);
  assert.equal(defaultCfg.personaTimeoutMs, 35_000);
  assert.equal(defaultCfg.personaAgentMaxToolCalls, 3);
  assert.equal(cfg.personaToolsEnabled, true);
  assert.equal(cfg.personaToolCooldownMs, 5_000);
  assert.equal(cfg.personaAgentMaxToolCalls, 5);
  assert.equal(minCallsCfg.personaAgentMaxToolCalls, 1);
  assert.equal(cfg.personaAgentDeadlineMs, 5_000);
  assert.equal(cfg.personaTimeoutMs, 5_000);
  assert.equal(maxDeadlineCfg.personaAgentDeadlineMs, 90_000);
  assert.equal(maxPersonaTimeoutCfg.personaTimeoutMs, 60_000);
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

test('persona agent: pull_russian mantém a persona virtual e nunca bloqueia XP', async () => {
  const scope = uniqueGroup();
  const author = uniqueJid('5592');
  const effects = createFunEffectsRepository({ getDatabase: getDb });
  let randomCalls = 0;
  const chaos = createChaosService({
    repository: { getLeaderboard: () => [] },
    effectsRepository: effects,
    random: () => (++randomCalls === 1 ? 0.99 : 0),
  });
  const executor = createPersonaToolExecutor({ chaosService: chaos });
  const cfg = { ...DEFAULT_FUN_CONFIG, personaToolCooldownMs: 5_000, russianChambers: 6 };

  await executor.execute(
    { name: 'start_russian', arguments: {} },
    { scopeKey: scope, authorJid: author, text: 'bot abre a roleta russa', funConfig: cfg, now: 1_000_000 }
  );
  const pulled = await executor.execute(
    { name: 'pull_russian', arguments: {} },
    { scopeKey: scope, authorJid: author, text: 'bot sua vez, puxa o gatilho', funConfig: cfg, now: 1_003_100 }
  );

  assert.equal(pulled.ok, true);
  assert.equal(pulled.virtual.died, true);
  assert.equal(effects.isXpBlocked(executor.VIRTUAL_RUSSIAN_ACTOR, scope, 1_003_001).blocked, false);
  assert.equal(chaos.getRussian(scope, cfg, 1_003_001), null);
});

test('persona agent: challenge tools consultam e liberam dica pelo serviço de domínio', async () => {
  const scope = uniqueGroup();
  const executor = createPersonaToolExecutor({
    chaosService: { checkCooldown: () => ({ ok: true }) },
    dailyChallengeService: {
      getStatus: () => ({ active: true, challenge: { id: 42, challengeType: 'riddle' } }),
      getHintCooldownRemaining: () => 0,
      handleHint: async () => ({ ok: true, message: '💡 Dica real do desafio.' }),
    },
  });
  const context = { scopeKey: scope, authorJid: uniqueJid(), text: 'bot qual o desafio e manda uma dica', funConfig: { ...DEFAULT_FUN_CONFIG, personaToolCooldownMs: 5_000 }, now: 1_000_000 };

  const status = await executor.execute({ name: 'daily_challenge_status', arguments: {} }, context);
  const hint = await executor.execute({ name: 'daily_challenge_hint', arguments: {} }, context);

  assert.equal(status.ok, true);
  assert.match(status.text, /riddle/);
  assert.equal(hint.ok, true);
  assert.equal(hint.text, '💡 Dica real do desafio.');
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

test('persona agent: gossip aceita o nome da tool e usa o autor como alvo padrão', async () => {
  const chaos = createChaosService({ repository: { getLeaderboard: () => [] }, random: () => 0.99 });
  const executor = createPersonaToolExecutor({ chaosService: chaos });
  const scope = uniqueGroup();
  const author = uniqueJid();
  const result = await executor.execute(
    { name: 'gossip', arguments: {} },
    {
      scopeKey: scope,
      authorJid: author,
      text: 'bot, tenta o goosip pra ver se sai algo sujo sobre você',
      funConfig: { ...DEFAULT_FUN_CONFIG, personaToolCooldownMs: 5_000 },
      now: 1_000_000,
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.target, author.split('@')[0]);
  assert.match(result.text, /Fofoca/);
});

test('persona agent: tools diferentes não compartilham cooldown', async () => {
  const chaos = {
    checkCooldown: () => ({ ok: true }),
    gossipFake: () => 'fofoca de teste',
    oracleInsane: () => 'oráculo de teste',
  };
  const executor = createPersonaToolExecutor({ chaosService: chaos });
  const scope = uniqueGroup();
  const author = uniqueJid();
  const cfg = { ...DEFAULT_FUN_CONFIG, personaToolCooldownMs: 45_000 };
  const gossip = await executor.execute(
    { name: 'gossip', arguments: { target: 'author' } },
    { scopeKey: scope, authorJid: author, text: 'bot, usa o gossip em mim', funConfig: cfg, now: 1_000_000 }
  );
  const oracle = await executor.execute(
    { name: 'oracle', arguments: { question: 'vou ganhar?' } },
    { scopeKey: scope, authorJid: author, text: 'bot, faz um oráculo pra mim?', funConfig: cfg, now: 1_001_000 }
  );

  assert.equal(gossip.ok, true, JSON.stringify(gossip));
  assert.equal(oracle.ok, true, JSON.stringify(oracle));
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
  assert.equal(sent.length, 0, 'O executor não pode despachar mídia diretamente.');
  assert.deepEqual(result.dispatchActions, [{
    type: 'image_url',
    imageUrl: 'https://media.example/hug.gif',
    mimeType: 'image/gif',
    caption: '*Eu* mandei hug para *Bia*.',
  }]);
  assert.deepEqual(result.claimTokens, ['reaction:hug']);

  const unsafe = await executor.execute(
    { name: 'reaction', arguments: { action: 'boquete', target: 'mentioned' } },
    { scopeKey: scope, authorJid: author, mentionedJids: [mentioned], text: 'bot manda uma reação', funConfig: cfg, now: 1_006_000 }
  );
  assert.equal(unsafe.ok, false);
  assert.equal(unsafe.reason, 'unsafe-action');

  const generic = await executor.execute(
    { name: 'reaction', arguments: { action: 'reaction' } },
    { scopeKey: scope, authorJid: author, text: 'reaction', funConfig: cfg, now: 1_012_000, replyImageUrl: async (...args) => sent.push(args) }
  );
  assert.equal(generic.ok, true);
  assert.equal(generic.action, 'wave');

  const invalid = await executor.execute(
    { name: 'reaction', arguments: { action: 'inexistente_xyz' } },
    { scopeKey: scope, authorJid: author, text: 'reaction', funConfig: cfg, now: 1_018_000 }
  );
  assert.equal(invalid.ok, false);
  assert.equal(invalid.reason, 'invalid-action');
  assert.match(invalid.text, /Ação de reação inválida/);

  const emojiSent = [];
  const emojiReact = await executor.execute(
    { name: 'reaction', arguments: { action: '🔥' } },
    {
      scopeKey: scope,
      authorJid: author,
      text: 'reage com fogo',
      funConfig: cfg,
      now: 1_024_000,
      replyReact: async (emoji) => emojiSent.push(emoji),
    }
  );
  assert.equal(emojiReact.ok, true);
  assert.equal(emojiReact.emoji, '🔥');
  assert.deepEqual(emojiSent, [], 'O executor não pode reagir diretamente.');
  assert.deepEqual(emojiReact.dispatchActions, [{ type: 'react', emoji: '🔥' }]);
  assert.deepEqual(emojiReact.claimTokens, ['emoji_reaction']);
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
  assert.equal(stickersSent.length, 0, 'O executor não pode despachar figurinha diretamente.');
  assert.equal(result.dispatchActions.length, 1);
  assert.equal(result.dispatchActions[0].type, 'sticker_buffer');
  assert.ok(Buffer.isBuffer(result.dispatchActions[0].stickerBuffer) && result.dispatchActions[0].stickerBuffer.length > 0);
  assert.deepEqual(result.claimTokens, ['sticker']);
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

test('persona agent: protocolo aceita lore_add, lore_update, lore_remove com validação de esquema', () => {
  // lore_add: válido e inválido
  const validAdd = parsePersonaEnvelope('{"type":"tool_call","name":"lore_add","arguments":{"summary":"Lucas caiu da cadeira","kind":"epic_fail"}}');
  assert.equal(validAdd.ok, true);
  assert.deepEqual(validAdd.envelope, {
    type: 'tool_call',
    name: 'lore_add',
    arguments: { summary: 'Lucas caiu da cadeira', kind: 'epic_fail' },
    callId: '',
  });
  assert.equal(parsePersonaEnvelope('{"type":"tool_call","name":"lore_add","arguments":{"summary":123}}').reason, 'invalid-summary');
  assert.equal(parsePersonaEnvelope('{"type":"tool_call","name":"lore_add","arguments":{"summary":"fato","unknown":"extra"}}').reason, 'unknown-argument');

  // lore_update: válido por id e query, e inválido
  const validUpdateId = parsePersonaEnvelope('{"type":"tool_call","name":"lore_update","arguments":{"id":"f-123","summary":"Lucas caiu da rede"}}');
  assert.equal(validUpdateId.ok, true);
  assert.deepEqual(validUpdateId.envelope.arguments, { id: 'f-123', summary: 'Lucas caiu da rede' });
  const validUpdateQuery = parsePersonaEnvelope('{"type":"tool_call","name":"lore_update","arguments":{"query":"cadeira","summary":"Lucas caiu do banco"}}');
  assert.equal(validUpdateQuery.ok, true);
  assert.deepEqual(validUpdateQuery.envelope.arguments, { query: 'cadeira', summary: 'Lucas caiu do banco' });
  assert.equal(parsePersonaEnvelope('{"type":"tool_call","name":"lore_update","arguments":{"summary":{}}}').reason, 'invalid-summary');
  assert.equal(parsePersonaEnvelope('{"type":"tool_call","name":"lore_update","arguments":{"extra":"campo"}}').reason, 'unknown-argument');

  // lore_remove: válido por id e query, e inválido
  const validRemoveId = parsePersonaEnvelope('{"type":"tool_call","name":"lore_remove","arguments":{"id":"f-123"}}');
  assert.equal(validRemoveId.ok, true);
  assert.deepEqual(validRemoveId.envelope.arguments, { id: 'f-123' });
  const validRemoveQuery = parsePersonaEnvelope('{"type":"tool_call","name":"lore_remove","arguments":{"query":"cadeira"}}');
  assert.equal(validRemoveQuery.ok, true);
  assert.deepEqual(validRemoveQuery.envelope.arguments, { query: 'cadeira' });
  assert.equal(parsePersonaEnvelope('{"type":"tool_call","name":"lore_remove","arguments":{"id":456}}').reason, 'invalid-id');
  assert.equal(parsePersonaEnvelope('{"type":"tool_call","name":"lore_remove","arguments":{"foo":"bar"}}').reason, 'unknown-argument');
});

test('persona agent: executor de tools de lore (lore_add, lore_update, lore_remove, lore)', async () => {
  const memoryRepository = createFunMemoryRepository({ getDatabase: getDb });
  let cacheInvalidations = [];
  const groupMemoryService = {
    memoryRepository,
    invalidatePersonaCache: (scope) => {
      cacheInvalidations.push(scope);
    },
    findMatchingFacts: (scope, q) => {
      const qNorm = String(q || '').toLowerCase();
      return memoryRepository.listFacts(scope, { limit: 50 }).filter((f) =>
        f.summary.toLowerCase().includes(qNorm)
      );
    },
    forgetByQuery: (scope, q, { maxWipe = 3 } = {}) => {
      const matches = memoryRepository.listFacts(scope, { limit: 50 }).filter((f) =>
        f.summary.toLowerCase().includes(String(q || '').toLowerCase())
      );
      if (!matches.length) return { ok: false, reason: 'not-found', removed: 0, matches: [] };
      if (matches.length > maxWipe) return { ok: false, reason: 'too-broad', removed: 0, matches, count: matches.length };
      let removed = 0;
      for (const m of matches) {
        if (memoryRepository.deleteFact(m.id)) removed += 1;
      }
      return { ok: true, removed, matches };
    },
  };
  const chaos = createChaosService({ repository: { getLeaderboard: () => [] }, random: () => 0.99 });
  const executor = createPersonaToolExecutor({
    chaosService: chaos,
    memoryRepository,
    groupMemoryService,
  });

  const scopeKey = uniqueGroup();
  const dmScope = uniqueJid('5511');
  const user1 = uniqueJid('5511');
  const user2 = uniqueJid('5521');

  // Proteção de escopo: escopo que não é grupo falha com group-only
  const nonGroupAdd = await executor.execute(
    { name: 'lore_add', arguments: { summary: 'Fato no PV' } },
    { scopeKey: dmScope }
  );
  assert.equal(nonGroupAdd.ok, false);
  assert.equal(nonGroupAdd.reason, 'group-only');

  const nonGroupLore = await executor.execute(
    { name: 'lore', arguments: {} },
    { scopeKey: dmScope }
  );
  assert.equal(nonGroupLore.ok, false);
  assert.equal(nonGroupLore.reason, 'group-only');

  // lore_add: validação de resumo ausente
  const addMissing = await executor.execute(
    { name: 'lore_add', arguments: { summary: '' } },
    { scopeKey }
  );
  assert.equal(addMissing.ok, false);
  assert.equal(addMissing.reason, 'missing-summary');

  // lore_add: cria fato no banco, anexa subjects de mentionedJids e quoted, invalida cache
  const addResult = await executor.execute(
    { name: 'lore_add', arguments: { summary: 'Lucas esqueceu a pizza no forno', kind: 'epic_fail' } },
    { scopeKey, mentionedJids: [user1], quotedParticipant: user2, now: 1_000_000 }
  );
  assert.equal(addResult.ok, true);
  assert.match(addResult.text, /Fato adicionado à lore do grupo/);
  assert.match(addResult.text, /Lucas esqueceu a pizza no forno/);
  assert.equal(cacheInvalidations.includes(scopeKey), true);
  const factId = addResult.data.id;
  assert.ok(factId);

  // Verifica persistência real no banco
  const dbFact = memoryRepository.getFact(factId);
  assert.equal(dbFact.summary, 'Lucas esqueceu a pizza no forno');
  assert.equal(dbFact.kind, 'epic_fail');
  assert.deepEqual(dbFact.subjects, [user1, user2]);

  // lore: consulta com query retorna fato com ID
  const loreQueryResult = await executor.execute(
    { name: 'lore', arguments: { query: 'pizza' } },
    { scopeKey }
  );
  assert.equal(loreQueryResult.ok, true);
  assert.match(loreQueryResult.text, new RegExp(`\\[id: ${factId}\\]`));
  assert.match(loreQueryResult.text, /Lucas esqueceu a pizza no forno/);

  // lore: consulta com query vazia lista fatos recentes com ID
  const loreEmptyResult = await executor.execute(
    { name: 'lore', arguments: {} },
    { scopeKey }
  );
  assert.equal(loreEmptyResult.ok, true);
  assert.match(loreEmptyResult.text, new RegExp(`\\[id: ${factId}\\]`));
  assert.match(loreEmptyResult.text, /Lucas esqueceu a pizza no forno/);

  // lore_update: validação de resumo ausente
  const updateMissing = await executor.execute(
    { name: 'lore_update', arguments: { id: factId, summary: '' } },
    { scopeKey }
  );
  assert.equal(updateMissing.ok, false);
  assert.equal(updateMissing.reason, 'missing-summary');

  // lore_update: atualiza fato por ID, reflete no banco e invalida cache
  cacheInvalidations = [];
  const updateByIdResult = await executor.execute(
    { name: 'lore_update', arguments: { id: factId, summary: 'Lucas queimou a pizza no forno de propósito' } },
    { scopeKey }
  );
  assert.equal(updateByIdResult.ok, true);
  assert.match(updateByIdResult.text, /Fato da lore atualizado/);
  assert.equal(cacheInvalidations.includes(scopeKey), true);
  const updatedDbFact1 = memoryRepository.getFact(factId);
  assert.equal(updatedDbFact1.summary, 'Lucas queimou a pizza no forno de propósito');

  // lore_update: atualiza fato por query, reflete no banco e invalida cache
  cacheInvalidations = [];
  const updateByQueryResult = await executor.execute(
    { name: 'lore_update', arguments: { query: 'queimou', summary: 'Lucas carbonizou a pizza inteira' } },
    { scopeKey }
  );
  assert.equal(updateByQueryResult.ok, true);
  assert.match(updateByQueryResult.text, /Fato da lore atualizado/);
  assert.equal(cacheInvalidations.includes(scopeKey), true);
  const updatedDbFact2 = memoryRepository.getFact(factId);
  assert.equal(updatedDbFact2.summary, 'Lucas carbonizou a pizza inteira');

  // lore_update: se não encontrar alvo, retorna not-found
  const updateNotFound = await executor.execute(
    { name: 'lore_update', arguments: { id: 'inexistente-id', summary: 'Algo novo' } },
    { scopeKey }
  );
  assert.equal(updateNotFound.ok, false);
  assert.equal(updateNotFound.reason, 'not-found');

  // Adiciona um segundo fato para testar remoção por query e por ID separadamente
  const addFact2 = await executor.execute(
    { name: 'lore_add', arguments: { summary: 'Marcos perdeu a aposta do clássico' } },
    { scopeKey, now: 1_000_100 }
  );
  assert.equal(addFact2.ok, true);
  const fact2Id = addFact2.data.id;

  // lore_remove: remove por query, reflete no banco e invalida cache
  cacheInvalidations = [];
  const removeByQueryResult = await executor.execute(
    { name: 'lore_remove', arguments: { query: 'Marcos' } },
    { scopeKey }
  );
  assert.equal(removeByQueryResult.ok, true);
  assert.match(removeByQueryResult.text, /Removido\(s\) 1 fato\(s\)/);
  assert.equal(cacheInvalidations.includes(scopeKey), true);
  assert.equal(memoryRepository.getFact(fact2Id), null);

  // lore_remove: remove por ID, reflete no banco e invalida cache
  cacheInvalidations = [];
  const removeByIdResult = await executor.execute(
    { name: 'lore_remove', arguments: { id: factId } },
    { scopeKey }
  );
  assert.equal(removeByIdResult.ok, true);
  assert.match(removeByIdResult.text, /removido da lore/i);
  assert.equal(cacheInvalidations.includes(scopeKey), true);
  assert.equal(memoryRepository.getFact(factId), null);

  // lore_remove: id inexistente retorna ok false
  const removeInexistent = await executor.execute(
    { name: 'lore_remove', arguments: { id: 'inexistente-999' } },
    { scopeKey }
  );
  assert.equal(removeInexistent.ok, false);

  // lore_remove: sem id nem query retorna missing-target
  const removeNoTarget = await executor.execute(
    { name: 'lore_remove', arguments: {} },
    { scopeKey }
  );
  assert.equal(removeNoTarget.ok, false);
  assert.equal(removeNoTarget.reason, 'missing-target');
});

test('persona agent: proteção cross-scope em lore_update e lore_remove impede alteração e deleção entre grupos', async () => {
  const memoryRepository = createFunMemoryRepository({ getDatabase: getDb });
  const executor = createPersonaToolExecutor({
    chaosService: createChaosService({
      repository: { getLeaderboard: () => [] },
    }),
    memoryRepository,
  });

  const scopeA = uniqueGroup();
  const scopeB = uniqueGroup();

  // Cria fato no Grupo A
  const addA = await executor.execute(
    { name: 'lore_add', arguments: { summary: 'Fato secreto do Grupo A', kind: 'event' } },
    { scopeKey: scopeA }
  );
  assert.equal(addA.ok, true);
  const factIdA = addA.data.id;

  // Cria fato no Grupo B
  const addB = await executor.execute(
    { name: 'lore_add', arguments: { summary: 'Fato legítimo do Grupo B', kind: 'event' } },
    { scopeKey: scopeB }
  );
  assert.equal(addB.ok, true);
  const factIdB = addB.data.id;

  // Tentativa do Grupo B de atualizar o fato do Grupo A via ID
  const crossUpdate = await executor.execute(
    { name: 'lore_update', arguments: { id: factIdA, summary: 'Tentativa de overwrite hacker' } },
    { scopeKey: scopeB }
  );
  assert.equal(crossUpdate.ok, false);
  assert.equal(crossUpdate.reason, 'not-found');
  assert.equal(crossUpdate.text, 'Não encontrei nenhum fato correspondente na lore para atualizar.');

  // Verifica que o Fato A no Grupo A está intacto
  const factACheck = memoryRepository.getFact(factIdA);
  assert.equal(factACheck.summary, 'Fato secreto do Grupo A');
  assert.equal(factACheck.scopeKey, scopeA);

  // Tentativa do Grupo B de deletar o fato do Grupo A via ID
  const crossRemove = await executor.execute(
    { name: 'lore_remove', arguments: { id: factIdA } },
    { scopeKey: scopeB }
  );
  assert.equal(crossRemove.ok, false);
  assert.equal(crossRemove.reason, 'not-found');
  assert.equal(crossRemove.text, 'Fato não encontrado para remoção.');

  // Verifica que o Fato A no Grupo A continua existindo
  const factAStillExists = memoryRepository.getFact(factIdA);
  assert.ok(factAStillExists);
  assert.equal(factAStillExists.summary, 'Fato secreto do Grupo A');

  // Verifica que o Fato B no Grupo B continua existindo e intocado
  const factBCheck = memoryRepository.getFact(factIdB);
  assert.ok(factBCheck);
  assert.equal(factBCheck.summary, 'Fato legítimo do Grupo B');
});

test('persona agent: argumentos vazios {} em lore_update e lore_remove retornam missing-target', async () => {
  const memoryRepository = createFunMemoryRepository({ getDatabase: getDb });
  const executor = createPersonaToolExecutor({
    chaosService: createChaosService({
      repository: { getLeaderboard: () => [] },
    }),
    memoryRepository,
  });
  const scopeKey = uniqueGroup();

  const add = await executor.execute(
    { name: 'lore_add', arguments: { summary: 'Fato base do grupo' } },
    { scopeKey }
  );
  assert.equal(add.ok, true);
  const initialFact = memoryRepository.getFact(add.data.id);

  // lore_update com args vazios {}
  const emptyUpdate = await executor.execute(
    { name: 'lore_update', arguments: {} },
    { scopeKey }
  );
  assert.equal(emptyUpdate.ok, false);
  assert.equal(emptyUpdate.reason, 'missing-target');
  assert.equal(emptyUpdate.text, 'Informe o ID ou um termo de busca para localizar o fato que deseja atualizar.');

  // lore_remove com args vazios {}
  const emptyRemove = await executor.execute(
    { name: 'lore_remove', arguments: {} },
    { scopeKey }
  );
  assert.equal(emptyRemove.ok, false);
  assert.equal(emptyRemove.reason, 'missing-target');
  assert.equal(emptyRemove.text, 'Informe o ID ou um termo de busca para identificar o fato que deseja remover da lore.');

  // Nada foi alterado ou removido no banco
  const checkFact = memoryRepository.getFact(add.data.id);
  assert.ok(checkFact);
  assert.equal(checkFact.summary, initialFact.summary);
});

test('persona agent: busca de lore com normalização de acentos e diacríticos em português', async () => {
  const memoryRepository = createFunMemoryRepository({ getDatabase: getDb });
  const executor = createPersonaToolExecutor({
    chaosService: createChaosService({
      repository: { getLeaderboard: () => [] },
    }),
    memoryRepository,
  });
  const scopeKey = uniqueGroup();

  // Adiciona fato com acentuação rica
  const add = await executor.execute(
    { name: 'lore_add', arguments: { summary: 'João foi promovido a líder da bagunça no São João de Campina Grande' } },
    { scopeKey }
  );
  assert.equal(add.ok, true);
  const factId = add.data.id;

  // Busca sem acento ("joao") encontra fato com acento ("João")
  const searchSemAcento = await executor.execute(
    { name: 'lore', arguments: { query: 'joao' } },
    { scopeKey }
  );
  assert.equal(searchSemAcento.ok, true);
  assert.equal(searchSemAcento.data.length, 1);
  assert.equal(searchSemAcento.data[0].id, factId);
  assert.match(searchSemAcento.text, /João foi promovido/);

  // Busca com acento ("João") encontra fato com acento
  const searchComAcento = await executor.execute(
    { name: 'lore', arguments: { query: 'João' } },
    { scopeKey }
  );
  assert.equal(searchComAcento.ok, true);
  assert.equal(searchComAcento.data.length, 1);
  assert.equal(searchComAcento.data[0].id, factId);

  // Busca "lider" encontra "líder"
  const searchLider = await executor.execute(
    { name: 'lore', arguments: { query: 'lider' } },
    { scopeKey }
  );
  assert.equal(searchLider.ok, true);
  assert.equal(searchLider.data.length, 1);
  assert.equal(searchLider.data[0].id, factId);
});

test('persona agent: lore trace visibility expõe IDs e resumos no summary da tool', async () => {
  const memoryRepository = createFunMemoryRepository({ getDatabase: getDb });
  const executor = createPersonaToolExecutor({
    chaosService: createChaosService({
      repository: { getLeaderboard: () => [] },
    }),
    memoryRepository,
  });
  const scopeKey = uniqueGroup();

  const add1 = await executor.execute(
    { name: 'lore_add', arguments: { summary: 'Lucas perdeu a chave da moto no churrasco' } },
    { scopeKey }
  );
  const add2 = await executor.execute(
    { name: 'lore_add', arguments: { summary: 'Mariana comeu 14 fatias de pizza sozinha' } },
    { scopeKey }
  );
  const id1 = add1.data.id;
  const id2 = add2.data.id;

  // Busca com resultados
  const search = await executor.execute(
    { name: 'lore', arguments: { query: 'moto' } },
    { scopeKey }
  );
  assert.equal(search.ok, true);
  assert.match(search.summary, /^Fatos encontrados na lore:\n/);
  assert.match(search.summary, new RegExp(`• \\[id: ${id1}\\] Lucas perdeu a chave da moto no churrasco`));

  // Busca sem resultados
  const searchEmpty = await executor.execute(
    { name: 'lore', arguments: { query: 'termo_completamente_inexistente_xyz' } },
    { scopeKey }
  );
  assert.equal(searchEmpty.ok, true);
  assert.equal(searchEmpty.summary, 'Nenhum fato encontrado na lore.');
});

test('persona agent: mapeamento de categorias em português para kinds válidos em lore_add', async () => {
  const memoryRepository = createFunMemoryRepository({ getDatabase: getDb });
  const executor = createPersonaToolExecutor({
    chaosService: createChaosService({
      repository: { getLeaderboard: () => [] },
    }),
    memoryRepository,
  });
  const scopeKey = uniqueGroup();

  const testCases = [
    { ptKind: 'piada', expected: 'running_gag' },
    { ptKind: 'mico', expected: 'epic_fail' },
    { ptKind: 'apelido', expected: 'nickname' },
    { ptKind: 'bordao', expected: 'catchphrase' },
    { ptKind: 'bordão', expected: 'catchphrase' },
    { ptKind: 'rivalidade', expected: 'rivalry' },
    { ptKind: 'ship', expected: 'ship_lore' },
    { ptKind: 'fofoca', expected: 'event' },
  ];

  for (const { ptKind, expected } of testCases) {
    const res = await executor.execute(
      { name: 'lore_add', arguments: { summary: `Teste de kind para ${ptKind}`, kind: ptKind } },
      { scopeKey }
    );
    assert.equal(res.ok, true, `Falha ao adicionar kind ${ptKind}`);
    const fact = memoryRepository.getFact(res.data.id);
    assert.equal(fact.kind, expected, `Kind ${ptKind} deveria ser mapeado para ${expected}`);
  }
});

test('funMemoryRepository: deleteFact com scopeKey respeita isolamento de grupo', () => {
  const memoryRepository = createFunMemoryRepository({ getDatabase: getDb });
  const scopeA = uniqueGroup();
  const scopeB = uniqueGroup();

  const factA = memoryRepository.insertFact({ scopeKey: scopeA, summary: 'Fato Grupo A' });
  const factB = memoryRepository.insertFact({ scopeKey: scopeB, summary: 'Fato Grupo B' });

  // Tentar deletar factA passando scopeB -> deve retornar false e não deletar
  const delCross = memoryRepository.deleteFact(factA.id, scopeB);
  assert.equal(delCross, false);
  assert.ok(memoryRepository.getFact(factA.id));

  // Deletar factA passando scopeA correto -> deve retornar true e deletar
  const delSameScope = memoryRepository.deleteFact(factA.id, scopeA);
  assert.equal(delSameScope, true);
  assert.equal(memoryRepository.getFact(factA.id), null);

  // Deletar factB sem passar scopeKey (modo legado/admin) -> deve deletar
  const delNoScope = memoryRepository.deleteFact(factB.id);
  assert.equal(delNoScope, true);
  assert.equal(memoryRepository.getFact(factB.id), null);
});

test('persona agent: resposta em texto livre sem envelope JSON é aceita e despachada como texto direto', async () => {
  const previous = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    let capturedOpts = null;
    const persona = createPersonaService({
      personaRepository: createFunPersonaRepository({ getDatabase: getDb }),
      groupRepository: createFunGroupRepository({ getDatabase: getDb }),
      personaToolExecutor: {
        execute: async () => ({ ok: true }),
      },
      generateZen: async (opts) => {
        capturedOpts = opts;
        return 'KKKKKKKKKK EDUARDO, TU VAI DIGITAR “YESTE” ATÉ 2050, É, FILHO DA PUTA? 😭🤖📡';
      },
    });

    const sent = [];
    const scopeKey = uniqueGroup();
    const result = await persona.tryRespond({
      scopeKey,
      authorJid: uniqueJid('5511'),
      text: 'bot, yeste',
      messageType: 'text',
      sock: {
        user: { id: '5511888888888:0@s.whatsapp.net' },
        sendMessage: async (_jid, content) => {
          sent.push(content);
          return { key: { id: `resp-${sent.length}` } };
        },
      },
      identityMap: createIdentityMap(),
      funConfig: { ...DEFAULT_FUN_CONFIG, personaToolsEnabled: true },
      now: 1_000_000,
    });

    assert.equal(result.responded, true);
    assert.equal(capturedOpts.jsonOnly, false);
    assert.equal(sent.length, 1);
    assert.match(sent[0].text, /EDUARDO, TU VAI DIGITAR “YESTE”/);
  } finally {
    if (previous === undefined) process.env.FUN_DISABLE_LIVE_LLM = '1';
    else process.env.FUN_DISABLE_LIVE_LLM = previous;
  }
});

test('persona agent: lore_remove detecta fato recém-removido (race condition de loreReconciliation)', async () => {
  const memoryRepository = createFunMemoryRepository({ getDatabase: getDb });
  const { createGroupMemoryService } = await import('../fun/services/groupMemoryService.js');
  const groupMemoryService = createGroupMemoryService({ memoryRepository });
  const chaos = createChaosService({ repository: { getLeaderboard: () => [] } });
  const executor = createPersonaToolExecutor({
    chaosService: chaos,
    memoryRepository,
    groupMemoryService,
  });

  const scopeKey = uniqueGroup();
  const fact = memoryRepository.insertFact({
    scopeKey,
    summary: 'Eduardo sonha em dirigir Bugatti em reta infinita com combustivel infinito',
    kind: 'running_gag',
  });

  // Simula loreReconciliationService deletando o fato e registrando remoção recente
  memoryRepository.deleteFact(fact.id, scopeKey);
  groupMemoryService.recordRecentRemoval(scopeKey, fact);

  // Persona chama lore_remove por query logo em seguida
  const resultQuery = await executor.execute(
    { name: 'lore_remove', arguments: { query: 'Bugatti em reta infinita' } },
    { scopeKey }
  );
  assert.equal(resultQuery.ok, true);
  assert.match(resultQuery.summary, /Bugatti/i);
  assert.match(resultQuery.summary, /já removido recentemente|Removeu da lore/i);

  // Persona chama lore_remove por ID do fato já deletado
  const resultId = await executor.execute(
    { name: 'lore_remove', arguments: { id: fact.id } },
    { scopeKey }
  );
  assert.equal(resultId.ok, true);
  assert.match(resultId.summary, /já removido recentemente|Removeu fato/i);
});

test('persona agent: lore_remove de fato inexistente retorna ok false com summary informativo (sem erro genérico)', async () => {
  const memoryRepository = createFunMemoryRepository({ getDatabase: getDb });
  const { createGroupMemoryService } = await import('../fun/services/groupMemoryService.js');
  const groupMemoryService = createGroupMemoryService({ memoryRepository });
  const chaos = createChaosService({ repository: { getLeaderboard: () => [] } });
  const executor = createPersonaToolExecutor({
    chaosService: chaos,
    memoryRepository,
    groupMemoryService,
  });

  const scopeKey = uniqueGroup();
  const result = await executor.execute(
    { name: 'lore_remove', arguments: { query: 'cachorro na bunda' } },
    { scopeKey }
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not-found');
  assert.notEqual(result.summary, 'Falha ao remover da lore');
  assert.match(result.summary, /fato encontrado na lore sobre "cachorro na bunda"/i);
});
