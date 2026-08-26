import test from 'node:test';
import assert from 'node:assert/strict';
import { HOUSE_VOICE_SPATIAL, getHouseVoiceSpatialPosition } from '../fun_dashboard/src/lib/houseVoiceSpatial.js';

test('voice 3D: preserva esquerda e direita a partir da posição dos avatares', () => {
  const listener = { x: 50, y: 54 };

  assert.ok(getHouseVoiceSpatialPosition(listener, { x: 64, y: 54 }).x > 0);
  assert.ok(getHouseVoiceSpatialPosition(listener, { x: 36, y: 54 }).x < 0);
});

test('voice 3D: reduz o ganho com a distância e silencia fora do alcance', () => {
  const listener = { x: 50, y: 54 };
  const near = getHouseVoiceSpatialPosition(listener, { x: 53, y: 54 });
  const far = getHouseVoiceSpatialPosition(listener, { x: 70, y: 54 });
  const outOfRange = getHouseVoiceSpatialPosition(listener, { x: 50 + HOUSE_VOICE_SPATIAL.maxDistance, y: 54 });

  assert.equal(near.gain, 1);
  assert.ok(far.gain > 0 && far.gain < near.gain);
  assert.equal(outOfRange.gain, 0);
});
