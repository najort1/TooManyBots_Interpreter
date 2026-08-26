import {
  AVATAR_CATALOG_REVISION,
  AVATAR_DEFAULT_SLOTS,
  AVATAR_SCHEMA_VERSION,
  AVATAR_SLOTS,
  getAvatarItem,
  getAvatarProduct,
  getProductIdsForSlots,
  normalizeAvatarSlots,
} from './domain.js';

const LEGACY_DEFAULTS = Object.freeze({
  body: 'corpo_beco',
  hair_face: 'base_face',
  outfit: 'camiseta_beco',
  optional_accessory: 'sem_acessorio',
});

export function migrateLegacyAvatarState(state = {}) {
  if (Number(state.schemaVersion) === AVATAR_SCHEMA_VERSION) {
    return normalizeV2State(state);
  }

  const legacySlots = readLegacySlots(state.slots);
  const diagnostics = [];
  const slots = { ...AVATAR_DEFAULT_SLOTS };
  const selectedProductIds = [];

  for (const legacySlot of Object.keys(LEGACY_DEFAULTS)) {
    const productId = legacySlots[legacySlot];
    const product = getAvatarProduct(productId);
    if (!product || product.legacySlot !== legacySlot) {
      diagnostics.push({ code: 'unknown-legacy-item', slot: legacySlot, itemId: productId });
      continue;
    }
    selectedProductIds.push(product.id);
    Object.assign(slots, product.grants);
  }

  const unlocked = uniqueStrings([...(state.unlocked || []), ...selectedProductIds]);
  return {
    schemaVersion: AVATAR_SCHEMA_VERSION,
    catalogRevision: AVATAR_CATALOG_REVISION,
    revision: Math.max(1, Number(state.revision) || 1),
    slots: normalizeAvatarSlots(slots),
    unlocked,
    diagnostics,
  };
}

function normalizeV2State(state) {
  return {
    schemaVersion: AVATAR_SCHEMA_VERSION,
    catalogRevision: AVATAR_CATALOG_REVISION,
    revision: Math.max(1, Number(state.revision) || 1),
    slots: normalizeAvatarSlots(state.slots),
    unlocked: uniqueStrings(state.unlocked),
    diagnostics: normalizeDiagnostics(state.diagnostics),
  };
}

function readLegacySlots(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(
    Object.entries(LEGACY_DEFAULTS).map(([slot, fallback]) => [slot, String(source[slot] || fallback)]),
  );
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean))];
}

function normalizeDiagnostics(values) {
  return Array.isArray(values) ? values.map((entry) => ({ ...entry })) : [];
}

export function projectV2ToLegacy(value) {
  const slots = normalizeAvatarSlots(value?.slots || value);
  const sourceBySlot = new Map();

  for (const slot of AVATAR_SLOTS) {
    const item = getAvatarItem(slots[slot]);
    if (item) sourceBySlot.set(slot, item.sourceProductId);
  }

  const hairFace = pickLegacy(sourceBySlot, ['faceAccessory', 'headAccessory', 'hair', 'face'], 'base_face');
  const accessory = pickLegacy(sourceBySlot, ['backAccessory', 'neckAccessory', 'waistAccessory'], 'sem_acessorio', 'optional_accessory')
    || pickLegacy(sourceBySlot, ['headAccessory', 'faceAccessory'], 'sem_acessorio', 'optional_accessory');

  return {
    body: sourceBySlot.get('body') || LEGACY_DEFAULTS.body,
    hair_face: hairFace,
    outfit: sourceBySlot.get('bottom') || sourceBySlot.get('top') || LEGACY_DEFAULTS.outfit,
    optional_accessory: accessory || LEGACY_DEFAULTS.optional_accessory,
  };
}

function pickLegacy(sourceBySlot, slots, fallback, requiredLegacySlot = 'hair_face') {
  for (const slot of slots) {
    const productId = sourceBySlot.get(slot);
    const product = getAvatarProduct(productId);
    if (product?.legacySlot === requiredLegacySlot) return product.id;
  }
  return fallback;
}

export function getEquippedProductIds(slots) {
  return getProductIdsForSlots(slots);
}
