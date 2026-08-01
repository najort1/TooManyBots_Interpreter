import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';

const ANALYTICS_SCHEMA = 'analytics';

function mapRow(row) {
  if (!row) return null;
  return {
    scopeKey: String(row.scope_key || ''),
    userJid: String(row.user_jid || ''),
    count: Number(row.count) || 0,
    lastAt: Number(row.last_at) || 0,
  };
}

/**
 * Persistência do ranking de despedidas (contador por usuário+grupo).
 * Tabela `analytics.fun_farewells` (criada em fun/schema.js).
 */
export function createFunFarewellRepository({ getDatabase = getDb } = {}) {
  function ensureSchema() {
    applyFunSchema(getDatabase());
  }

  /** Incrementa (ou cria) o contador de despedidas do usuário no grupo. */
  function recordFarewell({ scopeKey, userJid, now = Date.now() }) {
    ensureSchema();
    const s = String(scopeKey || '');
    const u = String(userJid || '');
    if (!s || !u) return null;
    const ts = Number(now) || Date.now();
    getDatabase()
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_farewells
           (scope_key, user_jid, count, last_at)
         VALUES (?, ?, 1, ?)
         ON CONFLICT(scope_key, user_jid) DO UPDATE SET
           count = count + 1,
           last_at = excluded.last_at`
      )
      .run(s, u, ts);
    return getCount(s, u);
  }

  function getCount(scopeKey, userJid) {
    ensureSchema();
    const s = String(scopeKey || '');
    const u = String(userJid || '');
    const row = getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_farewells
         WHERE scope_key = ? AND user_jid = ?`
      )
      .get(s, u);
    return mapRow(row) || { scopeKey: s, userJid: u, count: 0, lastAt: 0 };
  }

  /** Lista ranking de despedidas do grupo (decrescente por count). */
  function listRanking(scopeKey, limit = 10) {
    ensureSchema();
    const rows = getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_farewells
         WHERE scope_key = ?
         ORDER BY count DESC, last_at ASC
         LIMIT ?`
      )
      .all(String(scopeKey || ''), Math.max(1, Math.min(50, Number(limit) || 10)));
    return rows.map(mapRow).filter(Boolean);
  }

  /** Total de despedidas registradas no grupo (soma de todos os usuários). */
  function totalByGroup(scopeKey) {
    ensureSchema();
    const row = getDatabase()
      .prepare(
        `SELECT COALESCE(SUM(count), 0) AS n FROM ${ANALYTICS_SCHEMA}.fun_farewells
         WHERE scope_key = ?`
      )
      .get(String(scopeKey || ''));
    return Number(row?.n) || 0;
  }

  return {
    recordFarewell,
    getCount,
    listRanking,
    totalByGroup,
  };
}
