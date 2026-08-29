export const SOUND_TRUCK_LAYOUT = Object.freeze({
  length: 6.4,
  width: 2.55,
  wallWidth: 5.1,
  wallHeight: 4.25,
  wallX: 1.05,
  wallY: 3.15,
});

export const SOUND_TRUCK_SPEAKERS = Object.freeze([
  Object.freeze({ kind: 'side', x: -2.05, y: 1.08, radius: .4, color: 0x42e8ff }),
  Object.freeze({ kind: 'side', x: -2.05, y: .18, radius: .4, color: 0x3e8cff }),
  Object.freeze({ kind: 'side', x: 2.05, y: 1.08, radius: .4, color: 0xff49dc }),
  Object.freeze({ kind: 'side', x: 2.05, y: .18, radius: .4, color: 0x7a65ff }),
  Object.freeze({ kind: 'upper', x: -1.28, y: 1.48, radius: .43, color: 0x42e8ff }),
  Object.freeze({ kind: 'upper', x: 0, y: 1.48, radius: .43, color: 0x4ba8ff }),
  Object.freeze({ kind: 'upper', x: 1.28, y: 1.48, radius: .43, color: 0xff49dc }),
  Object.freeze({ kind: 'subwoofer', x: -.82, y: -1.17, radius: .73, color: 0x277cff }),
  Object.freeze({ kind: 'subwoofer', x: .82, y: -1.17, radius: .73, color: 0x36f0cf }),
]);

export const SOUND_TRUCK_TWEETERS = Object.freeze([
  Object.freeze({ x: -.66, y: 1.62 }),
  Object.freeze({ x: -.66, y: 1.22 }),
  Object.freeze({ x: .66, y: 1.62 }),
  Object.freeze({ x: .66, y: 1.22 }),
]);

export const SOUND_TRUCK_HORNS = Object.freeze(
  [-1.2, -.4, .4, 1.2].map((x) => Object.freeze({ x, y: -.02 })),
);
