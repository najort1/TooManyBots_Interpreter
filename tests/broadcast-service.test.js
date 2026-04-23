import test from 'node:test';
import assert from 'node:assert/strict';

import { getDb } from '../db/context.js';
import {
  addConversationEvent,
  initDb,
  upsertContactDisplayName,
} from '../db/index.js';
import { buildBroadcastMessage } from '../engine/broadcastMessageBuilder.js';
import { createBroadcastService } from '../engine/broadcastService.js';

await initDb();

function buildRecipientFixture(seed = Date.now()) {
  const numericSeed = String(seed).replace(/\D+/g, '').slice(-10);
  const userJid = `55${numericSeed}01@s.whatsapp.net`;
  const groupJid = `120363${numericSeed}@g.us`;
  return { userJid, groupJid };
}

function seedBroadcastRecipients({ userJid, groupJid, baseTs = Date.now() }) {
  addConversationEvent({
    occurredAt: baseTs,
    eventType: 'message-incoming',
    direction: 'incoming',
    jid: userJid,
    flowPath: '/tmp/broadcast-user-flow.tmb',
    messageText: 'oi usuario',
    metadata: {},
  });
  addConversationEvent({
    occurredAt: baseTs + 1,
    eventType: 'message-incoming',
    direction: 'incoming',
    jid: groupJid,
    flowPath: '/tmp/broadcast-group-flow.tmb',
    messageText: 'oi grupo',
    metadata: {},
  });

  upsertContactDisplayName({
    jid: userJid,
    displayName: `Contato ${baseTs}`,
    source: 'test-suite',
    updatedAt: baseTs,
  });
  upsertContactDisplayName({
    jid: groupJid,
    displayName: `Grupo ${baseTs}`,
    source: 'test-suite',
    updatedAt: baseTs,
  });
}

test('broadcast service sends to individual and group recipients with typed metrics', async () => {
  const now = Date.now();
  const { userJid, groupJid } = buildRecipientFixture(now);
  seedBroadcastRecipients({ userJid, groupJid, baseTs: now });

  const sent = [];
  const sock = {
    sendMessage: async (jid, payload) => {
      sent.push({ jid, payload });
      return { ok: true };
    },
  };

  const service = createBroadcastService({
    logger: null,
    getSendDelayMs: () => 0,
  });

  const result = await service.send({
    sock,
    actor: 'test-suite',
    target: 'selected',
    selectedJids: [userJid, groupJid],
    message: buildBroadcastMessage({ text: 'Anuncio teste' }),
  });

  assert.equal(result.attempted, 2);
  assert.equal(result.sent, 2);
  assert.equal(result.failed, 0);
  assert.equal(result.recipientCounts?.attemptedIndividuals, 1);
  assert.equal(result.recipientCounts?.attemptedGroups, 1);
  assert.equal(result.recipientCounts?.sentIndividuals, 1);
  assert.equal(result.recipientCounts?.sentGroups, 1);
  assert.equal(result.metrics?.sentIndividuals, 1);
  assert.equal(result.metrics?.sentGroups, 1);
  assert.equal(sent.length, 2);

  const rows = getDb()
    .prepare(
      `SELECT jid, recipient_type, send_status
       FROM analytics.broadcast_recipients
       WHERE campaign_id = ?
       ORDER BY jid ASC`
    )
    .all(result.campaignId);

  assert.equal(rows.length, 2);
  assert.equal(rows.some(row => row.jid === userJid && row.recipient_type === 'individual' && row.send_status === 'sent'), true);
  assert.equal(rows.some(row => row.jid === groupJid && row.recipient_type === 'group' && row.send_status === 'sent'), true);
});

test('broadcast service marks failed groups with recipientType metadata', async () => {
  const now = Date.now() + 5000;
  const { userJid, groupJid } = buildRecipientFixture(now);
  seedBroadcastRecipients({ userJid, groupJid, baseTs: now });

  const sock = {
    sendMessage: async (jid) => {
      if (jid === groupJid) {
        throw new Error('group-send-failed');
      }
      return { ok: true };
    },
  };

  const service = createBroadcastService({
    logger: null,
    getSendDelayMs: () => 0,
  });

  const result = await service.send({
    sock,
    actor: 'test-suite',
    target: 'selected',
    selectedJids: [userJid, groupJid],
    message: buildBroadcastMessage({ text: 'Anuncio teste' }),
  });

  assert.equal(result.sent, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0]?.jid, groupJid);
  assert.equal(result.failures[0]?.recipientType, 'group');
  assert.equal(result.recipientCounts?.failedGroups, 1);
  assert.equal(result.metrics?.failedGroups, 1);

  const row = getDb()
    .prepare(
      `SELECT recipient_type, send_status, error_message
       FROM analytics.broadcast_recipients
       WHERE campaign_id = ? AND jid = ?`
    )
    .get(result.campaignId, groupJid);

  assert.equal(row?.recipient_type, 'group');
  assert.equal(row?.send_status, 'failed');
  assert.match(String(row?.error_message || ''), /group-send-failed/);
});
