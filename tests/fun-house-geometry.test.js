import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AVATAR_FLOOR_OFFSET_Y,
  FURNITURE_FLOOR_OFFSET_Y,
  FURNITURE_PROJECTION_X,
  FURNITURE_PROJECTION_Y,
  GRID_COLUMNS,
  GRID_ROWS,
  TILE_HEIGHT,
  TILE_WIDTH,
  cellFromFurniturePosition,
  furnitureFloorPosition,
  furnitureRectanglePoints,
  fromIso,
  getGridOutline,
  isPointInsideDiamond,
  isGridCellAvailable,
  nextFurnitureRotation,
  normalizeFurnitureRotation,
  normalizePolygonPoints,
  orientFurniturePoint,
  projectFurniturePoint,
  resolveDropCell,
  toIso,
} from '../fun_dashboard/src/components/casas/houseGeometry.js';

test('house geometry: conversão isométrica preserva todas as células', () => {
  for (let y = 0; y < GRID_ROWS; y += 1) {
    for (let x = 0; x < GRID_COLUMNS; x += 1) {
      const screen = toIso(x, y);
      assert.deepEqual(fromIso(screen.x, screen.y), { x, y });
    }
  }
});

test('house geometry: contorno da casa coincide com as extremidades do grid', () => {
  const first = toIso(0, 0);
  const east = toIso(GRID_COLUMNS - 1, 0);
  const bottom = toIso(GRID_COLUMNS - 1, GRID_ROWS - 1);
  const west = toIso(0, GRID_ROWS - 1);

  assert.deepEqual(getGridOutline(), {
    north: { x: first.x, y: first.y - TILE_HEIGHT / 2 },
    east: { x: east.x + TILE_WIDTH / 2, y: east.y },
    bottom: { x: bottom.x, y: bottom.y + TILE_HEIGHT / 2 },
    west: { x: west.x - TILE_WIDTH / 2, y: west.y },
  });
});

test('house geometry: hit area aceita apenas o losango visível', () => {
  assert.equal(isPointInsideDiamond(TILE_WIDTH / 2, TILE_HEIGHT / 2), true);
  assert.equal(isPointInsideDiamond(TILE_WIDTH / 2, 0), true);
  assert.equal(isPointInsideDiamond(0, 0), false);
  assert.equal(isPointInsideDiamond(TILE_WIDTH * 0.9, TILE_HEIGHT * 0.1), false);
});

test('house geometry: polígonos negativos são normalizados sem alterar proporções', () => {
  assert.deepEqual(
    normalizePolygonPoints([0, -10, 20, 0, 0, 10, -20, 0]),
    [20, 0, 40, 10, 20, 20, 0, 10],
  );
  assert.throws(() => normalizePolygonPoints([0, 0, 1, 1]), /at least three/);
});

test('house geometry: giro troca o eixo do móvel antes da projeção', () => {
  assert.deepEqual([0, 1, 2, 3].map((rotation) => orientFurniturePoint(1, 0, rotation)), [
    { u: 1, v: 0 },
    { u: 0, v: 1 },
    { u: -1, v: 0 },
    { u: 0, v: -1 },
  ]);
  assert.deepEqual(projectFurniturePoint(1, 0, 0, 0), {
    x: FURNITURE_PROJECTION_X,
    y: FURNITURE_PROJECTION_Y,
  });
  assert.deepEqual(projectFurniturePoint(1, 0, 0, 1), {
    x: -FURNITURE_PROJECTION_X,
    y: FURNITURE_PROJECTION_Y,
  });
  assert.deepEqual(projectFurniturePoint(1, 0, 0, 2), {
    x: -FURNITURE_PROJECTION_X,
    y: -FURNITURE_PROJECTION_Y,
  });
  assert.deepEqual(projectFurniturePoint(1, 0, 0, 3), {
    x: FURNITURE_PROJECTION_X,
    y: -FURNITURE_PROJECTION_Y,
  });
});

test('house geometry: normalização e próximo giro percorrem quatro direções', () => {
  assert.equal(normalizeFurnitureRotation(false), 0);
  assert.equal(normalizeFurnitureRotation(true), 1);
  assert.equal(normalizeFurnitureRotation(-1), 3);
  assert.deepEqual([0, 1, 2, 3, 4].map(nextFurnitureRotation), [1, 2, 3, 0, 1]);
  assert.equal(new Set([0, 1, 2, 3].map((rotation) => {
    const point = projectFurniturePoint(0.8, 0.2, 0, rotation);
    return `${point.x}:${point.y}`;
  })).size, 4);
});

test('house geometry: tapete preserva o centro e muda de orientação no giro', () => {
  const horizontal = furnitureRectanglePoints({ width: 1.6, depth: 0.8 });
  const rotated = furnitureRectanglePoints({ width: 1.6, depth: 0.8, rotated: true });
  const center = (points, axis) => points.reduce((sum, point) => sum + point[axis], 0) / points.length;
  assert.ok(Math.abs(center(horizontal, 'x')) < 1e-12);
  assert.ok(Math.abs(center(horizontal, 'y')) < 1e-12);
  assert.ok(Math.abs(center(rotated, 'x')) < 1e-12);
  assert.ok(Math.abs(center(rotated, 'y')) < 1e-12);
  assert.notDeepEqual(rotated, horizontal);
  assert.deepEqual(new Set(rotated.map((point) => `${point.x}:${point.y}`)), new Set(horizontal.map((point) => `${-point.x}:${point.y}`)));
});

test('house geometry: âncoras de móveis preservam a célula visual', () => {
  const cell = { x: 4, y: 3 };
  const center = toIso(cell.x, cell.y);
  const anchored = furnitureFloorPosition(cell);
  assert.deepEqual(anchored, { x: center.x, y: center.y + FURNITURE_FLOOR_OFFSET_Y });
  assert.deepEqual(cellFromFurniturePosition(anchored.x, anchored.y), cell);
  assert.equal(AVATAR_FLOOR_OFFSET_Y, -30);
});

test('house geometry: drop usa a última célula do drag e respeita ocupação', () => {
  const items = [
    { id: 'sofa', x: 1, y: 4, placed: true },
    { id: 'plant', x: 4, y: 1, placed: true },
  ];
  assert.equal(isGridCellAvailable(items, 'sofa', { x: 4, y: 1 }), false);
  assert.equal(isGridCellAvailable(items, 'sofa', { x: 3, y: 3 }), true);
  assert.deepEqual(resolveDropCell({ x: 3, y: 3 }, true), { x: 3, y: 3 });
  assert.equal(resolveDropCell({ x: 4, y: 1 }, false), null);
  assert.equal(resolveDropCell(null, true), null);
});
