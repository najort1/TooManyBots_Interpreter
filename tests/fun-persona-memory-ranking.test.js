import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersonaMemoryHarness } from './helpers/funPersonaMemoryTestHarness.js';

test('retrieval separa confirmação, inferência, memória sensível e escopo', async () => {
  const h = await createPersonaMemoryHarness();
  const now = 2_000_000;
  const add = (entry) => h.memory.create({ scopeKey: 'a@g.us', factText: entry.factText, confidence: entry.confidence || 0.9, confirmationLevel: entry.confirmationLevel || 'explicit', sensitivityLevel: entry.sensitivityLevel || 'safe', keywords: ['pizza'], now });
  add({ factText: 'Ana gosta de pizza' });
  add({ factText: 'Ana talvez ame pizza', confirmationLevel: 'inferred' });
  add({ factText: 'segredo pizza', sensitivityLevel: 'sensitive' });
  h.memory.create({ scopeKey: 'b@g.us', factText: 'leak', confidence: 1, confirmationLevel: 'explicit', keywords: ['pizza'], now });
  const result = h.memoryRetrievalService.retrieve({ scopeKey: 'a@g.us', text: 'pizza', now });
  assert.equal(result.confirmedFacts.length, 1);
  assert.equal(result.inferredSignals.length, 1);
  assert.equal(result.selectedMemoryIds.length, 2);
  assert.ok(!result.confirmedFacts.some((memory) => memory.factText === 'leak'));
});

test('anti-leak: identidade e memória do grupo A não aparecem no contexto do grupo B', async () => {
  const h = await createPersonaMemoryHarness();
  const scopeA = 'anti-leak-a@g.us';
  const scopeB = 'anti-leak-b@g.us';
  h.memory.create({ scopeKey: scopeA, factText: 'Ana coleciona discos raros', confidence: 1, confirmationLevel: 'explicit', keywords: ['discos'], now: 1_000 });
  h.personaIdentityService.refresh({ scopeKey: scopeA, voiceStyle: ['nostálgico'], groupLoreSummary: 'vinil todo domingo', now: 1_000 });
  const pack = h.personaContextService.build({ scopeKey: scopeB, text: 'discos', occurredAt: 1_001 });
  assert.deepEqual(pack.confirmedFacts, []);
  assert.deepEqual(pack.inferredSignals, []);
  assert.deepEqual(pack.groupIdentity.voiceStyle, []);
  assert.equal(pack.groupIdentity.groupLoreSummary, '');
});
