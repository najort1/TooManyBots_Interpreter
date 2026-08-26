import test from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createFunStatsRepository } from '../fun/db/funStatsRepository.js';
import { createFunAvatarRepository } from '../fun/db/funAvatarRepository.js';
import { createFunAvatarV2Repository } from '../fun/db/funAvatarV2Repository.js';
import { createAvatarService } from '../fun/services/avatarService.js';
import { AVATAR_DEFAULT_SLOTS, AVATAR_CATALOG_REVISION } from '../shared/avatar/domain.js';

await initDb();
const unique = (prefix) => prefix + Date.now() + Math.floor(Math.random() * 1e6);

function setup() {
  const repository = createFunStatsRepository({ getDatabase: getDb });
  const avatarRepository = createFunAvatarRepository({ getDatabase: getDb });
  const avatarV2Repository = createFunAvatarV2Repository({ getDatabase: getDb });
  const service = createAvatarService({ repository, avatarRepository, avatarV2Repository, getDatabase: getDb });
  const scopeKey = unique('scope-');
  const userJid = unique('user-');
  return { repository, avatarRepository, avatarV2Repository, service, scopeKey, userJid };
}

test('avatar v2 service: leitura migra legado uma vez e mantém projeção reversível', () => {
  const { avatarRepository, avatarV2Repository, service, scopeKey, userJid } = setup();
  avatarRepository.save(scopeKey, userJid, {
    slots: { body: 'corpo_beca', hair_face: 'oculos_pixel', outfit: 'uniforme_arcade', optional_accessory: 'asas_pixel' },
    unlocked: ['oculos_pixel', 'uniforme_arcade', 'asas_pixel'],
  });

  const first = service.get({ scopeKey, userJid });
  const second = service.get({ scopeKey, userJid });

  assert.equal(first.schemaVersion, 2);
  assert.equal(first.revision, 1);
  assert.equal(first.slots.faceAccessory, 'oculos_pixel');
  assert.equal(first.slots.bottom, 'bottom_arcade');
  assert.equal(first.slots.backAccessory, 'asas_pixel');
  assert.deepEqual(second.slots, first.slots);
  assert.deepEqual(avatarV2Repository.get(scopeKey, userJid).slots, first.slots);
});

test('avatar v2 service: aplicar look owned é atômico, incrementa revisão e dual-write legado', () => {
  const { avatarRepository, service, scopeKey, userJid } = setup();
  const current = service.get({ scopeKey, userJid });
  const result = service.apply({
    scopeKey,
    userJid,
    slots: { ...current.slots, face: 'face_sorriso', bottom: 'bottom_plissada' },
    expectedRevision: current.revision,
    catalogRevision: AVATAR_CATALOG_REVISION,
    idempotencyKey: 'apply-owned',
    funConfig: { avatarEnabled: true },
  });

  assert.equal(result.ok, true);
  assert.equal(result.state.revision, current.revision + 1);
  assert.equal(result.state.slots.face, 'face_sorriso');
  assert.equal(result.state.slots.bottom, 'bottom_plissada');
  assert.equal(avatarRepository.get(scopeKey, userJid).slots.outfit, 'saia_plissada');
});

test('avatar v2 service: visual pelado é salvo sem compra e preserva a estrutura', () => {
  const { service, scopeKey, userJid } = setup();
  const current = service.get({ scopeKey, userJid });
  const nudeSlots = {
    ...current.slots,
    face: 'none',
    hair: 'none',
    top: 'none',
    bottom: 'none',
    shoes: 'none',
    headAccessory: 'none',
    faceAccessory: 'none',
    neckAccessory: 'none',
    backAccessory: 'none',
    waistAccessory: 'none',
  };

  const result = service.apply({
    scopeKey,
    userJid,
    slots: nudeSlots,
    expectedRevision: current.revision,
    catalogRevision: AVATAR_CATALOG_REVISION,
    idempotencyKey: 'nude-look',
    funConfig: { avatarEnabled: true },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.purchased, []);
  assert.equal(result.state.slots.body, current.slots.body);
  assert.equal(result.state.slots.skinTone, current.slots.skinTone);
  for (const slot of ['face', 'hair', 'top', 'bottom', 'shoes', 'headAccessory', 'faceAccessory', 'neckAccessory', 'backAccessory', 'waistAccessory']) {
    assert.equal(result.state.slots[slot], 'none', slot);
  }
});

test('avatar v2 service: premium exige quote e confirmação; débito, unlock e save são idempotentes', () => {
  const { repository, service, scopeKey, userJid } = setup();
  repository.addCoins({ userJid, scopeKey, amount: 1000, reason: 'seed' });
  const current = service.get({ scopeKey, userJid });
  const slots = { ...current.slots, faceAccessory: 'oculos_pixel', backAccessory: 'asas_pixel' };
  const request = {
    scopeKey,
    userJid,
    slots,
    expectedRevision: current.revision,
    catalogRevision: AVATAR_CATALOG_REVISION,
    idempotencyKey: 'premium-look',
    funConfig: { avatarEnabled: true },
  };

  const quote = service.apply(request);
  assert.equal(quote.ok, false);
  assert.equal(quote.reason, 'purchase-confirmation-required');
  assert.deepEqual(quote.quote.itemIds.sort(), ['asas_pixel', 'oculos_pixel']);
  assert.equal(quote.quote.total, 830);
  assert.equal(repository.getUserStats(userJid, scopeKey).coins, 1000);

  const confirmed = service.apply({ ...request, confirmedPurchase: quote.quote });
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.coins, 170);
  assert.ok(confirmed.state.unlocked.includes('oculos_pixel'));
  assert.ok(confirmed.state.unlocked.includes('asas_pixel'));

  const replay = service.apply({ ...request, confirmedPurchase: quote.quote });
  assert.equal(replay.ok, true);
  assert.equal(replay.replayed, true);
  assert.equal(repository.getUserStats(userJid, scopeKey).coins, 170);
});

test('avatar v2 service: saldo insuficiente, conflito e aparência inválida não alteram estado', () => {
  const { repository, service, scopeKey, userJid } = setup();
  repository.addCoins({ userJid, scopeKey, amount: 100, reason: 'seed' });
  const current = service.get({ scopeKey, userJid });
  const premiumSlots = { ...current.slots, backAccessory: 'asas_pixel' };
  const quote = service.apply({
    scopeKey, userJid, slots: premiumSlots, expectedRevision: current.revision,
    catalogRevision: AVATAR_CATALOG_REVISION, idempotencyKey: 'no-coins', funConfig: { avatarEnabled: true },
  }).quote;
  const noCoins = service.apply({
    scopeKey, userJid, slots: premiumSlots, expectedRevision: current.revision,
    catalogRevision: AVATAR_CATALOG_REVISION, idempotencyKey: 'no-coins', confirmedPurchase: quote,
    funConfig: { avatarEnabled: true },
  });
  assert.equal(noCoins.reason, 'insufficient-coins');
  assert.deepEqual(service.get({ scopeKey, userJid }).slots, current.slots);

  const conflict = service.apply({
    scopeKey, userJid, slots: current.slots, expectedRevision: 999,
    catalogRevision: AVATAR_CATALOG_REVISION, idempotencyKey: 'conflict', funConfig: { avatarEnabled: true },
  });
  assert.equal(conflict.reason, 'appearance-revision-conflict');

  const invalid = service.apply({
    scopeKey, userJid, slots: { ...AVATAR_DEFAULT_SLOTS, debug: 'x' }, expectedRevision: current.revision,
    catalogRevision: AVATAR_CATALOG_REVISION, idempotencyKey: 'invalid', funConfig: { avatarEnabled: true },
  });
  assert.equal(invalid.reason, 'invalid-appearance');
});
