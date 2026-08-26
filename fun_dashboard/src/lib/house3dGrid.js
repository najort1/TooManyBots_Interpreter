export const HOUSE_3D_GRID = Object.freeze({ columns: 6, rows: 8 });

// Centros das células. O meio espaçado deixa uma margem real junto às paredes,
// mas usa visualmente todo o cômodo, inclusive os quatro cantos do grid.
export const HOUSE_3D_GRID_BOUNDS = Object.freeze({ minX: -5.75, maxX: 5.75, minZ: -4.5, maxZ: 4.5 });

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function house3dGridToWorld(x, y) {
  const safeX = clamp(Number(x) || 0, 0, HOUSE_3D_GRID.columns - 1);
  const safeY = clamp(Number(y) || 0, 0, HOUSE_3D_GRID.rows - 1);
  return {
    x: HOUSE_3D_GRID_BOUNDS.minX + (safeX / (HOUSE_3D_GRID.columns - 1)) * (HOUSE_3D_GRID_BOUNDS.maxX - HOUSE_3D_GRID_BOUNDS.minX),
    z: HOUSE_3D_GRID_BOUNDS.minZ + (safeY / (HOUSE_3D_GRID.rows - 1)) * (HOUSE_3D_GRID_BOUNDS.maxZ - HOUSE_3D_GRID_BOUNDS.minZ),
  };
}

export function house3dWorldToGrid(x, z) {
  const normalizedX = (Number(x) - HOUSE_3D_GRID_BOUNDS.minX) / (HOUSE_3D_GRID_BOUNDS.maxX - HOUSE_3D_GRID_BOUNDS.minX);
  const normalizedY = (Number(z) - HOUSE_3D_GRID_BOUNDS.minZ) / (HOUSE_3D_GRID_BOUNDS.maxZ - HOUSE_3D_GRID_BOUNDS.minZ);
  return {
    x: Math.round(clamp(normalizedX, 0, 1) * (HOUSE_3D_GRID.columns - 1)),
    y: Math.round(clamp(normalizedY, 0, 1) * (HOUSE_3D_GRID.rows - 1)),
  };
}

export function house3dNormalizedToWorld(x, y) {
  return house3dGridToWorld(
    clamp(Number(x) || 0, 0, 100) / 100 * (HOUSE_3D_GRID.columns - 1),
    clamp(Number(y) || 0, 0, 100) / 100 * (HOUSE_3D_GRID.rows - 1),
  );
}

export function house3dWorldToNormalized(x, z) {
  return {
    x: Math.round(clamp((Number(x) - HOUSE_3D_GRID_BOUNDS.minX) / (HOUSE_3D_GRID_BOUNDS.maxX - HOUSE_3D_GRID_BOUNDS.minX), 0, 1) * 100),
    y: Math.round(clamp((Number(z) - HOUSE_3D_GRID_BOUNDS.minZ) / (HOUSE_3D_GRID_BOUNDS.maxZ - HOUSE_3D_GRID_BOUNDS.minZ), 0, 1) * 100),
  };
}

export function house3dGridLines() {
  const first = house3dGridToWorld(0, 0);
  const last = house3dGridToWorld(HOUSE_3D_GRID.columns - 1, HOUSE_3D_GRID.rows - 1);
  const stepX = (last.x - first.x) / (HOUSE_3D_GRID.columns - 1);
  const stepZ = (last.z - first.z) / (HOUSE_3D_GRID.rows - 1);
  return {
    vertical: Array.from({ length: HOUSE_3D_GRID.columns + 1 }, (_, index) => first.x - stepX / 2 + index * stepX),
    horizontal: Array.from({ length: HOUSE_3D_GRID.rows + 1 }, (_, index) => first.z - stepZ / 2 + index * stepZ),
  };
}
