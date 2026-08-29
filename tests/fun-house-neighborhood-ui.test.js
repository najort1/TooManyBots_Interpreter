import test from 'node:test';
import assert from 'node:assert/strict';
import { getVisibleChatMessages } from '../fun_dashboard/src/lib/chatBubblePolicy.js';
import {
  createResidentialLampPosts,
  createResidentialLots,
  RESIDENTIAL_ROADS,
  RESIDENTIAL_SIDEWALKS,
} from '../fun_dashboard/src/lib/streetResidentialLayout.js';
import { EXPANDED_PLAZA_BOUNDS, PLAZA_ACTIVITY_ZONES, PLAZA_MAIN_FORECOURT } from '../fun_dashboard/src/lib/streetPlazaLayout.js';
import {
  BAR_DO_PINTO_FLAGS,
  BAR_DO_PINTO_LAYOUT,
  BAR_DO_PINTO_PALETTE,
  BAR_DO_PINTO_TABLES,
} from '../fun_dashboard/src/lib/streetBarLayout.js';
import {
  SOUND_TRUCK_HORNS,
  SOUND_TRUCK_LAYOUT,
  SOUND_TRUCK_SPEAKERS,
  SOUND_TRUCK_TWEETERS,
} from '../fun_dashboard/src/lib/streetSoundTruckLayout.js';

test('chat do bairro: mensagens expiram pela idade mesmo quando o snapshot é reaplicado', () => {
  const messages = [
    { id: 'old', createdAt: 1_000 },
    { id: 'fresh', createdAt: 7_500 },
  ];

  assert.deepEqual(getVisibleChatMessages(messages, 8_000, 7_000).map((message) => message.id), ['fresh']);
  assert.deepEqual(getVisibleChatMessages(messages, 15_000, 7_000), []);
});

test('vila dos moradores: distribui 29 casas em lotes únicos e legíveis', () => {
  const lots = createResidentialLots(29);
  const positions = new Set(lots.map((lot) => `${lot.x}:${lot.z}`));

  assert.equal(lots.length, 29);
  assert.equal(positions.size, 29);
  assert.deepEqual(new Set(lots.map((lot) => lot.zone)), new Set(['west', 'north', 'east']));
  assert.ok(lots.every((lot) => Number.isInteger(lot.number) && lot.number >= 1));
});

test('vila dos moradores: postes ficam nos passeios e fora das avenidas', () => {
  const lamps = createResidentialLampPosts();
  const contains = (area, point) => (
    Math.abs(point.x - area.x) <= area.width / 2
    && Math.abs(point.z - area.z) <= area.depth / 2
  );

  assert.equal(lamps.length, 6);
  assert.ok(lamps.every((lamp) => RESIDENTIAL_SIDEWALKS.some((sidewalk) => (
    sidewalk.id === lamp.sidewalk && contains(sidewalk, lamp)
  ))));
  assert.ok(lamps.every((lamp) => RESIDENTIAL_ROADS.every((road) => !contains(road, lamp))));
});

test('praça ampliada: jardim e quadra ocupam o miolo sem invadir as ruas', () => {
  const { minX, maxX, minZ, maxZ } = EXPANDED_PLAZA_BOUNDS;

  assert.deepEqual(EXPANDED_PLAZA_BOUNDS, { minX: -27.5, maxX: 27.5, minZ: 9, maxZ: 51.5 });
  assert.deepEqual(PLAZA_ACTIVITY_ZONES.map((zone) => zone.id), ['picnic-garden', 'community-court']);
  assert.ok(PLAZA_ACTIVITY_ZONES.every((zone) => (
    zone.x - zone.width / 2 >= minX
    && zone.x + zone.width / 2 <= maxX
    && zone.z - zone.depth / 2 >= minZ
    && zone.z + zone.depth / 2 <= maxZ
  )));
});

test('praça principal: o piso cobre todo o antigo gramado ao redor da fonte', () => {
  const forecourt = PLAZA_MAIN_FORECOURT;

  assert.deepEqual(forecourt, { x: 0, z: 20.75, width: 50, depth: 23.5 });
  assert.equal(forecourt.x - forecourt.width / 2, -25);
  assert.equal(forecourt.x + forecourt.width / 2, 25);
  assert.equal(forecourt.z - forecourt.depth / 2, 9);
  assert.equal(forecourt.z + forecourt.depth / 2, 32.5);
});

test('carro de som: paredão mantém a composição da picape de referência', () => {
  assert.ok(SOUND_TRUCK_LAYOUT.length > SOUND_TRUCK_LAYOUT.width);
  assert.ok(SOUND_TRUCK_LAYOUT.wallHeight > 4);
  assert.equal(SOUND_TRUCK_SPEAKERS.filter((speaker) => speaker.kind === 'side').length, 4);
  assert.equal(SOUND_TRUCK_SPEAKERS.filter((speaker) => speaker.kind === 'upper').length, 3);
  assert.equal(SOUND_TRUCK_SPEAKERS.filter((speaker) => speaker.kind === 'subwoofer').length, 2);
  assert.equal(SOUND_TRUCK_TWEETERS.length, 4);
  assert.equal(SOUND_TRUCK_HORNS.length, 4);
});

test('Bar do Pinto: ocupa o espaço livre com os elementos das fotos', () => {
  assert.equal(BAR_DO_PINTO_LAYOUT.width, 15.5);
  assert.ok(BAR_DO_PINTO_LAYOUT.patioWidth > BAR_DO_PINTO_LAYOUT.width);
  assert.equal(BAR_DO_PINTO_TABLES.length, 3);
  assert.equal(BAR_DO_PINTO_FLAGS.length, 15);
  assert.deepEqual(
    [BAR_DO_PINTO_PALETTE.wall, BAR_DO_PINTO_PALETTE.base],
    [0xf0c83d, 0xb92e31],
  );
  assert.ok(BAR_DO_PINTO_LAYOUT.centerX + BAR_DO_PINTO_LAYOUT.width / 2 < -3.75);
});
