import test from 'node:test';
import assert from 'node:assert/strict';

import { createPersonaAutonomyPolicy } from '../fun/services/personaAutonomyPolicy.js';

const group = '120363999999999@g.us';
const baseConfig = {
  personaAutonomyEnabled: true,
  personaAutonomyMode: 'llm',
  personaAutonomyCooldownMs: 15 * 60_000,
  personaAutonomyMaxPerHour: 2,
  personaAutonomyMaxPerDay: 8,
  personaAutonomyMaxConsecutive: 1,
  personaAutonomyNegativeBlockMs: 60 * 60_000,
  worldQuietHoursEnabled: false,
};

function memoryRepository() {
  const states = new Map();
  return {
    getState(scopeKey) {
      return states.get(scopeKey) || {
        lastActionAt: 0,
        actionTimestamps: [],
        consecutiveCount: 0,
        negativeUntil: 0,
      };
    },
    saveState(scopeKey, state) {
      states.set(scopeKey, structuredClone(state));
      return { ok: true };
    },
    states,
  };
}

test('persona autonomy policy: persiste cooldown e sequência após recriar a política', () => {
  const repository = memoryRepository();
  const now = 1_700_000_000_000;
  const first = createPersonaAutonomyPolicy({ autonomyRepository: repository, now: () => now });

  assert.equal(first.evaluate({ scopeKey: group, text: 'kkkk que absurdo', funConfig: baseConfig, currentNow: now }).eligible, true);
  first.recordSent(group, now);

  const restarted = createPersonaAutonomyPolicy({ autonomyRepository: repository, now: () => now + 1 });
  const result = restarted.evaluate({
    scopeKey: group,
    text: 'olha isso kkk',
    funConfig: baseConfig,
    currentNow: now + 1,
  });

  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'cooldown');
});

test('persona autonomy policy: mensagem humana libera sequência e pedido de silêncio bloqueia o grupo', () => {
  const repository = memoryRepository();
  const now = 1_700_000_000_000;
  const policy = createPersonaAutonomyPolicy({ autonomyRepository: repository, now: () => now });

  policy.recordSent(group, now - baseConfig.personaAutonomyCooldownMs - 1);
  policy.observeHumanMessage(group, { text: 'continua aí', funConfig: baseConfig, currentNow: now });
  assert.equal(
    policy.evaluate({ scopeKey: group, text: 'kkkk muito bom', funConfig: baseConfig, currentNow: now }).eligible,
    true
  );

  policy.observeHumanMessage(group, { text: 'para bot', funConfig: baseConfig, currentNow: now + 1 });
  const blocked = policy.evaluate({
    scopeKey: group,
    text: 'kkkk ainda bem',
    funConfig: baseConfig,
    currentNow: now + 2,
  });
  assert.equal(blocked.eligible, false);
  assert.equal(blocked.reason, 'negative-signal');
});

test('persona autonomy policy: bloqueia conteúdo sensível e sinal social negativo antes do LLM', () => {
  const policy = createPersonaAutonomyPolicy({ now: () => 1_700_000_000_000 });

  assert.equal(
    policy.evaluate({ scopeKey: group, text: 'me passa seu cpf', funConfig: baseConfig, currentNow: 1_700_000_000_000 }).reason,
    'sensitive'
  );
  assert.equal(
    policy.evaluate({
      scopeKey: group,
      text: 'kkkk',
      socialSignals: [{ socialSignal: 'negative' }],
      funConfig: baseConfig,
      currentNow: 1_700_000_000_000,
    }).reason,
    'negative-social-signal'
  );
});
