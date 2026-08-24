import test from 'node:test';
import assert from 'node:assert/strict';
import { createHouseRealtimeHub } from '../fun/services/houseRealtimeService.js';

const actor = { userJid: 'u1@s.whatsapp.net', scopeKey: 'group@g.us' };
const open = (hub, scene, sceneId = 'main') => hub.open({ actor, scopeKey: actor.scopeKey, scene, sceneId }).session;

test('realtime movement: casa respeita grid 6x8, colisão e clientSeq crescente', () => {
  const hub = createHouseRealtimeHub({ collision: ({ scene, x, y }) => scene === 'house' && x === 2 && y === 3 });
  const session = open(hub, 'house', 'home');
  assert.equal(hub.move(session, { x: 5, y: 7, clientSeq: 1 }).ok, true);
  assert.match(hub.move(session, { x: 6, y: 7, clientSeq: 2 }).error, /bound|position|limit/i);
  assert.match(hub.move(session, { x: 2, y: 3, clientSeq: 2 }).error, /collision|blocked/i);
  assert.match(hub.move(session, { x: 4, y: 4, clientSeq: 1 }).error, /stale|sequence|seq/i);
  assert.equal(session.x, 5); assert.equal(session.y, 7);
});

test('realtime movement: rua aceita coordenadas além do grid doméstico', () => {
  const hub = createHouseRealtimeHub(); const session = open(hub, 'street');
  assert.equal(hub.move(session, { x: 40, y: 25, clientSeq: 1 }).ok, true);
  assert.equal(session.x, 40); assert.equal(session.y, 25);
});

test('realtime chat: snapshot contém somente as 20 mensagens recentes', () => {
  let now = 0; const hub = createHouseRealtimeHub({ now: () => now }); const session = open(hub, 'street');
  for (let batch=0; batch<5; batch++) { for (let i=0;i<5;i++) assert.equal(hub.chat(session,{text:'m'+(batch*5+i)}).ok,true); now += 5001; }
  const chunks=[]; hub.attach(session,{write:c=>chunks.push(c)});
  const snapshot=JSON.parse(chunks[0].split('data: ')[1].trim());
  assert.equal(snapshot.data.recentMessages.length,20);
  assert.equal(snapshot.data.recentMessages[0].text,'m5');
  assert.equal(snapshot.data.recentMessages[19].text,'m24');
});
