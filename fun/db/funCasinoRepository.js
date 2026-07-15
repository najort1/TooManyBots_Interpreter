import { randomUUID } from 'node:crypto';
import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';

const ANALYTICS_SCHEMA = 'analytics';

function parseJson(raw, fallback) {
  try {
    return JSON.parse(String(raw || '')) ?? fallback;
  } catch {
    return fallback;
  }
}

export function createFunCasinoRepository({ getDatabase = getDb } = {}) {
  function ensureSchema() {
    applyFunSchema(getDatabase());
  }

  function getJackpot(scopeKey) {
    ensureSchema();
    const row = getDatabase()
      .prepare(`SELECT pot, updated_at FROM ${ANALYTICS_SCHEMA}.fun_jackpot WHERE scope_key = ?`)
      .get(String(scopeKey || ''));
    return {
      pot: Number(row?.pot) || 0,
      updatedAt: Number(row?.updated_at) || 0,
    };
  }

  function addJackpot(scopeKey, amount, now = Date.now()) {
    ensureSchema();
    const s = String(scopeKey || '');
    const add = Math.max(0, Math.floor(Number(amount) || 0));
    const ts = Number(now) || Date.now();
    if (!s || add <= 0) return getJackpot(s);
    getDatabase()
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_jackpot (scope_key, pot, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(scope_key) DO UPDATE SET
           pot = pot + excluded.pot,
           updated_at = excluded.updated_at`
      )
      .run(s, add, ts);
    return getJackpot(s);
  }

  function takeJackpot(scopeKey, now = Date.now()) {
    ensureSchema();
    const db = getDatabase();
    const s = String(scopeKey || '');
    const ts = Number(now) || Date.now();
    return db.transaction(() => {
      const row = db
        .prepare(`SELECT pot FROM ${ANALYTICS_SCHEMA}.fun_jackpot WHERE scope_key = ?`)
        .get(s);
      const pot = Number(row?.pot) || 0;
      if (pot <= 0) return { pot: 0, taken: 0 };
      db.prepare(
        `UPDATE ${ANALYTICS_SCHEMA}.fun_jackpot SET pot = 0, updated_at = ? WHERE scope_key = ?`
      ).run(ts, s);
      return { pot: 0, taken: pot };
    })();
  }

  function recordStats({
    userJid,
    scopeKey,
    wagered = 0,
    won = 0,
    lost = 0,
    games = 1,
    now = Date.now(),
  }) {
    ensureSchema();
    const u = String(userJid || '');
    const s = String(scopeKey || '');
    const ts = Number(now) || Date.now();
    if (!u || !s) return;
    getDatabase()
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_casino_stats
         (user_jid, scope_key, wagered, won, lost, games, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_jid, scope_key) DO UPDATE SET
           wagered = wagered + excluded.wagered,
           won = won + excluded.won,
           lost = lost + excluded.lost,
           games = games + excluded.games,
           updated_at = excluded.updated_at`
      )
      .run(
        u,
        s,
        Math.max(0, Math.floor(Number(wagered) || 0)),
        Math.max(0, Math.floor(Number(won) || 0)),
        Math.max(0, Math.floor(Number(lost) || 0)),
        Math.max(0, Math.floor(Number(games) || 0)),
        ts
      );
  }

  function getStats(userJid, scopeKey) {
    ensureSchema();
    const row = getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_casino_stats
         WHERE user_jid = ? AND scope_key = ?`
      )
      .get(String(userJid || ''), String(scopeKey || ''));
    if (!row) {
      return { userJid, scopeKey, wagered: 0, won: 0, lost: 0, games: 0, profit: 0 };
    }
    const won = Number(row.won) || 0;
    const lost = Number(row.lost) || 0;
    return {
      userJid: String(row.user_jid),
      scopeKey: String(row.scope_key),
      wagered: Number(row.wagered) || 0,
      won,
      lost,
      games: Number(row.games) || 0,
      profit: won - lost,
    };
  }

  function getLeaderboard(scopeKey, limit = 10) {
    ensureSchema();
    const rows = getDatabase()
      .prepare(
        `SELECT user_jid, wagered, won, lost, games, (won - lost) AS profit
         FROM ${ANALYTICS_SCHEMA}.fun_casino_stats
         WHERE scope_key = ?
         ORDER BY profit DESC, won DESC, games DESC
         LIMIT ?`
      )
      .all(String(scopeKey || ''), Math.max(1, Math.min(50, Math.floor(Number(limit) || 10))));
    return rows.map((r, i) => ({
      rank: i + 1,
      userJid: String(r.user_jid),
      wagered: Number(r.wagered) || 0,
      won: Number(r.won) || 0,
      lost: Number(r.lost) || 0,
      games: Number(r.games) || 0,
      profit: Number(r.profit) || 0,
    }));
  }

  function checkCooldown(userJid, scopeKey, game, cooldownMs, now = Date.now()) {
    ensureSchema();
    const cd = Math.max(0, Math.floor(Number(cooldownMs) || 0));
    if (cd <= 0) return { ok: true, retryInMs: 0 };
    const row = getDatabase()
      .prepare(
        `SELECT last_at FROM ${ANALYTICS_SCHEMA}.fun_casino_cooldowns
         WHERE user_jid = ? AND scope_key = ? AND game = ?`
      )
      .get(String(userJid || ''), String(scopeKey || ''), String(game || ''));
    const lastAt = Number(row?.last_at) || 0;
    const ts = Number(now) || Date.now();
    if (lastAt > 0 && ts - lastAt < cd) {
      return { ok: false, retryInMs: cd - (ts - lastAt) };
    }
    return { ok: true, retryInMs: 0 };
  }

  function touchCooldown(userJid, scopeKey, game, now = Date.now()) {
    ensureSchema();
    getDatabase()
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_casino_cooldowns
         (user_jid, scope_key, game, last_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_jid, scope_key, game) DO UPDATE SET last_at = excluded.last_at`
      )
      .run(String(userJid || ''), String(scopeKey || ''), String(game || ''), Number(now) || Date.now());
  }

  function purgeExpiredSessions(now = Date.now()) {
    ensureSchema();
    // bingo_room: limpeza com reembolso fica no casinoService (não apagar sem refund)
    getDatabase()
      .prepare(
        `DELETE FROM ${ANALYTICS_SCHEMA}.fun_casino_sessions
         WHERE expires_at < ? AND kind != 'bingo_room'`
      )
      .run(Number(now) || Date.now());
  }

  function mapSessionRow(row) {
    if (!row) return null;
    return {
      id: String(row.id),
      scopeKey: String(row.scope_key),
      userJid: String(row.user_jid),
      kind: String(row.kind),
      stake: Number(row.stake) || 0,
      state: parseJson(row.state_json, {}),
      expiresAt: Number(row.expires_at) || 0,
      createdAt: Number(row.created_at) || 0,
    };
  }

  function getSession(userJid, scopeKey, kind, now = Date.now()) {
    ensureSchema();
    purgeExpiredSessions(now);
    const row = getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_casino_sessions
         WHERE scope_key = ? AND user_jid = ? AND kind = ? AND expires_at >= ?
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(String(scopeKey || ''), String(userJid || ''), String(kind || ''), Number(now) || Date.now());
    return mapSessionRow(row);
  }

  /**
   * Sessão por scope/kind/user sem filtrar expires (ex.: bingo_room com refund).
   */
  function getSessionRaw(userJid, scopeKey, kind) {
    ensureSchema();
    const row = getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_casino_sessions
         WHERE scope_key = ? AND user_jid = ? AND kind = ?
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(String(scopeKey || ''), String(userJid || ''), String(kind || ''));
    return mapSessionRow(row);
  }

  function upsertSession({
    userJid,
    scopeKey,
    kind,
    stake,
    state,
    ttlMs,
    now = Date.now(),
    id = null,
  }) {
    ensureSchema();
    purgeExpiredSessions(now);
    const db = getDatabase();
    const ts = Number(now) || Date.now();
    const sessionId = id || randomUUID();
    const expiresAt = ts + Math.max(5_000, Math.floor(Number(ttlMs) || 60_000));

    // uma sessão ativa por user/kind/scope
    db.prepare(
      `DELETE FROM ${ANALYTICS_SCHEMA}.fun_casino_sessions
       WHERE scope_key = ? AND user_jid = ? AND kind = ?`
    ).run(String(scopeKey || ''), String(userJid || ''), String(kind || ''));

    db.prepare(
      `INSERT INTO ${ANALYTICS_SCHEMA}.fun_casino_sessions
       (id, scope_key, user_jid, kind, stake, state_json, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      sessionId,
      String(scopeKey || ''),
      String(userJid || ''),
      String(kind || ''),
      Math.max(0, Math.floor(Number(stake) || 0)),
      JSON.stringify(state || {}),
      expiresAt,
      ts
    );

    return getSessionRaw(userJid, scopeKey, kind) || getSession(userJid, scopeKey, kind, ts);
  }

  function updateSession(id, { state, expiresAt, stake } = {}) {
    ensureSchema();
    const db = getDatabase();
    const row = db
      .prepare(`SELECT * FROM ${ANALYTICS_SCHEMA}.fun_casino_sessions WHERE id = ?`)
      .get(String(id || ''));
    if (!row) return null;
    const nextState = state !== undefined ? state : parseJson(row.state_json, {});
    const nextExp = expiresAt !== undefined ? Number(expiresAt) : Number(row.expires_at);
    const nextStake = stake !== undefined ? Math.floor(Number(stake) || 0) : Number(row.stake) || 0;
    db.prepare(
      `UPDATE ${ANALYTICS_SCHEMA}.fun_casino_sessions
       SET state_json = ?, expires_at = ?, stake = ?
       WHERE id = ?`
    ).run(JSON.stringify(nextState || {}), nextExp, nextStake, String(id));
    return mapSessionRow({
      ...row,
      stake: nextStake,
      state_json: JSON.stringify(nextState || {}),
      expires_at: nextExp,
    });
  }

  function deleteSession(id) {
    ensureSchema();
    getDatabase()
      .prepare(`DELETE FROM ${ANALYTICS_SCHEMA}.fun_casino_sessions WHERE id = ?`)
      .run(String(id || ''));
  }

  function getOpenTournament(scopeKey) {
    ensureSchema();
    const row = getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_tournaments
         WHERE scope_key = ? AND status = 'open'
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(String(scopeKey || ''));
    return mapTournament(row);
  }

  function mapTournament(row) {
    if (!row) return null;
    return {
      id: String(row.id),
      scopeKey: String(row.scope_key),
      entryFee: Number(row.entry_fee) || 0,
      status: String(row.status || 'open'),
      players: parseJson(row.players_json, []),
      bracket: parseJson(row.bracket_json, {}),
      pot: Number(row.pot) || 0,
      winnerJid: String(row.winner_jid || ''),
      createdAt: Number(row.created_at) || 0,
      updatedAt: Number(row.updated_at) || 0,
    };
  }

  function createTournament({ scopeKey, entryFee, now = Date.now() }) {
    ensureSchema();
    const id = randomUUID();
    const ts = Number(now) || Date.now();
    getDatabase()
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_tournaments
         (id, scope_key, entry_fee, status, players_json, bracket_json, pot, winner_jid, created_at, updated_at)
         VALUES (?, ?, ?, 'open', '[]', '{}', 0, '', ?, ?)`
      )
      .run(id, String(scopeKey || ''), Math.max(0, Math.floor(Number(entryFee) || 0)), ts, ts);
    return getOpenTournament(scopeKey);
  }

  function saveTournament(t, now = Date.now()) {
    ensureSchema();
    getDatabase()
      .prepare(
        `UPDATE ${ANALYTICS_SCHEMA}.fun_tournaments
         SET status = ?, players_json = ?, bracket_json = ?, pot = ?, winner_jid = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        String(t.status || 'open'),
        JSON.stringify(t.players || []),
        JSON.stringify(t.bracket || {}),
        Math.max(0, Math.floor(Number(t.pot) || 0)),
        String(t.winnerJid || ''),
        Number(now) || Date.now(),
        String(t.id)
      );
    return mapTournament(
      getDatabase()
        .prepare(`SELECT * FROM ${ANALYTICS_SCHEMA}.fun_tournaments WHERE id = ?`)
        .get(String(t.id))
    );
  }

  return {
    getJackpot,
    addJackpot,
    takeJackpot,
    recordStats,
    getStats,
    getLeaderboard,
    checkCooldown,
    touchCooldown,
    getSession,
    getSessionRaw,
    upsertSession,
    updateSession,
    deleteSession,
    purgeExpiredSessions,
    getOpenTournament,
    createTournament,
    saveTournament,
  };
}
