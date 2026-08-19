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
  const moved = houseService.move({ scopeKey: scope, userJid: user, itemInstanceId: placed.item.id, x: 3, y: 2, rotation: 3, now: 3_000 });
  assert.equal(moved.item.x, 3);
  assert.equal(moved.item.rotation, 3);
  assert.equal(moved.item.rotated, true);
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

test('houses: impede sobreposição sem cobrar coins nem mover o item', () => {
  const { repository, houseService } = setup();
  const scope = unique('120364') + '@g.us';
  const user = unique('5514') + '@s.whatsapp.net';
  const cfg = { housesEnabled: true, houseMaxItems: 24 };
  repository.addCoins({ userJid: user, scopeKey: scope, amount: 1000, reason: 'seed' });
  const provision = houseService.provision({ scopeKey: scope, userJid: user, now: 10_000 });
  const sofa = provision.items.find((item) => item.itemId === 'sofa_inicial');
  const plant = provision.items.find((item) => item.itemId === 'planta_inicial');
  const balanceBefore = repository.getUserStats(user, scope).coins;

  const blockedPlace = houseService.place({ scopeKey: scope, userJid: user, itemId: 'tapete_rua', x: sofa.x, y: sofa.y, funConfig: cfg, now: 11_000 });
  assert.deepEqual(blockedPlace, { ok: false, reason: 'occupied-position' });
  assert.equal(repository.getUserStats(user, scope).coins, balanceBefore);

  const blockedMove = houseService.move({ scopeKey: scope, userJid: user, itemInstanceId: plant.id, x: sofa.x, y: sofa.y, now: 12_000 });
  assert.deepEqual(blockedMove, { ok: false, reason: 'occupied-position' });
  const unchangedPlant = houseService.getHouse({ scopeKey: scope, userJid: user, now: 13_000 }).items.find((item) => item.id === plant.id);
  assert.deepEqual({ x: unchangedPlant.x, y: unchangedPlant.y }, { x: plant.x, y: plant.y });
});

test('houses: catálogo oferece móveis e acabamentos persistentes sem ocupar o grid', () => {
  const { repository, houseService } = setup();
  const scope = unique('120365') + '@g.us';
  const user = unique('5515') + '@s.whatsapp.net';
  const cfg = { housesEnabled: true, houseMaxItems: 2 };
  repository.addCoins({ userJid: user, scopeKey: scope, amount: 1000, reason: 'seed' });

  const catalog = houseService.listShop({ scopeKey: scope, userJid: user, now: 20_000 });
  assert.deepEqual(new Set(catalog.map((item) => item.kind)), new Set(['furniture', 'wallpaper', 'floor', 'window']));
  assert.equal(catalog.find((item) => item.id === 'parede_beco').applied, true);
  assert.equal(catalog.find((item) => item.id === 'parede_tijolo').owned, false);

  const before = repository.getUserStats(user, scope).coins;
  const applied = houseService.applyStyle({ scopeKey: scope, userJid: user, itemId: 'parede_tijolo', funConfig: cfg, now: 21_000 });
  assert.equal(applied.ok, true);
  assert.equal(applied.purchased, true);
  assert.equal(applied.house.wallStyle, 'parede_tijolo');
  assert.equal(repository.getUserStats(user, scope).coins, before - 190);

  const reapplied = houseService.applyStyle({ scopeKey: scope, userJid: user, itemId: 'parede_tijolo', funConfig: cfg, now: 22_000 });
  assert.equal(reapplied.ok, true);
  assert.equal(reapplied.purchased, false);
  assert.equal(repository.getUserStats(user, scope).coins, before - 190);

  const freeFloor = houseService.applyStyle({ scopeKey: scope, userJid: user, itemId: 'piso_madeira', funConfig: cfg, now: 23_000 });
  assert.equal(freeFloor.ok, true);
  assert.equal(freeFloor.house.floorStyle, 'piso_madeira');
  assert.equal(repository.getUserStats(user, scope).coins, before - 190);

  const current = houseService.getHouse({ scopeKey: scope, userJid: user, now: 24_000 });
  const styleInventory = current.items.find((item) => item.itemId === 'parede_tijolo');
  assert.equal(styleInventory.placed, false);
  assert.equal(houseService.place({ scopeKey: scope, userJid: user, itemId: 'tapete_rua', x: 2, y: 2, funConfig: cfg, now: 25_000 }).reason, 'item-cap');
  assert.equal(houseService.place({ scopeKey: scope, userJid: user, itemId: 'parede_noite_neon', x: 2, y: 2, funConfig: cfg, now: 26_000 }).reason, 'style-use-apply');
});
