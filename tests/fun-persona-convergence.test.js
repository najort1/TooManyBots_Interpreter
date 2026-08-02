import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersonaMemoryHarness } from './helpers/funPersonaMemoryTestHarness.js';

test('métricas mensuram continuidade por reply, fatos e isolamento de grupo', async () => {
  const h = await createPersonaMemoryHarness();
  const scopeA = `convergence-a-${Date.now()}@g.us`;
  const scopeB = `convergence-b-${Date.now()}@g.us`;
  const now = 10_000;
  h.memory.create({ scopeKey: scopeA, threadKey: 'thread-a', factText: 'Ana gosta de filmes', confidence: 0.9, confirmationLevel: 'corroborated', keywords: ['filmes'], now });
  h.memory.create({ scopeKey: scopeA, threadKey: 'thread-b', factText: 'Ana talvez goste de terror', confidence: 0.6, confirmationLevel: 'inferred', keywords: ['terror'], now });
  h.memory.create({ scopeKey: scopeB, threadKey: 'thread-a', factText: 'vazamento proibido', confidence: 1, confirmationLevel: 'corroborated', keywords: ['filmes'], now });
  const metrics = h.memoryRetrievalService.getMetrics({ scopeKey: scopeA, text: 'filmes terror', threadContext: { threadKey: 'thread-a' }, participants: ['ana@s.whatsapp.net'], now });
  assert.deepEqual(metrics, { scopeKey: scopeA, selectedCount: 2, confirmedCount: 1, inferredCount: 1, socialCount: 0, discardedCount: 0, replyContinuity: true, isolated: true });
});
