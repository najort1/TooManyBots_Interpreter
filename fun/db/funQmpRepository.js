import { randomUUID } from 'node:crypto';
import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';
import { getWeekKey } from './funSocialRepository.js';

const ANALYTICS_SCHEMA = 'analytics';

function mapQuestion(row) {
  if (!row) return null;
  return {
    id: String(row.id || ''),
    scopeKey: String(row.scope_key || ''),
    prompt: String(row.prompt || ''),
    source: String(row.source || 'llm'),
    tone: String(row.tone || 'normal') === 'heavy' ? 'heavy' : 'normal',
    createdBy: String(row.created_by || ''),
    status: String(row.status || ''),
    weekKey: String(row.week_key || ''),
    createdAt: Number(row.created_at) || 0,
    expiresAt: Number(row.expires_at) || 0,
    closedAt: Number(row.closed_at) || 0,
  };
}

function mapVote(row) {
  if (!row) return null;
  return {
    id: String(row.id || ''),
    questionId: String(row.question_id || ''),
    scopeKey: String(row.scope_key || ''),
    voterJid: String(row.voter_jid || ''),
    targetJid: String(row.target_jid || ''),
    weekKey: String(row.week_key || ''),
    createdAt: Number(row.created_at) || 0,
  };
}

export function createFunQmpRepository({ getDatabase = getDb } = {}) {
  function ensureSchema() {
    applyFunSchema(getDatabase());
  }

  function getQuestionById(id) {
    ensureSchema();
    const db = getDatabase();
    const row = db
      .prepare(`SELECT * FROM ${ANALYTICS_SCHEMA}.fun_qmp_questions WHERE id = ?`)
      .get(String(id || ''));
    return mapQuestion(row);
  }

  function getActiveQuestion(scopeKey, now = Date.now()) {
    ensureSchema();
    const db = getDatabase();
    const row = db
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_qmp_questions
         WHERE scope_key = ? AND status = 'active' AND expires_at > ?
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(String(scopeKey || ''), Number(now) || Date.now());
    return mapQuestion(row);
  }

  function countQuestions(scopeKey) {
    ensureSchema();
    const db = getDatabase();
    const row = db
      .prepare(
        `SELECT COUNT(*) AS total FROM ${ANALYTICS_SCHEMA}.fun_qmp_questions
         WHERE scope_key = ?`
      )
      .get(String(scopeKey || ''));
    return Number(row?.total) || 0;
  }

  /**
   * Prompts recentes do grupo (anti-eco no LLM).
   * @returns {string[]}
   */
  function listRecentPrompts(scopeKey, limit = 12) {
    ensureSchema();
    const db = getDatabase();
    const lim = Math.max(1, Math.min(40, Math.floor(Number(limit) || 12)));
    const rows = db
      .prepare(
        `SELECT prompt FROM ${ANALYTICS_SCHEMA}.fun_qmp_questions
         WHERE scope_key = ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(String(scopeKey || ''), lim);
    return rows.map((r) => String(r.prompt || '').trim()).filter(Boolean);
  }

  function createQuestion({
    scopeKey,
    prompt,
    source = 'llm',
    tone = 'normal',
    createdBy = '',
    expiresAt,
    now = Date.now(),
    weekKey = getWeekKey(now),
  }) {
    ensureSchema();
    const db = getDatabase();
    const id = randomUUID();
    const ts = Number(now) || Date.now();
    const exp = Number(expiresAt) || ts + 10 * 60_000;
    const toneNorm = String(tone || 'normal') === 'heavy' ? 'heavy' : 'normal';
    db.prepare(
      `INSERT INTO ${ANALYTICS_SCHEMA}.fun_qmp_questions
       (id, scope_key, prompt, source, tone, created_by, status, week_key, created_at, expires_at, closed_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, 0)`
    ).run(
      id,
      String(scopeKey || ''),
      String(prompt || '').trim(),
      String(source || 'llm'),
      toneNorm,
      String(createdBy || ''),
      String(weekKey || getWeekKey(ts)),
      ts,
      exp
    );

    db.prepare(
      `INSERT INTO ${ANALYTICS_SCHEMA}.fun_qmp_meta
       (scope_key, last_auto_at, last_question_at, updated_at)
       VALUES (?, 0, ?, ?)
       ON CONFLICT(scope_key) DO UPDATE SET
         last_question_at = excluded.last_question_at,
         updated_at = excluded.updated_at`
    ).run(String(scopeKey || ''), ts, ts);

    if (source === 'auto') {
      db.prepare(
        `UPDATE ${ANALYTICS_SCHEMA}.fun_qmp_meta
         SET last_auto_at = ?, updated_at = ?
         WHERE scope_key = ?`
      ).run(ts, ts, String(scopeKey || ''));
    }

    return getQuestionById(id);
  }

  function closeQuestion(questionId, now = Date.now()) {
    ensureSchema();
    const db = getDatabase();
    db.prepare(
      `UPDATE ${ANALYTICS_SCHEMA}.fun_qmp_questions
       SET status = 'closed', closed_at = ?
       WHERE id = ? AND status = 'active'`
    ).run(Number(now) || Date.now(), String(questionId || ''));
    return getQuestionById(questionId);
  }

  function closeExpired(scopeKey, now = Date.now()) {
    ensureSchema();
    const db = getDatabase();
    const ts = Number(now) || Date.now();
    const rows = db
      .prepare(
        `SELECT id FROM ${ANALYTICS_SCHEMA}.fun_qmp_questions
         WHERE scope_key = ? AND status = 'active' AND expires_at <= ?`
      )
      .all(String(scopeKey || ''), ts);
    for (const r of rows) {
      closeQuestion(r.id, ts);
    }
    return rows.map((r) => String(r.id));
  }

  function registerVote({
    questionId,
    scopeKey,
    voterJid,
    targetJid,
    weekKey,
    now = Date.now(),
  }) {
    ensureSchema();
    const db = getDatabase();
    const qid = String(questionId || '');
    const voter = String(voterJid || '');
    const target = String(targetJid || '');
    if (!qid || !voter || !target) return { ok: false, reason: 'invalid' };

    const question = getQuestionById(qid);
    if (!question) return { ok: false, reason: 'question-not-found' };
    if (question.status !== 'active') return { ok: false, reason: 'question-closed' };
    if (question.expiresAt <= (Number(now) || Date.now())) {
      closeQuestion(qid, now);
      return { ok: false, reason: 'question-expired' };
    }
    if (voter === target) return { ok: false, reason: 'self-vote' };

    const existing = db
      .prepare(
        `SELECT 1 AS ok FROM ${ANALYTICS_SCHEMA}.fun_qmp_votes
         WHERE question_id = ? AND voter_jid = ?`
      )
      .get(qid, voter);
    if (existing) return { ok: false, reason: 'already-voted' };

    const id = randomUUID();
    const wk = String(weekKey || question.weekKey || getWeekKey(now));
    try {
      db.prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_qmp_votes
         (id, question_id, scope_key, voter_jid, target_jid, week_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        qid,
        String(scopeKey || question.scopeKey || ''),
        voter,
        target,
        wk,
        Number(now) || Date.now()
      );
    } catch {
      return { ok: false, reason: 'already-voted' };
    }

    return {
      ok: true,
      vote: mapVote({
        id,
        question_id: qid,
        scope_key: String(scopeKey || question.scopeKey || ''),
        voter_jid: voter,
        target_jid: target,
        week_key: wk,
        created_at: Number(now) || Date.now(),
      }),
    };
  }

  function hasVoted(questionId, voterJid) {
    ensureSchema();
    const db = getDatabase();
    const row = db
      .prepare(
        `SELECT 1 AS ok FROM ${ANALYTICS_SCHEMA}.fun_qmp_votes
         WHERE question_id = ? AND voter_jid = ?`
      )
      .get(String(questionId || ''), String(voterJid || ''));
    return Boolean(row);
  }

  function countVotes(questionId) {
    ensureSchema();
    const db = getDatabase();
    const row = db
      .prepare(
        `SELECT COUNT(*) AS total FROM ${ANALYTICS_SCHEMA}.fun_qmp_votes
         WHERE question_id = ?`
      )
      .get(String(questionId || ''));
    return Number(row?.total) || 0;
  }

  function tallyQuestion(questionId) {
    ensureSchema();
    const db = getDatabase();
    const rows = db
      .prepare(
        `SELECT target_jid AS user_jid, COUNT(*) AS votes
         FROM ${ANALYTICS_SCHEMA}.fun_qmp_votes
         WHERE question_id = ?
         GROUP BY target_jid
         ORDER BY votes DESC, target_jid ASC`
      )
      .all(String(questionId || ''));
    return rows.map((r, i) => ({
      rank: i + 1,
      userJid: String(r.user_jid || ''),
      votes: Number(r.votes) || 0,
    }));
  }

  /**
   * Últimas rodadas (fechadas) com ganhador e totais.
   * @returns {Array<{ question, totalVotes, winnerJid, winnerVotes, tallyTop }>}
   */
  function listRecentRounds(scopeKey, limit = 8) {
    ensureSchema();
    const db = getDatabase();
    const lim = Math.max(1, Math.min(30, Math.floor(Number(limit) || 8)));
    const rows = db
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_qmp_questions
         WHERE scope_key = ? AND status = 'closed'
         ORDER BY CASE WHEN closed_at > 0 THEN closed_at ELSE created_at END DESC
         LIMIT ?`
      )
      .all(String(scopeKey || ''), lim);

    return rows.map((row) => {
      const question = mapQuestion(row);
      const tally = tallyQuestion(question.id);
      const totalVotes = tally.reduce((s, r) => s + (r.votes || 0), 0);
      const top = tally[0] || null;
      return {
        question,
        totalVotes,
        winnerJid: top?.userJid || '',
        winnerVotes: top?.votes || 0,
        tallyTop: tally.slice(0, 3),
      };
    });
  }

  function weeklyLeaderboard(scopeKey, weekKey = getWeekKey(), limit = 10) {
    ensureSchema();
    const db = getDatabase();
    const lim = Math.max(1, Math.min(50, Math.floor(Number(limit) || 10)));
    const rows = db
      .prepare(
        `SELECT target_jid AS user_jid, COUNT(*) AS votes
         FROM ${ANALYTICS_SCHEMA}.fun_qmp_votes
         WHERE scope_key = ? AND week_key = ?
         GROUP BY target_jid
         ORDER BY votes DESC, target_jid ASC
         LIMIT ?`
      )
      .all(String(scopeKey || ''), String(weekKey || getWeekKey()), lim);
    return rows.map((r, i) => ({
      rank: i + 1,
      userJid: String(r.user_jid || ''),
      votes: Number(r.votes) || 0,
    }));
  }

  function getUserWeekRank(scopeKey, userJid, weekKey = getWeekKey()) {
    ensureSchema();
    const db = getDatabase();
    const rows = db
      .prepare(
        `SELECT target_jid AS user_jid, COUNT(*) AS votes
         FROM ${ANALYTICS_SCHEMA}.fun_qmp_votes
         WHERE scope_key = ? AND week_key = ?
         GROUP BY target_jid
         ORDER BY votes DESC, target_jid ASC`
      )
      .all(String(scopeKey || ''), String(weekKey || getWeekKey()));

    const uid = String(userJid || '');
    const total = rows.length;
    const idx = rows.findIndex((r) => String(r.user_jid) === uid);
    if (idx < 0) {
      return { rank: null, total, votes: 0 };
    }
    return {
      rank: idx + 1,
      total,
      votes: Number(rows[idx].votes) || 0,
    };
  }

  function getMeta(scopeKey) {
    ensureSchema();
    const db = getDatabase();
    const row = db
      .prepare(`SELECT * FROM ${ANALYTICS_SCHEMA}.fun_qmp_meta WHERE scope_key = ?`)
      .get(String(scopeKey || ''));
    if (!row) {
      return {
        scopeKey: String(scopeKey || ''),
        lastAutoAt: 0,
        lastQuestionAt: 0,
        updatedAt: 0,
      };
    }
    return {
      scopeKey: String(row.scope_key || ''),
      lastAutoAt: Number(row.last_auto_at) || 0,
      lastQuestionAt: Number(row.last_question_at) || 0,
      updatedAt: Number(row.updated_at) || 0,
    };
  }

  function touchAuto(scopeKey, now = Date.now()) {
    ensureSchema();
    const db = getDatabase();
    const ts = Number(now) || Date.now();
    db.prepare(
      `INSERT INTO ${ANALYTICS_SCHEMA}.fun_qmp_meta
       (scope_key, last_auto_at, last_question_at, updated_at)
       VALUES (?, ?, 0, ?)
       ON CONFLICT(scope_key) DO UPDATE SET
         last_auto_at = excluded.last_auto_at,
         updated_at = excluded.updated_at`
    ).run(String(scopeKey || ''), ts, ts);
  }

  return {
    ensureSchema,
    getWeekKey,
    getQuestionById,
    getActiveQuestion,
    countQuestions,
    listRecentPrompts,
    createQuestion,
    closeQuestion,
    closeExpired,
    registerVote,
    hasVoted,
    countVotes,
    tallyQuestion,
    listRecentRounds,
    weeklyLeaderboard,
    getUserWeekRank,
    getMeta,
    touchAuto,
  };
}
