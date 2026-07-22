import { randomUUID } from 'node:crypto';
import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';

const ANALYTICS_SCHEMA = 'analytics';

function mapVoteRow(row) {
  if (!row) return null;
  return {
    id: String(row.id || ''),
    scopeKey: String(row.scope_key || ''),
    criadaEm: Number(row.criada_em) || 0,
    expiraEm: Number(row.expira_em) || 0,
    status: String(row.status || ''),
    votosSim: Number(row.votos_sim) || 0,
    votosNao: Number(row.votos_nao) || 0,
    totalMembros: Number(row.total_membros) || 0,
    resultado: String(row.resultado || ''),
    encerradaEm: Number(row.encerrada_em) || 0,
  };
}

export function createFunNsfwVoteRepository({ getDatabase = getDb } = {}) {
  function ensureSchema() {
    applyFunSchema(getDatabase());
  }

  function getActiveVote(scopeKey) {
    ensureSchema();
    const db = getDatabase();
    const row = db
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_nsfw_votes
         WHERE scope_key = ? AND status = 'active' AND expira_em > ?
         ORDER BY criada_em DESC LIMIT 1`
      )
      .get(String(scopeKey || ''), Date.now());
    return mapVoteRow(row);
  }

  function getVoteById(voteId) {
    ensureSchema();
    const db = getDatabase();
    const row = db
      .prepare(`SELECT * FROM ${ANALYTICS_SCHEMA}.fun_nsfw_votes WHERE id = ?`)
      .get(String(voteId || ''));
    return mapVoteRow(row);
  }

  function listRecentVotes(scopeKey, limit = 10) {
    ensureSchema();
    const db = getDatabase();
    const rows = db
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_nsfw_votes
         WHERE scope_key = ?
         ORDER BY criada_em DESC LIMIT ?`
      )
      .all(String(scopeKey || ''), Math.max(1, Math.floor(Number(limit) || 10)));
    return rows.map(mapVoteRow).filter(Boolean);
  }

  function createVote({ scopeKey, expiraEm, totalMembros = 0, agora = Date.now() }) {
    ensureSchema();
    const db = getDatabase();
    const id = randomUUID();
    db.prepare(
      `INSERT INTO ${ANALYTICS_SCHEMA}.fun_nsfw_votes
       (id, scope_key, criada_em, expira_em, status, votos_sim, votos_nao, total_membros, resultado, encerrada_em)
       VALUES (?, ?, ?, ?, 'active', 0, 0, ?, '', 0)`
    ).run(id, String(scopeKey || ''), agora, expiraEm, Math.floor(Number(totalMembros)) || 0);
    return getVoteById(id);
  }

  function registerVoto({ voteId, userJid, voto, agora = Date.now() }) {
    ensureSchema();
    const db = getDatabase();
    const existing = db
      .prepare(
        `SELECT 1 AS ok FROM ${ANALYTICS_SCHEMA}.fun_nsfw_vote_ballots
         WHERE vote_id = ? AND user_jid = ?`
      )
      .get(String(voteId || ''), String(userJid || ''));
    if (existing) return { ok: false, reason: 'duplicate' };

    const validVotos = new Set(['sim', 'nao']);
    const votoNorm = String(voto || '').trim().toLowerCase();
    if (!validVotos.has(votoNorm)) return { ok: false, reason: 'invalid-voto' };

    const voteRecord = getVoteById(voteId);
    if (!voteRecord) return { ok: false, reason: 'vote-not-found' };
    if (voteRecord.status !== 'active') return { ok: false, reason: 'vote-closed' };
    if (voteRecord.expiraEm <= agora) return { ok: false, reason: 'vote-expired' };

    const ballotId = randomUUID();
    db.prepare(
      `INSERT INTO ${ANALYTICS_SCHEMA}.fun_nsfw_vote_ballots
       (id, vote_id, user_jid, voto, criada_em)
       VALUES (?, ?, ?, ?, ?)`
    ).run(ballotId, voteId, String(userJid || ''), votoNorm, agora);

    const col = votoNorm === 'sim' ? 'votos_sim' : 'votos_nao';
    db.prepare(
      `UPDATE ${ANALYTICS_SCHEMA}.fun_nsfw_votes
       SET ${col} = ${col} + 1 WHERE id = ?`
    ).run(voteId);

    return { ok: true, voto: votoNorm, ballotId };
  }

  function hasUserVoted(voteId, userJid) {
    ensureSchema();
    const db = getDatabase();
    const row = db
      .prepare(
        `SELECT 1 AS ok FROM ${ANALYTICS_SCHEMA}.fun_nsfw_vote_ballots
         WHERE vote_id = ? AND user_jid = ?`
      )
      .get(String(voteId || ''), String(userJid || ''));
    return !!row;
  }

  function countBallots(voteId) {
    ensureSchema();
    const db = getDatabase();
    const row = db
      .prepare(
        `SELECT COUNT(*) AS total FROM ${ANALYTICS_SCHEMA}.fun_nsfw_vote_ballots WHERE vote_id = ?`
      )
      .get(String(voteId || ''));
    return Number(row?.total) || 0;
  }

  function encerrarVotacao({ voteId, resultado, agora = Date.now() }) {
    ensureSchema();
    const db = getDatabase();
    const resultNorm = String(resultado || '').trim().toLowerCase();
    if (resultNorm !== 'sim' && resultNorm !== 'nao' && resultNorm !== 'empate') {
      return { ok: false, reason: 'invalid-result' };
    }
    db.prepare(
      `UPDATE ${ANALYTICS_SCHEMA}.fun_nsfw_votes
       SET status = 'closed', resultado = ?, encerrada_em = ?
       WHERE id = ? AND status = 'active'`
    ).run(resultNorm, agora, String(voteId || ''));
    return getVoteById(voteId);
  }

  function setPermitirNsfw(scopeKey, permitir) {
    ensureSchema();
    const db = getDatabase();
    const permitirInt = permitir ? 1 : 0;
    const updatedAt = Date.now();

    const existing = db
      .prepare(`SELECT group_jid FROM ${ANALYTICS_SCHEMA}.fun_group_settings WHERE group_jid = ?`)
      .get(String(scopeKey || ''));
    if (existing) {
      db.prepare(
        `UPDATE ${ANALYTICS_SCHEMA}.fun_group_settings
         SET permitir_nsfw = ?, updated_at = ?
         WHERE group_jid = ?`
      ).run(permitirInt, updatedAt, String(scopeKey || ''));
    } else {
      db.prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_group_settings
         (group_jid, enabled, xp_min, xp_max, cooldown_ms, level_up_announce,
          daily_xp, daily_coins, rank_limit, world_events_enabled, permitir_nsfw, updated_at)
         VALUES (?, 1, 15, 25, 60000, 1, 150, 50, 10, 1, ?, ?)`
      ).run(String(scopeKey || ''), permitirInt, updatedAt);
    }
    return { ok: true, permitirNsfw: permitir };
  }

  function getPermitirNsfw(scopeKey) {
    ensureSchema();
    const db = getDatabase();
    const row = db
      .prepare(`SELECT permitir_nsfw FROM ${ANALYTICS_SCHEMA}.fun_group_settings WHERE group_jid = ?`)
      .get(String(scopeKey || ''));
    if (!row) return false;
    return Number(row.permitir_nsfw) !== 0;
  }

  return {
    getActiveVote,
    getVoteById,
    listRecentVotes,
    createVote,
    registerVoto,
    hasUserVoted,
    countBallots,
    encerrarVotacao,
    setPermitirNsfw,
    getPermitirNsfw,
  };
}
