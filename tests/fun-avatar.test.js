import test from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createFunStatsRepository } from '../fun/db/funStatsRepository.js';
import { createFunAvatarRepository } from '../fun/db/funAvatarRepository.js';
import { createAvatarService } from '../fun/services/avatarService.js';
import { AVATAR_SLOTS, listAvatarItems } from '../fun/shop/avatars.js';
import { getAvatarVisualKey, hasAvatarVisual } from '../fun_dashboard/src/components/casas/avatarAppearance.js';

await initDb();

const unique = (prefix) => prefix + Date.now() + Math.floor(Math.random() * 1e6);

test('avatar: chave visual muda quando qualquer slot equipado muda', () => {
  const base = { slots: { body: 'corpo_beco', hair_face: 'base_face', outfit: 'camiseta_beco', optional_accessory: 'sem_acessorio' } };
  const keys = [
    base,
    { slots: { ...base.slots, body: 'corpo_beca' } },
    { slots: { ...base.slots, hair_face: 'cabelo_cacheado' } },
    { slots: { ...base.slots, outfit: 'uniforme_arcade' } },
    { slots: { ...base.slots, optional_accessory: 'mochila_lateral' } },
  ].map(getAvatarVisualKey);

  assert.equal(new Set(keys).size, keys.length);
});

test('avatar: equipar por nível e comprar premium com ledger', () => {
  const repository = createFunStatsRepository({ getDatabase: getDb });
  const avatarRepository = createFunAvatarRepository({ getDatabase: getDb });
  const service = createAvatarService({ repository, avatarRepository });
  const scope = unique('120363') + '@g.us';
  const user = unique('5513') + '@s.whatsapp.net';

  repository.addCoins({ userJid: user, scopeKey: scope, amount: 1000, reason: 'seed' });
  assert.equal(service.equip({ scopeKey: scope, userJid: user, itemId: 'corpo_beca', funConfig: { avatarEnabled: true } }).ok, true);
  const bought = service.buy({ scopeKey: scope, userJid: user, itemId: 'oculos_pixel', funConfig: { avatarEnabled: true } });

  assert.equal(bought.ok, true);
  assert.equal(service.equip({ scopeKey: scope, userJid: user, itemId: 'oculos_pixel', funConfig: { avatarEnabled: true } }).ok, true);
  assert.equal(service.get({ scopeKey: scope, userJid: user }).legacySlots.body, 'corpo_beca');
  assert.equal(service.get({ scopeKey: scope, userJid: user }).legacySlots.hair_face, 'oculos_pixel');
});

test('avatar: novos itens premium debitam o total exato e persistem em cada slot', () => {
  const repository = createFunStatsRepository({ getDatabase: getDb });
  const avatarRepository = createFunAvatarRepository({ getDatabase: getDb });
  const service = createAvatarService({ repository, avatarRepository });
  const scope = unique('120363') + '@g.us';
  const user = unique('5514') + '@s.whatsapp.net';
  const purchases = [
    { id: 'bone_beco', slot: 'hair_face', cost: 230 },
    { id: 'vestido_aurora', slot: 'outfit', cost: 360 },
    { id: 'fones_neon', slot: 'optional_accessory', cost: 280 },
  ];

  repository.addCoins({ userJid: user, scopeKey: scope, amount: 2000, reason: 'seed' });
  for (const purchase of purchases) {
    const bought = service.buy({ scopeKey: scope, userJid: user, itemId: purchase.id, funConfig: { avatarEnabled: true } });
    assert.equal(bought.ok, true);
    assert.equal(service.equip({ scopeKey: scope, userJid: user, itemId: purchase.id, funConfig: { avatarEnabled: true } }).ok, true);
  }

  const state = service.get({ scopeKey: scope, userJid: user });
  const expectedCoins = 2000 - purchases.reduce((total, item) => total + item.cost, 0);
  const ledgerRows = getDb().prepare(`
    SELECT reason, amount
    FROM analytics.fun_coin_ledger
    WHERE scope_key = ? AND to_jid = ? AND reason LIKE 'avatar-buy:%'
    ORDER BY created_at, reason
  `).all(scope, user);

  assert.equal(state.legacySlots.hair_face, 'bone_beco');
  assert.equal(state.legacySlots.outfit, 'vestido_aurora');
  assert.equal(state.legacySlots.optional_accessory, 'fones_neon');
  assert.equal(repository.getUserStats(user, scope).coins, expectedCoins);
  assert.deepEqual(
    ledgerRows.map((row) => [row.reason, row.amount]).sort(),
    purchases.map((item) => [`avatar-buy:${item.id}`, -item.cost]).sort(),
  );
});
