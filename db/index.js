/**
 * db/index.js
 *
 * Gerenciamento de estado de sessão usando better-sqlite3.
 * O better-sqlite3 usa binding C++ nativo com WAL mode — escrita incremental
 * em disco sem bloquear o event-loop e sem risco de corrupção.
 *
 * Migração de sql.js → better-sqlite3:
 * - Não há mais writeToDisk() manual — o better-sqlite3 persiste automaticamente
 * - WAL mode habilitado para performance e segurança
 * - Prepared statements compilados uma vez e reutilizados
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { SESSION_STATUS } from '../config/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR   = path.join(__dirname, '..', 'data');
const LEGACY_DB_PATH = path.join(DATA_DIR, 'sessions.db');
const RUNTIME_DB_PATH = path.join(DATA_DIR, 'runtime.db');
const ANALYTICS_DB_PATH = path.join(DATA_DIR, 'analytics.db');
const ARCHIVE_EVENTS_DIR = path.join(DATA_DIR, 'archives', 'conversation-events');
const ANALYTICS_SCHEMA = 'analytics';
const DB_SIZE_HISTORY_DAYS = 7;
const JSON_BOOL_TRUE = '1';
const JSON_BOOL_FALSE = '0';

/** @type {import('better-sqlite3').Database} */
let db;

/** Prepared statements — compilados uma vez, reutilizados sempre. */
let stmts = {};
const dynamicStatementCache = new Map();
const conversationEventListeners = new Set();
let eventBuffer = [];
let eventFlushTimer = null;
let eventInsertTx = null;
const dbRuntimeState = {
  config: {
    splitDatabases: true,
    eventBatchingEnabled: true,
    eventBatchFlushMs: 1000,
    eventBatchSize: 200,
    retentionDays: 30,
    retentionArchiveEnabled: true,
    maintenanceEnabled: true,
    maintenanceIntervalMinutes: 30,
    maintenanceCheckpointMode: 'TRUNCATE',
    maintenanceAnalyzeIntervalHours: 24,
    maintenanceVacuumIntervalHours: 168,
    maintenanceIntegrityCheckIntervalHours: 24,
    pragmaBusyTimeoutMs: 5000,
    pragmaWalAutoCheckpointPages: 1000,
    pragmaTempStoreMemory: true,
    pragmaCacheSizeKb: 65536,
    pragmaMmapSizeMb: 256,
    pragmaRuntimeSynchronous: 'NORMAL',
    pragmaAnalyticsSynchronous: 'NORMAL',
    maxVariablesBytesWarn: 524288,
  },
  maintenance: {
    inProgress: false,
    lastRunAt: 0,
    lastRunReason: '',
    lastDurationMs: 0,
    lastStatus: 'never',
    lastError: '',
    lastSummary: null,
    lastRetentionAt: 0,
    lastAnalyzeAt: 0,
    lastVacuumAt: 0,
    lastIntegrityCheckAt: 0,
  },
};

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') return false;
  }
  return fallback;
}

function normalizeInt(value, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const normalized = Math.trunc(n);
  if (normalized < min || normalized > max) return fallback;
  return normalized;
}

function normalizeSynchronous(value, fallback = 'NORMAL') {
  const normalized = String(value ?? fallback).trim().toUpperCase();
  if (normalized === 'OFF' || normalized === 'NORMAL' || normalized === 'FULL' || normalized === 'EXTRA') {
    return normalized;
  }
  return fallback;
}

function normalizeCheckpointMode(value, fallback = 'TRUNCATE') {
  const normalized = String(value ?? fallback).trim().toUpperCase();
  if (normalized === 'PASSIVE' || normalized === 'FULL' || normalized === 'RESTART' || normalized === 'TRUNCATE') {
    return normalized;
  }
  return fallback;
}

function normalizeDbRuntimeConfig(input = {}) {
  const base = dbRuntimeState.config;
  const cfg = { ...base, ...(input && typeof input === 'object' ? input : {}) };
  return {
    splitDatabases: normalizeBoolean(cfg.splitDatabases, true),
    eventBatchingEnabled: normalizeBoolean(cfg.eventBatchingEnabled, true),
    eventBatchFlushMs: normalizeInt(cfg.eventBatchFlushMs, base.eventBatchFlushMs, { min: 100, max: 60000 }),
    eventBatchSize: normalizeInt(cfg.eventBatchSize, base.eventBatchSize, { min: 10, max: 5000 }),
    retentionDays: normalizeInt(cfg.retentionDays, base.retentionDays, { min: 1, max: 3650 }),
    retentionArchiveEnabled: normalizeBoolean(cfg.retentionArchiveEnabled, true),
    maintenanceEnabled: normalizeBoolean(cfg.maintenanceEnabled, true),
    maintenanceIntervalMinutes: normalizeInt(cfg.maintenanceIntervalMinutes, base.maintenanceIntervalMinutes, { min: 5, max: 1440 }),
    maintenanceCheckpointMode: normalizeCheckpointMode(cfg.maintenanceCheckpointMode, base.maintenanceCheckpointMode),
    maintenanceAnalyzeIntervalHours: normalizeInt(cfg.maintenanceAnalyzeIntervalHours, base.maintenanceAnalyzeIntervalHours, { min: 1, max: 720 }),
    maintenanceVacuumIntervalHours: normalizeInt(cfg.maintenanceVacuumIntervalHours, base.maintenanceVacuumIntervalHours, { min: 6, max: 2160 }),
    maintenanceIntegrityCheckIntervalHours: normalizeInt(cfg.maintenanceIntegrityCheckIntervalHours, base.maintenanceIntegrityCheckIntervalHours, { min: 1, max: 720 }),
    pragmaBusyTimeoutMs: normalizeInt(cfg.pragmaBusyTimeoutMs, base.pragmaBusyTimeoutMs, { min: 0, max: 120000 }),
    pragmaWalAutoCheckpointPages: normalizeInt(cfg.pragmaWalAutoCheckpointPages, base.pragmaWalAutoCheckpointPages, { min: 100, max: 200000 }),
    pragmaTempStoreMemory: normalizeBoolean(cfg.pragmaTempStoreMemory, true),
    pragmaCacheSizeKb: normalizeInt(cfg.pragmaCacheSizeKb, base.pragmaCacheSizeKb, { min: 4096, max: 1048576 }),
    pragmaMmapSizeMb: normalizeInt(cfg.pragmaMmapSizeMb, base.pragmaMmapSizeMb, { min: 0, max: 4096 }),
    pragmaRuntimeSynchronous: normalizeSynchronous(cfg.pragmaRuntimeSynchronous, base.pragmaRuntimeSynchronous),
    pragmaAnalyticsSynchronous: normalizeSynchronous(cfg.pragmaAnalyticsSynchronous, base.pragmaAnalyticsSynchronous),
    maxVariablesBytesWarn: normalizeInt(cfg.maxVariablesBytesWarn, base.maxVariablesBytesWarn, { min: 65536, max: 10485760 }),
  };
}

function safePragma(database, sql) {
  try {
    return database.pragma(sql);
  } catch {
    return null;
  }
}

function readMetaValue(key, fallback = '') {
  try {
    const row = db.prepare('SELECT value FROM db_runtime_meta WHERE key = ? LIMIT 1').get(String(key));
    if (!row) return fallback;
    return String(row.value ?? fallback);
  } catch {
    return fallback;
  }
}

function writeMetaValue(key, value) {
  try {
    db.prepare(
      `INSERT INTO db_runtime_meta (key, value)
       VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(String(key), String(value ?? ''));
  } catch {
    // ignore meta write failures
  }
}

function tableExists(name, schema = 'main') {
  return Boolean(
    db.prepare(
      `SELECT 1 FROM ${schema}.sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`
    ).get(name)
  );
}

function rebuildSessionsTableIfNeeded() {
  if (!tableExists('sessions')) return;

  const columns = db.prepare('PRAGMA table_info(sessions)').all();
  const names = new Set(columns.map(column => String(column.name)));
  const primaryKey = columns
    .filter(column => Number(column.pk) > 0)
    .sort((a, b) => Number(a.pk) - Number(b.pk))
    .map(column => String(column.name));

  const hasFlowPath = names.has('flow_path');
  const hasBotType = names.has('bot_type');
  const hasCompositePk = primaryKey.length === 2 && primaryKey[0] === 'jid' && primaryKey[1] === 'flow_path';
  const needsRebuild = !hasFlowPath || !hasBotType || !hasCompositePk;

  if (!needsRebuild) return;

  const migrate = db.transaction(() => {
    db.exec('DROP TABLE IF EXISTS sessions_legacy');
    db.exec('ALTER TABLE sessions RENAME TO sessions_legacy');
    db.exec(`
      CREATE TABLE sessions (
        jid         TEXT    NOT NULL,
        flow_path   TEXT    NOT NULL DEFAULT '',
        bot_type    TEXT    NOT NULL DEFAULT 'conversation',
        block_index INTEGER NOT NULL DEFAULT 0,
        variables   TEXT    NOT NULL DEFAULT '{}',
        status      TEXT    NOT NULL DEFAULT 'active',
        waiting_for TEXT    DEFAULT NULL,
        updated_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        PRIMARY KEY (jid, flow_path)
      );
    `);

    const selectFlowPath = hasFlowPath ? "COALESCE(flow_path, '')" : "''";
    const selectBotType = hasBotType
      ? "CASE WHEN lower(COALESCE(bot_type, '')) = 'command' THEN 'command' ELSE 'conversation' END"
      : "'conversation'";

    db.exec(`
      INSERT OR REPLACE INTO sessions (
        jid, flow_path, bot_type, block_index, variables, status, waiting_for, updated_at
      )
      SELECT
        jid,
        ${selectFlowPath},
        ${selectBotType},
        COALESCE(block_index, 0),
        COALESCE(variables, '{}'),
        COALESCE(status, 'active'),
        waiting_for,
        COALESCE(updated_at, strftime('%s','now'))
      FROM sessions_legacy
      WHERE jid IS NOT NULL;
    `);

    db.exec('DROP TABLE sessions_legacy');
  });

  migrate();
}

function normalizeSessionScope(scope = null) {
  if (typeof scope === 'string') {
    return {
      flowPath: String(scope || '').trim(),
      botType: null,
    };
  }

  if (scope && typeof scope === 'object') {
    const flowPath = String(scope.flowPath ?? '').trim();
    const botTypeRaw = String(scope.botType ?? '').trim().toLowerCase();
    const botType = botTypeRaw === 'command' ? 'command' : (botTypeRaw ? 'conversation' : null);
    return { flowPath, botType };
  }

  return { flowPath: '', botType: null };
}

function toJsonPath(key) {
  const safe = String(key ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `$."${safe}"`;
}

function getDynamicStatement(sql) {
  let stmt = dynamicStatementCache.get(sql);
  if (stmt) return stmt;
  stmt = db.prepare(sql);
  dynamicStatementCache.set(sql, stmt);
  return stmt;
}

function mapSessionRow(row) {
  return {
    jid: row.jid,
    flowPath: row.flow_path,
    botType: row.bot_type,
    blockIndex: row.block_index,
    variables: JSON.parse(row.variables),
    status: row.status,
    waitingFor: row.waiting_for,
    updatedAt: Number(row.updated_at) || 0,
  };
}

function applyMainPragmas() {
  const cfg = dbRuntimeState.config;
  safePragma(db, `busy_timeout = ${cfg.pragmaBusyTimeoutMs}`);
  safePragma(db, 'foreign_keys = ON');
  safePragma(db, 'journal_mode = WAL');
  safePragma(db, `synchronous = ${cfg.pragmaRuntimeSynchronous}`);
  safePragma(db, `wal_autocheckpoint = ${cfg.pragmaWalAutoCheckpointPages}`);
  safePragma(db, `cache_size = -${cfg.pragmaCacheSizeKb}`);
  safePragma(db, `mmap_size = ${Math.max(0, cfg.pragmaMmapSizeMb) * 1024 * 1024}`);
  safePragma(db, cfg.pragmaTempStoreMemory ? 'temp_store = MEMORY' : 'temp_store = DEFAULT');
}

function applyAnalyticsPragmas() {
  const cfg = dbRuntimeState.config;
  safePragma(db, `${ANALYTICS_SCHEMA}.journal_mode = WAL`);
  safePragma(db, `${ANALYTICS_SCHEMA}.synchronous = ${cfg.pragmaAnalyticsSynchronous}`);
  safePragma(db, `${ANALYTICS_SCHEMA}.cache_size = -${cfg.pragmaCacheSizeKb}`);
  safePragma(db, `${ANALYTICS_SCHEMA}.mmap_size = ${Math.max(0, cfg.pragmaMmapSizeMb) * 1024 * 1024}`);
}

function startEventFlushTimer() {
  if (eventFlushTimer) {
    clearInterval(eventFlushTimer);
    eventFlushTimer = null;
  }
  if (!dbRuntimeState.config.eventBatchingEnabled) return;
  const flushMs = Math.max(100, Number(dbRuntimeState.config.eventBatchFlushMs) || 1000);
  eventFlushTimer = setInterval(() => {
    flushConversationEventBuffer({ reason: 'interval' });
  }, flushMs);
  if (typeof eventFlushTimer.unref === 'function') {
    eventFlushTimer.unref();
  }
}

function ensureArchiveDir() {
  fs.mkdirSync(ARCHIVE_EVENTS_DIR, { recursive: true });
}

function schemaTableExists(schema, tableName) {
  try {
    return Boolean(
      db.prepare(`SELECT 1 FROM ${schema}.sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`).get(tableName)
    );
  } catch {
    return false;
  }
}

function listTableColumns(schema, tableName) {
  try {
    return db.prepare(`PRAGMA ${schema}.table_info(${tableName})`).all().map(row => String(row?.name || ''));
  } catch {
    return [];
  }
}

function migrateLegacyDatabaseIfNeeded() {
  if (!fs.existsSync(LEGACY_DB_PATH)) return;
  if (readMetaValue('legacy_split_migration_v1', JSON_BOOL_FALSE) === JSON_BOOL_TRUE) return;

  const escapedLegacyPath = LEGACY_DB_PATH.replace(/'/g, "''");
  try {
    db.exec(`ATTACH DATABASE '${escapedLegacyPath}' AS legacy`);
  } catch {
    return;
  }

  try {
    if (schemaTableExists('legacy', 'sessions')) {
      const columns = listTableColumns('legacy', 'sessions');
      const hasFlowPath = columns.includes('flow_path');
      const hasBotType = columns.includes('bot_type');
      db.exec(`
        INSERT OR IGNORE INTO sessions (
          jid, flow_path, bot_type, block_index, variables, status, waiting_for, updated_at
        )
        SELECT
          jid,
          ${hasFlowPath ? "COALESCE(flow_path, '')" : "''"},
          ${hasBotType ? "CASE WHEN lower(COALESCE(bot_type, '')) = 'command' THEN 'command' ELSE 'conversation' END" : "'conversation'"},
          COALESCE(block_index, 0),
          COALESCE(variables, '{}'),
          COALESCE(status, 'active'),
          waiting_for,
          COALESCE(updated_at, strftime('%s','now'))
        FROM legacy.sessions
        WHERE jid IS NOT NULL;
      `);
    }

    if (schemaTableExists('legacy', 'auth_state')) {
      db.exec(`
        INSERT OR IGNORE INTO auth_state (key, value)
        SELECT key, value
        FROM legacy.auth_state
        WHERE key IS NOT NULL;
      `);
    }

    if (schemaTableExists('legacy', 'conversation_events')) {
      db.exec(`
        INSERT OR IGNORE INTO ${ANALYTICS_SCHEMA}.conversation_events (
          id, occurred_at, event_type, direction, jid, flow_path, message_text, metadata
        )
        SELECT
          id,
          COALESCE(occurred_at, strftime('%s','now')),
          COALESCE(event_type, 'message'),
          COALESCE(direction, 'system'),
          COALESCE(jid, 'unknown'),
          COALESCE(flow_path, ''),
          message_text,
          COALESCE(metadata, '{}')
        FROM legacy.conversation_events;
      `);
    }

    if (schemaTableExists('legacy', 'conversation_sessions')) {
      db.exec(`
        INSERT OR IGNORE INTO ${ANALYTICS_SCHEMA}.conversation_sessions (
          session_id, jid, flow_path, started_at, ended_at, end_reason
        )
        SELECT
          session_id,
          COALESCE(jid, 'unknown'),
          COALESCE(flow_path, ''),
          COALESCE(started_at, strftime('%s','now')),
          ended_at,
          end_reason
        FROM legacy.conversation_sessions;
      `);
    }

    if (schemaTableExists('legacy', 'broadcast_campaigns')) {
      db.exec(`
        INSERT OR IGNORE INTO ${ANALYTICS_SCHEMA}.broadcast_campaigns (
          id, created_at, actor, target_mode, message_type, message_text, media_mime_type, media_file_name, recipient_count
        )
        SELECT
          id,
          COALESCE(created_at, strftime('%s','now')),
          COALESCE(actor, 'dashboard-agent'),
          COALESCE(target_mode, 'all'),
          COALESCE(message_type, 'text'),
          message_text,
          media_mime_type,
          media_file_name,
          COALESCE(recipient_count, 0)
        FROM legacy.broadcast_campaigns;
      `);
    }

    if (schemaTableExists('legacy', 'broadcast_recipients')) {
      db.exec(`
        INSERT OR IGNORE INTO ${ANALYTICS_SCHEMA}.broadcast_recipients (
          id, campaign_id, jid, send_status, error_message, sent_at, created_at, updated_at
        )
        SELECT
          id,
          campaign_id,
          jid,
          COALESCE(send_status, 'pending'),
          error_message,
          sent_at,
          COALESCE(created_at, strftime('%s','now')),
          COALESCE(updated_at, strftime('%s','now'))
        FROM legacy.broadcast_recipients
        WHERE jid IS NOT NULL;
      `);
    }

    if (schemaTableExists('legacy', 'contact_profiles')) {
      db.exec(`
        INSERT OR IGNORE INTO ${ANALYTICS_SCHEMA}.contact_profiles (
          jid, display_name, source, updated_at
        )
        SELECT
          jid,
          COALESCE(display_name, ''),
          COALESCE(source, 'runtime'),
          COALESCE(updated_at, strftime('%s','now'))
        FROM legacy.contact_profiles
        WHERE jid IS NOT NULL;
      `);
    }

    if (schemaTableExists('legacy', 'db_size_daily')) {
      db.exec(`
        INSERT OR IGNORE INTO db_size_daily (date_key, total_bytes, captured_at)
        SELECT date_key, total_bytes, captured_at
        FROM legacy.db_size_daily
        WHERE date_key IS NOT NULL;
      `);
    }

    writeMetaValue('legacy_split_migration_v1', JSON_BOOL_TRUE);
  } finally {
    try {
      db.exec('DETACH DATABASE legacy');
    } catch {
      // ignore
    }
  }
}

// ─── Inicialização ────────────────────────────────────────────────────────────

/**
 * Inicializa o banco de dados com better-sqlite3.
 * Não é mais async (better-sqlite3 é síncrono), mas mantém a assinatura
 * async para compatibilidade com o código existente.
 */
export async function initDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  db = new Database(RUNTIME_DB_PATH);
  applyMainPragmas();

  const escapedAnalyticsPath = ANALYTICS_DB_PATH.replace(/'/g, "''");
  db.exec(`ATTACH DATABASE '${escapedAnalyticsPath}' AS ${ANALYTICS_SCHEMA}`);
  applyAnalyticsPragmas();

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      jid         TEXT    NOT NULL,
      flow_path   TEXT    NOT NULL DEFAULT '',
      bot_type    TEXT    NOT NULL DEFAULT 'conversation',
      block_index INTEGER NOT NULL DEFAULT 0,
      variables   TEXT    NOT NULL DEFAULT '{}',
      status      TEXT    NOT NULL DEFAULT 'active',
      waiting_for TEXT    DEFAULT NULL,
      updated_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      PRIMARY KEY (jid, flow_path)
    );
    CREATE TABLE IF NOT EXISTS auth_state (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS db_size_daily (
      date_key      TEXT PRIMARY KEY,
      total_bytes   INTEGER NOT NULL,
      captured_at   INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS db_runtime_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.conversation_events (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      occurred_at  INTEGER NOT NULL,
      event_type   TEXT    NOT NULL,
      direction    TEXT    NOT NULL,
      jid          TEXT    NOT NULL,
      flow_path    TEXT    NOT NULL DEFAULT '',
      message_text TEXT,
      metadata     TEXT    NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.conversation_sessions (
      session_id  TEXT PRIMARY KEY,
      jid         TEXT    NOT NULL,
      flow_path   TEXT    NOT NULL DEFAULT '',
      started_at  INTEGER NOT NULL,
      ended_at    INTEGER,
      end_reason  TEXT
    );
    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.broadcast_campaigns (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at       INTEGER NOT NULL,
      actor            TEXT    NOT NULL,
      target_mode      TEXT    NOT NULL,
      message_type     TEXT    NOT NULL,
      message_text     TEXT,
      media_mime_type  TEXT,
      media_file_name  TEXT,
      recipient_count  INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.broadcast_recipients (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id    INTEGER NOT NULL,
      jid            TEXT    NOT NULL,
      send_status    TEXT    NOT NULL DEFAULT 'pending',
      error_message  TEXT,
      sent_at        INTEGER,
      created_at     INTEGER NOT NULL,
      updated_at     INTEGER NOT NULL,
      UNIQUE(campaign_id, jid)
    );
    CREATE TABLE IF NOT EXISTS ${ANALYTICS_SCHEMA}.contact_profiles (
      jid           TEXT PRIMARY KEY,
      display_name  TEXT NOT NULL,
      source        TEXT NOT NULL DEFAULT 'runtime',
      updated_at    INTEGER NOT NULL
    );
  `);

  rebuildSessionsTableIfNeeded();

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_jid_updated_at ON sessions(jid, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_status_updated_at ON sessions(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_flow_status ON sessions(flow_path, status);
    CREATE INDEX IF NOT EXISTS idx_sessions_status_updated_jid ON sessions(status, updated_at DESC, jid DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_flow_status_updated_jid ON sessions(flow_path, status, updated_at DESC, jid DESC);

    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_conversation_events_occurred_at ON conversation_events(occurred_at DESC);
    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_conversation_events_jid ON conversation_events(jid);
    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_conversation_events_jid_occurred_at ON conversation_events(jid, occurred_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_conversation_events_flow_path_occurred_at ON conversation_events(flow_path, occurred_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_conversation_sessions_started_at ON conversation_sessions(started_at DESC);
    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_conversation_sessions_ended_at ON conversation_sessions(ended_at DESC);
    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_broadcast_campaigns_created_at ON broadcast_campaigns(created_at DESC);
    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_broadcast_recipients_campaign_status ON broadcast_recipients(campaign_id, send_status);
    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_broadcast_recipients_jid_created ON broadcast_recipients(jid, created_at DESC);
    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_contact_profiles_display_name ON contact_profiles(display_name);
    CREATE INDEX IF NOT EXISTS ${ANALYTICS_SCHEMA}.idx_contact_profiles_updated_at ON contact_profiles(updated_at DESC);
  `);

  migrateLegacyDatabaseIfNeeded();

  // Pré-compilar prepared statements para performance máxima
  stmts = {
    getSession: db.prepare(
      `SELECT jid, flow_path, bot_type, block_index, variables, status, waiting_for, updated_at
       FROM sessions
       WHERE jid = ? AND flow_path = ?`
    ),
    getLatestSessionByJid: db.prepare(
      `SELECT jid, flow_path, bot_type, block_index, variables, status, waiting_for, updated_at
       FROM sessions
       WHERE jid = ?
       ORDER BY updated_at DESC
       LIMIT 1`
    ),
    createSession: db.prepare(
      `INSERT OR REPLACE INTO sessions (jid, flow_path, bot_type, block_index, variables, status, waiting_for)
       VALUES (?, ?, ?, 0, '{}', ?, NULL)`
    ),
    deleteSession: db.prepare('DELETE FROM sessions WHERE jid = ? AND flow_path = ?'),
    getActiveSessions: db.prepare(
      `SELECT jid, flow_path, bot_type, block_index, variables, status, waiting_for, updated_at
       FROM sessions
       WHERE status = ?`
    ),
    getActiveSessionsByFlowPath: db.prepare(
      `SELECT jid, flow_path, bot_type, block_index, variables, status, waiting_for, updated_at
       FROM sessions
       WHERE status = ? AND flow_path = ?`
    ),
    getActiveSessionsByBotType: db.prepare(
      `SELECT jid, flow_path, bot_type, block_index, variables, status, waiting_for, updated_at
       FROM sessions
       WHERE status = ? AND bot_type = ?`
    ),
    getActiveSessionsPage: db.prepare(
      `SELECT jid, flow_path, bot_type, block_index, variables, status, waiting_for, updated_at
       FROM sessions
       WHERE status = ?
         AND (updated_at < ? OR (updated_at = ? AND jid < ?))
       ORDER BY updated_at DESC, jid DESC
       LIMIT ?`
    ),
    getActiveSessionsPageByFlowPath: db.prepare(
      `SELECT jid, flow_path, bot_type, block_index, variables, status, waiting_for, updated_at
       FROM sessions
       WHERE status = ?
         AND flow_path = ?
         AND (updated_at < ? OR (updated_at = ? AND jid < ?))
       ORDER BY updated_at DESC, jid DESC
       LIMIT ?`
    ),
    getActiveSessionsPageByBotType: db.prepare(
      `SELECT jid, flow_path, bot_type, block_index, variables, status, waiting_for, updated_at
       FROM sessions
       WHERE status = ?
         AND bot_type = ?
         AND (updated_at < ? OR (updated_at = ? AND jid < ?))
       ORDER BY updated_at DESC, jid DESC
       LIMIT ?`
    ),
    deleteActiveSessions: db.prepare('DELETE FROM sessions WHERE status = ?'),
    deleteActiveSessionsByFlowPath: db.prepare('DELETE FROM sessions WHERE status = ? AND flow_path = ?'),
    getAuthState: db.prepare('SELECT value FROM auth_state WHERE key = ?'),
    setAuthState: db.prepare(
      `INSERT INTO auth_state (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ),
    deleteAuthState: db.prepare('DELETE FROM auth_state WHERE key = ?'),
    insertConversationEvent: db.prepare(
      `INSERT INTO ${ANALYTICS_SCHEMA}.conversation_events (
        occurred_at, event_type, direction, jid, flow_path, message_text, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ),
    listConversationEvents: db.prepare(
      `SELECT id, occurred_at, event_type, direction, jid, flow_path, message_text, metadata
       FROM ${ANALYTICS_SCHEMA}.conversation_events
       ORDER BY occurred_at DESC, id DESC
       LIMIT ?`
    ),
    listConversationEventsByFlowPath: db.prepare(
      `SELECT id, occurred_at, event_type, direction, jid, flow_path, message_text, metadata
       FROM ${ANALYTICS_SCHEMA}.conversation_events
       WHERE flow_path = ?
       ORDER BY occurred_at DESC, id DESC
       LIMIT ?`
    ),
    listConversationEventsByJid: db.prepare(
      `SELECT id, occurred_at, event_type, direction, jid, flow_path, message_text, metadata
       FROM ${ANALYTICS_SCHEMA}.conversation_events
       WHERE jid = ?
       ORDER BY occurred_at DESC, id DESC
       LIMIT ?`
    ),
    listConversationEventsSince: db.prepare(
      `SELECT id, occurred_at, event_type, direction, jid, flow_path, message_text, metadata
       FROM ${ANALYTICS_SCHEMA}.conversation_events
       WHERE occurred_at > ?
       ORDER BY occurred_at ASC, id ASC
       LIMIT ?`
    ),
    listConversationEventsSinceByFlowPath: db.prepare(
      `SELECT id, occurred_at, event_type, direction, jid, flow_path, message_text, metadata
       FROM ${ANALYTICS_SCHEMA}.conversation_events
       WHERE flow_path = ? AND occurred_at > ?
       ORDER BY occurred_at ASC, id ASC
       LIMIT ?`
    ),
    listConversationEventsSinceByJid: db.prepare(
      `SELECT id, occurred_at, event_type, direction, jid, flow_path, message_text, metadata
       FROM ${ANALYTICS_SCHEMA}.conversation_events
       WHERE jid = ? AND occurred_at > ?
       ORDER BY occurred_at ASC, id ASC
       LIMIT ?`
    ),
    createConversationSession: db.prepare(
      `INSERT OR REPLACE INTO ${ANALYTICS_SCHEMA}.conversation_sessions (
        session_id, jid, flow_path, started_at, ended_at, end_reason
      ) VALUES (?, ?, ?, ?, NULL, NULL)`
    ),
    finishConversationSession: db.prepare(
      `UPDATE ${ANALYTICS_SCHEMA}.conversation_sessions
       SET ended_at = ?, end_reason = ?
       WHERE session_id = ?`
    ),
    countStartedSessionsInRange: db.prepare(
      `SELECT COUNT(*) AS total
       FROM ${ANALYTICS_SCHEMA}.conversation_sessions
       WHERE started_at >= ? AND started_at < ?`
    ),
    countStartedSessionsInRangeByFlowPath: db.prepare(
      `SELECT COUNT(*) AS total
       FROM ${ANALYTICS_SCHEMA}.conversation_sessions
       WHERE started_at >= ? AND started_at < ? AND flow_path = ?`
    ),
    countEndedByReasonInRange: db.prepare(
      `SELECT COUNT(*) AS total
       FROM ${ANALYTICS_SCHEMA}.conversation_sessions
       WHERE ended_at >= ? AND ended_at < ? AND end_reason = ?`
    ),
    countEndedByReasonInRangeByFlowPath: db.prepare(
      `SELECT COUNT(*) AS total
       FROM ${ANALYTICS_SCHEMA}.conversation_sessions
       WHERE ended_at >= ? AND ended_at < ? AND end_reason = ? AND flow_path = ?`
    ),
    avgEndedDurationInRange: db.prepare(
      `SELECT AVG(ended_at - started_at) AS avgDurationMs
       FROM ${ANALYTICS_SCHEMA}.conversation_sessions
       WHERE ended_at IS NOT NULL
         AND ended_at >= ? AND ended_at < ?`
    ),
    avgEndedDurationInRangeByFlowPath: db.prepare(
      `SELECT AVG(ended_at - started_at) AS avgDurationMs
       FROM ${ANALYTICS_SCHEMA}.conversation_sessions
       WHERE ended_at IS NOT NULL
         AND ended_at >= ? AND ended_at < ? AND flow_path = ?`
    ),
    countOpenSessions: db.prepare(
      `SELECT COUNT(*) AS total
       FROM ${ANALYTICS_SCHEMA}.conversation_sessions
       WHERE ended_at IS NULL`
    ),
    countOpenSessionsByFlowPath: db.prepare(
      `SELECT COUNT(*) AS total
       FROM ${ANALYTICS_SCHEMA}.conversation_sessions
       WHERE ended_at IS NULL AND flow_path = ?`
    ),
    listStartedSessionsInRange: db.prepare(
      `SELECT started_at
       FROM ${ANALYTICS_SCHEMA}.conversation_sessions
       WHERE started_at >= ? AND started_at < ?`
    ),
    listStartedSessionsInRangeByFlowPath: db.prepare(
      `SELECT started_at
       FROM ${ANALYTICS_SCHEMA}.conversation_sessions
       WHERE started_at >= ? AND started_at < ? AND flow_path = ?`
    ),
    listEndedByReasonInRange: db.prepare(
      `SELECT ended_at
       FROM ${ANALYTICS_SCHEMA}.conversation_sessions
       WHERE ended_at >= ? AND ended_at < ? AND end_reason = ?`
    ),
    listEndedByReasonInRangeByFlowPath: db.prepare(
      `SELECT ended_at
       FROM ${ANALYTICS_SCHEMA}.conversation_sessions
       WHERE ended_at >= ? AND ended_at < ? AND end_reason = ? AND flow_path = ?`
    ),
    listBroadcastContacts: db.prepare(
      `SELECT
         ce.jid AS jid,
         MAX(ce.occurred_at) AS last_interaction_at,
         COALESCE(MAX(cp.display_name), '') AS display_name
       FROM ${ANALYTICS_SCHEMA}.conversation_events ce
       LEFT JOIN ${ANALYTICS_SCHEMA}.contact_profiles cp
         ON cp.jid = ce.jid
       WHERE ce.direction = 'incoming'
          AND ce.jid LIKE '%@s.whatsapp.net'
       GROUP BY ce.jid
       ORDER BY last_interaction_at DESC
       LIMIT ?`
    ),
    searchBroadcastContacts: db.prepare(
      `SELECT
         ce.jid AS jid,
         MAX(ce.occurred_at) AS last_interaction_at,
         COALESCE(MAX(cp.display_name), '') AS display_name
       FROM ${ANALYTICS_SCHEMA}.conversation_events ce
       LEFT JOIN ${ANALYTICS_SCHEMA}.contact_profiles cp
         ON cp.jid = ce.jid
       WHERE ce.direction = 'incoming'
          AND ce.jid LIKE '%@s.whatsapp.net'
         AND (
           ce.jid LIKE ?
           OR cp.display_name LIKE ?
         )
       GROUP BY ce.jid
       ORDER BY last_interaction_at DESC
       LIMIT ?`
    ),
    getContactDisplayNameByJid: db.prepare(
      `SELECT display_name
       FROM ${ANALYTICS_SCHEMA}.contact_profiles
       WHERE jid = ?
       LIMIT 1`
    ),
    listContactProfiles: db.prepare(
      `SELECT jid, display_name, source, updated_at
       FROM ${ANALYTICS_SCHEMA}.contact_profiles
       ORDER BY updated_at DESC
       LIMIT ?`
    ),
    upsertContactProfile: db.prepare(
      `INSERT INTO ${ANALYTICS_SCHEMA}.contact_profiles (jid, display_name, source, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(jid) DO UPDATE SET
         display_name = excluded.display_name,
         source = excluded.source,
         updated_at = excluded.updated_at`
    ),
    insertBroadcastCampaign: db.prepare(
      `INSERT INTO ${ANALYTICS_SCHEMA}.broadcast_campaigns (
        created_at, actor, target_mode, message_type, message_text, media_mime_type, media_file_name, recipient_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ),
    insertBroadcastRecipient: db.prepare(
      `INSERT OR IGNORE INTO ${ANALYTICS_SCHEMA}.broadcast_recipients (
        campaign_id, jid, send_status, error_message, sent_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ),
    updateBroadcastRecipientResult: db.prepare(
      `UPDATE ${ANALYTICS_SCHEMA}.broadcast_recipients
       SET send_status = ?, error_message = ?, sent_at = ?, updated_at = ?
       WHERE campaign_id = ? AND jid = ?`
    ),
    listConversationEventsBefore: db.prepare(
      `SELECT id, occurred_at, event_type, direction, jid, flow_path, message_text, metadata
       FROM ${ANALYTICS_SCHEMA}.conversation_events
       WHERE occurred_at < ?
       ORDER BY occurred_at ASC, id ASC
       LIMIT ?`
    ),
    deleteConversationEventById: db.prepare(
      `DELETE FROM ${ANALYTICS_SCHEMA}.conversation_events
       WHERE id = ?`
    ),
    countSessionsTotal: db.prepare('SELECT COUNT(*) AS total FROM sessions'),
    countSessionsActiveTotal: db.prepare('SELECT COUNT(*) AS total FROM sessions WHERE status = ?'),
    countConversationEventsTotal: db.prepare(`SELECT COUNT(*) AS total FROM ${ANALYTICS_SCHEMA}.conversation_events`),
    countConversationSessionsTotal: db.prepare(`SELECT COUNT(*) AS total FROM ${ANALYTICS_SCHEMA}.conversation_sessions`),
    countBroadcastCampaignsTotal: db.prepare(`SELECT COUNT(*) AS total FROM ${ANALYTICS_SCHEMA}.broadcast_campaigns`),
    countBroadcastRecipientsTotal: db.prepare(`SELECT COUNT(*) AS total FROM ${ANALYTICS_SCHEMA}.broadcast_recipients`),
    upsertDbSizeDaily: db.prepare(
      `INSERT INTO db_size_daily (date_key, total_bytes, captured_at)
       VALUES (?, ?, ?)
       ON CONFLICT(date_key) DO UPDATE SET
         total_bytes = excluded.total_bytes,
         captured_at = excluded.captured_at`
    ),
    listDbSizeDaily: db.prepare(
      `SELECT date_key, total_bytes, captured_at
       FROM db_size_daily
       ORDER BY date_key DESC
       LIMIT ?`
    ),
    countConversationSessionsTotalByFlowPath: db.prepare(
      `SELECT COUNT(*) AS total
       FROM ${ANALYTICS_SCHEMA}.conversation_sessions
       WHERE flow_path = ?`
    ),
  };

  eventInsertTx = db.transaction((events) => {
    for (const event of events) {
      stmts.insertConversationEvent.run(
        event.occurredAt,
        event.eventType,
        event.direction,
        event.jid,
        event.flowPath,
        event.messageText,
        JSON.stringify(event.metadata || {})
      );
    }
  });

  recordDbSizeSnapshot();
  startEventFlushTimer();

  return db;
}
export function getDb() {
  if (!db) throw new Error('Banco de dados não inicializado. Aguarde initDb() primeiro.');
  return db;
}

/**
 * Retorna os prepared statements pré-compilados.
 * Usado pelo authState para acesso direto aos statements do auth_state.
 */
export function getStmts() {
  if (!stmts.getAuthState) throw new Error('Statements não inicializados. Aguarde initDb() primeiro.');
  return stmts;
}

export function configureDatabaseRuntime(input = {}) {
  dbRuntimeState.config = normalizeDbRuntimeConfig(input);
  if (db) {
    applyMainPragmas();
    applyAnalyticsPragmas();
    startEventFlushTimer();
    if (dbRuntimeState.config.eventBatchingEnabled === false) {
      flushConversationEventBuffer({ force: true, reason: 'batching-disabled' });
    }
  }
  return getDatabaseRuntimeConfig();
}

export function getDatabaseRuntimeConfig() {
  return { ...dbRuntimeState.config };
}

export function getDatabaseMaintenanceStatus() {
  return {
    ...dbRuntimeState.maintenance,
  };
}

function normalizeConversationEventInput({
  occurredAt = Date.now(),
  eventType = 'message',
  direction = 'system',
  jid = 'unknown',
  flowPath = '',
  messageText = '',
  metadata = {},
} = {}) {
  const safeMessage = messageText == null ? '' : String(messageText);
  return {
    occurredAt: Number(occurredAt) || Date.now(),
    eventType: String(eventType || 'message'),
    direction: String(direction || 'system'),
    jid: String(jid || 'unknown'),
    flowPath: String(flowPath || ''),
    messageText: safeMessage,
    metadata: normalizeMetadata(metadata),
  };
}

function flushConversationEventBuffer({ force = false, reason = 'manual' } = {}) {
  if (!db || !eventInsertTx) {
    return {
      flushed: 0,
      reason: String(reason || 'manual'),
      skipped: true,
      error: 'db-not-initialized',
    };
  }

  const hasBuffered = Array.isArray(eventBuffer) && eventBuffer.length > 0;
  if (!hasBuffered) {
    return {
      flushed: 0,
      reason: String(reason || 'manual'),
      skipped: true,
      error: '',
    };
  }

  if (!force && dbRuntimeState.config.eventBatchingEnabled === false) {
    return {
      flushed: 0,
      reason: String(reason || 'manual'),
      skipped: true,
      error: 'batching-disabled',
    };
  }

  const pendingEvents = eventBuffer.splice(0, eventBuffer.length);
  try {
    eventInsertTx(pendingEvents);
    return {
      flushed: pendingEvents.length,
      reason: String(reason || 'manual'),
      skipped: false,
      error: '',
    };
  } catch (error) {
    eventBuffer = pendingEvents.concat(eventBuffer);
    return {
      flushed: 0,
      reason: String(reason || 'manual'),
      skipped: false,
      error: String(error?.message || 'event-batch-flush-failed'),
    };
  }
}

function ensureEventBufferFlushedForRead() {
  if (!eventBuffer.length) return;
  flushConversationEventBuffer({ force: true, reason: 'read-consistency' });
}

function shouldRunMaintenanceWindow(lastRunAt, intervalHours, nowTs = Date.now()) {
  const intervalMs = Math.max(1, Number(intervalHours) || 0) * 60 * 60 * 1000;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return false;
  const normalizedLastRun = Number(lastRunAt) || 0;
  if (!normalizedLastRun) return true;
  return nowTs - normalizedLastRun >= intervalMs;
}

function parsePragmaFirstValue(raw) {
  if (Array.isArray(raw)) {
    if (raw.length === 0) return '';
    const first = raw[0];
    if (first && typeof first === 'object' && !Array.isArray(first)) {
      const firstKey = Object.keys(first)[0];
      if (!firstKey) return '';
      return String(first[firstKey] ?? '');
    }
    return String(first ?? '');
  }
  if (raw == null) return '';
  return String(raw);
}

function assertIntegrityCheckOk(raw, label) {
  const value = parsePragmaFirstValue(raw).trim().toLowerCase();
  if (!value || value === 'ok') return;
  throw new Error(`integrity-check-failed:${label}:${value}`);
}

function buildArchiveFileName(rows = [], cutoffTs = 0) {
  const firstId = Number(rows[0]?.id) || 0;
  const lastId = Number(rows[rows.length - 1]?.id) || 0;
  const iso = new Date().toISOString().replace(/[:.]/g, '-');
  return `${iso}-cutoff-${Math.max(0, Math.trunc(Number(cutoffTs) || 0))}-id-${firstId}-${lastId}.jsonl.gz`;
}

function archiveConversationEventRows(rows = [], { cutoffTs = 0 } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { archived: false, filePath: '', bytes: 0, count: 0 };
  }

  ensureArchiveDir();

  const lines = rows.map(row => JSON.stringify({
    id: Number(row?.id) || 0,
    occurredAt: Number(row?.occurred_at) || 0,
    eventType: String(row?.event_type || ''),
    direction: String(row?.direction || ''),
    jid: String(row?.jid || ''),
    flowPath: String(row?.flow_path || ''),
    messageText: row?.message_text == null ? '' : String(row?.message_text),
    metadata: safeParseJson(row?.metadata, {}),
  }));

  const payload = `${lines.join('\n')}\n`;
  const compressed = zlib.gzipSync(Buffer.from(payload, 'utf8'));
  const archiveFilePath = path.join(ARCHIVE_EVENTS_DIR, buildArchiveFileName(rows, cutoffTs));
  fs.writeFileSync(archiveFilePath, compressed);

  return {
    archived: true,
    filePath: archiveFilePath,
    bytes: Number(compressed.length) || 0,
    count: rows.length,
  };
}

function pruneConversationEventsByRetention({
  retentionDays = dbRuntimeState.config.retentionDays,
  archiveEnabled = dbRuntimeState.config.retentionArchiveEnabled,
  batchLimit = 1000,
} = {}) {
  const normalizedRetentionDays = normalizeInt(retentionDays, dbRuntimeState.config.retentionDays, { min: 1, max: 3650 });
  const normalizedBatchLimit = Math.max(50, Math.min(5000, Number(batchLimit) || 1000));
  const cutoffTs = Date.now() - normalizedRetentionDays * 24 * 60 * 60 * 1000;
  const shouldArchive = normalizeBoolean(archiveEnabled, true);
  const deleteBatchTx = db.transaction((ids) => {
    for (const id of ids) {
      stmts.deleteConversationEventById.run(id);
    }
  });

  let totalDeleted = 0;
  let archivedBytes = 0;
  const archivedFiles = [];
  let loops = 0;

  while (true) {
    if (loops > 20000) {
      throw new Error('retention-loop-safety-stop');
    }
    loops += 1;

    const rows = stmts.listConversationEventsBefore.all(cutoffTs, normalizedBatchLimit);
    if (!Array.isArray(rows) || rows.length === 0) break;

    if (shouldArchive) {
      const archiveResult = archiveConversationEventRows(rows, { cutoffTs });
      if (archiveResult.archived) {
        archivedFiles.push(archiveResult.filePath);
        archivedBytes += archiveResult.bytes;
      }
    }

    const ids = rows
      .map(row => Number(row?.id) || 0)
      .filter(id => id > 0);

    if (ids.length === 0) break;
    deleteBatchTx(ids);
    totalDeleted += ids.length;

    if (rows.length < normalizedBatchLimit) break;
  }

  return {
    cutoffTs,
    retentionDays: normalizedRetentionDays,
    deleted: totalDeleted,
    archived: shouldArchive,
    archivedFiles,
    archivedFileCount: archivedFiles.length,
    archivedBytes,
  };
}

export function runDatabaseMaintenance({
  reason = 'manual',
  force = false,
  runRetention = true,
  retentionDays = null,
  retentionArchiveEnabled = null,
} = {}) {
  if (!db) {
    return {
      ok: false,
      error: 'db-not-initialized',
      status: getDatabaseMaintenanceStatus(),
    };
  }

  const normalizedReason = String(reason || 'manual').trim() || 'manual';
  const forceRun = normalizeBoolean(force, false);

  if (!forceRun && dbRuntimeState.config.maintenanceEnabled === false) {
    return {
      ok: true,
      skipped: true,
      reason: normalizedReason,
      status: getDatabaseMaintenanceStatus(),
    };
  }

  if (dbRuntimeState.maintenance.inProgress) {
    return {
      ok: false,
      error: 'maintenance-already-running',
      status: getDatabaseMaintenanceStatus(),
    };
  }

  const startedAt = Date.now();
  dbRuntimeState.maintenance.inProgress = true;
  try {
    const flushResult = flushConversationEventBuffer({ force: true, reason: `maintenance:${normalizedReason}` });
    if (flushResult.error) {
      throw new Error(flushResult.error);
    }

    const cfg = dbRuntimeState.config;
    const maintenanceState = dbRuntimeState.maintenance;
    const checkpointMode = cfg.maintenanceCheckpointMode;
    const summary = {
      reason: normalizedReason,
      checkpointMode,
      flushedEvents: flushResult.flushed,
      checkpoint: {
        main: safePragma(db, `wal_checkpoint(${checkpointMode})`) ?? null,
        analytics: safePragma(db, `${ANALYTICS_SCHEMA}.wal_checkpoint(${checkpointMode})`) ?? null,
      },
      optimizeRan: false,
      retention: null,
      analyzeRan: false,
      vacuumRan: false,
      integrityCheckRan: false,
      integrityCheck: {
        main: '',
        analytics: '',
      },
    };

    safePragma(db, 'optimize');
    safePragma(db, `${ANALYTICS_SCHEMA}.optimize`);
    summary.optimizeRan = true;

    if (runRetention !== false) {
      const retentionSummary = pruneConversationEventsByRetention({
        retentionDays: retentionDays == null ? cfg.retentionDays : retentionDays,
        archiveEnabled: retentionArchiveEnabled == null ? cfg.retentionArchiveEnabled : retentionArchiveEnabled,
      });
      summary.retention = retentionSummary;
      maintenanceState.lastRetentionAt = Date.now();
    }

    const nowForIntervals = Date.now();

    if (forceRun || shouldRunMaintenanceWindow(maintenanceState.lastAnalyzeAt, cfg.maintenanceAnalyzeIntervalHours, nowForIntervals)) {
      db.exec('ANALYZE');
      maintenanceState.lastAnalyzeAt = Date.now();
      summary.analyzeRan = true;
    }

    if (forceRun || shouldRunMaintenanceWindow(maintenanceState.lastVacuumAt, cfg.maintenanceVacuumIntervalHours, nowForIntervals)) {
      db.exec('VACUUM main');
      db.exec(`VACUUM ${ANALYTICS_SCHEMA}`);
      maintenanceState.lastVacuumAt = Date.now();
      summary.vacuumRan = true;
    }

    if (forceRun || shouldRunMaintenanceWindow(maintenanceState.lastIntegrityCheckAt, cfg.maintenanceIntegrityCheckIntervalHours, nowForIntervals)) {
      const mainIntegrity = safePragma(db, 'integrity_check');
      const analyticsIntegrity = safePragma(db, `${ANALYTICS_SCHEMA}.integrity_check`);
      assertIntegrityCheckOk(mainIntegrity, 'main');
      assertIntegrityCheckOk(analyticsIntegrity, ANALYTICS_SCHEMA);
      summary.integrityCheck = {
        main: parsePragmaFirstValue(mainIntegrity),
        analytics: parsePragmaFirstValue(analyticsIntegrity),
      };
      maintenanceState.lastIntegrityCheckAt = Date.now();
      summary.integrityCheckRan = true;
    }

    recordDbSizeSnapshot();

    const finishedAt = Date.now();
    const durationMs = Math.max(0, finishedAt - startedAt);
    dbRuntimeState.maintenance.lastRunAt = finishedAt;
    dbRuntimeState.maintenance.lastRunReason = normalizedReason;
    dbRuntimeState.maintenance.lastDurationMs = durationMs;
    dbRuntimeState.maintenance.lastStatus = 'success';
    dbRuntimeState.maintenance.lastError = '';
    dbRuntimeState.maintenance.lastSummary = summary;

    return {
      ok: true,
      skipped: false,
      durationMs,
      summary,
      status: getDatabaseMaintenanceStatus(),
    };
  } catch (error) {
    const finishedAt = Date.now();
    const durationMs = Math.max(0, finishedAt - startedAt);
    const normalizedError = String(error?.message || 'db-maintenance-failed');
    dbRuntimeState.maintenance.lastRunAt = finishedAt;
    dbRuntimeState.maintenance.lastRunReason = normalizedReason;
    dbRuntimeState.maintenance.lastDurationMs = durationMs;
    dbRuntimeState.maintenance.lastStatus = 'failed';
    dbRuntimeState.maintenance.lastError = normalizedError;
    dbRuntimeState.maintenance.lastSummary = null;

    return {
      ok: false,
      skipped: false,
      durationMs,
      error: normalizedError,
      status: getDatabaseMaintenanceStatus(),
    };
  } finally {
    dbRuntimeState.maintenance.inProgress = false;
  }
}

/**
 * writeToDisk() — mantida como no-op para compatibilidade de assinatura.
 * Com better-sqlite3 + WAL, a persistência é automática e incremental.
 * @deprecated Não é mais necessário chamar manualmente.
 */
export function writeToDisk() {
  if (!db) return;
  flushConversationEventBuffer({ force: true, reason: 'writeToDisk' });
}

// ─── Auxiliares de Sessão ─────────────────────────────────────────────────────

export function getSession(jid, scope = null) {
  const normalizedJid = String(jid ?? '').trim();
  if (!normalizedJid) return null;

  const { flowPath } = normalizeSessionScope(scope);
  if (flowPath) {
    const row = stmts.getSession.get(normalizedJid, flowPath);
    return row ? mapSessionRow(row) : null;
  }

  const latest = stmts.getLatestSessionByJid.get(normalizedJid);
  return latest ? mapSessionRow(latest) : null;
}

export function createSession(jid, scope = null) {
  const normalizedJid = String(jid ?? '').trim();
  if (!normalizedJid) return null;

  const { flowPath, botType } = normalizeSessionScope(scope);
  const resolvedBotType = botType ?? 'conversation';
  stmts.createSession.run(normalizedJid, flowPath, resolvedBotType, SESSION_STATUS.ACTIVE);
  return getSession(normalizedJid, { flowPath });
}

function normalizeVariablesDelta(delta = {}) {
  if (!delta || typeof delta !== 'object' || Array.isArray(delta)) {
    return { setEntries: [], removeKeys: [] };
  }

  const setEntries = [];
  const removeKeys = [];

  const setValues = delta.set && typeof delta.set === 'object' && !Array.isArray(delta.set)
    ? delta.set
    : {};
  for (const [key, value] of Object.entries(setValues)) {
    const normalizedKey = String(key ?? '').trim();
    if (!normalizedKey) continue;
    if (value === undefined) {
      removeKeys.push(normalizedKey);
      continue;
    }
    setEntries.push([normalizedKey, value]);
  }

  const removeValues = Array.isArray(delta.remove) ? delta.remove : [];
  for (const key of removeValues) {
    const normalizedKey = String(key ?? '').trim();
    if (!normalizedKey) continue;
    if (setEntries.some(([setKey]) => setKey === normalizedKey)) continue;
    removeKeys.push(normalizedKey);
  }

  return { setEntries, removeKeys };
}

function estimateUtf8Bytes(value) {
  try {
    return Buffer.byteLength(String(value ?? ''), 'utf8');
  } catch {
    return 0;
  }
}

export function updateSession(jid, patch = {}, scope = null) {
  const normalizedJid = String(jid ?? '').trim();
  if (!normalizedJid) return;

  const { flowPath, botType } = normalizeSessionScope(scope);
  const setClauses = [];
  const params = [];

  if (Object.prototype.hasOwnProperty.call(patch, 'botType')) {
    const resolvedBotType = String(patch.botType ?? botType ?? 'conversation').toLowerCase() === 'command'
      ? 'command'
      : 'conversation';
    setClauses.push('bot_type = ?');
    params.push(resolvedBotType);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'blockIndex')) {
    setClauses.push('block_index = ?');
    params.push(Number.isFinite(Number(patch.blockIndex)) ? Number(patch.blockIndex) : 0);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'status')) {
    setClauses.push('status = ?');
    params.push(String(patch.status ?? SESSION_STATUS.ACTIVE));
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'waitingFor')) {
    setClauses.push('waiting_for = ?');
    params.push(patch.waitingFor == null ? null : String(patch.waitingFor));
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'variables')) {
    const serializedVariables = JSON.stringify(patch.variables ?? {});
    const warnLimit = Number(dbRuntimeState.config.maxVariablesBytesWarn) || 0;
    if (warnLimit > 0 && estimateUtf8Bytes(serializedVariables) > warnLimit) {
      // warn-only policy: observability sem bloquear o runtime
      console.warn(
        `[db] Session variables payload exceeded warning threshold (${warnLimit} bytes)`
      );
    }
    setClauses.push('variables = ?');
    params.push(serializedVariables);
  } else if (Object.prototype.hasOwnProperty.call(patch, 'variablesDelta')) {
    const { setEntries, removeKeys } = normalizeVariablesDelta(patch.variablesDelta);
    if (setEntries.length > 0 || removeKeys.length > 0) {
      let expression = "COALESCE(variables, '{}')";
      for (const [key, value] of setEntries) {
        expression = `json_set(${expression}, ?, json(?))`;
        params.push(toJsonPath(key), JSON.stringify(value));
      }
      for (const key of removeKeys) {
        expression = `json_remove(${expression}, ?)`;
        params.push(toJsonPath(key));
      }
      setClauses.push(`variables = ${expression}`);
    }
  }

  setClauses.push("updated_at = strftime('%s','now')");
  const sql = `UPDATE sessions SET ${setClauses.join(', ')} WHERE jid = ? AND flow_path = ?`;
  params.push(normalizedJid, flowPath);
  getDynamicStatement(sql).run(...params);
}

export function deleteSession(jid, scope = null) {
  const normalizedJid = String(jid ?? '').trim();
  if (!normalizedJid) return;
  const { flowPath } = normalizeSessionScope(scope);
  stmts.deleteSession.run(normalizedJid, flowPath);
}

export function getActiveSessions(scope = null) {
  const { flowPath, botType } = normalizeSessionScope(scope);
  let rows = [];
  if (flowPath) {
    rows = stmts.getActiveSessionsByFlowPath.all(SESSION_STATUS.ACTIVE, flowPath);
  } else if (botType) {
    rows = stmts.getActiveSessionsByBotType.all(SESSION_STATUS.ACTIVE, botType);
  } else {
    rows = stmts.getActiveSessions.all(SESSION_STATUS.ACTIVE);
  }
  return rows.map(mapSessionRow);
}

export function getActiveSessionsPage(scope = null, {
  cursorUpdatedAt = Number.MAX_SAFE_INTEGER,
  cursorJid = '\uffff',
  limit = 200,
} = {}) {
  const { flowPath, botType } = normalizeSessionScope(scope);
  const normalizedLimit = Math.max(1, Math.min(2000, Number(limit) || 200));
  const normalizedCursorUpdatedAt = Number.isFinite(Number(cursorUpdatedAt))
    ? Number(cursorUpdatedAt)
    : Number.MAX_SAFE_INTEGER;
  const normalizedCursorJid = String(cursorJid ?? '\uffff');

  let rows = [];
  if (flowPath) {
    rows = stmts.getActiveSessionsPageByFlowPath.all(
      SESSION_STATUS.ACTIVE,
      flowPath,
      normalizedCursorUpdatedAt,
      normalizedCursorUpdatedAt,
      normalizedCursorJid,
      normalizedLimit
    );
  } else if (botType) {
    rows = stmts.getActiveSessionsPageByBotType.all(
      SESSION_STATUS.ACTIVE,
      botType,
      normalizedCursorUpdatedAt,
      normalizedCursorUpdatedAt,
      normalizedCursorJid,
      normalizedLimit
    );
  } else {
    rows = stmts.getActiveSessionsPage.all(
      SESSION_STATUS.ACTIVE,
      normalizedCursorUpdatedAt,
      normalizedCursorUpdatedAt,
      normalizedCursorJid,
      normalizedLimit
    );
  }

  return rows.map(mapSessionRow);
}

function safeParseJson(text, fallback = {}) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function normalizeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return {};
  return metadata;
}

export function addConversationEvent({
  occurredAt = Date.now(),
  eventType = 'message',
  direction = 'system',
  jid = 'unknown',
  flowPath = '',
  messageText = '',
  metadata = {},
} = {}) {
  if (!db || !stmts.insertConversationEvent) return;

  const event = normalizeConversationEventInput({
    occurredAt,
    eventType,
    direction,
    jid,
    flowPath,
    messageText,
    metadata,
  });

  if (dbRuntimeState.config.eventBatchingEnabled) {
    eventBuffer.push(event);
    const maxBatchSize = Math.max(1, Number(dbRuntimeState.config.eventBatchSize) || 1);
    if (eventBuffer.length >= maxBatchSize) {
      flushConversationEventBuffer({ reason: 'batch-size-threshold' });
    }
  } else {
    stmts.insertConversationEvent.run(
      event.occurredAt,
      event.eventType,
      event.direction,
      event.jid,
      event.flowPath,
      event.messageText,
      JSON.stringify(event.metadata || {})
    );
  }

  for (const listener of conversationEventListeners) {
    try {
      listener(event);
    } catch {
      // ignore listener errors
    }
  }
}

function mapConversationEventRow(row) {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    eventType: row.event_type,
    direction: row.direction,
    jid: row.jid,
    flowPath: row.flow_path,
    messageText: row.message_text,
    metadata: safeParseJson(row.metadata, {}),
  };
}

export function listConversationEvents(limit = 200) {
  ensureEventBufferFlushedForRead();
  const normalizedLimit = Math.max(1, Math.min(1000, Number(limit) || 200));
  const rows = stmts.listConversationEvents.all(normalizedLimit);
  return rows.map(mapConversationEventRow);
}

export function listConversationEventsByFlowPath(flowPath, limit = 200) {
  ensureEventBufferFlushedForRead();
  const normalizedFlowPath = String(flowPath ?? '').trim();
  if (!normalizedFlowPath) return [];
  const normalizedLimit = Math.max(1, Math.min(1000, Number(limit) || 200));
  const rows = stmts.listConversationEventsByFlowPath.all(normalizedFlowPath, normalizedLimit);
  return rows.map(mapConversationEventRow);
}

export function listConversationEventsByJid(jid, limit = 200) {
  ensureEventBufferFlushedForRead();
  const normalizedJid = String(jid ?? '').trim();
  if (!normalizedJid) return [];
  const normalizedLimit = Math.max(1, Math.min(1000, Number(limit) || 200));
  const rows = stmts.listConversationEventsByJid.all(normalizedJid, normalizedLimit);
  return rows.map(mapConversationEventRow);
}

export function listConversationEventsSince(sinceTimestamp, limit = 500) {
  ensureEventBufferFlushedForRead();
  const normalizedLimit = Math.max(1, Math.min(2000, Number(limit) || 500));
  const since = Number(sinceTimestamp) || 0;
  const rows = stmts.listConversationEventsSince.all(since, normalizedLimit);
  return rows.map(mapConversationEventRow);
}

export function listConversationEventsSinceByFlowPath(flowPath, sinceTimestamp, limit = 500) {
  ensureEventBufferFlushedForRead();
  const normalizedFlowPath = String(flowPath ?? '').trim();
  if (!normalizedFlowPath) return [];
  const normalizedLimit = Math.max(1, Math.min(2000, Number(limit) || 500));
  const since = Number(sinceTimestamp) || 0;
  const rows = stmts.listConversationEventsSinceByFlowPath.all(normalizedFlowPath, since, normalizedLimit);
  return rows.map(mapConversationEventRow);
}

export function listConversationEventsSinceByJid(jid, sinceTimestamp, limit = 500) {
  ensureEventBufferFlushedForRead();
  const normalizedJid = String(jid ?? '').trim();
  if (!normalizedJid) return [];
  const normalizedLimit = Math.max(1, Math.min(2000, Number(limit) || 500));
  const since = Number(sinceTimestamp) || 0;
  const rows = stmts.listConversationEventsSinceByJid.all(normalizedJid, since, normalizedLimit);
  return rows.map(mapConversationEventRow);
}

export function createConversationSessionRecord({
  sessionId,
  jid,
  flowPath = '',
  startedAt = Date.now(),
}) {
  if (!sessionId || !jid) return;
  stmts.createConversationSession.run(
    String(sessionId),
    String(jid),
    String(flowPath || ''),
    Number(startedAt) || Date.now()
  );
}

export function finishConversationSessionRecord({
  sessionId,
  endedAt = Date.now(),
  endReason = 'unknown',
}) {
  if (!sessionId) return;
  stmts.finishConversationSession.run(
    Number(endedAt) || Date.now(),
    String(endReason || 'unknown'),
    String(sessionId)
  );
}

export function clearActiveSessions() {
  const active = getActiveSessions();
  stmts.deleteActiveSessions.run(SESSION_STATUS.ACTIVE);
  return active;
}

export function clearActiveSessionsByFlowPath(flowPath) {
  const normalizedFlowPath = String(flowPath ?? '').trim();
  if (!normalizedFlowPath) return [];
  const active = getActiveSessions({ flowPath: normalizedFlowPath });
  stmts.deleteActiveSessionsByFlowPath.run(SESSION_STATUS.ACTIVE, normalizedFlowPath);
  return active;
}

export function getConversationDashboardStats({ from, to, flowPath = '' }) {
  const fromTs = Number(from) || 0;
  const toTs = Number(to) || Date.now();
  const normalizedFlowPath = String(flowPath ?? '').trim();

  const started = normalizedFlowPath
    ? (stmts.countStartedSessionsInRangeByFlowPath.get(fromTs, toTs, normalizedFlowPath)?.total ?? 0)
    : (stmts.countStartedSessionsInRange.get(fromTs, toTs)?.total ?? 0);
  const abandoned = normalizedFlowPath
    ? (stmts.countEndedByReasonInRangeByFlowPath.get(fromTs, toTs, 'timeout', normalizedFlowPath)?.total ?? 0)
    : (stmts.countEndedByReasonInRange.get(fromTs, toTs, 'timeout')?.total ?? 0);
  const avgDurationMs = normalizedFlowPath
    ? (stmts.avgEndedDurationInRangeByFlowPath.get(fromTs, toTs, normalizedFlowPath)?.avgDurationMs ?? 0)
    : (stmts.avgEndedDurationInRange.get(fromTs, toTs)?.avgDurationMs ?? 0);
  const activeSessions = normalizedFlowPath
    ? (stmts.countOpenSessionsByFlowPath.get(normalizedFlowPath)?.total ?? 0)
    : (stmts.countOpenSessions.get()?.total ?? 0);

  return {
    conversationsStarted: Number(started) || 0,
    abandonedSessions: Number(abandoned) || 0,
    abandonmentRate: (Number(started) || 0) > 0
      ? Number(((Number(abandoned) || 0) / Number(started)).toFixed(4))
      : 0,
    averageDurationMs: Number(avgDurationMs) || 0,
    activeSessions: Number(activeSessions) || 0,
  };
}

export function getConversationSessionsTotal(flowPath = '') {
  const normalizedFlowPath = String(flowPath ?? '').trim();
  if (normalizedFlowPath) {
    return Number(stmts.countConversationSessionsTotalByFlowPath.get(normalizedFlowPath)?.total ?? 0) || 0;
  }
  return Number(stmts.countConversationSessionsTotal.get()?.total ?? 0) || 0;
}

export function getConversationEndedByReasonCount({ from, to, endReason, flowPath = '' }) {
  const fromTs = Number(from) || 0;
  const toTs = Number(to) || Date.now();
  const reason = String(endReason ?? '').trim();
  if (!reason) return 0;

  const normalizedFlowPath = String(flowPath ?? '').trim();
  if (normalizedFlowPath) {
    return Number(
      stmts.countEndedByReasonInRangeByFlowPath.get(fromTs, toTs, reason, normalizedFlowPath)?.total ?? 0
    ) || 0;
  }

  return Number(stmts.countEndedByReasonInRange.get(fromTs, toTs, reason)?.total ?? 0) || 0;
}

export function listConversationSessionStarts({ from, to, flowPath = '' }) {
  const fromTs = Number(from) || 0;
  const toTs = Number(to) || Date.now();
  const normalizedFlowPath = String(flowPath ?? '').trim();

  const rows = normalizedFlowPath
    ? stmts.listStartedSessionsInRangeByFlowPath.all(fromTs, toTs, normalizedFlowPath)
    : stmts.listStartedSessionsInRange.all(fromTs, toTs);

  return rows.map(row => Number(row.started_at) || 0).filter(Boolean);
}

export function listConversationSessionEndsByReason({ from, to, endReason, flowPath = '' }) {
  const fromTs = Number(from) || 0;
  const toTs = Number(to) || Date.now();
  const reason = String(endReason ?? '').trim();
  if (!reason) return [];

  const normalizedFlowPath = String(flowPath ?? '').trim();
  const rows = normalizedFlowPath
    ? stmts.listEndedByReasonInRangeByFlowPath.all(fromTs, toTs, reason, normalizedFlowPath)
    : stmts.listEndedByReasonInRange.all(fromTs, toTs, reason);

  return rows.map(row => Number(row.ended_at) || 0).filter(Boolean);
}

function mapBroadcastContactRow(row) {
  return {
    jid: String(row?.jid || '').trim(),
    name: String(row?.display_name || '').trim(),
    lastInteractionAt: Number(row?.last_interaction_at) || 0,
  };
}

export function listBroadcastContacts({ search = '', limit = 200 } = {}) {
  ensureEventBufferFlushedForRead();
  const normalizedLimit = Math.max(1, Math.min(5000, Number(limit) || 200));
  const normalizedSearch = String(search ?? '').trim();
  const rows = normalizedSearch
    ? stmts.searchBroadcastContacts.all(`%${normalizedSearch}%`, `%${normalizedSearch}%`, normalizedLimit)
    : stmts.listBroadcastContacts.all(normalizedLimit);

  return rows
    .map(mapBroadcastContactRow)
    .filter(row => row.jid);
}

function normalizePersistedDisplayName(value, fallbackJid = '') {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const cleaned = raw.replace(/^~+\s*/, '').trim();
  const resolved = cleaned || raw;
  if (!resolved) return '';
  const normalizedJid = String(fallbackJid ?? '').trim();
  if (normalizedJid && resolved === normalizedJid) return '';
  return resolved.slice(0, 180);
}

export function upsertContactDisplayName({
  jid = '',
  displayName = '',
  source = 'runtime',
  updatedAt = Date.now(),
} = {}) {
  const normalizedJid = String(jid ?? '').trim();
  if (!normalizedJid) return false;
  const normalizedDisplayName = normalizePersistedDisplayName(displayName, normalizedJid);
  if (!normalizedDisplayName) return false;
  const normalizedSource = String(source ?? '').trim() || 'runtime';
  const normalizedUpdatedAt = Number(updatedAt) || Date.now();

  stmts.upsertContactProfile.run(
    normalizedJid,
    normalizedDisplayName,
    normalizedSource,
    normalizedUpdatedAt
  );

  return true;
}

export function getContactDisplayName(jid = '') {
  const normalizedJid = String(jid ?? '').trim();
  if (!normalizedJid) return '';
  const row = stmts.getContactDisplayNameByJid.get(normalizedJid);
  return normalizePersistedDisplayName(row?.display_name, normalizedJid);
}

export function listContactDisplayNames(limit = 5000) {
  const normalizedLimit = Math.max(1, Math.min(50000, Number(limit) || 5000));
  const rows = stmts.listContactProfiles.all(normalizedLimit);
  return rows
    .map(row => {
      const jid = String(row?.jid || '').trim();
      const name = normalizePersistedDisplayName(row?.display_name, jid);
      if (!jid || !name) return null;
      return {
        jid,
        name,
        source: String(row?.source || '').trim() || 'runtime',
        updatedAt: Number(row?.updated_at) || 0,
      };
    })
    .filter(Boolean);
}

function normalizeRecipientList(recipients = []) {
  if (!Array.isArray(recipients)) return [];
  const seen = new Set();
  const result = [];
  for (const item of recipients) {
    const jid = String(item ?? '').trim();
    if (!jid || seen.has(jid)) continue;
    seen.add(jid);
    result.push(jid);
  }
  return result;
}

export function createBroadcastDispatch({
  createdAt = Date.now(),
  actor = 'dashboard-agent',
  targetMode = 'all',
  messageType = 'text',
  messageText = '',
  mediaMimeType = '',
  mediaFileName = '',
  recipients = [],
} = {}) {
  const normalizedRecipients = normalizeRecipientList(recipients);
  const nowTs = Number(createdAt) || Date.now();
  const insertTx = db.transaction(() => {
    const info = stmts.insertBroadcastCampaign.run(
      nowTs,
      String(actor || 'dashboard-agent'),
      String(targetMode || 'all'),
      String(messageType || 'text'),
      String(messageText || ''),
      String(mediaMimeType || ''),
      String(mediaFileName || ''),
      normalizedRecipients.length
    );
    const campaignId = Number(info?.lastInsertRowid) || 0;

    for (const jid of normalizedRecipients) {
      stmts.insertBroadcastRecipient.run(
        campaignId,
        jid,
        'pending',
        '',
        null,
        nowTs,
        nowTs
      );
    }

    return { campaignId };
  });

  return insertTx();
}

export function markBroadcastRecipientResult({
  campaignId,
  jid,
  status = 'failed',
  errorMessage = '',
  sentAt = Date.now(),
} = {}) {
  const normalizedCampaignId = Number(campaignId) || 0;
  const normalizedJid = String(jid ?? '').trim();
  if (!normalizedCampaignId || !normalizedJid) return;

  const normalizedStatus = String(status ?? '').trim().toLowerCase() === 'sent' ? 'sent' : 'failed';
  const nowTs = Date.now();
  stmts.updateBroadcastRecipientResult.run(
    normalizedStatus,
    String(errorMessage || ''),
    normalizedStatus === 'sent' ? (Number(sentAt) || nowTs) : null,
    nowTs,
    normalizedCampaignId,
    normalizedJid
  );
}

function fileSizeOrZero(filePath) {
  try {
    if (!fs.existsSync(filePath)) return 0;
    return Number(fs.statSync(filePath).size) || 0;
  } catch {
    return 0;
  }
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function toLocalDateKey(now = new Date()) {
  const year = now.getFullYear();
  const month = pad2(now.getMonth() + 1);
  const day = pad2(now.getDate());
  return `${year}-${month}-${day}`;
}

function toDbStorageTotalBytes() {
  return (
    fileSizeOrZero(RUNTIME_DB_PATH) +
    fileSizeOrZero(`${RUNTIME_DB_PATH}-wal`) +
    fileSizeOrZero(`${RUNTIME_DB_PATH}-shm`) +
    fileSizeOrZero(ANALYTICS_DB_PATH) +
    fileSizeOrZero(`${ANALYTICS_DB_PATH}-wal`) +
    fileSizeOrZero(`${ANALYTICS_DB_PATH}-shm`)
  );
}

function recordDbSizeSnapshot(nowTs = Date.now()) {
  const dateKey = toLocalDateKey(new Date(nowTs));
  const totalBytes = toDbStorageTotalBytes();
  stmts.upsertDbSizeDaily.run(dateKey, totalBytes, nowTs);
}

function listDbSizeDaily(days = 7) {
  const limit = Math.max(1, Math.min(365, Number(days) || 7));
  const rows = stmts.listDbSizeDaily.all(limit);
  return rows
    .map(row => ({
      date: String(row?.date_key || ''),
      totalBytes: Number(row?.total_bytes) || 0,
      capturedAt: Number(row?.captured_at) || 0,
    }))
    .filter(item => item.date)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function getDatabaseInfo() {
  ensureEventBufferFlushedForRead();
  recordDbSizeSnapshot();
  const journalMode = String(safePragma(db, 'journal_mode')?.[0]?.journal_mode || '').toLowerCase();
  const synchronous = String(safePragma(db, 'synchronous')?.[0]?.synchronous || '');
  const journalModeAnalytics = String(safePragma(db, `${ANALYTICS_SCHEMA}.journal_mode`)?.[0]?.journal_mode || '').toLowerCase();
  const synchronousAnalytics = String(safePragma(db, `${ANALYTICS_SCHEMA}.synchronous`)?.[0]?.synchronous || '');

  const runtimeStorage = {
    path: RUNTIME_DB_PATH,
    fileSizeBytes: fileSizeOrZero(RUNTIME_DB_PATH),
    walSizeBytes: fileSizeOrZero(`${RUNTIME_DB_PATH}-wal`),
    shmSizeBytes: fileSizeOrZero(`${RUNTIME_DB_PATH}-shm`),
  };
  runtimeStorage.totalStorageBytes = runtimeStorage.fileSizeBytes + runtimeStorage.walSizeBytes + runtimeStorage.shmSizeBytes;

  const analyticsStorage = {
    path: ANALYTICS_DB_PATH,
    fileSizeBytes: fileSizeOrZero(ANALYTICS_DB_PATH),
    walSizeBytes: fileSizeOrZero(`${ANALYTICS_DB_PATH}-wal`),
    shmSizeBytes: fileSizeOrZero(`${ANALYTICS_DB_PATH}-shm`),
  };
  analyticsStorage.totalStorageBytes = analyticsStorage.fileSizeBytes + analyticsStorage.walSizeBytes + analyticsStorage.shmSizeBytes;

  const fileSizeBytes = runtimeStorage.fileSizeBytes + analyticsStorage.fileSizeBytes;
  const walSizeBytes = runtimeStorage.walSizeBytes + analyticsStorage.walSizeBytes;
  const shmSizeBytes = runtimeStorage.shmSizeBytes + analyticsStorage.shmSizeBytes;
  const totalStorageBytes = fileSizeBytes + walSizeBytes + shmSizeBytes;
  const sizeHistory = listDbSizeDaily(DB_SIZE_HISTORY_DAYS);
  const previousPoint = sizeHistory.length > 1 ? sizeHistory[sizeHistory.length - 2] : null;
  const currentPoint = sizeHistory.length > 0 ? sizeHistory[sizeHistory.length - 1] : null;
  const dailyGrowthBytes = previousPoint && currentPoint
    ? Math.max(0, Number(currentPoint.totalBytes) - Number(previousPoint.totalBytes))
    : 0;

  return {
    path: RUNTIME_DB_PATH,
    journalMode,
    synchronous,
    journalModeAnalytics,
    synchronousAnalytics,
    fileSizeBytes,
    walSizeBytes,
    shmSizeBytes,
    totalStorageBytes,
    sizeHistory,
    sessionsTotal: Number(stmts.countSessionsTotal.get()?.total ?? 0) || 0,
    sessionsActive: Number(stmts.countSessionsActiveTotal.get(SESSION_STATUS.ACTIVE)?.total ?? 0) || 0,
    conversationEventsTotal: Number(stmts.countConversationEventsTotal.get()?.total ?? 0) || 0,
    conversationSessionsTotal: Number(stmts.countConversationSessionsTotal.get()?.total ?? 0) || 0,
    broadcastCampaignsTotal: Number(stmts.countBroadcastCampaignsTotal.get()?.total ?? 0) || 0,
    broadcastRecipientsTotal: Number(stmts.countBroadcastRecipientsTotal.get()?.total ?? 0) || 0,
    splitDatabases: true,
    files: {
      runtime: runtimeStorage,
      analytics: analyticsStorage,
    },
    dailyGrowthBytes,
    maintenance: getDatabaseMaintenanceStatus(),
    runtimeConfig: getDatabaseRuntimeConfig(),
    operationalLimits: {
      retentionDays: Number(dbRuntimeState.config.retentionDays) || 0,
      eventBatchSize: Number(dbRuntimeState.config.eventBatchSize) || 0,
      eventBatchFlushMs: Number(dbRuntimeState.config.eventBatchFlushMs) || 0,
      maxVariablesBytesWarn: Number(dbRuntimeState.config.maxVariablesBytesWarn) || 0,
    },
  };
}

export function onConversationEvent(listener) {
  if (typeof listener !== 'function') return () => {};
  conversationEventListeners.add(listener);
  return () => {
    conversationEventListeners.delete(listener);
  };
}

