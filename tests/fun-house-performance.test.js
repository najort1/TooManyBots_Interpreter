import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CASAS_GRAPHICS_PRESETS,
  normalizeCasasGraphicsQuality,
  resolveCasasGraphicsPreset,
} from '../fun_dashboard/src/lib/casasGraphicsQuality.js';
import { summarizeFrameDurations } from '../fun_dashboard/src/lib/casasPerformance.js';
import { reconcileFurnitureItems } from '../fun_dashboard/src/lib/houseFurnitureReconciliation.js';
import { soundSystemVisualStateKey } from '../fun_dashboard/src/lib/soundSystemStatePolicy.js';
import { createThreeResourceOwnershipRegistry } from '../fun_dashboard/src/lib/threeResourceOwnership.js';
import { createHouseRealtimeHub } from '../fun/services/houseRealtimeService.js';

test('Casas: perfil gráfico inválido usa Balanceado e respeita os tetos definidos', () => {
  assert.equal(normalizeCasasGraphicsQuality('desconhecido'), 'balanced');
  assert.equal(resolveCasasGraphicsPreset('balanced', 2).pixelRatio, 1.25);
  assert.equal(resolveCasasGraphicsPreset('performance', 2).pixelRatio, 1);
  assert.equal(resolveCasasGraphicsPreset('high', 2).pixelRatio, 1.65);
  assert.deepEqual(
    Object.values(CASAS_GRAPHICS_PRESETS).map(({ shadowMapSize, bloom }) => [shadowMapSize, bloom]),
    [[512, true], [1024, true], [2048, true]],
  );
  assert.deepEqual(
    Object.values(CASAS_GRAPHICS_PRESETS).map(({ postProcessingScale }) => postProcessingScale),
    [0.5, 0.75, 1],
  );
});

test('Casas: reconciliação de mobis não recria itens quando apenas posição ou seleção muda', () => {
  const previous = [
    { id: 'sofa', itemId: 'sofa_inicial', x: 1, y: 2, rotation: 0, rotated: false, placed: true, stolen: false },
    { id: 'planta', itemId: 'planta_inicial', x: 2, y: 2, rotation: 0, rotated: false, placed: true, stolen: false },
  ];
  const next = [
    { ...previous[0], x: 4, rotation: 1, rotated: true },
    { id: 'mesa', itemId: 'mesa_cafe', x: 3, y: 2, rotation: 0, rotated: false, placed: true, stolen: false },
  ];
  const diff = reconcileFurnitureItems(previous, next);

  assert.deepEqual(diff.removeIds, ['planta']);
  assert.deepEqual(diff.createItems.map((item) => item.id), ['mesa']);
  assert.deepEqual(diff.updateItems.map((item) => item.id), ['sofa']);
});

test('Casas: recursos compartilhados têm ownership separado dos objetos descartáveis', () => {
  const registry = createThreeResourceOwnershipRegistry();
  const sharedGeometry = {};
  const sharedMaterial = {};
  const transient = {};
  registry.markGeometry(sharedGeometry);
  registry.markMaterial(sharedMaterial);

  assert.equal(registry.ownsGeometry(sharedGeometry), true);
  assert.equal(registry.ownsMaterial(sharedMaterial), true);
  assert.equal(registry.ownsGeometry(transient), false);
  assert.equal(registry.ownsMaterial(transient), false);
});

test('Casas: polling do Paredão ignora somente mudanças de relógio do servidor', () => {
  const state = {
    serverNow: 1_000,
    searchEnabled: true,
    current: { id: 'a', videoId: 'abcdefghijk', startedAt: 500, durationSeconds: 120, title: 'Faixa', requestedBy: 'Bia' },
    queue: [],
  };
  assert.equal(soundSystemVisualStateKey(state), soundSystemVisualStateKey({ ...state, serverNow: 2_500 }));
  assert.notEqual(soundSystemVisualStateKey(state), soundSystemVisualStateKey({ ...state, queue: [{ ...state.current, id: 'b' }] }));
});

test('Casas: monitor resume FPS e p95 sem depender do relógio real', () => {
  const summary = summarizeFrameDurations([16, 16, 16, 20, 25]);
  assert.equal(summary.samples, 5);
  assert.equal(summary.p95FrameMs, 25);
  assert.ok(summary.averageFps > 50 && summary.averageFps < 60);
});

test('Casas: cenário determinístico aceita 30 jogadores na mesma rua', () => {
  const hub = createHouseRealtimeHub();
  const sessions = Array.from({ length: 30 }, (_, index) => hub.open({
    actor: { userJid: `player-${index}@s.whatsapp.net`, scopeKey: 'stress@g.us' },
    scopeKey: 'stress@g.us',
    scene: 'street',
    sceneId: 'street',
    nickname: `Jogador ${index + 1}`,
  }).session);
  const snapshot = hub.snapshot(sessions[0]);

  assert.equal(snapshot.participants.length, 30);
  assert.equal(new Set(snapshot.participants.map((participant) => participant.id)).size, 30);
});

test('Casas: movimento não pode impedir o cálculo da animação dos avatares', async () => {
  const source = await readFile(
    new URL('../fun_dashboard/src/components/casas/StreetWorld.tsx', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(source, /local\.isMoving\s*\|\|\s*updateAvatarPose\(/);
  assert.doesNotMatch(source, /moved\s*\|\|\s*updateAvatarPose\(/);
  assert.match(source, /const localPoseChanged = updateAvatarPose\(local, delta, elapsed\);/);
  assert.match(source, /const remotePoseChanged = updateAvatarPose\(rig, delta, elapsed\);/);
});
