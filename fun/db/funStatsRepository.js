import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';
import { levelFromTotalXp } from '../services/levelCurve.js';
import { DAY_MS } from '../constants.js';

const ANALYTICS_SCHEMA = 'analytics';

let schemaReady = false;

function mapStatsRow(row) {
  if (!row) return null;
  return {
    userJid: String(row.user_jid || ''),
    scopeKey: String(row.scope_key || ''),
    xp: Number(row.xp) || 0,
    level: Number(row.level) || 1,
    messageCount: Number(row.message_count) || 0,
    xpAwardedCount: Number(row.xp_awarded_count) || 0,
    coins: Number(row.coins) || 0,
    lastXpAt: Number(row.last_xp_at) || 0,
    lastDailyAt: Number(row.last_daily_at) || 0,
    dailyStreak: Number(row.daily_streak) || 0,
    lastFlipAt: Number(row.last_flip_at) || 0,
    lastJobAt: Number(row.last_job_at) || 0,
    lastLuckyAt: Number(row.last_lucky_at) || 0,
    title: String(row.title || '').trim(),
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
  };
}

function defaultStats(userJid, scopeKey, now = Date.now()) {
  return {
    userJid: String(userJid || ''),
    scopeKey: String(scopeKey || ''),
    xp: 0,
    level: 1,
    messageCount: 0,
    xpAwardedCount: 0,
    coins: 0,
    lastXpAt: 0,
    lastDailyAt: 0,
    dailyStreak: 0,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Cria o repositório de stats do módulo Fun.
 * Usa getDb() do core; schema auto-criado no init (decisão A).
 */
export function createFunStatsRepository({ getDatabase = getDb } = {}) {
  function ensureFunSchema() {
    if (schemaReady) return;
    const db = getDatabase();
    applyFunSchema(db);
    schemaReady = true;
  }

  /** @internal — apenas testes */
  function _resetSchemaFlag() {
    schemaReady = false;
  }

  function getUserStats(userJid, scopeKey) {
    ensureFunSchema();
    const db = getDatabase();
    const row = db
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_user_stats
         WHERE user_jid = ? AND scope_key = ?`
      )
      .get(String(userJid || ''), String(scopeKey || ''));
    return mapStatsRow(row);
  }

  function ensureUserRow(userJid, scopeKey, now = Date.now()) {
    const existing = getUserStats(userJid, scopeKey);
    if (existing) return existing;

    const db = getDatabase();
    const u = String(userJid || '');
    const s = String(scopeKey || '');
    const ts = Number(now) || Date.now();
    db.prepare(
      `INSERT OR IGNORE INTO ${ANALYTICS_SCHEMA}.fun_user_stats (
        user_jid, scope_key, xp, level, message_count, xp_awarded_count,
        coins, last_xp_at, last_daily_at, daily_streak, created_at, updated_at
      ) VALUES (?, ?, 0, 1, 0, 0, 0, 0, 0, 0, ?, ?)`
    ).run(u, s, ts, ts);

    return getUserStats(u, s) || defaultStats(u, s, ts);
  }

  /**
   * Award transacional de XP com cooldown.
   * @returns {{ applied: boolean, gained: number, xp: number, level: number, leveledUp: boolean, previousLevel: number, reason: string, messageCount: number, coins: number }}
   */
  function awardXp({ userJid, scopeKey, amount, now = Date.now(), cooldownMs = 60_000 }) {
    ensureFunSchema();
    const db = getDatabase();
    const u = String(userJid || '').trim();
    const s = String(scopeKey || '').trim();
    const gain = Math.max(0, Math.floor(Number(amount) || 0));
    const ts = Number(now) || Date.now();
    const cooldown = Math.max(0, Math.floor(Number(cooldownMs) || 0));

    if (!u || !s) {
      return {
        applied: false,
        gained: 0,
        xp: 0,
        level: 1,
        leveledUp: false,
        previousLevel: 1,
        reason: 'invalid-identity',
        messageCount: 0,
        coins: 0,
      };
    }

    if (gain <= 0) {
      const stats = ensureUserRow(u, s, ts);
      return {
        applied: false,
        gained: 0,
        xp: stats.xp,
        level: stats.level,
        leveledUp: false,
        previousLevel: stats.level,
        reason: 'zero-amount',
        messageCount: stats.messageCount,
        coins: stats.coins,
      };
    }

    const run = db.transaction(() => {
      const select = db.prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_user_stats
         WHERE user_jid = ? AND scope_key = ?`
      );
      let row = select.get(u, s);

      if (!row) {
        db.prepare(
          `INSERT INTO ${ANALYTICS_SCHEMA}.fun_user_stats (
            user_jid, scope_key, xp, level, message_count, xp_awarded_count,
            coins, last_xp_at, last_daily_at, daily_streak, created_at, updated_at
          ) VALUES (?, ?, 0, 1, 0, 0, 0, 0, 0, 0, ?, ?)`
        ).run(u, s, ts, ts);
        row = select.get(u, s);
      }

      const lastXpAt = Number(row.last_xp_at) || 0;
      if (cooldown > 0 && lastXpAt > 0 && ts - lastXpAt < cooldown) {
        // conta mensagem mesmo no cooldown de XP (rank de atividade)
        const nextMsg = (Number(row.message_count) || 0) + 1;
        db.prepare(
          `UPDATE ${ANALYTICS_SCHEMA}.fun_user_stats
           SET message_count = ?, updated_at = ?
           WHERE user_jid = ? AND scope_key = ?`
        ).run(nextMsg, ts, u, s);
        const stats = mapStatsRow(row);
        return {
          applied: false,
          gained: 0,
          xp: stats.xp,
          level: stats.level,
          leveledUp: false,
          previousLevel: stats.level,
          reason: 'cooldown',
          messageCount: nextMsg,
          coins: stats.coins,
        };
      }

      const previousLevel = Number(row.level) || 1;
      const nextXp = (Number(row.xp) || 0) + gain;
      const nextLevel = levelFromTotalXp(nextXp);
      const nextMessageCount = (Number(row.message_count) || 0) + 1;
      const nextAwarded = (Number(row.xp_awarded_count) || 0) + 1;

      db.prepare(
        `UPDATE ${ANALYTICS_SCHEMA}.fun_user_stats
         SET xp = ?, level = ?, message_count = ?, xp_awarded_count = ?,
             last_xp_at = ?, updated_at = ?
         WHERE user_jid = ? AND scope_key = ?`
      ).run(nextXp, nextLevel, nextMessageCount, nextAwarded, ts, ts, u, s);

      return {
        applied: true,
        gained: gain,
        xp: nextXp,
        level: nextLevel,
        leveledUp: nextLevel > previousLevel,
        previousLevel,
        reason: 'ok',
        messageCount: nextMessageCount,
        coins: Number(row.coins) || 0,
      };
    });

    return run();
  }

  /**
   * Claim daily 1x/24h com streak.
   * @returns {{ claimed: boolean, reason: string, xpGained: number, coinsGained: number, xp: number, level: number, leveledUp: boolean, previousLevel: number, dailyStreak: number, nextClaimAt: number, coins: number }}
   */
  function claimDaily({
    userJid,
    scopeKey,
    now = Date.now(),
    rewardXp = 150,
    rewardCoins = 50,
  }) {
    ensureFunSchema();
    const db = getDatabase();
    const u = String(userJid || '').trim();
    const s = String(scopeKey || '').trim();
    const ts = Number(now) || Date.now();
    const xpReward = Math.max(0, Math.floor(Number(rewardXp) || 0));
    const coinsReward = Math.max(0, Math.floor(Number(rewardCoins) || 0));

    if (!u || !s) {
      return {
        claimed: false,
        reason: 'invalid-identity',
        xpGained: 0,
        coinsGained: 0,
        xp: 0,
        level: 1,
        leveledUp: false,
        previousLevel: 1,
        dailyStreak: 0,
        nextClaimAt: 0,
        coins: 0,
      };
    }

    const run = db.transaction(() => {
      const select = db.prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_user_stats
         WHERE user_jid = ? AND scope_key = ?`
      );
      let row = select.get(u, s);

      if (!row) {
        db.prepare(
          `INSERT INTO ${ANALYTICS_SCHEMA}.fun_user_stats (
            user_jid, scope_key, xp, level, message_count, xp_awarded_count,
            coins, last_xp_at, last_daily_at, daily_streak, created_at, updated_at
          ) VALUES (?, ?, 0, 1, 0, 0, 0, 0, 0, 0, ?, ?)`
        ).run(u, s, ts, ts);
        row = select.get(u, s);
      }

      const lastDailyAt = Number(row.last_daily_at) || 0;
      if (lastDailyAt > 0 && ts - lastDailyAt < DAY_MS) {
        const stats = mapStatsRow(row);
        return {
          claimed: false,
          reason: 'already-claimed',
          xpGained: 0,
          coinsGained: 0,
          xp: stats.xp,
          level: stats.level,
          leveledUp: false,
          previousLevel: stats.level,
          dailyStreak: stats.dailyStreak,
          nextClaimAt: lastDailyAt + DAY_MS,
          coins: stats.coins,
        };
      }

      const previousStreak = Number(row.daily_streak) || 0;
      let nextStreak = 1;
      if (lastDailyAt > 0 && ts - lastDailyAt < 2 * DAY_MS) {
        nextStreak = previousStreak + 1;
      }

      const previousLevel = Number(row.level) || 1;
      const nextXp = (Number(row.xp) || 0) + xpReward;
      const nextLevel = levelFromTotalXp(nextXp);
      const nextCoins = (Number(row.coins) || 0) + coinsReward;

      db.prepare(
        `UPDATE ${ANALYTICS_SCHEMA}.fun_user_stats
         SET xp = ?, level = ?, coins = ?, last_daily_at = ?,
             daily_streak = ?, updated_at = ?
         WHERE user_jid = ? AND scope_key = ?`
      ).run(nextXp, nextLevel, nextCoins, ts, nextStreak, ts, u, s);

      return {
        claimed: true,
        reason: 'ok',
        xpGained: xpReward,
        coinsGained: coinsReward,
        xp: nextXp,
        level: nextLevel,
        leveledUp: nextLevel > previousLevel,
        previousLevel,
        dailyStreak: nextStreak,
        nextClaimAt: ts + DAY_MS,
        coins: nextCoins,
      };
    });

    return run();
  }

  function getLeaderboard(scopeKey, limit = 10) {
    ensureFunSchema();
    const db = getDatabase();
    const s = String(scopeKey || '');
    const lim = Math.max(1, Math.min(50, Math.floor(Number(limit) || 10)));

    const rows = db
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_user_stats
         WHERE scope_key = ?
         ORDER BY xp DESC, updated_at DESC
         LIMIT ?`
      )
      .all(s, lim);

    return rows.map((row, index) => ({
      rank: index + 1,
      ...mapStatsRow(row),
    }));
  }

  function getCoinsLeaderboard(scopeKey, limit = 10) {
    ensureFunSchema();
    const db = getDatabase();
    const s = String(scopeKey || '');
    const lim = Math.max(1, Math.min(50, Math.floor(Number(limit) || 10)));

    const rows = db
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_user_stats
         WHERE scope_key = ?
         ORDER BY coins DESC, updated_at DESC
         LIMIT ?`
      )
      .all(s, lim);

    return rows.map((row, index) => ({
      rank: index + 1,
      ...mapStatsRow(row),
    }));
  }

  function getUserCoinsRankPosition(userJid, scopeKey) {
    ensureFunSchema();
    const db = getDatabase();
    const u = String(userJid || '');
    const s = String(scopeKey || '');
    const stats = getUserStats(u, s);
    if (!stats) {
      const totalRow = db
        .prepare(
          `SELECT COUNT(*) AS total FROM ${ANALYTICS_SCHEMA}.fun_user_stats WHERE scope_key = ?`
        )
        .get(s);
      return { rank: null, total: Number(totalRow?.total) || 0, stats: null };
    }
    const better = db
      .prepare(
        `SELECT COUNT(*) AS better FROM ${ANALYTICS_SCHEMA}.fun_user_stats
         WHERE scope_key = ?
           AND (
             coins > ?
             OR (coins = ? AND updated_at > ?)
             OR (coins = ? AND updated_at = ? AND user_jid < ?)
           )`
      )
      .get(s, stats.coins, stats.coins, stats.updatedAt, stats.coins, stats.updatedAt, u);
    const totalRow = db
      .prepare(
        `SELECT COUNT(*) AS total FROM ${ANALYTICS_SCHEMA}.fun_user_stats WHERE scope_key = ?`
      )
      .get(s);
    return {
      rank: (Number(better?.better) || 0) + 1,
      total: Number(totalRow?.total) || 0,
      stats,
    };
  }

  function getMessagesLeaderboard(scopeKey, limit = 10) {
    ensureFunSchema();
    const db = getDatabase();
    const s = String(scopeKey || '');
    const lim = Math.max(1, Math.min(50, Math.floor(Number(limit) || 10)));

    const rows = db
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_user_stats
         WHERE scope_key = ? AND message_count > 0
         ORDER BY message_count DESC, updated_at DESC
         LIMIT ?`
      )
      .all(s, lim);

    return rows.map((row, index) => ({
      rank: index + 1,
      ...mapStatsRow(row),
    }));
  }

  function getUserMessagesRankPosition(userJid, scopeKey) {
    ensureFunSchema();
    const db = getDatabase();
    const u = String(userJid || '');
    const s = String(scopeKey || '');
    const stats = getUserStats(u, s);
    if (!stats || !stats.messageCount) {
      const totalRow = db
        .prepare(
          `SELECT COUNT(*) AS total FROM ${ANALYTICS_SCHEMA}.fun_user_stats
           WHERE scope_key = ? AND message_count > 0`
        )
        .get(s);
      return { rank: null, total: Number(totalRow?.total) || 0, stats: stats || null };
    }
    const better = db
      .prepare(
        `SELECT COUNT(*) AS better FROM ${ANALYTICS_SCHEMA}.fun_user_stats
         WHERE scope_key = ?
           AND message_count > 0
           AND (
             message_count > ?
             OR (message_count = ? AND updated_at > ?)
             OR (message_count = ? AND updated_at = ? AND user_jid < ?)
           )`
      )
      .get(
        s,
        stats.messageCount,
        stats.messageCount,
        stats.updatedAt,
        stats.messageCount,
        stats.updatedAt,
        u
      );
    const totalRow = db
      .prepare(
        `SELECT COUNT(*) AS total FROM ${ANALYTICS_SCHEMA}.fun_user_stats
         WHERE scope_key = ? AND message_count > 0`
      )
      .get(s);
    return {
      rank: (Number(better?.better) || 0) + 1,
      total: Number(totalRow?.total) || 0,
      stats,
    };
  }

  /**
   * Ajuste de coins com cooldown de jogo (flip/job/lucky).
   * @param {'flip'|'job'|'lucky'} game
   */
  function applyGameCoinDelta({
    userJid,
    scopeKey,
    delta,
    game,
    cooldownMs = 0,
    now = Date.now(),
    reason = 'game',
  }) {
    ensureFunSchema();
    const db = getDatabase();
    const u = String(userJid || '').trim();
    const s = String(scopeKey || '').trim();
    const value = Math.floor(Number(delta) || 0);
    const ts = Number(now) || Date.now();
    const cd = Math.max(0, Math.floor(Number(cooldownMs) || 0));
    const col =
      game === 'job' ? 'last_job_at' : game === 'lucky' ? 'last_lucky_at' : 'last_flip_at';

    if (!u || !s) return { ok: false, reason: 'invalid-identity' };

    const run = db.transaction(() => {
      ensureUserRow(u, s, ts);
      const row = db
        .prepare(
          `SELECT coins, last_flip_at, last_job_at, last_lucky_at
           FROM ${ANALYTICS_SCHEMA}.fun_user_stats
           WHERE user_jid = ? AND scope_key = ?`
        )
        .get(u, s);

      const lastAt =
        game === 'job'
          ? Number(row?.last_job_at) || 0
          : game === 'lucky'
            ? Number(row?.last_lucky_at) || 0
            : Number(row?.last_flip_at) || 0;

      if (cd > 0 && lastAt > 0 && ts - lastAt < cd) {
        return {
          ok: false,
          reason: 'cooldown',
          retryInMs: cd - (ts - lastAt),
          coins: Number(row?.coins) || 0,
        };
      }

      const coinsBefore = Number(row?.coins) || 0;
      if (value < 0 && coinsBefore < Math.abs(value)) {
        return {
          ok: false,
          reason: 'insufficient-funds',
          coins: coinsBefore,
        };
      }

      const coinsAfter = Math.max(0, coinsBefore + value);
      db.prepare(
        `UPDATE ${ANALYTICS_SCHEMA}.fun_user_stats
         SET coins = ?, ${col} = ?, updated_at = ?
         WHERE user_jid = ? AND scope_key = ?`
      ).run(coinsAfter, ts, ts, u, s);

      db.prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_coin_ledger
         (scope_key, from_jid, to_jid, amount, reason, created_at)
         VALUES (?, NULL, ?, ?, ?, ?)`
      ).run(s, u, value, String(reason || game || 'game'), ts);

      return {
        ok: true,
        reason: 'ok',
        coinsBefore,
        coinsAfter,
        delta: value,
      };
    });

    return run();
  }

  /**
   * Escrow: trava coins de 2 players para aposta (debita ambos).
   */
  function escrowBet({ scopeKey, aJid, bJid, amount, now = Date.now() }) {
    ensureFunSchema();
    const db = getDatabase();
    const s = String(scopeKey || '').trim();
    const a = String(aJid || '').trim();
    const b = String(bJid || '').trim();
    const value = Math.floor(Number(amount) || 0);
    const ts = Number(now) || Date.now();
    if (!s || !a || !b || value <= 0) return { ok: false, reason: 'invalid' };

    const run = db.transaction(() => {
      ensureUserRow(a, s, ts);
      ensureUserRow(b, s, ts);
      const select = db.prepare(
        `SELECT coins FROM ${ANALYTICS_SCHEMA}.fun_user_stats WHERE user_jid = ? AND scope_key = ?`
      );
      const aCoins = Number(select.get(a, s)?.coins) || 0;
      const bCoins = Number(select.get(b, s)?.coins) || 0;
      if (aCoins < value) return { ok: false, reason: 'a-insufficient', aCoins, bCoins };
      if (bCoins < value) return { ok: false, reason: 'b-insufficient', aCoins, bCoins };

      db.prepare(
        `UPDATE ${ANALYTICS_SCHEMA}.fun_user_stats SET coins = coins - ?, updated_at = ?
         WHERE user_jid = ? AND scope_key = ?`
      ).run(value, ts, a, s);
      db.prepare(
        `UPDATE ${ANALYTICS_SCHEMA}.fun_user_stats SET coins = coins - ?, updated_at = ?
         WHERE user_jid = ? AND scope_key = ?`
      ).run(value, ts, b, s);

      db.prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_coin_ledger
         (scope_key, from_jid, to_jid, amount, reason, created_at)
         VALUES (?, ?, 'escrow', ?, 'bet-lock', ?)`
      ).run(s, a, value, ts);
      db.prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_coin_ledger
         (scope_key, from_jid, to_jid, amount, reason, created_at)
         VALUES (?, ?, 'escrow', ?, 'bet-lock', ?)`
      ).run(s, b, value, ts);

      return {
        ok: true,
        pot: value * 2,
        aCoins: aCoins - value,
        bCoins: bCoins - value,
      };
    });
    return run();
  }

  function payoutBetWinner({ scopeKey, winnerJid, pot, now = Date.now() }) {
    ensureFunSchema();
    const db = getDatabase();
    const s = String(scopeKey || '').trim();
    const w = String(winnerJid || '').trim();
    const value = Math.floor(Number(pot) || 0);
    const ts = Number(now) || Date.now();
    if (!s || !w || value <= 0) return { ok: false };

    ensureUserRow(w, s, ts);
    db.prepare(
      `UPDATE ${ANALYTICS_SCHEMA}.fun_user_stats
       SET coins = coins + ?, updated_at = ?
       WHERE user_jid = ? AND scope_key = ?`
    ).run(value, ts, w, s);
    db.prepare(
      `INSERT INTO ${ANALYTICS_SCHEMA}.fun_coin_ledger
       (scope_key, from_jid, to_jid, amount, reason, created_at)
       VALUES (?, 'escrow', ?, ?, 'bet-win', ?)`
    ).run(s, w, value, ts);

    const coins = Number(
      db
        .prepare(
          `SELECT coins FROM ${ANALYTICS_SCHEMA}.fun_user_stats WHERE user_jid = ? AND scope_key = ?`
        )
        .get(w, s)?.coins
    ) || 0;
    return { ok: true, coins };
  }

  function setTitle({ userJid, scopeKey, title = '', now = Date.now() }) {
    ensureFunSchema();
    const db = getDatabase();
    const u = String(userJid || '').trim();
    const s = String(scopeKey || '').trim();
    const ts = Number(now) || Date.now();
    const t = String(title || '').trim().slice(0, 32);
    if (!u || !s) return { ok: false };
    ensureUserRow(u, s, ts);
    db.prepare(
      `UPDATE ${ANALYTICS_SCHEMA}.fun_user_stats
       SET title = ?, updated_at = ?
       WHERE user_jid = ? AND scope_key = ?`
    ).run(t, ts, u, s);
    return { ok: true, title: t };
  }

  function refundEscrow({ scopeKey, aJid, bJid, amount, now = Date.now() }) {
    ensureFunSchema();
    const db = getDatabase();
    const s = String(scopeKey || '').trim();
    const a = String(aJid || '').trim();
    const b = String(bJid || '').trim();
    const value = Math.floor(Number(amount) || 0);
    const ts = Number(now) || Date.now();
    if (!s || !a || !b || value <= 0) return { ok: false };

    const run = db.transaction(() => {
      ensureUserRow(a, s, ts);
      ensureUserRow(b, s, ts);
      db.prepare(
        `UPDATE ${ANALYTICS_SCHEMA}.fun_user_stats SET coins = coins + ?, updated_at = ?
         WHERE user_jid = ? AND scope_key = ?`
      ).run(value, ts, a, s);
      db.prepare(
        `UPDATE ${ANALYTICS_SCHEMA}.fun_user_stats SET coins = coins + ?, updated_at = ?
         WHERE user_jid = ? AND scope_key = ?`
      ).run(value, ts, b, s);
      return { ok: true };
    });
    return run();
  }

  function getUserRankPosition(userJid, scopeKey) {
    ensureFunSchema();
    const db = getDatabase();
    const u = String(userJid || '');
    const s = String(scopeKey || '');

    const stats = getUserStats(u, s);
    if (!stats) {
      const totalRow = db
        .prepare(
          `SELECT COUNT(*) AS total FROM ${ANALYTICS_SCHEMA}.fun_user_stats
           WHERE scope_key = ?`
        )
        .get(s);
      return { rank: null, total: Number(totalRow?.total) || 0, stats: null };
    }

    const better = db
      .prepare(
        `SELECT COUNT(*) AS better FROM ${ANALYTICS_SCHEMA}.fun_user_stats
         WHERE scope_key = ?
           AND (
             xp > ?
             OR (xp = ? AND updated_at > ?)
             OR (xp = ? AND updated_at = ? AND user_jid < ?)
           )`
      )
      .get(s, stats.xp, stats.xp, stats.updatedAt, stats.xp, stats.updatedAt, u);

    const totalRow = db
      .prepare(
        `SELECT COUNT(*) AS total FROM ${ANALYTICS_SCHEMA}.fun_user_stats
         WHERE scope_key = ?`
      )
      .get(s);

    return {
      rank: (Number(better?.better) || 0) + 1,
      total: Number(totalRow?.total) || 0,
      stats,
    };
  }

  /**
   * Transfere coins entre usuários no mesmo scope (transacional + ledger).
   */
  function transferCoins({
    fromJid,
    toJid,
    scopeKey,
    amount,
    now = Date.now(),
    reason = 'pay',
  }) {
    ensureFunSchema();
    const db = getDatabase();
    const from = String(fromJid || '').trim();
    const to = String(toJid || '').trim();
    const s = String(scopeKey || '').trim();
    const value = Math.floor(Number(amount) || 0);
    const ts = Number(now) || Date.now();

    if (!from || !to || !s) {
      return { ok: false, reason: 'invalid-identity' };
    }
    if (from === to) {
      return { ok: false, reason: 'self-transfer' };
    }
    if (value <= 0) {
      return { ok: false, reason: 'invalid-amount' };
    }

    const run = db.transaction(() => {
      ensureUserRow(from, s, ts);
      ensureUserRow(to, s, ts);

      const select = db.prepare(
        `SELECT coins FROM ${ANALYTICS_SCHEMA}.fun_user_stats
         WHERE user_jid = ? AND scope_key = ?`
      );
      const fromRow = select.get(from, s);
      const fromCoins = Number(fromRow?.coins) || 0;
      if (fromCoins < value) {
        return {
          ok: false,
          reason: 'insufficient-funds',
          fromCoins,
          toCoins: Number(select.get(to, s)?.coins) || 0,
        };
      }

      db.prepare(
        `UPDATE ${ANALYTICS_SCHEMA}.fun_user_stats
         SET coins = coins - ?, updated_at = ?
         WHERE user_jid = ? AND scope_key = ?`
      ).run(value, ts, from, s);

      db.prepare(
        `UPDATE ${ANALYTICS_SCHEMA}.fun_user_stats
         SET coins = coins + ?, updated_at = ?
         WHERE user_jid = ? AND scope_key = ?`
      ).run(value, ts, to, s);

      db.prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_coin_ledger
         (scope_key, from_jid, to_jid, amount, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(s, from, to, value, String(reason || 'pay'), ts);

      return {
        ok: true,
        reason: 'ok',
        amount: value,
        fromCoins: fromCoins - value,
        toCoins: (Number(select.get(to, s)?.coins) || 0),
      };
    });

    return run();
  }

  function addCoins({ userJid, scopeKey, amount, now = Date.now(), reason = 'system' }) {
    ensureFunSchema();
    const db = getDatabase();
    const u = String(userJid || '').trim();
    const s = String(scopeKey || '').trim();
    const value = Math.floor(Number(amount) || 0);
    const ts = Number(now) || Date.now();
    if (!u || !s || value === 0) {
      return { ok: false, reason: 'invalid', coins: 0 };
    }

    const run = db.transaction(() => {
      ensureUserRow(u, s, ts);
      db.prepare(
        `UPDATE ${ANALYTICS_SCHEMA}.fun_user_stats
         SET coins = CASE WHEN coins + ? < 0 THEN 0 ELSE coins + ? END,
             updated_at = ?
         WHERE user_jid = ? AND scope_key = ?`
      ).run(value, value, ts, u, s);

      db.prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_coin_ledger
         (scope_key, from_jid, to_jid, amount, reason, created_at)
         VALUES (?, NULL, ?, ?, ?, ?)`
      ).run(s, u, value, String(reason || 'system'), ts);

      const row = db
        .prepare(
          `SELECT coins FROM ${ANALYTICS_SCHEMA}.fun_user_stats
           WHERE user_jid = ? AND scope_key = ?`
        )
        .get(u, s);
      return { ok: true, coins: Number(row?.coins) || 0 };
    });

    return run();
  }

  function countUsersInScope(scopeKey) {
    ensureFunSchema();
    const db = getDatabase();
    const row = db
      .prepare(
        `SELECT COUNT(*) AS total FROM ${ANALYTICS_SCHEMA}.fun_user_stats
         WHERE scope_key = ?`
      )
      .get(String(scopeKey || ''));
    return Number(row?.total) || 0;
  }

  return {
    ensureFunSchema,
    getUserStats,
    ensureUserRow,
    awardXp,
    claimDaily,
    getLeaderboard,
    getCoinsLeaderboard,
    getMessagesLeaderboard,
    getUserRankPosition,
    getUserCoinsRankPosition,
    getUserMessagesRankPosition,
    transferCoins,
    addCoins,
    applyGameCoinDelta,
    escrowBet,
    payoutBetWinner,
    refundEscrow,
    setTitle,
    countUsersInScope,
    _resetSchemaFlag,
  };
}

/** Singleton lazy para uso padrão no runtime. */
let defaultRepo = null;

export function getFunStatsRepository() {
  if (!defaultRepo) {
    defaultRepo = createFunStatsRepository();
  }
  return defaultRepo;
}

/** @internal — testes */
export function _resetDefaultFunStatsRepository() {
  defaultRepo = null;
  schemaReady = false;
}
