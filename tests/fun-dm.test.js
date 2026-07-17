import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import {
  createFunModule,
  parseFunCommand,
  resolveFunConfig,
  getFunGroupWhitelistSet,
} from '../fun/index.js';
import { _resetDefaultFunStatsRepository } from '../fun/db/funStatsRepository.js';
import { createGroupMembershipService, participantMatches } from '../fun/utils/groupMembership.js';
import { createFunUserPrefsRepository } from '../fun/db/funUserPrefsRepository.js';
import { FUN_COMMANDS } from '../fun/constants.js';
import { resolveFunScope as resolveScope } from '../fun/pipeline/onIncomingMessage.js';

await initDb();
_resetDefaultFunStatsRepository();

function uniqueJid(prefix = '5511') {
  return `${prefix}${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 90 + 10)}@s.whatsapp.net`;
}

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

test('participantMatches e parse /grupo', () => {
  const set = new Set(['5511999999999@s.whatsapp.net', '123@lid']);
  assert.equal(participantMatches(set, '5511999999999@s.whatsapp.net'), true);
  assert.equal(participantMatches(set, '5511888888888@s.whatsapp.net'), false);
  assert.equal(parseFunCommand('/grupo 1', '/').command, FUN_COMMANDS.GROUP_SCOPE);
});

test('resolveFunScope: DM pending quando allowDm', () => {
  const cfg = resolveFunConfig({ allowDm: true, requireGroupWhitelist: true, groupWhitelistJids: ['1@g.us'] });
  const s = resolveScope({
    chatJid: '5511@s.whatsapp.net',
    isGroup: false,
    funConfig: cfg,
    groupWhitelist: getFunGroupWhitelistSet(cfg),
  });
  assert.equal(s.eligible, true);
  assert.equal(s.isDm, true);
  assert.equal(s.reason, 'dm-pending');
});

test('resolveFunScope: DM bloqueado se allowDm false', () => {
  const cfg = resolveFunConfig({ allowDm: false });
  const s = resolveScope({
    chatJid: '5511@s.whatsapp.net',
    isGroup: false,
    funConfig: cfg,
    groupWhitelist: new Set(),
  });
  assert.equal(s.eligible, false);
  assert.equal(s.reason, 'dm-disabled');
});

test('membershipService resolveDmScope: single / preferred / pick', async () => {
  const g1 = uniqueGroup();
  const g2 = uniqueGroup();
  const user = uniqueJid('5519');
  const sock = {
    groupMetadata: async (jid) => {
      if (jid === g1) {
        return { subject: 'Alpha', participants: [{ id: user }, { id: 'other@s.whatsapp.net' }] };
      }
      if (jid === g2) {
        return { subject: 'Beta', participants: [{ id: user }] };
      }
      return { subject: 'X', participants: [] };
    },
  };
  const ms = createGroupMembershipService({ ttlMs: 60_000 });
  const cfg = resolveFunConfig({
    requireGroupWhitelist: true,
    groupWhitelistJids: [g1, g2],
  });

  const both = await ms.resolveDmScope({
    sock,
    userJid: user,
    funConfig: cfg,
  });
  assert.equal(both.ok, false);
  assert.equal(both.reason, 'need-group-pick');
  assert.equal(both.groups.length, 2);

  const pref = await ms.resolveDmScope({
    sock,
    userJid: user,
    funConfig: cfg,
    preferredScopeKey: g2,
  });
  assert.equal(pref.ok, true);
  assert.equal(pref.scopeKey, g2);
  assert.equal(pref.source, 'preferred');

  const aloneUser = uniqueJid('5518');
  const gOnly = uniqueGroup();
  const sock2 = {
    groupMetadata: async (jid) => {
      if (jid === gOnly) return { subject: 'Only', participants: [{ id: aloneUser }] };
      return { subject: 'Empty', participants: [] };
    },
  };
  // serviço novo — evita cache do sock anterior
  const ms2 = createGroupMembershipService({ ttlMs: 60_000 });
  const single = await ms2.resolveDmScope({
    sock: sock2,
    userJid: aloneUser,
    funConfig: resolveFunConfig({
      requireGroupWhitelist: true,
      groupWhitelistJids: [gOnly, uniqueGroup()],
    }),
  });
  assert.equal(single.ok, true);
  assert.equal(single.scopeKey, gOnly);
  assert.equal(single.source, 'single');

  const outsider = uniqueJid('5500');
  const none = await ms.resolveDmScope({
    sock,
    userJid: outsider,
    funConfig: cfg,
  });
  assert.equal(none.ok, false);
  assert.equal(none.reason, 'not-member');
});

test('facade DM: /coins e /bj no privado com membership', async () => {
  const groupJid = uniqueGroup();
  const userA = uniqueJid('5520');
  const sent = [];
  const funConfig = resolveFunConfig({
    enabled: true,
    allowDm: true,
    dmCommandsOnly: true,
    requireGroupWhitelist: true,
    groupWhitelistJids: [groupJid],
    replyCommandsInPrivate: true,
    blackjackMin: 5,
    blackjackMax: 80,
    blackjackCooldownMs: 0,
    jackpotRate: 0,
    ollamaEnabled: false,
    casinoMin: 5,
  });

  const membershipService = {
    resolveDmScope: async () => ({
      ok: true,
      scopeKey: groupJid,
      groups: [{ jid: groupJid, name: 'Test Group' }],
      source: 'preferred',
    }),
    listUserMemberships: async () => [{ jid: groupJid, name: 'Test Group' }],
  };

  const funModule = createFunModule({
    getConfig: () => funConfig,
    getLogger: () => null,
    getDatabase: getDb,
    membershipService,
    sendText: async (_s, jid, text) => {
      sent.push({ jid, text });
    },
    getContactDisplayName: () => 'DMUser',
  });
  funModule.init();
  funModule._services.prefsRepository.setPreferredScope(userA, groupJid);
  funModule._services.repository.addCoins({
    userJid: userA,
    scopeKey: groupJid,
    amount: 100,
    reason: 'seed',
  });

  // /coins no DM
  sent.length = 0;
  await funModule.onIncomingMessage({
    sock: {},
    chatJid: userA,
    actorJid: userA,
    isGroup: false,
    text: '/saldo',
    messageType: 'text',
  });
  assert.ok(sent.some(m => m.jid === userA && /saldo|coins/i.test(m.text)), JSON.stringify(sent));

  // /bj no DM (continuidade)
  sent.length = 0;
  await funModule.onIncomingMessage({
    sock: {},
    chatJid: userA,
    actorJid: userA,
    isGroup: false,
    text: '/bj 10',
    messageType: 'text',
  });
  assert.ok(sent.some(m => /Blackjack|Hit|Stand|Estourou|blackjack/i.test(m.text)), JSON.stringify(sent));

  // panelinha no DM bloqueada
  sent.length = 0;
  await funModule.onIncomingMessage({
    sock: {},
    chatJid: userA,
    actorJid: userA,
    isGroup: false,
    text: '/panelinha rank',
    messageType: 'text',
  });
  assert.ok(sent.some(m => /s[oó] no grupo|grupo/i.test(m.text)), JSON.stringify(sent));
});

test('facade DM: não-membro recebe recusa', async () => {
  const groupJid = uniqueGroup();
  const userA = uniqueJid('5521');
  const sent = [];
  const funConfig = resolveFunConfig({
    enabled: true,
    allowDm: true,
    requireGroupWhitelist: true,
    groupWhitelistJids: [groupJid],
    ollamaEnabled: false,
  });

  const funModule = createFunModule({
    getConfig: () => funConfig,
    getLogger: () => null,
    getDatabase: getDb,
    membershipService: {
      resolveDmScope: async () => ({ ok: false, reason: 'not-member', groups: [] }),
      listUserMemberships: async () => [],
    },
    sendText: async (_s, jid, text) => sent.push({ jid, text }),
  });
  funModule.init();

  await funModule.onIncomingMessage({
    sock: {},
    chatJid: userA,
    actorJid: userA,
    isGroup: false,
    text: '/saldo',
    messageType: 'text',
  });
  assert.ok(sent.some(m => /membro|whitelist|liberado/i.test(m.text)), JSON.stringify(sent));
});

test('facade DM: multi-grupo pede /grupo', async () => {
  const g1 = uniqueGroup();
  const g2 = uniqueGroup();
  const userA = uniqueJid('5522');
  const sent = [];
  const funConfig = resolveFunConfig({
    enabled: true,
    allowDm: true,
    requireGroupWhitelist: true,
    groupWhitelistJids: [g1, g2],
    ollamaEnabled: false,
  });

  const funModule = createFunModule({
    getConfig: () => funConfig,
    getLogger: () => null,
    getDatabase: getDb,
    membershipService: {
      resolveDmScope: async () => ({
        ok: false,
        reason: 'need-group-pick',
        groups: [
          { jid: g1, name: 'G1' },
          { jid: g2, name: 'G2' },
        ],
      }),
      listUserMemberships: async () => [
        { jid: g1, name: 'G1' },
        { jid: g2, name: 'G2' },
      ],
    },
    sendText: async (_s, jid, text) => sent.push({ jid, text }),
  });
  funModule.init();

  await funModule.onIncomingMessage({
    sock: {},
    chatJid: userA,
    actorJid: userA,
    isGroup: false,
    text: '/daily',
    messageType: 'text',
  });
  assert.ok(sent.some(m => /grupo 1|vários|varios/i.test(m.text)), JSON.stringify(sent));
});

test('prefs repository preferred scope', () => {
  const prefs = createFunUserPrefsRepository({ getDatabase: getDb });
  const u = uniqueJid('5523');
  const g = uniqueGroup();
  prefs.setPreferredScope(u, g);
  assert.equal(prefs.get(u).preferredScopeKey, g);
  prefs.touchLastGroup(u, g);
  assert.equal(prefs.get(u).lastGroupJid, g);
});
