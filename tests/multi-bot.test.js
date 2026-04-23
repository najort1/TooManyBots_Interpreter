import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  initDb,
  createSession,
  deleteSession,
  getSession,
  updateSession,
  getConversationDashboardStats,
  getConversationSessionsTotal,
  getDatabaseInfo,
  addConversationEvent,
  getContactDisplayName,
  listBroadcastContacts,
  listContactDisplayNames,
  upsertContactDisplayName,
} from '../db/index.js';
import { handleIncoming } from '../engine/flowEngine.js';
import { loadFlows } from '../engine/flowLoader.js';

await initDb();

function createFlowFixture(flowPath, blocks, runtimeConfig = { conversationMode: 'conversation' }) {
  const blockMap = new Map();
  const indexMap = new Map();
  blocks.forEach((block, index) => {
    blockMap.set(block.id, block);
    indexMap.set(block.id, index);
  });

  return {
    flowPath,
    runtimeConfig,
    blocks,
    blockMap,
    indexMap,
    branchMap: new Map(),
    endIfMap: new Map(),
  };
}

test('session rows are isolated by flow path and bot type', () => {
  const jid = `isolation-${Date.now()}@s.whatsapp.net`;
  const scopeConversation = { flowPath: '/tmp/flow-conversation.tmb', botType: 'conversation' };
  const scopeCommand = { flowPath: '/tmp/flow-command.tmb', botType: 'command' };

  try {
    createSession(jid, scopeConversation);
    createSession(jid, scopeCommand);

    updateSession(jid, { blockIndex: 3, variables: { stage: 'conversation' } }, scopeConversation);
    updateSession(jid, { blockIndex: 8, variables: { stage: 'command' } }, scopeCommand);

    const conversationSession = getSession(jid, scopeConversation);
    const commandSession = getSession(jid, scopeCommand);

    assert.equal(conversationSession?.blockIndex, 3);
    assert.equal(conversationSession?.botType, 'conversation');
    assert.equal(commandSession?.blockIndex, 8);
    assert.equal(commandSession?.botType, 'command');
  } finally {
    deleteSession(jid, scopeConversation);
    deleteSession(jid, scopeCommand);
  }
});

test('same incoming message id is processed independently by distinct command flows', async () => {
  const jid = `parallel-${Date.now()}@s.whatsapp.net`;
  const flowA = {
    flowPath: '/tmp/command-a.tmb',
    runtimeConfig: { conversationMode: 'command' },
    blocks: [
      { id: 'cmd-a', type: 'command-input', config: { pattern: '/ping', command: 'ping', args: [] } },
      { id: 'text-a', type: 'send-text', config: { text: 'pong-a', waitForResponse: false, captureResponse: false } },
      { id: 'end-a', type: 'end-conversation', config: { message: 'ok', resetVariables: true } },
    ],
    blockMap: new Map(),
    indexMap: new Map(),
    branchMap: new Map(),
    endIfMap: new Map(),
  };
  const flowB = {
    flowPath: '/tmp/command-b.tmb',
    runtimeConfig: { conversationMode: 'command' },
    blocks: [
      { id: 'cmd-b', type: 'command-input', config: { pattern: '/ping', command: 'ping', args: [] } },
      { id: 'text-b', type: 'send-text', config: { text: 'pong-b', waitForResponse: false, captureResponse: false } },
      { id: 'end-b', type: 'end-conversation', config: { message: 'ok', resetVariables: true } },
    ],
    blockMap: new Map(),
    indexMap: new Map(),
    branchMap: new Map(),
    endIfMap: new Map(),
  };

  const sends = [];
  const sock = {
    sendMessage: async (targetJid, payload, options = {}) => {
      sends.push({ targetJid, payload, options });
      return { ok: true };
    },
  };

  try {
    await Promise.all([
      handleIncoming(sock, jid, '/ping', null, flowA, 'same-msg-id'),
      handleIncoming(sock, jid, '/ping', null, flowB, 'same-msg-id'),
    ]);

    const sessionA = getSession(jid, { flowPath: flowA.flowPath });
    const sessionB = getSession(jid, { flowPath: flowB.flowPath });
    assert.ok(sessionA, 'flow A should persist its own session');
    assert.ok(sessionB, 'flow B should persist its own session');
    assert.notEqual(sessionA.flowPath, sessionB.flowPath);
    assert.ok(sends.length >= 2, 'both command flows should emit outgoing messages');
  } finally {
    deleteSession(jid, { flowPath: flowA.flowPath });
    deleteSession(jid, { flowPath: flowB.flowPath });
  }
});

test('flow loader rejects multiple conversation flows in parallel', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmb-flow-'));
  const flowA = path.join(tempDir, 'conversation-a.tmb');
  const flowB = path.join(tempDir, 'conversation-b.tmb');

  fs.writeFileSync(
    flowA,
    JSON.stringify({
      version: '1.0',
      flowRuntimeConfig: { conversationMode: 'conversation' },
      blocks: [{ id: 'start-a', type: 'initial-message', config: { text: 'A' } }],
    }),
    'utf-8'
  );
  fs.writeFileSync(
    flowB,
    JSON.stringify({
      version: '1.0',
      flowRuntimeConfig: { conversationMode: 'conversation' },
      blocks: [{ id: 'start-b', type: 'initial-message', config: { text: 'B' } }],
    }),
    'utf-8'
  );

  try {
    assert.throws(() => loadFlows([flowA, flowB]), /apenas 1 fluxo de conversa pode ficar ativo/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('command bot does not create conversation session analytics records', async () => {
  const now = Date.now();
  const jid = `no-analytics-${now}@s.whatsapp.net`;
  const commandFlowPath = `/tmp/command-no-analytics-${now}.tmb`;
  const commandFlow = {
    flowPath: commandFlowPath,
    runtimeConfig: { conversationMode: 'command' },
    blocks: [
      { id: 'cmd', type: 'command-input', config: { pattern: '/status', command: 'status', args: [] } },
      { id: 'txt', type: 'send-text', config: { text: 'ok', waitForResponse: false, captureResponse: false } },
      { id: 'end', type: 'end-conversation', config: { message: 'ok', resetVariables: true } },
    ],
    blockMap: new Map(),
    indexMap: new Map(),
    branchMap: new Map(),
    endIfMap: new Map(),
  };
  const sock = {
    sendMessage: async () => ({ ok: true }),
  };

  await handleIncoming(sock, jid, '/status', null, commandFlow, `msg-${now}`);

  const stats = getConversationDashboardStats({
    from: now - (5 * 60 * 1000),
    to: Date.now() + (5 * 60 * 1000),
    flowPath: commandFlowPath,
  });

  assert.equal(stats.conversationsStarted, 0);
  assert.equal(stats.abandonedSessions, 0);
  assert.equal(stats.activeSessions, 0);
  assert.equal(getConversationSessionsTotal(commandFlowPath), 0);

  deleteSession(jid, { flowPath: commandFlowPath, botType: 'command' });
});

test('keycheck executes matching thenActions and continues flow', async () => {
  const now = Date.now();
  const jid = `keycheck-success-${now}@s.whatsapp.net`;
  const flowPath = `/tmp/keycheck-success-${now}.tmb`;
  const sent = [];
  const sock = {
    sendMessage: async (targetJid, payload) => {
      sent.push({ targetJid, payload });
      return { ok: true };
    },
  };

  const flow = createFlowFixture(flowPath, [
    { id: 'start', type: 'initial-message', config: { text: 'inicio' } },
    { id: 'setPayload', type: 'set-variable', config: { variableName: 'payload', variableValue: 'ok-response' } },
    {
      id: 'check',
      type: 'keycheck',
      config: {
        conditionals: [
          {
            id: 'fail',
            type: 'Failure',
            mode: 'OR',
            conditions: [{ id: 'c1', source: 'payload', operator: 'Contains', value: 'erro' }],
            redirectBlockId: 'fallback',
            thenActions: [{ id: 'a1', type: 'send-text', config: { text: 'falhou' } }],
          },
          {
            id: 'success',
            type: 'Success',
            mode: 'OR',
            conditions: [{ id: 'c2', source: 'payload', operator: 'Contains', value: 'ok' }],
            redirectBlockId: '',
            thenActions: [{ id: 'a2', type: 'send-text', config: { text: 'sucesso {{$payload}}' } }],
          },
        ],
      },
    },
    { id: 'after', type: 'send-text', config: { text: 'continuou', waitForResponse: false, captureResponse: false } },
    { id: 'end', type: 'end-conversation', config: { message: '' } },
    { id: 'fallback', type: 'send-text', config: { text: 'rota-falha', waitForResponse: false, captureResponse: false } },
  ]);

  try {
    await handleIncoming(sock, jid, 'oi', null, flow, `msg-${now}`);
    const texts = sent.map(item => item.payload?.text).filter(Boolean);

    assert.deepEqual(texts, ['inicio', 'sucesso ok-response', 'continuou']);
    assert.equal(texts.includes('rota-falha'), false);
  } finally {
    deleteSession(jid, { flowPath });
  }
});

test('keycheck supports redirectBlockId for matched conditional', async () => {
  const now = Date.now();
  const jid = `keycheck-redirect-${now}@s.whatsapp.net`;
  const flowPath = `/tmp/keycheck-redirect-${now}.tmb`;
  const sent = [];
  const sock = {
    sendMessage: async (targetJid, payload) => {
      sent.push({ targetJid, payload });
      return { ok: true };
    },
  };

  const flow = createFlowFixture(flowPath, [
    { id: 'start', type: 'initial-message', config: { text: 'inicio' } },
    { id: 'setPayload', type: 'set-variable', config: { variableName: 'payload', variableValue: 'erro-status' } },
    {
      id: 'check',
      type: 'keycheck',
      config: {
        conditionals: [
          {
            id: 'fail',
            type: 'Failure',
            mode: 'OR',
            conditions: [{ id: 'c1', source: 'payload', operator: 'Contains', value: 'erro' }],
            redirectBlockId: 'fallback',
            thenActions: [{ id: 'a1', type: 'send-text', config: { text: 'falhou {{$payload}}' } }],
          },
          {
            id: 'success',
            type: 'Success',
            mode: 'OR',
            conditions: [{ id: 'c2', source: 'payload', operator: 'Contains', value: 'ok' }],
            redirectBlockId: '',
            thenActions: [{ id: 'a2', type: 'send-text', config: { text: 'sucesso' } }],
          },
        ],
      },
    },
    { id: 'after', type: 'send-text', config: { text: 'continuou', waitForResponse: false, captureResponse: false } },
    { id: 'end', type: 'end-conversation', config: { message: '' } },
    { id: 'fallback', type: 'send-text', config: { text: 'rota-falha', waitForResponse: false, captureResponse: false } },
  ]);

  try {
    await handleIncoming(sock, jid, 'oi', null, flow, `msg-${now}`);
    const texts = sent.map(item => item.payload?.text).filter(Boolean);

    assert.deepEqual(texts, ['inicio', 'falhou erro-status', 'rota-falha']);
    assert.equal(texts.includes('continuou'), false);
  } finally {
    deleteSession(jid, { flowPath });
  }
});

test('keycheck supports orchestrator operator aliases', async () => {
  const now = Date.now();
  const jid = `keycheck-operators-${now}@s.whatsapp.net`;
  const flowPath = `/tmp/keycheck-operators-${now}.tmb`;
  const sent = [];
  const sock = {
    sendMessage: async (targetJid, payload) => {
      sent.push({ targetJid, payload });
      return { ok: true };
    },
  };

  const flow = createFlowFixture(flowPath, [
    { id: 'start', type: 'initial-message', config: { text: 'inicio' } },
    { id: 'setScore', type: 'set-variable', config: { variableName: 'score', variableValue: '5' } },
    {
      id: 'check',
      type: 'keycheck',
      config: {
        conditionals: [
          {
            id: 'less',
            type: 'Custom',
            mode: 'AND',
            conditions: [{ id: 'c1', source: 'score', operator: 'LessThan', value: '10' }],
            redirectBlockId: '',
            thenActions: [{ id: 'a1', type: 'send-text', config: { text: 'less-than-ok' } }],
          },
          {
            id: 'missing',
            type: 'Custom',
            mode: 'AND',
            conditions: [{ id: 'c2', source: 'nao_existe', operator: 'DoesNotExist', value: '' }],
            redirectBlockId: '',
            thenActions: [{ id: 'a2', type: 'send-text', config: { text: 'missing-ok' } }],
          },
        ],
      },
    },
    { id: 'end', type: 'end-conversation', config: { message: '' } },
  ]);

  try {
    await handleIncoming(sock, jid, 'oi', null, flow, `msg-${now}`);
    const texts = sent.map(item => item.payload?.text).filter(Boolean);
    assert.deepEqual(texts, ['inicio', 'less-than-ok']);
  } finally {
    deleteSession(jid, { flowPath });
  }
});

test('database info includes daily size history snapshots', () => {
  const info = getDatabaseInfo();
  assert.ok(Array.isArray(info.sizeHistory), 'sizeHistory should be an array');
  assert.ok((info.sizeHistory?.length || 0) >= 1, 'sizeHistory should have at least one daily point');
  assert.ok(Number.isFinite(info.totalStorageBytes), 'totalStorageBytes should be numeric');
});

test('contact display names persist in sqlite and enrich broadcast list results', () => {
  const now = Date.now();
  const jid = '5511999999999@s.whatsapp.net';

  addConversationEvent({
    occurredAt: now,
    eventType: 'message-incoming',
    direction: 'incoming',
    jid,
    flowPath: '/tmp/persisted-contact-flow.tmb',
    messageText: 'oi',
    metadata: {},
  });

  const upserted = upsertContactDisplayName({
    jid,
    displayName: '~lucy',
    source: 'test-suite',
    updatedAt: now,
  });

  assert.equal(upserted, true);
  assert.equal(getContactDisplayName(jid), 'lucy');

  const names = listContactDisplayNames(5000);
  assert.ok(
    names.some(item => item.jid === jid && item.name === 'lucy'),
    'expected persisted contact name in listContactDisplayNames'
  );

  const broadcastList = listBroadcastContacts({ search: 'lucy', limit: 200 });
  assert.ok(
    broadcastList.some(item => item.jid === jid && item.name === 'lucy'),
    'expected persisted contact name to be searchable in broadcast contacts'
  );
});

test('broadcast contacts include persisted profiles even without incoming event history', () => {
  const now = Date.now();
  const jid = `55${now}@s.whatsapp.net`;

  const upserted = upsertContactDisplayName({
    jid,
    displayName: 'Contato sem historico',
    source: 'test-suite',
    updatedAt: now,
  });

  assert.equal(upserted, true);

  const broadcastList = listBroadcastContacts({ search: 'sem historico', limit: 500 });
  assert.ok(
    broadcastList.some(item => item.jid === jid && item.name === 'Contato sem historico'),
    'expected persisted-only contact profile to be listed in broadcast contacts'
  );
});

test('broadcast contacts include valid group profiles with recipientType group', () => {
  const now = Date.now();
  const groupJid = '120363405600887559@g.us';

  addConversationEvent({
    occurredAt: now,
    eventType: 'message-incoming',
    direction: 'incoming',
    jid: groupJid,
    flowPath: '/tmp/persisted-group-flow.tmb',
    messageText: 'oi grupo',
    metadata: {},
  });

  const upserted = upsertContactDisplayName({
    jid: groupJid,
    displayName: 'Grupo VIP',
    source: 'test-suite',
    updatedAt: now,
  });

  assert.equal(upserted, true);

  const broadcastList = listBroadcastContacts({ search: 'Grupo VIP', limit: 500 });
  const groupEntry = broadcastList.find(item => item.jid === groupJid);
  assert.ok(groupEntry, 'expected persisted group to be listed in broadcast contacts');
  assert.equal(groupEntry?.recipientType, 'group');
});

test('invalid group jid is ignored by broadcast contacts list', () => {
  const now = Date.now();
  const invalidGroupJid = `grupo-invalido-${now}@g.us`;

  addConversationEvent({
    occurredAt: now,
    eventType: 'message-incoming',
    direction: 'incoming',
    jid: invalidGroupJid,
    flowPath: '/tmp/persisted-group-flow.tmb',
    messageText: 'oi grupo invalido',
    metadata: {},
  });

  upsertContactDisplayName({
    jid: invalidGroupJid,
    displayName: 'Grupo Invalido',
    source: 'test-suite',
    updatedAt: now,
  });

  const broadcastList = listBroadcastContacts({ search: 'Grupo Invalido', limit: 500 });
  assert.equal(
    broadcastList.some(item => item.jid === invalidGroupJid),
    false,
    'invalid group jid should not be listed for broadcast'
  );
});

test('synthetic user jid is ignored by contact persistence and broadcast contacts list', () => {
  const now = Date.now();
  const jid = `persisted-contact-${now}@s.whatsapp.net`;

  addConversationEvent({
    occurredAt: now,
    eventType: 'message-incoming',
    direction: 'incoming',
    jid,
    flowPath: '/tmp/persisted-contact-flow.tmb',
    messageText: 'oi',
    metadata: {},
  });

  const upserted = upsertContactDisplayName({
    jid,
    displayName: '~lucy',
    source: 'test-suite',
    updatedAt: now,
  });

  assert.equal(upserted, false);
  assert.equal(getContactDisplayName(jid), '');

  const names = listContactDisplayNames(5000);
  assert.equal(
    names.some(item => item.jid === jid),
    false,
    'synthetic jid should not be returned by listContactDisplayNames'
  );

  const broadcastList = listBroadcastContacts({ search: 'persisted-contact', limit: 500 });
  assert.equal(
    broadcastList.some(item => item.jid === jid),
    false,
    'synthetic jid should not be returned by broadcast contacts'
  );
});
