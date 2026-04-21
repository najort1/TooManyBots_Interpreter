/**
 * db/sessionRepository.js
 *
 * Session CRUD operations and session-lifecycle helpers.
 *
 * All functions in this module access the database exclusively through the
 * shared db/context.js accessors — they never hold their own db reference.
 * This allows them to be imported and unit-tested in isolation.
 *
 * Extracted from db/index.js (C1 refactor) — zero logic changes.
 */

import { SESSION_STATUS } from '../config/constants.js';
import { getStmts } from './context.js';
import {
  mapSessionRow,
  normalizeSessionScope,
} from './helpers.js';


// ─── Session Operations ───────────────────────────────────────────────────────


/**
 * Retrieves a session by JID (and optional flow-path scope).
 * Returns the most-recently-updated session if no flow path is specified.
 *
 * @param {string}  jid
 * @param {object|string|null} [scope]
 * @returns {object|null}
 */
export function getSession(jid, scope = null) {
  const stmts = getStmts();
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

/**
 * Creates a new active session for the given JID and scope.
 *
 * @param {string}  jid
 * @param {object|string|null} [scope]
 * @returns {object|null} The newly created session row.
 */
export function createSession(jid, scope = null) {
  const stmts = getStmts();
  const normalizedJid = String(jid ?? '').trim();
  if (!normalizedJid) return null;

  const { flowPath, botType } = normalizeSessionScope(scope);
  const resolvedBotType = botType ?? 'conversation';
  stmts.createSession.run(normalizedJid, flowPath, resolvedBotType, SESSION_STATUS.ACTIVE);
  return getSession(normalizedJid, { flowPath });
}


/**
 * Deletes a session by JID and scope.
 *
 * @param {string}  jid
 * @param {object|string|null} [scope]
 */
export function deleteSession(jid, scope = null) {
  const stmts = getStmts();
  const normalizedJid = String(jid ?? '').trim();
  if (!normalizedJid) return;
  const { flowPath } = normalizeSessionScope(scope);
  stmts.deleteSession.run(normalizedJid, flowPath);
}

/**
 * Returns all active sessions matching the given scope filter.
 *
 * @param {object|string|null} [scope]
 * @returns {object[]}
 */
export function getActiveSessions(scope = null) {
  const stmts = getStmts();
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

/**
 * Cursor-based paginated query for active sessions.
 *
 * @param {object|string|null} [scope]
 * @param {{ cursorUpdatedAt?: number, cursorJid?: string, limit?: number }} [opts]
 * @returns {object[]}
 */
export function getActiveSessionsPage(scope = null, {
  cursorUpdatedAt = Number.MAX_SAFE_INTEGER,
  cursorJid = '\uffff',
  limit = 200,
} = {}) {
  const stmts = getStmts();
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

/**
 * Deletes all active sessions and returns the deleted rows.
 * @returns {object[]} The sessions that were active before deletion.
 */
export function clearActiveSessions() {
  const stmts = getStmts();
  const active = getActiveSessions();
  stmts.deleteActiveSessions.run(SESSION_STATUS.ACTIVE);
  return active;
}

/**
 * Deletes all active sessions belonging to the given flow path.
 *
 * @param {string} flowPath
 * @returns {object[]} The sessions that were active before deletion.
 */
export function clearActiveSessionsByFlowPath(flowPath) {
  const stmts = getStmts();
  const normalizedFlowPath = String(flowPath ?? '').trim();
  if (!normalizedFlowPath) return [];
  const active = getActiveSessions({ flowPath: normalizedFlowPath });
  stmts.deleteActiveSessionsByFlowPath.run(SESSION_STATUS.ACTIVE, normalizedFlowPath);
  return active;
}
