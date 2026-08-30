import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeKey, tokenSet, jaccard, keywordSignature } from '../fun/utils/textSimilarity.js';
import { stripReasoningBlocks, sanitizeLlmPayload } from '../fun/utils/llmPayloadSanitizer.js';
import { createMetricsRecorder } from '../fun/services/extractionAdapters/metricsRecorder.js';
import { normalizeFunConfig } from '../fun/config.js';

test('textSimilarity: normalização de chaves e acentos', () => {
  assert.equal(normalizeKey('  João da Silva! É isso aí...  '), 'joao da silva e isso ai');
  assert.equal(normalizeKey(''), '');
  assert.equal(normalizeKey(null), '');
});

test('textSimilarity: tokenSet com tamanho mínimo', () => {
  const set = tokenSet('oi eu sou o goku 123', 3);
  assert.ok(set.has('sou'));
  assert.ok(set.has('goku'));
  assert.ok(set.has('123'));
  assert.ok(!set.has('oi'));
  assert.ok(!set.has('eu'));
});

test('textSimilarity: jaccard coefficient', () => {
  const simIdentical = jaccard('o gato subiu no telhado', 'o gato subiu no telhado');
  assert.equal(simIdentical, 1);

  const simDisjoint = jaccard('azul amarelo verde', 'vermelho preto cinza');
  assert.equal(simDisjoint, 0);

  const simPartial = jaccard('pedro apostou no corinthians', 'pedro perdeu no corinthians');
  assert.ok(simPartial > 0.4 && simPartial < 1.0);
});

test('textSimilarity: keywordSignature', () => {
  const sig = keywordSignature(['zoeira', 'festa'], 'beto caiu na piscina', 3);
  assert.ok(sig.length > 0);
  assert.ok(sig.includes('|'));
});

test('llmPayloadSanitizer: remove blocos de think (DeepSeek R1 / GLM)', () => {
  const rawWithThink = '<think>Aqui estou raciocinando sobre o batch...\nEle falou sobre beto.</think>{"facts":[{"kind":"event","summary":"Beto caiu na piscina"}]}';
  const cleaned = sanitizeLlmPayload(rawWithThink);
  assert.equal(cleaned, '{"facts":[{"kind":"event","summary":"Beto caiu na piscina"}]}');
});

test('llmPayloadSanitizer: limpa tags especiais e preâmbulo conversacional', () => {
  const rawWithPreamble = 'Aqui estão os fatos extraídos do chat:\n<|im_start|>{"facts":[]}<|im_end|>';
  const cleaned = sanitizeLlmPayload(rawWithPreamble);
  assert.equal(cleaned, '{"facts":[]}');
});

test('metricsRecorder: buffer circular e gravação', () => {
  const recorder = createMetricsRecorder({ enabled: true, sink: 'none' });
  recorder.record('test.event', { count: 1 });
  recorder.record('test.event2', { ok: true });

  const metrics = recorder.getMetrics();
  assert.equal(metrics.length, 2);
  assert.equal(metrics[0].metric, 'test.event');
  assert.equal(metrics[1].data.ok, true);

  recorder.clear();
  assert.equal(recorder.getMetrics().length, 0);
});

test('config: normalização de extractionAdapters', () => {
  const cfg = normalizeFunConfig({
    extractionAdapters: {
      parseGuard: { enabled: true },
      batchDedup: { enabled: true, minScore: 90, windowHours: 48 },
    },
  });

  assert.equal(cfg.extractionAdapters.parseGuard.enabled, true);
  assert.equal(cfg.extractionAdapters.evidenceEnricher.enabled, false);
  assert.equal(cfg.extractionAdapters.batchDedup.enabled, true);
  assert.equal(cfg.extractionAdapters.batchDedup.minScore, 90);
  assert.equal(cfg.extractionAdapters.batchDedup.windowHours, 48);
});
