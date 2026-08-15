import test from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createFunHouseRepository } from '../fun/db/funHouseRepository.js';
import { createVisitService } from '../fun/services/visitService.js';
await initDb(); const unique = (prefix) => prefix + Date.now() + Math.floor(Math.random() * 1e6);
test('visits: limita por dia e sanitiza recado', () => { const repo = createFunHouseRepository({ getDatabase: getDb }); const service = createVisitService({ houseRepository: repo }); const scope = unique('120363') + '@g.us'; const owner = unique('5514') + '@s.whatsapp.net'; const visitor = unique('5515') + '@s.whatsapp.net'; const result = service.visit({ scopeKey: scope, ownerJid: owner, visitorJid: visitor, note: 'oi\nhttps://spam.test', funConfig: { visitsEnabled: true, houseVisitDailyMax: 1 }, now: 10_000 }); assert.equal(result.ok, true); assert.equal(result.visit.note.includes('http'), false); assert.equal(service.visit({ scopeKey: scope, ownerJid: owner, visitorJid: visitor, funConfig: { visitsEnabled: true, houseVisitDailyMax: 1 }, now: 11_000 }).reason, 'daily-cap'); });
