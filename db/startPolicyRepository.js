import { getStmts } from './context.js';

function normalizeJid(jid = '') {
  return String(jid ?? '').trim();
}

function normalizeFlowPath(flowPath = '') {
  return String(flowPath ?? '').trim();
}

/**
 * Registers a new flow start event for rate limiting.
 *
 * @param {{
 *   jid: string,
 *   flowPath?: string,
 *   startedAt?: number,
 * }} payload
 * @returns {number}
 */
export function recordStartPolicyEvent(payload) {
  const stmts = getStmts();
  const jid = normalizeJid(payload?.jid);
  if (!jid) return 0;

  const flowPath = normalizeFlowPath(payload?.flowPath);
  const startedAt = Number(payload?.startedAt) || Date.now();
  const result = stmts.insertStartPolicyEvent.run(jid, flowPath, startedAt);
  return Number(result?.lastInsertRowid) || 0;
}

/**
 * Counts start events within a [fromTs, toTs) window.
 *
 * @param {{
 *   jid: string,
 *   flowPath?: string,
 *   fromTs: number,
 *   toTs?: number,
 * }} payload
 * @returns {number}
 */
export function countStartPolicyEventsInWindow(payload) {
  const stmts = getStmts();
  const jid = normalizeJid(payload?.jid);
  if (!jid) return 0;

  const flowPath = normalizeFlowPath(payload?.flowPath);
  const fromTs = Number(payload?.fromTs) || 0;
  const toTs = Number(payload?.toTs) || Date.now();
  const row = stmts.countStartPolicyEventsInRange.get(jid, flowPath, fromTs, toTs);
  return Number(row?.total) || 0;
}

/**
 * Deletes stale start-policy rows before a timestamp.
 *
 * @param {number} beforeTs
 * @returns {number}
 */
export function pruneStartPolicyEventsBefore(beforeTs) {
  const stmts = getStmts();
  const ts = Number(beforeTs) || 0;
  if (ts <= 0) return 0;
  const result = stmts.deleteStartPolicyEventsBefore.run(ts);
  return Number(result?.changes) || 0;
}
