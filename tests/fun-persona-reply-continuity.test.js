import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersonaMemoryHarness } from './helpers/funPersonaMemoryTestHarness.js';

test('reply seleciona a thread citada, não a thread mais recente paralela', async () => {
  const h = await createPersonaMemoryHarness();
  const now = 50_000;
  h.threads.upsert({ scopeKey: 'reply@g.us', threadKey: 'cinema', anchorMessageId: 'm-cinema', topicSummary: 'filme antigo', now, expiresAt: now + 10_000 });
  h.threads.upsert({ scopeKey: 'reply@g.us', threadKey: 'jogo', anchorMessageId: 'm-jogo', topicSummary: 'partida online', now: now + 1, expiresAt: now + 10_000 });
  h.threadContextService.anchorResponse({ scopeKey: 'reply@g.us', threadKey: 'cinema', anchorMessageId: 'bot-cinema', now: now + 2 });
  h.threadContextService.anchorResponse({ scopeKey: 'reply@g.us', threadKey: 'jogo', anchorMessageId: 'bot-jogo', now: now + 3 });
  h.memory.create({ scopeKey: 'reply@g.us', threadKey: 'cinema', factText: 'assunto: filme antigo', confidence: 0.8, confirmationLevel: 'explicit', keywords: ['filme'], now });
  h.memory.create({ scopeKey: 'reply@g.us', threadKey: 'jogo', factText: 'assunto: partida online', confidence: 1, confirmationLevel: 'explicit', keywords: ['partida'], now });
  const pack = h.personaContextService.build({ scopeKey: 'reply@g.us', text: 'qual filme?', quotedMessageId: 'bot-cinema', occurredAt: now + 4 });
  assert.equal(pack.threadContext.threadKey, 'cinema');
  assert.equal(pack.threadSource, 'reply');
  assert.equal(pack.confirmedFacts[0].factText, 'assunto: filme antigo');
});
