import { randomUUID } from 'node:crypto';
import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';

const ANALYTICS_SCHEMA = 'analytics';

export function createFunTrialRepository({ getDatabase = getDb } = {}) {
  function ensureSchema() {
    applyFunSchema(getDatabase());
  }

  function createTrial({
    scopeKey,
    accuserJid,
    defendantJid,
    infractionType,
    evidenceSummary = '',
    bailAmount = 150,
    durationMs = 90_000,
    now = Date.now(),
  }) {
    ensureSchema();
    const id = `trial_${randomUUID().slice(0, 8)}`;
    const s = String(scopeKey || '').trim();
    const accuser = String(accuserJid || '').trim();
    const defendant = String(defendantJid || '').trim();
    const endsAt = now + durationMs;

    const db = getDatabase();
    db.prepare(
      `INSERT INTO ${ANALYTICS_SCHEMA}.fun_trials
       (id, scope_key, accuser_jid, defendant_jid, infraction_type, evidence_summary, bail_amount, status, ends_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'voting', ?, ?)`
    ).run(id, s, accuser, defendant, String(infractionType || 'social_crime'), String(evidenceSummary || ''), Number(bailAmount) || 150, endsAt, now);

    return getTrial(id);
  }

  function getTrial(id) {
    ensureSchema();
    const row = getDatabase()
      .prepare(`SELECT * FROM ${ANALYTICS_SCHEMA}.fun_trials WHERE id = ?`)
      .get(String(id || ''));

    if (!row) return null;
    return {
      id: String(row.id || ''),
      scopeKey: String(row.scope_key || ''),
      accuserJid: String(row.accuser_jid || ''),
      defendantJid: String(row.defendant_jid || ''),
      infractionType: String(row.infraction_type || ''),
      evidenceSummary: String(row.evidence_summary || ''),
      bailAmount: Number(row.bail_amount) || 0,
      status: String(row.status || 'voting'),
      guiltyVotes: Number(row.guilty_votes) || 0,
      innocentVotes: Number(row.innocent_votes) || 0,
      penaltyCoins: Number(row.penalty_coins) || 0,
      endsAt: Number(row.ends_at) || 0,
      createdAt: Number(row.created_at) || 0,
      resolvedAt: Number(row.resolved_at) || 0,
    };
  }

  function getActiveTrial(scopeKey, now = Date.now()) {
    ensureSchema();
    const s = String(scopeKey || '').trim();
    const row = getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_trials
         WHERE scope_key = ? AND status = 'voting' AND ends_at > ?
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(s, now);

    if (!row) return null;
    return getTrial(row.id);
  }

  function castVote({ trialId, voterJid, vote, voteWeight = 1.0, now = Date.now() }) {
    ensureSchema();
    const tid = String(trialId || '').trim();
    const voter = String(voterJid || '').trim();
    const v = vote === 'guilty' ? 'guilty' : 'innocent';
    const weight = Math.max(0.1, Number(voteWeight) || 1.0);

    const db = getDatabase();
    return db.transaction(() => {
      // Impede voto duplicado
      const existing = db
        .prepare(`SELECT * FROM ${ANALYTICS_SCHEMA}.fun_trial_votes WHERE trial_id = ? AND voter_jid = ?`)
        .get(tid, voter);

      if (existing) {
        return { ok: false, reason: 'already-voted' };
      }

      db.prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_trial_votes
         (trial_id, voter_jid, vote, vote_weight, voted_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(tid, voter, v, weight, now);

      if (v === 'guilty') {
        db.prepare(
          `UPDATE ${ANALYTICS_SCHEMA}.fun_trials
           SET guilty_votes = guilty_votes + 1
           WHERE id = ?`
        ).run(tid);
      } else {
        db.prepare(
          `UPDATE ${ANALYTICS_SCHEMA}.fun_trials
           SET innocent_votes = innocent_votes + 1
           WHERE id = ?`
        ).run(tid);
      }

      return { ok: true, vote: v, weight };
    })();
  }

  function getVotes(trialId) {
    ensureSchema();
    return getDatabase()
      .prepare(`SELECT * FROM ${ANALYTICS_SCHEMA}.fun_trial_votes WHERE trial_id = ? ORDER BY voted_at ASC`)
      .all(String(trialId || ''))
      .map((row) => ({
        trialId: String(row.trial_id || ''),
        voterJid: String(row.voter_jid || ''),
        vote: String(row.vote || ''),
        voteWeight: Number(row.vote_weight) || 1.0,
        votedAt: Number(row.voted_at) || 0,
      }));
  }

  function resolveTrial({ trialId, status, penaltyCoins = 0, now = Date.now() }) {
    ensureSchema();
    const tid = String(trialId || '').trim();
    const st = String(status || 'dismissed');

    const db = getDatabase();
    db.prepare(
      `UPDATE ${ANALYTICS_SCHEMA}.fun_trials
       SET status = ?, penalty_coins = ?, resolved_at = ?
       WHERE id = ?`
    ).run(st, Number(penaltyCoins) || 0, now, tid);

    return getTrial(tid);
  }

  return {
    createTrial,
    getTrial,
    getActiveTrial,
    castVote,
    getVotes,
    resolveTrial,
  };
}
