import test from 'node:test';
import assert from 'node:assert/strict';

import { createIngestionQueue } from '../runtime/ingestionQueue.js';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

test('ingestion queue keeps per-jid ordering while allowing cross-jid concurrency', async () => {
  const queue = createIngestionQueue({
    concurrency: 4,
    maxQueueSize: 100,
    warnThreshold: 50,
  });

  const events = [];
  let activeForA = 0;
  let maxActiveForA = 0;

  queue.enqueue({
    key: 'a@s.whatsapp.net',
    payload: {},
    handler: async () => {
      events.push('start-a1');
      activeForA += 1;
      maxActiveForA = Math.max(maxActiveForA, activeForA);
      await sleep(35);
      activeForA -= 1;
      events.push('end-a1');
    },
  });
  queue.enqueue({
    key: 'a@s.whatsapp.net',
    payload: {},
    handler: async () => {
      events.push('start-a2');
      activeForA += 1;
      maxActiveForA = Math.max(maxActiveForA, activeForA);
      await sleep(5);
      activeForA -= 1;
      events.push('end-a2');
    },
  });
  queue.enqueue({
    key: 'b@s.whatsapp.net',
    payload: {},
    handler: async () => {
      events.push('start-b1');
      await sleep(10);
      events.push('end-b1');
    },
  });

  await queue.onIdle();

  assert.equal(maxActiveForA, 1);
  assert.ok(events.indexOf('start-a1') < events.indexOf('end-a1'));
  assert.ok(events.indexOf('end-a1') < events.indexOf('start-a2'));
  assert.ok(events.indexOf('start-b1') > -1);

  const snapshot = queue.getSnapshot();
  assert.equal(snapshot.completed, 3);
  assert.equal(snapshot.failed, 0);
  assert.equal(snapshot.rejected, 0);
});

test('ingestion queue rejects new entries when queue is full', async () => {
  const queue = createIngestionQueue({
    concurrency: 1,
    maxQueueSize: 1,
    warnThreshold: 1,
  });

  const first = queue.enqueue({
    key: 'overflow@s.whatsapp.net',
    payload: {},
    handler: async () => {
      await sleep(30);
    },
  });

  const second = queue.enqueue({
    key: 'overflow@s.whatsapp.net',
    payload: {},
    handler: async () => {
      await sleep(1);
    },
  });

  const third = queue.enqueue({
    key: 'overflow@s.whatsapp.net',
    payload: {},
    handler: async () => {
      await sleep(1);
    },
  });

  assert.equal(first.accepted, true);
  assert.equal(second.accepted, true);
  assert.equal(third.accepted, false);
  assert.equal(third.reason, 'queue-overflow');

  await queue.onIdle();

  const snapshot = queue.getSnapshot();
  assert.equal(snapshot.completed, 2);
  assert.equal(snapshot.rejected, 1);
});

test('ingestion queue emits warn callback when backlog reaches threshold', async () => {
  let warnings = 0;
  const queue = createIngestionQueue({
    concurrency: 1,
    maxQueueSize: 10,
    warnThreshold: 2,
    onWarn: () => {
      warnings += 1;
    },
  });

  queue.enqueue({
    key: 'warn@s.whatsapp.net',
    payload: {},
    handler: async () => {
      await sleep(20);
    },
  });
  queue.enqueue({
    key: 'warn@s.whatsapp.net',
    payload: {},
    handler: async () => {
      await sleep(1);
    },
  });
  queue.enqueue({
    key: 'warn@s.whatsapp.net',
    payload: {},
    handler: async () => {
      await sleep(1);
    },
  });

  await queue.onIdle();
  assert.ok(warnings >= 1);
});

test('ingestion queue prioritizes high tasks before low tasks per key', async () => {
  const queue = createIngestionQueue({
    concurrency: 1,
    maxQueueSize: 10,
    warnThreshold: 5,
  });

  const order = [];
  queue.enqueue({
    key: 'prio@s.whatsapp.net',
    priority: 'high',
    payload: {},
    handler: async () => {
      order.push('first-high');
      await sleep(20);
    },
  });
  queue.enqueue({
    key: 'prio@s.whatsapp.net',
    priority: 'low',
    payload: {},
    handler: async () => {
      order.push('low');
    },
  });
  queue.enqueue({
    key: 'prio@s.whatsapp.net',
    priority: 'high',
    payload: {},
    handler: async () => {
      order.push('second-high');
    },
  });

  await queue.onIdle();
  assert.deepEqual(order, ['first-high', 'second-high', 'low']);
});
