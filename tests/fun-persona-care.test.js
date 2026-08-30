/**
 * Persona: temporal awareness, criação natural de novos bordões, fact sanitizer, ingestion guard.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.FUN_DISABLE_LIVE_LLM = '1';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createFunPersonaRepository } from '../fun/db/funPersonaRepository.js';
import { createFunGroupRepository } from '../fun/db/funGroupRepository.js';
import { createPersonaService } from '../fun/services/personaService.js';
import { createIdentityMap } from '../fun/utils/identity.js';
import { createMemoryIngestionService } from '../fun/services/memoryIngestionService.js';
import { createFunConversationMemoryRepository } from '../fun/db/funConversationMemoryRepository.js';
import { isUsablePromptFact } from '../fun/utils/promptFactSanitizer.js';
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

function setup(cfg = baseConfig, deps = {}) {
  const personaRepository = createFunPersonaRepository({ getDatabase: getDb });
  const groupRepository = createFunGroupRepository({ getDatabase: getDb });
  const botJid = uniqueJid('5599');
  const sock = makeSock(botJid);
  const identityMap = createIdentityMap();
  const svc = createPersonaService({
    personaRepository,
    groupRepository,
    threadContextService: deps.threadContextService || null,
    personaSocialHintService: deps.personaSocialHintService,
    profileService: deps.profileService,
    generateZen: deps.generateZen,
    getLogger: () => null,
    random: () => 0.5,
  });
  return { svc, personaRepository, groupRepository, sock, botJid, identityMap, cfg };
}

// ============================================================
// Sanitizer unit
// ============================================================
test('sanitizer: descarta fatos corrompidos com "?" e meta-comentário', () => {
  assert.equal(isUsablePromptFact('Adora comer ? e não informa quem adora'), false);
  assert.equal(isUsablePromptFact('gosto:comer ?'), false);
  assert.equal(isUsablePromptFact('não informa quem adora'), false);
  assert.equal(isUsablePromptFact('sem informação disponível'), false);
  assert.equal(isUsablePromptFact('Nina gosta de pizza'), true);
  assert.equal(isUsablePromptFact('adora café'), true);
  assert.equal(isUsablePromptFact(''), false);
});

// ============================================================
// Ingestion guard: referência não resolvida
// ============================================================
test('ingestion: rejeita preferência com placeholder "?" ou "quem eu adoro"', async () => {
  const memRepo = createFunConversationMemoryRepository({ getDatabase: getDb });
  const svc = createMemoryIngestionService({ conversationMemoryRepository: memRepo, getLogger: () => null });

  const r1 = svc.observe({
    scopeKey: uniqueGroup(),
    authorJid: uniqueJid('5511'),
    text: 'gosto de comer ? e quem eu adoro',
    messageId: 'msg-unresolved-1',
  });
  assert.equal(r1.ok, false);
  assert.equal(r1.reason, 'unresolved-reference');

  const r2 = svc.observe({
    scopeKey: uniqueGroup(),
    authorJid: uniqueJid('5511'),
    text: 'eu amo pizza',
    messageId: 'msg-ok-1',
  });
  assert.equal(r2.ok, true);
});

// ============================================================
// Persona: fatos filtrados, bloco temporal, novos bordões
// ============================================================
test('persona: fatos corrompidos NÃO entram no system prompt; fatos bons entram', async () => {
  const previous = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    let request = null;
    const { svc, sock, identityMap, cfg } = setup(baseConfig, {
      generateZen: async (input) => {
        request = input;
        return 'tô por aqui';
      },
    });
    sock.sendMessage = async () => ({ key: { id: 'facts-1' } });

    await svc.tryRespond({
      scopeKey: uniqueGroup(),
      text: 'bot, fala aí',
      quotedText: '',
      authorJid: uniqueJid('5511'),
      sock,
      identityMap,
      funConfig: cfg,
      responseContextPack: {
        confirmedFacts: [
          { factText: 'Adora comer ? e não informa quem adora' }, // corrompido
          { factText: 'Nina coleciona DVDs antigos.' }, // bom
        ],
        inferredSignals: [],
        socialSignals: [],
        riskFlags: [],
      },
    });

    assert.ok(request);
    assert.ok(!/Adora comer \?/.test(request.system), 'fato corrompido NÃO aparece no system');
    assert.match(request.system, /Nina coleciona DVDs antigos/, 'fato bom aparece');
  } finally {
    if (previous === undefined) process.env.FUN_DISABLE_LIVE_LLM = '1';
    else process.env.FUN_DISABLE_LIVE_LLM = previous;
  }
});

test('persona: bloco temporal presente no system', async () => {
  const previous = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    let request = null;
    const { svc, sock, identityMap, cfg } = setup(baseConfig, {
      generateZen: async (input) => {
        request = input;
        return 'blz';
      },
    });
    sock.sendMessage = async () => ({ key: { id: 'temp-1' } });

    await svc.tryRespond({
      scopeKey: uniqueGroup(),
      text: 'bot, oi',
      quotedText: '',
      authorJid: uniqueJid('5511'),
      sock,
      identityMap,
      funConfig: cfg,
    });

    assert.ok(request);
    assert.match(request.system, /Agora é .+\((madrugada|manhã|tarde|noite)/);
  } finally {
    if (previous === undefined) process.env.FUN_DISABLE_LIVE_LLM = '1';
    else process.env.FUN_DISABLE_LIVE_LLM = previous;
  }
});

test('persona: permite criar novos bordões naturalmente e "folders" removido', async () => {
  const previous = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    let request = null;
    const { svc, sock, identityMap, cfg } = setup(baseConfig, {
      generateZen: async (input) => {
        request = input;
        return 'ok';
      },
    });
    sock.sendMessage = async () => ({ key: { id: 'bordao-1' } });

    await svc.tryRespond({
      scopeKey: uniqueGroup(),
      text: 'bot, algo',
      quotedText: '',
      authorJid: uniqueJid('5511'),
      sock,
      identityMap,
      funConfig: cfg,
    });

    assert.ok(request);
    assert.match(request.system, /você pode inventar novos bordões/i);
    assert.match(request.system, /sempre que a conversa pedir/i);
    assert.match(request.system, /nunca force a barra/i);
    assert.ok(!/não repita folders/i.test(request.system));
  } finally {
    if (previous === undefined) process.env.FUN_DISABLE_LIVE_LLM = '1';
    else process.env.FUN_DISABLE_LIVE_LLM = previous;
  }
});
