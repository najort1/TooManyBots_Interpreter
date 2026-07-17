/**
 * Persistência da bolsa Fun — cotações, holdings e cooldown de trade.
 */

import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';
import { listCompanies } from '../economy/companies.js';

const ANALYTICS_SCHEMA = 'analytics';

export function createFunStockRepository({ getDatabase = getDb } = {}) {
  function ensureSchema() {
    applyFunSchema(getDatabase());
  }

  function mapQuote(row) {
    if (!row) return null;
    return {
      scopeKey: String(row.scope_key || ''),
      companyId: String(row.company_id || ''),
      price: Math.max(1, Math.floor(Number(row.price) || 1)),
      previousPrice: Math.max(0, Math.floor(Number(row.previous_price) || 0)),
      trend: String(row.trend || 'flat'),
      supply: Number(row.supply) || 1,
      demand: Number(row.demand) || 1,
      eventShock: Number(row.event_shock) || 0,
      volumeBuy: Number(row.volume_buy) || 0,
      volumeSell: Number(row.volume_sell) || 0,
      updatedAt: Number(row.updated_at) || 0,
    };
  }

  function mapHolding(row) {
    if (!row) return null;
    return {
      userJid: String(row.user_jid || ''),
      scopeKey: String(row.scope_key || ''),
      companyId: String(row.company_id || ''),
      qty: Math.max(0, Math.floor(Number(row.qty) || 0)),
      avgCost: Math.max(0, Math.floor(Number(row.avg_cost) || 0)),
      lastDividendAt: Math.max(0, Math.floor(Number(row.last_dividend_at) || 0)),
      updatedAt: Number(row.updated_at) || 0,
    };
  }

  function ensureQuotes(scopeKey, now = Date.now()) {
    ensureSchema();
    const s = String(scopeKey || '');
    const ts = Number(now) || Date.now();
    if (!s) return [];
    const db = getDatabase();
    const ins = db.prepare(
      `INSERT OR IGNORE INTO ${ANALYTICS_SCHEMA}.fun_stock_quotes
       (scope_key, company_id, price, previous_price, trend, supply, demand,
        event_shock, volume_buy, volume_sell, updated_at)
       VALUES (?, ?, ?, ?, 'flat', ?, ?, 0, 0, 0, ?)`
    );
    const tx = db.transaction(() => {
      for (const c of listCompanies()) {
        const base = Math.max(1, Math.floor(Number(c.basePrice) || 1));
        ins.run(
          s,
          c.id,
          base,
          base,
          Number(c.baseSupply) || 1,
          Number(c.baseDemand) || 1,
          ts
        );
      }
    });
    tx();
    return listQuotes(s);
  }

  function getQuote(scopeKey, companyId) {
    ensureSchema();
    const row = getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_stock_quotes
         WHERE scope_key = ? AND company_id = ?`
      )
      .get(String(scopeKey || ''), String(companyId || ''));
    return mapQuote(row);
  }

  function listQuotes(scopeKey) {
    ensureSchema();
    const rows = getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_stock_quotes
         WHERE scope_key = ?
         ORDER BY company_id ASC`
      )
      .all(String(scopeKey || ''));
    return rows.map(mapQuote).filter(Boolean);
  }

  function setQuote({
    scopeKey,
    companyId,
    price,
    previousPrice,
    trend = 'flat',
    supply,
    demand,
    eventShock,
    volumeBuy,
    volumeSell,
    now = Date.now(),
  }) {
    ensureSchema();
    const s = String(scopeKey || '');
    const cid = String(companyId || '');
    const ts = Number(now) || Date.now();
    if (!s || !cid) return null;
    const cur = getQuote(s, cid);
    const nextPrice = Math.max(1, Math.floor(Number(price) || cur?.price || 1));
    const nextPrev =
      previousPrice === undefined
        ? cur?.previousPrice ?? nextPrice
        : Math.max(0, Math.floor(Number(previousPrice) || 0));
    const nextSupply =
      supply === undefined ? cur?.supply ?? 1 : Number(supply) || 1;
    const nextDemand =
      demand === undefined ? cur?.demand ?? 1 : Number(demand) || 1;
    const nextShock =
      eventShock === undefined ? cur?.eventShock ?? 0 : Number(eventShock) || 0;
    const nextVb =
      volumeBuy === undefined ? cur?.volumeBuy ?? 0 : Number(volumeBuy) || 0;
    const nextVs =
      volumeSell === undefined ? cur?.volumeSell ?? 0 : Number(volumeSell) || 0;

    getDatabase()
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_stock_quotes
         (scope_key, company_id, price, previous_price, trend, supply, demand,
          event_shock, volume_buy, volume_sell, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(scope_key, company_id) DO UPDATE SET
           price = excluded.price,
           previous_price = excluded.previous_price,
           trend = excluded.trend,
           supply = excluded.supply,
           demand = excluded.demand,
           event_shock = excluded.event_shock,
           volume_buy = excluded.volume_buy,
           volume_sell = excluded.volume_sell,
           updated_at = excluded.updated_at`
      )
      .run(
        s,
        cid,
        nextPrice,
        nextPrev,
        String(trend || 'flat'),
        nextSupply,
        nextDemand,
        nextShock,
        nextVb,
        nextVs,
        ts
      );
    return getQuote(s, cid);
  }

  function getHolding(userJid, scopeKey, companyId) {
    ensureSchema();
    const row = getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_stock_holdings
         WHERE user_jid = ? AND scope_key = ? AND company_id = ?`
      )
      .get(String(userJid || ''), String(scopeKey || ''), String(companyId || ''));
    return mapHolding(row);
  }

  function listHoldings(userJid, scopeKey) {
    ensureSchema();
    const rows = getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_stock_holdings
         WHERE user_jid = ? AND scope_key = ? AND qty > 0
         ORDER BY company_id ASC`
      )
      .all(String(userJid || ''), String(scopeKey || ''));
    return rows.map(mapHolding).filter(Boolean);
  }

  function setHolding({
    userJid,
    scopeKey,
    companyId,
    qty,
    avgCost,
    lastDividendAt,
    now = Date.now(),
  }) {
    ensureSchema();
    const u = String(userJid || '');
    const s = String(scopeKey || '');
    const cid = String(companyId || '');
    const ts = Number(now) || Date.now();
    if (!u || !s || !cid) return null;
    const q = Math.max(0, Math.floor(Number(qty) || 0));
    const avg = Math.max(0, Math.floor(Number(avgCost) || 0));
    const divAt =
      lastDividendAt === undefined
        ? getHolding(u, s, cid)?.lastDividendAt || 0
        : Math.max(0, Math.floor(Number(lastDividendAt) || 0));

    if (q <= 0) {
      getDatabase()
        .prepare(
          `DELETE FROM ${ANALYTICS_SCHEMA}.fun_stock_holdings
           WHERE user_jid = ? AND scope_key = ? AND company_id = ?`
        )
        .run(u, s, cid);
      return null;
    }

    getDatabase()
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_stock_holdings
         (user_jid, scope_key, company_id, qty, avg_cost, last_dividend_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_jid, scope_key, company_id) DO UPDATE SET
           qty = excluded.qty,
           avg_cost = excluded.avg_cost,
           last_dividend_at = excluded.last_dividend_at,
           updated_at = excluded.updated_at`
      )
      .run(u, s, cid, q, avg, divAt, ts);
    return getHolding(u, s, cid);
  }

  function getLastTradeAt(userJid, scopeKey) {
    ensureSchema();
    const row = getDatabase()
      .prepare(
        `SELECT last_trade_at FROM ${ANALYTICS_SCHEMA}.fun_stock_trade_meta
         WHERE user_jid = ? AND scope_key = ?`
      )
      .get(String(userJid || ''), String(scopeKey || ''));
    return Number(row?.last_trade_at) || 0;
  }

  function setLastTradeAt(userJid, scopeKey, now = Date.now()) {
    ensureSchema();
    const u = String(userJid || '');
    const s = String(scopeKey || '');
    const ts = Number(now) || Date.now();
    if (!u || !s) return;
    getDatabase()
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_stock_trade_meta
         (user_jid, scope_key, last_trade_at)
         VALUES (?, ?, ?)
         ON CONFLICT(user_jid, scope_key) DO UPDATE SET
           last_trade_at = excluded.last_trade_at`
      )
      .run(u, s, ts);
  }

  return {
    ensureQuotes,
    getQuote,
    listQuotes,
    setQuote,
    getHolding,
    listHoldings,
    setHolding,
    getLastTradeAt,
    setLastTradeAt,
  };
}
