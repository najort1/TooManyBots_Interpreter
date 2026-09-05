import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';

const ANALYTICS_SCHEMA = 'analytics';

function validScope(scopeKey) {
  return String(scopeKey || '').trim().endsWith('@g.us');
}

function mapRow(row) {
  if (!row) return null;
  return {
    scopeKey: String(row.scope_key || ''),
    anchorMessageId: String(row.anchor_message_id || ''),
    anchorAt: Number(row.anchor_at) || 0,
    lastHumanMessageId: String(row.last_human_message_id || ''),
    lastHumanAt: Number(row.last_human_at) || 0,
    status: String(row.status || 'completed'),
    leaseUntil: Number(row.lease_until) || 0,
    attemptCount: Number(row.attempt_count) || 0,
    completedAt: Number(row.completed_at) || 0,
    lastError: String(row.last_error || ''),
    updatedAt: Number(row.updated_at) || 0,
  };
}

/** Estado durável do único follow-up permitido após uma resposta da persona. */
export function createFunPersonaFollowupRepository({ getDatabase = getDb } = {}) {
  const ensureSchema = () => applyFunSchema(getDatabase());

  function startTurn({ scopeKey, anchorMessageId, anchorAt = Date.now(), now = anchorAt } = {}) {
    ensureSchema();
    const scope = String(scopeKey || '').trim();
    const anchorId = String(anchorMessageId || '').trim();
    const at = Number(anchorAt) || Date.now();
    const updatedAt = Number(now) || at;
    if (!validScope(scope) || !anchorId) return { ok: false, reason: 'invalid' };

    getDatabase().prepare(
      `INSERT INTO ${ANALYTICS_SCHEMA}.fun_persona_followups (
        scope_key, anchor_message_id, anchor_at, last_human_message_id,
        last_human_at, status, lease_until, attempt_count, completed_at,
        last_error, updated_at
      ) VALUES (?, ?, ?, '', ?, 'pending', 0, 0, 0, '', ?)
      ON CONFLICT(scope_key) DO UPDATE SET
        anchor_message_id = excluded.anchor_message_id,
        anchor_at = excluded.anchor_at,
        last_human_message_id = '',
        last_human_at = excluded.last_human_at,
        status = 'pending',
        lease_until = 0,
        attempt_count = 0,
        completed_at = 0,
        last_error = '',
        updated_at = excluded.updated_at`
    ).run(scope, anchorId, at, at, updatedAt);
    return { ok: true };
  }

  function observeHumanMessage({ scopeKey, messageId, now = Date.now() } = {}) {
    ensureSchema();
    const scope = String(scopeKey || '').trim();
    const id = String(messageId || '').trim();
    const at = Number(now) || Date.now();
    if (!validScope(scope) || !id) return { ok: false, reason: 'invalid' };

    const result = getDatabase().prepare(
      `UPDATE ${ANALYTICS_SCHEMA}.fun_persona_followups
       SET last_human_message_id = ?, last_human_at = ?,
           status = 'pending', lease_until = 0, updated_at = ?
       WHERE scope_key = ?
         AND status IN ('pending', 'processing')
         AND ? > anchor_at`
    ).run(id, at, at, scope, at);
    return result.changes ? { ok: true } : { ok: false, reason: 'no-pending-turn' };
  }

  function listDue({ now = Date.now(), silenceMs = 60_000, limit = 100 } = {}) {
    ensureSchema();
    const at = Number(now) || Date.now();
    const silence = Math.max(60_000, Number(silenceMs) || 60_000);
    const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 100)));
    const rows = getDatabase().prepare(
      `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_persona_followups
       WHERE last_human_message_id <> ''
         AND last_human_at <= ?
         AND (status = 'pending' OR (status = 'processing' AND lease_until <= ?))
       ORDER BY last_human_at ASC, scope_key ASC
       LIMIT ?`
    ).all(at - silence, at, safeLimit);
    return rows.map(mapRow);
  }

  function claim({ scopeKey, expectedHumanMessageId, now = Date.now(), leaseMs = 90_000 } = {}) {
    ensureSchema();
    const scope = String(scopeKey || '').trim();
    const humanId = String(expectedHumanMessageId || '').trim();
    const at = Number(now) || Date.now();
    const leaseUntil = at + Math.max(10_000, Number(leaseMs) || 90_000);
    if (!validScope(scope) || !humanId) return { ok: false, reason: 'invalid' };

    const result = getDatabase().prepare(
      `UPDATE ${ANALYTICS_SCHEMA}.fun_persona_followups
       SET status = 'processing', lease_until = ?, attempt_count = attempt_count + 1,
           last_error = '', updated_at = ?
       WHERE scope_key = ?
         AND last_human_message_id = ?
         AND (status = 'pending' OR (status = 'processing' AND lease_until <= ?))`
    ).run(leaseUntil, at, scope, humanId, at);
    return result.changes ? { ok: true, leaseUntil } : { ok: false, reason: 'not-claimable' };
  }

  function complete({ scopeKey, expectedHumanMessageId = '', now = Date.now() } = {}) {
    ensureSchema();
    const scope = String(scopeKey || '').trim();
    const expectedId = String(expectedHumanMessageId || '').trim();
    const at = Number(now) || Date.now();
    if (!validScope(scope)) return { ok: false, reason: 'invalid' };
    const result = getDatabase().prepare(
      `UPDATE ${ANALYTICS_SCHEMA}.fun_persona_followups
       SET status = 'completed', lease_until = 0, completed_at = ?, updated_at = ?
       WHERE scope_key = ?
         AND (? = '' OR last_human_message_id = ?)`
    ).run(at, at, scope, expectedId, expectedId);
    return { ok: Boolean(result.changes) };
  }

  function release({ scopeKey, reason = '', now = Date.now() } = {}) {
    ensureSchema();
    const scope = String(scopeKey || '').trim();
    const at = Number(now) || Date.now();
    if (!validScope(scope)) return { ok: false, reason: 'invalid' };
    const result = getDatabase().prepare(
      `UPDATE ${ANALYTICS_SCHEMA}.fun_persona_followups
       SET status = 'pending', lease_until = 0, last_error = ?, updated_at = ?
       WHERE scope_key = ? AND status = 'processing'`
    ).run(String(reason || '').slice(0, 240), at, scope);
    return { ok: Boolean(result.changes) };
  }

  function get(scopeKey) {
    ensureSchema();
    return mapRow(getDatabase().prepare(
      `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_persona_followups WHERE scope_key = ?`
    ).get(String(scopeKey || '').trim()));
  }

  return { startTurn, observeHumanMessage, listDue, claim, complete, release, get };
}
