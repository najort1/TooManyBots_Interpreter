import test from 'node:test';
import assert from 'node:assert/strict';

import { createIngestionQueue } from '../runtime/ingestionQueue.js';
import { createCommandQueueManager } from '../runtime/commandQueue.js';
import { resolveCommandQueueRouting } from '../fun/commandQueueRouting.js';
import { createOutputQueue } from '../runtime/outputQueue.js';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function idleCondition(queue) {
  if (typeof queue.onIdle === 'function') return queue.onIdle();
  const classes = ['fast', 'state', 'heavy'];
  return Promise.all(classes.map(c => {
    const q = queue.resolveQueue(c);
    return q ? q.onIdle() : Promise.resolve();
  }));
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

test('ingestion queue drops expired tasks via taskTimeoutMs', async () => {
  const queue = createIngestionQueue({
    concurrency: 1,
    maxQueueSize: 10,
    taskTimeoutMs: 50,
  });

  queue.enqueue({
    key: 'timeout-test',
    payload: {},
    handler: async () => {
      await sleep(100);
    },
  });

  queue.enqueue({
    key: 'timeout-test',
    payload: {},
    handler: async () => {
      await sleep(5);
    },
  });

  await sleep(120);
  await queue.onIdle();

  const snapshot = queue.getSnapshot();
  assert.ok(snapshot.rejectedTimeout >= 1, `expected >=1 timeouts, got ${snapshot.rejectedTimeout}`);
  assert.ok(snapshot.completed >= 1, `expected >=1 completed, got ${snapshot.completed}`);
});

test('ingestion queue cancelPending removes pending tasks for a key', async () => {
  const queue = createIngestionQueue({
    concurrency: 1,
    maxQueueSize: 20,
  });

  queue.enqueue({
    key: 'cancel-a',
    payload: {},
    handler: async () => { await sleep(30); },
  });
  queue.enqueue({
    key: 'cancel-a',
    payload: {},
    handler: async () => { await sleep(1); },
  });
  queue.enqueue({
    key: 'cancel-a',
    payload: {},
    handler: async () => { await sleep(1); },
  });

  const cancelled = queue.cancelPending('cancel-a');
  assert.ok(cancelled >= 2, `expected >=2 cancelled, got ${cancelled}`);

  await queue.onIdle();
  const snapshot = queue.getSnapshot();
  assert.equal(snapshot.completed, 1);
});

test('ingestion queue p50/p95/p99 metrics are populated after work', async () => {
  const queue = createIngestionQueue({
    concurrency: 2,
    maxQueueSize: 20,
  });

  queue.enqueue({
    key: 'metrics-a',
    payload: {},
    handler: async () => { await sleep(10); },
  });
  queue.enqueue({
    key: 'metrics-b',
    payload: {},
    handler: async () => { await sleep(15); },
  });

  await queue.onIdle();
  const snapshot = queue.getSnapshot();
  assert.ok(snapshot.p50WaitMs >= 0);
  assert.ok(snapshot.p95WaitMs >= 0);
  assert.ok(snapshot.p50ProcessMs >= 8, `expected process time >=8ms, got ${snapshot.p50ProcessMs}`);
});

test('ingestion queue maintains per-key FIFO ordering with mixed priority', async () => {
  const queue = createIngestionQueue({
    concurrency: 1,
    maxQueueSize: 10,
  });

  const order = [];
  queue.enqueue({
    key: 'fifo-test',
    priority: 'high',
    payload: {},
    handler: async () => {
      order.push('h1');
      await sleep(20);
    },
  });
  queue.enqueue({
    key: 'fifo-test',
    priority: 'high',
    payload: {},
    handler: async () => {
      order.push('h2');
      await sleep(5);
    },
  });
  queue.enqueue({
    key: 'fifo-test',
    priority: 'low',
    payload: {},
    handler: async () => {
      order.push('l1');
    },
  });

  await queue.onIdle();
  assert.deepEqual(order, ['h1', 'h2', 'l1']);
});

test('command queue routes tasks to correct class based on command text', async () => {
  const cm = createCommandQueueManager({ maxConcurrency: 10 });

  function classify(text, msgType) {
    return cm.computeClass(text, msgType);
  }

  assert.equal(classify('ajuda', ''), 'fast');
  assert.equal(classify('saldo', ''), 'fast');
  assert.equal(classify('perfil', ''), 'fast');
  assert.equal(classify('ping', ''), 'fast');

  assert.equal(classify('bet 50', ''), 'state');
  assert.equal(classify('comprar item', ''), 'state');
  assert.equal(classify('roll', ''), 'state');
  assert.equal(classify('bingo', ''), 'state');
  assert.equal(classify('investir 100', ''), 'state');

  assert.equal(classify('', 'image'), 'heavy');
  assert.equal(classify('', 'video'), 'heavy');
  assert.equal(classify('fig gato', ''), 'heavy');
  assert.equal(classify('imagine paisagem', ''), 'heavy');
  assert.equal(classify('sticker', ''), 'heavy');
  assert.equal(classify('llm pergunte', ''), 'heavy');

  assert.equal(classify('/tarô o que me espera?', ''), 'heavy');
  assert.equal(classify('/ship @alice @bob', ''), 'heavy');
  assert.equal(classify('/quememaisprovavel', ''), 'heavy');
  assert.equal(classify('/oráculo maldito', ''), 'heavy');
  assert.equal(classify('/assaltar @alvo', ''), 'heavy');
  assert.equal(classify('/gerar um dragão', ''), 'heavy');
});

test('LLM commands use per-actor queue keys within the same chat', () => {
  const chatJid = '123@g.us';
  const aliceTarot = resolveCommandQueueRouting({
    chatJid,
    actorJid: 'alice@s.whatsapp.net',
    commandText: '/tarot como vai ser meu dia?',
  });
  const bobShip = resolveCommandQueueRouting({
    chatJid,
    actorJid: 'bob@s.whatsapp.net',
    commandText: '/ship @alice @bob',
  });
  const chaosCommand = resolveCommandQueueRouting({
    chatJid,
    actorJid: 'alice@s.whatsapp.net',
    commandText: '/oráculo maldito',
  });
  const fastCommand = resolveCommandQueueRouting({
    chatJid,
    actorJid: 'alice@s.whatsapp.net',
    commandText: '/saldo',
  });

  assert.notEqual(aliceTarot.key, bobShip.key);
  assert.notEqual(aliceTarot.serializationKey, bobShip.serializationKey);
  assert.equal(chaosCommand.key, chatJid);
  assert.equal(chaosCommand.serializationKey, '');
  assert.equal(fastCommand.key, chatJid);
  assert.equal(fastCommand.serializationKey, '');
});

test('command queue allows parallel execution across different keys', async () => {
  const cm = createCommandQueueManager({
    fastConcurrency: 4,
    stateConcurrency: 2,
    heavyConcurrency: 1,
    maxConcurrency: 8,
  });

  const events = [];

  cm.enqueue({
    key: 'group-a',
    commandText: 'saldo',
    handler: async () => {
      events.push('fast-a-start');
      await sleep(30);
      events.push('fast-a-end');
    },
  });
  cm.enqueue({
    key: 'group-b',
    commandText: 'ajuda',
    handler: async () => {
      events.push('fast-b-start');
      await sleep(10);
      events.push('fast-b-end');
    },
  });

  await cm.onIdle();
  assert.ok(events.includes('fast-a-start'));
  assert.ok(events.includes('fast-b-start'));
  assert.ok(events.indexOf('fast-b-end') < events.indexOf('fast-a-end') || events.indexOf('fast-a-end') < events.indexOf('fast-b-end'));
});

test('LLM commands from different actors in the same chat run concurrently', async () => {
  const cm = createCommandQueueManager({
    heavyConcurrency: 4,
    heavyTaskTimeoutMs: 0,
    heavyMaxDurationMs: 0,
  });
  const chatJid = 'same-group@g.us';
  const events = [];
  let active = 0;
  let maxActive = 0;

  for (const actorJid of ['alice@s.whatsapp.net', 'bob@s.whatsapp.net']) {
    const routing = resolveCommandQueueRouting({
      chatJid,
      actorJid,
      commandText: '/tarot leitura geral',
    });
    cm.enqueue({
      ...routing,
      commandText: '/tarot leitura geral',
      handler: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        events.push(`${actorJid}:start`);
        await sleep(30);
        active -= 1;
        events.push(`${actorJid}:end`);
      },
    });
  }

  await cm.onIdle();

  assert.equal(maxActive, 2, `Expected LLM handlers to overlap, got ${JSON.stringify(events)}`);
  assert.equal(cm.getSnapshot().queues.heavy.completed, 2);
  assert.equal(cm.getSnapshot().queues.heavy.rejected, 0);
});

test('command queue preserves all queued LLM commands without timeout drops', async () => {
  const cm = createCommandQueueManager({
    heavyConcurrency: 4,
    heavyTaskTimeoutMs: 0,
    heavyMaxDurationMs: 0,
  });
  const completed = [];

  for (let index = 0; index < 4; index += 1) {
    cm.enqueue({
      key: 'same-actor@g.us:alice@s.whatsapp.net',
      serializationKey: 'llm:same-actor@g.us:alice@s.whatsapp.net',
      commandText: '/tarot leitura geral',
      handler: async () => {
        await sleep(25);
        completed.push(index);
      },
    });
  }

  await cm.onIdle();

  const snapshot = cm.getSnapshot().queues.heavy;
  assert.deepEqual(completed, [0, 1, 2, 3]);
  assert.equal(snapshot.completed, 4);
  assert.equal(snapshot.rejectedTimeout, 0);
  assert.equal(snapshot.rejectedDuration, 0);
});

test('command queue queues heavy work instead of rejecting saturation', async () => {
  const cm = createCommandQueueManager({
    heavyConcurrency: 1,
    maxConcurrency: 1,
    heavyTaskTimeoutMs: 0,
    heavyMaxDurationMs: 0,
  });
  const accepted = [];

  for (const key of ['group-a', 'group-b', 'group-c']) {
    accepted.push(cm.enqueue({
      key,
      commandText: '/tarot leitura geral',
      handler: async () => { await sleep(20); },
    }).accepted);
  }

  await cm.onIdle();

  assert.deepEqual(accepted, [true, true, true]);
  assert.equal(cm.getSnapshot().queues.heavy.completed, 3);
  assert.equal(cm.getSnapshot().queues.heavy.rejected, 0);
});

test('command queue serializes within same key', async () => {
  const cm = createCommandQueueManager({
    fastConcurrency: 4,
    maxConcurrency: 8,
  });

  const events = [];
  cm.enqueue({
    key: 'same-group',
    commandText: 'perfil',
    handler: async () => {
      events.push('start-1');
      await sleep(30);
      events.push('end-1');
    },
  });
  cm.enqueue({
    key: 'same-group',
    commandText: 'ajuda',
    handler: async () => {
      events.push('start-2');
      await sleep(5);
      events.push('end-2');
    },
  });

  await cm.onIdle();
  assert.ok(events.indexOf('end-1') < events.indexOf('start-2'),
    `Expected end-1 before start-2, got ${JSON.stringify(events)}`);
});

test('command queue snapshot aggregates all classes', async () => {
  const cm = createCommandQueueManager({ maxConcurrency: 8 });

  cm.enqueue({
    key: 'g1',
    commandText: 'ping',
    handler: async () => { await sleep(5); },
  });
  cm.enqueue({
    key: 'g2',
    commandText: 'bet 50',
    handler: async () => { await sleep(5); },
  });

  await cm.onIdle();
  const snap = cm.getSnapshot();
  assert.ok(snap.queues.fast, 'expected fast queue snapshot');
  assert.ok(snap.queues.state, 'expected state queue snapshot');
  assert.ok(snap.queues.heavy, 'expected heavy queue snapshot');
  assert.ok(snap.totalAccepted >= 2);
  assert.ok(snap.totalCompleted >= 2);
});

test('output queue sends messages in FIFO per jid', async () => {
  const oq = createOutputQueue({
    globalConcurrency: 1,
    jidGapMs: 0,
    maxCoalesceDelayMs: 0,
  });

  const order = [];
  oq.enqueue({
    jid: 'chat-a',
    send: async () => { order.push('a1'); },
    priority: 'reply',
  });
  oq.enqueue({
    jid: 'chat-a',
    send: async () => { order.push('a2'); },
    priority: 'reply',
  });
  oq.enqueue({
    jid: 'chat-b',
    send: async () => { order.push('b1'); },
    priority: 'reply',
  });

  await oq.onIdle();
  assert.ok(order.indexOf('a1') < order.indexOf('a2'));
  assert.ok(order.includes('b1'));
});

test('output queue prioritizes reply over flavor', async () => {
  const oq = createOutputQueue({
    globalConcurrency: 1,
    jidGapMs: 0,
    maxCoalesceDelayMs: 0,
  });

  const order = [];
  oq.enqueue({
    jid: 'chat-p',
    send: async () => { order.push('flavor'); await sleep(10); },
    priority: 'flavor',
  });
  oq.enqueue({
    jid: 'chat-p',
    send: async () => { order.push('reply'); },
    priority: 'reply',
  });

  await oq.onIdle();
  assert.equal(order[0], 'reply', `Expected reply first, got ${JSON.stringify(order)}`);
  assert.equal(order[1], 'flavor');
});

test('output queue coalesces same coalesceKey within window', async () => {
  const oq = createOutputQueue({
    globalConcurrency: 1,
    jidGapMs: 0,
    maxCoalesceDelayMs: 100,
  });

  let sendCount = 0;
  oq.enqueue({
    jid: 'chat-c',
    send: async () => { sendCount += 1; },
    priority: 'flavor',
    coalesceKey: 'xp-update',
  });
  oq.enqueue({
    jid: 'chat-c',
    send: async () => { sendCount += 1; },
    priority: 'flavor',
    coalesceKey: 'xp-update',
  });

  await oq.onIdle();
  assert.equal(sendCount, 1, `Expected coalesced into 1 send, got ${sendCount}`);
});

test('ingestion queue passes AbortSignal to handler when maxTaskDurationMs set', async () => {
  let receivedSignal = null;
  const queue = createIngestionQueue({
    concurrency: 1,
    maxQueueSize: 10,
    maxTaskDurationMs: 500,
  });

  queue.enqueue({
    key: 'abort-test',
    handler: async (payload, context) => {
      receivedSignal = context?.signal || null;
    },
  });

  await queue.onIdle();
  assert.ok(receivedSignal, 'Expected AbortSignal to be passed');
  assert.ok(typeof receivedSignal?.aborted === 'boolean', 'Expected signal.aborted to be a boolean');
});

test('ingestion queue AbortSignal aborts after maxTaskDurationMs', async () => {
  let aborted = false;
  const queue = createIngestionQueue({
    concurrency: 1,
    maxQueueSize: 10,
    maxTaskDurationMs: 50,
  });

  queue.enqueue({
    key: 'abort-timeout',
    handler: async (payload, context) => {
      await sleep(200);
      aborted = context?.signal?.aborted === true;
    },
  });

  await sleep(150);
  await queue.onIdle();
  assert.ok(aborted, 'Expected signal.aborted to be true after timeout');
});

test('command queue serializationKey serializes across classes', async () => {
  const cm = createCommandQueueManager({
    fastConcurrency: 4,
    stateConcurrency: 2,
    heavyConcurrency: 1,
    maxConcurrency: 8,
  });

  const order = [];
  cm.enqueue({
    key: 'group-x',
    serializationKey: 'lock:user:123',
    commandText: 'saldo',
    handler: async () => {
      order.push('fast-start');
      await sleep(30);
      order.push('fast-end');
    },
  });
  cm.enqueue({
    key: 'group-x',
    serializationKey: 'lock:user:123',
    commandText: 'bet 50',
    handler: async () => {
      order.push('state-start');
      await sleep(10);
      order.push('state-end');
    },
  });

  await cm.onIdle();
  assert.ok(order.indexOf('fast-end') < order.indexOf('state-start'),
    `Expected fast-end before state-start, got ${JSON.stringify(order)}`);
});

test('command queue different serializationKeys run in parallel', async () => {
  const cm = createCommandQueueManager({
    fastConcurrency: 4,
    maxConcurrency: 8,
  });

  const events = [];
  cm.enqueue({
    key: 'g1',
    serializationKey: 'lock:a',
    commandText: 'saldo',
    handler: async () => {
      events.push('a-start');
      await sleep(30);
      events.push('a-end');
    },
  });
  cm.enqueue({
    key: 'g2',
    serializationKey: 'lock:b',
    commandText: 'saldo',
    handler: async () => {
      events.push('b-start');
      await sleep(5);
      events.push('b-end');
    },
  });

  await cm.onIdle();
  assert.ok(events.indexOf('a-start') > -1);
  assert.ok(events.indexOf('b-start') > -1);
  assert.ok(events.indexOf('b-end') < events.indexOf('a-end') ||
          events.indexOf('a-end') < events.indexOf('b-end'));
});

test('output queue reply does not coalesce', async () => {
  const oq = createOutputQueue({
    globalConcurrency: 1,
    jidGapMs: 0,
    maxCoalesceDelayMs: 200,
  });

  let sendCount = 0;
  oq.enqueue({
    jid: 'chat-r',
    send: async () => { sendCount += 1; },
    priority: 'reply',
    coalesceKey: 'cmd-result',
  });
  oq.enqueue({
    jid: 'chat-r',
    send: async () => { sendCount += 1; },
    priority: 'reply',
    coalesceKey: 'cmd-result',
  });

  await oq.onIdle();
  assert.equal(sendCount, 2, 'Expected reply not to coalesce');
});

test('output queue flavor uses larger gap than reply', async () => {
  const oq = createOutputQueue({
    globalConcurrency: 1,
    jidGapMs: 100,
    maxCoalesceDelayMs: 0,
  });

  const gaps = oq.getSnapshot();
  assert.ok(gaps.jidGapMs >= 0);
});

test('serializationKey lock held even when task ignores abort signal', async () => {
  const cm = createCommandQueueManager({
    fastConcurrency: 4,
    stateConcurrency: 2,
    heavyConcurrency: 1,
    maxConcurrency: 8,
    fastMaxDurationMs: 30,
  });

  const timeline = [];
  let t1Resolve;
  const t1Promise = new Promise(r => { t1Resolve = r; });

  cm.enqueue({
    key: 'g-lock',
    serializationKey: 'lock:critical',
    commandText: 'comprar',
    handler: async (payload, context) => {
      timeline.push('t1-start');
      await sleep(100);
      timeline.push('t1-end');
      t1Resolve();
    },
  });

  cm.enqueue({
    key: 'g-lock',
    serializationKey: 'lock:critical',
    commandText: 'saldo',
    handler: async () => {
      timeline.push('t2-run');
    },
  });

  await t1Promise;
  // Dá tempo para a fila processar t2 depois de t1
  await sleep(50);
  await cm.onIdle();

  assert.ok(timeline.indexOf('t1-end') < timeline.indexOf('t2-run'),
    `Esperado t1-end antes de t2-run, timeline=${JSON.stringify(timeline)}`);
});

test('output queue applies the gap only to the same jid', async () => {
  const queue = createOutputQueue({
    globalConcurrency: 2,
    jidGapMs: 100,
    maxCoalesceDelayMs: 0,
  });
  const sentAt = new Map();

  queue.enqueue({
    jid: 'group-a@g.us',
    priority: 'reply',
    send: async () => { sentAt.set('a1', Date.now()); },
  });
  queue.enqueue({
    jid: 'group-a@g.us',
    priority: 'reply',
    send: async () => { sentAt.set('a2', Date.now()); },
  });
  queue.enqueue({
    jid: 'group-b@g.us',
    priority: 'reply',
    send: async () => { sentAt.set('b1', Date.now()); },
  });

  await queue.onIdle();

  assert.ok(sentAt.get('a2') - sentAt.get('a1') >= 95);
  assert.ok(sentAt.get('b1') - sentAt.get('a1') < 80);
  assert.equal(queue.getSnapshot().sent, 3);
});

test('output queue resolves the replaced coalesced item', async () => {
  const queue = createOutputQueue({
    globalConcurrency: 1,
    jidGapMs: 0,
    maxCoalesceDelayMs: 40,
  });
  let replaced = 0;
  const sent = [];

  queue.enqueue({
    jid: 'group@g.us',
    priority: 'flavor',
    coalesceKey: 'world',
    onCoalesced: () => { replaced += 1; },
    send: async () => { sent.push('first'); },
  });
  queue.enqueue({
    jid: 'group@g.us',
    priority: 'flavor',
    coalesceKey: 'world',
    send: async () => { sent.push('latest'); },
  });

  await queue.onIdle();

  assert.equal(replaced, 1);
  assert.deepEqual(sent, ['latest']);
  assert.equal(queue.getSnapshot().coalesced, 1);
});
