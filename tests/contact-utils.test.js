import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fetchSelectableGroups,
  isLikelyRealGroupJid,
  isLikelyRealSelectableJid,
  isLikelyRealUserJid,
  mergeContactCacheEntry,
  mergeChatsIntoContactCache,
  normalizeInteractionScope,
  shouldProcessByInteractionScope,
} from '../runtime/contactUtils.js';

test('contact-utils filters synthetic JIDs and accepts real WhatsApp-like JIDs', () => {
  assert.equal(isLikelyRealUserJid('5581999999999@s.whatsapp.net'), true);
  assert.equal(isLikelyRealUserJid('parallel-1775697833547@s.whatsapp.net'), false);
  assert.equal(isLikelyRealUserJid('keycheck-success-1775853047712@s.whatsapp.net'), false);

  assert.equal(isLikelyRealGroupJid('120363405600887559@g.us'), true);
  assert.equal(isLikelyRealGroupJid('1234567890-123456@g.us'), true);
  assert.equal(isLikelyRealGroupJid('grupo-teste@g.us'), false);

  assert.equal(isLikelyRealSelectableJid('5581999999999@s.whatsapp.net'), true);
  assert.equal(isLikelyRealSelectableJid('120363405600887559@g.us'), true);
  assert.equal(isLikelyRealSelectableJid('parallel-1775697833547@s.whatsapp.net'), false);
});

test('mergeChatsIntoContactCache hydrates both user and group display names', () => {
  const cache = new Map();
  const groupJid = '120363405600887559@g.us';
  const userJid = '5581999999999@s.whatsapp.net';

  mergeChatsIntoContactCache(cache, [
    { id: groupJid, name: 'Grupo Oficial' },
    { id: userJid, name: 'Eduardo' },
  ]);

  assert.equal(cache.get(groupJid)?.name, 'Grupo Oficial');
  assert.equal(cache.get(userJid)?.name, 'Eduardo');
});

test('mergeChatsIntoContactCache does not degrade group name to JID on partial updates', () => {
  const cache = new Map();
  const groupJid = '120363405600887559@g.us';
  const groupLocalPart = '120363405600887559';

  mergeChatsIntoContactCache(cache, [{ id: groupJid, name: 'Grupo Oficial' }]);
  mergeChatsIntoContactCache(cache, [{ id: groupJid, name: groupJid }]);
  mergeChatsIntoContactCache(cache, [{ id: groupJid, name: groupLocalPart }]);
  mergeChatsIntoContactCache(cache, [{ id: groupJid, subject: '' }]);

  assert.equal(cache.get(groupJid)?.name, 'Grupo Oficial');
});

test('mergeContactCacheEntry does not degrade user display name to JID', () => {
  const cache = new Map();
  const userJid = '5581999999999@s.whatsapp.net';
  const userLocalPart = '5581999999999';

  mergeContactCacheEntry(cache, { id: userJid, name: 'Eduardo' });
  mergeContactCacheEntry(cache, { id: userJid, name: userJid });
  mergeContactCacheEntry(cache, { id: userJid, name: userLocalPart });

  assert.equal(cache.get(userJid)?.name, 'Eduardo');
});

test('fetchSelectableGroups keeps cached group name when socket subject is missing', async () => {
  const cache = new Map();
  const groupJid = '120363405600887559@g.us';
  cache.set(groupJid, { jid: groupJid, name: 'Grupo Persistido' });

  const sock = {
    groupFetchAllParticipating: async () => ({
      [groupJid]: {
        subject: '',
        participants: [{}, {}],
      },
    }),
  };

  const groups = await fetchSelectableGroups(sock, cache);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.name, 'Grupo Persistido');
  assert.equal(cache.get(groupJid)?.name, 'Grupo Persistido');
});

test('fetchSelectableGroups does not replace cached group name with JID-like subject', async () => {
  const cache = new Map();
  const groupJid = '120363405600887559@g.us';
  cache.set(groupJid, { jid: groupJid, name: 'Grupo Persistido' });

  const sock = {
    groupFetchAllParticipating: async () => ({
      [groupJid]: {
        subject: '120363405600887559',
        participants: [{}],
      },
    }),
  };

  const groups = await fetchSelectableGroups(sock, cache);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.name, 'Grupo Persistido');
  assert.equal(cache.get(groupJid)?.name, 'Grupo Persistido');
});

test('conversation mode defaults interaction scope to all-users', () => {
  const flow = { runtimeConfig: { conversationMode: 'conversation' } };
  assert.equal(normalizeInteractionScope(flow), 'all-users');
  assert.equal(shouldProcessByInteractionScope(false, flow), true);
  assert.equal(shouldProcessByInteractionScope(true, flow), false);
});

test('command mode keeps default interaction scope as all', () => {
  const flow = { runtimeConfig: { conversationMode: 'command' } };
  assert.equal(normalizeInteractionScope(flow), 'all');
  assert.equal(shouldProcessByInteractionScope(false, flow), true);
  assert.equal(shouldProcessByInteractionScope(true, flow), true);
});

test('conversation mode maps legacy all scope to direct users only', () => {
  const flow = { runtimeConfig: { conversationMode: 'conversation', interactionScope: 'all' } };
  assert.equal(normalizeInteractionScope(flow), 'all-users');
  assert.equal(shouldProcessByInteractionScope(false, flow), true);
  assert.equal(shouldProcessByInteractionScope(true, flow), false);
});
