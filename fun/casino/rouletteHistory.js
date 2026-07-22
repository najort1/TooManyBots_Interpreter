const TABLE = 'analytics.fun_roulette_history';

export function createRouletteHistory({ getDatabase } = {}) {
  function db() {
    return typeof getDatabase === 'function' ? getDatabase() : null;
  }

  function init() {
    const d = db();
    if (!d) return false;
    d.exec(`
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        scope_key  TEXT    NOT NULL,
        ball       INTEGER NOT NULL,
        color      TEXT    NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    d.exec(`
      CREATE INDEX IF NOT EXISTS analytics.idx_fun_roulette_history_scope
        ON fun_roulette_history(scope_key, created_at DESC)
    `);
    return true;
  }

  function addResult(scopeKey, ball, color, now = Date.now()) {
    if (!init()) return;
    getDatabase()
      .prepare(
        `INSERT INTO ${TABLE} (scope_key, ball, color, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(String(scopeKey || ''), ball, String(color || ''), Number(now) || Date.now());
  }

  function getRecent(scopeKey, limit = 20) {
    if (!init()) return [];
    const rows = getDatabase()
      .prepare(
        `SELECT ball, color, created_at
         FROM ${TABLE}
         WHERE scope_key = ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(String(scopeKey || ''), Math.max(1, Math.min(200, Math.floor(Number(limit) || 20))));
    return rows.map(r => ({
      ball: Number(r.ball),
      color: String(r.color),
      createdAt: Number(r.created_at),
    }));
  }

  function getRecentReverse(scopeKey, limit = 20) {
    const rows = getRecent(scopeKey, limit);
    return rows.reverse();
  }

  function getColorStreak(scopeKey) {
    const rows = getRecentReverse(scopeKey, 50);
    if (!rows.length) return null;
    const first = rows[rows.length - 1];
    let count = 0;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].color === first.color) count++;
      else break;
    }
    return { color: first.color, count };
  }

  function countColorSince(scopeKey, color, since) {
    if (!init()) return 0;
    const row = getDatabase()
      .prepare(
        `SELECT COUNT(*) AS cnt
         FROM ${TABLE}
         WHERE scope_key = ? AND color = ? AND created_at >= ?`
      )
      .get(String(scopeKey || ''), String(color || ''), Number(since) || 0);
    return Number(row?.cnt) || 0;
  }

  function getNumberFrequency(scopeKey, since = 0) {
    if (!init()) return {};
    const rows = getDatabase()
      .prepare(
        `SELECT ball, COUNT(*) AS cnt
         FROM ${TABLE}
         WHERE scope_key = ? AND created_at >= ?
         GROUP BY ball
         ORDER BY cnt DESC`
      )
      .all(String(scopeKey || ''), Number(since) || 0);
    const freq = {};
    for (const r of rows) {
      freq[Number(r.ball)] = Number(r.cnt);
    }
    return freq;
  }

  function getTotalCount(scopeKey) {
    if (!init()) return 0;
    const row = getDatabase()
      .prepare(
        `SELECT COUNT(*) AS cnt FROM ${TABLE} WHERE scope_key = ?`
      )
      .get(String(scopeKey || ''));
    return Number(row?.cnt) || 0;
  }

  function getCountSince(scopeKey, since = 0) {
    if (!init()) return 0;
    const row = getDatabase()
      .prepare(
        `SELECT COUNT(*) AS cnt FROM ${TABLE} WHERE scope_key = ? AND created_at >= ?`
      )
      .get(String(scopeKey || ''), Number(since) || 0);
    return Number(row?.cnt) || 0;
  }

  return {
    addResult,
    getRecent,
    getRecentReverse,
    getColorStreak,
    countColorSince,
    getNumberFrequency,
    getTotalCount,
    getCountSince,
  };
}
