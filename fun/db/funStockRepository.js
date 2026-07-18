/**
 * Persistência da bolsa Fun — cotações, holdings, histórico e cooldown de trade.
 */

import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';
import { listCompanies } from '../economy/companies.js';

const ANALYTICS_SCHEMA = 'analytics';

/** Máx pontos retornados por query de histórico (downsample no serviço se precisar). */
const HISTORY_LIMIT_MAX = 2000;

export function createFunStockRepository({ getDatabase = getDb } = {}) {
  function ensureSchema() {
    applyFunSchema(getDatabase());
  }

  function mapQuote(row) {
    if (!row) return null;
    const price = Math.max(1, Math.floor(Number(row.price) || 1));
    const highRaw = Math.floor(Number(row.high_price) || 0);
    return {
      scopeKey: String(row.scope_key || ''),
      companyId: String(row.company_id || ''),
      price,
      previousPrice: Math.max(0, Math.floor(Number(row.previous_price) || 0)),
      /** Máxima histórica (all-time high) no scope */
      highPrice: Math.max(price, highRaw > 0 ? highRaw : price),
      trend: String(row.trend || 'flat'),
      supply: Number(row.supply) || 1,
      demand: Number(row.demand) || 1,
      eventShock: Number(row.event_shock) || 0,
      volumeBuy: Number(row.volume_buy) || 0,
      volumeSell: Number(row.volume_sell) || 0,
      updatedAt: Number(row.updated_at) || 0,
    };
  }

  function mapHistory(row) {
    if (!row) return null;
    return {
      price: Math.max(1, Math.floor(Number(row.price) || 1)),
      previousPrice: Math.max(0, Math.floor(Number(row.previous_price) || 0)),
      highPrice: Math.max(0, Math.floor(Number(row.high_price) || 0)),
      createdAt: Number(row.created_at) || 0,
    };
  }

  function appendHistory({
    scopeKey,
    companyId,
    price,
    previousPrice,
    highPrice,
    now = Date.now(),
  }) {
    const s = String(scopeKey || '');
    const cid = String(companyId || '');
    if (!s || !cid) return;
    const p = Math.max(1, Math.floor(Number(price) || 1));
    const prev = Math.max(0, Math.floor(Number(previousPrice) || 0));
    const high = Math.max(p, Math.floor(Number(highPrice) || 0));
    const ts = Number(now) || Date.now();
    getDatabase()
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_stock_price_history
         (scope_key, company_id, price, previous_price, high_price, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(s, cid, p, prev, high, ts);
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
       (scope_key, company_id, price, previous_price, high_price, trend, supply, demand,
        event_shock, volume_buy, volume_sell, updated_at)
       VALUES (?, ?, ?, ?, ?, 'flat', ?, ?, 0, 0, 0, ?)`
    );
    const tx = db.transaction(() => {
      for (const c of listCompanies()) {
        const base = Math.max(1, Math.floor(Number(c.basePrice) || 1));
        const info = ins.run(
          s,
          c.id,
          base,
          base,
          base,
          Number(c.baseSupply) || 1,
          Number(c.baseDemand) || 1,
          ts
        );
        // 1º ponto de histórico quando a cotação nasce
        if (info?.changes > 0) {
          appendHistory({
            scopeKey: s,
            companyId: c.id,
            price: base,
            previousPrice: base,
            highPrice: base,
            now: ts,
          });
        }
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
    highPrice,
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
    // ATH: nunca desce; sobe se preço novo for maior
    const prevHigh = Math.max(
      0,
      Math.floor(Number(cur?.highPrice) || 0),
      Math.floor(Number(cur?.price) || 0)
    );
    const nextHigh =
      highPrice !== undefined
        ? Math.max(nextPrice, Math.floor(Number(highPrice) || 0), prevHigh)
        : Math.max(nextPrice, prevHigh);
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

    const priceChanged = !cur || nextPrice !== Math.floor(Number(cur.price) || 0);

    getDatabase()
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_stock_quotes
         (scope_key, company_id, price, previous_price, high_price, trend, supply, demand,
          event_shock, volume_buy, volume_sell, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(scope_key, company_id) DO UPDATE SET
           price = excluded.price,
           previous_price = excluded.previous_price,
           high_price = excluded.high_price,
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
        nextHigh,
        String(trend || 'flat'),
        nextSupply,
        nextDemand,
        nextShock,
        nextVb,
        nextVs,
        ts
      );

    // Só grava candle quando o preço muda (ou 1ª cotação) — evita lixo a cada tick flat
    if (priceChanged) {
      appendHistory({
        scopeKey: s,
        companyId: cid,
        price: nextPrice,
        previousPrice: nextPrev,
        highPrice: nextHigh,
        now: ts,
      });
    }

    return getQuote(s, cid);
  }

  /**
   * Histórico de preços (ASC no tempo). Filtros de data em ms epoch.
   * @param {string} scopeKey
   * @param {string} companyId
   * @param {{ from?: number, to?: number, limit?: number }} [opts]
   */
  function listHistory(scopeKey, companyId, opts = {}) {
    ensureSchema();
    const s = String(scopeKey || '');
    const cid = String(companyId || '');
    if (!s || !cid) return [];
    const from = Math.max(0, Math.floor(Number(opts.from) || 0));
    const to = Math.max(0, Math.floor(Number(opts.to) || 0));
    const limit = Math.max(
      1,
      Math.min(HISTORY_LIMIT_MAX, Math.floor(Number(opts.limit) || 500))
    );

    let sql = `SELECT price, previous_price, high_price, created_at
               FROM ${ANALYTICS_SCHEMA}.fun_stock_price_history
               WHERE scope_key = ? AND company_id = ?`;
    const params = [s, cid];
    if (from > 0) {
      sql += ' AND created_at >= ?';
      params.push(from);
    }
    if (to > 0) {
      sql += ' AND created_at <= ?';
      params.push(to);
    }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const rows = getDatabase().prepare(sql).all(...params);
    // devolve ASC para gráficos
    return rows
      .map(mapHistory)
      .filter(Boolean)
      .reverse();
  }

  /**
   * Semente de 1 ponto se ainda não há histórico (cotação atual).
   * Útil após deploy / grupos antigos.
   */
  function seedHistoryFromQuote(scopeKey, companyId, now = Date.now()) {
    ensureSchema();
    const q = getQuote(scopeKey, companyId);
    if (!q) return null;
    const existing = getDatabase()
      .prepare(
        `SELECT 1 FROM ${ANALYTICS_SCHEMA}.fun_stock_price_history
         WHERE scope_key = ? AND company_id = ? LIMIT 1`
      )
      .get(String(scopeKey || ''), String(companyId || ''));
    if (existing) return null;
    appendHistory({
      scopeKey,
      companyId,
      price: q.price,
      previousPrice: q.previousPrice,
      highPrice: q.highPrice,
      now: Number(q.updatedAt) || now,
    });
    return q;
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
    listHistory,
    seedHistoryFromQuote,
    appendHistory,
    getHolding,
    listHoldings,
    setHolding,
    getLastTradeAt,
    setLastTradeAt,
  };
}
