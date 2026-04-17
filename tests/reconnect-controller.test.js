import test from 'node:test';
import assert from 'node:assert/strict';

import { createReconnectController } from '../runtime/reconnectController.js';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

test('reconnect controller keeps only one pending reconnect at a time', async () => {
  const controller = createReconnectController({
    minDelayMs: 20,
    maxDelayMs: 20,
    backoffMultiplier: 1,
    jitterRatio: 0,
  });

  let callCount = 0;
  const first = controller.schedule({
    reason: 'first',
    statusCode: 408,
    connect: () => {
      callCount += 1;
    },
  });
  const second = controller.schedule({
    reason: 'second',
    statusCode: 408,
    connect: () => {
      callCount += 1;
    },
  });

  assert.equal(first.scheduled, true);
  assert.equal(second.scheduled, false);
  assert.equal(second.reason, 'already-pending');
  assert.equal(controller.getSnapshot().pending, true);
  controller.close();
  await sleep(5);
  assert.ok(callCount === 0 || callCount === 1);
});

test('reconnect controller applies cooldown after too many attempts in window', async () => {
  const controller = createReconnectController({
    minDelayMs: 1,
    maxDelayMs: 5,
    backoffMultiplier: 1,
    jitterRatio: 0,
    attemptWindowMs: 60 * 1000,
    maxAttemptsPerWindow: 1,
    cooldownMs: 25,
  });

  const first = controller.schedule({
    reason: 'first',
    connect: () => {},
  });
  assert.equal(first.scheduled, true);
  controller.close();

  const second = controller.schedule({
    reason: 'second',
    connect: () => {},
  });
  assert.equal(second.scheduled, true);
  assert.ok(Number(second.delayMs) >= 25);
  controller.close();
  await sleep(5);
});

test('reconnect controller reset clears attempts and pending timer', async () => {
  const controller = createReconnectController({
    minDelayMs: 50,
    maxDelayMs: 50,
    backoffMultiplier: 1,
    jitterRatio: 0,
  });

  controller.schedule({
    reason: 'pending',
    connect: () => {},
  });

  const snapshotWithPending = controller.getSnapshot();
  assert.equal(snapshotWithPending.pending, true);
  assert.equal(snapshotWithPending.currentAttempt, 1);

  controller.reset();
  const snapshotAfterReset = controller.getSnapshot();
  assert.equal(snapshotAfterReset.pending, false);
  assert.equal(snapshotAfterReset.currentAttempt, 0);

  await sleep(60);
});
