import test from 'node:test';
import assert from 'node:assert/strict';

import { formatActorLabel } from '../dashboard/serverMetricsUtils.js';
import { createFlowRuntimeManager } from '../runtime/flowRuntimeManager.js';

test('formatActorLabel prefers persisted contact name and keeps phone context', () => {
  const label = formatActorLabel(
    jid => (jid === '5511999999999@s.whatsapp.net' ? 'Maria Cliente' : ''),
    '5511999999999@s.whatsapp.net'
  );

  assert.equal(label, 'Maria Cliente (5511999999999)');
});

test('formatActorLabel falls back to readable phone instead of raw JID', () => {
  assert.equal(
    formatActorLabel(() => '', '5511888888888@s.whatsapp.net'),
    '5511888888888'
  );
});

test('flow reload emits start and success events with dashboard payload metadata', async () => {
  const events = [];
  const activeFlows = [{ flowPath: 'bots/atendimento.tmb' }];
  const manager = createFlowRuntimeManager({
    getConfig: () => ({}),
    isDevelopmentMode: () => false,
    getActiveFlows: () => activeFlows,
    resetActiveSessions: async () => 2,
    loadFlowRegistryFromConfig: () => activeFlows,
    applyFlowSessionTimeoutOverrides: registry => registry,
    setCurrentFlowRegistry: () => {},
    setWarnedMissingTestTargets: () => {},
    getCurrentSocket: () => null,
    startSessionCleanup: () => {},
    currentPrimaryFlowPathForLogs: () => 'bots/atendimento.tmb',
    logConversationEvent: event => events.push(event),
  });

  const result = await manager.reloadFlow({ source: 'dashboard' });

  assert.equal(result.ok, true);
  assert.equal(result.endedSessions, 2);
  assert.deepEqual(events.map(event => event.eventType), ['flow-reload-start', 'flow-reload-success']);
  assert.equal(events[1].metadata.source, 'dashboard');
  assert.deepEqual(events[1].metadata.flowPaths, ['bots/atendimento.tmb']);
});

test('flow reload returns failure and emits error event when registry loading fails', async () => {
  const events = [];
  const manager = createFlowRuntimeManager({
    getConfig: () => ({}),
    isDevelopmentMode: () => false,
    getActiveFlows: () => [{ flowPath: 'bots/quebrado.tmb' }],
    resetActiveSessions: async () => 0,
    loadFlowRegistryFromConfig: () => {
      throw new Error('invalid-json');
    },
    applyFlowSessionTimeoutOverrides: registry => registry,
    setCurrentFlowRegistry: () => {},
    setWarnedMissingTestTargets: () => {},
    getCurrentSocket: () => null,
    startSessionCleanup: () => {},
    currentPrimaryFlowPathForLogs: () => 'bots/quebrado.tmb',
    logConversationEvent: event => events.push(event),
  });

  const result = await manager.reloadFlow({ source: 'dashboard' });

  assert.equal(result.ok, false);
  assert.match(result.error, /invalid-json/);
  assert.equal(events.at(-1).eventType, 'flow-reload-error');
  assert.equal(events.at(-1).metadata.source, 'dashboard');
});
