import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';

const ANALYTICS_SCHEMA = 'analytics';
const defaults = () => ({ hair_face: 'base_face', outfit: 'camiseta_beco', optional_accessory: 'sem_acessorio' });
function parseObject(value, fallback) { try { const parsed = JSON.parse(String(value || '')); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback; } catch { return fallback; } }
function parseArray(value) { try { const parsed = JSON.parse(String(value || '[]')); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; } }
function mapState(row) { if (!row) return null; return { scopeKey: String(row.scope_key), userJid: String(row.user_jid), slots: { ...defaults(), ...parseObject(row.slots_json, {}) }, unlocked: parseArray(row.unlocked_json), updatedAt: Number(row.updated_at) || 0 }; }

export function createFunAvatarRepository({ getDatabase = getDb } = {}) {
  const database = () => getDatabase();
  const ensureSchema = () => applyFunSchema(database());
  function get(scopeKey, userJid) { ensureSchema(); return mapState(database().prepare(`SELECT * FROM ${ANALYTICS_SCHEMA}.fun_avatar_state WHERE scope_key = ? AND user_jid = ?`).get(String(scopeKey || ''), String(userJid || ''))); }
  function ensure(scopeKey, userJid, now = Date.now()) { ensureSchema(); const timestamp = Number(now) || Date.now(); database().prepare(`INSERT OR IGNORE INTO ${ANALYTICS_SCHEMA}.fun_avatar_state (scope_key, user_jid, slots_json, unlocked_json, updated_at) VALUES (?, ?, ?, '[]', ?)`).run(String(scopeKey || ''), String(userJid || ''), JSON.stringify(defaults()), timestamp); return get(scopeKey, userJid); }
  function save(scopeKey, userJid, { slots, unlocked }, now = Date.now()) { ensure(scopeKey, userJid, now); database().prepare(`UPDATE ${ANALYTICS_SCHEMA}.fun_avatar_state SET slots_json = ?, unlocked_json = ?, updated_at = ? WHERE scope_key = ? AND user_jid = ?`).run(JSON.stringify({ ...defaults(), ...(slots || {}) }), JSON.stringify([...new Set((unlocked || []).map(String))]), Number(now) || Date.now(), String(scopeKey || ''), String(userJid || '')); return get(scopeKey, userJid); }
  return { ensureSchema, get, ensure, save };
}
