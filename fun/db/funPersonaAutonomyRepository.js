import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';

const ANALYTICS_SCHEMA = 'analytics';
const DAY_MS = 24 * 60 * 60_000;

function validScope(scopeKey) {
  return String(scopeKey || '').trim().endsWith('@g.us');
}

function parseActionTimestamps(value) {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(Number)
      .filter((timestamp) => Number.isFinite(timestamp) && timestamp > 0)
      .sort((left, right) => left - right);
  } catch {
    return [];
  }
}

function pruneActionTimestamps(timestamps, now) {
  const cutoff = now - DAY_MS;
  return timestamps.filter((timestamp) => timestamp >= cutoff);
}

function mapRow(row, now = Date.now()) {
  if (!row) {
    return {
      lastActionAt: 0,
      actionTimestamps: [],
      consecutiveCount: 0,
      negativeUntil: 0,
      updatedAt: 0,
    };
  }

  return {
    lastActionAt: Number(row.last_action_at) || 0,
    actionTimestamps: pruneActionTimestamps(parseActionTimestamps(row.action_timestamps_json), now),
    consecutiveCount: Math.max(0, Number(row.consecutive_count) || 0),
    negativeUntil: Math.max(0, Number(row.negative_until) || 0),
    updatedAt: Number(row.updated_at) || 0,
  };
}

/** Estado durável dos limites de participação autônoma da persona por grupo. */
export function createFunPersonaAutonomyRepository({ getDatabase = getDb } = {}) {
  const ensureSchema = () => applyFunSchema(getDatabase());

  function getState(scopeKey, { now = Date.now() } = {}) {
    ensureSchema();
    const scope = String(scopeKey || '').trim();
    if (!validScope(scope)) return null;

    const at = Number(now) || Date.now();
    const row = getDatabase().prepare(
      `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_persona_autonomy_state WHERE scope_key = ?`
    ).get(scope);
    return mapRow(row, at);
  }

  function saveState(scopeKey, state, { now = Date.now() } = {}) {
    ensureSchema();
    const scope = String(scopeKey || '').trim();
    if (!validScope(scope)) return { ok: false, reason: 'invalid' };

    const at = Number(now) || Date.now();
    const actionTimestamps = pruneActionTimestamps(
      Array.isArray(state?.actionTimestamps)
        ? state.actionTimestamps.map(Number).filter(Number.isFinite)
        : [],
      at
    );
    const lastActionAt = Math.max(0, Number(state?.lastActionAt) || 0);
    const consecutiveCount = Math.max(0, Math.floor(Number(state?.consecutiveCount) || 0));
    const negativeUntil = Math.max(0, Number(state?.negativeUntil) || 0);

    getDatabase().prepare(
      `INSERT INTO ${ANALYTICS_SCHEMA}.fun_persona_autonomy_state (
        scope_key, last_action_at, action_timestamps_json, consecutive_count,
        negative_until, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope_key) DO UPDATE SET
        last_action_at = excluded.last_action_at,
        action_timestamps_json = excluded.action_timestamps_json,
        consecutive_count = excluded.consecutive_count,
        negative_until = excluded.negative_until,
        updated_at = excluded.updated_at`
    ).run(
      scope,
      lastActionAt,
      JSON.stringify(actionTimestamps),
      consecutiveCount,
      negativeUntil,
      at
    );

    return {
      ok: true,
      state: {
        lastActionAt,
        actionTimestamps,
        consecutiveCount,
        negativeUntil,
        updatedAt: at,
      },
    };
  }

  function recordAction(scopeKey, { now = Date.now() } = {}) {
    const at = Number(now) || Date.now();
    const state = getState(scopeKey, { now: at });
    if (!state) return { ok: false, reason: 'invalid' };

    return saveState(scopeKey, {
      ...state,
      lastActionAt: at,
      actionTimestamps: [...state.actionTimestamps, at],
      consecutiveCount: state.consecutiveCount + 1,
    }, { now: at });
  }

  function observeHumanMessage(scopeKey, {
    hasStopRequest = false,
    negativeSignalBlockMs = 0,
    now = Date.now(),
  } = {}) {
    const at = Number(now) || Date.now();
    const state = getState(scopeKey, { now: at });
    if (!state) return { ok: false, reason: 'invalid' };

    const blockMs = Math.max(0, Number(negativeSignalBlockMs) || 0);
    return saveState(scopeKey, {
      ...state,
      consecutiveCount: 0,
      negativeUntil: hasStopRequest ? at + blockMs : state.negativeUntil,
    }, { now: at });
  }

  return { getState, recordAction, observeHumanMessage, saveState };
}
