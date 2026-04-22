import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isLikelyRealGroupJid,
  isLikelyRealSelectableJid,
  isLikelyRealUserJid,
  mergeChatsIntoContactCache,
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
