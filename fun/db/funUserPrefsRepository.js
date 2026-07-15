import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';

const ANALYTICS_SCHEMA = 'analytics';

export function createFunUserPrefsRepository({ getDatabase = getDb } = {}) {
  function ensureSchema() {
    applyFunSchema(getDatabase());
  }

  function get(userJid) {
    ensureSchema();
    const row = getDatabase()
      .prepare(`SELECT * FROM ${ANALYTICS_SCHEMA}.fun_user_prefs WHERE user_jid = ?`)
      .get(String(userJid || ''));
    if (!row) {
      return {
        userJid: String(userJid || ''),
        preferredScopeKey: '',
        lastGroupJid: '',
        updatedAt: 0,
      };
    }
    return {
      userJid: String(row.user_jid || ''),
      preferredScopeKey: String(row.preferred_scope_key || ''),
      lastGroupJid: String(row.last_group_jid || ''),
      updatedAt: Number(row.updated_at) || 0,
    };
  }

  function setPreferredScope(userJid, scopeKey, now = Date.now()) {
    ensureSchema();
    const u = String(userJid || '').trim();
    const s = String(scopeKey || '').trim();
    const ts = Number(now) || Date.now();
    if (!u) return get(u);
    getDatabase()
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_user_prefs
         (user_jid, preferred_scope_key, last_group_jid, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_jid) DO UPDATE SET
           preferred_scope_key = excluded.preferred_scope_key,
           last_group_jid = CASE
             WHEN excluded.preferred_scope_key LIKE '%@g.us'
             THEN excluded.preferred_scope_key
             ELSE last_group_jid
           END,
           updated_at = excluded.updated_at`
      )
      .run(u, s, s.endsWith('@g.us') ? s : '', ts);
    return get(u);
  }

  function touchLastGroup(userJid, groupJid, now = Date.now()) {
    ensureSchema();
    const u = String(userJid || '').trim();
    const g = String(groupJid || '').trim();
    const ts = Number(now) || Date.now();
    if (!u || !g.endsWith('@g.us')) return get(u);
    const cur = get(u);
    getDatabase()
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_user_prefs
         (user_jid, preferred_scope_key, last_group_jid, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_jid) DO UPDATE SET
           last_group_jid = excluded.last_group_jid,
           preferred_scope_key = CASE
             WHEN preferred_scope_key = '' OR preferred_scope_key IS NULL
             THEN excluded.last_group_jid
             ELSE preferred_scope_key
           END,
           updated_at = excluded.updated_at`
      )
      .run(u, cur.preferredScopeKey || g, g, ts);
    return get(u);
  }

  return {
    get,
    setPreferredScope,
    touchLastGroup,
  };
}
