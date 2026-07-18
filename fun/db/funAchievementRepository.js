import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';

const ANALYTICS_SCHEMA = 'analytics';

export function createFunAchievementRepository({ getDatabase = getDb } = {}) {
  function ensureSchema() {
    applyFunSchema(getDatabase());
  }

  function listUnlocked(scopeKey, userJid) {
    ensureSchema();
    const rows = getDatabase()
      .prepare(
        `SELECT achievement_id, unlocked_at FROM ${ANALYTICS_SCHEMA}.fun_achievements
         WHERE scope_key = ? AND user_jid = ?
         ORDER BY unlocked_at ASC`
      )
      .all(String(scopeKey || ''), String(userJid || ''));
    return rows.map((r) => ({
      achievementId: String(r.achievement_id || ''),
      unlockedAt: Number(r.unlocked_at) || 0,
    }));
  }

  function has(scopeKey, userJid, achievementId) {
    ensureSchema();
    const row = getDatabase()
      .prepare(
        `SELECT 1 AS ok FROM ${ANALYTICS_SCHEMA}.fun_achievements
         WHERE scope_key = ? AND user_jid = ? AND achievement_id = ?`
      )
      .get(String(scopeKey || ''), String(userJid || ''), String(achievementId || ''));
    return Boolean(row);
  }

  function unlock({ userJid, scopeKey, achievementId, now = Date.now() }) {
    ensureSchema();
    const u = String(userJid || '');
    const s = String(scopeKey || '');
    const id = String(achievementId || '');
    const ts = Number(now) || Date.now();
    if (!u || !s || !id) return { ok: false, reason: 'invalid' };
    if (has(s, u, id)) return { ok: false, reason: 'already', achievementId: id };
    getDatabase()
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_achievements
         (user_jid, scope_key, achievement_id, unlocked_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(u, s, id, ts);
    return { ok: true, achievementId: id, unlockedAt: ts };
  }

  function getProgress(scopeKey, userJid, counterKey) {
    ensureSchema();
    const row = getDatabase()
      .prepare(
        `SELECT value FROM ${ANALYTICS_SCHEMA}.fun_achievement_progress
         WHERE scope_key = ? AND user_jid = ? AND counter_key = ?`
      )
      .get(String(scopeKey || ''), String(userJid || ''), String(counterKey || ''));
    return Number(row?.value) || 0;
  }

  function addProgress({ userJid, scopeKey, counterKey, delta = 1, now = Date.now() }) {
    ensureSchema();
    const u = String(userJid || '');
    const s = String(scopeKey || '');
    const k = String(counterKey || '');
    const d = Math.floor(Number(delta) || 0);
    const ts = Number(now) || Date.now();
    if (!u || !s || !k || d === 0) return getProgress(s, u, k);
    getDatabase()
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_achievement_progress
         (user_jid, scope_key, counter_key, value, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_jid, scope_key, counter_key) DO UPDATE SET
           value = value + excluded.value,
           updated_at = excluded.updated_at`
      )
      .run(u, s, k, d, ts);
    return getProgress(s, u, k);
  }

  function setProgress({ userJid, scopeKey, counterKey, value, now = Date.now() }) {
    ensureSchema();
    const u = String(userJid || '');
    const s = String(scopeKey || '');
    const k = String(counterKey || '');
    const v = Math.max(0, Math.floor(Number(value) || 0));
    const ts = Number(now) || Date.now();
    getDatabase()
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_achievement_progress
         (user_jid, scope_key, counter_key, value, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_jid, scope_key, counter_key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at`
      )
      .run(u, s, k, v, ts);
    return v;
  }

  return {
    listUnlocked,
    has,
    unlock,
    getProgress,
    addProgress,
    setProgress,
  };
}
