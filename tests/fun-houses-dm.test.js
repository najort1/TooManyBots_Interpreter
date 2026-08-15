import test from 'node:test';
import assert from 'node:assert/strict';
import { handleHouseCommand } from '../fun/commands/handlers/house.js';

test('/casa no grupo instrui DM e no privado entrega link', async () => {
  const replies = [];
  await handleHouseCommand({ isGroup: true, funConfig: { housesEnabled: true }, reply: async (text) => replies.push(text) });
  assert.match(replies[0], /privado/i);
  await handleHouseCommand({ isGroup: false, scopeKey: '1@g.us', userJid: '5511@s.whatsapp.net', funConfig: { housesEnabled: true, dashboardUiPort: 3001 }, houseService: { provision: () => ({ house: {} }) }, houseLinkService: { generate: async () => ({ token: 'token-seguro' }) }, repository: { getUserStats: () => ({ coins: 120 }) }, reply: async (text) => replies.push(text) });
  assert.match(replies[1], /\/casas\/token-seguro/);
});
