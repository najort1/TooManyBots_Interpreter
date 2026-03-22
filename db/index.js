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
      jid         TEXT PRIMARY KEY,
      block_index INTEGER NOT NULL DEFAULT 0,
      variables   TEXT    NOT NULL DEFAULT '{}',
      status      TEXT    NOT NULL DEFAULT 'active',
      waiting_for TEXT    DEFAULT NULL,
      updated_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE IF NOT EXISTS auth_state (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Pré-compilar prepared statements para performance máxima
  stmts = {
    getSession: db.prepare(
      'SELECT jid, block_index, variables, status, waiting_for FROM sessions WHERE jid = ?'
    ),
    createSession: db.prepare(
      `INSERT OR REPLACE INTO sessions (jid, block_index, variables, status, waiting_for)
       VALUES (?, 0, '{}', ?, NULL)`
    ),
    updateSession: db.prepare(
      `UPDATE sessions
       SET block_index=?, variables=?, status=?, waiting_for=?,
           updated_at=strftime('%s','now')
       WHERE jid=?`
    ),
    deleteSession: db.prepare('DELETE FROM sessions WHERE jid = ?'),
    getActiveSessions: db.prepare(
      'SELECT jid, block_index, variables, status, waiting_for FROM sessions WHERE status = ?'
    ),
    getAuthState: db.prepare('SELECT value FROM auth_state WHERE key = ?'),
    setAuthState: db.prepare(
      `INSERT INTO auth_state (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ),
    deleteAuthState: db.prepare('DELETE FROM auth_state WHERE key = ?'),
  };

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

export function getSession(jid) {
  const row = stmts.getSession.get(jid);
  if (!row) return null;
  return {
    jid: row.jid,
    blockIndex: row.block_index,
    variables: JSON.parse(row.variables),
    status: row.status,
    waitingFor: row.waiting_for,
  };
}

export function createSession(jid) {
  stmts.createSession.run(jid, SESSION_STATUS.ACTIVE);
  return getSession(jid);
}

export function updateSession(jid, patch) {
  const current = getSession(jid) ?? {
    blockIndex: 0,
    variables: {},
    status: SESSION_STATUS.ACTIVE,
    waitingFor: null,
  };
  const blockIndex = patch.blockIndex ?? current.blockIndex;
  const variables  = JSON.stringify(patch.variables ?? current.variables);
  const status     = patch.status ?? current.status;
  const waitingFor = patch.waitingFor !== undefined ? patch.waitingFor : current.waitingFor;

  stmts.updateSession.run(blockIndex, variables, status, waitingFor, jid);
}

export function deleteSession(jid) {
  stmts.deleteSession.run(jid);
}

export function getActiveSessions() {
  const rows = stmts.getActiveSessions.all(SESSION_STATUS.ACTIVE);
  return rows.map(row => ({
    jid: row.jid,
    blockIndex: row.block_index,
    variables: JSON.parse(row.variables),
    status: row.status,
    waitingFor: row.waiting_for,
  }));
}

