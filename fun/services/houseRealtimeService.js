import { createHash, randomUUID } from 'node:crypto';

const CHAT_LIMIT = 500;
const SIGNAL_LIMIT = 64 * 1024;
const SIGNAL_QUEUE_LIMIT = 128;
const HISTORY_LIMIT = 20;
const STREET_SPAWNS = Object.freeze([
  { x: 42, y: 53 }, { x: 58, y: 53 }, { x: 45, y: 60 }, { x: 55, y: 60 },
  { x: 40, y: 60 }, { x: 60, y: 60 }, { x: 45, y: 67 }, { x: 55, y: 67 },
  { x: 50, y: 69 }, { x: 42, y: 68 }, { x: 58, y: 68 }, { x: 50, y: 62 },
]);
const HOUSE_SPAWN = Object.freeze({ x: 50, y: 80 });

function publicId(value) {
  return createHash('sha256').update(String(value)).digest('base64url').slice(0, 16);
}

function sceneKey(scopeKey, scene = 'house', sceneId = 'home') {
  const safeScene = scene === 'street' ? 'street' : 'house';
  return publicId(scopeKey) + ':' + safeScene + ':' + publicId(sceneId || 'home');
}

function streetSpawn(room, stableParticipantId) {
  let seed = 0;
  for (const character of stableParticipantId) seed = (seed * 31 + character.charCodeAt(0)) >>> 0;
  const occupied = new Set([...room.participants.values()].map((participant) => `${participant.x}:${participant.y}`));
  for (let offset = 0; offset < STREET_SPAWNS.length; offset += 1) {
    const spawn = STREET_SPAWNS[(seed + offset) % STREET_SPAWNS.length];
    if (!occupied.has(`${spawn.x}:${spawn.y}`)) return spawn;
  }
  return STREET_SPAWNS[seed % STREET_SPAWNS.length];
}

export function createHouseRealtimeHub({
  now = Date.now,
  collision = () => false,
  positionStore = new Map(),
  presenceTimeoutMs = 30_000,
  streetBounds = { minX: 0, maxX: 100, minY: 0, maxY: 100 },
  // Both the street and the 3D house client publish normalized coordinates.
  // Keeping one wire format avoids rejecting every house movement outside cell 5,7.
  houseBounds = { minX: 0, maxX: 100, minY: 0, maxY: 100 },
  maxSpeed = Infinity,
} = {}) {
  const rooms = new Map();
  const sessions = new Map();
  const rates = new Map();
  const tickets = new Map();

  function roomFor(key) {
    if (!rooms.has(key)) rooms.set(key, { seq: 0, clients: new Map(), participants: new Map(), messages: [], signalQueues: new Map() });
    return rooms.get(key);
  }
  function hasActiveStream(room, participantId) {
    return [...room.clients.values()].some((clientParticipantId) => clientParticipantId === participantId);
  }
  function expired(session, room) {
    return !hasActiveStream(room, session.participantId)
      && now() - session.lastSeenAt > presenceTimeoutMs;
  }
  function pruneExpired(room, exceptSessionId = '') {
    for (const participant of [...room.participants.values()]) {
      if (participant.id !== exceptSessionId && expired(participant, room)) close(participant);
    }
  }
  function touch(session) {
    session.lastSeenAt = now();
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
  function emitTargetedSignal(room, data, targetParticipantId) {
    const event = { v: 1, seq: ++room.seq, roomId: data.roomId, type: 'signal', ts: now(), data };
    const payloadFor = (recipientId) => {
      const outgoing = recipientId === targetParticipantId
        ? event
        : { ...event, type: 'signal-meta', data: { roomId: data.roomId } };
      return `id: ${outgoing.seq}\nevent: ${outgoing.type}\ndata: ${JSON.stringify(outgoing)}\n\n`;
    };
    for (const [res, participantId] of room.clients) {
      try {
        res.write(payloadFor(participantId));
      } catch {
        room.clients.delete(res);
      }
    }
    return event;
  }
  function open({ actor, scopeKey, scene, sceneId, nickname = 'VIZINHO', avatar = null }) {
    const roomId = sceneKey(scopeKey, scene, sceneId);
    const id = randomUUID();
    const stableParticipantId = publicId(`${scopeKey}:${actor.userJid}`);
    const participantId = `${stableParticipantId}.${randomUUID().slice(0, 8)}`;
    let room = roomFor(roomId);
    pruneExpired(room);
    for (const participant of [...room.participants.values()]) {
      if (participant.stableParticipantId === stableParticipantId) close(participant);
    }
    room = roomFor(roomId);
    const saved = positionStore.get(`${roomId}:${stableParticipantId}`) || {};
    const hasSavedPosition = Number(saved.clientSeq) > 0 && Number.isFinite(saved.x) && Number.isFinite(saved.y);
    const spawn = scene === 'street' ? streetSpawn(room, stableParticipantId) : HOUSE_SPAWN;
    const session = {
      id, participantId, stableParticipantId, actor, scopeKey, roomId, scene, sceneId,
      x: hasSavedPosition ? saved.x : spawn.x,
      y: hasSavedPosition ? saved.y : spawn.y,
      direction: saved.direction || 'down',
      moving: false,
      clientSeq: Number(saved.clientSeq) || 0,
      nickname: String(nickname || 'VIZINHO').trim().slice(0, 40) || 'VIZINHO',
      avatar: sanitizePublicAvatar(avatar),
      movedAt: now(),
      createdAt: now(),
      lastSeenAt: now(),
    };
    sessions.set(id, session);
    room.participants.set(participantId, session);
    return { session, room };
  }
  function authorize(sessionId, actor) {
    const session = sessions.get(String(sessionId || ''));
    if (!session || session.actor.userJid !== actor.userJid || session.scopeKey !== actor.scopeKey) return null;
    const room = rooms.get(session.roomId);
    if (!room || expired(session, room)) {
      close(session);
      return null;
    }
    touch(session);
    pruneExpired(room, session.id);
    return session;
  }
  function publicParticipant(session) {
    return {
      id: session.participantId,
      x: session.x,
      y: session.y,
      direction: session.direction,
      moving: session.moving,
      nickname: session.nickname,
      avatar: session.avatar,
    };
  }
  function attach(session, res) {
    const room = roomFor(session.roomId);
    touch(session);
    room.clients.set(res, session.participantId);
    emit(room, 'snapshot', snapshot(session));
    emit(room, 'presence', { roomId: session.roomId, action: 'join', participant: publicParticipant(session) });
    return () => room.clients.delete(res);
  }
  function snapshot(session) {
    const room = roomFor(session.roomId);
    touch(session);
    pruneExpired(room, session.id);
    return {
      roomId: session.roomId,
      selfId: session.participantId,
      participants: [...room.participants.values()].map(publicParticipant),
      recentMessages: room.messages,
    };
  }
  function poll(session, input = {}) {
    const room = roomFor(session.roomId);
    touch(session);
    pruneExpired(room, session.id);
    const requestedAck = Number(input.afterSignalSeq);
    const acknowledged = Number.isSafeInteger(requestedAck)
      ? Math.max(Number(session.signalAckSeq) || 0, Math.min(requestedAck, room.seq))
      : Number(session.signalAckSeq) || 0;
    session.signalAckSeq = acknowledged;
    const queued = room.signalQueues.get(session.participantId) || [];
    const pending = queued.filter((signal) => signal.seq > acknowledged);
    room.signalQueues.set(session.participantId, pending);
    const signals = pending.slice(0, SIGNAL_QUEUE_LIMIT);
    return {
      snapshot: snapshot(session),
      signals,
      nextSignalSeq: signals.length ? signals.at(-1).seq : acknowledged,
    };
  }
  function updateAvatar(session, avatar) {
    touch(session);
    const next = sanitizePublicAvatar(avatar);
    if (!next || Number(next.revision) <= Number(session.avatar?.revision || 0)) {
      return { ok: false, status: 409, error: 'stale-avatar-revision' };
    }
    session.avatar = next;
    return {
      ok: true,
      event: emit(roomFor(session.roomId), 'avatar', {
        roomId: session.roomId,
        participantId: session.participantId,
        nickname: session.nickname,
        avatar: next,
      }),
    };
  }
  function updateActorAvatar(actor, avatar) {
    const next = sanitizePublicAvatar(avatar);
    if (!next) return { ok: false, updated: 0 };
    let updated = 0;
    for (const session of sessions.values()) {
      if (session.actor.userJid !== actor.userJid || session.scopeKey !== actor.scopeKey) continue;
      const result = updateAvatar(session, next);
      if (result.ok) updated += 1;
    }
    return { ok: true, updated };
  }
  function move(session, input) {
    touch(session);
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
    session.direction = ['up','down','left','right'].includes(input.direction) ? input.direction : session.direction;
    session.moving = Boolean(input.moving);
    session.x = x;
    session.y = y;
    session.clientSeq = clientSeq;
    session.movedAt = now();
    positionStore.set(`${session.roomId}:${session.stableParticipantId}`, { x, y, direction: session.direction, clientSeq });
    const event = emit(roomFor(session.roomId), 'movement', { roomId: session.roomId, participantId: session.participantId, x: session.x, y: session.y, direction: session.direction, moving: session.moving, clientSeq: Number(input.clientSeq) || 0 });
    return { ok: true, event };
  }
  function chat(session, input) {
    touch(session);
    if (!consume(session.id, 'chat', 5, 5000)) return { ok: false, status: 429, error: 'rate-limit' };
    const text = String(input.text || '').trim();
    if (!text || text.length > CHAT_LIMIT) return { ok: false, status: 400, error: 'invalid-text' };
    const room = roomFor(session.roomId); const message = { id: randomUUID(), senderId: session.participantId, nickname: session.nickname, text, createdAt: now() };
    room.messages.push(message);
    if (room.messages.length > HISTORY_LIMIT) room.messages.shift();
    return { ok: true, event: emit(room, 'chat', { roomId: session.roomId, ...message }) };
  }
  function signal(session, input) {
    touch(session);
    if (!consume(session.id, 'signal', 30)) return { ok: false, status: 429, error: 'rate-limit' };
    if (!['offer','answer','ice','ready'].includes(input.kind) || Buffer.byteLength(JSON.stringify(input.payload || null)) > SIGNAL_LIMIT) return { ok: false, status: 400, error: 'invalid-signal' };
    const room = roomFor(session.roomId); if (!room.participants.has(input.toParticipantId)) return { ok: false, status: 404, error: 'peer-not-found' };
    const data = { roomId: session.roomId, fromParticipantId: session.participantId, toParticipantId: input.toParticipantId, kind: input.kind, payload: input.payload };
    const event = emitTargetedSignal(room, data, input.toParticipantId);
    const queue = room.signalQueues.get(input.toParticipantId) || [];
    queue.push({ seq: event.seq, ...data });
    if (queue.length > SIGNAL_QUEUE_LIMIT) queue.splice(0, queue.length - SIGNAL_QUEUE_LIMIT);
    room.signalQueues.set(input.toParticipantId, queue);
    return { ok: true, event };
  }
  function close(session) {
    if (!sessions.has(session.id)) return;
    const room = rooms.get(session.roomId);
    positionStore.set(`${session.roomId}:${session.stableParticipantId}`, {
      x: session.x, y: session.y, direction: session.direction, clientSeq: session.clientSeq,
    });
    sessions.delete(session.id);
    for (const kind of ['move', 'chat', 'signal']) rates.delete(`${session.id}:${kind}`);
    if (!room) return;
    room.participants.delete(session.participantId);
    room.signalQueues.delete(session.participantId);
    emit(room, 'presence', {
      roomId: session.roomId, action: 'leave', participant: { id: session.participantId },
    });
    for (const [res, participantId] of [...room.clients]) {
      if (participantId !== session.participantId) continue;
      room.clients.delete(res);
      try { res.end?.(); } catch {}
    }
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

  return { open, authorize, attach, snapshot, poll, updateAvatar, updateActorAvatar, move, chat, signal, close, issueStreamTicket, consumeStreamTicket, publicId, sceneKey };
}

function sanitizePublicAvatar(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value.slots && typeof value.slots === 'object' && !Array.isArray(value.slots)
    ? value.slots
    : null;
  if (!source) return null;
  const slots = {};
  for (const [slot, itemId] of Object.entries(source)) {
    if (typeof itemId === 'string' && itemId) slots[slot] = itemId;
  }
  return {
    schemaVersion: Number(value.schemaVersion) || 2,
    revision: Math.max(1, Number(value.revision) || 1),
    catalogRevision: Math.max(1, Number(value.catalogRevision) || 1),
    slots,
    level: Math.max(1, Number(value.level) || 1),
  };
}
