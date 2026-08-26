import test from 'node:test';
import assert from 'node:assert/strict';
import { createHouseRealtimeHub } from '../fun/services/houseRealtimeService.js';

const actor = { userJid: 'u1@s.whatsapp.net', scopeKey: 'group@g.us' };
const open = (hub, scene, sceneId = 'main') => hub.open({ actor, scopeKey: actor.scopeKey, scene, sceneId }).session;

test('realtime movement: casa aceita a escala normalizada do cliente 3D, colisão e clientSeq crescente', () => {
  const hub = createHouseRealtimeHub({ collision: ({ scene, x, y }) => scene === 'house' && x === 20 && y === 30 });
  const session = open(hub, 'house', 'home');
  assert.equal(hub.move(session, { x: 50, y: 50, clientSeq: 1 }).ok, true);
  assert.match(hub.move(session, { x: 101, y: 50, clientSeq: 2 }).error, /bound|position|limit/i);
  assert.match(hub.move(session, { x: 20, y: 30, clientSeq: 2 }).error, /collision|blocked/i);
  assert.match(hub.move(session, { x: 40, y: 40, clientSeq: 1 }).error, /stale|sequence|seq/i);
  assert.equal(session.x, 50); assert.equal(session.y, 50);
});

test('realtime movement: rua aceita coordenadas além do grid doméstico', () => {
  const hub = createHouseRealtimeHub(); const session = open(hub, 'street');
  assert.equal(hub.move(session, { x: 40, y: 25, clientSeq: 1 }).ok, true);
  assert.equal(session.x, 40); assert.equal(session.y, 25);
});

test('realtime movement: casa inicia no mesmo ponto normalizado do renderer 3D', () => {
  const hub = createHouseRealtimeHub();
  const session = open(hub, 'house');
  assert.deepEqual({ x: session.x, y: session.y }, { x: 50, y: 80 });
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
