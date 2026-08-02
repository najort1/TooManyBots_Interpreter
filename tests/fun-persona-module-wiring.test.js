import test from 'node:test';
import assert from 'node:assert/strict';

process.env.FUN_DISABLE_LIVE_LLM = '1';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createFunModule } from '../fun/index.js';
import { DEFAULT_FUN_CONFIG } from '../fun/constants.js';

await initDb();

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

function uniqueJid(prefix = '5511') {
  return `${prefix}${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 90 + 10)}@s.whatsapp.net`;
}

test('REGRESSAO persona: propaga menção e reply extended-text para tryRespond', async () => {
  const botJid = uniqueJid('5599');
  const mentionedJids = [botJid];
  const quotedParticipant = botJid;
  const sock = {
    user: { id: `${botJid.split('@')[0]}:0` },
    sendMessage: async () => ({ ok: true }),
  };

  const calls = [];
  let resolveTryRespond;
  const tryRespondCalled = new Promise((resolve) => { resolveTryRespond = resolve; });
  const personaService = {
    observeMessage: () => ({ observed: true }),
    tryRespond: async (ctx) => {
      calls.push(ctx);
      resolveTryRespond();
      return { responded: true };
    },
  };

  const chatJid = uniqueGroup();
  const mod = createFunModule({
    getDatabase: () => getDb(),
    getConfig: () => ({
      ...DEFAULT_FUN_CONFIG,
      enabled: true,
      worldQuietHoursEnabled: false,
      personaEnabled: true,
      groupWhitelistJids: [chatJid],
    }),
    personaService,
    getSock: () => sock,
    sendText: async (sockArg, jid, text) => sock.sendMessage(jid, { text }),
    getLogger: () => null,
  });
  await mod.onIncomingMessage({
    sock,
    chatJid,
    actorJid: uniqueJid(),
    isGroup: true,
    text: 'me responde',
    messageType: 'extended-text',
    mentionedJids,
    quotedParticipant,
    rawMessage: null,
  });
  await tryRespondCalled;

  assert.equal(calls.length, 1, 'o módulo deve chamar personaService.tryRespond');
  assert.equal(calls[0].scopeKey, chatJid);
  assert.equal(calls[0].messageType, 'extended-text');
  assert.deepEqual(calls[0].mentionedJids, mentionedJids);
  assert.equal(calls[0].quotedParticipant, quotedParticipant);
});
