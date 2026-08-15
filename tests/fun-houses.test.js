import test from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createFunStatsRepository } from '../fun/db/funStatsRepository.js';
import { createFunHouseRepository } from '../fun/db/funHouseRepository.js';
import { createHouseService } from '../fun/services/houseService.js';
import { createHouseLinkService } from '../fun/services/houseLinkService.js';

await initDb();
const unique = (prefix) => prefix + Date.now() + Math.floor(Math.random() * 1e6);
function setup() { const repository = createFunStatsRepository({ getDatabase: getDb }); repository.ensureFunSchema(); const houseRepository = createFunHouseRepository({ getDatabase: getDb }); return { repository, houseRepository, houseService: createHouseService({ repository, houseRepository }), houseLinkService: createHouseLinkService({ houseRepository }) }; }

test('houses: provision, comprar, mover, vender e coletar sem saldo negativo', () => {
  const { repository, houseService } = setup(); const scope = unique('120363') + '@g.us'; const user = unique('5511') + '@s.whatsapp.net'; const cfg = { housesEnabled: true, houseMaxItems: 24, houseDailyCollectMax: 1 };
  repository.addCoins({ userJid: user, scopeKey: scope, amount: 1000, reason: 'seed' });
  const provision = houseService.provision({ scopeKey: scope, userJid: user, now: 1_000 });
  assert.equal(provision.items.length, 2);
  const placed = houseService.place({ scopeKey: scope, userJid: user, itemId: 'tapete_rua', x: 2, y: 2, funConfig: cfg, now: 2_000 });
  assert.equal(placed.ok, true);
  const moved = houseService.move({ scopeKey: scope, userJid: user, itemInstanceId: placed.item.id, x: 3, y: 2, now: 3_000 });
  assert.equal(moved.item.x, 3);
  const sold = houseService.sell({ scopeKey: scope, userJid: user, itemInstanceId: placed.item.id, now: 4_000 });
  assert.equal(sold.ok, true);
  const collect = houseService.collect({ scopeKey: scope, userJid: user, funConfig: cfg, now: 5_000 });
  assert.equal(collect.ok, true);
  assert.equal(houseService.collect({ scopeKey: scope, userJid: user, funConfig: cfg, now: 6_000 }).reason, 'cooldown');
  assert.ok((repository.getUserStats(user, scope)?.coins || 0) >= 0);
});

test('houses: token usa hash scrypt e revogação invalida o link', async () => {
  const { houseLinkService } = setup(); const scope = unique('120363') + '@g.us'; const user = unique('5512') + '@s.whatsapp.net';
  const link = await houseLinkService.generate({ scopeKey: scope, userJid: user, now: 7_000 });
  const resolved = await houseLinkService.resolve(link.token);
  assert.deepEqual({ scopeKey: resolved.scopeKey, userJid: resolved.userJid }, { scopeKey: scope, userJid: user });
  assert.equal(houseLinkService.revoke({ scopeKey: scope, userJid: user, now: 8_000 }), 1);
  assert.equal(await houseLinkService.resolve(link.token), null);
});

test('houses: identifica vizinhos com id público opaco no mesmo grupo', () => {
  const { houseRepository } = setup();
  const scope = unique('120363') + '@g.us';
  const owner = unique('5513') + '@s.whatsapp.net';
  const house = houseRepository.ensureHouse({ scopeKey: scope, userJid: owner, now: 9_000 });
  assert.match(house.publicId, /^[0-9a-f-]{36}$/i);
  assert.equal(houseRepository.getHouseByPublicId(scope, house.publicId)?.userJid, owner);
  assert.equal(houseRepository.getHouseByPublicId(unique('120363') + '@g.us', house.publicId), null);
});
