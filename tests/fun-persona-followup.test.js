import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { DEFAULT_FUN_CONFIG } from '../fun/constants.js';
import { createFunGroupRepository } from '../fun/db/funGroupRepository.js';
import { createFunPersonaRepository } from '../fun/db/funPersonaRepository.js';
import { createFunPersonaFollowupRepository } from '../fun/db/funPersonaFollowupRepository.js';
import { createPersonaService } from '../fun/services/personaService.js';
import { createIdentityMap } from '../fun/utils/identity.js';
import { createFunPersonaRecentMessageRepository } from '../fun/db/funPersonaRecentMessageRepository.js';
import { parseFollowupEnvelope } from '../fun/services/personaToolProtocol.js';
import { createPersonaFollowupService } from '../fun/services/personaFollowupService.js';

await initDb();

function uniqueScope() {
  return `persona-followup-${Date.now()}-${Math.floor(Math.random() * 1e6)}@g.us`;
}

function config(overrides = {}) {
  return {
    ...DEFAULT_FUN_CONFIG,
    worldQuietHoursEnabled: false,
    personaFollowupEnabled: true,
    personaFollowupSilenceMs: 60_000,
    personaFollowupMaxCandidates: 20,
    zenEnabled: true,
    ...overrides,
  };
}

test('follow-up protocol only accepts a listed reply target', () => {
  const allowed = ['m-1', 'm-2'];
  const yes = parseFollowupEnvelope('{"type":"follow_up","replyToMessageId":"m-2","text":"kkkk eu vi"}', { allowedReplyMessageIds: allowed });
  assert.equal(yes.ok, true);
  assert.equal(yes.envelope.replyToMessageId, 'm-2');
  assert.equal(parseFollowupEnvelope('{"type":"ignore"}', { allowedReplyMessageIds: allowed }).envelope.type, 'ignore');
  assert.equal(
    parseFollowupEnvelope('{"type":"follow_up","replyToMessageId":"foreign","text":"oi"}', { allowedReplyMessageIds: allowed }).reason,
    'invalid-reply-target'
  );
});

test('follow-up repository debounces, claims once and recovers expired lease', () => {
  const repository = createFunPersonaFollowupRepository({ getDatabase: getDb });
  const scopeKey = uniqueScope();
  repository.startTurn({ scopeKey, anchorMessageId: 'bot-1', anchorAt: 1_000, now: 1_000 });
  repository.observeHumanMessage({ scopeKey, messageId: 'human-1', now: 20_000 });
  repository.observeHumanMessage({ scopeKey, messageId: 'human-2', now: 50_000 });
  assert.equal(repository.listDue({ now: 109_999, silenceMs: 60_000 }).length, 0);
  assert.equal(repository.listDue({ now: 110_000, silenceMs: 60_000 })[0].lastHumanMessageId, 'human-2');
  assert.equal(repository.claim({ scopeKey, expectedHumanMessageId: 'human-2', now: 110_000, leaseMs: 20_000 }).ok, true);
  assert.equal(repository.claim({ scopeKey, expectedHumanMessageId: 'human-2', now: 110_001 }).ok, false);
  assert.equal(repository.claim({ scopeKey, expectedHumanMessageId: 'human-2', now: 130_001 }).ok, true);
});

test('reply to a sent follow-up continues the persona thread', async () => {
  const previous = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    const scopeKey = uniqueScope();
    const personaRepository = createFunPersonaRepository({ getDatabase: getDb });
    const groupRepository = createFunGroupRepository({ getDatabase: getDb });
    const identityMap = createIdentityMap();
    const sent = [];
    let generation = 0;
    const service = createPersonaService({
      personaRepository,
      groupRepository,
      generateZen: async () => {
        generation += 1;
        return generation === 1
          ? '{"type":"follow_up","replyToMessageId":"human-1","text":"eu conheço sim kk, a família da zoeira sempre cresce por aqui"}'
          : 'Dudu Bot é meu nome completo';
      },
    });
    const sock = {
      user: { id: '174994885714120:0@s.whatsapp.net', lid: '174994885714120@lid' },
      sendMessage: async (_jid, content, options) => {
        sent.push({ content, options });
        return { key: { id: `bot-${sent.length}` } };
      },
    };
    const followup = await service.tryIdleFollowUp({
      scopeKey,
      candidates: [{
        messageId: 'human-1', authorJid: '86616773246992@lid', authorLabel: 'Ana',
        text: 'oxi o bot acha que sou primo dele',
      }],
      sock,
      funConfig: config(),
      now: 10_000,
    });
    assert.equal(followup.responded, true, JSON.stringify(followup));
    assert.equal(followup.responseMessageIds[0], 'bot-1');
    assert.equal(sent[0].options.quoted.key.id, 'human-1');

    const reply = await service.tryRespond({
      scopeKey,
      authorJid: '86616773246992@lid',
      text: 'qual seu nome completo?',
      messageType: 'extended-text',
      quotedParticipant: '174994885714120@lid',
      quotedMessageId: 'bot-1',
      quotedText: 'eu conheço sim kk, a família da zoeira sempre cresce por aqui',
      sock,
      identityMap,
      funConfig: config(),
      now: 20_000,
    });
    assert.equal(reply.responded, true, JSON.stringify(reply));
    assert.equal(reply.trigger, 'continuation');
    assert.equal(sent[1].content.text, 'Dudu Bot é meu nome completo');
  } finally {
    if (previous === undefined) process.env.FUN_DISABLE_LIVE_LLM = '1';
    else process.env.FUN_DISABLE_LIVE_LLM = previous;
  }
});

test('follow-up tick selects stored message and sends an exact quote once', async () => {
  const scopeKey = uniqueScope();
  const followupRepository = createFunPersonaFollowupRepository({ getDatabase: getDb });
  const recentRepository = createFunPersonaRecentMessageRepository({ getDatabase: getDb });
  const groupRepository = createFunGroupRepository({ getDatabase: getDb });
  const calls = [];
  const personaService = {
    tryIdleFollowUp: async (ctx) => {
      calls.push(ctx);
      return { responded: true, sourceMessageId: 'human-2' };
    },
  };
  const service = createPersonaFollowupService({
    followupRepository,
    personaRecentMessageRepository: recentRepository,
    personaService,
    groupRepository,
  });
  followupRepository.startTurn({ scopeKey, anchorMessageId: 'bot-1', anchorAt: 1_000, now: 1_000 });
  recentRepository.recordMessage({ scopeKey, messageId: 'human-1', authorJid: 'a@s.whatsapp.net', authorLabel: 'Ana', text: 'entendi', now: 2_000 });
  recentRepository.recordMessage({ scopeKey, messageId: 'human-2', authorJid: 'b@s.whatsapp.net', authorLabel: 'Bia', text: 'mas ele falou sério?', now: 5_000 });
  service.observeHumanMessage({ scopeKey, messageId: 'human-1', now: 2_000 });
  service.observeHumanMessage({ scopeKey, messageId: 'human-2', now: 5_000 });

  const results = await service.tick({ sock: {}, funConfig: config(), now: 65_000 });
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].candidates.map((item) => item.messageId), ['human-1', 'human-2']);
  assert.equal(followupRepository.get(scopeKey).status, 'completed');
  assert.equal((await service.tick({ sock: {}, funConfig: config(), now: 130_000 })).length, 0);
});
