import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';

const ANALYTICS_SCHEMA = 'analytics';

function mapEvent(row) {
  if (!row) {
    return {
      scopeKey: '',
      eventType: 'none',
      multiplier: 1,
      startsAt: 0,
      endsAt: 0,
      lastSpawnAt: 0,
      payload: {},
    };
  }
  let payload = {};
  try {
    payload = JSON.parse(String(row.payload_json || '{}'));
  } catch {
    payload = {};
  }
  return {
    scopeKey: String(row.scope_key || ''),
    eventType: String(row.event_type || 'none'),
    multiplier: Number(row.multiplier) || 1,
    startsAt: Number(row.starts_at) || 0,
    endsAt: Number(row.ends_at) || 0,
    lastSpawnAt: Number(row.last_spawn_at) || 0,
    payload,
  };
}

export function createFunEventRepository({ getDatabase = getDb } = {}) {
  function ensureSchema() {
    applyFunSchema(getDatabase());
  }

  function get(scopeKey) {
    ensureSchema();
    const row = getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_scope_events WHERE scope_key = ?`
      )
      .get(String(scopeKey || ''));
    const event = mapEvent(row);
    event.scopeKey = String(scopeKey || '');
    return event;
  }

  function upsert(scopeKey, patch = {}) {
    ensureSchema();
    const current = get(scopeKey);
    const next = {
      eventType: patch.eventType ?? current.eventType,
      multiplier: patch.multiplier ?? current.multiplier,
      startsAt: patch.startsAt ?? current.startsAt,
      endsAt: patch.endsAt ?? current.endsAt,
      lastSpawnAt: patch.lastSpawnAt ?? current.lastSpawnAt,
      payload: patch.payload ?? current.payload,
    };
    getDatabase()
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_scope_events
         (scope_key, event_type, multiplier, starts_at, ends_at, last_spawn_at, payload_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(scope_key) DO UPDATE SET
           event_type = excluded.event_type,
           multiplier = excluded.multiplier,
           starts_at = excluded.starts_at,
           ends_at = excluded.ends_at,
           last_spawn_at = excluded.last_spawn_at,
           payload_json = excluded.payload_json`
      )
      .run(
        String(scopeKey || ''),
        String(next.eventType || 'none'),
        Number(next.multiplier) || 1,
        Number(next.startsAt) || 0,
        Number(next.endsAt) || 0,
        Number(next.lastSpawnAt) || 0,
        JSON.stringify(next.payload || {})
      );
    return get(scopeKey);
  }

  return {
    get,
    upsert,
  };
}
