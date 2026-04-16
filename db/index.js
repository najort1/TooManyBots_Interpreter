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
import { fileURLToPath } from 'url';
import { SESSION_STATUS } from '../config/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR   = path.join(__dirname, '..', 'data');
const DB_PATH    = path.join(DATA_DIR, 'sessions.db');

/** @type {import('better-sqlite3').Database} */
let db;

/** Prepared statements — compilados uma vez, reutilizados sempre. */
let stmts = {};
const dynamicStatementCache = new Map();
const conversationEventListeners = new Set();

function tableExists(name) {
  return Boolean(
    db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1"
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

// ─── Inicialização ─────────────────────────────────────────────────────────────────────

/**
 * Inicializa o banco de dados com better-sqlite3.
 * Não é mais async (better-sqlite3 é síncrono), mas mantém a assinatura
 * async para compatibilidade com o código existente.
 */
export async function initDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  db = new Database(DB_PATH);

  // WAL mode — escrita incremental, sem bloquear event-loop, sem corrupção
  db.pragma('journal_mode = WAL');
  // NORMAL sync — equilíbrio entre performance e durabilidade
  db.pragma('synchronous = NORMAL');

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
    CREATE TABLE IF NOT EXISTS conversation_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      occurred_at INTEGER NOT NULL,
      event_type  TEXT    NOT NULL,
      direction   TEXT    NOT NULL,
      jid         TEXT    NOT NULL,
      flow_path   TEXT    NOT NULL DEFAULT '',
      message_text TEXT,
      metadata    TEXT    NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS conversation_sessions (
      session_id  TEXT PRIMARY KEY,
      jid         TEXT    NOT NULL,
      flow_path   TEXT    NOT NULL DEFAULT '',
      started_at  INTEGER NOT NULL,
      ended_at    INTEGER,
      end_reason  TEXT
    );
    CREATE TABLE IF NOT EXISTS broadcast_campaigns (
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
    CREATE TABLE IF NOT EXISTS broadcast_recipients (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id    INTEGER NOT NULL,
      jid            TEXT    NOT NULL,
      send_status    TEXT    NOT NULL DEFAULT 'pending',
      error_message  TEXT,
      sent_at        INTEGER,
      created_at     INTEGER NOT NULL,
      updated_at     INTEGER NOT NULL,
      UNIQUE(campaign_id, jid),
      FOREIGN KEY (campaign_id) REFERENCES broadcast_campaigns(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS contact_profiles (
      jid           TEXT PRIMARY KEY,
      display_name  TEXT NOT NULL,
      source        TEXT NOT NULL DEFAULT 'runtime',
      updated_at    INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS db_size_daily (
      date_key      TEXT PRIMARY KEY,
      total_bytes   INTEGER NOT NULL,
      captured_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_conversation_events_occurred_at ON conversation_events(occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_conversation_events_jid ON conversation_events(jid);
    CREATE INDEX IF NOT EXISTS idx_conversation_events_jid_occurred_at ON conversation_events(jid, occurred_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_conversation_events_flow_path_occurred_at ON conversation_events(flow_path, occurred_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_conversation_sessions_started_at ON conversation_sessions(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_conversation_sessions_ended_at ON conversation_sessions(ended_at DESC);
    CREATE INDEX IF NOT EXISTS idx_broadcast_campaigns_created_at ON broadcast_campaigns(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_campaign_status ON broadcast_recipients(campaign_id, send_status);
    CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_jid_created ON broadcast_recipients(jid, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_contact_profiles_display_name ON contact_profiles(display_name);
    CREATE INDEX IF NOT EXISTS idx_contact_profiles_updated_at ON contact_profiles(updated_at DESC);
  `);

  rebuildSessionsTableIfNeeded();

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_jid_updated_at ON sessions(jid, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_status_updated_at ON sessions(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_flow_status ON sessions(flow_path, status);
    CREATE INDEX IF NOT EXISTS idx_sessions_status_updated_jid ON sessions(status, updated_at DESC, jid DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_flow_status_updated_jid ON sessions(flow_path, status, updated_at DESC, jid DESC);
  `);

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
      `INSERT INTO conversation_events (
        occurred_at, event_type, direction, jid, flow_path, message_text, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ),
    listConversationEvents: db.prepare(
      `SELECT id, occurred_at, event_type, direction, jid, flow_path, message_text, metadata
       FROM conversation_events
       ORDER BY occurred_at DESC, id DESC
       LIMIT ?`
    ),
    listConversationEventsByFlowPath: db.prepare(
      `SELECT id, occurred_at, event_type, direction, jid, flow_path, message_text, metadata
       FROM conversation_events
       WHERE flow_path = ?
       ORDER BY occurred_at DESC, id DESC
       LIMIT ?`
    ),
    listConversationEventsByJid: db.prepare(
      `SELECT id, occurred_at, event_type, direction, jid, flow_path, message_text, metadata
       FROM conversation_events
       WHERE jid = ?
       ORDER BY occurred_at DESC, id DESC
       LIMIT ?`
    ),
    listConversationEventsSince: db.prepare(
      `SELECT id, occurred_at, event_type, direction, jid, flow_path, message_text, metadata
       FROM conversation_events
       WHERE occurred_at > ?
       ORDER BY occurred_at ASC, id ASC
       LIMIT ?`
    ),
    listConversationEventsSinceByFlowPath: db.prepare(
      `SELECT id, occurred_at, event_type, direction, jid, flow_path, message_text, metadata
       FROM conversation_events
       WHERE flow_path = ? AND occurred_at > ?
       ORDER BY occurred_at ASC, id ASC
       LIMIT ?`
    ),
    listConversationEventsSinceByJid: db.prepare(
      `SELECT id, occurred_at, event_type, direction, jid, flow_path, message_text, metadata
       FROM conversation_events
       WHERE jid = ? AND occurred_at > ?
       ORDER BY occurred_at ASC, id ASC
       LIMIT ?`
    ),
    createConversationSession: db.prepare(
      `INSERT OR REPLACE INTO conversation_sessions (
        session_id, jid, flow_path, started_at, ended_at, end_reason
      ) VALUES (?, ?, ?, ?, NULL, NULL)`
    ),
    finishConversationSession: db.prepare(
      `UPDATE conversation_sessions
       SET ended_at = ?, end_reason = ?
       WHERE session_id = ?`
    ),
    countStartedSessionsInRange: db.prepare(
      `SELECT COUNT(*) AS total
       FROM conversation_sessions
       WHERE started_at >= ? AND started_at < ?`
    ),
    countStartedSessionsInRangeByFlowPath: db.prepare(
      `SELECT COUNT(*) AS total
       FROM conversation_sessions
       WHERE started_at >= ? AND started_at < ? AND flow_path = ?`
    ),
    countEndedByReasonInRange: db.prepare(
      `SELECT COUNT(*) AS total
       FROM conversation_sessions
       WHERE ended_at >= ? AND ended_at < ? AND end_reason = ?`
    ),
    countEndedByReasonInRangeByFlowPath: db.prepare(
      `SELECT COUNT(*) AS total
       FROM conversation_sessions
       WHERE ended_at >= ? AND ended_at < ? AND end_reason = ? AND flow_path = ?`
    ),
    avgEndedDurationInRange: db.prepare(
      `SELECT AVG(ended_at - started_at) AS avgDurationMs
       FROM conversation_sessions
       WHERE ended_at IS NOT NULL
         AND ended_at >= ? AND ended_at < ?`
    ),
    avgEndedDurationInRangeByFlowPath: db.prepare(
      `SELECT AVG(ended_at - started_at) AS avgDurationMs
       FROM conversation_sessions
       WHERE ended_at IS NOT NULL
         AND ended_at >= ? AND ended_at < ? AND flow_path = ?`
    ),
    countOpenSessions: db.prepare(
      `SELECT COUNT(*) AS total
       FROM conversation_sessions
       WHERE ended_at IS NULL`
    ),
    countOpenSessionsByFlowPath: db.prepare(
      `SELECT COUNT(*) AS total
       FROM conversation_sessions
       WHERE ended_at IS NULL AND flow_path = ?`
    ),
    listStartedSessionsInRange: db.prepare(
      `SELECT started_at
       FROM conversation_sessions
       WHERE started_at >= ? AND started_at < ?`
    ),
    listStartedSessionsInRangeByFlowPath: db.prepare(
      `SELECT started_at
       FROM conversation_sessions
       WHERE started_at >= ? AND started_at < ? AND flow_path = ?`
    ),
    listEndedByReasonInRange: db.prepare(
      `SELECT ended_at
       FROM conversation_sessions
       WHERE ended_at >= ? AND ended_at < ? AND end_reason = ?`
    ),
    listEndedByReasonInRangeByFlowPath: db.prepare(
      `SELECT ended_at
       FROM conversation_sessions
       WHERE ended_at >= ? AND ended_at < ? AND end_reason = ? AND flow_path = ?`
    ),
    listBroadcastContacts: db.prepare(
      `SELECT
         ce.jid AS jid,
         MAX(ce.occurred_at) AS last_interaction_at,
         COALESCE(MAX(cp.display_name), '') AS display_name
       FROM conversation_events ce
       LEFT JOIN contact_profiles cp
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
       FROM conversation_events ce
       LEFT JOIN contact_profiles cp
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
       FROM contact_profiles
       WHERE jid = ?
       LIMIT 1`
    ),
    listContactProfiles: db.prepare(
      `SELECT jid, display_name, source, updated_at
       FROM contact_profiles
       ORDER BY updated_at DESC
       LIMIT ?`
    ),
    upsertContactProfile: db.prepare(
      `INSERT INTO contact_profiles (jid, display_name, source, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(jid) DO UPDATE SET
         display_name = excluded.display_name,
         source = excluded.source,
         updated_at = excluded.updated_at`
    ),
    insertBroadcastCampaign: db.prepare(
      `INSERT INTO broadcast_campaigns (
        created_at, actor, target_mode, message_type, message_text, media_mime_type, media_file_name, recipient_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ),
    insertBroadcastRecipient: db.prepare(
      `INSERT OR IGNORE INTO broadcast_recipients (
        campaign_id, jid, send_status, error_message, sent_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ),
    updateBroadcastRecipientResult: db.prepare(
      `UPDATE broadcast_recipients
       SET send_status = ?, error_message = ?, sent_at = ?, updated_at = ?
       WHERE campaign_id = ? AND jid = ?`
    ),
    countSessionsTotal: db.prepare('SELECT COUNT(*) AS total FROM sessions'),
    countSessionsActiveTotal: db.prepare('SELECT COUNT(*) AS total FROM sessions WHERE status = ?'),
    countConversationEventsTotal: db.prepare('SELECT COUNT(*) AS total FROM conversation_events'),
    countConversationSessionsTotal: db.prepare('SELECT COUNT(*) AS total FROM conversation_sessions'),
    countBroadcastCampaignsTotal: db.prepare('SELECT COUNT(*) AS total FROM broadcast_campaigns'),
    countBroadcastRecipientsTotal: db.prepare('SELECT COUNT(*) AS total FROM broadcast_recipients'),
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
       FROM conversation_sessions
       WHERE flow_path = ?`
    ),
  };

  recordDbSizeSnapshot();

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

/**
 * writeToDisk() — mantida como no-op para compatibilidade de assinatura.
 * Com better-sqlite3 + WAL, a persistência é automática e incremental.
 * @deprecated Não é mais necessário chamar manualmente.
 */
export function writeToDisk() {
  // No-op: better-sqlite3 com WAL persiste automaticamente
}

// ─── Auxiliares de Sessão ──────────────────────────────────────────────────────────

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
    setClauses.push('variables = ?');
    params.push(JSON.stringify(patch.variables ?? {}));
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
  const safeMessage = messageText == null ? '' : String(messageText);
  const normalizedMetadata = normalizeMetadata(metadata);
  const event = {
    occurredAt: Number(occurredAt) || Date.now(),
    eventType: String(eventType || 'message'),
    direction: String(direction || 'system'),
    jid: String(jid || 'unknown'),
    flowPath: String(flowPath || ''),
    messageText: safeMessage,
    metadata: normalizedMetadata,
  };
  const metadataJson = JSON.stringify(normalizedMetadata);

  stmts.insertConversationEvent.run(
    event.occurredAt,
    event.eventType,
    event.direction,
    event.jid,
    event.flowPath,
    safeMessage,
    metadataJson
  );

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
  const normalizedLimit = Math.max(1, Math.min(1000, Number(limit) || 200));
  const rows = stmts.listConversationEvents.all(normalizedLimit);
  return rows.map(mapConversationEventRow);
}

export function listConversationEventsByFlowPath(flowPath, limit = 200) {
  const normalizedFlowPath = String(flowPath ?? '').trim();
  if (!normalizedFlowPath) return [];
  const normalizedLimit = Math.max(1, Math.min(1000, Number(limit) || 200));
  const rows = stmts.listConversationEventsByFlowPath.all(normalizedFlowPath, normalizedLimit);
  return rows.map(mapConversationEventRow);
}

export function listConversationEventsByJid(jid, limit = 200) {
  const normalizedJid = String(jid ?? '').trim();
  if (!normalizedJid) return [];
  const normalizedLimit = Math.max(1, Math.min(1000, Number(limit) || 200));
  const rows = stmts.listConversationEventsByJid.all(normalizedJid, normalizedLimit);
  return rows.map(mapConversationEventRow);
}

export function listConversationEventsSince(sinceTimestamp, limit = 500) {
  const normalizedLimit = Math.max(1, Math.min(2000, Number(limit) || 500));
  const since = Number(sinceTimestamp) || 0;
  const rows = stmts.listConversationEventsSince.all(since, normalizedLimit);
  return rows.map(mapConversationEventRow);
}

export function listConversationEventsSinceByFlowPath(flowPath, sinceTimestamp, limit = 500) {
  const normalizedFlowPath = String(flowPath ?? '').trim();
  if (!normalizedFlowPath) return [];
  const normalizedLimit = Math.max(1, Math.min(2000, Number(limit) || 500));
  const since = Number(sinceTimestamp) || 0;
  const rows = stmts.listConversationEventsSinceByFlowPath.all(normalizedFlowPath, since, normalizedLimit);
  return rows.map(mapConversationEventRow);
}

export function listConversationEventsSinceByJid(jid, sinceTimestamp, limit = 500) {
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
    fileSizeOrZero(DB_PATH) +
    fileSizeOrZero(`${DB_PATH}-wal`) +
    fileSizeOrZero(`${DB_PATH}-shm`)
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
  recordDbSizeSnapshot();
  const journalMode = String(db.pragma('journal_mode', { simple: true }) || '').toLowerCase();
  const synchronous = String(db.pragma('synchronous', { simple: true }) || '');
  const fileSizeBytes = fileSizeOrZero(DB_PATH);
  const walSizeBytes = fileSizeOrZero(`${DB_PATH}-wal`);
  const shmSizeBytes = fileSizeOrZero(`${DB_PATH}-shm`);
  return {
    path: DB_PATH,
    journalMode,
    synchronous,
    fileSizeBytes,
    walSizeBytes,
    shmSizeBytes,
    totalStorageBytes: fileSizeBytes + walSizeBytes + shmSizeBytes,
    sizeHistory: listDbSizeDaily(7),
    sessionsTotal: Number(stmts.countSessionsTotal.get()?.total ?? 0) || 0,
    sessionsActive: Number(stmts.countSessionsActiveTotal.get(SESSION_STATUS.ACTIVE)?.total ?? 0) || 0,
    conversationEventsTotal: Number(stmts.countConversationEventsTotal.get()?.total ?? 0) || 0,
    conversationSessionsTotal: Number(stmts.countConversationSessionsTotal.get()?.total ?? 0) || 0,
    broadcastCampaignsTotal: Number(stmts.countBroadcastCampaignsTotal.get()?.total ?? 0) || 0,
    broadcastRecipientsTotal: Number(stmts.countBroadcastRecipientsTotal.get()?.total ?? 0) || 0,
  };
}

export function onConversationEvent(listener) {
  if (typeof listener !== 'function') return () => {};
  conversationEventListeners.add(listener);
  return () => {
    conversationEventListeners.delete(listener);
  };
}
