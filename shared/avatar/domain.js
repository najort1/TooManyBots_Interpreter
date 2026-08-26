export const AVATAR_SCHEMA_VERSION = 2;
export const AVATAR_CATALOG_REVISION = 1;

export const AVATAR_SLOTS = Object.freeze([
  'body',
  'skinTone',
  'face',
  'hair',
  'top',
  'bottom',
  'shoes',
  'headAccessory',
  'faceAccessory',
  'neckAccessory',
  'backAccessory',
  'waistAccessory',
]);

export const AVATAR_REQUIRED_SLOTS = Object.freeze([
  // A body and its skin tone are structural. Every visible piece layered on
  // top of that base can be removed, including the face and all clothing.
  'body', 'skinTone',
]);

export const AVATAR_OPTIONAL_SLOTS = Object.freeze(
  AVATAR_SLOTS.filter((slot) => !AVATAR_REQUIRED_SLOTS.includes(slot)),
);

export const AVATAR_DEFAULT_SLOTS = Object.freeze({
  body: 'corpo_beco',
  skinTone: 'skin_warm',
  face: 'face_beco',
  hair: 'hair_short',
  top: 'camiseta_beco',
  bottom: 'bottom_beco',
  shoes: 'shoes_beco',
  headAccessory: 'none',
  faceAccessory: 'none',
  neckAccessory: 'none',
  backAccessory: 'none',
  waistAccessory: 'none',
});

export const AVATAR_SLOT_FAMILIES = Object.freeze([
  { id: 'body', name: 'Corpo', slots: Object.freeze(['body', 'skinTone']) },
  { id: 'identity', name: 'Rosto', slots: Object.freeze(['face', 'hair']) },
  { id: 'clothes', name: 'Roupas', slots: Object.freeze(['top', 'bottom', 'shoes']) },
  {
    id: 'accessories',
    name: 'Acessórios',
    slots: Object.freeze(['headAccessory', 'faceAccessory', 'neckAccessory', 'backAccessory', 'waistAccessory']),
  },
]);

const SLOT_NAMES = Object.freeze({
  body: 'Corpo',
  skinTone: 'Pele',
  face: 'Rosto',
  hair: 'Cabelo',
  top: 'Parte de cima',
  bottom: 'Parte de baixo',
  shoes: 'Calçados',
  headAccessory: 'Cabeça',
  faceAccessory: 'Rosto',
  neckAccessory: 'Pescoço',
  backAccessory: 'Costas',
  waistAccessory: 'Cintura',
});

const MODULAR_ITEM_NAMES = Object.freeze({
  bottom_beco: 'Calça do Beco',
  bottom_neon: 'Calça cargo neon',
  bottom_terno: 'Calça social suspeita',
  bottom_nuvem: 'Calça jogger nuvem',
  bottom_xadrez: 'Short xadrez',
  bottom_arcade: 'Short arcade',
  bottom_aurora: 'Saia aurora',
  bottom_oficina: 'Calça da oficina',
  bottom_colegial: 'Saia colegial',
  bottom_astral: 'Calça astral',
  bottom_plissada: 'Saia plissada',
  bottom_lilas: 'Short lilás',
  bottom_noite: 'Saia noite',
  bottom_oversized: 'Calça oversized',
  bottom_cropped: 'Jeans vinil',
  bottom_polo: 'Calça chino',
  shoes_beco: 'Tênis do Beco',
  shoes_neon: 'Tênis neon',
  shoes_terno: 'Sapato social suspeito',
  shoes_nuvem: 'Tênis nuvem',
  shoes_xadrez: 'Tênis xadrez',
  shoes_arcade: 'Tênis arcade',
  shoes_aurora: 'Salto aurora',
  shoes_oficina: 'Bota de oficina',
  shoes_colegial: 'Mocassim colegial',
  shoes_astral: 'Bota astral',
  shoes_plissada: 'Bota plissada',
  shoes_lilas: 'Plataforma lilás',
  shoes_noite: 'Salto noite',
  shoes_oversized: 'Tênis chunky',
  shoes_cropped: 'Plataforma vinil',
  shoes_polo: 'Mocassim do Beco',
});

const SLOT_SOCKETS = Object.freeze({
  body: 'root',
  skinTone: 'body',
  face: 'face',
  hair: 'hair',
  top: 'torso-arms',
  bottom: 'waist-legs',
  shoes: 'feet',
  headAccessory: 'head',
  faceAccessory: 'face',
  neckAccessory: 'neck',
  backAccessory: 'back',
  waistAccessory: 'waist',
});

const PRODUCTS = Object.freeze([
  product('face_sorriso', 'Sorriso aberto', '😄', null, 1, 0, { face: 'face_sorriso' }),
  product('face_confiante', 'Olhar confiante', '😏', null, 1, 0, { face: 'face_confiante' }),
  product('skin_deep', 'Pele profunda', '●', null, 1, 0, { skinTone: 'skin_deep' }),
  product('skin_light', 'Pele clara', '●', null, 1, 0, { skinTone: 'skin_light' }),
  product('corpo_beco', 'Beco', '🧑', 'body', 1, 0, { body: 'corpo_beco', skinTone: 'skin_warm' }),
  product('corpo_beca', 'Beca', '👩', 'body', 1, 0, { body: 'corpo_beca', skinTone: 'skin_caramel' }),
  product('corpo_neutro', 'Neutro', '🧑‍🎤', 'body', 1, 0, { body: 'corpo_neutro', skinTone: 'skin_neutral' }),
  product('base_face', 'Cara do Beco', '🙂', 'hair_face', 1, 0, { face: 'face_beco', hair: 'hair_short' }),
  product('cabelo_caos', 'Cabelo do caos', '💇', 'hair_face', 3, 0, { hair: 'cabelo_caos' }),
  product('oculos_pixel', 'Óculos pixel', '🤓', 'hair_face', 1, 180, { faceAccessory: 'oculos_pixel' }),
  product('cabelo_cacheado', 'Cachos do Beco', '🌀', 'hair_face', 2, 0, { hair: 'cabelo_cacheado' }),
  product('franja_azul', 'Franja azul', '💙', 'hair_face', 5, 0, { hair: 'franja_azul' }),
  product('bone_beco', 'Boné do Beco', '🧢', 'hair_face', 1, 230, { headAccessory: 'bone_beco' }),
  product('bandana_pixel', 'Bandana pixel', '🎗️', 'hair_face', 1, 260, { headAccessory: 'bandana_pixel' }),
  product('mascara_misterio', 'Máscara do mistério', '🎭', 'hair_face', 8, 0, { faceAccessory: 'mascara_misterio' }),
  product('cabelo_rosa', 'Cabelo chiclete', '🌸', 'hair_face', 1, 320, { hair: 'cabelo_rosa' }),
  product('chapeu_pescador', 'Chapéu pescador', '👒', 'hair_face', 12, 0, { headAccessory: 'chapeu_pescador' }),
  product('cabelo_longo_lilas', 'Cabelo longo lilás', '💜', 'hair_face', 1, 0, { hair: 'cabelo_longo_lilas' }),
  product('marias_chiquinhas', 'Marias-chiquinhas neon', '🎀', 'hair_face', 3, 0, { hair: 'marias_chiquinhas' }),
  product('trancas_aurora', 'Tranças aurora', '🪻', 'hair_face', 1, 290, { hair: 'trancas_aurora' }),
  outfit('camiseta_beco', 'Camiseta do Beco', '👕', 1, 0, 'beco'),
  outfit('jaqueta_neon', 'Jaqueta neon', '🧥', 5, 0, 'neon'),
  outfit('terno_suspeito', 'Terno suspeito', '🕴️', 1, 420, 'terno'),
  outfit('moletom_nuvem', 'Moletom nuvem', '☁️', 2, 0, 'nuvem'),
  outfit('camisa_xadrez', 'Camisa xadrez', '🟥', 1, 240, 'xadrez'),
  outfit('uniforme_arcade', 'Uniforme arcade', '🕹️', 6, 0, 'arcade'),
  outfit('vestido_aurora', 'Vestido aurora', '🌅', 1, 360, 'aurora'),
  outfit('macacao_oficina', 'Macacão da oficina', '🔧', 9, 0, 'oficina'),
  outfit('jaqueta_colegial', 'Jaqueta colegial', '🏅', 1, 440, 'colegial'),
  outfit('traje_astral', 'Traje astral', '🚀', 14, 0, 'astral'),
  outfit('saia_plissada', 'Saia plissada', '🩷', 1, 0, 'plissada'),
  outfit('conjunto_lilas', 'Conjunto lilás', '🪻', 1, 350, 'lilas'),
  outfit('vestido_noite', 'Vestido noite', '🌙', 8, 0, 'noite'),
  outfit('camiseta_oversized', 'Camiseta oversized', '🧢', 1, 0, 'oversized'),
  outfit('cropped_vinil', 'Cropped vinil', '✨', 3, 0, 'cropped'),
  outfit('polo_beco', 'Polo do Beco', '🧶', 6, 0, 'polo'),
  product('sem_acessorio', 'Sem acessório', '➖', 'optional_accessory', 1, 0, clearAccessories()),
  product('corrente_brilho', 'Corrente de brilho', '📿', 'optional_accessory', 4, 0, { neckAccessory: 'corrente_brilho' }),
  product('coroa_papel', 'Coroa de papel', '👑', 'optional_accessory', 1, 520, { headAccessory: 'coroa_papel' }),
  product('fones_neon', 'Fones neon', '🎧', 'optional_accessory', 1, 280, { headAccessory: 'fones_neon' }),
  product('mochila_lateral', 'Mochila lateral', '🎒', 'optional_accessory', 4, 0, { backAccessory: 'mochila_lateral' }),
  product('asas_pixel', 'Asas pixel', '🪽', 'optional_accessory', 1, 650, { backAccessory: 'asas_pixel' }),
  product('cachecol_estrelas', 'Cachecol de estrelas', '🧣', 'optional_accessory', 7, 0, { neckAccessory: 'cachecol_estrelas' }),
  product('bolsa_cogumelo', 'Bolsa cogumelo', '🍄', 'optional_accessory', 1, 330, { waistAccessory: 'bolsa_cogumelo' }),
  product('aura_vinil', 'Aura de vinil', '💿', 'optional_accessory', 11, 0, { backAccessory: 'aura_vinil' }),
  product('laco_neon', 'Laço neon', '🎀', 'optional_accessory', 1, 0, { headAccessory: 'laco_neon' }),
  product('tiara_lua', 'Tiara da lua', '🌙', 'optional_accessory', 4, 0, { headAccessory: 'tiara_lua' }),
  product('bolsa_estelar', 'Bolsa estelar', '👜', 'optional_accessory', 1, 310, { waistAccessory: 'bolsa_estelar' }),
  product('brincos_pixel', 'Brincos pixel', '✨', 'optional_accessory', 5, 0, { faceAccessory: 'brincos_pixel' }),
]);

const PRODUCT_BY_ID = new Map(PRODUCTS.map((entry) => [entry.id, entry]));
const ITEMS = Object.freeze(createItems());
const ITEM_BY_ID = new Map(ITEMS.map((entry) => [entry.id, entry]));

function product(id, name, emoji, legacySlot, unlockLevel, cost, grants) {
  const category = cost > 0 ? 'premium' : unlockLevel > 1 ? 'level' : 'free';
  return Object.freeze({ id, name, emoji, legacySlot, unlockLevel, cost, category, grants: Object.freeze({ ...grants }) });
}

function outfit(id, name, emoji, unlockLevel, cost, variant) {
  return product(id, name, emoji, 'outfit', unlockLevel, cost, {
    top: id,
    bottom: `bottom_${variant}`,
    shoes: `shoes_${variant}`,
  });
}

function clearAccessories() {
  return Object.fromEntries(AVATAR_SLOTS.filter((slot) => slot.endsWith('Accessory')).map((slot) => [slot, 'none']));
}

function createItems() {
  const unique = new Map();
  for (const source of PRODUCTS) {
    for (const [slot, itemId] of Object.entries(source.grants)) {
      if (itemId === 'none' || unique.has(itemId)) continue;
      unique.set(itemId, createItem(source, slot, itemId));
    }
  }
  return [...unique.values()];
}

function createItem(source, slot, id) {
  const suffix = id === source.id ? '' : ` · ${SLOT_NAMES[slot]}`;
  return Object.freeze({
    id,
    name: MODULAR_ITEM_NAMES[id] || `${source.name}${suffix}`,
    description: `${SLOT_NAMES[slot]} modular do visual ${source.name}.`,
    emoji: source.emoji,
    slot,
    rendererKey: id,
    socket: SLOT_SOCKETS[slot],
    preview: `/casas/avatar/previews/${id}.webp`,
    sourceProductId: source.id,
    legacyFallback: source.id,
    compatibleBodies: Object.freeze(['corpo_beco', 'corpo_beca', 'corpo_neutro']),
  });
}

export function listAvatarProducts() {
  return [...PRODUCTS];
}

export function getAvatarProduct(id) {
  return PRODUCT_BY_ID.get(String(id || '').trim()) || null;
}

export function listAvatarItems() {
  return [...ITEMS];
}

export function getAvatarItem(id) {
  if (id === 'none') return null;
  return ITEM_BY_ID.get(String(id || '').trim()) || null;
}

// Tops advertise a complete outfit. Bottom and shoe cards deliberately keep
// the other slots neutral so each modular piece is legible in its own tab.
export function getAvatarPreviewSlots(item = {}) {
  const candidate = item && typeof item === 'object' ? item : {};
  const itemId = String(candidate.id || '').trim();
  const catalogItem = getAvatarItem(itemId);
  const sourceProductId = String(candidate.sourceProductId || catalogItem?.sourceProductId || '').trim();
  const product = getAvatarProduct(sourceProductId);
  const slots = {
    ...AVATAR_DEFAULT_SLOTS,
    ...((catalogItem?.slot === 'bottom' || catalogItem?.slot === 'shoes') ? {} : (product?.grants || {})),
  };

  if (catalogItem?.slot === candidate.slot) slots[catalogItem.slot] = catalogItem.id;
  return normalizeAvatarSlots(slots);
}

export function isAvatarSlot(slot) {
  return AVATAR_SLOTS.includes(String(slot || ''));
}

/**
 * Returns the persisted value used by the studio to remove a cosmetic slot.
 * Body structure and skin tone deliberately remain mandatory so the renderer
 * always has a character to animate.
 */
export function getAvatarSlotRemovalValue(slot) {
  const candidate = String(slot || '');
  return AVATAR_OPTIONAL_SLOTS.includes(candidate) ? 'none' : null;
}

export function normalizeAvatarSlots(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const slots = {};
  for (const slot of AVATAR_SLOTS) {
    const candidate = String(source[slot] || '');
    const item = getAvatarItem(candidate);
    const validNone = AVATAR_OPTIONAL_SLOTS.includes(slot) && candidate === 'none';
    slots[slot] = item?.slot === slot || validNone ? candidate : AVATAR_DEFAULT_SLOTS[slot];
  }
  return slots;
}

export function validateAvatarAppearance(value) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, errors: [{ code: 'invalid-appearance' }] };
  }
  for (const key of Object.keys(value)) {
    if (!isAvatarSlot(key)) errors.push({ code: 'unknown-slot', slot: key });
  }
  for (const slot of AVATAR_SLOTS) validateSlot(value, slot, errors);
  return errors.length ? { ok: false, errors } : { ok: true, slots: normalizeAvatarSlots(value), errors: [] };
}

function validateSlot(value, slot, errors) {
  if (!Object.hasOwn(value, slot)) {
    errors.push({ code: AVATAR_REQUIRED_SLOTS.includes(slot) ? 'missing-required-slot' : 'missing-slot', slot });
    return;
  }
  const itemId = String(value[slot] || '');
  if (AVATAR_OPTIONAL_SLOTS.includes(slot) && itemId === 'none') return;
  const item = getAvatarItem(itemId);
  if (!item) errors.push({ code: 'unknown-item', slot, itemId });
  else if (item.slot !== slot) errors.push({ code: 'slot-mismatch', slot, itemId, expectedSlot: item.slot });
}

export function getAvatarVisualKey(avatar) {
  const slots = normalizeAvatarSlots(avatar?.slots || avatar);
  return [AVATAR_SCHEMA_VERSION, ...AVATAR_SLOTS.map((slot) => slots[slot])].join('|');
}

export function getProductIdsForSlots(slots) {
  const normalized = normalizeAvatarSlots(slots);
  const productIds = new Set();
  for (const slot of AVATAR_SLOTS) {
    const item = getAvatarItem(normalized[slot]);
    if (item) productIds.add(item.sourceProductId);
  }
  return [...productIds];
}
