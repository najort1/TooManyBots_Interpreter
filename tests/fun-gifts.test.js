import test from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createFunStatsRepository } from '../fun/db/funStatsRepository.js';
import { createFunHouseRepository } from '../fun/db/funHouseRepository.js';
import { createGiftService } from '../fun/services/giftService.js';
await initDb(); const unique = (prefix) => prefix + Date.now() + Math.floor(Math.random() * 1e6);
test('gifts: transfere coins e item roubado mantém posse plena', () => { const repository = createFunStatsRepository({ getDatabase: getDb }); const houseRepository = createFunHouseRepository({ getDatabase: getDb }); const service = createGiftService({ repository, houseRepository }); const scope = unique('120363') + '@g.us'; const giver = unique('5516') + '@s.whatsapp.net'; const receiver = unique('5517') + '@s.whatsapp.net'; repository.addCoins({ userJid: giver, scopeKey: scope, amount: 500, reason: 'seed' }); const item = houseRepository.insertItem({ scopeKey: scope, ownerJid: giver, itemId: 'tapete_rua', stolen: true, now: 12_000 }); const gift = service.give({ scopeKey: scope, giverJid: giver, recipientJid: receiver, itemInstanceId: item.id, coins: 50, funConfig: { giftsEnabled: true, houseGiftDailyMax: 3 }, now: 13_000 }); assert.equal(gift.ok, true); assert.equal(houseRepository.getItem(item.id)?.ownerJid, receiver); assert.equal(houseRepository.getItem(item.id)?.stolen, true); });
