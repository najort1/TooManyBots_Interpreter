import { randomUUID } from 'node:crypto';
import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';

const ANALYTICS_SCHEMA = 'analytics';
const asNumber = (value) => Number(value) || 0;

function mapTrack(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    scopeKey: String(row.scope_key),
    provider: String(row.provider || 'youtube'),
    mediaId: String(row.media_id),
    sourceUrl: String(row.source_url),
    title: String(row.title || ''),
    thumbnailUrl: String(row.thumbnail_url || ''),
    requestedByJid: String(row.requested_by_jid),
    requestedByName: String(row.requested_by_name || ''),
    durationSeconds: asNumber(row.duration_seconds),
    status: String(row.status || 'queued'),
    addedAt: asNumber(row.added_at),
    startedAt: asNumber(row.started_at),
    finishedAt: asNumber(row.finished_at),
    updatedAt: asNumber(row.updated_at),
  };
}

function mapState(row) {
  if (!row) return null;
  return {
    scopeKey: String(row.scope_key),
    currentItemId: String(row.current_item_id || ''),
    startedAt: asNumber(row.started_at),
    revision: asNumber(row.revision),
    updatedAt: asNumber(row.updated_at),
  };
}

export function createFunSoundSystemRepository({ getDatabase = getDb } = {}) {
  const database = () => getDatabase();
  const ensureSchema = () => applyFunSchema(database());

  function ensureState(scopeKey, now = Date.now()) {
    ensureSchema();
    const scope = String(scopeKey || '');
    const timestamp = asNumber(now) || Date.now();
    database().prepare(`INSERT OR IGNORE INTO ${ANALYTICS_SCHEMA}.fun_sound_state (scope_key, updated_at) VALUES (?, ?)`).run(scope, timestamp);
    return getState(scope);
  }

  function getState(scopeKey) {
    ensureSchema();
    return mapState(database().prepare(`SELECT * FROM ${ANALYTICS_SCHEMA}.fun_sound_state WHERE scope_key = ?`).get(String(scopeKey || '')));
  }

  function getTrack(id) {
    ensureSchema();
    return mapTrack(database().prepare(`SELECT * FROM ${ANALYTICS_SCHEMA}.fun_sound_queue WHERE id = ?`).get(String(id || '')));
  }

  function getCurrent(scopeKey) {
    ensureSchema();
    return mapTrack(database().prepare(`
      SELECT q.* FROM ${ANALYTICS_SCHEMA}.fun_sound_queue q
      JOIN ${ANALYTICS_SCHEMA}.fun_sound_state s ON s.current_item_id = q.id
      WHERE s.scope_key = ? AND q.scope_key = ? AND q.status = 'playing'
    `).get(String(scopeKey || ''), String(scopeKey || '')));
  }

  function listActive(scopeKey, limit = 30) {
    ensureSchema();
    return database().prepare(`
      SELECT * FROM ${ANALYTICS_SCHEMA}.fun_sound_queue
      WHERE scope_key = ? AND status IN ('playing', 'queued')
      ORDER BY CASE status WHEN 'playing' THEN 0 ELSE 1 END, added_at ASC, id ASC
      LIMIT ?
    `).all(String(scopeKey || ''), Math.max(1, Math.min(100, Math.floor(limit) || 30))).map(mapTrack).filter(Boolean);
  }

  function appendTrack({ id = randomUUID(), scopeKey, mediaId, sourceUrl, title, thumbnailUrl, requestedByJid, requestedByName, now = Date.now() }) {
    ensureSchema();
    const timestamp = asNumber(now) || Date.now();
    database().prepare(`
      INSERT INTO ${ANALYTICS_SCHEMA}.fun_sound_queue
        (id, scope_key, provider, media_id, source_url, title, thumbnail_url, requested_by_jid, requested_by_name, added_at, updated_at)
      VALUES (?, ?, 'youtube', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(String(id), String(scopeKey), String(mediaId), String(sourceUrl), String(title || ''), String(thumbnailUrl || ''), String(requestedByJid), String(requestedByName || ''), timestamp, timestamp);
    return getTrack(id);
  }

  function startTrack(scopeKey, trackId, now = Date.now()) {
    ensureState(scopeKey, now);
    const timestamp = asNumber(now) || Date.now();
    database().prepare(`UPDATE ${ANALYTICS_SCHEMA}.fun_sound_queue SET status = 'playing', started_at = ?, updated_at = ? WHERE id = ? AND scope_key = ? AND status = 'queued'`).run(timestamp, timestamp, String(trackId), String(scopeKey));
    database().prepare(`UPDATE ${ANALYTICS_SCHEMA}.fun_sound_state SET current_item_id = ?, started_at = ?, revision = revision + 1, updated_at = ? WHERE scope_key = ?`).run(String(trackId), timestamp, timestamp, String(scopeKey));
    return getTrack(trackId);
  }

  function finishCurrent(scopeKey, expectedTrackId, now = Date.now()) {
    ensureState(scopeKey, now);
    const timestamp = asNumber(now) || Date.now();
    const state = getState(scopeKey);
    if (!state?.currentItemId || state.currentItemId !== String(expectedTrackId || '')) return false;
    database().prepare(`UPDATE ${ANALYTICS_SCHEMA}.fun_sound_queue SET status = 'played', finished_at = ?, updated_at = ? WHERE id = ? AND scope_key = ? AND status = 'playing'`).run(timestamp, timestamp, state.currentItemId, String(scopeKey));
    database().prepare(`UPDATE ${ANALYTICS_SCHEMA}.fun_sound_state SET current_item_id = '', started_at = 0, revision = revision + 1, updated_at = ? WHERE scope_key = ?`).run(timestamp, String(scopeKey));
    return true;
  }

  function setDuration(scopeKey, trackId, durationSeconds, now = Date.now()) {
    ensureSchema();
    const duration = Math.max(1, Math.min(6 * 60 * 60, Math.round(Number(durationSeconds) || 0)));
    const result = database().prepare(`UPDATE ${ANALYTICS_SCHEMA}.fun_sound_queue SET duration_seconds = ?, updated_at = ? WHERE id = ? AND scope_key = ? AND status IN ('playing', 'queued')`).run(duration, asNumber(now) || Date.now(), String(trackId), String(scopeKey));
    return result.changes ? getTrack(trackId) : null;
  }

  function nextQueued(scopeKey) {
    ensureSchema();
    return mapTrack(database().prepare(`SELECT * FROM ${ANALYTICS_SCHEMA}.fun_sound_queue WHERE scope_key = ? AND status = 'queued' ORDER BY added_at ASC, id ASC LIMIT 1`).get(String(scopeKey || '')));
  }

  function transaction(operation) {
    ensureSchema();
    return database().transaction(operation)();
  }

  return { ensureSchema, ensureState, getState, getTrack, getCurrent, listActive, appendTrack, startTrack, finishCurrent, setDuration, nextQueued, transaction };
}
