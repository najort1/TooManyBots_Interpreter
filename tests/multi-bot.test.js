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
} from '../db/index.js';
import { handleIncoming } from '../engine/flowEngine.js';
import { loadFlows } from '../engine/flowLoader.js';

await initDb();

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

test('database info includes daily size history snapshots', () => {
  const info = getDatabaseInfo();
  assert.ok(Array.isArray(info.sizeHistory), 'sizeHistory should be an array');
  assert.ok((info.sizeHistory?.length || 0) >= 1, 'sizeHistory should have at least one daily point');
  assert.ok(Number.isFinite(info.totalStorageBytes), 'totalStorageBytes should be numeric');
});
