import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';

const ANALYTICS_SCHEMA = 'analytics';

/** Semana ISO simplificada: YYYY-Www a partir de UTC. */
export function getWeekKey(now = Date.now()) {
  const d = new Date(Number(now) || Date.now());
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export function createFunSocialRepository({ getDatabase = getDb } = {}) {
  function ensureSchema() {
    applyFunSchema(getDatabase());
  }

  function recordEdge({
    scopeKey,
    fromJid,
    toJid,
    kind,
    now = Date.now(),
    weekKey = getWeekKey(now),
  }) {
    ensureSchema();
    const s = String(scopeKey || '').trim();
    const a = String(fromJid || '').trim();
    const b = String(toJid || '').trim();
    const k = String(kind || 'interact').trim() || 'interact';
    if (!s || !a || !b || a === b) return { ok: false };

    const ts = Number(now) || Date.now();
    const db = getDatabase();
    db.prepare(
      `INSERT INTO ${ANALYTICS_SCHEMA}.fun_social_edges
       (scope_key, from_jid, to_jid, kind, week_key, count, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT(scope_key, from_jid, to_jid, kind, week_key) DO UPDATE SET
         count = count + 1,
         updated_at = excluded.updated_at`
    ).run(s, a, b, k, weekKey, ts);

    return { ok: true, weekKey };
  }

  function listEdgesForWeek(scopeKey, weekKey = getWeekKey()) {
    ensureSchema();
    return getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_social_edges
         WHERE scope_key = ? AND week_key = ?`
      )
      .all(String(scopeKey || ''), String(weekKey || ''))
      .map(row => ({
        scopeKey: String(row.scope_key || ''),
        fromJid: String(row.from_jid || ''),
        toJid: String(row.to_jid || ''),
        kind: String(row.kind || ''),
        weekKey: String(row.week_key || ''),
        count: Number(row.count) || 0,
        updatedAt: Number(row.updated_at) || 0,
      }));
  }

  return {
    getWeekKey,
    recordEdge,
    listEdgesForWeek,
  };
}
