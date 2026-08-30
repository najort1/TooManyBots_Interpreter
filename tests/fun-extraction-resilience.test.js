import test from 'node:test';
import assert from 'node:assert/strict';
import { guardBatchFacts, normalizeGuardKind, computeFactConfidence } from '../fun/services/extractionAdapters/parseGuard.js';
import { enrichFactsWithEvidence } from '../fun/services/extractionAdapters/evidenceEnricher.js';

test('parseGuard: normalização de kinds estendidos', () => {
  assert.equal(normalizeGuardKind('humor'), 'running_gag');
  assert.equal(normalizeGuardKind('treta'), 'rivalry');
  assert.equal(normalizeGuardKind('mico'), 'epic_fail');
  assert.equal(normalizeGuardKind('casal'), 'ship_lore');
  assert.equal(normalizeGuardKind('desconhecido_xyz'), 'event');
});

test('parseGuard: cálculo de confiança', () => {
  const goodFact = {
    summary: 'Beto apostou 500 coins no crash e perdeu tudo em 2 segundos',
    subjects: [0],
    keywords: ['aposta', 'crash'],
    score: 70,
  };
  const conf = computeFactConfidence(goodFact);
  assert.ok(conf >= 70);

  const shortFact = {
    summary: 'oi',
    subjects: [],
    score: 50,
  };
  const confShort = computeFactConfidence(shortFact);
  assert.ok(confShort < 50);
});

test('parseGuard: detecção de redundância dentro do batch e anexo de trace', () => {
  const facts = [
    { kind: 'event', summary: 'Lucas tropeçou na calçada e derrubou o açaí', subjects: [0] },
    { kind: 'mico', summary: 'Lucas tropeçou na calçada e derrubou o açaí todo', subjects: [0] },
  ];

  const guarded = guardBatchFacts(facts);
  assert.equal(guarded.length, 2);
  assert.equal(guarded[0].kind, 'event');
  assert.equal(guarded[1].kind, 'epic_fail');
  assert.ok(guarded[1]._parseGuard.warnings.length > 0);
  assert.ok(guarded[1]._parseGuard.warnings[0].includes('redundant_with_subject_0'));
});

test('evidenceEnricher: vinculação com índice de batch', () => {
  const facts = [
    { summary: 'Carlos disse que ia parar de beber cerveja', subjects: [1] },
  ];
  const rawBatch = [
    { messageId: 'msg-0', userJid: 'user0@s.whatsapp.net', text: 'bom dia', at: 1000 },
    { messageId: 'msg-1', userJid: 'carlos@s.whatsapp.net', text: 'galera vou parar de beber cerveja juro', at: 2000 },
  ];

  const enriched = enrichFactsWithEvidence(facts, rawBatch, '123@g.us');
  assert.equal(enriched.length, 1);
  assert.equal(enriched[0].evidence.status, 'linked');
  assert.equal(enriched[0].evidence.messageId, 'msg-1');
  assert.equal(enriched[0].evidence.authorJid, 'carlos@s.whatsapp.net');
  assert.equal(enriched[0].evidence.scopeKey, '123@g.us');
});

test('evidenceEnricher: fallback por similaridade quando subject é omisso', () => {
  const facts = [
    { summary: 'galera vou parar de beber cerveja juro' },
  ];
  const rawBatch = [
    { messageId: 'msg-1', userJid: 'carlos@s.whatsapp.net', text: 'galera vou parar de beber cerveja juro', at: 2000 },
  ];

  const enriched = enrichFactsWithEvidence(facts, rawBatch, '123@g.us');
  assert.equal(enriched.length, 1);
  assert.equal(enriched[0].evidence.status, 'linked');
  assert.equal(enriched[0].evidence.messageId, 'msg-1');
});
