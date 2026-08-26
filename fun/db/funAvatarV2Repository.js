import { createHash } from 'node:crypto';
import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';
import {
  AVATAR_CATALOG_REVISION,
  AVATAR_SCHEMA_VERSION,
  normalizeAvatarSlots,
} from '../../shared/avatar/domain.js';

const SCHEMA = 'analytics';

function parse(value, fallback) {
  try {
    return JSON.parse(String(value || ''));
  } catch {
    return fallback;
  }
}

function mapState(row) {
  if (!row) return null;
  return {
    scopeKey: String(row.scope_key),
    userJid: String(row.user_jid),
    schemaVersion: Number(row.schema_version) || AVATAR_SCHEMA_VERSION,
    revision: Number(row.revision) || 1,
    catalogRevision: Number(row.catalog_revision) || AVATAR_CATALOG_REVISION,
    slots: normalizeAvatarSlots(parse(row.slots_json, {})),
    unlocked: unique(parse(row.unlocked_json, [])),
    diagnostics: Array.isArray(parse(row.diagnostics_json, [])) ? parse(row.diagnostics_json, []) : [],
    migratedAt: Number(row.migrated_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
  };
}

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean))];
}

export function createFunAvatarV2Repository({ getDatabase = getDb } = {}) {
  const database = () => getDatabase();
  const ensureSchema = () => applyFunSchema(database());

  function get(scopeKey, userJid) {
    ensureSchema();
    return mapState(database().prepare(`
      SELECT * FROM ${SCHEMA}.fun_avatar_state_v2
      WHERE scope_key = ? AND user_jid = ?
    `).get(String(scopeKey || ''), String(userJid || '')));
  }

  function create(scopeKey, userJid, state, now = Date.now()) {
    ensureSchema();
    const timestamp = Number(now) || Date.now();
    database().prepare(`
      INSERT OR IGNORE INTO ${SCHEMA}.fun_avatar_state_v2 (
        scope_key, user_jid, schema_version, revision, catalog_revision,
        slots_json, unlocked_json, diagnostics_json, migrated_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      String(scopeKey || ''), String(userJid || ''), AVATAR_SCHEMA_VERSION,
      Number(state.revision) || 1, Number(state.catalogRevision) || AVATAR_CATALOG_REVISION,
      JSON.stringify(normalizeAvatarSlots(state.slots)), JSON.stringify(unique(state.unlocked)),
      JSON.stringify(state.diagnostics || []), timestamp, timestamp,
    );
    return get(scopeKey, userJid);
  }

  function save(scopeKey, userJid, state, now = Date.now()) {
    ensureSchema();
    const timestamp = Number(now) || Date.now();
    database().prepare(`
      UPDATE ${SCHEMA}.fun_avatar_state_v2 SET
        schema_version = ?, revision = ?, catalog_revision = ?, slots_json = ?,
        unlocked_json = ?, diagnostics_json = ?, updated_at = ?
      WHERE scope_key = ? AND user_jid = ?
    `).run(
      AVATAR_SCHEMA_VERSION, Number(state.revision) || 1,
      Number(state.catalogRevision) || AVATAR_CATALOG_REVISION,
      JSON.stringify(normalizeAvatarSlots(state.slots)), JSON.stringify(unique(state.unlocked)),
      JSON.stringify(state.diagnostics || []), timestamp,
      String(scopeKey || ''), String(userJid || ''),
    );
    return get(scopeKey, userJid);
  }

  function operation(scopeKey, userJid, key) {
    if (!String(key || '').trim()) return null;
    ensureSchema();
    const row = database().prepare(`
      SELECT payload_hash, result_json FROM ${SCHEMA}.fun_avatar_operations
      WHERE scope_key = ? AND user_jid = ? AND idempotency_key = ?
    `).get(String(scopeKey || ''), String(userJid || ''), String(key));
    return row ? { payloadHash: String(row.payload_hash), result: parse(row.result_json, null) } : null;
  }

  function saveOperation(scopeKey, userJid, key, payloadHash, result, now = Date.now()) {
    database().prepare(`
      INSERT INTO ${SCHEMA}.fun_avatar_operations
      (scope_key, user_jid, idempotency_key, payload_hash, result_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(String(scopeKey || ''), String(userJid || ''), String(key), String(payloadHash), JSON.stringify(result), Number(now) || Date.now());
  }

  return { ensureSchema, get, create, save, operation, saveOperation, database };
}

export function hashAvatarOperation(payload) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
