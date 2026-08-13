import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersonaMemoryHarness } from './helpers/funPersonaMemoryTestHarness.js';
import { createSocialMemoryService } from '../fun/services/socialMemoryService.js';
import { createPersonaContextService } from '../fun/services/personaContextService.js';

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

test('lore agora vem do extractor — socialMemory não escreve mais lore no identity', () => {
  const service = createSocialMemoryService();
  const single = service.toIdentityInput(
    service.observe({ scopeKey: 'a@g.us', authorJid: 'ana@s.whatsapp.net', text: 'fala que ele é menino com muitos o' })
  );
  assert.equal(single.groupLoreSummary, undefined, 'toIdentityInput não deve produzir lore');

  service.observe({ scopeKey: 'a@g.us', authorJid: 'ana@s.whatsapp.net', text: 'menino de novo ne' });
  service.observe({ scopeKey: 'a@g.us', authorJid: 'bia@s.whatsapp.net', text: 'esse menino nao para' });
  const observed = service.observe({ scopeKey: 'a@g.us', authorJid: 'bia@s.whatsapp.net', text: 'menino menino menino' });
  assert.match(observed.topic, /menino/, 'recorrência ainda é rastreada no observe()');
});

test('personaContext: lore do groupMemoryService sobrepõe a do identity', async () => {
  const h = await createPersonaMemoryHarness();
  const scope = `lore-${Date.now()}@g.us`;
  h.personaIdentityService.refresh({ scopeKey: scope, voiceStyle: ['irônico'], groupLoreSummary: 'Temas recorrentes: trabalhar' });
  const withLore = createPersonaContextService({
    threadContextService: h.threadContextService,
    memoryRetrievalService: h.memoryRetrievalService,
    personaIdentityService: h.personaIdentityService,
    groupMemoryService: { getPersonaCached: () => ({ personaText: '• o menino vira detetive\n• grau é estilo de vida' }) },
  });
  const pack = withLore.build({ scopeKey: scope, text: 'bot oi', occurredAt: 1_000 });
  assert.match(pack.groupIdentity.groupLoreSummary, /detetive/, 'lore real do extractor entra no pacote');
  assert.ok(!pack.groupIdentity.groupLoreSummary.includes('trabalhar'), 'lore falsa não vaza');

  const without = h.personaContextService.build({ scopeKey: scope, text: 'bot oi', occurredAt: 1_001 });
  assert.match(without.groupIdentity.groupLoreSummary, /trabalhar/, 'sem groupMemoryService mantém identity como fallback');
});

test('personaContext: prioriza lore estruturada integral do groupMemoryService', async () => {
  const h = await createPersonaMemoryHarness();
  const scope = `persona-lore-${Date.now()}@g.us`;
  const fullLore = [
    '<group_lore>',
    'Fatos:',
    '- [running_gag] (Autor: Lucas): primeiro fato completo',
    `- [epic_fail] (Autor: Jonas): ${'x'.repeat(900)} fim-do-ultimo-fato`,
    '</group_lore>',
  ].join('\n');
  h.personaIdentityService.refresh({ scopeKey: scope, groupLoreSummary: 'lore antiga' });
  const withLore = createPersonaContextService({
    threadContextService: h.threadContextService,
    memoryRetrievalService: h.memoryRetrievalService,
    personaIdentityService: h.personaIdentityService,
    groupMemoryService: { buildPersonaLoreContext: () => fullLore },
  });

  const pack = withLore.build({ scopeKey: scope, text: 'bot oi', occurredAt: 1_000 });

  assert.equal(pack.groupIdentity.groupLoreSummary, fullLore);
  assert.match(pack.groupIdentity.groupLoreSummary, /fim-do-ultimo-fato/);
  assert.ok(!pack.groupIdentity.groupLoreSummary.includes('lore antiga'));
});

test('style do grupo é maioria da janela, não última mensagem', () => {
  const service = createSocialMemoryService();
  for (let i = 0; i < 4; i++) {
    service.observe({ scopeKey: 'a@g.us', authorJid: 'ana@s.whatsapp.net', text: 'kkkk olha isso' });
  }
  const last = service.observe({ scopeKey: 'a@g.us', authorJid: 'bia@s.whatsapp.net', text: 'obrigado pela ajuda na dúvida' });
  assert.deepEqual(service.toIdentityInput(last).voiceStyle, ['bem-humorado', 'leve'], 'zoeira recorrente domina mesmo com última msg neutra');
});

test('F2: grupo sem gatilhos não afirma "direto, respeitoso" (voiceStyle vazio)', () => {
  const service = createSocialMemoryService();
  const scope = `neutral-${Date.now()}@g.us`;
  for (const text of ['bom dia pessoal', 'vou almoçar agora', 'reunião às três', 'ainda bem que é sexta']) {
    service.observe({ scopeKey: scope, authorJid: 'ana@s.whatsapp.net', text });
  }
  const observed = service.observe({ scopeKey: scope, authorJid: 'ana@s.whatsapp.net', text: 'tô indo embora' });
  assert.deepEqual(service.toIdentityInput(observed).voiceStyle, [], 'sem sinal de tom → não inventa "direto, respeitoso"');
});

test('F2: zoeira ácida (palavrão recorrente) vira bucket ácido/debochado', () => {
  const service = createSocialMemoryService();
  const scope = `acid-${Date.now()}@g.us`;
  for (let i = 0; i < 4; i += 1) {
    service.observe({ scopeKey: scope, authorJid: 'ana@s.whatsapp.net', text: 'seu doido viado para com isso' });
  }
  const observed = service.observe({ scopeKey: scope, authorJid: 'bia@s.whatsapp.net', text: 'puta que pariu o cara' });
  const style = service.toIdentityInput(observed).voiceStyle;
  assert.ok(
    style.includes('ácido') || style.includes('debochado'),
    `bucket acid captura a zoeira, atual=${JSON.stringify(style)}`
  );
});
