export const GRID_COLUMNS = 6;
export const GRID_ROWS = 8;
export const TILE_WIDTH = 126;
export const TILE_HEIGHT = 63;
export const GRID_ORIGIN_X = 543;
export const GRID_ORIGIN_Y = 232;
export const FURNITURE_FLOOR_OFFSET_Y = -8;
export const AVATAR_FLOOR_OFFSET_Y = -30;
export const FURNITURE_PROJECTION_X = 38;
export const FURNITURE_PROJECTION_Y = 19;

export function toIso(x, y) {
  return {
    x: GRID_ORIGIN_X + (x - y) * (TILE_WIDTH / 2),
    y: GRID_ORIGIN_Y + (x + y) * (TILE_HEIGHT / 2),
  };
}

export function fromIso(screenX, screenY) {
  const horizontal = (screenX - GRID_ORIGIN_X) / (TILE_WIDTH / 2);
  const vertical = (screenY - GRID_ORIGIN_Y) / (TILE_HEIGHT / 2);
  const x = Math.round((vertical + horizontal) / 2);
  const y = Math.round((vertical - horizontal) / 2);
  if (x < 0 || x >= GRID_COLUMNS || y < 0 || y >= GRID_ROWS) return null;
  return { x, y };
}

export function getGridOutline() {
  const first = toIso(0, 0);
  const eastCell = toIso(GRID_COLUMNS - 1, 0);
  const southCell = toIso(GRID_COLUMNS - 1, GRID_ROWS - 1);
  const westCell = toIso(0, GRID_ROWS - 1);
  return {
    north: { x: first.x, y: first.y - TILE_HEIGHT / 2 },
    east: { x: eastCell.x + TILE_WIDTH / 2, y: eastCell.y },
    bottom: { x: southCell.x, y: southCell.y + TILE_HEIGHT / 2 },
    west: { x: westCell.x - TILE_WIDTH / 2, y: westCell.y },
  };
}

export function isPointInsideDiamond(localX, localY) {
  const normalizedX = Math.abs(localX - TILE_WIDTH / 2) / (TILE_WIDTH / 2);
  const normalizedY = Math.abs(localY - TILE_HEIGHT / 2) / (TILE_HEIGHT / 2);
  return normalizedX + normalizedY <= 1;
}

export function normalizePolygonPoints(points) {
  if (!Array.isArray(points) || points.length < 6 || points.length % 2 !== 0) {
    throw new TypeError('polygon points must contain at least three x/y pairs');
  }
  const xs = points.filter((_, index) => index % 2 === 0);
  const ys = points.filter((_, index) => index % 2 === 1);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return points.map((value, index) => value - (index % 2 === 0 ? minX : minY));
}

export function normalizeFurnitureRotation(value) {
  if (typeof value === 'boolean') return value ? 1 : 0;
  return ((Math.floor(Number(value) || 0) % 4) + 4) % 4;
}

export function nextFurnitureRotation(value) {
  return (normalizeFurnitureRotation(value) + 1) % 4;
}

export function orientFurniturePoint(u, v, rotation = 0) {
  switch (normalizeFurnitureRotation(rotation)) {
    case 1: return { u: v === 0 ? 0 : -v, v: u };
    case 2: return { u: u === 0 ? 0 : -u, v: v === 0 ? 0 : -v };
    case 3: return { u: v, v: u === 0 ? 0 : -u };
    default: return { u, v };
  }
}

export function projectFurniturePoint(u, v, z = 0, rotation = 0) {
  const oriented = orientFurniturePoint(u, v, rotation);
  return {
    x: (oriented.u - oriented.v) * FURNITURE_PROJECTION_X,
    y: (oriented.u + oriented.v) * FURNITURE_PROJECTION_Y - z,
  };
}

export function furnitureRectanglePoints({ centerU = 0, centerV = 0, width, depth, z = 0, rotation = 0, rotated = undefined }) {
  const orientation = rotated == null ? rotation : rotated;
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  return [
    projectFurniturePoint(centerU - halfWidth, centerV - halfDepth, z, orientation),
    projectFurniturePoint(centerU + halfWidth, centerV - halfDepth, z, orientation),
    projectFurniturePoint(centerU + halfWidth, centerV + halfDepth, z, orientation),
    projectFurniturePoint(centerU - halfWidth, centerV + halfDepth, z, orientation),
  ];
}

export function furnitureFloorPosition(cell) {
  const position = toIso(cell.x, cell.y);
  return { x: position.x, y: position.y + FURNITURE_FLOOR_OFFSET_Y };
}

export function cellFromFurniturePosition(screenX, screenY) {
  return fromIso(screenX, screenY - FURNITURE_FLOOR_OFFSET_Y);
}

export function isGridCellAvailable(items, movingItemId, cell) {
  if (!cell) return false;
  return !items.some((item) =>
    item.placed && item.id !== movingItemId && item.x === cell.x && item.y === cell.y
  );
}

export function resolveDropCell(lastDragCell, isValid) {
  return lastDragCell && isValid ? { ...lastDragCell } : null;
}
