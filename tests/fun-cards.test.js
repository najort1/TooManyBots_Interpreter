import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import {
  _resetDefaultFunStatsRepository,
  createFunStatsRepository,
} from '../fun/db/funStatsRepository.js';
import { createFunActionRepository } from '../fun/db/funActionRepository.js';
import { createFunCardRepository } from '../fun/db/funCardRepository.js';
import { createCardService } from '../fun/services/cardService.js';
import {
  parseCardFilename,
  loadCardCatalog,
  rollRandomCard,
  _resetCardCatalogCache,
  PACK_COST,
  TIER_DROP_WEIGHTS,
} from '../fun/shop/cards.js';
import { ACTION_TYPE } from '../fun/constants.js';
import {
  renderCollectibleCardPng,
  renderCollectibleCardGridPng,
} from '../fun/formatters/rankCardImage.js';
import { MAX_PACKS_PER_OPEN } from '../fun/shop/cards.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CARDS_DIR = path.resolve(__dirname, '../fun/assets/cards');

await initDb();
_resetDefaultFunStatsRepository();
_resetCardCatalogCache();

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

function uniqueJid(prefix = '5511') {
  return `${prefix}${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 90 + 10)}@s.whatsapp.net`;
}

function setup(random = Math.random) {
  const repository = createFunStatsRepository({ getDatabase: getDb });
  repository.ensureFunSchema();
  const cardRepository = createFunCardRepository({ getDatabase: getDb });
  const actionRepository = createFunActionRepository({ getDatabase: getDb });
  const cardService = createCardService({
    repository,
    cardRepository,
    actionRepository,
    random,
  });
  return { repository, cardRepository, actionRepository, cardService };
}

test('cards: parse filename extrai espécie, variante e tier', () => {
  const a = parseCardFilename('CACHORRO AQUATICO TIER 2.jpg');
  assert.ok(a);
  assert.equal(a.species, 'CACHORRO');
  assert.equal(a.variant, 'AQUATICO');
  assert.equal(a.tier, 2);
  assert.equal(a.displayName, 'CACHORRO AQUATICO');
  assert.ok(a.key.includes('aquatico'));

  const b = parseCardFilename('CACHORRO CHUPETAO TIER 5.png');
  assert.equal(b?.tier, 5);
  assert.equal(b?.variant, 'CHUPETAO');

  assert.equal(parseCardFilename('CACHORRO INSHOCK TIER .jpg'), null);
  assert.equal(parseCardFilename('readme.txt'), null);
});

test('cards: catálogo carrega assets e sorteio respeita tiers', () => {
  _resetCardCatalogCache();
  const catalog = loadCardCatalog({ dir: CARDS_DIR, force: true });
  assert.ok(catalog.length >= 200, `catálogo pequeno: ${catalog.length}`);
  assert.ok(catalog.every((c) => c.tier >= 1 && c.tier <= 5));
  assert.ok(catalog.some((c) => c.tier === 1));

  // random fixo: deve retornar carta
  let i = 0;
  const seq = [0.01, 0.5, 0.99, 0.2, 0.8];
  const rnd = () => seq[i++ % seq.length];
  for (let n = 0; n < 20; n++) {
    const card = rollRandomCard(rnd);
    assert.ok(card);
    assert.ok(TIER_DROP_WEIGHTS[card.tier] > 0);
  }
});

test('cards: abrir pack debita coins e persiste carta', () => {
  const { repository, cardService } = setup(() => 0.1);
  const scope = uniqueGroup();
  const user = uniqueJid();
  const cfg = { cardsEnabled: true, cardPackCost: PACK_COST };

  repository.addCoins({ userJid: user, scopeKey: scope, amount: 100, reason: 'seed' });

  const fail = cardService.openPacks({
    userJid: user,
    scopeKey: scope,
    quantity: 4, // 4×30 = 120 > 100 coins
    funConfig: cfg,
  });
  assert.equal(fail.ok, false);
  assert.equal(fail.reason, 'no-coins');

  const open = cardService.openPacks({
    userJid: user,
    scopeKey: scope,
    quantity: 2,
    funConfig: cfg,
  });
  assert.equal(open.ok, true);
  assert.equal(open.cards.length, 2);
  assert.equal(open.cost, PACK_COST * 2);
  assert.equal(open.coins, 100 - PACK_COST * 2);

  const inv = cardService.listInventory(user, scope);
  assert.equal(inv.length, 2);
  assert.ok(inv[0].id);
  assert.ok(inv[0].cardName || inv[0].displayName);
  assert.equal(inv[0].boughtPrice, PACK_COST);
});

test('cards: favoritar e recuperar no perfil', () => {
  const { repository, cardService } = setup(() => 0.2);
  const scope = uniqueGroup();
  const user = uniqueJid();
  repository.addCoins({ userJid: user, scopeKey: scope, amount: 200, reason: 'seed' });
  const open = cardService.openPacks({
    userJid: user,
    scopeKey: scope,
    quantity: 1,
    funConfig: { cardPackCost: 30 },
  });
  assert.equal(open.ok, true);
  const cardId = open.cards[0].id;

  const fav = cardService.setFavorite({ userJid: user, scopeKey: scope, cardId });
  assert.equal(fav.ok, true);
  assert.equal(fav.card.id, cardId);

  const got = cardService.getFavorite(user, scope);
  assert.ok(got);
  assert.equal(got.id, cardId);
  assert.equal(got.favorite, true);

  // prefix id
  const short = cardService.setFavorite({
    userJid: user,
    scopeKey: scope,
    cardId: cardId.slice(0, 8),
  });
  assert.equal(short.ok, true);
});

test('cards: troca atômica A↔B', () => {
  const { repository, cardService } = setup(() => 0.15);
  const scope = uniqueGroup();
  const a = uniqueJid('5511');
  const b = uniqueJid('5512');
  repository.addCoins({ userJid: a, scopeKey: scope, amount: 200, reason: 'seed' });
  repository.addCoins({ userJid: b, scopeKey: scope, amount: 200, reason: 'seed' });

  const openA = cardService.openPacks({
    userJid: a,
    scopeKey: scope,
    quantity: 1,
    funConfig: {},
  });
  const openB = cardService.openPacks({
    userJid: b,
    scopeKey: scope,
    quantity: 1,
    funConfig: {},
  });
  assert.equal(openA.ok, true);
  assert.equal(openB.ok, true);
  const cardA = openA.cards[0];
  const cardB = openB.cards[0];

  const prop = cardService.proposeTrade({
    userJid: a,
    scopeKey: scope,
    cardId: cardA.id,
    targetJid: b,
    funConfig: {},
  });
  assert.equal(prop.ok, true);
  assert.equal(prop.action.actionType, ACTION_TYPE.CARD_TRADE);

  const pending = cardService.peekTrade(b, scope);
  assert.ok(pending);
  assert.equal(pending.fromJid, a);

  const done = cardService.completeTrade({
    userJid: b,
    scopeKey: scope,
    cardId: cardB.id,
    funConfig: {},
  });
  assert.equal(done.ok, true);
  assert.equal(done.cardReceived.id, cardA.id);
  assert.equal(done.cardGiven.id, cardB.id);

  const invA = cardService.listInventory(a, scope);
  const invB = cardService.listInventory(b, scope);
  assert.ok(invA.some((c) => c.id === cardB.id));
  assert.ok(invB.some((c) => c.id === cardA.id));
  assert.ok(!invA.some((c) => c.id === cardA.id));
  assert.ok(!invB.some((c) => c.id === cardB.id));
});

test('cards: bazar listar e comprar com coins', () => {
  const { repository, cardService } = setup(() => 0.3);
  const scope = uniqueGroup();
  const seller = uniqueJid('5513');
  const buyer = uniqueJid('5514');
  repository.addCoins({ userJid: seller, scopeKey: scope, amount: 100, reason: 'seed' });
  repository.addCoins({ userJid: buyer, scopeKey: scope, amount: 500, reason: 'seed' });

  const open = cardService.openPacks({
    userJid: seller,
    scopeKey: scope,
    quantity: 1,
    funConfig: {},
  });
  const card = open.cards[0];

  const list = cardService.listOnBazaar({
    userJid: seller,
    scopeKey: scope,
    cardId: card.id,
    price: 75,
  });
  assert.equal(list.ok, true);
  assert.equal(list.listing.price, 75);

  const openList = cardService.listOpenCardListings(scope);
  assert.ok(openList.some((l) => l.id === list.listing.id));

  const buy = cardService.buyFromBazaar({
    userJid: buyer,
    scopeKey: scope,
    listingId: list.listing.id,
  });
  assert.equal(buy.ok, true);
  assert.equal(buy.price, 75);
  assert.equal(buy.card.userJid, buyer);

  const invBuyer = cardService.listInventory(buyer, scope);
  assert.ok(invBuyer.some((c) => c.id === card.id));
  const invSeller = cardService.listInventory(seller, scope);
  assert.ok(!invSeller.some((c) => c.id === card.id));

  const sellerCoins = repository.getUserStats(seller, scope).coins;
  // 100 - 30 (pack) + 75 (venda) = 145
  assert.equal(sellerCoins, 145);
});

test('cards: renderCollectibleCardPng gera PNG', async () => {
  const catalog = loadCardCatalog({ force: true });
  assert.ok(catalog.length > 0);
  const sample = catalog.find((c) => c.tier === 1) || catalog[0];
  const buf = await renderCollectibleCardPng({
    imagePath: sample.imagePath,
    displayName: sample.displayName,
    tier: sample.tier,
    favorite: true,
  });
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 500);
  assert.equal(buf[0], 137);
  assert.equal(buf[1], 80);
});

test('cards: máx 4 packs e grid 2–4 cartas', async () => {
  assert.equal(MAX_PACKS_PER_OPEN, 4);
  const { repository, cardService } = setup(() => 0.25);
  const scope = uniqueGroup();
  const user = uniqueJid('5517');
  repository.addCoins({ userJid: user, scopeKey: scope, amount: 500, reason: 'seed' });

  const tooMany = cardService.openPacks({
    userJid: user,
    scopeKey: scope,
    quantity: 5,
    funConfig: {},
  });
  assert.equal(tooMany.ok, false);
  assert.equal(tooMany.reason, 'max-packs');
  assert.equal(tooMany.max, 4);

  const open4 = cardService.openPacks({
    userJid: user,
    scopeKey: scope,
    quantity: 4,
    funConfig: {},
  });
  assert.equal(open4.ok, true);
  assert.equal(open4.cards.length, 4);

  const catalog = loadCardCatalog({ force: true });
  const sample = catalog.slice(0, 4).map((c) => ({
    imagePath: c.imagePath,
    displayName: c.displayName,
    tier: c.tier,
  }));
  const grid2 = await renderCollectibleCardGridPng({ cards: sample.slice(0, 2) });
  const grid3 = await renderCollectibleCardGridPng({ cards: sample.slice(0, 3) });
  const grid4 = await renderCollectibleCardGridPng({ cards: sample });
  for (const buf of [grid2, grid3, grid4]) {
    assert.ok(Buffer.isBuffer(buf));
    assert.ok(buf.length > 800);
    assert.equal(buf[0], 137);
  }
});

test('cards: recusar troca limpa pending', () => {
  const { repository, cardService } = setup(() => 0.4);
  const scope = uniqueGroup();
  const a = uniqueJid('5515');
  const b = uniqueJid('5516');
  repository.addCoins({ userJid: a, scopeKey: scope, amount: 100, reason: 'seed' });
  const open = cardService.openPacks({
    userJid: a,
    scopeKey: scope,
    quantity: 1,
    funConfig: {},
  });
  cardService.proposeTrade({
    userJid: a,
    scopeKey: scope,
    cardId: open.cards[0].id,
    targetJid: b,
  });
  assert.ok(cardService.peekTrade(b, scope));
  const dec = cardService.declineTrade({ userJid: b, scopeKey: scope });
  assert.equal(dec.ok, true);
  assert.equal(cardService.peekTrade(b, scope), null);
});
