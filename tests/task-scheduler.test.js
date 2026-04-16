import test from 'node:test';
import assert from 'node:assert/strict';

import { createTaskScheduler } from '../runtime/taskScheduler.js';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

test('task scheduler enforces maxPerJid concurrency', async () => {
  const scheduler = createTaskScheduler({
    globalConcurrency: 4,
    maxPerJid: 1,
    maxPerFlowPath: 4,
    maxQueueSize: 100,
    warnThreshold: 50,
  });

  let activeForSameJid = 0;
  let maxActiveForSameJid = 0;

  const a = scheduler.enqueue({
    jid: 'jid-a@s.whatsapp.net',
    flowPath: 'flow-1',
    handler: async () => {
      activeForSameJid += 1;
      maxActiveForSameJid = Math.max(maxActiveForSameJid, activeForSameJid);
      await sleep(30);
      activeForSameJid -= 1;
    },
  });
  const b = scheduler.enqueue({
    jid: 'jid-a@s.whatsapp.net',
    flowPath: 'flow-2',
    handler: async () => {
      activeForSameJid += 1;
      maxActiveForSameJid = Math.max(maxActiveForSameJid, activeForSameJid);
      await sleep(5);
      activeForSameJid -= 1;
    },
  });
  const c = scheduler.enqueue({
    jid: 'jid-b@s.whatsapp.net',
    flowPath: 'flow-1',
    handler: async () => {
      await sleep(5);
    },
  });

  await Promise.all([a.promise, b.promise, c.promise]);
  assert.equal(maxActiveForSameJid, 1);
});

test('task scheduler enforces maxPerFlowPath concurrency', async () => {
  const scheduler = createTaskScheduler({
    globalConcurrency: 4,
    maxPerJid: 4,
    maxPerFlowPath: 1,
    maxQueueSize: 100,
    warnThreshold: 50,
  });

  let activeForFlow = 0;
  let maxActiveForFlow = 0;

  const tasks = ['jid-1', 'jid-2', 'jid-3'].map(jid => (
    scheduler.enqueue({
      jid: `${jid}@s.whatsapp.net`,
      flowPath: 'same-flow',
      handler: async () => {
        activeForFlow += 1;
        maxActiveForFlow = Math.max(maxActiveForFlow, activeForFlow);
        await sleep(20);
        activeForFlow -= 1;
      },
    }).promise
  ));

  await Promise.all(tasks);
  assert.equal(maxActiveForFlow, 1);
});

test('task scheduler prioritizes high over low tasks', async () => {
  const scheduler = createTaskScheduler({
    globalConcurrency: 1,
    maxPerJid: 1,
    maxPerFlowPath: 1,
    maxQueueSize: 100,
    warnThreshold: 50,
  });

  const order = [];

  const first = scheduler.enqueue({
    jid: 'jid-a@s.whatsapp.net',
    flowPath: 'flow-a',
    priority: 'high',
    handler: async () => {
      order.push('first');
      await sleep(20);
    },
  });
  const low = scheduler.enqueue({
    jid: 'jid-b@s.whatsapp.net',
    flowPath: 'flow-b',
    priority: 'low',
    handler: async () => {
      order.push('low');
    },
  });
  const high = scheduler.enqueue({
    jid: 'jid-c@s.whatsapp.net',
    flowPath: 'flow-c',
    priority: 'high',
    handler: async () => {
      order.push('high');
    },
  });

  await Promise.all([first.promise, low.promise, high.promise]);
  assert.deepEqual(order, ['first', 'high', 'low']);
});
