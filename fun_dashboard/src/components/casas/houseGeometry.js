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

export function furnitureFloorPosition(cell, itemDef, rotation = 0) {
  const { width, depth } = getFootprintDimensions(itemDef, rotation);
  const position = toIso(cell.x + (width - 1) / 2, cell.y + (depth - 1) / 2);
  return { x: position.x, y: position.y + FURNITURE_FLOOR_OFFSET_Y };
}

export function cellFromFurniturePosition(screenX, screenY, itemDef, rotation = 0) {
  const { width, depth } = getFootprintDimensions(itemDef, rotation);
  const centerOffset = toIso((width - 1) / 2, (depth - 1) / 2);
  const origin = toIso(0, 0);
  return fromIso(
    screenX - (centerOffset.x - origin.x),
    screenY - FURNITURE_FLOOR_OFFSET_Y - (centerOffset.y - origin.y),
  );
}

export function furnitureDepth(cell, itemDef, rotation = 0) {
  const deepestFloorY = getFootprintCells(cell.x, cell.y, itemDef, rotation)
    .reduce((deepest, footprintCell) => Math.max(deepest, toIso(footprintCell.x, footprintCell.y).y), -Infinity);
  return deepestFloorY + 40;
}

export function getFootprintDimensions(itemDef, rotation = 0) {
  const normRot = normalizeFurnitureRotation(rotation);
  const w = Math.max(1, Number(itemDef?.width) || 1);
  const d = Math.max(1, Number(itemDef?.depth) || 1);
  if (normRot === 1 || normRot === 3) {
    return { width: d, depth: w };
  }
  return { width: w, depth: d };
}

export function getFootprintCells(x, y, itemDef, rotation = 0) {
  const { width, depth } = getFootprintDimensions(itemDef, rotation);
  const cells = [];
  const startX = Math.floor(Number(x) || 0);
  const startY = Math.floor(Number(y) || 0);
  for (let dx = 0; dx < width; dx++) {
    for (let dy = 0; dy < depth; dy++) {
      cells.push({ x: startX + dx, y: startY + dy });
    }
  }
  return cells;
}

export function isGridCellAvailable(items, arg2, arg3, arg4, arg5, arg6) {
  let catalogMap = null;
  let movingItemId = null;
  let cell = null;
  let movingItemDef = null;
  let movingRotation = 0;

  if (typeof arg2 === 'string') {
    // Assinatura legada: (items, movingItemId, cell)
    movingItemId = arg2;
    cell = arg3;
  } else {
    // Nova assinatura: (items, catalogMap, movingItemId, cell, movingItemDef, movingRotation)
    catalogMap = arg2;
    movingItemId = arg3;
    cell = arg4;
    movingItemDef = arg5;
    movingRotation = arg6 || 0;
  }

  if (!cell || cell.x < 0 || cell.x >= GRID_COLUMNS || cell.y < 0 || cell.y >= GRID_ROWS) return false;

  const targetCells = movingItemDef ? getFootprintCells(cell.x, cell.y, movingItemDef, movingRotation) : [cell];

  for (const targetCell of targetCells) {
    if (targetCell.x < 0 || targetCell.x >= GRID_COLUMNS || targetCell.y < 0 || targetCell.y >= GRID_ROWS) {
      return false;
    }
  }

  for (const item of items) {
    if (!item.placed || item.id === movingItemId) continue;
    const itemDef = catalogMap?.get ? catalogMap.get(item.itemId) : catalogMap?.[item.itemId];
    if (itemDef && (itemDef.kind === 'wallpaper' || itemDef.kind === 'floor' || itemDef.kind === 'window')) continue;

    const occupiedCells = itemDef ? getFootprintCells(item.x, item.y, itemDef, item.rotation) : [{ x: item.x, y: item.y }];
    for (const targetCell of targetCells) {
      for (const occ of occupiedCells) {
        if (targetCell.x === occ.x && targetCell.y === occ.y) {
          const canStack = movingItemDef && itemDef && Boolean(itemDef.isSurface) && (movingItemDef.width || 1) === 1 && (movingItemDef.depth || 1) === 1;
          if (!canStack) return false;
        }
      }
    }
  }
  return true;
}

export function findPathAStar(start, target, items, catalogMap) {
  if (!start || !target) return [];
  if (start.x === target.x && start.y === target.y) return [start];

  const grid = Array.from({ length: GRID_COLUMNS }, () => Array(GRID_ROWS).fill(true));
  for (const item of items) {
    if (!item.placed) continue;
    const itemDef = catalogMap?.get ? catalogMap.get(item.itemId) : catalogMap?.[item.itemId];
    if (!itemDef || itemDef.kind === 'wallpaper' || itemDef.kind === 'floor' || itemDef.kind === 'window' || itemDef.isSurface) continue;
    const cells = getFootprintCells(item.x, item.y, itemDef, item.rotation);
    for (const c of cells) {
      if (c.x >= 0 && c.x < GRID_COLUMNS && c.y >= 0 && c.y < GRID_ROWS) {
        grid[c.x][c.y] = false;
      }
    }
  }

  // Alvo pode ser um assento/móvel caminhável se tiver sitHeight
  grid[target.x][target.y] = true;

  const openSet = [{ ...start, g: 0, h: Math.abs(start.x - target.x) + Math.abs(start.y - target.y), parent: null }];
  const closedSet = new Set();

  while (openSet.length > 0) {
    openSet.sort((a, b) => (a.g + a.h) - (b.g + b.h));
    const current = openSet.shift();
    const key = `${current.x},${current.y}`;

    if (current.x === target.x && current.y === target.y) {
      const path = [];
      let temp = current;
      while (temp) {
        path.push({ x: temp.x, y: temp.y });
        temp = temp.parent;
      }
      return path.reverse();
    }

    closedSet.add(key);

    const neighbors = [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
    ];

    for (const neighbor of neighbors) {
      if (neighbor.x < 0 || neighbor.x >= GRID_COLUMNS || neighbor.y < 0 || neighbor.y >= GRID_ROWS) continue;
      if (!grid[neighbor.x][neighbor.y]) continue;
      const nKey = `${neighbor.x},${neighbor.y}`;
      if (closedSet.has(nKey)) continue;

      const gScore = current.g + 1;
      let openNode = openSet.find((node) => node.x === neighbor.x && node.y === neighbor.y);

      if (!openNode) {
        openNode = {
          x: neighbor.x,
          y: neighbor.y,
          g: gScore,
          h: Math.abs(neighbor.x - target.x) + Math.abs(neighbor.y - target.y),
          parent: current,
        };
        openSet.push(openNode);
      } else if (gScore < openNode.g) {
        openNode.g = gScore;
        openNode.parent = current;
      }
    }
  }

  return [];
}

export function resolveDropCell(lastDragCell, isValid) {
  return lastDragCell && isValid ? { ...lastDragCell } : null;
}
