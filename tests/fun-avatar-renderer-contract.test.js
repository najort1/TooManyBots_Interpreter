import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AVATAR_SLOTS, listAvatarItems } from '../shared/avatar/domain.js';
import {
  AVATAR_RENDERER_KEYS,
  AVATAR_BODY_PROFILES,
  AVATAR_BOTTOM_PROFILES,
  AVATAR_BOTTOM_GARMENT_PROFILES,
  AVATAR_HAIR_PROFILES,
  AVATAR_HAIR_CAP,
  AVATAR_SHOE_PROFILES,
  AVATAR_TOP_PROFILES,
  AVATAR_SOCKET_NAMES,
  getAvatarBodyProfile,
  getAvatarHairCap,
  getAvatarPalette,
} from '../fun_dashboard/src/components/casas/avatar/recipes.js';

test('avatar renderer: registry cobre todos os rendererKeys do catálogo', () => {
  const rendererKeys = new Set(AVATAR_RENDERER_KEYS);
  const missing = listAvatarItems().filter((item) => !rendererKeys.has(item.rendererKey));
  assert.deepEqual(missing, []);
});

test('avatar renderer: todos os sockets canônicos têm nome estável', () => {
  assert.deepEqual(Object.keys(AVATAR_SOCKET_NAMES).sort(), [
    'back', 'body', 'face', 'feet', 'hair', 'head', 'neck', 'root', 'torso-arms', 'waist', 'waist-legs',
  ].sort());
  assert.ok(Object.values(AVATAR_SOCKET_NAMES).every((name) => name.startsWith('avatar-socket-')));
});

test('avatar renderer: paleta deriva cada slot visual sem depender dos slots legados', () => {
  const slots = {
    body: 'corpo_beca', skinTone: 'skin_deep', face: 'face_confiante', hair: 'cabelo_rosa',
    top: 'jaqueta_neon', bottom: 'bottom_noite', shoes: 'shoes_arcade',
    headAccessory: 'coroa_papel', faceAccessory: 'oculos_pixel', neckAccessory: 'corrente_brilho',
    backAccessory: 'asas_pixel', waistAccessory: 'bolsa_estelar',
  };
  const palette = getAvatarPalette(slots);

  assert.equal(typeof palette.skin, 'number');
  assert.equal(typeof palette.hair, 'number');
  assert.equal(typeof palette.top, 'number');
  assert.equal(typeof palette.bottom, 'number');
  assert.equal(typeof palette.shoes, 'number');
  assert.equal(Object.keys(slots).length, AVATAR_SLOTS.length);
});

test('avatar renderer: catálogo mantém as três expressões independentes', () => {
  const faces = listAvatarItems()
    .filter((item) => item.slot === 'face')
    .map((item) => item.id)
    .sort();

  assert.deepEqual(faces, ['face_beco', 'face_confiante', 'face_sorriso']);
});

test('avatar renderer: os três corpos têm silhuetas estruturais e roupas proporcionais', () => {
  const profiles = ['corpo_beco', 'corpo_beca', 'corpo_neutro'].map(getAvatarBodyProfile);
  const signatures = profiles.map((profile) => JSON.stringify({
    torso: profile.torso,
    head: profile.head,
    armX: profile.armX,
    legX: profile.legX,
    limbScale: profile.limbScale,
  }));

  assert.deepEqual(Object.keys(AVATAR_BODY_PROFILES).sort(), ['corpo_beca', 'corpo_beco', 'corpo_neutro']);
  assert.equal(new Set(signatures).size, profiles.length);
  assert.ok(profiles.every((profile) => profile.topWidth > 0 && profile.legWidth > 0 && profile.shoeWidth > 0));
});

test('avatar renderer: saias ancoram na cintura e cabelos longos alcançam a cintura', () => {
  assert.ok(Object.values(AVATAR_BOTTOM_PROFILES).every((profile) => profile.skirt && profile.y < 0 && profile.height >= 0.62));
  assert.equal(AVATAR_HAIR_PROFILES.cabelo_longo_lilas.style, 'long');
  assert.equal(AVATAR_HAIR_PROFILES.trancas_aurora.style, 'braids');
  assert.ok(AVATAR_HAIR_PROFILES.cabelo_longo_lilas.length >= 1.9);
  assert.ok(AVATAR_HAIR_PROFILES.trancas_aurora.length >= 1.85);
});

test('avatar renderer: perfis longos preservam o mesmo comprimento na frente e nas costas', () => {
  for (const profile of [AVATAR_HAIR_PROFILES.cabelo_longo_lilas, AVATAR_HAIR_PROFILES.trancas_aurora]) {
    assert.ok(['long', 'braids'].includes(profile.style));
    assert.ok(profile.length >= 1.9);
    assert.ok(profile.y < -0.9);
  }
});

test('avatar renderer: cachos têm perfil próprio de mechas em espiral', () => {
  const curls = AVATAR_HAIR_PROFILES.cabelo_cacheado;

  assert.equal(curls.style, 'curls');
  assert.ok(curls.length >= 0.6);
  assert.ok(curls.width >= 0.1);
});

test('avatar renderer: todos os cabelos usam uma cobertura 3D comum no crânio', () => {
  const hairItems = listAvatarItems().filter((item) => item.slot === 'hair');

  assert.equal(AVATAR_HAIR_CAP.length, 4);
  assert.ok(AVATAR_HAIR_CAP.some((part) => part.position[2] < -0.4), 'nuca coberta');
  assert.equal(AVATAR_HAIR_CAP.filter((part) => Math.abs(part.position[0]) >= 0.5).length, 2, 'duas laterais cobertas');
  assert.ok(hairItems.every((item) => getAvatarHairCap(item.id).length === AVATAR_HAIR_CAP.length));
});

test('avatar renderer: olhos usam blocos com ponto de luz pixelado', async () => {
  const runtime = await readFile(new URL('../fun_dashboard/src/components/casas/avatar/runtime.ts', import.meta.url), 'utf8');

  assert.match(runtime, /new THREE\.BoxGeometry\(0\.112, eyeHeight, 0\.038\)/);
  assert.match(runtime, /highlight\.name = "face-eye-highlight"/);
});

test('avatar renderer: slots removíveis não desenham rosto ou roupas', async () => {
  const runtime = await readFile(new URL('../fun_dashboard/src/components/casas/avatar/runtime.ts', import.meta.url), 'utf8');

  assert.match(runtime, /function composeFace\([^)]*\) \{\s*if \(face === "none"\) return;/);
  assert.match(runtime, /function composeTop\([^)]*\) \{\s*if \(top === "none"\) return;/);
  assert.match(runtime, /function composeBottom\([^)]*\) \{\s*if \(bottom === "none"\) return;/);
  assert.match(runtime, /function composeShoes\([^)]*\) \{\s*if \(shoes === "none"\) return;/);
});

test('avatar renderer: roupas têm modelagens próprias, incluindo oversized, cropped e polo', () => {
  const topItems = listAvatarItems().filter((item) => item.slot === 'top');
  const bottomItems = listAvatarItems().filter((item) => item.slot === 'bottom');
  const shoeItems = listAvatarItems().filter((item) => item.slot === 'shoes');
  const shapes = new Set(Object.values(AVATAR_TOP_PROFILES).map((profile) => profile.shape));

  assert.deepEqual(
    topItems.filter((item) => ['camiseta_oversized', 'cropped_vinil', 'polo_beco'].includes(item.id)).map((item) => item.id).sort(),
    ['camiseta_oversized', 'cropped_vinil', 'polo_beco'],
  );
  assert.ok(shapes.has('oversized'));
  assert.ok(shapes.has('cropped'));
  assert.ok(shapes.has('polo'));
  assert.ok(shapes.size >= 10, 'as peças devem ter silhuetas, não apenas cores diferentes');
  assert.ok(topItems.every((item) => Object.hasOwn(AVATAR_TOP_PROFILES, item.id)));
  assert.ok(bottomItems.every((item) => Object.hasOwn(AVATAR_BOTTOM_GARMENT_PROFILES, item.id)));
  assert.ok(shoeItems.every((item) => Object.hasOwn(AVATAR_SHOE_PROFILES, item.id)));
});

test('avatar renderer: tênis xadrez não reutiliza a mesma prévia do tênis-base', () => {
  const base = getAvatarPalette({ shoes: 'shoes_beco' }).shoes;
  const plaid = getAvatarPalette({ shoes: 'shoes_xadrez' }).shoes;

  assert.notEqual(plaid, base);
});
