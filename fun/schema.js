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
      group_jid              TEXT PRIMARY KEY,
      enabled                INTEGER NOT NULL DEFAULT 1,
      xp_min                 INTEGER NOT NULL DEFAULT 15,
      xp_max                 INTEGER NOT NULL DEFAULT 25,
      cooldown_ms            INTEGER NOT NULL DEFAULT 60000,
      level_up_announce      INTEGER NOT NULL DEFAULT 1,
      daily_xp               INTEGER NOT NULL DEFAULT 150,
      daily_coins            INTEGER NOT NULL DEFAULT 50,
      rank_limit             INTEGER NOT NULL DEFAULT 10,
      world_events_enabled   INTEGER NOT NULL DEFAULT 1,
      updated_at             INTEGER NOT NULL
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

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_factions (
      id            TEXT PRIMARY KEY,
      scope_key     TEXT    NOT NULL,
      name          TEXT    NOT NULL,
      name_key      TEXT    NOT NULL,
      emoji         TEXT    NOT NULL DEFAULT '🏴‍☠️',
      leader_jid    TEXT    NOT NULL,
      vault_coins   INTEGER NOT NULL DEFAULT 0,
      motto         TEXT    NOT NULL DEFAULT '',
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL,
      UNIQUE (scope_key, name_key)
    );

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_factions_scope
      ON fun_factions(scope_key);

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_faction_members (
      scope_key     TEXT    NOT NULL,
      user_jid      TEXT    NOT NULL,
      faction_id    TEXT    NOT NULL,
      role          TEXT    NOT NULL DEFAULT 'member',
      joined_at     INTEGER NOT NULL,
      PRIMARY KEY (scope_key, user_jid)
    );

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_faction_members_fac
      ON fun_faction_members(faction_id);

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_social_edges (
      scope_key     TEXT    NOT NULL,
      from_jid      TEXT    NOT NULL,
      to_jid        TEXT    NOT NULL,
      kind          TEXT    NOT NULL,
      week_key      TEXT    NOT NULL,
      count         INTEGER NOT NULL DEFAULT 0,
      updated_at    INTEGER NOT NULL,
      PRIMARY KEY (scope_key, from_jid, to_jid, kind, week_key)
    );

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_social_week
      ON fun_social_edges(scope_key, week_key);

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_mixed_missions (
      id            TEXT PRIMARY KEY,
      scope_key     TEXT    NOT NULL,
      status        TEXT    NOT NULL DEFAULT 'active',
      members_json  TEXT    NOT NULL,
      goals_json    TEXT    NOT NULL,
      progress_json TEXT    NOT NULL DEFAULT '{}',
      reward_each   INTEGER NOT NULL DEFAULT 30,
      expires_at    INTEGER NOT NULL,
      created_at    INTEGER NOT NULL,
      completed_at  INTEGER
    );

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_missions_scope
      ON fun_mixed_missions(scope_key, status, expires_at);

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_scope_events (
      scope_key     TEXT PRIMARY KEY,
      event_type    TEXT    NOT NULL DEFAULT 'none',
      multiplier    REAL    NOT NULL DEFAULT 1,
      starts_at     INTEGER NOT NULL DEFAULT 0,
      ends_at       INTEGER NOT NULL DEFAULT 0,
      last_spawn_at INTEGER NOT NULL DEFAULT 0,
      payload_json  TEXT    NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_module_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_jackpot (
      scope_key   TEXT PRIMARY KEY,
      pot         INTEGER NOT NULL DEFAULT 0,
      updated_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_casino_stats (
      user_jid    TEXT    NOT NULL,
      scope_key   TEXT    NOT NULL,
      wagered     INTEGER NOT NULL DEFAULT 0,
      won         INTEGER NOT NULL DEFAULT 0,
      lost        INTEGER NOT NULL DEFAULT 0,
      games       INTEGER NOT NULL DEFAULT 0,
      updated_at  INTEGER NOT NULL,
      PRIMARY KEY (user_jid, scope_key)
    );

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_casino_stats_scope
      ON fun_casino_stats(scope_key, won DESC, lost ASC);

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_casino_sessions (
      id          TEXT PRIMARY KEY,
      scope_key   TEXT    NOT NULL,
      user_jid    TEXT    NOT NULL,
      kind        TEXT    NOT NULL,
      stake       INTEGER NOT NULL DEFAULT 0,
      state_json  TEXT    NOT NULL DEFAULT '{}',
      expires_at  INTEGER NOT NULL,
      created_at  INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_casino_sessions_user
      ON fun_casino_sessions(scope_key, user_jid, kind, expires_at);

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_casino_cooldowns (
      user_jid    TEXT    NOT NULL,
      scope_key   TEXT    NOT NULL,
      game        TEXT    NOT NULL,
      last_at     INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_jid, scope_key, game)
    );

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_tournaments (
      id            TEXT PRIMARY KEY,
      scope_key     TEXT    NOT NULL,
      entry_fee     INTEGER NOT NULL DEFAULT 0,
      status        TEXT    NOT NULL DEFAULT 'open',
      players_json  TEXT    NOT NULL DEFAULT '[]',
      bracket_json  TEXT    NOT NULL DEFAULT '{}',
      pot           INTEGER NOT NULL DEFAULT 0,
      winner_jid    TEXT    NOT NULL DEFAULT '',
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_tournaments_scope
      ON fun_tournaments(scope_key, status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_roulette_history (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      scope_key  TEXT    NOT NULL,
      ball       INTEGER NOT NULL,
      color      TEXT    NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_roulette_history_scope
      ON fun_roulette_history(scope_key, created_at DESC);

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_user_prefs (
      user_jid              TEXT PRIMARY KEY,
      preferred_scope_key   TEXT    NOT NULL DEFAULT '',
      last_group_jid        TEXT    NOT NULL DEFAULT '',
      updated_at            INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_market_prices (
      scope_key       TEXT    NOT NULL,
      item_id         TEXT    NOT NULL,
      price           INTEGER NOT NULL,
      previous_price  INTEGER NOT NULL DEFAULT 0,
      trend           TEXT    NOT NULL DEFAULT 'flat',
      last_event_id   TEXT    NOT NULL DEFAULT '',
      updated_at      INTEGER NOT NULL,
      PRIMARY KEY (scope_key, item_id)
    );

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_market_events (
      id              TEXT PRIMARY KEY,
      scope_key       TEXT    NOT NULL,
      title           TEXT    NOT NULL,
      description     TEXT    NOT NULL DEFAULT '',
      category        TEXT    NOT NULL DEFAULT '',
      impact_pct      REAL    NOT NULL DEFAULT 0,
      source          TEXT    NOT NULL DEFAULT 'template',
      created_at      INTEGER NOT NULL,
      archetype       TEXT    NOT NULL DEFAULT '',
      deception_mode  TEXT    NOT NULL DEFAULT 'none',
      company_id      TEXT    NOT NULL DEFAULT '',
      truth_json      TEXT    NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_market_asset_state (
      scope_key       TEXT    NOT NULL,
      item_id         TEXT    NOT NULL,
      supply          REAL    NOT NULL DEFAULT 1,
      demand          REAL    NOT NULL DEFAULT 1,
      event_shock     REAL    NOT NULL DEFAULT 0,
      volume_buy      REAL    NOT NULL DEFAULT 0,
      volume_sell     REAL    NOT NULL DEFAULT 0,
      updated_at      INTEGER NOT NULL,
      PRIMARY KEY (scope_key, item_id)
    );

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_market_events_scope
      ON fun_market_events(scope_key, created_at DESC);

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_market_price_history (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      scope_key       TEXT    NOT NULL,
      item_id         TEXT    NOT NULL,
      price           INTEGER NOT NULL,
      previous_price  INTEGER NOT NULL DEFAULT 0,
      event_id        TEXT    NOT NULL DEFAULT '',
      created_at      INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_market_hist
      ON fun_market_price_history(scope_key, item_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_stock_quotes (
      scope_key       TEXT    NOT NULL,
      company_id      TEXT    NOT NULL,
      price           INTEGER NOT NULL,
      previous_price  INTEGER NOT NULL DEFAULT 0,
      high_price      INTEGER NOT NULL DEFAULT 0,
      trend           TEXT    NOT NULL DEFAULT 'flat',
      supply          REAL    NOT NULL DEFAULT 1,
      demand          REAL    NOT NULL DEFAULT 1,
      event_shock     REAL    NOT NULL DEFAULT 0,
      volume_buy      REAL    NOT NULL DEFAULT 0,
      volume_sell     REAL    NOT NULL DEFAULT 0,
      updated_at      INTEGER NOT NULL,
      PRIMARY KEY (scope_key, company_id)
    );

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_stock_holdings (
      user_jid          TEXT    NOT NULL,
      scope_key         TEXT    NOT NULL,
      company_id        TEXT    NOT NULL,
      qty               INTEGER NOT NULL DEFAULT 0,
      avg_cost          INTEGER NOT NULL DEFAULT 0,
      last_dividend_at  INTEGER NOT NULL DEFAULT 0,
      updated_at        INTEGER NOT NULL,
      PRIMARY KEY (user_jid, scope_key, company_id)
    );

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_stock_holdings_scope
      ON fun_stock_holdings(scope_key, user_jid);

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_stock_trade_meta (
      user_jid        TEXT    NOT NULL,
      scope_key       TEXT    NOT NULL,
      last_trade_at   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_jid, scope_key)
    );

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_stock_price_history (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      scope_key       TEXT    NOT NULL,
      company_id      TEXT    NOT NULL,
      price           INTEGER NOT NULL,
      previous_price  INTEGER NOT NULL DEFAULT 0,
      high_price      INTEGER NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_stock_hist
      ON fun_stock_price_history(scope_key, company_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_market_meta (
      scope_key       TEXT PRIMARY KEY,
      last_event_at   INTEGER NOT NULL DEFAULT 0,
      next_event_at   INTEGER NOT NULL DEFAULT 0,
      last_restock_at INTEGER NOT NULL DEFAULT 0,
      updated_at      INTEGER NOT NULL,
      economy_json    TEXT    NOT NULL DEFAULT '{}',
      last_economy_tick_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_inventory (
      id              TEXT PRIMARY KEY,
      user_jid        TEXT    NOT NULL,
      scope_key       TEXT    NOT NULL,
      item_id         TEXT    NOT NULL,
      condition       TEXT    NOT NULL DEFAULT 'ok',
      acquired_at     INTEGER NOT NULL,
      acquired_price  INTEGER NOT NULL DEFAULT 0,
      broken_at       INTEGER NOT NULL DEFAULT 0,
      uses_left       INTEGER NOT NULL DEFAULT -1
    );

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_market_stock (
      scope_key       TEXT    NOT NULL,
      item_id         TEXT    NOT NULL,
      stock           INTEGER NOT NULL DEFAULT 0,
      updated_at      INTEGER NOT NULL,
      PRIMARY KEY (scope_key, item_id)
    );

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_inventory_user
      ON fun_inventory(scope_key, user_jid);

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_bazaar_listings (
      id              TEXT PRIMARY KEY,
      scope_key       TEXT    NOT NULL,
      seller_jid      TEXT    NOT NULL,
      inventory_id    TEXT    NOT NULL,
      item_id         TEXT    NOT NULL,
      price           INTEGER NOT NULL,
      created_at      INTEGER NOT NULL,
      status          TEXT    NOT NULL DEFAULT 'open'
    );

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_bazaar_scope
      ON fun_bazaar_listings(scope_key, status, created_at DESC);

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_user_jobs (
      user_jid        TEXT    NOT NULL,
      scope_key       TEXT    NOT NULL,
      job_id          TEXT    NOT NULL,
      hired_at        INTEGER NOT NULL,
      missed_dailies  INTEGER NOT NULL DEFAULT 0,
      updated_at      INTEGER NOT NULL,
      PRIMARY KEY (user_jid, scope_key)
    );

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_user_jobs_scope
      ON fun_user_jobs(scope_key, job_id);

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_job_attempts (
      id              TEXT PRIMARY KEY,
      user_jid        TEXT    NOT NULL,
      scope_key       TEXT    NOT NULL,
      job_id          TEXT    NOT NULL,
      status          TEXT    NOT NULL DEFAULT 'pending',
      code            TEXT    NOT NULL DEFAULT '',
      token_nonce     TEXT    NOT NULL DEFAULT '',
      score           INTEGER NOT NULL DEFAULT 0,
      metrics_json    TEXT    NOT NULL DEFAULT '{}',
      practice_used   INTEGER NOT NULL DEFAULT 0,
      practice_score  INTEGER NOT NULL DEFAULT 0,
      practice_at     INTEGER NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL,
      started_at      INTEGER NOT NULL DEFAULT 0,
      finished_at     INTEGER NOT NULL DEFAULT 0,
      expires_at      INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_job_attempts_user
      ON fun_job_attempts(scope_key, user_jid, job_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_job_attempts_code
      ON fun_job_attempts(code);

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_job_cooldowns (
      user_jid          TEXT    NOT NULL,
      scope_key         TEXT    NOT NULL,
      job_id            TEXT    NOT NULL,
      next_attempt_at   INTEGER NOT NULL DEFAULT 0,
      attempt_count     INTEGER NOT NULL DEFAULT 0,
      updated_at        INTEGER NOT NULL,
      PRIMARY KEY (user_jid, scope_key, job_id)
    );

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_group_memories (
      id            TEXT PRIMARY KEY,
      scope_key     TEXT    NOT NULL,
      kind          TEXT    NOT NULL DEFAULT 'event',
      summary       TEXT    NOT NULL,
      subjects_json TEXT    NOT NULL DEFAULT '[]',
      keywords_json TEXT    NOT NULL DEFAULT '[]',
      score         INTEGER NOT NULL DEFAULT 50,
      hits          INTEGER NOT NULL DEFAULT 1,
      source        TEXT    NOT NULL DEFAULT 'chat',
      created_at    INTEGER NOT NULL,
      last_seen_at  INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_group_memories_scope_score
      ON fun_group_memories(scope_key, score DESC, last_seen_at DESC);

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_group_memories_scope_seen
      ON fun_group_memories(scope_key, last_seen_at DESC);

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_group_persona (
      scope_key     TEXT PRIMARY KEY,
      persona_text  TEXT    NOT NULL DEFAULT '',
      fact_count    INTEGER NOT NULL DEFAULT 0,
      updated_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_user_profiles (
      user_jid       TEXT    NOT NULL,
      scope_key      TEXT    NOT NULL,
      nickname       TEXT    NOT NULL DEFAULT '',
      bio            TEXT    NOT NULL DEFAULT '',
      birthday_md    TEXT    NOT NULL DEFAULT '',
      title          TEXT    NOT NULL DEFAULT '',
      raw_note       TEXT    NOT NULL DEFAULT '',
      updated_at     INTEGER NOT NULL,
      PRIMARY KEY (user_jid, scope_key)
    );

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_profiles_scope_bday
      ON fun_user_profiles(scope_key, birthday_md);

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_profiles_scope_nick
      ON fun_user_profiles(scope_key, nickname);

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_birthday_announced (
      scope_key     TEXT    NOT NULL,
      user_jid      TEXT    NOT NULL,
      year          INTEGER NOT NULL,
      announced_at  INTEGER NOT NULL,
      PRIMARY KEY (scope_key, user_jid, year)
    );

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_properties (
      id              TEXT PRIMARY KEY,
      scope_key       TEXT    NOT NULL,
      user_jid        TEXT    NOT NULL,
      property_type   TEXT    NOT NULL,
      health          REAL    NOT NULL DEFAULT 100,
      buffer_coins    INTEGER NOT NULL DEFAULT 0,
      last_tick_at    INTEGER NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL,
      UNIQUE(scope_key, user_jid, property_type)
    );

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_properties_scope
      ON fun_properties(scope_key);

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_properties_user
      ON fun_properties(scope_key, user_jid);

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_daily_events (
      id            TEXT PRIMARY KEY,
      scope_key     TEXT    NOT NULL,
      event_type    TEXT    NOT NULL,
      user_jid      TEXT,
      payload_json  TEXT    NOT NULL DEFAULT '{}',
      created_at    INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_daily_events_scope
      ON fun_daily_events(scope_key, created_at DESC);

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_group_news_meta (
      scope_key              TEXT PRIMARY KEY,
      last_daily_news_day    TEXT    NOT NULL DEFAULT '',
      updated_at             INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_achievements (
      user_jid         TEXT    NOT NULL,
      scope_key        TEXT    NOT NULL,
      achievement_id   TEXT    NOT NULL,
      unlocked_at      INTEGER NOT NULL,
      PRIMARY KEY (user_jid, scope_key, achievement_id)
    );

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_achievements_scope
      ON fun_achievements(scope_key, user_jid);

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_achievement_progress (
      user_jid     TEXT    NOT NULL,
      scope_key    TEXT    NOT NULL,
      counter_key  TEXT    NOT NULL,
      value        INTEGER NOT NULL DEFAULT 0,
      updated_at   INTEGER NOT NULL,
      PRIMARY KEY (user_jid, scope_key, counter_key)
    );

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_nsfw_votes (
      id              TEXT PRIMARY KEY,
      scope_key       TEXT    NOT NULL,
      criada_em       INTEGER NOT NULL,
      expira_em       INTEGER NOT NULL,
      status          TEXT    NOT NULL DEFAULT 'active',
      votos_sim       INTEGER NOT NULL DEFAULT 0,
      votos_nao       INTEGER NOT NULL DEFAULT 0,
      total_membros   INTEGER NOT NULL DEFAULT 0,
      resultado       TEXT    NOT NULL DEFAULT '',
      encerrada_em    INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_nsfw_votes_scope
      ON fun_nsfw_votes(scope_key, status, expira_em);

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_nsfw_vote_ballots (
      id              TEXT PRIMARY KEY,
      vote_id         TEXT    NOT NULL,
      user_jid        TEXT    NOT NULL,
      voto            TEXT    NOT NULL,
      criada_em       INTEGER NOT NULL,
      UNIQUE(vote_id, user_jid)
    );

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_nsfw_ballots_vote
      ON fun_nsfw_vote_ballots(vote_id);

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_changelog_broadcasts (
      id              TEXT PRIMARY KEY,
      title           TEXT    NOT NULL DEFAULT '',
      version         TEXT    NOT NULL DEFAULT '',
      body            TEXT    NOT NULL,
      message_text    TEXT    NOT NULL,
      target_count    INTEGER NOT NULL DEFAULT 0,
      ok_count        INTEGER NOT NULL DEFAULT 0,
      fail_count      INTEGER NOT NULL DEFAULT 0,
      dry_run         INTEGER NOT NULL DEFAULT 0,
      results_json    TEXT    NOT NULL DEFAULT '[]',
      created_at      INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_changelog_created
      ON fun_changelog_broadcasts(created_at DESC);
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
    if (!names.has('world_events_enabled')) {
      db.exec(
        `ALTER TABLE ${ANALYTICS_SCHEMA}.fun_group_settings ADD COLUMN world_events_enabled INTEGER NOT NULL DEFAULT 1`
      );
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

  try {
    const invCols = db.prepare(`PRAGMA ${ANALYTICS_SCHEMA}.table_info(fun_inventory)`).all();
    const invNames = new Set(invCols.map((c) => String(c.name || '')));
    if (invNames.size && !invNames.has('uses_left')) {
      db.exec(
        `ALTER TABLE ${ANALYTICS_SCHEMA}.fun_inventory ADD COLUMN uses_left INTEGER NOT NULL DEFAULT -1`
      );
    }
  } catch {
    // ignore
  }

  try {
    const metaCols = db.prepare(`PRAGMA ${ANALYTICS_SCHEMA}.table_info(fun_market_meta)`).all();
    const metaNames = new Set(metaCols.map((c) => String(c.name || '')));
    if (metaNames.size && !metaNames.has('last_restock_at')) {
      db.exec(
        `ALTER TABLE ${ANALYTICS_SCHEMA}.fun_market_meta ADD COLUMN last_restock_at INTEGER NOT NULL DEFAULT 0`
      );
    }
    if (metaNames.size && !metaNames.has('economy_json')) {
      db.exec(
        `ALTER TABLE ${ANALYTICS_SCHEMA}.fun_market_meta ADD COLUMN economy_json TEXT NOT NULL DEFAULT '{}'`
      );
    }
    if (metaNames.size && !metaNames.has('last_economy_tick_at')) {
      db.exec(
        `ALTER TABLE ${ANALYTICS_SCHEMA}.fun_market_meta ADD COLUMN last_economy_tick_at INTEGER NOT NULL DEFAULT 0`
      );
    }
  } catch {
    // ignore
  }

  try {
    const evCols = db.prepare(`PRAGMA ${ANALYTICS_SCHEMA}.table_info(fun_market_events)`).all();
    const evNames = new Set(evCols.map((c) => String(c.name || '')));
    if (evNames.size && !evNames.has('archetype')) {
      db.exec(
        `ALTER TABLE ${ANALYTICS_SCHEMA}.fun_market_events ADD COLUMN archetype TEXT NOT NULL DEFAULT ''`
      );
    }
    if (evNames.size && !evNames.has('deception_mode')) {
      db.exec(
        `ALTER TABLE ${ANALYTICS_SCHEMA}.fun_market_events ADD COLUMN deception_mode TEXT NOT NULL DEFAULT 'none'`
      );
    }
    if (evNames.size && !evNames.has('company_id')) {
      db.exec(
        `ALTER TABLE ${ANALYTICS_SCHEMA}.fun_market_events ADD COLUMN company_id TEXT NOT NULL DEFAULT ''`
      );
    }
    if (evNames.size && !evNames.has('truth_json')) {
      db.exec(
        `ALTER TABLE ${ANALYTICS_SCHEMA}.fun_market_events ADD COLUMN truth_json TEXT NOT NULL DEFAULT '{}'`
      );
    }
  } catch {
    // ignore
  }

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_market_asset_state (
        scope_key       TEXT    NOT NULL,
        item_id         TEXT    NOT NULL,
        supply          REAL    NOT NULL DEFAULT 1,
        demand          REAL    NOT NULL DEFAULT 1,
        event_shock     REAL    NOT NULL DEFAULT 0,
        volume_buy      REAL    NOT NULL DEFAULT 0,
        volume_sell     REAL    NOT NULL DEFAULT 0,
        updated_at      INTEGER NOT NULL,
        PRIMARY KEY (scope_key, item_id)
      );
    `);
  } catch {
    // ignore
  }

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_stock_quotes (
        scope_key       TEXT    NOT NULL,
        company_id      TEXT    NOT NULL,
        price           INTEGER NOT NULL,
        previous_price  INTEGER NOT NULL DEFAULT 0,
        high_price      INTEGER NOT NULL DEFAULT 0,
        trend           TEXT    NOT NULL DEFAULT 'flat',
        supply          REAL    NOT NULL DEFAULT 1,
        demand          REAL    NOT NULL DEFAULT 1,
        event_shock     REAL    NOT NULL DEFAULT 0,
        volume_buy      REAL    NOT NULL DEFAULT 0,
        volume_sell     REAL    NOT NULL DEFAULT 0,
        updated_at      INTEGER NOT NULL,
        PRIMARY KEY (scope_key, company_id)
      );

      CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_stock_holdings (
        user_jid          TEXT    NOT NULL,
        scope_key         TEXT    NOT NULL,
        company_id        TEXT    NOT NULL,
        qty               INTEGER NOT NULL DEFAULT 0,
        avg_cost          INTEGER NOT NULL DEFAULT 0,
        last_dividend_at  INTEGER NOT NULL DEFAULT 0,
        updated_at        INTEGER NOT NULL,
        PRIMARY KEY (user_jid, scope_key, company_id)
      );

      CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_stock_holdings_scope
        ON fun_stock_holdings(scope_key, user_jid);

      CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_stock_trade_meta (
        user_jid        TEXT    NOT NULL,
        scope_key       TEXT    NOT NULL,
        last_trade_at   INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_jid, scope_key)
      );

      CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_stock_price_history (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        scope_key       TEXT    NOT NULL,
        company_id      TEXT    NOT NULL,
        price           INTEGER NOT NULL,
        previous_price  INTEGER NOT NULL DEFAULT 0,
        high_price      INTEGER NOT NULL DEFAULT 0,
        created_at      INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_stock_hist
        ON fun_stock_price_history(scope_key, company_id, created_at DESC);
    `);
  } catch {
    // ignore
  }

  // Máxima histórica (ATH) das ações
  try {
    const sqCols = db.prepare(`PRAGMA ${ANALYTICS_SCHEMA}.table_info(fun_stock_quotes)`).all();
    const sqNames = new Set(sqCols.map((c) => String(c.name || '')));
    if (sqNames.size && !sqNames.has('high_price')) {
      db.exec(
        `ALTER TABLE ${ANALYTICS_SCHEMA}.fun_stock_quotes ADD COLUMN high_price INTEGER NOT NULL DEFAULT 0`
      );
    }
    // backfill: ATH = max(preço atual, ATH gravado)
    db.exec(
      `UPDATE ${ANALYTICS_SCHEMA}.fun_stock_quotes
       SET high_price = CASE
         WHEN high_price < price THEN price
         WHEN high_price <= 0 THEN price
         ELSE high_price
       END`
    );
  } catch {
    // ignore
  }

  // Histórico de cotações da bolsa (dashboard / gráficos)
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_stock_price_history (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        scope_key       TEXT    NOT NULL,
        company_id      TEXT    NOT NULL,
        price           INTEGER NOT NULL,
        previous_price  INTEGER NOT NULL DEFAULT 0,
        high_price      INTEGER NOT NULL DEFAULT 0,
        created_at      INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_stock_hist
        ON fun_stock_price_history(scope_key, company_id, created_at DESC);
    `);
  } catch {
    // ignore
  }

  // Treino grátis do teste de emprego (1× por attempt — controlado no banco)
  try {
    const attCols = db.prepare(`PRAGMA ${ANALYTICS_SCHEMA}.table_info(fun_job_attempts)`).all();
    const attNames = new Set(attCols.map((c) => String(c.name || '')));
    if (attNames.size && !attNames.has('practice_used')) {
      db.exec(
        `ALTER TABLE ${ANALYTICS_SCHEMA}.fun_job_attempts ADD COLUMN practice_used INTEGER NOT NULL DEFAULT 0`
      );
    }
    if (attNames.size && !attNames.has('practice_score')) {
      db.exec(
        `ALTER TABLE ${ANALYTICS_SCHEMA}.fun_job_attempts ADD COLUMN practice_score INTEGER NOT NULL DEFAULT 0`
      );
    }
    if (attNames.size && !attNames.has('practice_at')) {
      db.exec(
        `ALTER TABLE ${ANALYTICS_SCHEMA}.fun_job_attempts ADD COLUMN practice_at INTEGER NOT NULL DEFAULT 0`
      );
    }
  } catch {
    // ignore
  }

  // Migra coluna permitir_nsfw (votação NSFW)
  try {
    const gsCols = db.prepare(`PRAGMA ${ANALYTICS_SCHEMA}.table_info(fun_group_settings)`).all();
    const gsNames = new Set(gsCols.map(c => String(c.name || '')));
    if (!gsNames.has('permitir_nsfw')) {
      db.exec(
        `ALTER TABLE ${ANALYTICS_SCHEMA}.fun_group_settings ADD COLUMN permitir_nsfw INTEGER NOT NULL DEFAULT 0`
      );
    }
  } catch {
    // ignore
  }

  try {
    const voteCols = db.prepare(`PRAGMA ${ANALYTICS_SCHEMA}.table_info(fun_nsfw_votes)`).all();
    const voteNames = new Set(voteCols.map(c => String(c.name || '')));
    if (!voteNames.has('total_membros')) {
      db.exec(`ALTER TABLE ${ANALYTICS_SCHEMA}.fun_nsfw_votes ADD COLUMN total_membros INTEGER NOT NULL DEFAULT 0`);
    }
  } catch {
    // ignore
  }

  // Migra títulos legados (fun_user_stats.title → fun_user_profiles)
  try {
    db.exec(`
      INSERT INTO ${ANALYTICS_SCHEMA}.fun_user_profiles
        (user_jid, scope_key, nickname, bio, birthday_md, title, raw_note, updated_at)
      SELECT user_jid, scope_key, '', '', '', TRIM(title), '', updated_at
      FROM ${ANALYTICS_SCHEMA}.fun_user_stats
      WHERE TRIM(COALESCE(title, '')) != ''
      ON CONFLICT(user_jid, scope_key) DO UPDATE SET
        title = CASE
          WHEN TRIM(${ANALYTICS_SCHEMA}.fun_user_profiles.title) = ''
          THEN excluded.title
          ELSE ${ANALYTICS_SCHEMA}.fun_user_profiles.title
        END
    `);
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
