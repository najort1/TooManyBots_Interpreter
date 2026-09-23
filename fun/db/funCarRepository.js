import { createHash, randomUUID } from 'node:crypto';
import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';

const ANALYTICS_SCHEMA = 'analytics';

export const DEFAULT_CAR_STATE = Object.freeze({
  color: '#e63946',
  secondaryColor: '#1d3557',
  wheels: 'sport',
  spoiler: 'none',
  suspension: 'normal',
  neon: 'none',
  decal: 'none',
  windowTint: 'light',
  plateText: '',
  customizations: {},
  revision: 1,
});

function parseJson(value, fallback) {
  try {
    return JSON.parse(String(value || '')) ?? fallback;
  } catch {
    return fallback;
  }
}

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function hashCarOperation(payload) {
  return createHash('sha256')
    .update(JSON.stringify(payload ?? {}))
    .digest('hex');
}

function mapCarState(row) {
  if (!row) return null;
  return {
    scopeKey: String(row.scope_key),
    userJid: String(row.user_jid),
    color: String(row.color || DEFAULT_CAR_STATE.color),
    secondaryColor: String(row.secondary_color || DEFAULT_CAR_STATE.secondaryColor),
    wheels: String(row.wheels || DEFAULT_CAR_STATE.wheels),
    spoiler: String(row.spoiler || DEFAULT_CAR_STATE.spoiler),
    suspension: String(row.suspension || DEFAULT_CAR_STATE.suspension),
    neon: String(row.neon || DEFAULT_CAR_STATE.neon),
    decal: String(row.decal || DEFAULT_CAR_STATE.decal),
    windowTint: String(row.window_tint || DEFAULT_CAR_STATE.windowTint),
    plateText: String(row.plate_text || ''),
    customizations: parseJson(row.customizations_json, {}),
    revision: asNumber(row.revision, 1),
    updatedAt: asNumber(row.updated_at, 0),
  };
}

export function createFunCarRepository({ getDatabase = getDb } = {}) {
  const database = () => getDatabase();
  const ensureSchema = () => applyFunSchema(database());

  function get(scopeKey, userJid) {
    ensureSchema();
    const row = database()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_car_state
         WHERE scope_key = ? AND user_jid = ?`
      )
      .get(String(scopeKey || ''), String(userJid || ''));
    return mapCarState(row);
  }

  function ensure(scopeKey, userJid, now = Date.now()) {
    ensureSchema();
    const existing = get(scopeKey, userJid);
    if (existing) return existing;

    const ts = asNumber(now) || Date.now();
    database()
      .prepare(
        `INSERT OR IGNORE INTO ${ANALYTICS_SCHEMA}.fun_car_state (
           scope_key, user_jid, color, secondary_color, wheels, spoiler,
           suspension, neon, decal, window_tint, plate_text,
           customizations_json, revision, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        String(scopeKey || ''),
        String(userJid || ''),
        DEFAULT_CAR_STATE.color,
        DEFAULT_CAR_STATE.secondaryColor,
        DEFAULT_CAR_STATE.wheels,
        DEFAULT_CAR_STATE.spoiler,
        DEFAULT_CAR_STATE.suspension,
        DEFAULT_CAR_STATE.neon,
        DEFAULT_CAR_STATE.decal,
        DEFAULT_CAR_STATE.windowTint,
        DEFAULT_CAR_STATE.plateText,
        JSON.stringify(DEFAULT_CAR_STATE.customizations),
        1,
        ts
      );
    return get(scopeKey, userJid);
  }

  function save(scopeKey, userJid, state, now = Date.now()) {
    ensureSchema();
    const ts = asNumber(now) || Date.now();
    const nextRevision = asNumber(state.revision, 1) + 1;
    const customJson = JSON.stringify(state.customizations || {});

    database()
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_car_state (
           scope_key, user_jid, color, secondary_color, wheels, spoiler,
           suspension, neon, decal, window_tint, plate_text,
           customizations_json, revision, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(scope_key, user_jid) DO UPDATE SET
           color = excluded.color,
           secondary_color = excluded.secondary_color,
           wheels = excluded.wheels,
           spoiler = excluded.spoiler,
           suspension = excluded.suspension,
           neon = excluded.neon,
           decal = excluded.decal,
           window_tint = excluded.window_tint,
           plate_text = excluded.plate_text,
           customizations_json = excluded.customizations_json,
           revision = excluded.revision,
           updated_at = excluded.updated_at`
      )
      .run(
        String(scopeKey || ''),
        String(userJid || ''),
        String(state.color || DEFAULT_CAR_STATE.color),
        String(state.secondaryColor || DEFAULT_CAR_STATE.secondaryColor),
        String(state.wheels || DEFAULT_CAR_STATE.wheels),
        String(state.spoiler || DEFAULT_CAR_STATE.spoiler),
        String(state.suspension || DEFAULT_CAR_STATE.suspension),
        String(state.neon || DEFAULT_CAR_STATE.neon),
        String(state.decal || DEFAULT_CAR_STATE.decal),
        String(state.windowTint || DEFAULT_CAR_STATE.windowTint),
        String(state.plateText || ''),
        customJson,
        nextRevision,
        ts
      );
    return get(scopeKey, userJid);
  }

  function addToken({ scopeKey, userJid, tokenHash, salt, now = Date.now() }) {
    ensureSchema();
    const id = randomUUID();
    const ts = asNumber(now) || Date.now();
    database()
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_car_tokens (
           id, scope_key, user_jid, token_hash, salt, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, String(scopeKey), String(userJid), String(tokenHash), String(salt), ts);
    return { id, scopeKey: String(scopeKey), userJid: String(userJid), tokenHash, salt, createdAt: ts };
  }

  function listActiveTokens() {
    ensureSchema();
    return database()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_car_tokens
         WHERE revoked_at = 0
         ORDER BY created_at DESC`
      )
      .all()
      .map((row) => ({
        id: String(row.id),
        scopeKey: String(row.scope_key),
        userJid: String(row.user_jid),
        tokenHash: String(row.token_hash),
        salt: String(row.salt),
        createdAt: asNumber(row.created_at),
      }));
  }

  function revokeTokens(scopeKey, userJid, now = Date.now()) {
    ensureSchema();
    return database()
      .prepare(
        `UPDATE ${ANALYTICS_SCHEMA}.fun_car_tokens
         SET revoked_at = ?
         WHERE scope_key = ? AND user_jid = ? AND revoked_at = 0`
      )
      .run(asNumber(now) || Date.now(), String(scopeKey), String(userJid)).changes;
  }

  function operation(scopeKey, userJid, idempotencyKey) {
    ensureSchema();
    const row = database()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_car_operations
         WHERE scope_key = ? AND user_jid = ? AND idempotency_key = ?`
      )
      .get(String(scopeKey || ''), String(userJid || ''), String(idempotencyKey || ''));
    if (!row) return null;
    return {
      scopeKey: String(row.scope_key),
      userJid: String(row.user_jid),
      idempotencyKey: String(row.idempotency_key),
      payloadHash: String(row.payload_hash),
      result: parseJson(row.result_json, {}),
      createdAt: asNumber(row.created_at),
    };
  }

  function saveOperation(scopeKey, userJid, idempotencyKey, payloadHash, result, now = Date.now()) {
    ensureSchema();
    const ts = asNumber(now) || Date.now();
    database()
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_car_operations (
           scope_key, user_jid, idempotency_key, payload_hash, result_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(scope_key, user_jid, idempotency_key) DO UPDATE SET
           payload_hash = excluded.payload_hash,
           result_json = excluded.result_json`
      )
      .run(
        String(scopeKey || ''),
        String(userJid || ''),
        String(idempotencyKey || ''),
        String(payloadHash || ''),
        JSON.stringify(result || {}),
        ts
      );
  }

  return {
    ensureSchema,
    get,
    ensure,
    save,
    addToken,
    listActiveTokens,
    revokeTokens,
    operation,
    saveOperation,
  };
}
