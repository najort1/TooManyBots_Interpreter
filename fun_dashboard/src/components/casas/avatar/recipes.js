import { listAvatarItems } from '../../../../../shared/avatar/domain.js';

export const AVATAR_RENDERER_KEYS = Object.freeze(listAvatarItems().map((item) => item.rendererKey));

export const AVATAR_SOCKET_NAMES = Object.freeze({
  root: 'avatar-socket-root',
  body: 'avatar-socket-body',
  face: 'avatar-socket-face',
  hair: 'avatar-socket-hair',
  head: 'avatar-socket-head',
  neck: 'avatar-socket-neck',
  back: 'avatar-socket-back',
  waist: 'avatar-socket-waist',
  feet: 'avatar-socket-feet',
  'torso-arms': 'avatar-socket-torso-arms',
  'waist-legs': 'avatar-socket-waist-legs',
});

// Profiles are intentionally structural, not just color variants. The rig and
// its clothing read the same profile so an outfit preserves the silhouette
// selected in the studio, house, and street.
export const AVATAR_BODY_PROFILES = Object.freeze({
  corpo_beco: Object.freeze({
    torso: Object.freeze([1.16, 1.08, 0.72]),
    head: Object.freeze([0.98, 0.94, 0.88]),
    headY: 2.98,
    armX: 0.79,
    legX: 0.29,
    limbScale: 1.04,
    topWidth: 1.2,
    legWidth: 0.49,
    shoeWidth: 0.5,
  }),
  corpo_beca: Object.freeze({
    torso: Object.freeze([0.84, 1.0, 0.58]),
    head: Object.freeze([0.84, 0.9, 0.78]),
    headY: 2.91,
    armX: 0.61,
    legX: 0.23,
    limbScale: 0.88,
    topWidth: 0.89,
    legWidth: 0.4,
    shoeWidth: 0.42,
  }),
  corpo_neutro: Object.freeze({
    torso: Object.freeze([1.0, 1.16, 0.68]),
    head: Object.freeze([0.92, 1.0, 0.86]),
    headY: 3.02,
    armX: 0.7,
    legX: 0.26,
    limbScale: 0.97,
    topWidth: 1.04,
    legWidth: 0.45,
    shoeWidth: 0.47,
  }),
});

export const AVATAR_HAIR_PROFILES = Object.freeze({
  cabelo_cacheado: Object.freeze({ style: 'curls', length: 0.64, width: 0.11, y: -0.34 }),
  cabelo_longo_lilas: Object.freeze({ style: 'long', length: 2.15, width: 0.25, y: -1.05 }),
  trancas_aurora: Object.freeze({ style: 'braids', length: 2.04, width: 0.14, y: -1.02 }),
  marias_chiquinhas: Object.freeze({ style: 'pigtails', length: 1.15, width: 0.2, y: -0.58 }),
  cabelo_rosa: Object.freeze({ style: 'pigtails', length: 1.05, width: 0.22, y: -0.52 }),
});

export const AVATAR_HAIR_CAP = Object.freeze([
  Object.freeze({ size: Object.freeze([0.98, 0.28, 0.9]), position: Object.freeze([0, 0.05, -0.01]) }),
  Object.freeze({ size: Object.freeze([0.96, 0.92, 0.15]), position: Object.freeze([0, -0.42, -0.46]) }),
  Object.freeze({ size: Object.freeze([0.16, 0.96, 0.88]), position: Object.freeze([-0.5, -0.42, 0]) }),
  Object.freeze({ size: Object.freeze([0.16, 0.96, 0.88]), position: Object.freeze([0.5, -0.42, 0]) }),
]);

export const AVATAR_BOTTOM_PROFILES = Object.freeze({
  bottom_plissada: Object.freeze({ skirt: true, height: 0.62, topRadius: 0.5, bottomRadius: 0.72, y: -0.28 }),
  bottom_aurora: Object.freeze({ skirt: true, height: 0.74, topRadius: 0.49, bottomRadius: 0.76, y: -0.34 }),
  bottom_noite: Object.freeze({ skirt: true, height: 0.78, topRadius: 0.5, bottomRadius: 0.7, y: -0.36 }),
  bottom_colegial: Object.freeze({ skirt: true, height: 0.62, topRadius: 0.48, bottomRadius: 0.68, y: -0.28 }),
});

const bottomProfile = (shape, width = 1, upper = 1, lower = 1) => Object.freeze({ shape, width, upper, lower });

export const AVATAR_BOTTOM_GARMENT_PROFILES = Object.freeze({
  bottom_beco: bottomProfile('denim'),
  bottom_neon: bottomProfile('cargo', 1.08, 1, 1.04),
  bottom_terno: bottomProfile('tailored', 0.92, 1.08, 1.08),
  bottom_nuvem: bottomProfile('jogger', 1.05, 1, 0.94),
  bottom_xadrez: bottomProfile('shorts', 1.08, 0.72, 0),
  bottom_arcade: bottomProfile('shorts', 1.02, 0.68, 0),
  bottom_aurora: bottomProfile('skirt', 1, 0, 0),
  bottom_oficina: bottomProfile('workwear', 1.04, 1.05, 1.02),
  bottom_colegial: bottomProfile('skirt', 1, 0, 0),
  bottom_astral: bottomProfile('armor', 1.06, 1.02, 1),
  bottom_plissada: bottomProfile('skirt', 1, 0, 0),
  bottom_lilas: bottomProfile('shorts', 1.04, 0.7, 0),
  bottom_noite: bottomProfile('skirt', 1, 0, 0),
  bottom_oversized: bottomProfile('baggy', 1.18, 1.1, 1.08),
  bottom_cropped: bottomProfile('denim', 0.94, 0.96, 0.96),
  bottom_polo: bottomProfile('chinos', 0.94, 1.03, 1.02),
});

const shoeProfile = (shape, width = 1, height = 1, depth = 1) => Object.freeze({ shape, width, height, depth });

export const AVATAR_SHOE_PROFILES = Object.freeze({
  shoes_beco: shoeProfile('sneaker'),
  shoes_neon: shoeProfile('high-top', 1.08, 1.22, 1.02),
  shoes_terno: shoeProfile('loafer', 0.9, 0.84, 1.04),
  shoes_nuvem: shoeProfile('cloud-sneaker', 1.08, 1, 1.05),
  shoes_xadrez: shoeProfile('canvas', 1, 1, 1),
  shoes_arcade: shoeProfile('high-top', 1.07, 1.2, 1.04),
  shoes_aurora: shoeProfile('heel', 0.82, 1.12, 1.04),
  shoes_oficina: shoeProfile('boot', 1.06, 1.35, 1.02),
  shoes_colegial: shoeProfile('loafer', 0.94, 0.9, 1.02),
  shoes_astral: shoeProfile('boot', 1.08, 1.32, 1.05),
  shoes_plissada: shoeProfile('boot', 1, 1.24, 1),
  shoes_lilas: shoeProfile('platform', 1.04, 1.05, 1.04),
  shoes_noite: shoeProfile('heel', 0.82, 1.12, 1.04),
  shoes_oversized: shoeProfile('chunky', 1.22, 1.12, 1.12),
  shoes_cropped: shoeProfile('platform', 1.02, 1.12, 1.03),
  shoes_polo: shoeProfile('loafer', 0.94, 0.92, 1.02),
});

const topProfile = (shape, width, height, sleeve, y = -0.04) => Object.freeze({ shape, width, height, sleeve, y });

// Clothing is structural first: a cropped shirt, a polo and an oversized tee
// must read differently in silhouette before their colors or patterns are seen.
export const AVATAR_TOP_PROFILES = Object.freeze({
  camiseta_beco: topProfile('tee', 1, 0.86, 1),
  jaqueta_neon: topProfile('jacket', 1.08, 0.92, 1.08),
  terno_suspeito: topProfile('blazer', 1.03, 0.94, 1.02),
  moletom_nuvem: topProfile('hoodie', 1.18, 0.94, 1.18),
  camisa_xadrez: topProfile('overshirt', 1.14, 0.92, 1.12),
  uniforme_arcade: topProfile('varsity', 1.05, 0.88, 1.06),
  vestido_aurora: topProfile('dress-bodice', 0.92, 0.74, 0.78, 0.05),
  macacao_oficina: topProfile('overalls', 1.0, 0.88, 0.96),
  jaqueta_colegial: topProfile('school-jacket', 1.04, 0.9, 1.04),
  traje_astral: topProfile('armor', 1.1, 0.95, 1.12),
  saia_plissada: topProfile('cropped-cardigan', 0.92, 0.58, 0.82, 0.2),
  conjunto_lilas: topProfile('cropped', 0.96, 0.5, 0.86, 0.25),
  vestido_noite: topProfile('off-shoulder', 0.9, 0.72, 0.72, 0.06),
  camiseta_oversized: topProfile('oversized', 1.32, 1.22, 1.3, -0.14),
  cropped_vinil: topProfile('cropped', 0.9, 0.46, 0.78, 0.28),
  polo_beco: topProfile('polo', 1.0, 0.82, 0.82),
});

export function getAvatarBodyProfile(body = 'corpo_beco') {
  return AVATAR_BODY_PROFILES[body] || AVATAR_BODY_PROFILES.corpo_beco;
}

export function getAvatarHairProfile(hair = '') {
  return AVATAR_HAIR_PROFILES[hair] || null;
}

export function getAvatarHairCap(hair = '') {
  return hair && hair !== 'none' ? AVATAR_HAIR_CAP : [];
}

export function getAvatarBottomProfile(bottom = '') {
  return AVATAR_BOTTOM_PROFILES[bottom] || null;
}

export function getAvatarTopProfile(top = '') {
  return AVATAR_TOP_PROFILES[top] || AVATAR_TOP_PROFILES.camiseta_beco;
}

export function getAvatarBottomGarmentProfile(bottom = '') {
  return AVATAR_BOTTOM_GARMENT_PROFILES[bottom] || AVATAR_BOTTOM_GARMENT_PROFILES.bottom_beco;
}

export function getAvatarShoeProfile(shoes = '') {
  return AVATAR_SHOE_PROFILES[shoes] || AVATAR_SHOE_PROFILES.shoes_beco;
}

const SKIN_COLORS = Object.freeze({
  skin_light: 0xf2c7a1,
  skin_warm: 0xd99c72,
  skin_caramel: 0xb97752,
  skin_neutral: 0xc48b68,
  skin_deep: 0x75452f,
});

const HAIR_COLORS = Object.freeze({
  cabelo_rosa: 0xe965a6,
  marias_chiquinhas: 0xe965a6,
  franja_azul: 0x3f83d8,
  cabelo_longo_lilas: 0x8061c7,
  trancas_aurora: 0x3b2a39,
  cabelo_caos: 0x44334e,
  cabelo_cacheado: 0x35261f,
  hair_short: 0x32272c,
});

const TOP_COLORS = Object.freeze({
  camiseta_beco: 0x7756de,
  jaqueta_neon: 0xec4f9a,
  terno_suspeito: 0x283552,
  moletom_nuvem: 0x8bb9df,
  camisa_xadrez: 0xb64a57,
  uniforme_arcade: 0x219a98,
  vestido_aurora: 0xe97896,
  macacao_oficina: 0xb98332,
  jaqueta_colegial: 0x357258,
  traje_astral: 0x293761,
  saia_plissada: 0xe982b6,
  conjunto_lilas: 0x8968cf,
  vestido_noite: 0x303568,
  camiseta_oversized: 0xe3a848,
  cropped_vinil: 0x25233d,
  polo_beco: 0x4c9a75,
});

const BOTTOM_COLORS = Object.freeze({
  bottom_beco: 0x36415f,
  bottom_neon: 0x3b244f,
  bottom_terno: 0x202b44,
  bottom_nuvem: 0x678db3,
  bottom_xadrez: 0x522f42,
  bottom_arcade: 0x182e4b,
  bottom_aurora: 0xb64b82,
  bottom_oficina: 0x4d627e,
  bottom_colegial: 0x283f35,
  bottom_astral: 0x181f43,
  bottom_plissada: 0xf08ab9,
  bottom_lilas: 0x7256af,
  bottom_noite: 0x20244f,
  bottom_oversized: 0x31445e,
  bottom_cropped: 0x3e4c68,
  bottom_polo: 0xd8c49a,
});

export function getAvatarPalette(slots = {}) {
  return {
    skin: SKIN_COLORS[slots.skinTone] ?? SKIN_COLORS.skin_warm,
    hair: HAIR_COLORS[slots.hair] ?? HAIR_COLORS.hair_short,
    top: TOP_COLORS[slots.top] ?? TOP_COLORS.camiseta_beco,
    bottom: BOTTOM_COLORS[slots.bottom] ?? BOTTOM_COLORS.bottom_beco,
    shoes: shoeColor(slots.shoes),
    ink: 0x211a2d,
    gold: 0xf6d365,
    accent: 0x72efff,
  };
}

function shoeColor(shoes = '') {
  if (shoes.includes('xadrez')) return 0xb64a57;
  if (shoes.includes('aurora') || shoes.includes('lilas')) return 0x5b3f83;
  if (shoes.includes('arcade') || shoes.includes('astral')) return 0x182238;
  if (shoes.includes('colegial')) return 0x2b3a31;
  if (shoes.includes('polo')) return 0x6e4b32;
  if (shoes.includes('cropped')) return 0x2a2434;
  if (shoes.includes('oversized')) return 0x2e384d;
  return 0x1f2131;
}
