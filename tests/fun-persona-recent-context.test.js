import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createFunPersonaRecentMessageRepository } from '../fun/db/funPersonaRecentMessageRepository.js';
import { createPersonaAutonomyPolicy } from '../fun/services/personaAutonomyPolicy.js';
import { parsePersonaEnvelope } from '../fun/services/personaToolProtocol.js';

await initDb();

function uniqueScope() {
  return `persona-recent-${Date.now()}-${Math.floor(Math.random() * 1e6)}@g.us`;
}

test('persona recent context persists, orders messages and excludes current message', () => {
  const repository = createFunPersonaRecentMessageRepository({ getDatabase: getDb });
  const scopeKey = uniqueScope();
  repository.recordMessage({ scopeKey, messageId: 'm1', authorJid: 'ana@s.whatsapp.net', authorLabel: 'Ana', text: 'o filme era muito ruim', now: 100 });
  repository.recordMessage({ scopeKey, messageId: 'm2', authorJid: 'bia@s.whatsapp.net', authorLabel: 'Bia', text: 'pior que era mesmo', now: 101 });
  repository.recordMessage({ scopeKey, messageId: 'm3', authorJid: 'caio@s.whatsapp.net', authorLabel: 'Caio', text: 'bot opina ai', now: 102 });

  const messages = repository.listRecentBefore(scopeKey, { beforeAt: 102, beforeMessageId: 'm3', windowMs: 10_000, limit: 10 });
  assert.deepEqual(messages.map((message) => message.messageId), ['m1', 'm2']);
  assert.equal(messages[0].authorLabel, 'Ana');
});

test('persona autonomy defaults to explicit and natural mode obeys budget', () => {
  const policy = createPersonaAutonomyPolicy({ now: () => 1_000_000 });
  const explicit = policy.evaluate({ scopeKey: 'a@g.us', text: 'quem vai no churrasco?', funConfig: {} });
  assert.equal(explicit.eligible, false);

  const config = {
    personaAutonomyEnabled: true,
    personaAutonomyMode: 'natural',
    personaAutonomyMinScore: 1,
    personaAutonomyMaxPerHour: 1,
    personaAutonomyMaxPerDay: 1,
    personaAutonomyCooldownMs: 60_000,
    worldQuietHoursEnabled: false,
  };
  const first = policy.evaluate({ scopeKey: 'a@g.us', text: 'gente quem vai no churrasco?', immediateContext: [{ text: 'vai ter churrasco' }], funConfig: config, currentNow: 1_000_000 });
  assert.equal(first.eligible, true);
  policy.recordSent('a@g.us', 1_000_000);
  const second = policy.evaluate({ scopeKey: 'a@g.us', text: 'gente quem vai no churrasco?', immediateContext: [{ text: 'vai ter churrasco' }], funConfig: config, currentNow: 1_100_000 });
  assert.equal(second.eligible, false);
});

test('persona tool protocol validates strict arguments and accepts read tools', () => {
  assert.equal(parsePersonaEnvelope('{"type":"tool_call","name":"group_identity","arguments":{}}').ok, true);
  assert.equal(parsePersonaEnvelope('{"type":"tool_call","name":"group_identity","arguments":{"extra":true}}').reason, 'unknown-argument');
  assert.equal(parsePersonaEnvelope('{"type":"tool_call","name":"ship","arguments":{"mode":"inventado"}}').reason, 'invalid-mode');
  assert.equal(parsePersonaEnvelope('{"type":"actions","actions":[{"type":"react","emoji":"abc"}]}').reason, 'empty-actions');
});
