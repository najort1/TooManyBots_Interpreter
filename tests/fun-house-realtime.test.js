import test from 'node:test';
import assert from 'node:assert/strict';
import { createHouseRealtimeHub } from '../fun/services/houseRealtimeService.js';

const actor = (userJid, scopeKey = 'group@g.us') => ({ userJid, scopeKey });
const open = (hub, userJid, scopeKey = 'group@g.us', scene = 'street', sceneId = 'main') => hub.open({ actor: actor(userJid, scopeKey), scopeKey, scene, sceneId });

test('realtime: envelope v1 ordenado e signal chega somente ao destinatário', () => {
  let now = 1000; const hub = createHouseRealtimeHub({ now: () => ++now });
  const a = open(hub, 'a@s.whatsapp.net'); const b = open(hub, 'b@s.whatsapp.net'); const c = open(hub, 'c@s.whatsapp.net');
  const chunksA = [], chunksB = [], chunksC = [];
  const detaches = [hub.attach(a.session,{write:x=>chunksA.push(x)}), hub.attach(b.session,{write:x=>chunksB.push(x)}), hub.attach(c.session,{write:x=>chunksC.push(x)})];
  assert.equal(hub.move(a.session, { x: 2, y: 3, direction: 'right', clientSeq: 1 }).ok, true);
  assert.equal(hub.chat(a.session, { text: 'olá' }).ok, true);
  assert.equal(hub.signal(a.session, { toParticipantId: b.session.participantId, kind: 'offer', payload: { sdp: 'v=0' } }).ok, true);
  const parse = chunks => chunks.filter(x=>x.startsWith('id:')).map(x=>JSON.parse(x.split('data: ')[1].trim()));
  const eventsA=parse(chunksA), eventsB=parse(chunksB), eventsC=parse(chunksC);
  assert.ok(eventsA.every(e=>e.v===1 && e.roomId===a.session.roomId));
  assert.ok(eventsA.some(e=>e.type==='movement') && eventsA.some(e=>e.type==='chat'));
  assert.equal(eventsA.some(e=>e.type==='signal'),false);
  assert.equal(eventsC.some(e=>e.type==='signal'),false);
  const signalsB=eventsB.filter(e=>e.type==='signal'); assert.equal(signalsB.length,1);
  assert.equal(signalsB[0].data.toParticipantId,b.session.participantId); assert.equal(signalsB[0].data.payload.sdp,'v=0');
  assert.ok(eventsA.every((e,i,all)=>i===0 || e.seq>all[i-1].seq)); detaches.forEach(fn=>fn());
});

test('realtime security: autorização vincula session, ator e escopo sem expor JID no roomId', () => {
  const hub = createHouseRealtimeHub(); const { session } = open(hub, '551199@s.whatsapp.net');
  assert.equal(hub.authorize(session.id, actor('551199@s.whatsapp.net')), session);
  assert.equal(hub.authorize(session.id, actor('attacker@s.whatsapp.net')), null);
  assert.equal(hub.authorize(session.id, actor('551199@s.whatsapp.net', 'other@g.us')), null);
  assert.doesNotMatch(session.roomId, /551199|group@g.us|s.whatsapp/);
});

test('realtime security: isola salas, limita payload e flood, e cleanup revoga peer', () => {
  let now = 1000; const hub = createHouseRealtimeHub({ now: () => now });
  const a = open(hub, 'a@s.whatsapp.net'); const b = open(hub, 'b@s.whatsapp.net'); const other = open(hub, 'c@s.whatsapp.net', 'other@g.us');
  assert.equal(hub.signal(a.session, { toParticipantId: other.session.participantId, kind: 'offer', payload: {} }).error, 'peer-not-found');
  assert.equal(hub.signal(a.session, { toParticipantId: b.session.participantId, kind: 'offer', payload: { sdp: 'x'.repeat(70_000) } }).error, 'invalid-signal');
  for (let i=0;i<5;i++) assert.equal(hub.chat(a.session,{text:'m'+i}).ok,true);
  assert.equal(hub.chat(a.session,{text:'spam'}).status,429);
  now += 5001; assert.equal(hub.chat(a.session,{text:'ok'}).ok,true);
  hub.close(b.session);
  assert.equal(hub.signal(a.session,{toParticipantId:b.session.participantId,kind:'ice',payload:{candidate:'x'}}).error,'peer-not-found');
});

test('realtime security: ticket bearer é single-use, expira e falha após sessão fechada', () => {
  let now=1000; const hub=createHouseRealtimeHub({now:()=>now}); const {session}=open(hub,'ticket@s.whatsapp.net');
  const stolen=hub.issueStreamTicket(session,30000); assert.equal(hub.consumeStreamTicket(stolen),session);
  assert.equal(hub.consumeStreamTicket(stolen),null);
  const expired=hub.issueStreamTicket(session,30000); now+=30001; assert.equal(hub.consumeStreamTicket(expired),null);
  const closed=hub.issueStreamTicket(session,30000); hub.close(session); assert.equal(hub.consumeStreamTicket(closed),null);
});

test('realtime: close emite leave e remove stream sem afetar outra sala', () => {
  const hub = createHouseRealtimeHub(); const a=open(hub,'a@s.whatsapp.net'); const other=open(hub,'b@s.whatsapp.net','other@g.us');
  const chunks=[]; hub.attach(a.session,{write:c=>chunks.push(c)}); hub.close(a.session);
  assert.ok(chunks.some(c=>c.includes('event: presence') && c.includes('"action":"leave"')));
  assert.ok(hub.authorize(other.session.id, actor('b@s.whatsapp.net','other@g.us')));
});
