import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersonaMemoryHarness } from './helpers/funPersonaMemoryTestHarness.js';
import { createSocialMemoryService } from '../fun/services/socialMemoryService.js';

test('identidade no pacote de contexto é local ao grupo', async () => {
  const h = await createPersonaMemoryHarness();
  const scopeA = `identity-a-${Date.now()}@g.us`;
  const scopeB = `identity-b-${Date.now()}@g.us`;
  h.personaIdentityService.refresh({ scopeKey: scopeA, voiceStyle: ['irônico'], groupLoreSummary: 'piadas internas' });
  h.personaIdentityService.refresh({ scopeKey: scopeB, voiceStyle: ['calmo'], groupLoreSummary: 'conversa tranquila' });
  const packA = h.personaContextService.build({ scopeKey: scopeA, text: 'bot oi', occurredAt: 1_000 });
  const packB = h.personaContextService.build({ scopeKey: scopeB, text: 'bot oi', occurredAt: 1_000 });
  assert.deepEqual(packA.groupIdentity.voiceStyle, ['irônico']);
  assert.deepEqual(packB.groupIdentity.voiceStyle, ['calmo']);
});

test('sinais sociais grupais derivam estilos distintos sem reter dados pessoais', async () => {
  const service = createSocialMemoryService();
  const humorous = service.toIdentityInput(service.observe({ scopeKey: 'a@g.us', authorJid: 'ana@s.whatsapp.net', text: 'kkkk esse meme foi ótimo' }));
  const helpful = service.toIdentityInput(service.observe({ scopeKey: 'b@g.us', authorJid: 'bia@s.whatsapp.net', text: 'obrigado pela ajuda na dúvida' }));
  const sensitive = service.observe({ scopeKey: 'a@g.us', authorJid: 'ana@s.whatsapp.net', text: 'meu cpf é 123' });
  assert.deepEqual(humorous.voiceStyle, ['bem-humorado', 'leve']);
  assert.deepEqual(helpful.voiceStyle, ['prestativo', 'respeitoso']);
  assert.deepEqual(sensitive, { scopeKey: 'a@g.us', participants: [], topic: '', style: [] });
});
