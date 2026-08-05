import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';

const ANALYTICS_SCHEMA = 'analytics';

/**
 * @param {object} row
 * @returns {object|null}
 */
function mapChallenge(row) {
  if (!row) return null;
  let data = {};
  try {
    data = JSON.parse(String(row.challenge_data || '{}')) || {};
  } catch {
    data = {};
  }
  return {
    id: Number(row.id) || 0,
    scopeKey: String(row.scope_key || ''),
    challengeType: String(row.challenge_type || ''),
    challengeDate: String(row.challenge_date || ''),
    challengeData: data,
    answer: String(row.answer || ''),
    status: String(row.status || 'active'),
    launchedAt: Number(row.launched_at) || 0,
    expiresAt: Number(row.expires_at) || 0,
    launchPublishedAt: row.launch_published_at === null || row.launch_published_at === undefined
      ? null
      : Number(row.launch_published_at) || 0,
    completedAt: Number(row.completed_at) || 0,
    completedByJid: String(row.completed_by_jid || ''),
    solveTimeSec: Number(row.solve_time_sec) || 0,
    rewardType: String(row.reward_type || ''),
    rewardValue: Number(row.reward_value) || 0,
  };
}

/**
 * Factory do repositório de Desafio Diário.
 *
 * @param {object} deps
 * @param {() => import('better-sqlite3').Database} [deps.getDatabase]
 */
export function createFunDailyChallengeRepository({ getDatabase = getDb } = {}) {
  function ensureSchema() {
    applyFunSchema(getDatabase());
  }

  /** Busca desafio ativo (status='active') para o escopo. */
  function getActiveChallenge(scopeKey) {
    ensureSchema();
    const db = getDatabase();
    const row = db
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_daily_challenges
         WHERE scope_key = ? AND status = 'active'
         ORDER BY launched_at DESC LIMIT 1`
      )
      .get(String(scopeKey || ''));
    return mapChallenge(row);
  }

  /** Busca desafio de hoje (qualquer status) para o escopo. */
  function getTodayChallenge(scopeKey, dateStr) {
    ensureSchema();
    const db = getDatabase();
    const row = db
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_daily_challenges
         WHERE scope_key = ? AND challenge_date = ?
         ORDER BY launched_at DESC LIMIT 1`
      )
      .get(String(scopeKey || ''), String(dateStr || ''));
    return mapChallenge(row);
  }

  /** Cria novo desafio. Devolve o id (number) ou null. */
  function createChallenge({
    scopeKey,
    type,
    data,
    answer,
    launchedAt,
    expiresAt,
    dateStr,
  }) {
    ensureSchema();
    const db = getDatabase();
    const info = db
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_daily_challenges
            (scope_key, challenge_type, challenge_date, challenge_data, answer,
             status, launched_at, expires_at, launch_published_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?, 0)`
      )
      .run(
        String(scopeKey || ''),
        String(type || ''),
        String(dateStr || ''),
        JSON.stringify(data ?? {}),
        String(answer || ''),
        Number(launchedAt) || Date.now(),
        Number(expiresAt) || 0
      );
    return Number(info.lastInsertRowid) || null;
  }

  /** Marca publicação de lançamento e ajusta o prazo apenas uma vez. */
  function markLaunchPublished(id, launchedAt, expiresAt) {
    ensureSchema();
    const db = getDatabase();
    return db.prepare(
      `UPDATE ${ANALYTICS_SCHEMA}.fun_daily_challenges
          SET launch_published_at = ?, launched_at = ?, expires_at = ?
        WHERE id = ? AND status = 'active' AND launch_published_at = 0`
    ).run(
      Number(launchedAt) || Date.now(),
      Number(launchedAt) || Date.now(),
      Number(expiresAt) || 0,
      Number(id) || 0
    );
  }

  /** Marca como completo com tempo de resolução e recompensa. */
  function completeChallenge(id, userJid, rewardType, rewardValue, solveTimeSec, now = Date.now()) {
    ensureSchema();
    const db = getDatabase();
    return db
      .prepare(
        `UPDATE ${ANALYTICS_SCHEMA}.fun_daily_challenges
           SET status = 'completed',
               completed_at = ?,
               completed_by_jid = ?,
               solve_time_sec = ?,
               reward_type = ?,
               reward_value = ?
         WHERE id = ? AND status = 'active'`
      )
      .run(
        Number(now) || Date.now(),
        String(userJid || ''),
        Number(solveTimeSec) || 0,
        String(rewardType || ''),
        Number(rewardValue) || 0,
        Number(id) || 0
      );
  }

  /** Marca como expirado (sem acerto). */
  function expireChallenge(id, now = Date.now()) {
    ensureSchema();
    const db = getDatabase();
    return db
      .prepare(
        `UPDATE ${ANALYTICS_SCHEMA}.fun_daily_challenges
           SET status = 'expired', completed_at = ?
         WHERE id = ? AND status = 'active'`
      )
      .run(Number(now) || Date.now(), Number(id) || 0);
  }

  /** Marca como pulado (skip atingido). */
  function skipChallenge(id, now = Date.now()) {
    ensureSchema();
    const db = getDatabase();
    return db
      .prepare(
        `UPDATE ${ANALYTICS_SCHEMA}.fun_daily_challenges
           SET status = 'skipped', completed_at = ?
         WHERE id = ? AND status = 'active'`
      )
      .run(Number(now) || Date.now(), Number(id) || 0);
  }

  /** Registra tentativa de resposta. */
  function addAttempt({ challengeId, userJid, guess, correct = 0, now = Date.now() } = {}) {
    ensureSchema();
    const db = getDatabase();
    const info = db
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_daily_challenge_attempts
            (challenge_id, user_jid, guess, correct, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        Number(challengeId) || 0,
        String(userJid || ''),
        String(guess || ''),
        correct ? 1 : 0,
        Number(now) || Date.now()
      );
    return Number(info.lastInsertRowid) || null;
  }

  /** Conta tentativas do usuário no desafio (anti-spam/limite). */
  function countUserAttempts(challengeId, userJid) {
    ensureSchema();
    const db = getDatabase();
    const row = db
      .prepare(
        `SELECT COUNT(*) AS total FROM ${ANALYTICS_SCHEMA}.fun_daily_challenge_attempts
          WHERE challenge_id = ? AND user_jid = ?`
      )
      .get(Number(challengeId) || 0, String(userJid || ''));
    return Number(row?.total) || 0;
  }

  /** Última tentativa do usuário (para cooldown individual). */
  function getLastAttempt(challengeId, userJid) {
    ensureSchema();
    const db = getDatabase();
    const row = db
      .prepare(
        `SELECT created_at FROM ${ANALYTICS_SCHEMA}.fun_daily_challenge_attempts
          WHERE challenge_id = ? AND user_jid = ?
          ORDER BY created_at DESC LIMIT 1`
      )
      .get(Number(challengeId) || 0, String(userJid || ''));
    return Number(row?.created_at) || 0;
  }

  /** Vota para pular (UNIQUE por user). Devolve true se inseriu, false se já votou. */
  function addSkipVote(challengeId, userJid, now = Date.now()) {
    ensureSchema();
    const db = getDatabase();
    try {
      db.prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_daily_challenge_skip_votes
            (challenge_id, user_jid, created_at) VALUES (?, ?, ?)`
      ).run(Number(challengeId) || 0, String(userJid || ''), Number(now) || Date.now());
      return true;
    } catch {
      // UNIQUE constraint = já votou
      return false;
    }
  }

  /** Conta votos para pular. */
  function countSkipVotes(challengeId) {
    ensureSchema();
    const db = getDatabase();
    const row = db
      .prepare(
        `SELECT COUNT(*) AS total FROM ${ANALYTICS_SCHEMA}.fun_daily_challenge_skip_votes
          WHERE challenge_id = ?`
      )
      .get(Number(challengeId) || 0);
    return Number(row?.total) || 0;
  }

  /** Conta dicas já liberadas. */
  function countHintsUsed(challengeId) {
    ensureSchema();
    const db = getDatabase();
    const row = db
      .prepare(
        `SELECT COUNT(*) AS total FROM ${ANALYTICS_SCHEMA}.fun_daily_challenge_hints
          WHERE challenge_id = ?`
      )
      .get(Number(challengeId) || 0);
    return Number(row?.total) || 0;
  }

  /** Índice da última dica liberada (-1 se nenhuma). */
  function getLastHintIndex(challengeId) {
    ensureSchema();
    const db = getDatabase();
    const row = db
      .prepare(
        `SELECT hint_index FROM ${ANALYTICS_SCHEMA}.fun_daily_challenge_hints
          WHERE challenge_id = ?
          ORDER BY hint_index DESC LIMIT 1`
      )
      .get(Number(challengeId) || 0);
    return row ? Number(row.hint_index) : -1;
  }

  /** Registra que uma dica foi liberada (com texto para histórico/anti-repetição). */
  function recordHint(challengeId, hintIndex, now = Date.now(), hintText = '') {
    ensureSchema();
    const db = getDatabase();
    const info = db
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_daily_challenge_hints
            (challenge_id, hint_index, hint_text, released_at) VALUES (?, ?, ?, ?)`
      )
      .run(Number(challengeId) || 0, Number(hintIndex) || 0, String(hintText || ''), Number(now) || Date.now());
    return Number(info.lastInsertRowid) || null;
  }

  /** Timestamp da última dica (cooldown). */
  function getLastHintTime(challengeId) {
    ensureSchema();
    const db = getDatabase();
    const row = db
      .prepare(
        `SELECT released_at FROM ${ANALYTICS_SCHEMA}.fun_daily_challenge_hints
          WHERE challenge_id = ?
          ORDER BY released_at DESC LIMIT 1`
      )
      .get(Number(challengeId) || 0);
    return Number(row?.released_at) || 0;
  }

  /** Lista o histórico de dicas já liberadas (texto, em ordem crescente). */
  function getHints(challengeId) {
    ensureSchema();
    const db = getDatabase();
    const rows = db
      .prepare(
        `SELECT hint_index, hint_text FROM ${ANALYTICS_SCHEMA}.fun_daily_challenge_hints
          WHERE challenge_id = ?
          ORDER BY hint_index ASC`
      )
      .all(Number(challengeId) || 0);
    return rows
      .map((r) => ({ index: Number(r.hint_index) || 0, text: String(r.hint_text || '') }))
      .filter((r) => r.text);
  }

  /** Agenda horário de lançamento do dia (idempotente upsert). */
  function setLaunchSchedule(scopeKey, dateStr, targetMinute, now = Date.now()) {
    ensureSchema();
    const db = getDatabase();
    db.prepare(
      `INSERT INTO ${ANALYTICS_SCHEMA}.fun_daily_challenge_schedule
          (scope_key, schedule_date, target_minute, launched, id)
       VALUES (?, ?, ?, 0, NULL)
       ON CONFLICT(scope_key, schedule_date) DO UPDATE SET
         target_minute = excluded.target_minute`
    ).run(String(scopeKey || ''), String(dateStr || ''), Number(targetMinute) || 0);
    return true;
  }

  /** Obtém horário agendado. */
  function getLaunchSchedule(scopeKey, dateStr) {
    ensureSchema();
    const db = getDatabase();
    const row = db
      .prepare(
        `SELECT target_minute, launched FROM ${ANALYTICS_SCHEMA}.fun_daily_challenge_schedule
          WHERE scope_key = ? AND schedule_date = ?`
      )
      .get(String(scopeKey || ''), String(dateStr || ''));
    if (!row) return null;
    return {
      targetMinute: Number(row.target_minute) || 0,
      launched: Number(row.launched) === 1,
    };
  }

  /** Marca o agendamento do dia como lançado. */
  function markScheduleLaunched(scopeKey, dateStr, now = Date.now()) {
    ensureSchema();
    const db = getDatabase();
    db.prepare(
      `UPDATE ${ANALYTICS_SCHEMA}.fun_daily_challenge_schedule
          SET launched = 1 WHERE scope_key = ? AND schedule_date = ?`
    ).run(String(scopeKey || ''), String(dateStr || ''));
    return true;
  }

  /** Busca conteúdos recentes usados (para evitar repetição). */
  function getRecentContent(scopeKey, contentType, limit = 30) {
    ensureSchema();
    const db = getDatabase();
    const rows = db
      .prepare(
        `SELECT content_value FROM ${ANALYTICS_SCHEMA}.fun_daily_challenge_memory
          WHERE scope_key = ? AND content_type = ?
          ORDER BY used_at DESC LIMIT ?`
      )
      .all(String(scopeKey || ''), String(contentType || ''), Math.max(1, Number(limit) || 30));
    return rows.map((r) => String(r.content_value || ''));
  }

  /** Registra conteúdo usado (para dedup). */
  function recordContent(scopeKey, contentType, value, now = Date.now()) {
    ensureSchema();
    const db = getDatabase();
    db.prepare(
      `INSERT INTO ${ANALYTICS_SCHEMA}.fun_daily_challenge_memory
          (scope_key, content_type, content_value, used_at)
       VALUES (?, ?, ?, ?)`
    ).run(String(scopeKey || ''), String(contentType || ''), String(value || ''), Number(now) || Date.now());
    return true;
  }

  /** Registra resolução no histórico agregado (win). */
  function recordSolved(scopeKey, challengeType) {
    // Atual: usamos getStats que conta completos; este hook é mantido para futuro.
    return true;
  }

  /** Ranking dos mais rápidos (menor solve_time_sec). */
  function getFastestLeaderboard(scopeKey, limit = 10) {
    ensureSchema();
    const db = getDatabase();
    const rows = db
      .prepare(
        `SELECT completed_by_jid AS jid, MIN(solve_time_sec) AS best
           FROM ${ANALYTICS_SCHEMA}.fun_daily_challenges
          WHERE scope_key = ? AND status = 'completed' AND completed_by_jid != ''
          GROUP BY completed_by_jid
          ORDER BY best ASC
          LIMIT ?`
      )
      .all(String(scopeKey || ''), Math.max(1, Math.min(50, Number(limit) || 10)));
    return rows.map((r) => ({ jid: String(r.jid || ''), best: Number(r.best) || 0 }));
  }

  /** Ranking de mais vitórias (quantidade de acertos). */
  function getWinsLeaderboard(scopeKey, limit = 10) {
    ensureSchema();
    const db = getDatabase();
    const rows = db
      .prepare(
        `SELECT completed_by_jid AS jid, COUNT(*) AS wins
           FROM ${ANALYTICS_SCHEMA}.fun_daily_challenges
          WHERE scope_key = ? AND status = 'completed' AND completed_by_jid != ''
          GROUP BY completed_by_jid
          ORDER BY wins DESC
          LIMIT ?`
      )
      .all(String(scopeKey || ''), Math.max(1, Math.min(50, Number(limit) || 10)));
    return rows.map((r) => ({ jid: String(r.jid || ''), wins: Number(r.wins) || 0 }));
  }

  /** Estatísticas agregadas do escopo. */
  function getStats(scopeKey) {
    ensureSchema();
    const db = getDatabase();
    const row = db
      .prepare(
        `SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS solved,
            SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) AS expired,
            SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped,
            MIN(CASE WHEN status = 'completed' THEN solve_time_sec END) AS fastest
           FROM ${ANALYTICS_SCHEMA}.fun_daily_challenges
          WHERE scope_key = ?`
      )
      .get(String(scopeKey || ''));
    return {
      total: Number(row?.total) || 0,
      solved: Number(row?.solved) || 0,
      expired: Number(row?.expired) || 0,
      skipped: Number(row?.skipped) || 0,
      fastestSec: Number(row?.fastest) || 0,
    };
  }

  return {
    getActiveChallenge,
    getTodayChallenge,
    createChallenge,
    markLaunchPublished,
    completeChallenge,
    expireChallenge,
    skipChallenge,
    addAttempt,
    countUserAttempts,
    getLastAttempt,
    addSkipVote,
    countSkipVotes,
    countHintsUsed,
    getLastHintIndex,
    recordHint,
    getLastHintTime,
    getHints,
    setLaunchSchedule,
    getLaunchSchedule,
    markScheduleLaunched,
    getRecentContent,
    recordContent,
    recordSolved,
    getFastestLeaderboard,
    getWinsLeaderboard,
    getStats,
  };
}
