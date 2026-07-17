/**
 * Respostas do Fun citam a mensagem original (Baileys quoted).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { createFunModule } from '../fun/index.js';
import { resolveFunConfig } from '../fun/config.js';
import {
  _resetDefaultFunStatsRepository,
} from '../fun/db/funStatsRepository.js';

await initDb();
_resetDefaultFunStatsRepository();

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

function uniqueJid(prefix = '5511') {
  return `${prefix}${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 90 + 10)}@s.whatsapp.net`;
}

test('reply passa quoted da rawMessage ao sendText', async () => {
  const scope = uniqueGroup();
  const user = uniqueJid();
  const rawMessage = {
    key: {
      remoteJid: scope,
      fromMe: false,
      id: 'ABC123QUOTE',
      participant: user,
    },
    message: { conversation: '/saldo' },
    pushName: 'Tester',
  };

  const sends = [];
  const mod = createFunModule({
    getConfig: () =>
      resolveFunConfig({
        enabled: true,
        groupWhitelistJids: [scope],
        requireGroupWhitelist: true,
        mentionUsers: true,
        replyQuoted: true,
      }),
    sendText: async (sock, jid, text, options) => {
      sends.push({ jid, text: String(text), options: options || {} });
      return { skipped: false };
    },
  });
  mod.init();

  await mod.onIncomingMessage({
    sock: {},
    chatJid: scope,
    actorJid: user,
    isGroup: true,
    text: '/saldo',
    messageType: 'conversation',
    rawMessage,
  });

  assert.ok(sends.length >= 1, 'deve responder');
  const withQuote = sends.find((s) => s.options?.quoted);
  assert.ok(withQuote, 'pelo menos um send com quoted');
  assert.equal(withQuote.options.quoted.key.id, 'ABC123QUOTE');
});

test('replyQuoted=false não envia quoted', async () => {
  const scope = uniqueGroup();
  const user = uniqueJid();
  const rawMessage = {
    key: {
      remoteJid: scope,
      fromMe: false,
      id: 'NOQUOTE1',
      participant: user,
    },
    message: { conversation: '/saldo' },
  };

  const sends = [];
  const mod = createFunModule({
    getConfig: () =>
      resolveFunConfig({
        enabled: true,
        groupWhitelistJids: [scope],
        requireGroupWhitelist: true,
        replyQuoted: false,
      }),
    sendText: async (sock, jid, text, options) => {
      sends.push({ options: options || {} });
      return { skipped: false };
    },
  });
  mod.init();

  await mod.onIncomingMessage({
    sock: {},
    chatJid: scope,
    actorJid: user,
    isGroup: true,
    text: '/saldo',
    messageType: 'conversation',
    rawMessage,
  });

  assert.ok(sends.length >= 1);
  assert.ok(sends.every((s) => !s.options.quoted));
});
