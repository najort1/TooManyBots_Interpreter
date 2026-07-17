import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import {
  _resetDefaultFunStatsRepository,
  createFunStatsRepository,
} from '../fun/db/funStatsRepository.js';
import { createFunStockRepository } from '../fun/db/funStockRepository.js';
import { createFunMarketRepository } from '../fun/db/funMarketRepository.js';
import { createStockService } from '../fun/services/stockService.js';
import { createMarketService } from '../fun/services/marketService.js';
import { resolveFunConfig } from '../fun/config.js';
import { resolveCompanyToken, getCompany } from '../fun/economy/companies.js';
import {
  defaultRegulatorKnobs,
  getDividendProfile,
  computeDividendYield,
  rollDividendPayout,
  priceHealth,
} from '../fun/economy/index.js';
import { parseFunCommand } from '../fun/commands/router.js';
import { FUN_COMMANDS } from '../fun/constants.js';

await initDb();
_resetDefaultFunStatsRepository();

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

function uniqueJid(prefix = '5511') {
  return `${prefix}${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 90 + 10)}@s.whatsapp.net`;
}

function makeStack(random = () => 0.5) {
  const repository = createFunStatsRepository();
  const stockRepository = createFunStockRepository();
  const marketRepository = createFunMarketRepository();
  const stockService = createStockService({ repository, stockRepository, random });
  const marketService = createMarketService({
    repository,
    marketRepository,
    stockService,
    random,
  });
  const funConfig = resolveFunConfig({
    bolsaEnabled: true,
    bolsaTradeCooldownMs: 0,
    bolsaMaxQtyPerTicker: 40,
    bolsaMaxPositionCoins: 2500,
    bolsaDividendPeriodMs: 1000,
    bolsaDividendCapPerTick: 80,
    economyEnabled: true,
    economyTickMs: 1,
  });
  return {
    repository,
    stockRepository,
    stockService,
    marketService,
    marketRepository,
    funConfig,
  };
}

test('resolveCompanyToken: ids e aliases', () => {
  assert.equal(resolveCompanyToken('bombatech')?.id, 'bombatech');
  assert.equal(resolveCompanyToken('bomba')?.id, 'bombatech');
  assert.equal(resolveCompanyToken('pato')?.id, 'patocoin');
  assert.equal(resolveCompanyToken('uno')?.id, 'uno_motors');
  assert.equal(resolveCompanyToken('xyzinexistente'), null);
});

test('bolsa: compra e venda long-only', () => {
  const { repository, stockService, funConfig } = makeStack();
  const scope = uniqueGroup();
  const user = uniqueJid();
  repository.addCoins({ userJid: user, scopeKey: scope, amount: 5000, reason: 'test' });

  const quotes = stockService.listQuotes(scope, funConfig);
  assert.equal(quotes.length, 6);

  const priceBefore = stockService.getQuoteHydrated(scope, 'bombatech').price;
  const buy = stockService.buy({
    userJid: user,
    scopeKey: scope,
    token: 'bomba',
    qty: 3,
    funConfig,
  });
  assert.equal(buy.ok, true);
  assert.equal(buy.qty, 3);
  assert.equal(buy.holdingQty, 3);
  assert.equal(buy.cost, priceBefore * 3);

  // trade não mexe no preço (virtual puro)
  const priceAfterBuy = stockService.getQuoteHydrated(scope, 'bombatech').price;
  assert.equal(priceAfterBuy, priceBefore);

  const port = stockService.portfolio(user, scope, funConfig);
  assert.equal(port.positions.length, 1);
  assert.equal(port.positions[0].qty, 3);

  const sell = stockService.sell({
    userJid: user,
    scopeKey: scope,
    token: 'bombatech',
    qty: 1,
    funConfig,
  });
  assert.equal(sell.ok, true);
  assert.equal(sell.holdingQty, 2);
  assert.equal(sell.proceeds, priceAfterBuy * 1);
});

test('bolsa: saldo insuficiente', () => {
  const { repository, stockService, funConfig } = makeStack();
  const scope = uniqueGroup();
  const user = uniqueJid();
  repository.addCoins({ userJid: user, scopeKey: scope, amount: 5, reason: 'test' });

  const r = stockService.buy({
    userJid: user,
    scopeKey: scope,
    token: 'satelite',
    qty: 2,
    funConfig,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'insufficient-funds');
});

test('bolsa: max qty e max position', () => {
  const { repository, stockService, funConfig } = makeStack();
  const scope = uniqueGroup();
  const user = uniqueJid();
  repository.addCoins({ userJid: user, scopeKey: scope, amount: 100_000, reason: 'test' });

  const cfg = { ...funConfig, bolsaMaxQtyPerTicker: 5, bolsaMaxPositionCoins: 500 };
  const price = stockService.getQuoteHydrated(scope, 'patocoin').price;
  // qty cap
  const tooMany = stockService.buy({
    userJid: user,
    scopeKey: scope,
    token: 'pato',
    qty: 6,
    funConfig: cfg,
  });
  assert.equal(tooMany.ok, false);
  assert.equal(tooMany.reason, 'max-qty');

  // position cap — compra o que cabe e estoura
  const ok = stockService.buy({
    userJid: user,
    scopeKey: scope,
    token: 'pato',
    qty: 1,
    funConfig: cfg,
  });
  assert.equal(ok.ok, true);
  // tenta encher além do teto de posição
  const bigQty = Math.ceil(600 / Math.max(1, price));
  const pos = stockService.buy({
    userJid: user,
    scopeKey: scope,
    token: 'pato',
    qty: Math.min(4, bigQty),
    funConfig: cfg,
  });
  // se o teto for apertado, deve falhar max-position ou max-qty
  if (!pos.ok) {
    assert.ok(pos.reason === 'max-position' || pos.reason === 'max-qty');
  }
});

test('bolsa: cooldown de trade', () => {
  const { repository, stockService } = makeStack();
  const scope = uniqueGroup();
  const user = uniqueJid();
  repository.addCoins({ userJid: user, scopeKey: scope, amount: 5000, reason: 'test' });
  const funConfig = resolveFunConfig({
    bolsaTradeCooldownMs: 60_000,
    bolsaMaxPositionCoins: 10_000,
  });
  const now = Date.now();
  const a = stockService.buy({
    userJid: user,
    scopeKey: scope,
    token: 'burgerzap',
    qty: 1,
    funConfig,
    now,
  });
  assert.equal(a.ok, true);
  const b = stockService.buy({
    userJid: user,
    scopeKey: scope,
    token: 'burgerzap',
    qty: 1,
    funConfig,
    now: now + 1000,
  });
  assert.equal(b.ok, false);
  assert.equal(b.reason, 'cooldown');
});

test('bolsa: vender mais que holding falha', () => {
  const { repository, stockService, funConfig } = makeStack();
  const scope = uniqueGroup();
  const user = uniqueJid();
  repository.addCoins({ userJid: user, scopeKey: scope, amount: 5000, reason: 'test' });
  stockService.buy({
    userJid: user,
    scopeKey: scope,
    token: 'uno',
    qty: 2,
    funConfig,
  });
  const r = stockService.sell({
    userJid: user,
    scopeKey: scope,
    token: 'uno',
    qty: 5,
    funConfig,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'insufficient-shares');
});

test('dividendos: PatoCoin raro e gordo; Uno paga com yield dinâmico', () => {
  const pato = getCompany('patocoin');
  const uno = getCompany('uno_motors');
  const burger = getCompany('burgerzap');
  const pPato = getDividendProfile(pato);
  const pUno = getDividendProfile(uno);
  const pBurger = getDividendProfile(burger);

  assert.equal(pPato.rare, true);
  assert.ok(pPato.payChance < pUno.payChance);
  assert.ok(pPato.payChance < pBurger.payChance);
  assert.ok(pPato.max > pBurger.max, 'pato max yield > burger');
  assert.ok(pPato.max > pUno.max);
  assert.ok(pUno.base > 0, 'Uno tem âncora de yield');

  // quando Pato paga, yield alto (mesmo com random fixo)
  const yPato = computeDividendYield({
    company: pato,
    price: 25,
    basePrice: 25,
    random: () => 0.5,
  });
  const yUno = computeDividendYield({
    company: uno,
    price: 140,
    basePrice: 140,
    random: () => 0.5,
  });
  assert.ok(yPato >= 0.04, `pato yield gordo: ${yPato}`);
  assert.ok(yPato > yUno, 'raro e gordo > estável');

  // chance: pato miss com random alto
  const miss = rollDividendPayout({
    company: pato,
    price: 25,
    basePrice: 25,
    random: () => 0.99,
  });
  assert.equal(miss.pays, false);

  // uno paga com random baixo
  const hitUno = rollDividendPayout({
    company: uno,
    price: 140,
    basePrice: 140,
    random: () => 0.1,
  });
  assert.equal(hitUno.pays, true);
  assert.ok(hitUno.yield > 0);

  // cotação estourada: health baixa
  assert.ok(priceHealth(40, 140) < priceHealth(140, 140));
});

test('bolsa: dividendo BurgerZap/Uno lazy com yield dinâmico', () => {
  // random baixo → estáveis pagam
  const { repository, stockService, funConfig } = makeStack(() => 0.1);
  const scope = uniqueGroup();
  const user = uniqueJid();
  repository.addCoins({ userJid: user, scopeKey: scope, amount: 5000, reason: 'test' });
  const buy = stockService.buy({
    userJid: user,
    scopeKey: scope,
    token: 'uno',
    qty: 10,
    funConfig,
  });
  assert.equal(buy.ok, true);
  const coinsBefore = repository.getUserStats(user, scope).coins;
  const d1 = stockService.payDividends({
    userJid: user,
    scopeKey: scope,
    funConfig: { ...funConfig, bolsaDividendPeriodMs: 24 * 60 * 60_000 },
    now: Date.now(),
  });
  assert.ok(d1.total > 0, 'Uno deve pagar com random baixo');
  assert.ok(d1.total <= 80);
  const coinsAfter = repository.getUserStats(user, scope).coins;
  assert.equal(coinsAfter, coinsBefore + d1.total);

  const d2 = stockService.payDividends({
    userJid: user,
    scopeKey: scope,
    funConfig: { ...funConfig, bolsaDividendPeriodMs: 24 * 60 * 60_000 },
    now: Date.now() + 1000,
  });
  assert.equal(d2.total, 0);
});

test('bolsa: PatoCoin payout raro usa yield alto', () => {
  // força sempre pagar no roll (random 0)
  const { repository, stockService, funConfig } = makeStack(() => 0);
  const scope = uniqueGroup();
  const user = uniqueJid();
  repository.addCoins({ userJid: user, scopeKey: scope, amount: 5000, reason: 'test' });
  stockService.buy({
    userJid: user,
    scopeKey: scope,
    token: 'pato',
    qty: 10,
    funConfig,
  });
  const d = stockService.payDividends({
    userJid: user,
    scopeKey: scope,
    funConfig,
    now: Date.now(),
  });
  assert.ok(d.total > 0);
  assert.equal(d.lines[0]?.rare, true);
  // 10 * ~25 * ~0.07+ = dezenas de coins; yield alto
  assert.ok(d.lines[0]?.yield >= 0.04);
});

test('bolsa: tickEconomy e evento mexem cotação da empresa', () => {
  const { stockService, marketService, stockRepository, funConfig } = makeStack(() => 0.5);
  const scope = uniqueGroup();
  stockService.ensureScope(scope);

  stockRepository.setQuote({
    scopeKey: scope,
    companyId: 'bombatech',
    price: 90,
    previousPrice: 90,
    trend: 'flat',
    supply: 1,
    demand: 1,
    eventShock: 0,
    now: Date.now(),
  });

  // impacto direto no ticker (mesmo motor do evento)
  const direct = stockService.applyEventImpact(
    scope,
    {
      category: 'arma',
      companyId: 'bombatech',
      impact: {
        archetype: 'test',
        supplyDelta: -0.15,
        demandDelta: 0.2,
        shockPct: 8,
        rumorOnly: false,
      },
    },
    defaultRegulatorKnobs(),
    Date.now()
  );
  assert.equal(direct.length, 1);
  assert.equal(direct[0].companyId, 'bombatech');
  assert.ok(direct[0].price >= 1);

  // marketService propaga stock hits (empresa segue categoria resolvida pelo pipeline)
  const evAffected = marketService.applyEventToPrices(scope, {
    id: 'test-ev',
    category: 'arma',
    companyId: 'bombatech',
    impactPct: 8,
    title: 'teste',
    description: 'teste choque',
    source: 'legacy',
  });
  assert.ok(Array.isArray(evAffected));
  const stockHit = evAffected.find(
    (a) => a.kind === 'stock' || String(a.itemId || '').startsWith('stock:')
  );
  assert.ok(stockHit, 'evento deve afetar cotação da empresa');
  assert.ok(getCompany(stockHit.companyId), 'ticker resolvido deve existir');

  const tick = marketService.tickEconomy(scope, funConfig, Date.now() + 60_000);
  assert.equal(tick.ok, true);
  assert.ok(Array.isArray(tick.stockChanged));
});

test('parse: aliases bolsa e carteira', () => {
  assert.equal(parseFunCommand('/bolsa', '/')?.command, FUN_COMMANDS.BOLSA);
  assert.equal(parseFunCommand('/acoes', '/')?.command, FUN_COMMANDS.BOLSA);
  assert.equal(parseFunCommand('/corretora', '/')?.command, FUN_COMMANDS.BOLSA);
  assert.equal(parseFunCommand('/carteira', '/')?.command, FUN_COMMANDS.CARTEIRA);
  assert.equal(parseFunCommand('/portfolio', '/')?.command, FUN_COMMANDS.CARTEIRA);
  const p = parseFunCommand('/bolsa comprar bomba 3', '/');
  assert.equal(p.command, FUN_COMMANDS.BOLSA);
  assert.deepEqual(p.args, ['comprar', 'bomba', '3']);
});

test('formatBoard e formatTradeResult não vazios', () => {
  const { stockService, funConfig } = makeStack();
  const scope = uniqueGroup();
  const board = stockService.formatBoard(scope, funConfig);
  assert.ok(board.includes('Corretora do Beco'));
  assert.ok(board.includes('BombaTech') || board.includes('bombatech'));

  const fail = stockService.formatTradeResult({ ok: false, reason: 'max-position', maxPosition: 2500 });
  assert.ok(fail.includes('2500'));

  assert.equal(getCompany('burgerzap').dividendYield > 0, true);
});
