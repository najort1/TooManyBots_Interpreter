import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersonaMemoryHarness } from './helpers/funPersonaMemoryTestHarness.js';
import { createMemoryIngestionService } from '../fun/services/memoryIngestionService.js';

test('ingestão classifica fato explícito, repetição corroborada e não duplica', async () => {
  const h = await createPersonaMemoryHarness();
  const service = createMemoryIngestionService({ conversationMemoryRepository: h.memory });
  const event = { scopeKey: `ingest-${Date.now()}@g.us`, authorJid: 'ana@s.whatsapp.net', text: 'eu gosto de pizza', occurredAt: 1_000 };
  assert.equal(service.observe(event).memory.memoryType, 'semantic');
  const repeated = service.observe({ ...event, occurredAt: 2_000 });
  const memories = h.memory.listRankable({ scopeKey: event.scopeKey, now: 2_000 });
  assert.equal(memories.length, 1);
  assert.equal(repeated.memory.confirmationLevel, 'corroborated');
  assert.equal(memories[0].usageCount, 1);
});

test('ingestão classifica sinais inferidos, interação social e evento episódico', async () => {
  const h = await createPersonaMemoryHarness();
  const service = createMemoryIngestionService({ conversationMemoryRepository: h.memory });
  const scopeKey = `classes-${Date.now()}@g.us`;
  const inferred = service.observe({ scopeKey, authorJid: 'ana@s.whatsapp.net', text: 'talvez eu gosto de terror', messageId: 'i', occurredAt: 1_000 });
  const social = service.observe({ scopeKey, authorJid: 'ana@s.whatsapp.net', mentionedJids: ['bia@s.whatsapp.net'], text: 'bia viu isso', messageId: 's', occurredAt: 2_000 });
  const episodic = service.observe({ scopeKey, authorJid: 'ana@s.whatsapp.net', text: 'a reunião começa agora', messageId: 'e', occurredAt: 3_000 });
  assert.deepEqual([inferred.memory.confirmationLevel, social.memory.memoryType, episodic.memory.memoryType], ['inferred', 'social', 'episodic']);
});

test('ingestão recusa conteúdo sensível sem persistir', async () => {
  const h = await createPersonaMemoryHarness();
  const service = createMemoryIngestionService({ conversationMemoryRepository: h.memory });
  const scopeKey = `sensitive-${Date.now()}@g.us`;
  assert.deepEqual(service.observe({ scopeKey, authorJid: 'ana@s.whatsapp.net', text: 'eu gosto de senha: segredo' }), { ok: false, reason: 'sensitive' });
  assert.equal(h.memory.listRankable({ scopeKey }).length, 0);
});
