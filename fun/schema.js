import { FUN_SCHEMA_VERSION } from './constants.js';

const ANALYTICS_SCHEMA = 'analytics';

/**
 * DDL do módulo Fun (analytics.*).
 * Schema auto-criado no boot do bot Fun (decisão A).
 */
export function buildFunSchemaSql() {
  return `
    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_user_stats (
      user_jid          TEXT    NOT NULL,
      scope_key         TEXT    NOT NULL,
      xp                INTEGER NOT NULL DEFAULT 0,
      level             INTEGER NOT NULL DEFAULT 1,
      message_count     INTEGER NOT NULL DEFAULT 0,
      xp_awarded_count  INTEGER NOT NULL DEFAULT 0,
      coins             INTEGER NOT NULL DEFAULT 0,
      last_xp_at        INTEGER NOT NULL DEFAULT 0,
      last_daily_at     INTEGER NOT NULL DEFAULT 0,
      daily_streak      INTEGER NOT NULL DEFAULT 0,
      created_at        INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL,
      PRIMARY KEY (user_jid, scope_key)
    );

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_stats_scope_xp
      ON fun_user_stats(scope_key, xp DESC, updated_at DESC);

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_stats_scope_level
      ON fun_user_stats(scope_key, level DESC, xp DESC);

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_stats_user
      ON fun_user_stats(user_jid);

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_group_settings (
      group_jid         TEXT PRIMARY KEY,
      enabled           INTEGER NOT NULL DEFAULT 1,
      xp_min            INTEGER NOT NULL DEFAULT 15,
      xp_max            INTEGER NOT NULL DEFAULT 25,
      cooldown_ms       INTEGER NOT NULL DEFAULT 60000,
      level_up_announce INTEGER NOT NULL DEFAULT 1,
      daily_xp          INTEGER NOT NULL DEFAULT 150,
      daily_coins       INTEGER NOT NULL DEFAULT 50,
      rank_limit        INTEGER NOT NULL DEFAULT 10,
      updated_at        INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_coin_ledger (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      scope_key   TEXT    NOT NULL,
      from_jid    TEXT,
      to_jid      TEXT    NOT NULL,
      amount      INTEGER NOT NULL,
      reason      TEXT    NOT NULL DEFAULT '',
      created_at  INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_coin_ledger_scope
      ON fun_coin_ledger(scope_key, created_at DESC);

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_marriages (
      scope_key    TEXT    NOT NULL,
      user_jid     TEXT    NOT NULL,
      partner_jid  TEXT    NOT NULL,
      married_at   INTEGER NOT NULL,
      PRIMARY KEY (scope_key, user_jid)
    );

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_marriages_partner
      ON fun_marriages(scope_key, partner_jid);

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_pending_actions (
      id           TEXT PRIMARY KEY,
      scope_key    TEXT    NOT NULL,
      action_type  TEXT    NOT NULL,
      from_jid     TEXT    NOT NULL,
      to_jid       TEXT    NOT NULL,
      payload_json TEXT    NOT NULL DEFAULT '{}',
      expires_at   INTEGER NOT NULL,
      created_at   INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_pending_to
      ON fun_pending_actions(scope_key, to_jid, expires_at);

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_pending_from
      ON fun_pending_actions(scope_key, from_jid, expires_at);

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_stats_scope_coins
      ON fun_user_stats(scope_key, coins DESC, updated_at DESC);

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_user_effects (
      user_jid      TEXT    NOT NULL,
      scope_key     TEXT    NOT NULL,
      effect_key    TEXT    NOT NULL,
      charges       INTEGER NOT NULL DEFAULT 0,
      expires_at    INTEGER NOT NULL DEFAULT 0,
      payload_json  TEXT    NOT NULL DEFAULT '{}',
      updated_at    INTEGER NOT NULL,
      PRIMARY KEY (user_jid, scope_key, effect_key)
    );

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_effects_scope
      ON fun_user_effects(scope_key, effect_key);

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_module_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `;
}

/**
 * @param {import('better-sqlite3').Database} db
 */
export function ensureFunSchema(db) {
  if (!db) throw new Error('[fun/schema] Database handle required');

  db.exec(buildFunSchemaSql());

  // Migra colunas opcionais (instalacoes antigas)
  try {
    const cols = db.prepare(`PRAGMA ${ANALYTICS_SCHEMA}.table_info(fun_group_settings)`).all();
    const names = new Set(cols.map(c => String(c.name || '')));
    if (!names.has('daily_xp')) {
      db.exec(`ALTER TABLE ${ANALYTICS_SCHEMA}.fun_group_settings ADD COLUMN daily_xp INTEGER NOT NULL DEFAULT 150`);
    }
    if (!names.has('daily_coins')) {
      db.exec(`ALTER TABLE ${ANALYTICS_SCHEMA}.fun_group_settings ADD COLUMN daily_coins INTEGER NOT NULL DEFAULT 50`);
    }
    if (!names.has('rank_limit')) {
      db.exec(`ALTER TABLE ${ANALYTICS_SCHEMA}.fun_group_settings ADD COLUMN rank_limit INTEGER NOT NULL DEFAULT 10`);
    }
  } catch {
    // ignore
  }

  try {
    const statsCols = db.prepare(`PRAGMA ${ANALYTICS_SCHEMA}.table_info(fun_user_stats)`).all();
    const statsNames = new Set(statsCols.map(c => String(c.name || '')));
    if (!statsNames.has('last_flip_at')) {
      db.exec(`ALTER TABLE ${ANALYTICS_SCHEMA}.fun_user_stats ADD COLUMN last_flip_at INTEGER NOT NULL DEFAULT 0`);
    }
    if (!statsNames.has('last_job_at')) {
      db.exec(`ALTER TABLE ${ANALYTICS_SCHEMA}.fun_user_stats ADD COLUMN last_job_at INTEGER NOT NULL DEFAULT 0`);
    }
    if (!statsNames.has('last_lucky_at')) {
      db.exec(`ALTER TABLE ${ANALYTICS_SCHEMA}.fun_user_stats ADD COLUMN last_lucky_at INTEGER NOT NULL DEFAULT 0`);
    }
    if (!statsNames.has('title')) {
      db.exec(`ALTER TABLE ${ANALYTICS_SCHEMA}.fun_user_stats ADD COLUMN title TEXT NOT NULL DEFAULT ''`);
    }
  } catch {
    // ignore
  }

  const upsertMeta = db.prepare(`
    INSERT INTO ${ANALYTICS_SCHEMA}.fun_module_meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  upsertMeta.run('schema_version', FUN_SCHEMA_VERSION);
}
