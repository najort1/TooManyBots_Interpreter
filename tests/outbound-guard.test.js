import test from 'node:test';
import assert from 'node:assert/strict';

import { createOutboundGuard } from '../engine/outboundGuard.js';
import { sendTextMessage } from '../engine/sender.js';

test('outboundGuard: min gap e limite por jid/minuto', async () => {
  const guard = createOutboundGuard({
    enabled: true,
    maxPerMinute: 100,
    maxPerHour: 1000,
    maxPerJidPerMinute: 3,
    maxPerJidPerHour: 100,
    minGapMs: 50,
    identicalCooldownMs: 0,
    typingEnabled: false,
    waitCapMs: 500,
  });

  const jid = '120363test@g.us';
  for (let i = 0; i < 3; i += 1) {
    const a = await guard.acquire(jid, { text: `msg-${i}` });
    assert.equal(a.ok, true);
    guard.record(jid, { text: `msg-${i}` });
  }

  const blocked = await guard.acquire(jid, { text: 'msg-4' });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'rate-limit');
});

test('outboundGuard: bloqueia texto idêntico no mesmo jid', async () => {
  const guard = createOutboundGuard({
    enabled: true,
    maxPerMinute: 100,
    maxPerHour: 1000,
    maxPerJidPerMinute: 50,
    maxPerJidPerHour: 500,
    minGapMs: 0,
    identicalCooldownMs: 60_000,
    typingEnabled: false,
    waitCapMs: 100,
  });

  const jid = '5511999@s.whatsapp.net';
  const a = await guard.acquire(jid, { text: 'olá igual' });
  assert.equal(a.ok, true);
  guard.record(jid, { text: 'olá igual' });

  const b = await guard.acquire(jid, { text: 'olá igual' });
  assert.equal(b.ok, false);
  assert.equal(b.reason, 'identical-text');

  const c = await guard.acquire(jid, { text: 'olá diferente' });
  assert.equal(c.ok, true);
});

test('sendTextMessage: usa guard + typing best-effort', async () => {
  const presence = [];
  const sent = [];
  const sock = {
    sendPresenceUpdate: async (state, jid) => {
      presence.push({ state, jid });
    },
    sendMessage: async (jid, content) => {
      sent.push({ jid, content });
    },
  };

  const guard = createOutboundGuard({
    enabled: true,
    maxPerMinute: 50,
    maxPerHour: 500,
    maxPerJidPerMinute: 20,
    maxPerJidPerHour: 200,
    minGapMs: 0,
    identicalCooldownMs: 0,
    typingEnabled: true,
    typingMinMs: 20,
    typingMaxMs: 40,
    waitCapMs: 1000,
  });

  const r = await sendTextMessage(sock, 'g@g.us', 'oi teste de digitacao', { guard });
  assert.equal(r.skipped, false);
  assert.equal(sent.length, 1);
  assert.ok(presence.some((p) => p.state === 'composing'));
  assert.ok(presence.some((p) => p.state === 'paused'));
});

test('sendTextMessage: skip texto idêntico', async () => {
  const sent = [];
  const sock = {
    sendMessage: async (jid, content) => {
      sent.push({ jid, content });
    },
  };
  const guard = createOutboundGuard({
    enabled: true,
    maxPerMinute: 50,
    maxPerHour: 500,
    maxPerJidPerMinute: 20,
    maxPerJidPerHour: 200,
    minGapMs: 0,
    identicalCooldownMs: 30_000,
    typingEnabled: false,
    waitCapMs: 500,
  });

  await sendTextMessage(sock, 'u@s.whatsapp.net', 'mesmo', { guard });
  const r2 = await sendTextMessage(sock, 'u@s.whatsapp.net', 'mesmo', { guard });
  assert.equal(r2.skipped, true);
  assert.equal(r2.reason, 'identical-text');
  assert.equal(sent.length, 1);
});
