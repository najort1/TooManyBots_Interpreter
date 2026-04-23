import { getStmts } from './context.js';

function normalizeJid(jid = '') {
  return String(jid ?? '').trim();
}

function normalizeFlowPath(flowPath = '') {
  return String(flowPath ?? '').trim();
}

function normalizeVariableName(variableName = '') {
  return String(variableName ?? '').trim();
}

/**
 * Upserts one persisted variable.
 *
 * @param {{
 *   jid: string,
 *   flowPath?: string,
 *   variableName: string,
 *   variableValue: unknown,
 *   persistedAt?: number,
 *   expiresAt?: number | null,
 * }} payload
 * @returns {boolean}
 */
export function upsertPersistedContextVariable(payload) {
  const stmts = getStmts();
  const jid = normalizeJid(payload?.jid);
  const flowPath = normalizeFlowPath(payload?.flowPath);
  const variableName = normalizeVariableName(payload?.variableName);
  if (!jid || !variableName) return false;

  const persistedAt = Number(payload?.persistedAt) || Date.now();
  const expiresAtRaw = payload?.expiresAt;
  const expiresAt = Number.isFinite(Number(expiresAtRaw)) ? Number(expiresAtRaw) : null;

  stmts.upsertPersistedContextVariable.run(
    jid,
    flowPath,
    variableName,
    JSON.stringify(payload?.variableValue ?? null),
    persistedAt,
    expiresAt
  );
  return true;
}

/**
 * Deletes one persisted variable entry.
 *
 * @param {{
 *   jid: string,
 *   flowPath?: string,
 *   variableName: string,
 * }} payload
 * @returns {number}
 */
export function deletePersistedContextVariable(payload) {
  const stmts = getStmts();
  const jid = normalizeJid(payload?.jid);
  const flowPath = normalizeFlowPath(payload?.flowPath);
  const variableName = normalizeVariableName(payload?.variableName);
  if (!jid || !variableName) return 0;
  const result = stmts.deletePersistedContextVariable.run(jid, flowPath, variableName);
  return Number(result?.changes) || 0;
}

/**
 * Deletes all persisted variables for a JID + flowPath scope.
 *
 * @param {{
 *   jid: string,
 *   flowPath?: string,
 * }} payload
 * @returns {number}
 */
export function deletePersistedContextVariablesByScope(payload) {
  const stmts = getStmts();
  const jid = normalizeJid(payload?.jid);
  const flowPath = normalizeFlowPath(payload?.flowPath);
  if (!jid) return 0;
  const result = stmts.deletePersistedContextVariablesByScope.run(jid, flowPath);
  return Number(result?.changes) || 0;
}

/**
 * Reads persisted variables, excluding expired rows.
 *
 * @param {{
 *   jid: string,
 *   flowPath?: string,
 *   variableNames?: string[],
 *   nowTs?: number,
 * }} payload
 * @returns {Record<string, unknown>}
 */
export function loadPersistedContextVariables(payload) {
  const stmts = getStmts();
  const jid = normalizeJid(payload?.jid);
  const flowPath = normalizeFlowPath(payload?.flowPath);
  if (!jid) return {};

  const nowTs = Number(payload?.nowTs) || Date.now();
  const variableNames = Array.isArray(payload?.variableNames)
    ? payload.variableNames.map(normalizeVariableName).filter(Boolean)
    : [];

  const rows = variableNames.length > 0
    ? stmts.listPersistedContextVariablesByNames.all(jid, flowPath, nowTs, JSON.stringify(variableNames))
    : stmts.listPersistedContextVariables.all(jid, flowPath, nowTs);

  /** @type {Record<string, unknown>} */
  const result = {};
  for (const row of rows) {
    const variableName = normalizeVariableName(row?.variable_name);
    if (!variableName) continue;
    try {
      result[variableName] = JSON.parse(String(row?.variable_value ?? 'null'));
    } catch {
      result[variableName] = null;
    }
  }

  return result;
}

/**
 * Removes expired persisted-variable rows.
 *
 * @param {number} [nowTs=Date.now()]
 * @returns {number}
 */
export function deleteExpiredPersistedContextVariables(nowTs = Date.now()) {
  const stmts = getStmts();
  const cutoff = Number(nowTs) || Date.now();
  const result = stmts.deleteExpiredPersistedContextVariables.run(cutoff);
  return Number(result?.changes) || 0;
}
