import { randomUUID } from 'node:crypto';
import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';

const ANALYTICS_SCHEMA = 'analytics';

function mapAction(row) {
  if (!row) return null;
  let payload = {};
  try {
    payload = JSON.parse(String(row.payload_json || '{}'));
  } catch {
    payload = {};
  }
  return {
    id: String(row.id || ''),
    scopeKey: String(row.scope_key || ''),
    actionType: String(row.action_type || ''),
    fromJid: String(row.from_jid || ''),
    toJid: String(row.to_jid || ''),
    payload,
    expiresAt: Number(row.expires_at) || 0,
    createdAt: Number(row.created_at) || 0,
  };
}

export function createFunActionRepository({ getDatabase = getDb } = {}) {
  function ensureSchema() {
    applyFunSchema(getDatabase());
  }

  function purgeExpired(now = Date.now()) {
    ensureSchema();
    const db = getDatabase();
    db.prepare(
      `DELETE FROM ${ANALYTICS_SCHEMA}.fun_pending_actions WHERE expires_at < ?`
    ).run(Number(now) || Date.now());
  }

  function createAction({
    scopeKey,
    actionType,
    fromJid,
    toJid,
    payload = {},
    ttlMs = 5 * 60_000,
    now = Date.now(),
  }) {
    ensureSchema();
    purgeExpired(now);
    const db = getDatabase();
    const id = randomUUID();
    const ts = Number(now) || Date.now();
    const expiresAt = ts + Math.max(10_000, Math.floor(Number(ttlMs) || 0));

    // uma proposta do mesmo tipo por from→to no scope
    db.prepare(
      `DELETE FROM ${ANALYTICS_SCHEMA}.fun_pending_actions
       WHERE scope_key = ? AND action_type = ? AND from_jid = ? AND to_jid = ?`
    ).run(String(scopeKey), String(actionType), String(fromJid), String(toJid));

    db.prepare(
      `INSERT INTO ${ANALYTICS_SCHEMA}.fun_pending_actions
       (id, scope_key, action_type, from_jid, to_jid, payload_json, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      String(scopeKey),
      String(actionType),
      String(fromJid),
      String(toJid),
      JSON.stringify(payload || {}),
      expiresAt,
      ts
    );

    return mapAction({
      id,
      scope_key: scopeKey,
      action_type: actionType,
      from_jid: fromJid,
      to_jid: toJid,
      payload_json: JSON.stringify(payload || {}),
      expires_at: expiresAt,
      created_at: ts,
    });
  }

  /**
   * Ação pendente mais recente dirigida ao user (qualquer tipo ou filtrada).
   */
  function getLatestIncoming({ scopeKey, toJid, actionType = null, now = Date.now() }) {
    ensureSchema();
    purgeExpired(now);
    const db = getDatabase();
    const s = String(scopeKey || '');
    const t = String(toJid || '');
    const ts = Number(now) || Date.now();

    if (actionType) {
      const row = db
        .prepare(
          `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_pending_actions
           WHERE scope_key = ? AND to_jid = ? AND action_type = ? AND expires_at >= ?
           ORDER BY created_at DESC LIMIT 1`
        )
        .get(s, t, String(actionType), ts);
      return mapAction(row);
    }

    const row = db
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_pending_actions
         WHERE scope_key = ? AND to_jid = ? AND expires_at >= ?
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(s, t, ts);
    return mapAction(row);
  }

  function deleteAction(id) {
    ensureSchema();
    const db = getDatabase();
    db.prepare(
      `DELETE FROM ${ANALYTICS_SCHEMA}.fun_pending_actions WHERE id = ?`
    ).run(String(id || ''));
  }

  function deleteBetween({ scopeKey, fromJid, toJid, actionType }) {
    ensureSchema();
    const db = getDatabase();
    db.prepare(
      `DELETE FROM ${ANALYTICS_SCHEMA}.fun_pending_actions
       WHERE scope_key = ? AND action_type = ? AND from_jid = ? AND to_jid = ?`
    ).run(String(scopeKey), String(actionType), String(fromJid), String(toJid));
  }

  function listOutgoing({ scopeKey, fromJid, actionType, now = Date.now() }) {
    ensureSchema();
    purgeExpired(now);
    const db = getDatabase();
    const rows = db
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_pending_actions
         WHERE scope_key = ? AND from_jid = ? AND action_type = ? AND expires_at >= ?
         ORDER BY created_at DESC`
      )
      .all(String(scopeKey), String(fromJid), String(actionType), Number(now) || Date.now());
    return rows.map(mapAction);
  }

  return {
    createAction,
    getLatestIncoming,
    deleteAction,
    deleteBetween,
    listOutgoing,
    purgeExpired,
  };
}
