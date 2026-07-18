import { randomUUID } from 'node:crypto';
import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';

const ANALYTICS_SCHEMA = 'analytics';

function mapRow(row) {
  if (!row) return null;
  return {
    id: String(row.id || ''),
    scopeKey: String(row.scope_key || ''),
    userJid: String(row.user_jid || ''),
    propertyType: String(row.property_type || ''),
    health: Number(row.health) || 0,
    bufferCoins: Number(row.buffer_coins) || 0,
    lastTickAt: Number(row.last_tick_at) || 0,
    createdAt: Number(row.created_at) || 0,
  };
}

export function createFunPropertyRepository({ getDatabase = getDb } = {}) {
  function ensureSchema() {
    applyFunSchema(getDatabase());
  }

  function listByUser(scopeKey, userJid) {
    ensureSchema();
    const rows = getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_properties
         WHERE scope_key = ? AND user_jid = ?
         ORDER BY created_at ASC`
      )
      .all(String(scopeKey || ''), String(userJid || ''));
    return rows.map(mapRow).filter(Boolean);
  }

  function listByScope(scopeKey) {
    ensureSchema();
    const rows = getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_properties
         WHERE scope_key = ?
         ORDER BY created_at ASC`
      )
      .all(String(scopeKey || ''));
    return rows.map(mapRow).filter(Boolean);
  }

  function getByUserType(scopeKey, userJid, propertyType) {
    ensureSchema();
    const row = getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_properties
         WHERE scope_key = ? AND user_jid = ? AND property_type = ?`
      )
      .get(String(scopeKey || ''), String(userJid || ''), String(propertyType || ''));
    return mapRow(row);
  }

  function getById(id) {
    ensureSchema();
    const row = getDatabase()
      .prepare(`SELECT * FROM ${ANALYTICS_SCHEMA}.fun_properties WHERE id = ?`)
      .get(String(id || ''));
    return mapRow(row);
  }

  function countByUser(scopeKey, userJid) {
    ensureSchema();
    const row = getDatabase()
      .prepare(
        `SELECT COUNT(*) AS n FROM ${ANALYTICS_SCHEMA}.fun_properties
         WHERE scope_key = ? AND user_jid = ?`
      )
      .get(String(scopeKey || ''), String(userJid || ''));
    return Number(row?.n) || 0;
  }

  function insert({
    scopeKey,
    userJid,
    propertyType,
    health = 100,
    bufferCoins = 0,
    lastTickAt = 0,
    now = Date.now(),
  }) {
    ensureSchema();
    const id = randomUUID();
    const ts = Number(now) || Date.now();
    getDatabase()
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_properties
         (id, scope_key, user_jid, property_type, health, buffer_coins, last_tick_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        String(scopeKey || ''),
        String(userJid || ''),
        String(propertyType || ''),
        Number(health) || 100,
        Math.max(0, Math.floor(Number(bufferCoins) || 0)),
        Number(lastTickAt) || 0,
        ts
      );
    return getById(id);
  }

  function setBuffer(id, bufferCoins, lastTickAt = null) {
    ensureSchema();
    const buf = Math.max(0, Math.floor(Number(bufferCoins) || 0));
    if (lastTickAt != null) {
      getDatabase()
        .prepare(
          `UPDATE ${ANALYTICS_SCHEMA}.fun_properties
           SET buffer_coins = ?, last_tick_at = ? WHERE id = ?`
        )
        .run(buf, Number(lastTickAt) || 0, String(id || ''));
    } else {
      getDatabase()
        .prepare(
          `UPDATE ${ANALYTICS_SCHEMA}.fun_properties SET buffer_coins = ? WHERE id = ?`
        )
        .run(buf, String(id || ''));
    }
    return getById(id);
  }

  function setHealth(id, health) {
    ensureSchema();
    const h = Math.min(100, Math.max(0, Number(health) || 0));
    getDatabase()
      .prepare(`UPDATE ${ANALYTICS_SCHEMA}.fun_properties SET health = ? WHERE id = ?`)
      .run(h, String(id || ''));
    return getById(id);
  }

  function applyDamage(id, damage) {
    ensureSchema();
    const cur = getById(id);
    if (!cur) return null;
    const next = Math.max(0, cur.health - Math.max(0, Number(damage) || 0));
    return setHealth(id, next);
  }

  /**
   * Remove coins do buffer; retorna quantos saíram.
   */
  function takeFromBuffer(id, amount) {
    ensureSchema();
    const db = getDatabase();
    return db.transaction(() => {
      const cur = getById(id);
      if (!cur) return { ok: false, taken: 0 };
      const want = Math.max(0, Math.floor(Number(amount) || 0));
      const taken = Math.min(cur.bufferCoins, want);
      if (taken <= 0) return { ok: true, taken: 0, buffer: cur.bufferCoins };
      db.prepare(
        `UPDATE ${ANALYTICS_SCHEMA}.fun_properties SET buffer_coins = buffer_coins - ? WHERE id = ?`
      ).run(taken, id);
      return { ok: true, taken, buffer: cur.bufferCoins - taken };
    })();
  }

  function collectAllBuffers(scopeKey, userJid) {
    ensureSchema();
    const db = getDatabase();
    const s = String(scopeKey || '');
    const u = String(userJid || '');
    return db.transaction(() => {
      const rows = listByUser(s, u);
      let total = 0;
      const details = [];
      for (const row of rows) {
        if (row.bufferCoins <= 0) continue;
        total += row.bufferCoins;
        details.push({
          id: row.id,
          propertyType: row.propertyType,
          amount: row.bufferCoins,
        });
        db.prepare(
          `UPDATE ${ANALYTICS_SCHEMA}.fun_properties SET buffer_coins = 0 WHERE id = ?`
        ).run(row.id);
      }
      return { total, details };
    })();
  }

  return {
    listByUser,
    listByScope,
    getByUserType,
    getById,
    countByUser,
    insert,
    setBuffer,
    setHealth,
    applyDamage,
    takeFromBuffer,
    collectAllBuffers,
  };
}
