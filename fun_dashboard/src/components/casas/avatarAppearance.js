export const AVATAR_OUTFIT_COLORS = Object.freeze({
  camiseta_beco: 0x7b5ce5,
  jaqueta_neon: 0xf15099,
  terno_suspeito: 0x344563,
  moletom_nuvem: 0x70a7d8,
  camisa_xadrez: 0xbd4c55,
  uniforme_arcade: 0x2a9d9f,
  vestido_aurora: 0xf08b8f,
  macacao_oficina: 0xc58a35,
  jaqueta_colegial: 0x3f7d62,
  traje_astral: 0x354472,
  saia_plissada: 0xe982b6,
  conjunto_lilas: 0x8968cf,
  vestido_noite: 0x38407b,
});

export const AVATAR_VISUAL_IDS = Object.freeze({
  body: Object.freeze(['corpo_beco', 'corpo_beca', 'corpo_neutro']),
  hair_face: Object.freeze([
    'base_face', 'cabelo_caos', 'oculos_pixel', 'cabelo_cacheado', 'franja_azul',
    'bone_beco', 'bandana_pixel', 'mascara_misterio', 'cabelo_rosa', 'chapeu_pescador',
    'cabelo_longo_lilas', 'marias_chiquinhas', 'trancas_aurora',
  ]),
  outfit: Object.freeze(Object.keys(AVATAR_OUTFIT_COLORS)),
  optional_accessory: Object.freeze([
    'sem_acessorio', 'corrente_brilho', 'coroa_papel', 'fones_neon', 'mochila_lateral',
    'asas_pixel', 'cachecol_estrelas', 'bolsa_cogumelo', 'aura_vinil',
    'laco_neon', 'tiara_lua', 'bolsa_estelar', 'brincos_pixel',
  ]),
});

/** @param {string} outfit */
export function getAvatarOutfitColor(outfit) {
  return AVATAR_OUTFIT_COLORS[outfit] ?? AVATAR_OUTFIT_COLORS.camiseta_beco;
}

/** @param {string} slot @param {string} itemId */
export function hasAvatarVisual(slot, itemId) {
  return AVATAR_VISUAL_IDS[slot]?.includes(itemId) === true;
}

/** @param {{ slots?: Record<string, string> } | null | undefined} avatar */
export function getAvatarVisualKey(avatar) {
  const slots = avatar?.slots || {};
  return [slots.body || 'corpo_beco', slots.hair_face || '', slots.outfit || '', slots.optional_accessory || ''].join('|');
}
