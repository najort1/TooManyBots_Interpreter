const SIDE_COUNT = 10;
const NORTH_COUNT = 10;

export const RESIDENTIAL_ROADS = Object.freeze([
  Object.freeze({ id: 'west', x: -34.6, z: 36, width: 8.2, depth: 59 }),
  Object.freeze({ id: 'east', x: 34.6, z: 36, width: 8.2, depth: 59 }),
  Object.freeze({ id: 'north', x: 0, z: 58.4, width: 77.5, depth: 8.2 }),
]);

export const RESIDENTIAL_SIDEWALKS = Object.freeze([
  Object.freeze({ id: 'west', x: -29, z: 36, width: 3, depth: 59 }),
  Object.freeze({ id: 'east', x: 29, z: 36, width: 3, depth: 59 }),
  Object.freeze({ id: 'north', x: 0, z: 53, width: 72, depth: 3 }),
]);

export function createResidentialLampPosts() {
  // One lamp at each residential approach is enough to define the route without
  // filling every sidewalk segment with identical poles.
  const sideZ = [14, 42];
  const northX = [-22, 22];
  return [
    ...sideZ.map((z) => ({ sidewalk: 'west', x: -29, z, rotation: Math.PI })),
    ...sideZ.map((z) => ({ sidewalk: 'east', x: 29, z, rotation: 0 })),
    ...northX.map((x) => ({ sidewalk: 'north', x, z: 53, rotation: -Math.PI / 2 })),
  ];
}

function sideLots(zone, x, rotation) {
  return Array.from({ length: SIDE_COUNT }, (_, index) => ({
    zone,
    x,
    z: 8 + index * 6,
    rotation,
  }));
}

const RESIDENTIAL_SLOTS = Object.freeze([
  ...sideLots('west', -42, Math.PI / 2),
  ...Array.from({ length: NORTH_COUNT }, (_, index) => ({
    zone: 'north',
    x: -33.3 + index * 7.4,
    z: 66,
    rotation: Math.PI,
  })),
  ...sideLots('east', 42, -Math.PI / 2),
]);

export function createResidentialLots(count) {
  const requested = Math.max(0, Math.min(RESIDENTIAL_SLOTS.length, Math.floor(Number(count) || 0)));
  const zones = {
    west: RESIDENTIAL_SLOTS.filter((slot) => slot.zone === 'west'),
    north: RESIDENTIAL_SLOTS.filter((slot) => slot.zone === 'north'),
    east: RESIDENTIAL_SLOTS.filter((slot) => slot.zone === 'east'),
  };
  const lots = [];
  for (let row = 0; lots.length < requested; row += 1) {
    for (const zone of ['west', 'north', 'east']) {
      const slot = zones[zone][row];
      if (slot && lots.length < requested) lots.push({ ...slot, number: lots.length + 1 });
    }
  }
  return lots;
}
