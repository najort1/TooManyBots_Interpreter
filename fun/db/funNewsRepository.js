import { randomUUID } from 'node:crypto';
import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';

const ANALYTICS_SCHEMA = 'analytics';

export function createFunNewsRepository({ getDatabase = getDb } = {}) {
  function ensureSchema() {
    applyFunSchema(getDatabase());
  }

  function logEvent({
    scopeKey,
    eventType,
    userJid = null,
    payload = {},
    now = Date.now(),
  }) {
    ensureSchema();
    const s = String(scopeKey || '');
    const type = String(eventType || '').trim();
    if (!s || !type) return null;
    const id = randomUUID();
    const ts = Number(now) || Date.now();
    getDatabase()
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_daily_events
         (id, scope_key, event_type, user_jid, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        s,
        type,
        userJid ? String(userJid) : null,
        JSON.stringify(payload || {}),
        ts
      );
    return { id, scopeKey: s, eventType: type, userJid, payload, createdAt: ts };
  }

  function listSince(scopeKey, sinceMs) {
    ensureSchema();
    const rows = getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_daily_events
         WHERE scope_key = ? AND created_at >= ?
         ORDER BY created_at ASC
         LIMIT 200`
      )
      .all(String(scopeKey || ''), Number(sinceMs) || 0);
    return rows.map((r) => {
      let payload = {};
      try {
        payload = JSON.parse(String(r.payload_json || '{}')) || {};
      } catch {
        payload = {};
      }
      return {
        id: String(r.id || ''),
        scopeKey: String(r.scope_key || ''),
        eventType: String(r.event_type || ''),
        userJid: r.user_jid ? String(r.user_jid) : null,
        payload,
        createdAt: Number(r.created_at) || 0,
      };
    });
  }

  function pruneOlderThan(scopeKey, beforeMs) {
    ensureSchema();
    getDatabase()
      .prepare(
        `DELETE FROM ${ANALYTICS_SCHEMA}.fun_daily_events
         WHERE scope_key = ? AND created_at < ?`
      )
      .run(String(scopeKey || ''), Number(beforeMs) || 0);
  }

  function getNewsMeta(scopeKey) {
    ensureSchema();
    const row = getDatabase()
      .prepare(
        `SELECT last_daily_news_day, updated_at FROM ${ANALYTICS_SCHEMA}.fun_group_news_meta
         WHERE scope_key = ?`
      )
      .get(String(scopeKey || ''));
    return {
      lastDailyNewsDay: String(row?.last_daily_news_day || ''),
      updatedAt: Number(row?.updated_at) || 0,
    };
  }

  function setNewsDay(scopeKey, dayKey, now = Date.now()) {
    ensureSchema();
    const ts = Number(now) || Date.now();
    getDatabase()
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_group_news_meta
         (scope_key, last_daily_news_day, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(scope_key) DO UPDATE SET
           last_daily_news_day = excluded.last_daily_news_day,
           updated_at = excluded.updated_at`
      )
      .run(String(scopeKey || ''), String(dayKey || ''), ts);
  }

  return {
    logEvent,
    listSince,
    pruneOlderThan,
    getNewsMeta,
    setNewsDay,
  };
}
