import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AVATAR_CATALOG_REVISION,
  AVATAR_DEFAULT_SLOTS,
  AVATAR_OPTIONAL_SLOTS,
  AVATAR_REQUIRED_SLOTS,
  AVATAR_SCHEMA_VERSION,
  AVATAR_SLOTS,
  getAvatarItem,
  getAvatarProduct,
  getAvatarPreviewSlots,
  getAvatarSlotRemovalValue,
  getAvatarVisualKey,
  listAvatarItems,
  listAvatarProducts,
  normalizeAvatarSlots,
  validateAvatarAppearance,
} from '../shared/avatar/domain.js';
import {
  migrateLegacyAvatarState,
  projectV2ToLegacy,
} from '../shared/avatar/legacyMigration.js';
import {
  getAvatarSelectionBlockReason,
  getPendingAvatarPurchaseTotal,
} from '../shared/avatar/studioPurchase.js';

const LEGACY_ITEM_COUNT = 45;

test('avatar v2: domínio expõe doze slots fechados e defaults completos', () => {
  assert.equal(AVATAR_SCHEMA_VERSION, 2);
  assert.equal(AVATAR_CATALOG_REVISION, 1);
  assert.deepEqual(AVATAR_SLOTS, [
    'body', 'skinTone', 'face', 'hair', 'top', 'bottom', 'shoes',
    'headAccessory', 'faceAccessory', 'neckAccessory', 'backAccessory', 'waistAccessory',
  ]);
  assert.deepEqual(AVATAR_REQUIRED_SLOTS, ['body', 'skinTone']);
  assert.deepEqual(AVATAR_OPTIONAL_SLOTS, [
    'face', 'hair', 'top', 'bottom', 'shoes',
    'headAccessory', 'faceAccessory', 'neckAccessory', 'backAccessory', 'waistAccessory',
  ]);
  assert.deepEqual(Object.keys(AVATAR_DEFAULT_SLOTS), AVATAR_SLOTS);
  assert.equal(validateAvatarAppearance(AVATAR_DEFAULT_SLOTS).ok, true);
});

test('avatar v2: catálogo canônico tem renderer, socket, produto e preview em todos os itens', () => {
  const items = listAvatarItems();
  const products = listAvatarProducts();
  const ids = items.map((item) => item.id);
  const productIds = products.map((product) => product.id);

  assert.equal(products.filter((product) => product.legacySlot).length, LEGACY_ITEM_COUNT);
  assert.equal(new Set(ids).size, items.length);
  assert.equal(new Set(productIds).size, products.length);
  assert.ok(items.length > LEGACY_ITEM_COUNT, 'a nova taxonomia deve separar roupas e acessórios agregados');
  assert.ok(items.every((item) => AVATAR_SLOTS.includes(item.slot)));
  assert.ok(items.every((item) => item.rendererKey && item.socket && item.preview));
  assert.ok(items.every((item) => getAvatarProduct(item.sourceProductId)));
  assert.ok(AVATAR_SLOTS.every((slot) => items.some((item) => item.slot === slot)));
  assert.ok(getAvatarItem('bottom_aurora'));
  assert.ok(getAvatarItem('shoes_arcade'));
  assert.equal(getAvatarItem('oculos_pixel').slot, 'faceAccessory');
  assert.equal(getAvatarItem('asas_pixel').slot, 'backAccessory');
});

test('avatar v2: previews respeitam o slot modular da peça', () => {
  const oversized = getAvatarPreviewSlots({
    id: 'camiseta_oversized',
    slot: 'top',
    sourceProductId: 'camiseta_oversized',
  });
  const oversizedBottom = getAvatarPreviewSlots({
    id: 'bottom_oversized',
    slot: 'bottom',
    sourceProductId: 'camiseta_oversized',
  });
  const poloShoes = getAvatarPreviewSlots({
    id: 'shoes_polo',
    slot: 'shoes',
    sourceProductId: 'polo_beco',
  });

  assert.deepEqual(
    { top: oversized.top, bottom: oversized.bottom, shoes: oversized.shoes },
    { top: 'camiseta_oversized', bottom: 'bottom_oversized', shoes: 'shoes_oversized' },
  );
  assert.deepEqual(
    { top: oversizedBottom.top, bottom: oversizedBottom.bottom, shoes: oversizedBottom.shoes },
    { top: 'camiseta_beco', bottom: 'bottom_oversized', shoes: 'shoes_beco' },
  );
  assert.deepEqual(
    { top: poloShoes.top, bottom: poloShoes.bottom, shoes: poloShoes.shoes },
    { top: 'camiseta_beco', bottom: 'bottom_beco', shoes: 'shoes_polo' },
  );
  assert.equal(getAvatarItem('bottom_oversized').name, 'Calça oversized');
  assert.equal(getAvatarItem('shoes_polo').name, 'Mocassim do Beco');
});

test('avatar v2: normalização rejeita chaves extras, item no slot errado e ausência obrigatória', () => {
  const extra = validateAvatarAppearance({ ...AVATAR_DEFAULT_SLOTS, debug: 'on' });
  const mismatch = validateAvatarAppearance({ ...AVATAR_DEFAULT_SLOTS, hair: 'oculos_pixel' });
  const missing = { ...AVATAR_DEFAULT_SLOTS };
  delete missing.top;

  assert.equal(extra.ok, false);
  assert.ok(extra.errors.some((error) => error.code === 'unknown-slot'));
  assert.equal(mismatch.ok, false);
  assert.ok(mismatch.errors.some((error) => error.code === 'slot-mismatch'));
  assert.equal(validateAvatarAppearance(missing).ok, false);
  assert.deepEqual(normalizeAvatarSlots({ debug: 'x', body: 'unknown' }), AVATAR_DEFAULT_SLOTS);
});

test('avatar v2: toda peça cosmética pode ser removida e o visual pelado é válido', () => {
  const nudeSlots = {
    ...AVATAR_DEFAULT_SLOTS,
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

  assert.equal(validateAvatarAppearance(nudeSlots).ok, true);
  assert.deepEqual(normalizeAvatarSlots(nudeSlots), nudeSlots);
  AVATAR_OPTIONAL_SLOTS.forEach((slot) => assert.equal(getAvatarSlotRemovalValue(slot), 'none', slot));
  assert.equal(getAvatarSlotRemovalValue('body'), null);
  assert.equal(getAvatarSlotRemovalValue('skinTone'), null);
  assert.equal(getAvatarSlotRemovalValue('unknown'), null);
});

test('avatar v2: migrar sem acessório legado não remove roupas', () => {
  const migrated = migrateLegacyAvatarState({
    slots: {
      body: 'corpo_beco',
      hair_face: 'base_face',
      outfit: 'jaqueta_neon',
      optional_accessory: 'sem_acessorio',
    },
  });

  assert.deepEqual(
    { top: migrated.slots.top, bottom: migrated.slots.bottom, shoes: migrated.slots.shoes },
    { top: 'jaqueta_neon', bottom: 'bottom_neon', shoes: 'shoes_neon' },
  );
});

test('avatar v2: migração cobre todos os produtos legados, preserva unlocks e é idempotente', () => {
  const products = listAvatarProducts();

  for (const product of products) {
    const legacySlots = {
      body: 'corpo_beco',
      hair_face: 'base_face',
      outfit: 'camiseta_beco',
      optional_accessory: 'sem_acessorio',
      [product.legacySlot]: product.id,
    };
    const first = migrateLegacyAvatarState({ slots: legacySlots, unlocked: [product.id] });
    const second = migrateLegacyAvatarState(first);

    assert.equal(first.schemaVersion, AVATAR_SCHEMA_VERSION, product.id);
    assert.equal(first.unlocked.includes(product.id), true, product.id);
    assert.deepEqual(second, first, product.id);
    assert.equal(validateAvatarAppearance(first.slots).ok, true, product.id);
  }
});

test('avatar v2: outfit legado vira top, bottom e shoes do mesmo produto', () => {
  const migrated = migrateLegacyAvatarState({
    slots: {
      body: 'corpo_beca',
      hair_face: 'oculos_pixel',
      outfit: 'uniforme_arcade',
      optional_accessory: 'mochila_lateral',
    },
    unlocked: ['oculos_pixel', 'uniforme_arcade', 'mochila_lateral'],
  });

  assert.deepEqual(
    {
      body: migrated.slots.body,
      faceAccessory: migrated.slots.faceAccessory,
      top: migrated.slots.top,
      bottom: migrated.slots.bottom,
      shoes: migrated.slots.shoes,
      backAccessory: migrated.slots.backAccessory,
    },
    {
      body: 'corpo_beca',
      faceAccessory: 'oculos_pixel',
      top: 'uniforme_arcade',
      bottom: 'bottom_arcade',
      shoes: 'shoes_arcade',
      backAccessory: 'mochila_lateral',
    },
  );
  assert.deepEqual(projectV2ToLegacy(migrated.slots), {
    body: 'corpo_beca',
    hair_face: 'oculos_pixel',
    outfit: 'uniforme_arcade',
    optional_accessory: 'mochila_lateral',
  });
});

test('avatar v2: migração trata JSON desconhecido sem crash e considera equipados como possuídos', () => {
  const migrated = migrateLegacyAvatarState({
    slots: { body: 'desconhecido', hair_face: 'cabelo_rosa', outfit: 'vestido_aurora', optional_accessory: 'asas_pixel' },
    unlocked: ['item_inexistente'],
  });

  assert.equal(migrated.slots.body, AVATAR_DEFAULT_SLOTS.body);
  assert.ok(migrated.unlocked.includes('cabelo_rosa'));
  assert.ok(migrated.unlocked.includes('vestido_aurora'));
  assert.ok(migrated.unlocked.includes('asas_pixel'));
  assert.ok(migrated.diagnostics.some((entry) => entry.code === 'unknown-legacy-item'));
});

test('avatar v2: chave visual é canônica e muda com qualquer slot', () => {
  const keys = AVATAR_SLOTS.map((slot) => {
    const alternative = listAvatarItems().find((item) => item.slot === slot && item.id !== AVATAR_DEFAULT_SLOTS[slot]);
    assert.ok(alternative, slot);
    return getAvatarVisualKey({ slots: { ...AVATAR_DEFAULT_SLOTS, [slot]: alternative.id } });
  });

  assert.equal(new Set(keys).size, keys.length);
  assert.equal(getAvatarVisualKey({ slots: AVATAR_DEFAULT_SLOTS }), getAvatarVisualKey({ slots: { ...AVATAR_DEFAULT_SLOTS } }));
});

test('avatar v2: estúdio não deixa selecionar peça bloqueada ou acima do saldo do visual', () => {
  const catalog = [
    { id: 'top_base', slot: 'top', sourceProductId: 'base', cost: 0, owned: true },
    { id: 'bottom_base', slot: 'bottom', sourceProductId: 'base', cost: 0, owned: true },
    { id: 'top_premium', slot: 'top', sourceProductId: 'look_premium', cost: 180, owned: false },
    { id: 'bottom_premium', slot: 'bottom', sourceProductId: 'look_premium', cost: 180, owned: false },
    { id: 'back_premium', slot: 'backAccessory', sourceProductId: 'back_premium', cost: 120, owned: false },
    { id: 'hair_level', slot: 'hair', sourceProductId: 'hair_level', cost: 0, owned: false },
  ];
  const slots = { top: 'top_base', bottom: 'bottom_base', backAccessory: 'none', hair: 'none' };
  const avatar = { coins: 200, catalog };

  assert.equal(getAvatarSelectionBlockReason(catalog[2], slots, avatar), null);
  assert.equal(getPendingAvatarPurchaseTotal({ ...slots, top: 'top_premium', bottom: 'bottom_premium' }, catalog), 180);
  assert.equal(getAvatarSelectionBlockReason(catalog[4], { ...slots, top: 'top_premium' }, avatar), 'coins');
  assert.equal(getAvatarSelectionBlockReason(catalog[5], slots, avatar), 'level');
});
