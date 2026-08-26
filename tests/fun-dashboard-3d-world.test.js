import assert from "node:assert/strict";
import test from "node:test";

import { HOUSE_3D_GRID, house3dGridToWorld, house3dNormalizedToWorld, house3dWorldToGrid, house3dWorldToNormalized } from "../fun_dashboard/src/lib/house3dGrid.js";
import { dampAngle, resolveStreetPosition, yawToPoint } from "../fun_dashboard/src/lib/streetNavigation.js";

test("grid 3D preserva as quatro extremidades do grid 6x8", () => {
  for (const [x, y] of [[0, 0], [HOUSE_3D_GRID.columns - 1, 0], [0, HOUSE_3D_GRID.rows - 1], [HOUSE_3D_GRID.columns - 1, HOUSE_3D_GRID.rows - 1]]) {
    const point = house3dGridToWorld(x, y);
    assert.deepEqual(house3dWorldToGrid(point.x, point.z), { x, y });
  }
});

test("grid 3D converte a posição realtime contínua sem arredondar para uma célula", () => {
  const point = house3dNormalizedToWorld(50, 80);
  assert.deepEqual(point, { x: 0, z: 2.7 });
  assert.deepEqual(house3dWorldToNormalized(point.x, point.z), { x: 50, y: 80 });
});

test("colisão da rua bloqueia prédios e árvores sem mudar a direção do avatar", () => {
  assert.deepEqual(resolveStreetPosition({ x: 0, z: 0 }, [{ kind: "box", x: 0, z: 0, width: 4, depth: 4 }], .5), { x: -2.5, z: 0 });
  assert.deepEqual(resolveStreetPosition({ x: 0, z: 0 }, [{ kind: "circle", x: 0, z: 0, radius: 1 }], .5), { x: 1.5, z: 0 });
});

test("rotação segue a direção do deslocamento sem salto no cruzamento de -pi/pi", () => {
  assert.equal(yawToPoint({ x: 0, z: 0 }, { x: 1, z: 0 }), Math.PI / 2);
  const next = dampAngle(Math.PI - .05, -Math.PI + .05, 12, 1 / 60);
  assert.ok(Math.abs(next - Math.PI) < .1);
});
