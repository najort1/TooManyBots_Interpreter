import { createHash, randomUUID } from 'node:crypto';

const CHAT_LIMIT = 500;
const SIGNAL_LIMIT = 64 * 1024;
const HISTORY_LIMIT = 20;

function publicId(value) {
  return createHash('sha256').update(String(value)).digest('base64url').slice(0, 16);
}

function sceneKey(scopeKey, scene = 'house', sceneId = 'home') {
  const safeScene = scene === 'street' ? 'street' : 'house';
  return publicId(scopeKey) + ':' + safeScene + ':' + publicId(sceneId || 'home');
}

export function createHouseRealtimeHub({
  now = Date.now,
  collision = () => false,
  positionStore = new Map(),
  streetBounds = { minX: 0, maxX: 100, minY: 0, maxY: 100 },
  houseBounds = { minX: 0, maxX: 5, minY: 0, maxY: 7 },
  maxSpeed = Infinity,
} = {}) {
  const rooms = new Map();
  const sessions = new Map();
  const rates = new Map();
  const tickets = new Map();

  function roomFor(key) {
    if (!rooms.has(key)) rooms.set(key, { seq: 0, clients: new Map(), participants: new Map(), messages: [] });
    return rooms.get(key);
  }
  function consume(id, kind, max, windowMs = 1000) {
    const key = id + ':' + kind;
    const time = now();
    const state = rates.get(key);
    if (!state || time - state.start >= windowMs) { rates.set(key, { start: time, count: 1 }); return true; }
    state.count += 1;
    return state.count <= max;
  }
  function emit(room, type, data, targetParticipantId = null) {
    const event = { v: 1, seq: ++room.seq, roomId: data.roomId, type, ts: now(), data };
    const payload = `id: ${event.seq}\nevent: ${type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const [res, participantId] of room.clients) {
      if (targetParticipantId && participantId !== targetParticipantId) continue;
      try {
        res.write(payload);
      } catch {
        room.clients.delete(res);
      }
    }
    return event;
  }
  function open({ actor, scopeKey, scene, sceneId }) {
    const roomId = sceneKey(scopeKey, scene, sceneId);
    const id = randomUUID();
    const stableParticipantId = publicId(`${scopeKey}:${actor.userJid}`);
    const participantId = `${stableParticipantId}.${randomUUID().slice(0, 8)}`;
    const saved = positionStore.get(`${roomId}:${stableParticipantId}`) || {};
    const session = {
      id, participantId, stableParticipantId, actor, scopeKey, roomId, scene, sceneId,
      x: Number.isFinite(saved.x) ? saved.x : 0,
      y: Number.isFinite(saved.y) ? saved.y : 0,
      direction: saved.direction || 'down',
      clientSeq: Number(saved.clientSeq) || 0,
      movedAt: now(),
      createdAt: now(),
    };
    sessions.set(id, session);
    const room = roomFor(roomId);
    room.participants.set(participantId, session);
    return { session, room };
  }
  function authorize(sessionId, actor) {
    const session = sessions.get(String(sessionId || ''));
    return session && session.actor.userJid === actor.userJid && session.scopeKey === actor.scopeKey ? session : null;
  }
  function attach(session, res) {
    const room = roomFor(session.roomId);
    room.clients.set(res, session.participantId);
    emit(room, 'snapshot', { roomId: session.roomId, selfId: session.participantId, participants: [...room.participants.values()].map(p => ({ id: p.participantId, x: p.x, y: p.y, direction: p.direction })), recentMessages: room.messages });
    emit(room, 'presence', { roomId: session.roomId, action: 'join', participant: { id: session.participantId, x: session.x, y: session.y } });
    return () => room.clients.delete(res);
  }
  function move(session, input) {
    if (!consume(session.id, 'move', 15)) return { ok: false, status: 429, error: 'rate-limit' };
    const x = Number(input.x);
    const y = Number(input.y);
    const clientSeq = Number(input.clientSeq);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, status: 400, error: 'invalid-position' };
    if (!Number.isInteger(clientSeq) || clientSeq <= session.clientSeq) return { ok: false, status: 409, error: 'stale-sequence' };
    const bounds = session.scene === 'street' ? streetBounds : houseBounds;
    if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) return { ok: false, status: 400, error: 'position-out-of-bounds' };
    if (collision({ x, y, scene: session.scene, sceneId: session.sceneId, session })) {
      return { ok: false, status: 409, error: 'collision-blocked' };
    }
    const elapsedSeconds = Math.max(1, now() - session.movedAt) / 1000;
    if (Math.hypot(x - session.x, y - session.y) / elapsedSeconds > maxSpeed) return { ok: false, status: 409, error: 'movement-speed-limit' };
    session.x = x;
    session.y = y;
    session.clientSeq = clientSeq;
    session.movedAt = now();
    positionStore.set(`${session.roomId}:${session.stableParticipantId}`, { x, y, direction: session.direction, clientSeq });
    session.direction = ['up','down','left','right'].includes(input.direction) ? input.direction : session.direction;
    const event = emit(roomFor(session.roomId), 'movement', { roomId: session.roomId, participantId: session.participantId, x: session.x, y: session.y, direction: session.direction, moving: Boolean(input.moving), clientSeq: Number(input.clientSeq) || 0 });
    return { ok: true, event };
  }
  function chat(session, input) {
    if (!consume(session.id, 'chat', 5, 5000)) return { ok: false, status: 429, error: 'rate-limit' };
    const text = String(input.text || '').trim();
    if (!text || text.length > CHAT_LIMIT) return { ok: false, status: 400, error: 'invalid-text' };
    const room = roomFor(session.roomId); const message = { id: randomUUID(), senderId: session.participantId, text, createdAt: now() };
    room.messages.push(message);
    if (room.messages.length > HISTORY_LIMIT) room.messages.shift();
    return { ok: true, event: emit(room, 'chat', { roomId: session.roomId, ...message }) };
  }
  function signal(session, input) {
    if (!consume(session.id, 'signal', 30)) return { ok: false, status: 429, error: 'rate-limit' };
    if (!['offer','answer','ice'].includes(input.kind) || Buffer.byteLength(JSON.stringify(input.payload || null)) > SIGNAL_LIMIT) return { ok: false, status: 400, error: 'invalid-signal' };
    const room = roomFor(session.roomId); if (!room.participants.has(input.toParticipantId)) return { ok: false, status: 404, error: 'peer-not-found' };
    const data = { roomId: session.roomId, fromParticipantId: session.participantId, toParticipantId: input.toParticipantId, kind: input.kind, payload: input.payload };
    return { ok: true, event: emit(room, 'signal', data, input.toParticipantId) };
  }
  function close(session) {
    const room = rooms.get(session.roomId);
    positionStore.set(`${session.roomId}:${session.stableParticipantId}`, {
      x: session.x, y: session.y, direction: session.direction, clientSeq: session.clientSeq,
    });
    sessions.delete(session.id);
    for (const kind of ['move', 'chat', 'signal']) rates.delete(`${session.id}:${kind}`);
    if (!room) return;
    room.participants.delete(session.participantId);
    emit(room, 'presence', {
      roomId: session.roomId, action: 'leave', participant: { id: session.participantId },
    });
    if (!room.clients.size && !room.participants.size) rooms.delete(session.roomId);
  }
  function issueStreamTicket(session, ttlMs = 30_000) {
    const ticket = randomUUID();
    tickets.set(ticket, { sessionId: session.id, expiresAt: now() + ttlMs });
    return ticket;
  }

  function consumeStreamTicket(ticket) {
    const record = tickets.get(String(ticket || ''));
    tickets.delete(String(ticket || ''));
    if (!record || record.expiresAt < now()) return null;
    return sessions.get(record.sessionId) || null;
  }

  return { open, authorize, attach, move, chat, signal, close, issueStreamTicket, consumeStreamTicket, publicId, sceneKey };
}
