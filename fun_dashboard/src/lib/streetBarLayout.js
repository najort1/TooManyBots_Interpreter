export const BAR_DO_PINTO_LAYOUT = Object.freeze({
  centerX: -11.9,
  centerZ: -12.8,
  width: 15.5,
  depth: 5,
  height: 5.6,
  patioWidth: 16.2,
  patioDepth: 7.8,
});

export const BAR_DO_PINTO_PALETTE = Object.freeze({
  wall: 0xf0c83d,
  base: 0xb92e31,
  column: 0xa8242d,
  roof: 0x4e4a4a,
  flagGreen: 0x20804d,
  flagYellow: 0xf2cc38,
  flagDark: 0x25252a,
});

export const BAR_DO_PINTO_TABLES = Object.freeze([
  Object.freeze({ x: -4.8, z: 4.25 }),
  Object.freeze({ x: 0, z: 4.45 }),
  Object.freeze({ x: 4.75, z: 4.2 }),
]);

export const BAR_DO_PINTO_FLAGS = Object.freeze(
  Array.from({ length: 15 }, (_, index) => Object.freeze({
    x: -7 + index,
    color: ['green', 'yellow', 'dark'][index % 3],
  })),
);
