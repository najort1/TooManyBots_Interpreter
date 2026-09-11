import test from 'node:test';
import assert from 'node:assert/strict';

import { createPersonaAutonomyPolicy, hasStopRequest } from '../fun/services/personaAutonomyPolicy.js';

const group = '120363999999999@g.us';
const baseConfig = {
  personaAutonomyEnabled: true,
  personaAutonomyMode: 'llm',
  personaAutonomyCooldownMs: 15 * 60_000,
  personaAutonomyMaxPerHour: 2,
  personaAutonomyMaxPerDay: 8,
  personaAutonomyMaxConsecutive: 1,
  personaAutonomyNegativeBlockMs: 20 * 60_000,
  personaAutonomyCausalityWindowMs: 15 * 60_000,
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

test('persona autonomy policy: mensagem humana libera sequência e pedido de silêncio citando o bot bloqueia o grupo', () => {
  const repository = memoryRepository();
  const now = 1_700_000_000_000;
  const policy = createPersonaAutonomyPolicy({ autonomyRepository: repository, now: () => now });

  // Bot agiu autonomamente há 10 minutos (cooldown de 5 min passou, mas dentro da janela de causalidade de 15 min)
  const testCooldownMs = 5 * 60_000;
  const cfg = { ...baseConfig, personaAutonomyCooldownMs: testCooldownMs };
  policy.recordSent(group, now - 10 * 60_000);
  policy.observeHumanMessage(group, { text: 'continua aí', funConfig: cfg, currentNow: now });
  assert.equal(
    policy.evaluate({ scopeKey: group, text: 'kkkk muito bom', funConfig: cfg, currentNow: now }).eligible,
    true
  );

  // Mensagem sem citação ao bot (ex: entre humanos) não bloqueia o grupo
  policy.observeHumanMessage(group, {
    text: 'para de ser carente usuario 1',
    quotedIsBot: false,
    funConfig: cfg,
    currentNow: now + 1,
  });
  assert.equal(
    policy.evaluate({ scopeKey: group, text: 'kkkk ainda bem', funConfig: cfg, currentNow: now + 2 }).eligible,
    true
  );

  // Mensagem citando o bot explicitamente com pedido de parada bloqueia
  policy.observeHumanMessage(group, {
    text: 'para bot',
    quotedIsBot: true,
    funConfig: cfg,
    currentNow: now + 3,
  });
  const blocked = policy.evaluate({
    scopeKey: group,
    text: 'kkkk ainda bem',
    funConfig: cfg,
    currentNow: now + 4,
  });
  assert.equal(blocked.eligible, false);
  assert.equal(blocked.reason, 'negative-signal');
});

test('persona autonomy policy: pedido de silêncio sem fala autônoma recente (causalidade) não bloqueia', () => {
  const repository = memoryRepository();
  const now = 1_700_000_000_000;
  const policy = createPersonaAutonomyPolicy({ autonomyRepository: repository, now: () => now });

  // Bot NÃO agiu nos últimos 15 minutos (lastAt = 0 ou antigo)
  policy.observeHumanMessage(group, {
    text: 'para bot',
    quotedIsBot: true,
    funConfig: baseConfig,
    currentNow: now,
  });

  const evalResult = policy.evaluate({
    scopeKey: group,
    text: 'kkkk muito bom',
    funConfig: baseConfig,
    currentNow: now + 1,
  });
  assert.equal(evalResult.eligible, true);
});

test('hasStopRequest: distingue pedidos reais de parada de falsos positivos em português', () => {
  // Falsos positivos comuns (devem ser FALSE)
  assert.equal(hasStopRequest('para de ser carente usuario 1'), false);
  assert.equal(hasStopRequest('nossa mano se tem que parar de sumir vc é muito legal'), false);
  assert.equal(hasStopRequest('vou para casa agora'), false);
  assert.equal(hasStopRequest('olha para isso para ver se dá certo'), false);
  assert.equal(hasStopRequest('não para não kkk'), false);
  assert.equal(hasStopRequest('quando você chega?'), false);
  assert.equal(hasStopRequest('chega mais galera'), false);
  assert.equal(hasStopRequest('para que tá lindo demais'), false);
  assert.equal(hasStopRequest('para de sumir bot'), false);

  // Pedidos reais de parada (devem ser TRUE)
  assert.equal(hasStopRequest('para'), true);
  assert.equal(hasStopRequest('para!'), true);
  assert.equal(hasStopRequest('pare bot'), true);
  assert.equal(hasStopRequest('para bot'), true);
  assert.equal(hasStopRequest('cala a boca'), true);
  assert.equal(hasStopRequest('fica quieto'), true);
  assert.equal(hasStopRequest('fica calado'), true);
  assert.equal(hasStopRequest('para de falar'), true);
  assert.equal(hasStopRequest('não responde mais'), true);
  assert.equal(hasStopRequest('chega bot'), true);
  assert.equal(hasStopRequest('silêncio bot'), true);
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
