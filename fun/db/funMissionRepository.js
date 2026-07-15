import { randomUUID } from 'node:crypto';
import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';

const ANALYTICS_SCHEMA = 'analytics';

function parseJson(text, fallback) {
  try {
    return JSON.parse(String(text || ''));
  } catch {
    return fallback;
  }
}

function mapMission(row) {
  if (!row) return null;
  return {
    id: String(row.id || ''),
    scopeKey: String(row.scope_key || ''),
    status: String(row.status || 'active'),
    members: parseJson(row.members_json, []),
    goals: parseJson(row.goals_json, []),
    progress: parseJson(row.progress_json, {}),
    rewardEach: Number(row.reward_each) || 30,
    expiresAt: Number(row.expires_at) || 0,
    createdAt: Number(row.created_at) || 0,
    completedAt: row.completed_at == null ? null : Number(row.completed_at),
  };
}

export function createFunMissionRepository({ getDatabase = getDb } = {}) {
  function ensureSchema() {
    applyFunSchema(getDatabase());
  }

  function getActive(scopeKey, now = Date.now()) {
    ensureSchema();
    expireStale(scopeKey, now);
    const row = getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_mixed_missions
         WHERE scope_key = ? AND status = 'active' AND expires_at >= ?
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(String(scopeKey || ''), Number(now) || Date.now());
    return mapMission(row);
  }

  function getById(id) {
    ensureSchema();
    const row = getDatabase()
      .prepare(`SELECT * FROM ${ANALYTICS_SCHEMA}.fun_mixed_missions WHERE id = ?`)
      .get(String(id || ''));
    return mapMission(row);
  }

  function expireStale(scopeKey, now = Date.now()) {
    ensureSchema();
    getDatabase()
      .prepare(
        `UPDATE ${ANALYTICS_SCHEMA}.fun_mixed_missions
         SET status = 'failed'
         WHERE scope_key = ? AND status = 'active' AND expires_at < ?`
      )
      .run(String(scopeKey || ''), Number(now) || Date.now());
  }

  function createMission({
    scopeKey,
    members,
    goals,
    rewardEach = 30,
    durationMs = 12 * 60 * 60_000,
    now = Date.now(),
  }) {
    ensureSchema();
    const db = getDatabase();
    const s = String(scopeKey || '').trim();
    const ts = Number(now) || Date.now();
    const id = randomUUID();
    const expiresAt = ts + Math.max(60_000, Math.floor(Number(durationMs) || 0));

    // encerra missão ativa anterior como failed/replaced
    db.prepare(
      `UPDATE ${ANALYTICS_SCHEMA}.fun_mixed_missions
       SET status = 'replaced'
       WHERE scope_key = ? AND status = 'active'`
    ).run(s);

    db.prepare(
      `INSERT INTO ${ANALYTICS_SCHEMA}.fun_mixed_missions
       (id, scope_key, status, members_json, goals_json, progress_json, reward_each, expires_at, created_at, completed_at)
       VALUES (?, ?, 'active', ?, ?, '{}', ?, ?, ?, NULL)`
    ).run(
      id,
      s,
      JSON.stringify(members || []),
      JSON.stringify(goals || []),
      Math.floor(Number(rewardEach) || 30),
      expiresAt,
      ts
    );

    return getById(id);
  }

  function updateProgress(id, progress, now = Date.now()) {
    ensureSchema();
    getDatabase()
      .prepare(
        `UPDATE ${ANALYTICS_SCHEMA}.fun_mixed_missions
         SET progress_json = ?
         WHERE id = ? AND status = 'active'`
      )
      .run(JSON.stringify(progress || {}), String(id || ''));
    return getById(id);
  }

  function complete(id, now = Date.now()) {
    ensureSchema();
    getDatabase()
      .prepare(
        `UPDATE ${ANALYTICS_SCHEMA}.fun_mixed_missions
         SET status = 'completed', completed_at = ?
         WHERE id = ? AND status = 'active'`
      )
      .run(Number(now) || Date.now(), String(id || ''));
    return getById(id);
  }

  function fail(id) {
    ensureSchema();
    getDatabase()
      .prepare(
        `UPDATE ${ANALYTICS_SCHEMA}.fun_mixed_missions
         SET status = 'failed'
         WHERE id = ? AND status = 'active'`
      )
      .run(String(id || ''));
    return getById(id);
  }

  return {
    getActive,
    getById,
    createMission,
    updateProgress,
    complete,
    fail,
    expireStale,
  };
}
