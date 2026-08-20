import { randomUUID } from 'node:crypto';
import { FUN_SCHEMA_VERSION } from './constants.js';

const ANALYTICS_SCHEMA = 'analytics';

// Schema de desafio diário (tabelas fun_daily_challenges e derivadas).
// Centralizado aqui para garantir create-if-not-exists no boot do módulo fun.
const DAILY_CHALLENGE_SCHEMA_BLOCKS = `
    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_daily_challenges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope_key TEXT NOT NULL,
      challenge_type TEXT NOT NULL,
      challenge_date TEXT NOT NULL,
      challenge_data TEXT NOT NULL,
      answer TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      launched_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      launch_published_at INTEGER,
      completed_at INTEGER,
      completed_by_jid TEXT,
      solve_time_sec INTEGER,
      reward_type TEXT,
      reward_value INTEGER
    );

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_dc_scope_status
      ON fun_daily_challenges(scope_key, status);

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_dc_scope_date
      ON fun_daily_challenges(scope_key, challenge_date);

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_daily_challenge_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      challenge_id INTEGER NOT NULL,
      user_jid TEXT NOT NULL,
      guess TEXT NOT NULL,
      correct INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_dca_challenge
      ON fun_daily_challenge_attempts(challenge_id);

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_dca_user
      ON fun_daily_challenge_attempts(challenge_id, user_jid);

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_daily_challenge_skip_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      challenge_id INTEGER NOT NULL,
      user_jid TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(challenge_id, user_jid)
    );

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_daily_challenge_hints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      challenge_id INTEGER NOT NULL,
      hint_index INTEGER NOT NULL,
      hint_text TEXT NOT NULL DEFAULT '',
      released_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_dch_challenge
      ON fun_daily_challenge_hints(challenge_id);

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_daily_challenge_schedule (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope_key TEXT NOT NULL,
      schedule_date TEXT NOT NULL,
      target_minute INTEGER NOT NULL,
      launched INTEGER NOT NULL DEFAULT 0,
      UNIQUE(scope_key, schedule_date)
    );

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_daily_challenge_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope_key TEXT NOT NULL,
      content_type TEXT NOT NULL,
      content_value TEXT NOT NULL,
      used_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_dcm_scope_type
      ON fun_daily_challenge_memory(scope_key, content_type);
`;

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
      persona_enabled        INTEGER NOT NULL DEFAULT 1,
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
      evidence_status TEXT NOT NULL DEFAULT 'pending',
      created_at    INTEGER NOT NULL,
      last_seen_at  INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_group_memories_scope_score
      ON fun_group_memories(scope_key, score DESC, last_seen_at DESC);

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_group_memories_scope_seen
      ON fun_group_memories(scope_key, last_seen_at DESC);

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_evidence_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope_key TEXT NOT NULL,
      message_id TEXT NOT NULL,
      author_jid TEXT NOT NULL,
      text_normalized TEXT NOT NULL,
      text_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      UNIQUE(scope_key, message_id)
    );
    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_evl_scope_hash ON fun_evidence_log(scope_key, text_hash);
    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_evl_author_scope ON fun_evidence_log(scope_key, author_jid);
    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_evl_expires ON fun_evidence_log(expires_at);

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_self_heal_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      scope_key TEXT NOT NULL,
      domain TEXT NOT NULL,
      target_table TEXT NOT NULL,
      target_id TEXT NOT NULL,
      action TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      status TEXT NOT NULL,
      before_json TEXT,
      after_json TEXT,
      reason TEXT NOT NULL,
      evidence_ref TEXT,
      llm_confidence INTEGER,
      mode TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      decided_at INTEGER,
      decided_by TEXT
    );
    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_sha_run_scope ON fun_self_heal_audit(run_id, scope_key);
    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_sha_status ON fun_self_heal_audit(status);
    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_sha_domain ON fun_self_heal_audit(domain);

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
      last_daily_news_day    TEXT NOT NULL DEFAULT '',
      updated_at             INTEGER NOT NULL
    );

    -- Snapshot diário do jornal: 1 linha/dia/grupo.
    -- Populado em newsService.tryPublish para alimentar memória histórica (30+ dias).
    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_daily_snapshot (
      scope_key    TEXT    NOT NULL,
      day_key      TEXT    NOT NULL,
      payload_json TEXT    NOT NULL DEFAULT '{}',
      created_at   INTEGER NOT NULL,
      PRIMARY KEY (scope_key, day_key)
    );

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_daily_snapshot_scope
      ON fun_daily_snapshot(scope_key, created_at DESC);

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

    -- Cartas colecionáveis (packs / inventário / bazar / favoritos)
    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_user_cards (
      id              TEXT PRIMARY KEY,
      user_jid        TEXT    NOT NULL,
      scope_key       TEXT    NOT NULL,
      card_key        TEXT    NOT NULL,
      card_name       TEXT    NOT NULL,
      species         TEXT    NOT NULL DEFAULT '',
      variant         TEXT    NOT NULL DEFAULT '',
      tier            INTEGER NOT NULL DEFAULT 1,
      image_file      TEXT    NOT NULL DEFAULT '',
      bought_price    INTEGER,
      listed          INTEGER NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_user_cards_user
      ON fun_user_cards(scope_key, user_jid, tier DESC, created_at DESC);

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_user_cards_key
      ON fun_user_cards(card_key);

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_favorite_cards (
      user_jid        TEXT    NOT NULL,
      scope_key       TEXT    NOT NULL,
      card_id         TEXT    NOT NULL,
      updated_at      INTEGER NOT NULL,
      PRIMARY KEY (user_jid, scope_key)
    );

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_favorite_cards_card
      ON fun_favorite_cards(card_id);

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_card_listings (
      id              TEXT PRIMARY KEY,
      scope_key       TEXT    NOT NULL,
      seller_jid      TEXT    NOT NULL,
      card_id         TEXT    NOT NULL,
      price           INTEGER NOT NULL,
      created_at      INTEGER NOT NULL,
      status          TEXT    NOT NULL DEFAULT 'open'
    );

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_card_listings_scope
      ON fun_card_listings(scope_key, status, created_at DESC);

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_card_listings_card
      ON fun_card_listings(card_id, status);

    -- Quem é Mais Provável? (QMP)
    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_qmp_questions (
      id              TEXT PRIMARY KEY,
      scope_key       TEXT    NOT NULL,
      prompt          TEXT    NOT NULL,
      source          TEXT    NOT NULL DEFAULT 'llm',
      tone            TEXT    NOT NULL DEFAULT 'normal',
      created_by      TEXT    NOT NULL DEFAULT '',
      status          TEXT    NOT NULL DEFAULT 'active',
      week_key        TEXT    NOT NULL,
      created_at      INTEGER NOT NULL,
      expires_at      INTEGER NOT NULL,
      closed_at       INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_qmp_questions_scope
      ON fun_qmp_questions(scope_key, status, expires_at);

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_qmp_questions_week
      ON fun_qmp_questions(scope_key, week_key, created_at DESC);

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_qmp_votes (
      id              TEXT PRIMARY KEY,
      question_id     TEXT    NOT NULL,
      scope_key       TEXT    NOT NULL,
      voter_jid       TEXT    NOT NULL,
      target_jid      TEXT    NOT NULL,
      week_key        TEXT    NOT NULL,
      created_at      INTEGER NOT NULL,
      UNIQUE(question_id, voter_jid)
    );

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_qmp_votes_question
      ON fun_qmp_votes(question_id, created_at);

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_qmp_votes_week
      ON fun_qmp_votes(scope_key, week_key, target_jid);

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_qmp_meta (
      scope_key         TEXT PRIMARY KEY,
      last_auto_at      INTEGER NOT NULL DEFAULT 0,
      last_question_at  INTEGER NOT NULL DEFAULT 0,
      updated_at        INTEGER NOT NULL DEFAULT 0
    );

    -- Geração de imagens (/gerar e /imaginar) — schema v25
    -- Contagem global por date_str (timezone America/Sao_Paulo). Limite 25/dia.
    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_image_generations (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      scope_key   TEXT    NOT NULL DEFAULT '',
      user_jid    TEXT    NOT NULL DEFAULT '',
      prompt      TEXT    NOT NULL,
      command     TEXT    NOT NULL DEFAULT '',
      image_url   TEXT    NOT NULL DEFAULT '',
      created_at  INTEGER NOT NULL,
      date_str    TEXT    NOT NULL
    );

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_image_generations_date
      ON fun_image_generations(date_str, created_at DESC);

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_image_generations_scope
      ON fun_image_generations(scope_key, created_at DESC);

    -- Desafio diário (Daily Challenge) — schema v24
    ${DAILY_CHALLENGE_SCHEMA_BLOCKS}

    -- Ranking de despedidas (/despedir) — contador por usuário+grupo
    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_farewells (
      scope_key  TEXT    NOT NULL,
      user_jid   TEXT    NOT NULL,
      count      INTEGER NOT NULL DEFAULT 0,
      last_at    INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (scope_key, user_jid)
    );

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_farewells_scope
      ON fun_farewells(scope_key, count DESC);

    -- Persona (Bot Membro Vivo) — schema v26
    -- Perfil de voz derivado e anonimizado do grupo (FR-014: nunca textos crus).
    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_persona_profile (
      scope_key    TEXT PRIMARY KEY,
      top_tokens   TEXT NOT NULL DEFAULT '[]',
      emojis       TEXT NOT NULL DEFAULT '[]',
      avg_len      REAL NOT NULL DEFAULT 0,
      style_lines  TEXT NOT NULL DEFAULT '[]',
      sample_ts    INTEGER NOT NULL DEFAULT 0,
      updated_at   INTEGER NOT NULL DEFAULT 0,
      token_counts_json TEXT NOT NULL DEFAULT '{}'
    );

    -- Thread de conversa contínua da persona com o grupo (FR-006/FR-007/FR-015).
    -- anchor_message_id: messageId da ÚLTIMA resposta da persona nesta thread —
    -- usado para só tratar reply a essa mensagem como continuação (reply a
    -- resposta de comando do bot não deve invocar a persona).
    -- anchor_text: texto da resposta enviada — fallback de reconciliação quando
    -- o socket não devolve o messageId (o envio real não expõe o retorno).
    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_persona_thread (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      scope_key        TEXT    NOT NULL,
      turn_count      INTEGER NOT NULL DEFAULT 0,
      max_turns       INTEGER NOT NULL DEFAULT 0,
      last_activity_at INTEGER NOT NULL DEFAULT 0,
      context          TEXT    NOT NULL DEFAULT '[]',
      anchor_message_id TEXT   NOT NULL DEFAULT '',
      anchor_text      TEXT   NOT NULL DEFAULT '',
      created_at       INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_persona_thread_scope
      ON fun_persona_thread(scope_key, last_activity_at DESC);

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_conversation_memories (
      id TEXT PRIMARY KEY, scope_key TEXT NOT NULL, memory_type TEXT NOT NULL,
      subject_user_jid TEXT NOT NULL DEFAULT '', target_user_jid TEXT NOT NULL DEFAULT '',
      thread_key TEXT NOT NULL DEFAULT '', related_message_id TEXT NOT NULL DEFAULT '',
      fact_text TEXT NOT NULL, fact_key TEXT NOT NULL DEFAULT '', confidence REAL NOT NULL DEFAULT 0,
      confirmation_level TEXT NOT NULL DEFAULT 'inferred', sensitivity_level TEXT NOT NULL DEFAULT 'safe',
      source_type TEXT NOT NULL DEFAULT 'chat', keywords_json TEXT NOT NULL DEFAULT '[]', entities_json TEXT NOT NULL DEFAULT '[]',
      first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, expires_at INTEGER NOT NULL DEFAULT 0,
      usage_count INTEGER NOT NULL DEFAULT 0, suppressed INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_conversation_memories_scope
      ON fun_conversation_memories(scope_key, suppressed, sensitivity_level, last_seen_at DESC);
    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_thread_contexts (
      thread_key TEXT NOT NULL, scope_key TEXT NOT NULL, anchor_message_id TEXT NOT NULL DEFAULT '',
      reply_to_message_id TEXT NOT NULL DEFAULT '', participants_json TEXT NOT NULL DEFAULT '[]',
      topic_summary TEXT NOT NULL DEFAULT '', open_questions_json TEXT NOT NULL DEFAULT '[]',
      last_user_jid TEXT NOT NULL DEFAULT '', turn_count INTEGER NOT NULL DEFAULT 0,
      last_message_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY(scope_key, thread_key)
    );
    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_thread_contexts_scope
      ON fun_thread_contexts(scope_key, last_message_at DESC);
    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_persona_identities (
      scope_key TEXT PRIMARY KEY, voice_style_json TEXT NOT NULL DEFAULT '[]', allowed_tones_json TEXT NOT NULL DEFAULT '[]',
      forbidden_tones_json TEXT NOT NULL DEFAULT '[]', signature_traits_json TEXT NOT NULL DEFAULT '[]',
      group_lore_summary TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_persona_social_hints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope_key TEXT NOT NULL,
      participant_jid TEXT NOT NULL,
      hint_text TEXT NOT NULL,
      confidence INTEGER NOT NULL DEFAULT 50,
      social_signal TEXT NOT NULL DEFAULT 'neutral',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(scope_key, participant_jid, hint_text)
    );

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_persona_social_hints_scope_participant
      ON fun_persona_social_hints(scope_key, participant_jid, updated_at DESC);


    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_houses (
      scope_key TEXT NOT NULL,
      user_jid TEXT NOT NULL,
      public_id TEXT NOT NULL DEFAULT '',
      house_type TEXT NOT NULL DEFAULT 'casa_padrao',
      wall_style TEXT NOT NULL DEFAULT 'parede_beco',
      floor_style TEXT NOT NULL DEFAULT 'piso_lilas',
      window_style TEXT NOT NULL DEFAULT 'janela_classica',
      cleanliness INTEGER NOT NULL DEFAULT 100,
      security_level INTEGER NOT NULL DEFAULT 0,
      last_collect_day TEXT NOT NULL DEFAULT '',
      last_clean_day TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (scope_key, user_jid)
    );

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_house_items (
      id TEXT PRIMARY KEY,
      scope_key TEXT NOT NULL,
      owner_jid TEXT NOT NULL,
      item_id TEXT NOT NULL,
      x INTEGER NOT NULL DEFAULT 0,
      y INTEGER NOT NULL DEFAULT 0,
      z_index INTEGER NOT NULL DEFAULT 0,
      state INTEGER NOT NULL DEFAULT 0,
      rotated INTEGER NOT NULL DEFAULT 0,
      rotation INTEGER NOT NULL DEFAULT 0,
      placed INTEGER NOT NULL DEFAULT 1,
      stolen_flag INTEGER NOT NULL DEFAULT 0,
      acquired_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_house_items_owner
      ON fun_house_items(scope_key, owner_jid, placed, updated_at DESC);

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_house_visits (
      id TEXT PRIMARY KEY,
      scope_key TEXT NOT NULL,
      owner_jid TEXT NOT NULL,
      visitor_jid TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_house_visits_owner
      ON fun_house_visits(scope_key, owner_jid, created_at DESC);
    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_house_visits_visitor
      ON fun_house_visits(scope_key, visitor_jid, created_at DESC);

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_house_gifts (
      id TEXT PRIMARY KEY,
      scope_key TEXT NOT NULL,
      giver_jid TEXT NOT NULL,
      recipient_jid TEXT NOT NULL,
      item_instance_id TEXT NOT NULL DEFAULT '',
      coins INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_house_gifts_giver
      ON fun_house_gifts(scope_key, giver_jid, created_at DESC);

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_house_tokens (
      id TEXT PRIMARY KEY,
      scope_key TEXT NOT NULL,
      user_jid TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      revoked_at INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_house_tokens_active
      ON fun_house_tokens(revoked_at, created_at DESC);

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_avatar_state (
      scope_key TEXT NOT NULL,
      user_jid TEXT NOT NULL,
      slots_json TEXT NOT NULL DEFAULT '{}',
      unlocked_json TEXT NOT NULL DEFAULT '[]',
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (scope_key, user_jid)
    );

    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.fun_house_robberies (
      id TEXT PRIMARY KEY,
      scope_key TEXT NOT NULL,
      robber_jid TEXT NOT NULL,
      owner_jid TEXT NOT NULL,
      item_instance_id TEXT NOT NULL DEFAULT '',
      result TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_house_robberies_robber
      ON fun_house_robberies(scope_key, robber_jid, created_at DESC);
  `;
}

/**
 * @param {import('better-sqlite3').Database} db
 */
export function ensureFunSchema(db) {
  if (!db) throw new Error('[fun/schema] Database handle required');

  db.exec(buildFunSchemaSql());

  try {
    const houseCols = db.prepare(`PRAGMA ${ANALYTICS_SCHEMA}.table_info(fun_houses)`).all();
    const houseNames = new Set(houseCols.map((column) => String(column.name || '')));
    if (houseNames.size && !houseNames.has('public_id')) {
      db.exec(`ALTER TABLE ${ANALYTICS_SCHEMA}.fun_houses ADD COLUMN public_id TEXT NOT NULL DEFAULT ''`);
    }
    if (houseNames.size && !houseNames.has('wall_style')) {
      db.exec(`ALTER TABLE ${ANALYTICS_SCHEMA}.fun_houses ADD COLUMN wall_style TEXT NOT NULL DEFAULT 'parede_beco'`);
    }
    if (houseNames.size && !houseNames.has('floor_style')) {
      db.exec(`ALTER TABLE ${ANALYTICS_SCHEMA}.fun_houses ADD COLUMN floor_style TEXT NOT NULL DEFAULT 'piso_lilas'`);
    }
    if (houseNames.size && !houseNames.has('window_style')) {
      db.exec(`ALTER TABLE ${ANALYTICS_SCHEMA}.fun_houses ADD COLUMN window_style TEXT NOT NULL DEFAULT 'janela_classica'`);
    }
    const housesWithoutPublicId = db.prepare(`SELECT scope_key, user_jid FROM ${ANALYTICS_SCHEMA}.fun_houses WHERE public_id = ''`).all();
    const setPublicId = db.prepare(`UPDATE ${ANALYTICS_SCHEMA}.fun_houses SET public_id = ? WHERE scope_key = ? AND user_jid = ?`);
    for (const house of housesWithoutPublicId) {
      setPublicId.run(randomUUID(), String(house.scope_key), String(house.user_jid));
    }
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_fun_houses_public_id ON fun_houses(scope_key, public_id)`);

    const itemCols = db.prepare(`PRAGMA ${ANALYTICS_SCHEMA}.table_info(fun_house_items)`).all();
    const itemNames = new Set(itemCols.map((column) => String(column.name || '')));
    if (itemNames.size && !itemNames.has('rotation')) {
      db.exec(`ALTER TABLE ${ANALYTICS_SCHEMA}.fun_house_items ADD COLUMN rotation INTEGER NOT NULL DEFAULT 0`);
    }
    if (itemNames.size && !itemNames.has('z_index')) {
      db.exec(`ALTER TABLE ${ANALYTICS_SCHEMA}.fun_house_items ADD COLUMN z_index INTEGER NOT NULL DEFAULT 0`);
    }
    if (itemNames.size && !itemNames.has('state')) {
      db.exec(`ALTER TABLE ${ANALYTICS_SCHEMA}.fun_house_items ADD COLUMN state INTEGER NOT NULL DEFAULT 0`);
    }
    db.exec(`UPDATE ${ANALYTICS_SCHEMA}.fun_house_items SET rotation = 1 WHERE rotated = 1 AND rotation = 0`);
  } catch {
    // ignore
  }

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
    if (!names.has('persona_enabled')) {
      db.exec(
        `ALTER TABLE ${ANALYTICS_SCHEMA}.fun_group_settings ADD COLUMN persona_enabled INTEGER NOT NULL DEFAULT 1`
      );
    }
  } catch {
    // ignore
  }

  try {
    const memoryCols = db.prepare(`PRAGMA ${ANALYTICS_SCHEMA}.table_info(fun_group_memories)`).all();
    const memoryNames = new Set(memoryCols.map(c => String(c.name || '')));
    if (memoryNames.size && !memoryNames.has('evidence_status')) {
      db.exec(`ALTER TABLE ${ANALYTICS_SCHEMA}.fun_group_memories ADD COLUMN evidence_status TEXT NOT NULL DEFAULT 'pending'`);
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
    const personaCols = db.prepare(`PRAGMA ${ANALYTICS_SCHEMA}.table_info(fun_persona_profile)`).all();
    const personaNames = new Set(personaCols.map((c) => String(c.name || '')));
    if (personaNames.size && !personaNames.has('token_counts_json')) {
      db.exec(
        `ALTER TABLE ${ANALYTICS_SCHEMA}.fun_persona_profile ADD COLUMN token_counts_json TEXT NOT NULL DEFAULT '{}'`
      );
    }
  } catch {
    // ignore
  }

  // Migra âncora de resposta da persona em threads existentes: guarda o
  // messageId (e o texto) da última resposta da persona — só reply a essa
  // mensagem é continuação (reply a resposta de comando do bot não invoca a
  // persona).
  try {
    const thCols = db.prepare(`PRAGMA ${ANALYTICS_SCHEMA}.table_info(fun_persona_thread)`).all();
    const thNames = new Set(thCols.map((c) => String(c.name || '')));
    if (thNames.size && !thNames.has('anchor_message_id')) {
      db.exec(
        `ALTER TABLE ${ANALYTICS_SCHEMA}.fun_persona_thread ADD COLUMN anchor_message_id TEXT NOT NULL DEFAULT ''`
      );
    }
    if (thNames.size && !thNames.has('anchor_text')) {
      db.exec(
        `ALTER TABLE ${ANALYTICS_SCHEMA}.fun_persona_thread ADD COLUMN anchor_text TEXT NOT NULL DEFAULT ''`
      );
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

  // Migra metadados sociais da persona em bancos existentes.
  try {
    const hintCols = db.prepare(`PRAGMA ${ANALYTICS_SCHEMA}.table_info(fun_persona_social_hints)`).all();
    const hintNames = new Set(hintCols.map((c) => String(c.name || '')));
    if (hintNames.size && !hintNames.has('confidence')) {
      db.exec(`ALTER TABLE ${ANALYTICS_SCHEMA}.fun_persona_social_hints ADD COLUMN confidence INTEGER NOT NULL DEFAULT 50`);
    }
    if (hintNames.size && !hintNames.has('social_signal')) {
      db.exec(`ALTER TABLE ${ANALYTICS_SCHEMA}.fun_persona_social_hints ADD COLUMN social_signal TEXT NOT NULL DEFAULT 'neutral'`);
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

  // Migra colunas granulares de eventos autônomos (controle por tipo de evento)
  const GRANULAR_COLUMNS = [
    { name: 'journal_auto_enabled', defaultVal: 1 },
    { name: 'market_auto_enabled', defaultVal: 1 },
    { name: 'happy_hour_auto_enabled', defaultVal: 1 },
    { name: 'chaos_auto_enabled', defaultVal: 1 },
    { name: 'weekly_restock_auto_enabled', defaultVal: 1 },
  ];
  try {
    const gsCols2 = db.prepare(`PRAGMA ${ANALYTICS_SCHEMA}.table_info(fun_group_settings)`).all();
    const gsNames2 = new Set(gsCols2.map(c => String(c.name || '')));
    for (const col of GRANULAR_COLUMNS) {
      if (!gsNames2.has(col.name)) {
        db.exec(`ALTER TABLE ${ANALYTICS_SCHEMA}.fun_group_settings ADD COLUMN ${col.name} INTEGER NOT NULL DEFAULT ${col.defaultVal}`);
      }
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

  // QMP: tom normal | heavy (modo "Amigos de Merda")
  try {
    const qmpCols = db.prepare(`PRAGMA ${ANALYTICS_SCHEMA}.table_info(fun_qmp_questions)`).all();
    const qmpNames = new Set(qmpCols.map((c) => String(c.name || '')));
    if (qmpNames.size && !qmpNames.has('tone')) {
      db.exec(
        `ALTER TABLE ${ANALYTICS_SCHEMA}.fun_qmp_questions ADD COLUMN tone TEXT NOT NULL DEFAULT 'normal'`
      );
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

  // Migra estado de publicação do lançamento do desafio diário.
  try {
    const dcCols = db.prepare(`PRAGMA ${ANALYTICS_SCHEMA}.table_info(fun_daily_challenges)`).all();
    const dcNames = new Set(dcCols.map((c) => String(c.name || '')));
    if (dcNames.size && !dcNames.has('launch_published_at')) {
      db.exec(`ALTER TABLE ${ANALYTICS_SCHEMA}.fun_daily_challenges ADD COLUMN launch_published_at INTEGER`);
    }
  } catch {
    // ignore
  }

  // Migra coluna hint_text (histórico de dicas do desafio diário)
  try {
    const dchCols = db.prepare(`PRAGMA ${ANALYTICS_SCHEMA}.table_info(fun_daily_challenge_hints)`).all();
    const dchNames = new Set(dchCols.map((c) => String(c.name || '')));
    if (dchNames.size && !dchNames.has('hint_text')) {
      db.exec(
        `ALTER TABLE ${ANALYTICS_SCHEMA}.fun_daily_challenge_hints ADD COLUMN hint_text TEXT NOT NULL DEFAULT ''`
      );
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
