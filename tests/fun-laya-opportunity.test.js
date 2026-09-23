import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersonaOpportunityDetector } from '../fun/services/personaOpportunityDetector.js';

test('personaOpportunityDetector: quando layaEnabled=false, usa apenas Zen', async () => {
  let zenCalled = false;
  let layaCalled = false;

  const fakeZen = async () => {
    zenCalled = true;
    return JSON.stringify({
      action: 'pass',
      score: 10,
      reason: 'sem gancho',
    });
  };

  const fakeLaya = async () => {
    layaCalled = true;
    return { ok: true, answers: { action: { choice: 'pass' } } };
  };

  const detector = createPersonaOpportunityDetector({
    autonomyPolicy: { evaluate: () => ({ eligible: true }) },
    generateZen: fakeZen,
    predictLaya: fakeLaya,
  });

  const res = await detector.evaluate({
    scopeKey: '123@g.us',
    text: 'olha isso kkkk mds',
    funConfig: {
      layaEnabled: false,
      personaAutonomyEnabled: true,
      personaAutonomyLlmEnabled: true,
      zenEnabled: true,
    },
  });

  assert.equal(layaCalled, false);
  assert.equal(zenCalled, true);
  assert.equal(res.eligible, false);
});

test('personaOpportunityDetector: Laya pass encerra imediatamente sem chamar Zen', async () => {
  let zenCalled = false;
  let layaCalled = false;

  const fakeZen = async () => {
    zenCalled = true;
    return JSON.stringify({ action: 'comment', score: 90, reason: 'zen' });
  };

  const fakeLaya = async () => {
    layaCalled = true;
    return {
      ok: true,
      answers: {
        action: { choice: 'pass', confidence: 0.95 },
        score: { score: 0.1 }, // score baixo (~2.5/100)
      },
    };
  };

  const detector = createPersonaOpportunityDetector({
    autonomyPolicy: { evaluate: () => ({ eligible: true }) },
    generateZen: fakeZen,
    predictLaya: fakeLaya,
  });

  const res = await detector.evaluate({
    scopeKey: '123@g.us',
    text: 'olha isso kkkk mds',
    funConfig: {
      layaEnabled: true,
      layaOpportunityEnabled: true,
      personaAutonomyEnabled: true,
      personaAutonomyLlmEnabled: true,
      zenEnabled: true,
    },
  });

  assert.equal(layaCalled, true);
  assert.equal(zenCalled, false); // ZEN NÃO FOI CHAMADO! Economia total!
  assert.equal(res.eligible, false);
  assert.equal(res.reason, 'laya-pass');
});

test('personaOpportunityDetector: fallback transparente para Zen quando Laya falha', async () => {
  let zenCalled = false;
  let layaCalled = false;

  const fakeZen = async () => {
    zenCalled = true;
    return JSON.stringify({
      action: 'pass',
      score: 15,
      reason: 'zen fallback',
    });
  };

  const fakeLaya = async () => {
    layaCalled = true;
    return { ok: false, reason: 'circuit-open', fallback: true };
  };

  const detector = createPersonaOpportunityDetector({
    autonomyPolicy: { evaluate: () => ({ eligible: true }) },
    generateZen: fakeZen,
    predictLaya: fakeLaya,
  });

  const res = await detector.evaluate({
    scopeKey: '123@g.us',
    text: 'olha isso kkkk mds',
    funConfig: {
      layaEnabled: true,
      layaOpportunityEnabled: true,
      personaAutonomyEnabled: true,
      personaAutonomyLlmEnabled: true,
      zenEnabled: true,
    },
  });

  assert.equal(layaCalled, true);
  assert.equal(zenCalled, true); // Fallback suave assumiu!
  assert.equal(res.eligible, false);
});
