import { randomUUID } from 'node:crypto';
import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';

const ANALYTICS_SCHEMA = 'analytics';
const asNumber = (value) => Number(value) || 0;
const asBoolean = (value) => Boolean(Number(value));

function mapHouse(row) {
  if (!row) return null;
  return { scopeKey: String(row.scope_key), userJid: String(row.user_jid), publicId: String(row.public_id || ''), houseType: String(row.house_type), cleanliness: asNumber(row.cleanliness), securityLevel: asNumber(row.security_level), lastCollectDay: String(row.last_collect_day || ''), lastCleanDay: String(row.last_clean_day || ''), createdAt: asNumber(row.created_at), updatedAt: asNumber(row.updated_at) };
}
function mapItem(row) {
  if (!row) return null;
  return { id: String(row.id), scopeKey: String(row.scope_key), ownerJid: String(row.owner_jid), itemId: String(row.item_id), x: asNumber(row.x), y: asNumber(row.y), rotated: asBoolean(row.rotated), placed: asBoolean(row.placed), stolen: asBoolean(row.stolen_flag), acquiredAt: asNumber(row.acquired_at), updatedAt: asNumber(row.updated_at) };
}
function mapVisit(row) {
  if (!row) return null;
  return { id: String(row.id), scopeKey: String(row.scope_key), ownerJid: String(row.owner_jid), visitorJid: String(row.visitor_jid), note: String(row.note || ''), createdAt: asNumber(row.created_at) };
}

export function createFunHouseRepository({ getDatabase = getDb } = {}) {
  const database = () => getDatabase();
  const ensureSchema = () => applyFunSchema(database());
  const strings = (...values) => values.map((value) => String(value || '').trim());

  function getHouse(scopeKey, userJid) {
    ensureSchema();
    const [scope, user] = strings(scopeKey, userJid);
    return mapHouse(database().prepare(`SELECT * FROM ${ANALYTICS_SCHEMA}.fun_houses WHERE scope_key = ? AND user_jid = ?`).get(scope, user));
  }
  function getHouseByPublicId(scopeKey, publicId) {
    ensureSchema();
    const [scope, id] = strings(scopeKey, publicId);
    return mapHouse(database().prepare(`SELECT * FROM ${ANALYTICS_SCHEMA}.fun_houses WHERE scope_key = ? AND public_id = ?`).get(scope, id));
  }
  function ensureHouse({ scopeKey, userJid, houseType = 'casa_padrao', now = Date.now() }) {
    ensureSchema();
    const [scope, user] = strings(scopeKey, userJid);
    const timestamp = asNumber(now) || Date.now();
    database().prepare(`INSERT OR IGNORE INTO ${ANALYTICS_SCHEMA}.fun_houses (scope_key, user_jid, public_id, house_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`).run(scope, user, randomUUID(), String(houseType || 'casa_padrao'), timestamp, timestamp);
    return getHouse(scope, user);
  }
  function updateHouse(scopeKey, userJid, patch = {}, now = Date.now()) {
    ensureHouse({ scopeKey, userJid, now });
    const current = getHouse(scopeKey, userJid);
    const next = { cleanliness: patch.cleanliness ?? current.cleanliness, securityLevel: patch.securityLevel ?? current.securityLevel, lastCollectDay: patch.lastCollectDay ?? current.lastCollectDay, lastCleanDay: patch.lastCleanDay ?? current.lastCleanDay };
    database().prepare(`UPDATE ${ANALYTICS_SCHEMA}.fun_houses SET cleanliness = ?, security_level = ?, last_collect_day = ?, last_clean_day = ?, updated_at = ? WHERE scope_key = ? AND user_jid = ?`).run(Math.max(0, Math.min(100, Math.floor(next.cleanliness))), Math.max(0, Math.floor(next.securityLevel)), String(next.lastCollectDay || ''), String(next.lastCleanDay || ''), asNumber(now) || Date.now(), String(scopeKey), String(userJid));
    return getHouse(scopeKey, userJid);
  }
  function listHouses(scopeKey) { ensureSchema(); return database().prepare(`SELECT * FROM ${ANALYTICS_SCHEMA}.fun_houses WHERE scope_key = ? ORDER BY updated_at DESC`).all(String(scopeKey || '')).map(mapHouse).filter(Boolean); }
  function listItems(scopeKey, ownerJid, { placed = null } = {}) {
    ensureSchema(); const [scope, owner] = strings(scopeKey, ownerJid);
    const rows = placed === null ? database().prepare(`SELECT * FROM ${ANALYTICS_SCHEMA}.fun_house_items WHERE scope_key = ? AND owner_jid = ? ORDER BY acquired_at ASC`).all(scope, owner) : database().prepare(`SELECT * FROM ${ANALYTICS_SCHEMA}.fun_house_items WHERE scope_key = ? AND owner_jid = ? AND placed = ? ORDER BY acquired_at ASC`).all(scope, owner, placed ? 1 : 0);
    return rows.map(mapItem).filter(Boolean);
  }
  function getItem(id) { ensureSchema(); return mapItem(database().prepare(`SELECT * FROM ${ANALYTICS_SCHEMA}.fun_house_items WHERE id = ?`).get(String(id || ''))); }
  function insertItem({ id = randomUUID(), scopeKey, ownerJid, itemId, x = 0, y = 0, rotated = false, placed = true, stolen = false, now = Date.now() }) { ensureSchema(); const timestamp = asNumber(now) || Date.now(); database().prepare(`INSERT INTO ${ANALYTICS_SCHEMA}.fun_house_items (id, scope_key, owner_jid, item_id, x, y, rotated, placed, stolen_flag, acquired_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(String(id), String(scopeKey), String(ownerJid), String(itemId), Math.floor(x), Math.floor(y), rotated ? 1 : 0, placed ? 1 : 0, stolen ? 1 : 0, timestamp, timestamp); return getItem(id); }
  function updateItem(id, patch = {}, now = Date.now()) { const current = getItem(id); if (!current) return null; database().prepare(`UPDATE ${ANALYTICS_SCHEMA}.fun_house_items SET owner_jid = ?, x = ?, y = ?, rotated = ?, placed = ?, stolen_flag = ?, updated_at = ? WHERE id = ?`).run(String(patch.ownerJid ?? current.ownerJid), Math.floor(patch.x ?? current.x), Math.floor(patch.y ?? current.y), (patch.rotated ?? current.rotated) ? 1 : 0, (patch.placed ?? current.placed) ? 1 : 0, (patch.stolen ?? current.stolen) ? 1 : 0, asNumber(now) || Date.now(), String(id)); return getItem(id); }
  function deleteItem(id) { ensureSchema(); return database().prepare(`DELETE FROM ${ANALYTICS_SCHEMA}.fun_house_items WHERE id = ?`).run(String(id || '')).changes > 0; }
  function addVisit({ scopeKey, ownerJid, visitorJid, note = '', now = Date.now() }) { ensureSchema(); const id = randomUUID(); const timestamp = asNumber(now) || Date.now(); database().prepare(`INSERT INTO ${ANALYTICS_SCHEMA}.fun_house_visits (id, scope_key, owner_jid, visitor_jid, note, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(id, String(scopeKey), String(ownerJid), String(visitorJid), String(note || ''), timestamp); return { id, scopeKey: String(scopeKey), ownerJid: String(ownerJid), visitorJid: String(visitorJid), note: String(note || ''), createdAt: timestamp }; }
  function listVisits(scopeKey, ownerJid, limit = 30) { ensureSchema(); return database().prepare(`SELECT * FROM ${ANALYTICS_SCHEMA}.fun_house_visits WHERE scope_key = ? AND owner_jid = ? ORDER BY created_at DESC LIMIT ?`).all(String(scopeKey), String(ownerJid), Math.max(1, Math.floor(limit) || 30)).map(mapVisit); }
  function countVisitsSince(scopeKey, visitorJid, since) { ensureSchema(); return asNumber(database().prepare(`SELECT COUNT(*) AS n FROM ${ANALYTICS_SCHEMA}.fun_house_visits WHERE scope_key = ? AND visitor_jid = ? AND created_at >= ?`).get(String(scopeKey), String(visitorJid), asNumber(since))?.n); }
  function listGiftsReceived(scopeKey, recipientJid, limit = 10) { ensureSchema(); return database().prepare(`SELECT id, item_instance_id, coins, created_at FROM ${ANALYTICS_SCHEMA}.fun_house_gifts WHERE scope_key = ? AND recipient_jid = ? ORDER BY created_at DESC LIMIT ?`).all(String(scopeKey), String(recipientJid), Math.max(1, Math.floor(limit) || 10)).map((row) => ({ id: String(row.id), itemInstanceId: String(row.item_instance_id || ''), coins: asNumber(row.coins), createdAt: asNumber(row.created_at) })); }
  function addGift({ scopeKey, giverJid, recipientJid, itemInstanceId = '', coins = 0, now = Date.now() }) { ensureSchema(); const id = randomUUID(); const amount = Math.max(0, Math.floor(coins)); const timestamp = asNumber(now) || Date.now(); database().prepare(`INSERT INTO ${ANALYTICS_SCHEMA}.fun_house_gifts (id, scope_key, giver_jid, recipient_jid, item_instance_id, coins, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, String(scopeKey), String(giverJid), String(recipientJid), String(itemInstanceId || ''), amount, timestamp); return { id, scopeKey, giverJid, recipientJid, itemInstanceId, coins: amount, createdAt: timestamp }; }
  function countGiftsSince(scopeKey, giverJid, since) { ensureSchema(); return asNumber(database().prepare(`SELECT COUNT(*) AS n FROM ${ANALYTICS_SCHEMA}.fun_house_gifts WHERE scope_key = ? AND giver_jid = ? AND created_at >= ?`).get(String(scopeKey), String(giverJid), asNumber(since))?.n); }
  function addToken({ scopeKey, userJid, tokenHash, salt, now = Date.now() }) { ensureSchema(); const id = randomUUID(); const timestamp = asNumber(now) || Date.now(); database().prepare(`INSERT INTO ${ANALYTICS_SCHEMA}.fun_house_tokens (id, scope_key, user_jid, token_hash, salt, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(id, String(scopeKey), String(userJid), String(tokenHash), String(salt), timestamp); return { id, scopeKey, userJid, tokenHash, salt, createdAt: timestamp }; }
  function listActiveTokens() { ensureSchema(); return database().prepare(`SELECT * FROM ${ANALYTICS_SCHEMA}.fun_house_tokens WHERE revoked_at = 0 ORDER BY created_at DESC`).all().map((row) => ({ id: String(row.id), scopeKey: String(row.scope_key), userJid: String(row.user_jid), tokenHash: String(row.token_hash), salt: String(row.salt), createdAt: asNumber(row.created_at) })); }
  function revokeTokens(scopeKey, userJid, now = Date.now()) { ensureSchema(); return database().prepare(`UPDATE ${ANALYTICS_SCHEMA}.fun_house_tokens SET revoked_at = ? WHERE scope_key = ? AND user_jid = ? AND revoked_at = 0`).run(asNumber(now) || Date.now(), String(scopeKey), String(userJid)).changes; }
  function addRobbery({ scopeKey, robberJid, ownerJid, itemInstanceId = '', result, now = Date.now() }) { ensureSchema(); const id = randomUUID(); database().prepare(`INSERT INTO ${ANALYTICS_SCHEMA}.fun_house_robberies (id, scope_key, robber_jid, owner_jid, item_instance_id, result, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, String(scopeKey), String(robberJid), String(ownerJid), String(itemInstanceId || ''), String(result), asNumber(now) || Date.now()); return id; }
  function lastRobbery(scopeKey, robberJid) { ensureSchema(); const row = database().prepare(`SELECT created_at FROM ${ANALYTICS_SCHEMA}.fun_house_robberies WHERE scope_key = ? AND robber_jid = ? ORDER BY created_at DESC LIMIT 1`).get(String(scopeKey), String(robberJid)); return asNumber(row?.created_at); }
  function countRobberiesSince(scopeKey, robberJid, since) { ensureSchema(); return asNumber(database().prepare(`SELECT COUNT(*) AS n FROM ${ANALYTICS_SCHEMA}.fun_house_robberies WHERE scope_key = ? AND robber_jid = ? AND created_at >= ?`).get(String(scopeKey), String(robberJid), asNumber(since))?.n); }
  return { ensureSchema, getHouse, getHouseByPublicId, ensureHouse, updateHouse, listHouses, listItems, getItem, insertItem, updateItem, deleteItem, addVisit, listVisits, countVisitsSince, listGiftsReceived, addGift, countGiftsSince, addToken, listActiveTokens, revokeTokens, addRobbery, lastRobbery, countRobberiesSince };
}
