import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersonaMemoryHarness } from './helpers/funPersonaMemoryTestHarness.js';
import { createMemoryDecayService } from '../fun/services/memoryDecayService.js';

test('contexto mantém fatos confirmados separados de sinais inferidos', async () => {
  const h = await createPersonaMemoryHarness();
  const now = 10_000;
  const scopeKey = `facts-${Date.now()}@g.us`;
  h.memory.create({ scopeKey, factText: 'Ana confirmou que gosta de filmes', confidence: 0.9, confirmationLevel: 'explicit', keywords: ['filmes'], now });
  h.memory.create({ scopeKey, factText: 'Ana talvez goste de terror', confidence: 0.8, confirmationLevel: 'inferred', keywords: ['terror'], now });
  const pack = h.personaContextService.build({ scopeKey, text: 'filmes terror', authorJid: 'ana@s.whatsapp.net', occurredAt: now });
  assert.deepEqual(pack.confirmedFacts.map((memory) => memory.factText), ['Ana confirmou que gosta de filmes']);
  assert.deepEqual(pack.inferredSignals.map((memory) => memory.factText), ['Ana talvez goste de terror']);
});

test('reconciliação prioriza evidência e depois recência, suprimindo contraditório no mesmo scope', async () => {
  const h = await createPersonaMemoryHarness();
  const scopeKey = `reconcile-${Date.now()}@g.us`;
  const base = { scopeKey, subjectUserJid: 'ana@s.whatsapp.net', factKey: 'status', confidence: 0.9, expiresAt: 99_999 };
  const old = h.memory.create({ ...base, id: 'old', factText: 'Ana mora no Rio', confirmationLevel: 'explicit', now: 1_000 }).memory;
  const winner = h.memory.create({ ...base, id: 'new', factText: 'Ana mora em SP', confirmationLevel: 'corroborated', now: 2_000 }).memory;
  const result = createMemoryDecayService({ conversationMemoryRepository: h.memory }).reconcile({ scopeKey, subjectUserJid: base.subjectUserJid, factKey: base.factKey, now: 3_000 });
  assert.equal(result.winner.id, winner.id);
  assert.deepEqual(result.suppressedIds, [old.id]);
  assert.deepEqual(h.memory.listRankable({ scopeKey, now: 3_000 }).map((memory) => memory.id), [winner.id]);
});
