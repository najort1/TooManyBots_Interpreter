/**
 * Bolsa Fun — long-only, preço virtual (bot market maker), caps rígidos.
 * Cotações movidas por tickEconomy + eventos (via marketService hooks).
 */

import {
  listCompanies,
  getCompany,
  resolveCompanyToken,
  companyForCategory,
} from '../economy/companies.js';
import {
  tickAsset,
  applyImpactToAsset,
  decayAssetState,
  trendFrom,
} from '../economy/engine.js';
import {
  getDividendProfile,
  indicativeDividendYield,
  rollDividendPayout,
  formatYieldHint,
} from '../economy/dividends.js';
import { getPublicBaseUrl } from '../utils/publicUrl.js';

function numOr(v, fb) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function arrow(trend) {
  if (trend === 'up') return '↑';
  if (trend === 'down') return '↓';
  return '→';
}

function formatRetry(ms) {
  const sec = Math.ceil(Math.max(0, ms) / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m`;
}

export function createStockService({
  repository,
  stockRepository,
  random = Math.random,
} = {}) {
  if (!repository) throw new Error('[fun/stockService] repository required');
  if (!stockRepository) throw new Error('[fun/stockService] stockRepository required');

  function opts(funConfig = {}) {
    return {
      enabled: funConfig.bolsaEnabled !== false,
      cooldownMs: Math.max(0, Math.floor(numOr(funConfig.bolsaTradeCooldownMs, 30_000))),
      maxQty: Math.max(1, Math.floor(numOr(funConfig.bolsaMaxQtyPerTicker, 40))),
      maxPosition: Math.max(50, Math.floor(numOr(funConfig.bolsaMaxPositionCoins, 2500))),
      minQty: Math.max(1, Math.floor(numOr(funConfig.bolsaMinQty, 1))),
      dividendPeriodMs: Math.max(
        60_000,
        Math.floor(numOr(funConfig.bolsaDividendPeriodMs, 24 * 60 * 60_000))
      ),
      dividendCap: Math.max(0, Math.floor(numOr(funConfig.bolsaDividendCapPerTick, 80))),
    };
  }

  function ensureScope(scopeKey, now = Date.now()) {
    return stockRepository.ensureQuotes(scopeKey, now);
  }

  function getQuoteHydrated(scopeKey, companyId, now = Date.now()) {
    ensureScope(scopeKey, now);
    const company = getCompany(companyId);
    if (!company) return null;
    let q = stockRepository.getQuote(scopeKey, companyId);
    if (!q) {
      stockRepository.setQuote({
        scopeKey,
        companyId,
        price: company.basePrice,
        previousPrice: company.basePrice,
        trend: 'flat',
        supply: company.baseSupply,
        demand: company.baseDemand,
        now,
      });
      q = stockRepository.getQuote(scopeKey, companyId);
    }
    const price = q?.price ?? company.basePrice;
    const prev = q?.previousPrice ?? company.basePrice;
    const highPrice = Math.max(
      price,
      Math.floor(Number(q?.highPrice) || 0),
      Math.floor(Number(company.basePrice) || 0)
    );
    const delta = price - prev;
    const deltaPct = prev > 0 ? Math.round((delta / prev) * 100) : 0;
    const supply = q?.supply ?? 1;
    const demand = q?.demand ?? 1;
    const eventShock = q?.eventShock ?? 0;
    const divProfile = getDividendProfile(company);
    const dynamicYield = indicativeDividendYield({
      company,
      price,
      basePrice: company.basePrice,
      demand,
    });
    return {
      ...company,
      price,
      previousPrice: prev,
      highPrice,
      atHigh: price >= highPrice,
      trend: q?.trend || 'flat',
      delta,
      deltaPct,
      supply,
      demand,
      eventShock,
      volumeBuy: q?.volumeBuy ?? 0,
      volumeSell: q?.volumeSell ?? 0,
      dividendYield: dynamicYield,
      dividendProfile: divProfile,
      dividendRare: Boolean(divProfile.rare),
      updatedAt: Number(q?.updatedAt) || now,
    };
  }

  function listQuotes(scopeKey, funConfig = {}, now = Date.now()) {
    if (opts(funConfig).enabled === false) return [];
    ensureScope(scopeKey, now);
    return listCompanies().map((c) => getQuoteHydrated(scopeKey, c.id, now)).filter(Boolean);
  }

  function markToMarket(userJid, scopeKey, funConfig = {}, now = Date.now()) {
    const holdings = stockRepository.listHoldings(userJid, scopeKey);
    let total = 0;
    for (const h of holdings) {
      const q = getQuoteHydrated(scopeKey, h.companyId, now);
      total += (q?.price || 0) * h.qty;
    }
    return total;
  }

  /**
   * Tick de cotações de empresa (mesmo motor dos itens).
   * Não usa fluxo de trade de players (virtual puro).
   */
  function tickQuotes(scopeKey, reg = {}, now = Date.now()) {
    ensureScope(scopeKey, now);
    const changed = [];
    for (const company of listCompanies()) {
      const cur = stockRepository.getQuote(scopeKey, company.id);
      const price = cur?.price ?? company.basePrice;
      let state = {
        supply: cur?.supply ?? company.baseSupply ?? 1,
        demand: cur?.demand ?? company.baseDemand ?? 1,
        eventShock: cur?.eventShock ?? 0,
        volumeBuy: cur?.volumeBuy ?? 0,
        volumeSell: cur?.volumeSell ?? 0,
      };
      state = decayAssetState(state, company, reg);
      const tick = tickAsset({
        price,
        basePrice: company.basePrice,
        personality: company,
        supply: state.supply,
        demand: state.demand,
        volumeBuy: state.volumeBuy,
        volumeSell: state.volumeSell,
        eventShock: state.eventShock,
        reg,
        random,
      });
      if (tick.price !== price) {
        stockRepository.setQuote({
          scopeKey,
          companyId: company.id,
          price: tick.price,
          previousPrice: price,
          trend: trendFrom(price, tick.price),
          supply: tick.supply,
          demand: tick.demand,
          eventShock: tick.eventShock,
          volumeBuy: state.volumeBuy * (reg.volumeDecay || 0.72),
          volumeSell: state.volumeSell * (reg.volumeDecay || 0.72),
          now,
        });
        changed.push({
          companyId: company.id,
          name: company.name,
          previousPrice: price,
          price: tick.price,
          trend: trendFrom(price, tick.price),
          deltaPct: tick.deltaPct,
        });
      } else {
        stockRepository.setQuote({
          scopeKey,
          companyId: company.id,
          price,
          previousPrice: cur?.previousPrice ?? price,
          trend: cur?.trend || 'flat',
          supply: tick.supply,
          demand: tick.demand,
          eventShock: tick.eventShock,
          volumeBuy: state.volumeBuy * (reg.volumeDecay || 0.72),
          volumeSell: state.volumeSell * (reg.volumeDecay || 0.72),
          now,
        });
      }
    }
    return { ok: true, changed };
  }

  /**
   * Aplica impacto de evento à cotação da empresa (mesma categoria/companyId).
   */
  function applyEventImpact(scopeKey, resolved, reg = {}, now = Date.now()) {
    if (!resolved) return [];
    ensureScope(scopeKey, now);
    const company =
      getCompany(resolved.companyId) ||
      companyForCategory(resolved.category) ||
      null;
    if (!company) return [];

    const impact = resolved.impact;
    const cur = stockRepository.getQuote(scopeKey, company.id);
    const prev = cur?.price ?? company.basePrice;
    let state = {
      supply: cur?.supply ?? company.baseSupply ?? 1,
      demand: cur?.demand ?? company.baseDemand ?? 1,
      eventShock: cur?.eventShock ?? 0,
      volumeBuy: cur?.volumeBuy ?? 0,
      volumeSell: cur?.volumeSell ?? 0,
    };

    if (impact && !impact.rumorOnly) {
      const next = applyImpactToAsset(state, impact, company, reg);
      state = {
        supply: next.supply,
        demand: next.demand,
        eventShock: next.eventShock,
        volumeBuy: state.volumeBuy,
        volumeSell: state.volumeSell,
      };
    }

    const over = prev / Math.max(1, company.basePrice);
    let eventShock = state.eventShock;
    if (eventShock > 0 && over > 1.2) {
      eventShock *= Math.max(0.15, 1.2 - over * 0.45);
    }
    eventShock = Math.max(-12, Math.min(10, eventShock));

    const tick = tickAsset({
      price: prev,
      basePrice: company.basePrice,
      personality: company,
      supply: state.supply,
      demand: state.demand,
      volumeBuy: state.volumeBuy * 0.5,
      volumeSell: state.volumeSell * 0.5,
      eventShock,
      reg: { ...reg, baseNoisePct: Math.min(Number(reg.baseNoisePct) || 0.012, 0.01) },
      random,
    });

    let nextPrice = tick.price;
    const maxUp = Math.round(prev * 1.12);
    const maxDown = Math.max(1, Math.round(prev * 0.88));
    if (nextPrice > maxUp) nextPrice = maxUp;
    if (nextPrice < maxDown) nextPrice = maxDown;
    const floor = Math.max(1, Math.floor(company.basePrice * (company.floorMult || 0.4)));
    const ceil = Math.max(floor + 1, Math.floor(company.basePrice * (company.ceilMult || 2.2)));
    nextPrice = Math.min(ceil, Math.max(floor, nextPrice));

    stockRepository.setQuote({
      scopeKey,
      companyId: company.id,
      price: nextPrice,
      previousPrice: prev,
      trend: trendFrom(prev, nextPrice),
      supply: tick.supply,
      demand: tick.demand,
      eventShock: Math.max(-20, Math.min(20, tick.eventShock)),
      volumeBuy: state.volumeBuy * 0.5,
      volumeSell: state.volumeSell * 0.5,
      now,
    });

    return [
      {
        companyId: company.id,
        name: company.name,
        previousPrice: prev,
        price: nextPrice,
        trend: trendFrom(prev, nextPrice),
        deltaPct: prev > 0 ? ((nextPrice - prev) / prev) * 100 : 0,
        kind: 'stock',
      },
    ];
  }

  function buy({
    userJid,
    scopeKey,
    token,
    qty,
    funConfig = {},
    now = Date.now(),
  }) {
    const o = opts(funConfig);
    if (!o.enabled) return { ok: false, reason: 'disabled' };
    const u = String(userJid || '').trim();
    const s = String(scopeKey || '').trim();
    if (!u || !s) return { ok: false, reason: 'invalid' };

    const company = resolveCompanyToken(token);
    if (!company) return { ok: false, reason: 'unknown-ticker', token };

    const q = Math.floor(Number(qty) || 0);
    if (q < o.minQty) return { ok: false, reason: 'min-qty', minQty: o.minQty };

    const lastAt = stockRepository.getLastTradeAt(u, s);
    if (o.cooldownMs > 0 && lastAt > 0 && now - lastAt < o.cooldownMs) {
      return {
        ok: false,
        reason: 'cooldown',
        retryInMs: o.cooldownMs - (now - lastAt),
      };
    }

    ensureScope(s, now);
    const quote = getQuoteHydrated(s, company.id, now);
    const price = quote.price;
    const cost = price * q;

    const holding = stockRepository.getHolding(u, s, company.id);
    const curQty = holding?.qty || 0;
    if (curQty + q > o.maxQty) {
      return {
        ok: false,
        reason: 'max-qty',
        maxQty: o.maxQty,
        holding: curQty,
      };
    }

    const mtm = markToMarket(u, s, funConfig, now);
    if (mtm + cost > o.maxPosition) {
      return {
        ok: false,
        reason: 'max-position',
        maxPosition: o.maxPosition,
        markToMarket: mtm,
        cost,
      };
    }

    const stats = repository.ensureUserRow(u, s, now);
    const coins = Number(stats?.coins) || 0;
    if (coins < cost) {
      return {
        ok: false,
        reason: 'insufficient-funds',
        coins,
        cost,
        price,
        qty: q,
      };
    }

    const debited = repository.addCoins({
      userJid: u,
      scopeKey: s,
      amount: -cost,
      now,
      reason: `stock-buy:${company.id}`,
    });
    if (!debited.ok) return { ok: false, reason: 'spend-failed' };

    const newQty = curQty + q;
    const prevCostBasis = (holding?.avgCost || 0) * curQty;
    const avgCost = Math.round((prevCostBasis + cost) / newQty);
    stockRepository.setHolding({
      userJid: u,
      scopeKey: s,
      companyId: company.id,
      qty: newQty,
      avgCost,
      lastDividendAt: holding?.lastDividendAt || 0,
      now,
    });
    stockRepository.setLastTradeAt(u, s, now);

    return {
      ok: true,
      side: 'buy',
      company,
      qty: q,
      price,
      cost,
      holdingQty: newQty,
      avgCost,
      coins: debited.coins,
    };
  }

  function sell({
    userJid,
    scopeKey,
    token,
    qty,
    funConfig = {},
    now = Date.now(),
  }) {
    const o = opts(funConfig);
    if (!o.enabled) return { ok: false, reason: 'disabled' };
    const u = String(userJid || '').trim();
    const s = String(scopeKey || '').trim();
    if (!u || !s) return { ok: false, reason: 'invalid' };

    const company = resolveCompanyToken(token);
    if (!company) return { ok: false, reason: 'unknown-ticker', token };

    const q = Math.floor(Number(qty) || 0);
    if (q < o.minQty) return { ok: false, reason: 'min-qty', minQty: o.minQty };

    const lastAt = stockRepository.getLastTradeAt(u, s);
    if (o.cooldownMs > 0 && lastAt > 0 && now - lastAt < o.cooldownMs) {
      return {
        ok: false,
        reason: 'cooldown',
        retryInMs: o.cooldownMs - (now - lastAt),
      };
    }

    const holding = stockRepository.getHolding(u, s, company.id);
    const curQty = holding?.qty || 0;
    if (curQty < q) {
      return {
        ok: false,
        reason: 'insufficient-shares',
        holding: curQty,
        qty: q,
      };
    }

    ensureScope(s, now);
    const quote = getQuoteHydrated(s, company.id, now);
    const price = quote.price;
    const proceeds = price * q;

    stockRepository.setHolding({
      userJid: u,
      scopeKey: s,
      companyId: company.id,
      qty: curQty - q,
      avgCost: holding?.avgCost || 0,
      lastDividendAt: holding?.lastDividendAt || 0,
      now,
    });

    const credited = repository.addCoins({
      userJid: u,
      scopeKey: s,
      amount: proceeds,
      now,
      reason: `stock-sell:${company.id}`,
    });
    if (!credited.ok) {
      // rollback holding
      stockRepository.setHolding({
        userJid: u,
        scopeKey: s,
        companyId: company.id,
        qty: curQty,
        avgCost: holding?.avgCost || 0,
        lastDividendAt: holding?.lastDividendAt || 0,
        now,
      });
      return { ok: false, reason: 'credit-failed' };
    }

    stockRepository.setLastTradeAt(u, s, now);
    const costBasis = (holding?.avgCost || 0) * q;
    const realized = proceeds - costBasis;

    return {
      ok: true,
      side: 'sell',
      company,
      qty: q,
      price,
      proceeds,
      holdingQty: curQty - q,
      avgCost: holding?.avgCost || 0,
      realizedPnl: realized,
      coins: credited.coins,
    };
  }

  /**
   * Lazy dividends dinâmicos — personalidade + saúde da cotação + RNG.
   * PatoCoin: raro e gordo; Uno/Satélite/Burger: frequentes e moderados.
   */
  function payDividends({
    userJid,
    scopeKey,
    funConfig = {},
    now = Date.now(),
  }) {
    const o = opts(funConfig);
    if (!o.enabled || o.dividendCap <= 0) return { ok: true, total: 0, lines: [] };
    const u = String(userJid || '').trim();
    const s = String(scopeKey || '').trim();
    if (!u || !s) return { ok: false, reason: 'invalid', total: 0, lines: [] };

    ensureScope(s, now);
    const holdings = stockRepository.listHoldings(u, s);
    let remaining = o.dividendCap;
    let total = 0;
    const lines = [];

    for (const h of holdings) {
      if (remaining <= 0) break;
      const company = getCompany(h.companyId);
      if (!company || h.qty <= 0) continue;
      if (h.lastDividendAt > 0 && now - h.lastDividendAt < o.dividendPeriodMs) continue;

      const quote = getQuoteHydrated(s, h.companyId, now);
      const roll = rollDividendPayout({
        company,
        price: quote.price,
        basePrice: company.basePrice,
        demand: quote.demand,
        eventShock: quote.eventShock,
        random,
      });

      // marca o período mesmo em miss (evita re-roll a cada /carteira no mesmo dia)
      stockRepository.setHolding({
        userJid: u,
        scopeKey: s,
        companyId: h.companyId,
        qty: h.qty,
        avgCost: h.avgCost,
        lastDividendAt: now,
        now,
      });

      if (!roll.pays || roll.yield <= 0) continue;

      const raw = Math.floor(h.qty * quote.price * roll.yield);
      if (raw <= 0) continue;
      const pay = Math.min(raw, remaining);
      const credited = repository.addCoins({
        userJid: u,
        scopeKey: s,
        amount: pay,
        now,
        reason: `stock-dividend:${h.companyId}`,
      });
      if (!credited.ok) continue;
      remaining -= pay;
      total += pay;
      lines.push({
        companyId: h.companyId,
        name: company.name,
        emoji: company.emoji,
        amount: pay,
        yield: roll.yield,
        rare: roll.rare,
      });
    }

    return { ok: true, total, lines };
  }

  function portfolio(userJid, scopeKey, funConfig = {}, now = Date.now()) {
    ensureScope(scopeKey, now);
    const holdings = stockRepository.listHoldings(userJid, scopeKey);
    const positions = [];
    let totalValue = 0;
    let totalCost = 0;
    for (const h of holdings) {
      const company = getCompany(h.companyId);
      const quote = getQuoteHydrated(scopeKey, h.companyId, now);
      const value = quote.price * h.qty;
      const cost = (h.avgCost || 0) * h.qty;
      totalValue += value;
      totalCost += cost;
      positions.push({
        company,
        qty: h.qty,
        avgCost: h.avgCost,
        price: quote.price,
        trend: quote.trend,
        value,
        cost,
        unrealized: value - cost,
        lastDividendAt: h.lastDividendAt,
        dividendYield: Number(quote.dividendYield) || 0,
        dividendRare: Boolean(quote.dividendRare),
      });
    }
    return {
      positions,
      totalValue,
      totalCost,
      unrealized: totalValue - totalCost,
    };
  }

  /**
   * Payload read-only para dashboard/corretora web (sem dados de compra).
   */
  function publicBoard(scopeKey, funConfig = {}, now = Date.now()) {
    const quotes = listQuotes(scopeKey, funConfig, now);
    for (const q of quotes) {
      stockRepository.seedHistoryFromQuote?.(scopeKey, q.id, now);
    }
    const rows = quotes.map((q) => {
      const ath = Math.max(1, Math.floor(Number(q.highPrice) || Number(q.price) || 1));
      const fromAthPct =
        ath > 0 ? Math.round(((Number(q.price) - ath) / ath) * 1000) / 10 : 0;
      return {
        id: q.id,
        name: q.name,
        emoji: q.emoji,
        ticker: String(q.id || '').toUpperCase(),
        blurb: String(q.blurb || q.flavor || '').trim(),
        price: Math.floor(Number(q.price) || 0),
        previousPrice: Math.floor(Number(q.previousPrice) || 0),
        highPrice: ath,
        atHigh: Boolean(q.atHigh) || Number(q.price) >= ath,
        trend: q.trend || 'flat',
        delta: Math.floor(Number(q.delta) || 0),
        deltaPct: Number(q.deltaPct) || 0,
        fromAthPct,
        dividendYield: Number(q.dividendYield) || 0,
        dividendRare: Boolean(q.dividendRare),
        risk: Number(q.risk) || 0,
        volatility: Number(q.volatility) || 0,
        volumeBuy: Number(q.volumeBuy) || 0,
        volumeSell: Number(q.volumeSell) || 0,
        eventShock: Number(q.eventShock) || 0,
        updatedAt: Number(q.updatedAt) || now,
      };
    });

    const gainers = [...rows].sort((a, b) => b.deltaPct - a.deltaPct);
    const losers = [...rows].sort((a, b) => a.deltaPct - b.deltaPct);
    const nearAth = rows.filter((r) => r.fromAthPct >= -5).sort((a, b) => b.fromAthPct - a.fromAthPct);
    const avgDelta =
      rows.length > 0
        ? Math.round((rows.reduce((s, r) => s + r.deltaPct, 0) / rows.length) * 10) / 10
        : 0;
    const advancing = rows.filter((r) => r.deltaPct > 0).length;
    const declining = rows.filter((r) => r.deltaPct < 0).length;

    return {
      scope: String(scopeKey || ''),
      enabled: opts(funConfig).enabled !== false,
      ts: now,
      quotes: rows,
      summary: {
        count: rows.length,
        advancing,
        declining,
        unchanged: rows.length - advancing - declining,
        avgDeltaPct: avgDelta,
        atHighCount: rows.filter((r) => r.atHigh).length,
      },
      movers: {
        topGainers: gainers.filter((r) => r.deltaPct > 0).slice(0, 3),
        topLosers: losers.filter((r) => r.deltaPct < 0).slice(0, 3),
        nearAth: nearAth.slice(0, 3),
      },
      // só lembrete de trade no WhatsApp — nunca endpoints de ordem
      tradeHint: {
        channel: 'whatsapp',
        buy: '/bolsa comprar <ticker> <qtd>',
        sell: '/bolsa vender <ticker> <qtd>',
        portfolio: '/carteira',
      },
    };
  }

  /**
   * Histórico de um ticker com filtro de janela.
   * range: 1d | 7d | 30d | 90d | all  (ou from/to ms)
   */
  function publicHistory(scopeKey, companyToken, optsIn = {}, funConfig = {}, now = Date.now()) {
    const company = resolveCompanyToken(companyToken) || getCompany(companyToken);
    if (!company) {
      return { ok: false, reason: 'unknown-ticker', points: [] };
    }
    ensureScope(scopeKey, now);
    stockRepository.seedHistoryFromQuote?.(scopeKey, company.id, now);

    const range = String(optsIn.range || '').toLowerCase();
    let from = Math.max(0, Math.floor(Number(optsIn.from) || 0));
    let to = Math.max(0, Math.floor(Number(optsIn.to) || 0));
    if (!from && range) {
      const day = 24 * 60 * 60_000;
      const map = { '1d': day, '7d': 7 * day, '30d': 30 * day, '90d': 90 * day };
      if (map[range]) from = now - map[range];
    }
    if (!to) to = now;

    const limit = Math.max(1, Math.min(2000, Math.floor(Number(optsIn.limit) || 500)));
    let points = stockRepository.listHistory(scopeKey, company.id, { from, to, limit }) || [];

    // Se janela vazia mas há cotação, devolve ponto atual (gráfico não some)
    if (!points.length) {
      const q = getQuoteHydrated(scopeKey, company.id, now);
      if (q) {
        points = [
          {
            price: q.price,
            previousPrice: q.previousPrice,
            highPrice: q.highPrice,
            createdAt: Number(q.updatedAt) || now,
          },
        ];
      }
    }

    // Downsample simples se ainda passar de 400 pts (UI)
    if (points.length > 400) {
      const step = Math.ceil(points.length / 400);
      const sampled = [];
      for (let i = 0; i < points.length; i += step) sampled.push(points[i]);
      if (sampled[sampled.length - 1] !== points[points.length - 1]) {
        sampled.push(points[points.length - 1]);
      }
      points = sampled;
    }

    const prices = points.map((p) => p.price);
    const highInWindow = prices.length ? Math.max(...prices) : 0;
    const lowInWindow = prices.length ? Math.min(...prices) : 0;
    const first = prices[0] || 0;
    const last = prices[prices.length - 1] || 0;
    const changePct =
      first > 0 ? Math.round(((last - first) / first) * 1000) / 10 : 0;

    return {
      ok: true,
      scope: String(scopeKey || ''),
      companyId: company.id,
      name: company.name,
      emoji: company.emoji,
      range: range || (from ? 'custom' : 'all'),
      from: from || (points[0]?.createdAt || 0),
      to: to || now,
      points,
      stats: {
        high: highInWindow,
        low: lowInWindow,
        open: first,
        close: last,
        changePct,
        samples: points.length,
      },
      quote: getQuoteHydrated(scopeKey, company.id, now),
    };
  }

  /**
   * Texto do WhatsApp: enxuto — só preço/var/ATH + cmds + link do site.
   * Explicação de cada empresa fica no frontend da corretora.
   */
  function formatBoard(scopeKey, funConfig = {}, now = Date.now()) {
    const quotes = listQuotes(scopeKey, funConfig, now);
    const o = opts(funConfig);
    const lines = [
      '📈 *Corretora do Beco*',
      '_Preços do grupo · sem short_',
      '',
    ];
    for (const q of quotes) {
      const sign = q.deltaPct > 0 ? '+' : '';
      const div = formatYieldHint(q, q.dividendYield, q.dividendProfile);
      const ath = Math.max(1, Math.floor(Number(q.highPrice) || Number(q.price) || 1));
      const athTag = q.atHigh || q.price >= ath ? ' · *ATH*' : ` · máx *${ath}*c`;
      lines.push(
        `${q.emoji} *${q.name}* \`${q.id}\` · ${arrow(q.trend)} *${q.price}*c ${sign}${q.deltaPct}%${athTag}${div}`
      );
    }
    lines.push(
      '',
      '`/bolsa comprar bombatech 3` · `/bolsa vender pato 1` · `/carteira`',
      `_Teto *${o.maxPosition}c* · máx *${o.maxQty}*/ticker_`
    );
    const web = publicBoardUrl(scopeKey, funConfig);
    if (web) {
      lines.push(
        '',
        '🌐 *Corretora web* (só ver — sem compra no site):',
        '_gráficos, ATH, notícias e o que cada empresa faz_',
        web
      );
    }
    return lines.filter((l) => l != null).join('\n');
  }

  /**
   * Caption da imagem = mesmo texto enxuto (já cabe em ≤1024).
   */
  function formatBoardCaption(scopeKey, funConfig = {}, now = Date.now()) {
    return formatBoard(scopeKey, funConfig, now);
  }

  /**
   * Link público da corretora web por grupo.
   * Ex.: https://host/bolsa/120363...
   */
  function publicBoardUrl(scopeKey, funConfig = {}) {
    const s = String(scopeKey || '').trim();
    if (!s) return '';
    const base = getPublicBaseUrl(funConfig);
    if (!base) return '';
    const slug = s.endsWith('@g.us') ? s.slice(0, -'@g.us'.length) : s;
    return `${base.replace(/\/+$/, '')}/bolsa/${encodeURIComponent(slug)}`;
  }

  function formatPortfolio(userJid, scopeKey, funConfig = {}, now = Date.now()) {
    const o = opts(funConfig);
    const div = payDividends({ userJid, scopeKey, funConfig, now });
    const port = portfolio(userJid, scopeKey, funConfig, now);
    const lines = ['💼 *Carteira do beco*', ''];

    if (div.total > 0) {
      lines.push(`💸 Dividendos: *+${div.total}c*`);
      for (const d of div.lines) {
        const rareTag = d.rare ? ' 🦆*drop raro*' : '';
        lines.push(`   ${d.emoji} ${d.name}: +${d.amount}c${rareTag}`);
      }
      lines.push('');
    }

    if (!port.positions.length) {
      lines.push(
        'Vazio. O corretor do esquina te espera.',
        '`/bolsa` — cotações · `/bolsa comprar burgerzap 2`'
      );
      return lines.join('\n');
    }

    for (const p of port.positions) {
      const c = p.company;
      const sign = p.unrealized >= 0 ? '+' : '';
      lines.push(
        `${c?.emoji || '▪️'} *${c?.name || p.company?.id}* ×${p.qty}`,
        `   agora *${p.price}*c · médio *${p.avgCost}*c · ${sign}${p.unrealized}c`,
        `   valor *${p.value}*c`
      );
    }
    const uSign = port.unrealized >= 0 ? '+' : '';
    lines.push(
      '',
      `*Total* *${port.totalValue}*c · PnL ${uSign}${port.unrealized}c`,
      `_Espaço até teto: *${Math.max(0, o.maxPosition - port.totalValue)}c*_`,
      '',
      '`/bolsa vender bombatech 1` · `/bolsa`'
    );
    return lines.join('\n');
  }

  function formatTradeResult(result) {
    if (!result?.ok) {
      switch (result?.reason) {
        case 'disabled':
          return 'Bolsa fechada no beco agora.';
        case 'unknown-ticker':
          return `Não achei essa ação. Use \`/bolsa\` — ex.: bombatech, pato, uno.`;
        case 'min-qty':
          return `Mínimo *${result.minQty}* ação(ões).`;
        case 'cooldown':
          return `Corretor ocupado. Espera *${formatRetry(result.retryInMs)}*.`;
        case 'max-qty':
          return `Máx *${result.maxQty}* ações desse ticker (você tem *${result.holding}*).`;
        case 'max-position':
          return `Carteira lotada no beco. Teto *${result.maxPosition}c* em ações.`;
        case 'insufficient-funds':
          return `Faltam coins. Precisa *${result.cost}c* (tem *${result.coins}c*).`;
        case 'insufficient-shares':
          return `Você só tem *${result.holding}* ação(ões).`;
        default:
          return 'Não rolou a ordem. Tenta de novo.';
      }
    }
    const c = result.company;
    if (result.side === 'buy') {
      return [
        `🧾 *Ordem preenchida*`,
        `Comprou *${result.qty}* ${c.emoji} *${c.name}* a *${result.price}*c`,
        `−${result.cost}c · posição *${result.holdingQty}* · médio *${result.avgCost}*c`,
        `Saldo *${result.coins}*c`,
      ].join('\n');
    }
    const rSign = result.realizedPnl >= 0 ? '+' : '';
    return [
      `🧾 *Ordem preenchida*`,
      `Vendeu *${result.qty}* ${c.emoji} *${c.name}* a *${result.price}*c`,
      `+${result.proceeds}c · realizado ${rSign}${result.realizedPnl}c · restam *${result.holdingQty}*`,
      `Saldo *${result.coins}*c`,
    ].join('\n');
  }

  return {
    opts,
    ensureScope,
    listQuotes,
    getQuoteHydrated,
    markToMarket,
    tickQuotes,
    applyEventImpact,
    buy,
    sell,
    payDividends,
    portfolio,
    publicBoard,
    publicHistory,
    publicBoardUrl,
    formatBoard,
    formatBoardCaption,
    formatPortfolio,
    formatTradeResult,
    resolveCompanyToken,
    getDividendProfile,
    indicativeDividendYield,
    rollDividendPayout,
  };
}
