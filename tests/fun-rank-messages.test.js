import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createFunModule, parseFunCommand, resolveFunConfig } from '../fun/index.js';
import { _resetDefaultFunStatsRepository } from '../fun/db/funStatsRepository.js';
import { FUN_COMMANDS } from '../fun/constants.js';

await initDb();
_resetDefaultFunStatsRepository();

test('parseFunCommand: topmsg aliases', () => {
  assert.equal(parseFunCommand('/topmsg', '/').command, FUN_COMMANDS.RANK_MESSAGES);
  assert.equal(parseFunCommand('/mensagens', '/').command, FUN_COMMANDS.RANK_MESSAGES);
  assert.equal(parseFunCommand('/maisativos', '/').command, FUN_COMMANDS.RANK_MESSAGES);
  assert.equal(parseFunCommand('/rankmsg', '/').command, FUN_COMMANDS.RANK_MESSAGES);
});

test('message_count sobe no cooldown e /topmsg ordena', async () => {
  const group = `120363${Date.now()}99@g.us`;
  const user0 = `551199900001${String(Date.now()).slice(-4)}@s.whatsapp.net`;
  const user1 = `551199900002${String(Date.now()).slice(-4)}@s.whatsapp.net`;
  const sent = [];

  const funConfig = resolveFunConfig({
    enabled: true,
    requireGroupWhitelist: true,
    groupWhitelistJids: [group],
    replyCommandsInPrivate: false,
    cooldownMs: 60_000,
    xpMin: 10,
    xpMax: 10,
    ollamaEnabled: false,
    announceLevelUp: false,
  });

  const mod = createFunModule({
    getConfig: () => funConfig,
    getLogger: () => null,
    getDatabase: getDb,
    sendText: async (_s, _j, t) => {
      sent.push(t);
    },
    getContactDisplayName: (j) => (j === user0 ? 'Alice' : j === user1 ? 'Bob' : j.split('@')[0]),
  });
  mod.init();

  for (let i = 0; i < 5; i += 1) {
    await mod.onIncomingMessage({
      sock: {},
      chatJid: group,
      actorJid: user0,
      isGroup: true,
      text: `oi ${i}`,
      messageType: 'text',
    });
  }
  for (let i = 0; i < 2; i += 1) {
    await mod.onIncomingMessage({
      sock: {},
      chatJid: group,
      actorJid: user1,
      isGroup: true,
      text: `hey ${i}`,
      messageType: 'text',
    });
  }

  const s0 = mod._services.repository.getUserStats(user0, group);
  const s1 = mod._services.repository.getUserStats(user1, group);
  assert.equal(s0.messageCount, 5, 'conta msgs mesmo com cooldown de XP');
  assert.equal(s1.messageCount, 2);

  sent.length = 0;
  await mod.onIncomingMessage({
    sock: {},
    chatJid: group,
    actorJid: user1,
    isGroup: true,
    text: '/topmsg',
    messageType: 'text',
  });

  const body = sent.join('\n');
  assert.match(body, /Top mensagens/i);
  assert.match(body, /Alice/);
  assert.match(body, /\*5\*/);
  // Alice (5) deve aparecer antes de Bob (2)
  assert.ok(body.indexOf('Alice') < body.indexOf('Bob'));
  assert.match(body, /Sua posição/i);
});
