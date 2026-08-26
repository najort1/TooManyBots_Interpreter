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
  assert.equal(hub.signal(a.session, { toParticipantId: b.session.participantId, kind: 'ready', payload: null }).ok, true);
  const parse = chunks => chunks.filter(x=>x.startsWith('id:')).map(x=>JSON.parse(x.split('data: ')[1].trim()));
  const eventsA=parse(chunksA), eventsB=parse(chunksB), eventsC=parse(chunksC);
  assert.ok(eventsA.every(e=>e.v===1 && e.roomId===a.session.roomId));
  assert.ok(eventsA.some(e=>e.type==='movement') && eventsA.some(e=>e.type==='chat'));
  assert.equal(eventsA.some(e=>e.type==='signal'),false);
  assert.equal(eventsC.some(e=>e.type==='signal'),false);
  assert.equal(eventsA.filter(e=>e.type==='signal-meta').length,2);
  assert.ok(eventsA.filter(e=>e.type==='signal-meta').every(event=>Object.keys(event.data).length===1 && event.data.roomId===a.session.roomId));
  const signalsB=eventsB.filter(e=>e.type==='signal'); assert.equal(signalsB.length,2);
  assert.ok(signalsB.every(signal=>signal.data.toParticipantId===b.session.participantId));
  assert.equal(signalsB.find(signal=>signal.data.kind==='offer').data.payload.sdp,'v=0');
  assert.equal(signalsB.find(signal=>signal.data.kind==='ready').data.payload,null);
  assert.ok(eventsA.every((e,i,all)=>i===0 || e.seq>all[i-1].seq)); detaches.forEach(fn=>fn());
});

test('realtime: polling devolve e confirma somente sinais destinados à sessão', () => {
  const hub = createHouseRealtimeHub();
  const a = open(hub, 'poll-a@s.whatsapp.net');
  const b = open(hub, 'poll-b@s.whatsapp.net');
  const c = open(hub, 'poll-c@s.whatsapp.net');

  assert.equal(hub.signal(a.session, { toParticipantId: b.session.participantId, kind: 'offer', payload: { sdp: 'v=0' } }).ok, true);
  assert.equal(hub.signal(c.session, { toParticipantId: b.session.participantId, kind: 'ice', payload: { candidate: 'candidate:1' } }).ok, true);
  const firstPoll = hub.poll(b.session, { afterSignalSeq: 0 });
  assert.deepEqual(firstPoll.signals.map((signal) => signal.kind), ['offer', 'ice']);
  assert.ok(firstPoll.signals.every((signal) => signal.toParticipantId === b.session.participantId));

  const acknowledged = hub.poll(b.session, { afterSignalSeq: firstPoll.nextSignalSeq });
  assert.deepEqual(acknowledged.signals, []);
  assert.deepEqual(hub.poll(a.session, { afterSignalSeq: 0 }).signals, []);
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

test('realtime: novos moradores do bairro recebem pontos de entrada distintos', () => {
  const hub = createHouseRealtimeHub();
  const alice = open(hub, 'alice@s.whatsapp.net');
  const bruno = open(hub, 'bruno@s.whatsapp.net');

  assert.notDeepEqual({ x: alice.session.x, y: alice.session.y }, { x: bruno.session.x, y: bruno.session.y });
  for (const participant of [alice.session, bruno.session]) {
    assert.ok(participant.x >= 0 && participant.x <= 100);
    assert.ok(participant.y >= 0 && participant.y <= 100);
  }
});

test('realtime: snapshot autenticado lista somente participantes da mesma sala', () => {
  const hub = createHouseRealtimeHub();
  const alice = open(hub, 'alice@s.whatsapp.net');
  const bruno = open(hub, 'bruno@s.whatsapp.net');
  const outraSala = open(hub, 'carla@s.whatsapp.net', 'other@g.us');
  const snapshot = hub.snapshot(alice.session);

  assert.equal(snapshot.selfId, alice.session.participantId);
  assert.deepEqual(snapshot.participants.map((participant) => participant.id).sort(), [alice.session.participantId, bruno.session.participantId].sort());
  assert.equal(snapshot.participants.some((participant) => participant.id === outraSala.session.participantId), false);
});

test('realtime avatar: snapshot usa aparência de cada participante e update rejeita revisão antiga', () => {
  const hub = createHouseRealtimeHub();
  const avatar = (revision, body) => ({
    schemaVersion: 2,
    revision,
    catalogRevision: 1,
    level: 4,
    slots: { body, skinTone: 'skin_warm', face: 'face_beco', hair: 'hair_short', top: 'camiseta_beco', bottom: 'bottom_beco', shoes: 'shoes_beco', headAccessory: 'none', faceAccessory: 'none', neckAccessory: 'none', backAccessory: 'none', waistAccessory: 'none' },
    coins: 999,
    unlocked: ['segredo'],
  });
  const a = hub.open({ actor: actor('a@s.whatsapp.net'), scopeKey: 'group@g.us', scene: 'street', sceneId: 'main', nickname: 'Alice', avatar: avatar(3, 'corpo_beca') });
  const b = hub.open({ actor: actor('b@s.whatsapp.net'), scopeKey: 'group@g.us', scene: 'street', sceneId: 'main', nickname: 'Beto', avatar: avatar(2, 'corpo_beco') });
  const chunks = [];
  hub.attach(b.session, { write: (chunk) => chunks.push(chunk) });
  const snapshot = chunks.map((chunk) => chunk.startsWith('id:') ? JSON.parse(chunk.split('data: ')[1].trim()) : null).find((event) => event?.type === 'snapshot');
  const alice = snapshot.data.participants.find((participant) => participant.id === a.session.participantId);
  assert.equal(alice.nickname, 'Alice');
  assert.equal(alice.avatar.revision, 3);
  assert.equal(alice.avatar.slots.body, 'corpo_beca');
  assert.equal('coins' in alice.avatar, false);
  assert.equal('unlocked' in alice.avatar, false);

  assert.equal(hub.updateAvatar(a.session, avatar(3, 'corpo_neutro')).error, 'stale-avatar-revision');
  const updated = hub.updateActorAvatar(actor('a@s.whatsapp.net'), avatar(4, 'corpo_neutro'));
  assert.equal(updated.updated, 1);
  assert.ok(chunks.some((chunk) => chunk.includes('event: avatar') && chunk.includes('"revision":4') && chunk.includes('corpo_neutro')));
});
