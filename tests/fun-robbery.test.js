import test from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createFunStatsRepository } from '../fun/db/funStatsRepository.js';
import { createFunHouseRepository } from '../fun/db/funHouseRepository.js';
import { createRobberyService } from '../fun/services/robberyService.js';
await initDb(); const unique = (prefix) => prefix + Date.now() + Math.floor(Math.random() * 1e6);
test('robbery: chance injetada transfere decorativo e aplica wanted sem kick', () => { const repository = createFunStatsRepository({ getDatabase: getDb }); const houseRepository = createFunHouseRepository({ getDatabase: getDb }); const calls = []; const service = createRobberyService({ repository, houseRepository, policeService: { afterCrime: (input) => { calls.push(input); return { wantedGain: 2 }; } }, random: () => 0 }); const scope = unique('120363') + '@g.us'; const owner = unique('5518') + '@s.whatsapp.net'; const robber = unique('5519') + '@s.whatsapp.net'; houseRepository.ensureHouse({ scopeKey: scope, userJid: owner, now: 14_000 }); const item = houseRepository.insertItem({ scopeKey: scope, ownerJid: owner, itemId: 'tapete_rua', now: 14_000 }); const result = service.rob({ scopeKey: scope, robberJid: robber, ownerJid: owner, funConfig: { robberyEnabled: true, assaultBaseChance: 1, houseRobberyCooldownMs: 1, houseRobberyDailyMax: 2 }, now: 15_000 }); assert.equal(result.result, 'success'); assert.equal(houseRepository.getItem(item.id)?.ownerJid, robber); assert.equal(calls[0].success, true); });
