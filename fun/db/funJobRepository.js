import { randomUUID } from 'node:crypto';
import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';

const ANALYTICS_SCHEMA = 'analytics';

function mapJob(row) {
  if (!row) return null;
  return {
    userJid: String(row.user_jid || ''),
    scopeKey: String(row.scope_key || ''),
    jobId: String(row.job_id || ''),
    hiredAt: Number(row.hired_at) || 0,
    missedDailies: Number(row.missed_dailies) || 0,
    updatedAt: Number(row.updated_at) || 0,
  };
}

function mapAttempt(row) {
  if (!row) return null;
  let metrics = {};
  try {
    metrics = JSON.parse(String(row.metrics_json || '{}'));
  } catch {
    metrics = {};
  }
  return {
    id: String(row.id || ''),
    userJid: String(row.user_jid || ''),
    scopeKey: String(row.scope_key || ''),
    jobId: String(row.job_id || ''),
    status: String(row.status || ''),
    code: String(row.code || ''),
    tokenNonce: String(row.token_nonce || ''),
    score: Number(row.score) || 0,
    metrics,
    createdAt: Number(row.created_at) || 0,
    startedAt: Number(row.started_at) || 0,
    finishedAt: Number(row.finished_at) || 0,
    expiresAt: Number(row.expires_at) || 0,
  };
}

export function createFunJobRepository({ getDatabase = getDb } = {}) {
  function ensureSchema() {
    applyFunSchema(getDatabase());
  }

  function getUserJob(userJid, scopeKey) {
    ensureSchema();
    const row = getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_user_jobs
         WHERE user_jid = ? AND scope_key = ?`
      )
      .get(String(userJid || ''), String(scopeKey || ''));
    return mapJob(row);
  }

  function setUserJob({ userJid, scopeKey, jobId, now = Date.now() }) {
    ensureSchema();
    const ts = Number(now) || Date.now();
    getDatabase()
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_user_jobs
         (user_jid, scope_key, job_id, hired_at, missed_dailies, updated_at)
         VALUES (?, ?, ?, ?, 0, ?)
         ON CONFLICT(user_jid, scope_key) DO UPDATE SET
           job_id = excluded.job_id,
           hired_at = excluded.hired_at,
           missed_dailies = 0,
           updated_at = excluded.updated_at`
      )
      .run(String(userJid), String(scopeKey), String(jobId), ts, ts);
    return getUserJob(userJid, scopeKey);
  }

  function clearUserJob(userJid, scopeKey) {
    ensureSchema();
    getDatabase()
      .prepare(
        `DELETE FROM ${ANALYTICS_SCHEMA}.fun_user_jobs
         WHERE user_jid = ? AND scope_key = ?`
      )
      .run(String(userJid || ''), String(scopeKey || ''));
    return { ok: true };
  }

  function countInJob(scopeKey, jobId) {
    ensureSchema();
    const row = getDatabase()
      .prepare(
        `SELECT COUNT(*) AS c FROM ${ANALYTICS_SCHEMA}.fun_user_jobs
         WHERE scope_key = ? AND job_id = ?`
      )
      .get(String(scopeKey || ''), String(jobId || ''));
    return Number(row?.c) || 0;
  }

  function incrementMissedDaily(userJid, scopeKey, now = Date.now()) {
    ensureSchema();
    const job = getUserJob(userJid, scopeKey);
    if (!job) return null;
    const next = (job.missedDailies || 0) + 1;
    getDatabase()
      .prepare(
        `UPDATE ${ANALYTICS_SCHEMA}.fun_user_jobs
         SET missed_dailies = ?, updated_at = ?
         WHERE user_jid = ? AND scope_key = ?`
      )
      .run(next, Number(now) || Date.now(), String(userJid), String(scopeKey));
    return getUserJob(userJid, scopeKey);
  }

  function resetMissedDaily(userJid, scopeKey, now = Date.now()) {
    ensureSchema();
    getDatabase()
      .prepare(
        `UPDATE ${ANALYTICS_SCHEMA}.fun_user_jobs
         SET missed_dailies = 0, updated_at = ?
         WHERE user_jid = ? AND scope_key = ?`
      )
      .run(Number(now) || Date.now(), String(userJid), String(scopeKey));
  }

  function getCooldown(userJid, scopeKey, jobId) {
    ensureSchema();
    const row = getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_job_cooldowns
         WHERE user_jid = ? AND scope_key = ? AND job_id = ?`
      )
      .get(String(userJid || ''), String(scopeKey || ''), String(jobId || ''));
    if (!row) return null;
    return {
      userJid: String(row.user_jid),
      scopeKey: String(row.scope_key),
      jobId: String(row.job_id),
      nextAttemptAt: Number(row.next_attempt_at) || 0,
      attemptCount: Number(row.attempt_count) || 0,
    };
  }

  function setCooldown({ userJid, scopeKey, jobId, nextAttemptAt, attemptCount, now = Date.now() }) {
    ensureSchema();
    getDatabase()
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_job_cooldowns
         (user_jid, scope_key, job_id, next_attempt_at, attempt_count, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_jid, scope_key, job_id) DO UPDATE SET
           next_attempt_at = excluded.next_attempt_at,
           attempt_count = excluded.attempt_count,
           updated_at = excluded.updated_at`
      )
      .run(
        String(userJid),
        String(scopeKey),
        String(jobId),
        Math.max(0, Math.floor(Number(nextAttemptAt) || 0)),
        Math.max(0, Math.floor(Number(attemptCount) || 0)),
        Number(now) || Date.now()
      );
    return getCooldown(userJid, scopeKey, jobId);
  }

  function createAttempt({
    userJid,
    scopeKey,
    jobId,
    code,
    tokenNonce,
    expiresAt,
    now = Date.now(),
  }) {
    ensureSchema();
    const id = randomUUID();
    const ts = Number(now) || Date.now();
    getDatabase()
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_job_attempts
         (id, user_jid, scope_key, job_id, status, code, token_nonce, score,
          metrics_json, created_at, started_at, finished_at, expires_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?, 0, '{}', ?, 0, 0, ?)`
      )
      .run(
        id,
        String(userJid),
        String(scopeKey),
        String(jobId),
        String(code || ''),
        String(tokenNonce || ''),
        ts,
        Math.max(0, Math.floor(Number(expiresAt) || 0))
      );
    return getAttempt(id);
  }

  function getAttempt(id) {
    ensureSchema();
    const row = getDatabase()
      .prepare(`SELECT * FROM ${ANALYTICS_SCHEMA}.fun_job_attempts WHERE id = ?`)
      .get(String(id || ''));
    return mapAttempt(row);
  }

  function getAttemptByCode(code) {
    ensureSchema();
    const row = getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_job_attempts
         WHERE code = ? AND status IN ('pending', 'in_progress')
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(String(code || '').toUpperCase());
    return mapAttempt(row);
  }

  function markAttemptStarted(id, now = Date.now()) {
    ensureSchema();
    getDatabase()
      .prepare(
        `UPDATE ${ANALYTICS_SCHEMA}.fun_job_attempts
         SET status = 'in_progress', started_at = ?
         WHERE id = ? AND status = 'pending'`
      )
      .run(Number(now) || Date.now(), String(id));
    return getAttempt(id);
  }

  function finishAttempt({ id, status, score = 0, metrics = {}, now = Date.now() }) {
    ensureSchema();
    getDatabase()
      .prepare(
        `UPDATE ${ANALYTICS_SCHEMA}.fun_job_attempts
         SET status = ?, score = ?, metrics_json = ?, finished_at = ?
         WHERE id = ? AND status IN ('pending', 'in_progress')`
      )
      .run(
        String(status),
        Math.floor(Number(score) || 0),
        JSON.stringify(metrics || {}),
        Number(now) || Date.now(),
        String(id)
      );
    return getAttempt(id);
  }

  function countPriorAttempts(userJid, scopeKey, jobId) {
    ensureSchema();
    const row = getDatabase()
      .prepare(
        `SELECT COUNT(*) AS c FROM ${ANALYTICS_SCHEMA}.fun_job_attempts
         WHERE user_jid = ? AND scope_key = ? AND job_id = ?
           AND status IN ('passed', 'failed')`
      )
      .get(String(userJid), String(scopeKey), String(jobId));
    return Number(row?.c) || 0;
  }

  return {
    getUserJob,
    setUserJob,
    clearUserJob,
    countInJob,
    incrementMissedDaily,
    resetMissedDaily,
    getCooldown,
    setCooldown,
    createAttempt,
    getAttempt,
    getAttemptByCode,
    markAttemptStarted,
    finishAttempt,
    countPriorAttempts,
  };
}
