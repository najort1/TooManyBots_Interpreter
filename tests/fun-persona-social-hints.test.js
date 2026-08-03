import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createFunPersonaSocialHintRepository } from '../fun/db/funPersonaSocialHintRepository.js';
import { createPersonaSocialHintService } from '../fun/services/personaSocialHintService.js';

await initDb();

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

const alice = '5511999990001@s.whatsapp.net';
const bob = '5511999990002@s.whatsapp.net';
const cfg = {
  zenEnabled: true,
  personaSocialHintsEnabled: true,
  personaSocialHintsBatchSize: 8,
  personaSocialHintsMinMessages: 3,
  personaSocialHintsFlushIntervalMs: 10 * 60_000,
  personaSocialHintsMaxChars: 160,
};

test('pistas sociais: lote LLM mapeia índices para JIDs e recupera seletivamente por scope', async () => {
  const calls = [];
  const repository = createFunPersonaSocialHintRepository({ getDatabase: getDb });
  const service = createPersonaSocialHintService({
    repository,
    getContactDisplayName: (jid) => jid === alice ? 'Alice Real' : 'Bob Real',
    generateZen: async (input) => {
      calls.push(input);
      return JSON.stringify({ hints: [
        { participants: [0], hint: 'costuma puxar meme do café', confidence: 88, socialSignal: 'positive' },
        { participants: [2], hint: 'entra na brincadeira do café', confidence: 74, socialSignal: 'positive' },
      ] });
    },
  });
  const scope = uniqueGroup();
  service.observeMessage({ scopeKey: scope, userJid: alice, text: 'cadê o café?', funConfig: cfg, now: 1 });
  service.observeMessage({ scopeKey: scope, userJid: bob, text: 'o café sumiu de novo', funConfig: cfg, now: 2 });
  service.observeMessage({ scopeKey: scope, userJid: bob, text: 'kkkk chama a Alice', funConfig: cfg, now: 3 });

  const result = await service.flushScope(scope, cfg, 4);
  assert.equal(result.ok, true);
  assert.equal(result.saved, 2);
  assert.equal(calls.length, 1);
  assert.match(calls[0].prompt, /Alice Real/);
  assert.match(calls[0].prompt, /Bob Real/);
  const aliceHints = service.getHints(scope, [alice]);
  assert.deepEqual(aliceHints.map((hint) => hint.participantJid), [alice]);
  assert.equal(aliceHints[0].confidence, 88);
  assert.equal(aliceHints[0].socialSignal, 'positive');
  assert.equal(service.getHints(scope, ['5511999999999@s.whatsapp.net']).length, 0);
});

test('pistas sociais: observação agenda lote sem aguardar LLM', async () => {
  let resolveLlm;
  const pending = new Promise((resolve) => { resolveLlm = resolve; });
  const service = createPersonaSocialHintService({
    repository: createFunPersonaSocialHintRepository({ getDatabase: getDb }),
    generateZen: () => pending,
  });
  const scope = uniqueGroup();
  const first = service.observeMessage({ scopeKey: scope, userJid: alice, text: 'texto um', funConfig: cfg, now: 1 });
  const second = service.observeMessage({ scopeKey: scope, userJid: alice, text: 'texto dois', funConfig: cfg, now: 2 });
  const third = service.observeMessage({ scopeKey: scope, userJid: alice, text: 'texto três', funConfig: cfg, now: 10 * 60_000 + 1 });
  assert.equal(first.flushScheduled, false);
  assert.equal(second.flushScheduled, false);
  assert.equal(third.flushScheduled, true);
  resolveLlm('{"hints":[]}');
});
