import test from 'node:test';
import assert from 'node:assert/strict';

import {
  initDb,
  recordStartPolicyEvent,
  countStartPolicyEventsInWindow,
  pruneStartPolicyEventsBefore,
  upsertPersistedContextVariable,
  loadPersistedContextVariables,
  deleteExpiredPersistedContextVariables,
  deletePersistedContextVariablesByScope,
  saveSatisfactionSurveyResponse,
  listSatisfactionSurveyResponses,
} from '../db/index.js';

await initDb();

test('start policy repository counts events in sliding window and prunes stale rows', () => {
  const base = Date.now();
  const jid = `start-policy-${base}@s.whatsapp.net`;
  const flowPath = '/tmp/start-policy-flow.tmb';

  recordStartPolicyEvent({ jid, flowPath, startedAt: base - 60_000 });
  recordStartPolicyEvent({ jid, flowPath, startedAt: base - 1_000 });
  recordStartPolicyEvent({ jid, flowPath, startedAt: base });

  const count = countStartPolicyEventsInWindow({
    jid,
    flowPath,
    fromTs: base - 2_000,
    toTs: base + 1,
  });
  assert.equal(count, 2);

  const removed = pruneStartPolicyEventsBefore(base - 30_000);
  assert.ok(removed >= 1);
});

test('context persistence repository loads only non-expired variables', () => {
  const base = Date.now();
  const jid = `context-${base}@s.whatsapp.net`;
  const flowPath = '/tmp/context-flow.tmb';

  upsertPersistedContextVariable({
    jid,
    flowPath,
    variableName: 'nome',
    variableValue: 'Davi',
    persistedAt: base,
    expiresAt: base + 10_000,
  });
  upsertPersistedContextVariable({
    jid,
    flowPath,
    variableName: 'expirada',
    variableValue: 'x',
    persistedAt: base,
    expiresAt: base - 1,
  });

  const loaded = loadPersistedContextVariables({
    jid,
    flowPath,
    variableNames: ['nome', 'expirada'],
    nowTs: base,
  });
  assert.equal(loaded.nome, 'Davi');
  assert.equal(Object.prototype.hasOwnProperty.call(loaded, 'expirada'), false);

  const deletedExpired = deleteExpiredPersistedContextVariables(base);
  assert.ok(deletedExpired >= 1);

  const removedScope = deletePersistedContextVariablesByScope({ jid, flowPath });
  assert.ok(removedScope >= 1);
});

test('satisfaction repository stores answered and timeout survey outcomes', () => {
  const base = Date.now();
  const jid = `survey-${base}@s.whatsapp.net`;
  const flowPath = '/tmp/survey-flow.tmb';

  saveSatisfactionSurveyResponse({
    jid,
    flowPath,
    sessionId: `${jid}:${base}`,
    questionType: 'rating-scale',
    scale: 5,
    rating: 4,
    timedOut: false,
    thankYouMessage: 'Obrigado!',
    createdAt: base,
    answeredAt: base + 1000,
  });

  saveSatisfactionSurveyResponse({
    jid,
    flowPath,
    sessionId: `${jid}:${base + 1}`,
    questionType: 'rating-scale',
    scale: 5,
    rating: null,
    timedOut: true,
    thankYouMessage: 'Obrigado!',
    createdAt: base + 2000,
    answeredAt: null,
  });

  const rows = listSatisfactionSurveyResponses({ jid, flowPath, limit: 10 });
  assert.equal(rows.length, 2);
  assert.equal(rows.some(row => row.rating === 4 && row.timedOut === false), true);
  assert.equal(rows.some(row => row.rating == null && row.timedOut === true), true);
});
