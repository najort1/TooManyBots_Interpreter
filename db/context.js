/**
 * db/context.js
 *
 * Shared accessor for the database handle and compiled prepared statements.
 *
 * This module exists solely to break the circular-import problem that would arise
 * if domain repository modules imported directly from db/index.js (which in turn
 * re-exports from those same repositories).
 *
 * Flow:
 *   1. db/index.js calls setDbContext(db, stmts) at the end of initDb().
 *   2. Repository modules call getDb() / getStmts() inside their functions to
 *      access the initialized instances.
 *   3. External consumers continue to import from db/index.js exclusively.
 */

/** @type {import('better-sqlite3').Database | null} */
let _db = null;

/** @type {Record<string, import('better-sqlite3').Statement>} */
let _stmts = {};

/**
 * Registers the initialized db instance and compiled statements.
 * Must be called exactly once, at the end of initDb().
 *
 * @param {import('better-sqlite3').Database} db     - Open better-sqlite3 database.
 * @param {Record<string, import('better-sqlite3').Statement>} stmts - Pre-compiled statements.
 */
export function setDbContext(db, stmts) {
  _db = db;
  _stmts = stmts;
}

/**
 * Returns the initialized database handle.
 * @returns {import('better-sqlite3').Database}
 */
export function getDb() {
  if (!_db) throw new Error('[db/context] Database not initialized — call initDb() first.');
  return _db;
}

/**
 * Returns the map of pre-compiled prepared statements.
 * @returns {Record<string, import('better-sqlite3').Statement>}
 */
export function getStmts() {
  return _stmts;
}

// ─── Event Buffer Flush Hook ──────────────────────────────────────────────────
//
// Some read operations (e.g. listBroadcastContacts) must flush pending buffered
// events before querying to ensure read-consistency. db/index.js registers the
// flush function here after initDb() so that repository modules can invoke it
// without importing from db/index.js (which would create a circular dependency).

/** @type {() => void} */
let _ensureFlushForRead = () => {};

/**
 * Registers the flush function provided by db/index.js after initialization.
 * @param {() => void} fn
 */
export function registerFlushForRead(fn) {
  if (typeof fn === 'function') _ensureFlushForRead = fn;
}

/**
 * Flushes any pending buffered events to ensure read-consistency.
 * No-op until `registerFlushForRead` is called from db/index.js.
 */
export function ensureFlushForRead() {
  _ensureFlushForRead();
}

