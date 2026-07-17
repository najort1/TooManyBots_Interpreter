import { randomUUID } from 'node:crypto';
import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';
import { COLLECTIBLES } from '../shop/collectibles.js';

const ANALYTICS_SCHEMA = 'analytics';

function parseJson(raw, fallback) {
  try {
    return JSON.parse(String(raw || '')) ?? fallback;
  } catch {
    return fallback;
  }
}

export function createFunMarketRepository({ getDatabase = getDb } = {}) {
  function ensureSchema() {
    applyFunSchema(getDatabase());
  }

  function getMeta(scopeKey) {
    ensureSchema();
    const row = getDatabase()
      .prepare(`SELECT * FROM ${ANALYTICS_SCHEMA}.fun_market_meta WHERE scope_key = ?`)
      .get(String(scopeKey || ''));
    return {
      scopeKey: String(scopeKey || ''),
      lastEventAt: Number(row?.last_event_at) || 0,
      nextEventAt: Number(row?.next_event_at) || 0,
      lastRestockAt: Number(row?.last_restock_at) || 0,
      updatedAt: Number(row?.updated_at) || 0,
    };
  }

  function setMeta(
    scopeKey,
    { lastEventAt, nextEventAt, lastRestockAt, now = Date.now() } = {}
  ) {
    ensureSchema();
    const s = String(scopeKey || '');
    const ts = Number(now) || Date.now();
    const cur = getMeta(s);
    const nextLastEvent =
      lastEventAt === undefined ? cur.lastEventAt : Math.max(0, Math.floor(Number(lastEventAt) || 0));
    const nextNextEvent =
      nextEventAt === undefined ? cur.nextEventAt : Math.max(0, Math.floor(Number(nextEventAt) || 0));
    const nextRestock =
      lastRestockAt === undefined
        ? cur.lastRestockAt
        : Math.max(0, Math.floor(Number(lastRestockAt) || 0));
    getDatabase()
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_market_meta
         (scope_key, last_event_at, next_event_at, last_restock_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(scope_key) DO UPDATE SET
           last_event_at = excluded.last_event_at,
           next_event_at = excluded.next_event_at,
           last_restock_at = excluded.last_restock_at,
           updated_at = excluded.updated_at`
      )
      .run(s, nextLastEvent, nextNextEvent, nextRestock, ts);
    return getMeta(s);
  }

  /** Reposição semanal: estoque de volta ao stockMax de cada item. */
  function restockAllToMax(scopeKey, now = Date.now()) {
    ensureSchema();
    ensurePrices(scopeKey, now);
    const s = String(scopeKey || '');
    const ts = Number(now) || Date.now();
    const db = getDatabase();
    const upsert = db.prepare(
      `INSERT INTO ${ANALYTICS_SCHEMA}.fun_market_stock
       (scope_key, item_id, stock, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(scope_key, item_id) DO UPDATE SET
         stock = excluded.stock,
         updated_at = excluded.updated_at`
    );
    const tx = db.transaction(() => {
      for (const item of COLLECTIBLES) {
        upsert.run(s, item.id, Math.max(0, Math.floor(Number(item.stockMax) || 0)), ts);
      }
    });
    tx();
    return listStock(s);
  }

  function listStock(scopeKey) {
    ensureSchema();
    ensurePrices(scopeKey);
    return getDatabase()
      .prepare(
        `SELECT item_id AS itemId, stock, updated_at AS updatedAt
         FROM ${ANALYTICS_SCHEMA}.fun_market_stock
         WHERE scope_key = ?`
      )
      .all(String(scopeKey || ''))
      .map((r) => ({
        itemId: String(r.itemId || ''),
        stock: Number(r.stock) || 0,
        updatedAt: Number(r.updatedAt) || 0,
      }));
  }

  function ensurePrices(scopeKey, now = Date.now()) {
    ensureSchema();
    const s = String(scopeKey || '');
    const ts = Number(now) || Date.now();
    const db = getDatabase();
    const insert = db.prepare(
      `INSERT OR IGNORE INTO ${ANALYTICS_SCHEMA}.fun_market_prices
       (scope_key, item_id, price, previous_price, trend, last_event_id, updated_at)
       VALUES (?, ?, ?, ?, 'flat', '', ?)`
    );
    const stockIns = db.prepare(
      `INSERT OR IGNORE INTO ${ANALYTICS_SCHEMA}.fun_market_stock
       (scope_key, item_id, stock, updated_at)
       VALUES (?, ?, ?, ?)`
    );
    for (const item of COLLECTIBLES) {
      insert.run(s, item.id, item.basePrice, item.basePrice, ts);
      stockIns.run(s, item.id, Math.max(0, Math.floor(Number(item.stockMax) || 0)), ts);
    }
  }

  function getStock(scopeKey, itemId) {
    ensureSchema();
    ensurePrices(scopeKey);
    const row = getDatabase()
      .prepare(
        `SELECT stock FROM ${ANALYTICS_SCHEMA}.fun_market_stock
         WHERE scope_key = ? AND item_id = ?`
      )
      .get(String(scopeKey || ''), String(itemId || ''));
    return Number(row?.stock) || 0;
  }

  function setStock(scopeKey, itemId, stock, now = Date.now()) {
    ensureSchema();
    getDatabase()
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_market_stock
         (scope_key, item_id, stock, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(scope_key, item_id) DO UPDATE SET
           stock = excluded.stock,
           updated_at = excluded.updated_at`
      )
      .run(
        String(scopeKey || ''),
        String(itemId || ''),
        Math.max(0, Math.floor(Number(stock) || 0)),
        Number(now) || Date.now()
      );
    return getStock(scopeKey, itemId);
  }

  /** @returns {boolean} se debitou 1 do estoque */
  function consumeStock(scopeKey, itemId, now = Date.now()) {
    ensureSchema();
    ensurePrices(scopeKey, now);
    const db = getDatabase();
    const s = String(scopeKey || '');
    const id = String(itemId || '');
    const row = db
      .prepare(
        `SELECT stock FROM ${ANALYTICS_SCHEMA}.fun_market_stock
         WHERE scope_key = ? AND item_id = ?`
      )
      .get(s, id);
    const stock = Number(row?.stock) || 0;
    if (stock <= 0) return false;
    db.prepare(
      `UPDATE ${ANALYTICS_SCHEMA}.fun_market_stock
       SET stock = stock - 1, updated_at = ?
       WHERE scope_key = ? AND item_id = ? AND stock > 0`
    ).run(Number(now) || Date.now(), s, id);
    return true;
  }

  function getPrice(scopeKey, itemId) {
    ensureSchema();
    ensurePrices(scopeKey);
    const row = getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_market_prices
         WHERE scope_key = ? AND item_id = ?`
      )
      .get(String(scopeKey || ''), String(itemId || ''));
    if (!row) return null;
    return {
      scopeKey: String(row.scope_key),
      itemId: String(row.item_id),
      price: Number(row.price) || 0,
      previousPrice: Number(row.previous_price) || 0,
      trend: String(row.trend || 'flat'),
      lastEventId: String(row.last_event_id || ''),
      updatedAt: Number(row.updated_at) || 0,
    };
  }

  function listPrices(scopeKey) {
    ensureSchema();
    ensurePrices(scopeKey);
    const rows = getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_market_prices
         WHERE scope_key = ?
         ORDER BY item_id ASC`
      )
      .all(String(scopeKey || ''));
    return rows.map((row) => ({
      scopeKey: String(row.scope_key),
      itemId: String(row.item_id),
      price: Number(row.price) || 0,
      previousPrice: Number(row.previous_price) || 0,
      trend: String(row.trend || 'flat'),
      lastEventId: String(row.last_event_id || ''),
      updatedAt: Number(row.updated_at) || 0,
    }));
  }

  function setPrice({
    scopeKey,
    itemId,
    price,
    previousPrice,
    trend = 'flat',
    eventId = '',
    now = Date.now(),
  }) {
    ensureSchema();
    const s = String(scopeKey || '');
    const id = String(itemId || '');
    const p = Math.max(1, Math.floor(Number(price) || 1));
    const prev = Math.max(0, Math.floor(Number(previousPrice) || 0));
    const ts = Number(now) || Date.now();
    getDatabase()
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_market_prices
         (scope_key, item_id, price, previous_price, trend, last_event_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(scope_key, item_id) DO UPDATE SET
           price = excluded.price,
           previous_price = excluded.previous_price,
           trend = excluded.trend,
           last_event_id = excluded.last_event_id,
           updated_at = excluded.updated_at`
      )
      .run(s, id, p, prev, String(trend || 'flat'), String(eventId || ''), ts);

    getDatabase()
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_market_price_history
         (scope_key, item_id, price, previous_price, event_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(s, id, p, prev, String(eventId || ''), ts);

    return getPrice(s, id);
  }

  function insertEvent({
    scopeKey,
    title,
    description = '',
    category = '',
    impactPct = 0,
    source = 'template',
    now = Date.now(),
    id = null,
  }) {
    ensureSchema();
    const eventId = id || randomUUID();
    const ts = Number(now) || Date.now();
    getDatabase()
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_market_events
         (id, scope_key, title, description, category, impact_pct, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        eventId,
        String(scopeKey || ''),
        String(title || 'Evento de mercado').slice(0, 120),
        String(description || '').slice(0, 900),
        String(category || ''),
        Number(impactPct) || 0,
        String(source || 'template'),
        ts
      );
    return getEvent(eventId);
  }

  function getEvent(id) {
    ensureSchema();
    const row = getDatabase()
      .prepare(`SELECT * FROM ${ANALYTICS_SCHEMA}.fun_market_events WHERE id = ?`)
      .get(String(id || ''));
    if (!row) return null;
    return {
      id: String(row.id),
      scopeKey: String(row.scope_key),
      title: String(row.title || ''),
      description: String(row.description || ''),
      category: String(row.category || ''),
      impactPct: Number(row.impact_pct) || 0,
      source: String(row.source || ''),
      createdAt: Number(row.created_at) || 0,
    };
  }

  function latestEvent(scopeKey) {
    ensureSchema();
    const row = getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_market_events
         WHERE scope_key = ?
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(String(scopeKey || ''));
    if (!row) return null;
    return getEvent(row.id);
  }

  function listHistory(scopeKey, itemId, limit = 8) {
    ensureSchema();
    const rows = getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_market_price_history
         WHERE scope_key = ? AND item_id = ?
         ORDER BY created_at DESC LIMIT ?`
      )
      .all(
        String(scopeKey || ''),
        String(itemId || ''),
        Math.max(1, Math.min(30, Math.floor(Number(limit) || 8)))
      );
    return rows.map((r) => ({
      price: Number(r.price) || 0,
      previousPrice: Number(r.previous_price) || 0,
      eventId: String(r.event_id || ''),
      createdAt: Number(r.created_at) || 0,
    }));
  }

  function addInventory({
    userJid,
    scopeKey,
    itemId,
    acquiredPrice = 0,
    condition = 'ok',
    usesLeft = -1,
    now = Date.now(),
  }) {
    ensureSchema();
    const id = randomUUID();
    const ts = Number(now) || Date.now();
    getDatabase()
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_inventory
         (id, user_jid, scope_key, item_id, condition, acquired_at, acquired_price, broken_at, uses_left)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        String(userJid || ''),
        String(scopeKey || ''),
        String(itemId || ''),
        condition === 'broken' ? 'broken' : 'ok',
        ts,
        Math.max(0, Math.floor(Number(acquiredPrice) || 0)),
        condition === 'broken' ? ts : 0,
        Math.floor(Number(usesLeft) ?? -1)
      );
    return getInventoryById(id);
  }

  function getInventoryById(id) {
    ensureSchema();
    const row = getDatabase()
      .prepare(`SELECT * FROM ${ANALYTICS_SCHEMA}.fun_inventory WHERE id = ?`)
      .get(String(id || ''));
    if (!row) return null;
    return mapInv(row);
  }

  function mapInv(row) {
    return {
      id: String(row.id),
      userJid: String(row.user_jid),
      scopeKey: String(row.scope_key),
      itemId: String(row.item_id),
      condition: String(row.condition || 'ok'),
      acquiredAt: Number(row.acquired_at) || 0,
      acquiredPrice: Number(row.acquired_price) || 0,
      brokenAt: Number(row.broken_at) || 0,
      usesLeft: row.uses_left === undefined || row.uses_left === null ? -1 : Number(row.uses_left),
    };
  }

  function setUsesLeft(id, usesLeft) {
    ensureSchema();
    getDatabase()
      .prepare(`UPDATE ${ANALYTICS_SCHEMA}.fun_inventory SET uses_left = ? WHERE id = ?`)
      .run(Math.floor(Number(usesLeft) ?? -1), String(id || ''));
    return getInventoryById(id);
  }

  function listInventory(userJid, scopeKey) {
    ensureSchema();
    const rows = getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_inventory
         WHERE user_jid = ? AND scope_key = ?
         ORDER BY acquired_at DESC`
      )
      .all(String(userJid || ''), String(scopeKey || ''));
    return rows.map(mapInv);
  }

  function listAllInventoryInScope(scopeKey) {
    ensureSchema();
    const rows = getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_inventory
         WHERE scope_key = ? AND condition = 'ok'
         ORDER BY acquired_at DESC`
      )
      .all(String(scopeKey || ''));
    return rows.map(mapInv);
  }

  function setInventoryCondition(id, condition, now = Date.now()) {
    ensureSchema();
    const broken = condition === 'broken';
    getDatabase()
      .prepare(
        `UPDATE ${ANALYTICS_SCHEMA}.fun_inventory
         SET condition = ?, broken_at = ?
         WHERE id = ?`
      )
      .run(broken ? 'broken' : 'ok', broken ? Number(now) || Date.now() : 0, String(id || ''));
    return getInventoryById(id);
  }

  function deleteInventory(id) {
    ensureSchema();
    getDatabase()
      .prepare(`DELETE FROM ${ANALYTICS_SCHEMA}.fun_inventory WHERE id = ?`)
      .run(String(id || ''));
  }

  function createListing({
    scopeKey,
    sellerJid,
    inventoryId,
    itemId,
    price,
    now = Date.now(),
  }) {
    ensureSchema();
    const id = randomUUID();
    const ts = Number(now) || Date.now();
    getDatabase()
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_bazaar_listings
         (id, scope_key, seller_jid, inventory_id, item_id, price, created_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'open')`
      )
      .run(
        id,
        String(scopeKey || ''),
        String(sellerJid || ''),
        String(inventoryId || ''),
        String(itemId || ''),
        Math.max(1, Math.floor(Number(price) || 1)),
        ts
      );
    return getListing(id);
  }

  function getListing(id) {
    ensureSchema();
    const row = getDatabase()
      .prepare(`SELECT * FROM ${ANALYTICS_SCHEMA}.fun_bazaar_listings WHERE id = ?`)
      .get(String(id || ''));
    if (!row) return null;
    return {
      id: String(row.id),
      scopeKey: String(row.scope_key),
      sellerJid: String(row.seller_jid),
      inventoryId: String(row.inventory_id),
      itemId: String(row.item_id),
      price: Number(row.price) || 0,
      createdAt: Number(row.created_at) || 0,
      status: String(row.status || 'open'),
    };
  }

  function listOpenListings(scopeKey, limit = 20) {
    ensureSchema();
    const rows = getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_bazaar_listings
         WHERE scope_key = ? AND status = 'open'
         ORDER BY created_at DESC LIMIT ?`
      )
      .all(
        String(scopeKey || ''),
        Math.max(1, Math.min(50, Math.floor(Number(limit) || 20)))
      );
    return rows.map((row) => getListing(row.id));
  }

  function closeListing(id, status = 'sold') {
    ensureSchema();
    getDatabase()
      .prepare(
        `UPDATE ${ANALYTICS_SCHEMA}.fun_bazaar_listings SET status = ? WHERE id = ?`
      )
      .run(String(status || 'sold'), String(id || ''));
    return getListing(id);
  }

  function findOpenListingByInventory(inventoryId) {
    ensureSchema();
    const row = getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_bazaar_listings
         WHERE inventory_id = ? AND status = 'open'
         LIMIT 1`
      )
      .get(String(inventoryId || ''));
    return row ? getListing(row.id) : null;
  }

  return {
    getMeta,
    setMeta,
    ensurePrices,
    getPrice,
    listPrices,
    setPrice,
    getStock,
    setStock,
    listStock,
    restockAllToMax,
    consumeStock,
    insertEvent,
    getEvent,
    latestEvent,
    listHistory,
    addInventory,
    getInventoryById,
    listInventory,
    listAllInventoryInScope,
    setInventoryCondition,
    setUsesLeft,
    deleteInventory,
    createListing,
    getListing,
    listOpenListings,
    closeListing,
    findOpenListingByInventory,
  };
}
