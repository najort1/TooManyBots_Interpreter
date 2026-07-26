import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';

const ANALYTICS_SCHEMA = 'analytics';

/**
 * Snapshot diário do jornal "The Group Times".
 * Guarda um resumo estruturado por dia/escopo para alimentar:
 *  - Memória histórica ("maior assalto dos últimos 30 dias")
 *  - Personalidade do grupo (mood dominante nos últimos 7 dias)
 *  - Comparações cross-day ("X dias sem divórcio", "3º dia de crime alto")
 *
 * 1 linha por (scope_key, day_key). Prune recomendado ~60 dias (pequeno).
 */
export function createFunSnapshotRepository({ getDatabase = getDb } = {}) {
  function ensureSchema() {
    applyFunSchema(getDatabase());
  }

  function saveSnapshot({ scopeKey, dayKey, payload = {}, now = Date.now() }) {
    ensureSchema();
    const s = String(scopeKey || '');
    const d = String(dayKey || '');
    if (!s || !d) return { ok: false, reason: 'invalid' };
    const ts = Number(now) || Date.now();
    getDatabase()
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_daily_snapshot
         (scope_key, day_key, payload_json, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(scope_key, day_key) DO UPDATE SET
           payload_json = excluded.payload_json,
           created_at = excluded.created_at`
      )
      .run(s, d, JSON.stringify(payload || {}), ts);
    return { ok: true, scopeKey: s, dayKey: d };
  }

  function getSnapshot(scopeKey, dayKey) {
    ensureSchema();
    const row = getDatabase()
      .prepare(
        `SELECT payload_json, created_at FROM ${ANALYTICS_SCHEMA}.fun_daily_snapshot
         WHERE scope_key = ? AND day_key = ?`
      )
      .get(String(scopeKey || ''), String(dayKey || ''));
    if (!row) return null;
    let payload = {};
    try {
      payload = JSON.parse(String(row.payload_json || '{}')) || {};
    } catch {
      payload = {};
    }
    return { scopeKey, dayKey, payload, createdAt: Number(row.created_at) || 0 };
  }

  function getLastSnapshot(scopeKey) {
    ensureSchema();
    const row = getDatabase()
      .prepare(
        `SELECT day_key, payload_json, created_at FROM ${ANALYTICS_SCHEMA}.fun_daily_snapshot
         WHERE scope_key = ?
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(String(scopeKey || ''));
    if (!row) return null;
    let payload = {};
    try {
      payload = JSON.parse(String(row.payload_json || '{}')) || {};
    } catch {
      payload = {};
    }
    return {
      scopeKey,
      dayKey: String(row.day_key || ''),
      payload,
      createdAt: Number(row.created_at) || 0,
    };
  }

  /**
   * Lista snapshots do escopo desde um timestamp (ms), em ordem DESC (mais novo primeiro).
   * @returns {Array<{ scopeKey, dayKey, payload, createdAt }>}
   */
  function listSnapshotsSince(scopeKey, sinceMs, limit = 60) {
    ensureSchema();
    const lim = Math.max(1, Math.min(120, Math.floor(Number(limit) || 60)));
    const rows = getDatabase()
      .prepare(
        `SELECT day_key, payload_json, created_at FROM ${ANALYTICS_SCHEMA}.fun_daily_snapshot
         WHERE scope_key = ? AND created_at >= ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(String(scopeKey || ''), Number(sinceMs) || 0, lim);
    return rows.map((r) => {
      let payload = {};
      try {
        payload = JSON.parse(String(r.payload_json || '{}')) || {};
      } catch {
        payload = {};
      }
      return {
        scopeKey: String(scopeKey || ''),
        dayKey: String(r.day_key || ''),
        payload,
        createdAt: Number(r.created_at) || 0,
      };
    });
  }

  /**
   * Histórico de moods (mais novo → mais velho) para inferir personalidade do grupo.
   * @returns {Array<{ dayKey, mood, createdAt }>}
   */
  function getMoodHistory(scopeKey, limit = 7) {
    const snaps = listSnapshotsSince(scopeKey, 0, limit);
    return snaps.map((s) => ({
      dayKey: s.dayKey,
      mood: String(s.payload?.mood || 'medio'),
      createdAt: s.createdAt,
    }));
  }

  function pruneOlderThan(scopeKey, beforeMs) {
    ensureSchema();
    getDatabase()
      .prepare(
        `DELETE FROM ${ANALYTICS_SCHEMA}.fun_daily_snapshot
         WHERE scope_key = ? AND created_at < ?`
      )
      .run(String(scopeKey || ''), Number(beforeMs) || 0);
  }

  return {
    saveSnapshot,
    getSnapshot,
    getLastSnapshot,
    listSnapshotsSince,
    getMoodHistory,
    pruneOlderThan,
  };
}
