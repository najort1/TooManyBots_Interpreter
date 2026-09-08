import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createFunPersonaAutonomyRepository } from '../fun/db/funPersonaAutonomyRepository.js';

await initDb();

const group = `120363${String(Date.now()).slice(-10)}99@g.us`;

test('persona autonomy repository: grava estado durável e poda timestamps fora da janela diária', () => {
  const repository = createFunPersonaAutonomyRepository({ getDatabase: getDb });
  const now = 1_700_000_000_000;

  assert.equal(repository.recordAction(group, { now: now - 25 * 60 * 60_000 }).ok, true);
  assert.equal(repository.recordAction(group, { now }).ok, true);

  const state = repository.getState(group, { now });
  assert.equal(state.actionTimestamps.length, 1);
  assert.equal(state.lastActionAt, now);
  assert.equal(state.consecutiveCount, 2);

  assert.equal(repository.observeHumanMessage(group, {
    hasStopRequest: true,
    negativeSignalBlockMs: 60 * 60_000,
    now: now + 10,
  }).ok, true);

  const persisted = createFunPersonaAutonomyRepository({ getDatabase: getDb }).getState(group, { now: now + 10 });
  assert.equal(persisted.consecutiveCount, 0);
  assert.equal(persisted.negativeUntil, now + 60 * 60_000 + 10);
});
