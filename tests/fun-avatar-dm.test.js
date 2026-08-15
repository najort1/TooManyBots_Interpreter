import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAvatarCommand } from '../fun/commands/handlers/avatar.js';

test('/avatar no grupo instrui DM e no privado entrega editor', async () => {
  const replies = [];
  await handleAvatarCommand({ isGroup: true, funConfig: { avatarEnabled: true }, reply: async (text) => replies.push(text) });
  assert.match(replies[0], /privado/i);
  await handleAvatarCommand({ isGroup: false, scopeKey: '1@g.us', userJid: '5511@s.whatsapp.net', funConfig: { avatarEnabled: true, dashboardUiPort: 3001 }, avatarService: { get: () => ({ slots: {} }) }, houseLinkService: { generate: async () => ({ token: 'avatar-token' }) }, reply: async (text) => replies.push(text) });
  assert.match(replies[1], /\/casas\/avatar-token\/avatar/);
});
