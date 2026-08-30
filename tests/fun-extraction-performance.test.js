import test from 'node:test';
import assert from 'node:assert/strict';
import { createBufferLock } from '../fun/services/extractionAdapters/bufferLock.js';
import { dedupBatchBeforeExtract } from '../fun/services/extractionAdapters/batchDedup.js';

test('bufferLock: execução sequencial e sem sobreposição para o mesmo escopo', async () => {
  const lock = createBufferLock();
  const order = [];

  const task1 = lock.withLock('scope-1', async () => {
    order.push('t1-start');
    await new Promise((r) => setTimeout(r, 20));
    order.push('t1-end');
    return 'r1';
  });

  const task2 = lock.withLock('scope-1', async () => {
    order.push('t2-start');
    await new Promise((r) => setTimeout(r, 10));
    order.push('t2-end');
    return 'r2';
  });

  const [res1, res2] = await Promise.all([task1, task2]);

  assert.equal(res1, 'r1');
  assert.equal(res2, 'r2');
  assert.deepEqual(order, ['t1-start', 't1-end', 't2-start', 't2-end']);
});

test('bufferLock: múltiplos escopos rodam de forma independente', async () => {
  const lock = createBufferLock();
  const events = [];

  const taskA = lock.withLock('scope-A', async () => {
    events.push('A-start');
    await new Promise((r) => setTimeout(r, 15));
    events.push('A-end');
  });

  const taskB = lock.withLock('scope-B', async () => {
    events.push('B-start');
    await new Promise((r) => setTimeout(r, 15));
    events.push('B-end');
  });

  await Promise.all([taskA, taskB]);

  // Ambos iniciam antes de qualquer um terminar (independência)
  assert.ok(events.indexOf('B-start') < events.indexOf('A-end'));
});

test('batchDedup: filtra mensagens idênticas a fatos recentes de alta confiança', () => {
  const now = Date.now();
  const knownFacts = [
    { summary: 'Carlos bebeu 10 latinhas de cerveja e dormiu na calçada', score: 90, last_seen_at: now - 3600_000 },
  ];

  const rawMessages = [
    { messageId: 'm1', text: 'Carlos bebeu 10 latinhas de cerveja e dormiu na calçada' }, // repetido
    { messageId: 'm2', text: 'Hoje o dia está muito quente galera' }, // novidade
  ];

  const { filteredBatch, droppedCount } = dedupBatchBeforeExtract(rawMessages, knownFacts, {
    minScore: 80,
    windowHours: 24,
    similarityThreshold: 0.85,
    now,
  });

  assert.equal(droppedCount, 1);
  assert.equal(filteredBatch.length, 1);
  assert.equal(filteredBatch[0].messageId, 'm2');
});

test('batchDedup: não descarta fatos antigos ou com baixo score', () => {
  const now = Date.now();
  const knownFacts = [
    { summary: 'Beto apostou no crash e perdeu', score: 50, last_seen_at: now }, // score baixo
  ];

  const rawMessages = [
    { messageId: 'm1', text: 'Beto apostou no crash e perdeu' },
  ];

  const { filteredBatch, droppedCount } = dedupBatchBeforeExtract(rawMessages, knownFacts, {
    minScore: 80,
    now,
  });

  assert.equal(droppedCount, 0);
  assert.equal(filteredBatch.length, 1);
});
