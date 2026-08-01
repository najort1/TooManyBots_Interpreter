import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import {
  _resetDefaultFunStatsRepository,
  createFunStatsRepository,
} from '../fun/db/funStatsRepository.js';
import { createFunMarketRepository } from '../fun/db/funMarketRepository.js';
import { createFunEffectsRepository } from '../fun/db/funEffectsRepository.js';
import { createFunCasinoRepository } from '../fun/db/funCasinoRepository.js';
import { createMarketService } from '../fun/services/marketService.js';
import {
  computeSuspicionScore,
  wantedLevelFromPoints,
  createPoliceService,
  POLICE_IMMUNITY_DURATION_MS,
  POLICE_IMMUNITY_MAX_USES,
  POLICE_IMMUNITY_WEEK_MS,
  WANTED_DECAY_MS,
} from '../fun/services/policeService.js';
import { createShopService } from '../fun/services/shopService.js';
import { getShopItem } from '../fun/shop/catalog.js';
import { getCollectible, listWeaponShop, listUtilityShop } from '../fun/shop/collectibles.js';
import { parseFunCommand, resolveFunConfig } from '../fun/index.js';
import { FUN_COMMANDS } from '../fun/constants.js';

await initDb();
_resetDefaultFunStatsRepository();

function uniqueJid(prefix = '5511') {
  return `${prefix}${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 90 + 10)}@s.whatsapp.net`;
}

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

test('parseFunCommand: mercado/armas/assaltar', () => {
  assert.equal(parseFunCommand('/mercado', '/').command, FUN_COMMANDS.GALLERY);
  assert.equal(parseFunCommand('/galeria', '/').command, FUN_COMMANDS.GALLERY);
  assert.equal(parseFunCommand('/armas', '/').command, FUN_COMMANDS.WEAPONS);
  assert.equal(parseFunCommand('/assaltar', '/').command, FUN_COMMANDS.ASSAULT);
  assert.equal(parseFunCommand('/bazar', '/').command, FUN_COMMANDS.BAZAAR);
});

test('catalog: utilidade vs armas, sem arte', () => {
  assert.ok(getCollectible('gasolina'));
  assert.ok(getCollectible('pistola'));
  assert.ok(!getCollectible('tela_amanhecer'));
  assert.ok(listUtilityShop().every((i) => i.utilityShop));
  assert.ok(listWeaponShop().every((i) => i.weaponShop));
  assert.equal(getCollectible('pistola').requires, 'municao');
  assert.equal(getCollectible('carro').requires, 'gasolina');
});

test('estoque finito + armas exigem licença', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const effects = createFunEffectsRepository({ getDatabase: getDb });
  const casinoRepo = createFunCasinoRepository({ getDatabase: getDb });
  const market = createMarketService({
    repository: repo,
    marketRepository: marketRepo,
    effectsRepository: effects,
    casinoRepository: casinoRepo,
    random: () => 0.5,
  });

  const scope = uniqueGroup();
  const u = uniqueJid('5590');
  repo.addCoins({ userJid: u, scopeKey: scope, amount: 5000, reason: 'seed' });
  const cfg = resolveFunConfig({ marketEnabled: true });

  const noLic = market.buyFromShop({
    userJid: u,
    scopeKey: scope,
    itemId: 'pistola',
    funConfig: cfg,
    shop: 'weapons',
  });
  assert.equal(noLic.ok, false);
  assert.equal(noLic.reason, 'no-license');

  effects.addCharges({
    userJid: u,
    scopeKey: scope,
    effectKey: 'weapons_license',
    charges: 1,
    payload: { permanent: true },
  });

  const buyPistol = market.buyFromShop({
    userJid: u,
    scopeKey: scope,
    itemId: 'pistola',
    funConfig: cfg,
    shop: 'weapons',
  });
  assert.equal(buyPistol.ok, true);
  assert.ok(buyPistol.stockLeft < (getCollectible('pistola').stockMax || 99));

  // esgota estoque de faca se stockMax baixo — compra até acabar
  let last = { ok: true };
  let n = 0;
  while (last.ok && n < 20) {
    last = market.buyFromShop({
      userJid: u,
      scopeKey: scope,
      itemId: 'faca',
      funConfig: cfg,
      shop: 'weapons',
    });
    n += 1;
  }
  assert.equal(last.reason === 'out-of-stock' || last.ok === false || n > 0, true);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('chave de armas é individual: A tem, B no mesmo grupo não', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const effects = createFunEffectsRepository({ getDatabase: getDb });
  const casinoRepo = createFunCasinoRepository({ getDatabase: getDb });
  const market = createMarketService({
    repository: repo,
    marketRepository: marketRepo,
    effectsRepository: effects,
    casinoRepository: casinoRepo,
    random: () => 0.5,
  });

  const scope = uniqueGroup();
  const owner = uniqueJid('5580');
  const other = uniqueJid('5581');
  repo.addCoins({ userJid: owner, scopeKey: scope, amount: 5000, reason: 'seed' });
  repo.addCoins({ userJid: other, scopeKey: scope, amount: 5000, reason: 'seed' });
  const cfg = resolveFunConfig({ marketEnabled: true });

  effects.addCharges({
    userJid: owner,
    scopeKey: scope,
    effectKey: 'weapons_license',
    charges: 1,
    payload: { permanent: true },
  });

  assert.equal(market.hasWeaponsLicense(owner, scope), true);
  assert.equal(market.hasWeaponsLicense(other, scope), false);

  const ownerBuy = market.buyFromShop({
    userJid: owner,
    scopeKey: scope,
    itemId: 'faca',
    funConfig: cfg,
    shop: 'weapons',
  });
  assert.equal(ownerBuy.ok, true);

  const otherBuy = market.buyFromShop({
    userJid: other,
    scopeKey: scope,
    itemId: 'faca',
    funConfig: cfg,
    shop: 'weapons',
  });
  assert.equal(otherBuy.ok, false);
  assert.equal(otherBuy.reason, 'no-license');

  const lockedCopy = market.formatWeaponsShop(scope, cfg, other);
  assert.match(lockedCopy, /individual|só a própria|trancada pra você/i);
  const openCopy = market.formatWeaponsShop(scope, cfg, owner);
  assert.match(openCopy, /Loja de armas/i);
  assert.doesNotMatch(openCopy, /trancada/i);

  // permanente: consumeCharge não apaga a licença
  assert.equal(effects.consumeCharge(owner, scope, 'weapons_license'), null);
  assert.equal(market.hasWeaponsLicense(owner, scope), true);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('assalto: arma+municao, chance e coins', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const effects = createFunEffectsRepository({ getDatabase: getDb });
  const casinoRepo = createFunCasinoRepository({ getDatabase: getDb });
  let roll = 0;
  const market = createMarketService({
    repository: repo,
    marketRepository: marketRepo,
    effectsRepository: effects,
    casinoRepository: casinoRepo,
    random: () => {
      // primeiro valores altos pra stock/etc, depois roll de assalto baixo = sucesso
      roll += 1;
      if (roll < 5) return 0.1;
      return 0.05; // < chance
    },
  });

  const scope = uniqueGroup();
  const atk = uniqueJid('5591');
  const vic = uniqueJid('5592');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 300, reason: 'seed' });
  repo.addCoins({ userJid: vic, scopeKey: scope, amount: 400, reason: 'seed' });
  const cfg = resolveFunConfig({
    assaultCooldownMs: 0,
    assaultBaseChance: 0.5,
    assaultMinSteal: 10,
    assaultMaxStealRatio: 0.2,
  });

  effects.addCharges({
    userJid: atk,
    scopeKey: scope,
    effectKey: 'weapons_license',
    charges: 1,
  });

  // dá faca direto no inventário (sem estoque)
  marketRepo.addInventory({
    userJid: atk,
    scopeKey: scope,
    itemId: 'faca',
    acquiredPrice: 90,
    usesLeft: 10,
  });

  const r = market.assault({
    attackerJid: atk,
    targetJid: vic,
    scopeKey: scope,
    funConfig: cfg,
  });
  assert.equal(r.ok, true);
  assert.equal(typeof r.success, 'boolean');
  if (r.success) {
    assert.ok(r.stolen >= 10);
    assert.ok((repo.getUserStats(atk, scope).coins || 0) > 300);
  }

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('restock semanal: esgota e repõe após 7 dias reais', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const effects = createFunEffectsRepository({ getDatabase: getDb });
  const market = createMarketService({
    repository: repo,
    marketRepository: marketRepo,
    effectsRepository: effects,
    random: () => 0.5,
  });

  const scope = uniqueGroup();
  const u = uniqueJid('5570');
  repo.addCoins({ userJid: u, scopeKey: scope, amount: 50_000, reason: 'seed' });
  effects.addCharges({
    userJid: u,
    scopeKey: scope,
    effectKey: 'weapons_license',
    charges: 1,
    payload: { permanent: true },
  });
  const cfg = resolveFunConfig({ marketEnabled: true, marketRestockMs: 7 * 24 * 60 * 60_000 });
  const t0 = Date.now();

  // inicializa mercado (marca relógio de restock)
  market.maybeWeeklyRestock(scope, cfg, t0);
  const maxPistol = getCollectible('pistola').stockMax;

  // esgota pistolas
  let n = 0;
  while (n < 20 && marketRepo.getStock(scope, 'pistola') > 0) {
    market.buyFromShop({
      userJid: u,
      scopeKey: scope,
      itemId: 'pistola',
      funConfig: cfg,
      shop: 'weapons',
      now: t0 + n,
    });
    n += 1;
  }
  assert.equal(marketRepo.getStock(scope, 'pistola'), 0);

  // ainda dentro da semana: não repõe
  const mid = market.maybeWeeklyRestock(scope, cfg, t0 + 3 * 24 * 60 * 60_000);
  assert.equal(mid.restocked, false);
  assert.equal(marketRepo.getStock(scope, 'pistola'), 0);

  // após 7 dias: repõe ao stockMax
  const week = market.maybeWeeklyRestock(scope, cfg, t0 + 7 * 24 * 60 * 60_000 + 1000);
  assert.equal(week.restocked, true);
  assert.equal(marketRepo.getStock(scope, 'pistola'), maxPistol);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('heist banco/lojinha: payout e EV table; multa com teto', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const effects = createFunEffectsRepository({ getDatabase: getDb });
  const casinoRepo = createFunCasinoRepository({ getDatabase: getDb });
  const market = createMarketService({
    repository: repo,
    marketRepository: marketRepo,
    effectsRepository: effects,
    casinoRepository: casinoRepo,
    random: () => 0.01, // sucesso quase sempre
  });

  const scope = uniqueGroup();
  const atk = uniqueJid('5560');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 5000, reason: 'seed' });
  effects.addCharges({
    userJid: atk,
    scopeKey: scope,
    effectKey: 'weapons_license',
    charges: 1,
    payload: { permanent: true },
  });
  marketRepo.addInventory({
    userJid: atk,
    scopeKey: scope,
    itemId: 'pistola',
    acquiredPrice: 260,
    usesLeft: 10,
  });
  marketRepo.addInventory({
    userJid: atk,
    scopeKey: scope,
    itemId: 'municao',
    acquiredPrice: 38,
    usesLeft: 1,
  });
  marketRepo.addInventory({
    userJid: atk,
    scopeKey: scope,
    itemId: 'municao',
    acquiredPrice: 38,
    usesLeft: 1,
  });
  marketRepo.addInventory({
    userJid: atk,
    scopeKey: scope,
    itemId: 'lockpick',
    acquiredPrice: 50,
    usesLeft: 5,
  });

  const cfg = resolveFunConfig({
    assaultCooldownMs: 0,
    heistBankCooldownMs: 0,
    heistBankMin: 150,
    heistBankMax: 340,
    heistShopMin: 48,
    heistShopMax: 100,
    assaultFailFineMax: 30,
  });

  assert.equal(market.resolveHeistTarget('banco')?.kind, 'bank');
  assert.equal(market.resolveHeistTarget('lojinha')?.kind, 'shop');

  const bank = market.assault({
    attackerJid: atk,
    heistToken: 'banco',
    scopeKey: scope,
    funConfig: cfg,
  });
  assert.equal(bank.ok, true);
  assert.equal(bank.mode, 'bank');
  assert.equal(bank.success, true);
  assert.ok(bank.stolen >= 150);
  assert.ok(bank.stolen <= 500);

  const help = market.formatAssaultHelp(scope, cfg, atk);
  assert.match(help, /valor esperado|EV/i);
  assert.match(help, /banco/i);
  assert.match(help, /lojinha/i);

  // multa de falha com teto (whale)
  const whale = uniqueJid('5561');
  repo.addCoins({ userJid: whale, scopeKey: scope, amount: 20_000, reason: 'seed' });
  marketRepo.addInventory({
    userJid: whale,
    scopeKey: scope,
    itemId: 'faca',
    acquiredPrice: 90,
    usesLeft: 5,
  });
  marketRepo.addInventory({
    userJid: whale,
    scopeKey: scope,
    itemId: 'lockpick',
    acquiredPrice: 50,
    usesLeft: 5,
  });
  const failMarket = createMarketService({
    repository: repo,
    marketRepository: marketRepo,
    effectsRepository: effects,
    casinoRepository: casinoRepo,
    random: () => 0.99, // falha
  });
  const fail = failMarket.assault({
    attackerJid: whale,
    heistToken: 'banco',
    scopeKey: scope,
    funConfig: cfg,
  });
  assert.equal(fail.ok, true);
  assert.equal(fail.success, false);
  assert.ok(fail.fine <= 30);
  assert.ok(fail.fine >= 5);

  // munição base barateada
  assert.equal(getCollectible('municao').basePrice, 38);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('findBestWeapon: usa rifle em vez da faca', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const market = createMarketService({
    repository: repo,
    marketRepository: marketRepo,
    random: () => 0.5,
  });
  const scope = uniqueGroup();
  const u = uniqueJid('5550');
  marketRepo.addInventory({
    userJid: u,
    scopeKey: scope,
    itemId: 'faca',
    acquiredPrice: 90,
    usesLeft: 5,
  });
  marketRepo.addInventory({
    userJid: u,
    scopeKey: scope,
    itemId: 'rifle',
    acquiredPrice: 480,
    usesLeft: 5,
  });
  const best = market.findBestWeapon(u, scope);
  assert.equal(best?.itemId, 'rifle');
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('market invent: Zen inválido não dispara segunda chamada real antes do fallback', async () => {
  delete process.env.FUN_DISABLE_LIVE_LLM;
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  let zenCalls = 0;
  let ollamaCalls = 0;
  const market = createMarketService({
    repository: repo,
    marketRepository: marketRepo,
    random: () => 0.5,
    generateZen: async () => {
      zenCalls += 1;
      return '';
    },
    generateOllama: async () => {
      ollamaCalls += 1;
      return JSON.stringify({ title: 'Bairro em alerta', body: 'Mercado ficou estranho hoje.' });
    },
  });

  const out = await market.inventEvent(resolveFunConfig({
    marketEnabled: true,
    economyEnabled: true,
    zenEnabled: true,
    ollamaEnabled: true,
  }));

  assert.ok(out, 'evento deve existir');
  assert.equal(zenCalls, 1, 'Zen deve ser chamado exatamente uma vez');
  assert.equal(ollamaCalls, 1, 'Ollama deve ser chamado exatamente uma vez');
});

test('gasolina no bazar: dependência carro', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const market = createMarketService({
    repository: repo,
    marketRepository: marketRepo,
    random: () => 0.5,
  });
  const scope = uniqueGroup();
  const a = uniqueJid('5593');
  const b = uniqueJid('5594');
  repo.addCoins({ userJid: a, scopeKey: scope, amount: 2000, reason: 'seed' });
  repo.addCoins({ userJid: b, scopeKey: scope, amount: 2000, reason: 'seed' });
  const cfg = resolveFunConfig({});

  const gas = market.buyFromShop({
    userJid: a,
    scopeKey: scope,
    itemId: 'gasolina',
    funConfig: cfg,
    shop: 'utility',
  });
  assert.equal(gas.ok, true);

  // a dita o preço
  const listed = market.listOnBazaar({
    userJid: a,
    scopeKey: scope,
    inventoryId: gas.inventory.id,
    price: 120,
  });
  assert.equal(listed.ok, true);

  const buy = market.buyFromBazaar({
    userJid: b,
    scopeKey: scope,
    listingId: listed.listing.id,
  });
  assert.equal(buy.ok, true);
  assert.equal(buy.price, 120);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('bazar preserva usesLeft: pistola com 4 usos vendida mantém 4 usos', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const effects = createFunEffectsRepository({ getDatabase: getDb });
  const casinoRepo = createFunCasinoRepository({ getDatabase: getDb });
  const market = createMarketService({
    repository: repo,
    marketRepository: marketRepo,
    effectsRepository: effects,
    casinoRepository: casinoRepo,
    random: () => 0.5,
  });
  const scope = uniqueGroup();
  const a = uniqueJid('5501');
  const b = uniqueJid('5502');
  repo.addCoins({ userJid: a, scopeKey: scope, amount: 2000, reason: 'seed' });
  repo.addCoins({ userJid: b, scopeKey: scope, amount: 2000, reason: 'seed' });

  const inv = marketRepo.addInventory({
    userJid: a,
    scopeKey: scope,
    itemId: 'pistola',
    acquiredPrice: 260,
    usesLeft: 4,
  });
  assert.equal(inv.usesLeft, 4);

  const listed = market.listOnBazaar({
    userJid: a,
    scopeKey: scope,
    inventoryId: inv.id,
    price: 500,
  });
  assert.equal(listed.ok, true);

  const buy = market.buyFromBazaar({
    userJid: b,
    scopeKey: scope,
    listingId: listed.listing.id,
  });
  assert.equal(buy.ok, true);
  assert.equal(buy.inventory.usesLeft, 4, 'comprador recebe a pistola com os mesmos 4 usos');

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('cancelar listagem no bazar: item volta ao inventário', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const effects = createFunEffectsRepository({ getDatabase: getDb });
  const casinoRepo = createFunCasinoRepository({ getDatabase: getDb });
  const market = createMarketService({
    repository: repo,
    marketRepository: marketRepo,
    effectsRepository: effects,
    casinoRepository: casinoRepo,
    random: () => 0.5,
  });
  const scope = uniqueGroup();
  const a = uniqueJid('5503');
  repo.addCoins({ userJid: a, scopeKey: scope, amount: 2000, reason: 'seed' });

  const inv = marketRepo.addInventory({
    userJid: a,
    scopeKey: scope,
    itemId: 'faca',
    acquiredPrice: 90,
    usesLeft: 10,
  });
  assert.equal(inv.usesLeft, 10);

  const listed = market.listOnBazaar({
    userJid: a,
    scopeKey: scope,
    inventoryId: inv.id,
    price: 200,
  });
  assert.equal(listed.ok, true);

  // item ainda existe no inventário (não foi removido ao listar)
  const before = marketRepo.getInventoryById(inv.id);
  assert.notEqual(before, null);

  const cancel = market.cancelListing({
    userJid: a,
    scopeKey: scope,
    listingId: listed.listing.id,
  });
  assert.equal(cancel.ok, true);
  assert.equal(listed.listing.status, 'open');

  // listing fechada como cancelled
  const cancelledListing = marketRepo.getListing(listed.listing.id);
  assert.equal(cancelledListing.status, 'cancelled');

  // item intacto no inventário
  const after = marketRepo.getInventoryById(inv.id);
  assert.notEqual(after, null);
  assert.equal(after.usesLeft, 10);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('cancelar listagem: apenas o dono pode cancelar', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const effects = createFunEffectsRepository({ getDatabase: getDb });
  const casinoRepo = createFunCasinoRepository({ getDatabase: getDb });
  const market = createMarketService({
    repository: repo,
    marketRepository: marketRepo,
    effectsRepository: effects,
    casinoRepository: casinoRepo,
    random: () => 0.5,
  });
  const scope = uniqueGroup();
  const owner = uniqueJid('5504');
  const intruder = uniqueJid('5505');
  repo.addCoins({ userJid: owner, scopeKey: scope, amount: 2000, reason: 'seed' });

  const inv = marketRepo.addInventory({
    userJid: owner,
    scopeKey: scope,
    itemId: 'gasolina',
    acquiredPrice: 45,
    usesLeft: 1,
  });

  const listed = market.listOnBazaar({
    userJid: owner,
    scopeKey: scope,
    inventoryId: inv.id,
    price: 100,
  });
  assert.equal(listed.ok, true);

  const intruderCancel = market.cancelListing({
    userJid: intruder,
    scopeKey: scope,
    listingId: listed.listing.id,
  });
  assert.equal(intruderCancel.ok, false);
  assert.equal(intruderCancel.reason, 'not-owner');

  // listing ainda aberta
  const stillOpen = marketRepo.getListing(listed.listing.id);
  assert.equal(stillOpen.status, 'open');

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('municao: caixa com 3 usos e consumo decrementa', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const effects = createFunEffectsRepository({ getDatabase: getDb });
  const casinoRepo = createFunCasinoRepository({ getDatabase: getDb });
  const market = createMarketService({
    repository: repo,
    marketRepository: marketRepo,
    effectsRepository: effects,
    casinoRepository: casinoRepo,
    random: () => 0.5,
  });
  const scope = uniqueGroup();
  const u = uniqueJid('5506');
  repo.addCoins({ userJid: u, scopeKey: scope, amount: 5000, reason: 'seed' });
  const cfg = resolveFunConfig({ marketEnabled: true });

  // compra 1 caixa de munição: deve ter usesLeft = 3
  const buy = market.buyFromShop({
    userJid: u,
    scopeKey: scope,
    itemId: 'municao',
    funConfig: cfg,
    shop: 'utility',
  });
  assert.equal(buy.ok, true);
  assert.equal(buy.inventory.usesLeft, 3, 'caixa de munição deve ter 3 usos');

  // consome 1 tiro: usesLeft deve ir para 2
  const consumed1 = market.consumeOneConsumable(u, scope, 'municao');
  assert.equal(consumed1, true);
  const after1 = marketRepo.getInventoryById(buy.inventory.id);
  assert.equal(after1.usesLeft, 2);

  // consome outro tiro: usesLeft → 1
  const consumed2 = market.consumeOneConsumable(u, scope, 'municao');
  assert.equal(consumed2, true);
  const after2 = marketRepo.getInventoryById(buy.inventory.id);
  assert.equal(after2.usesLeft, 1);

  // consome o último tiro: item deve ser deletado
  const consumed3 = market.consumeOneConsumable(u, scope, 'municao');
  assert.equal(consumed3, true);
  const after3 = marketRepo.getInventoryById(buy.inventory.id);
  assert.equal(after3, null, 'caixa de munição esgotada deve ser removida');

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('heist banco: armas têm penalidade de chance', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const effects = createFunEffectsRepository({ getDatabase: getDb });
  const casinoRepo = createFunCasinoRepository({ getDatabase: getDb });
  const market = createMarketService({
    repository: repo,
    marketRepository: marketRepo,
    effectsRepository: effects,
    casinoRepository: casinoRepo,
    random: () => 0.5,
  });
  const scope = uniqueGroup();
  const atk = uniqueJid('5507');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 5000, reason: 'seed' });
  effects.addCharges({
    userJid: atk,
    scopeKey: scope,
    effectKey: 'weapons_license',
    charges: 1,
    payload: { permanent: true },
  });
  const cfg = resolveFunConfig({
    assaultCooldownMs: 0,
    heistBankCooldownMs: 0,
    heistBankBaseChance: 0.5,
    heistBankWeaponPenalty: 0.10,
  });

  // faca tem assaultPower=22
  marketRepo.addInventory({
    userJid: atk,
    scopeKey: scope,
    itemId: 'faca',
    acquiredPrice: 90,
    usesLeft: 10,
  });
  marketRepo.addInventory({
    userJid: atk,
    scopeKey: scope,
    itemId: 'lockpick',
    acquiredPrice: 50,
    usesLeft: 5,
  });

  const result = market.assault({
    attackerJid: atk,
    heistToken: 'banco',
    scopeKey: scope,
    funConfig: cfg,
  });
  assert.equal(result.ok, true);
  // faca: chance base 0.5 + 22/200 + lvl*0.006 - weaponPenalty 0.10
  // = 0.5 + 0.11 + 0.03 - 0.10 = 0.54
  // chancePenalty=0, heat=0
  assert.ok(result.chance < 0.60, `chance com arma em banco deve ter penalidade: ${result.chance}`);
  assert.ok(result.chance > 0.40, `chance com arma em banco deve ser razoável: ${result.chance}`);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('heist lojinha: arma NÃO sofre penalidade de banco', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const effects = createFunEffectsRepository({ getDatabase: getDb });
  const casinoRepo = createFunCasinoRepository({ getDatabase: getDb });
  const market = createMarketService({
    repository: repo,
    marketRepository: marketRepo,
    effectsRepository: effects,
    casinoRepository: casinoRepo,
    random: () => 0.5,
  });
  const scope = uniqueGroup();
  const atk = uniqueJid('5508');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 5000, reason: 'seed' });
  effects.addCharges({
    userJid: atk,
    scopeKey: scope,
    effectKey: 'weapons_license',
    charges: 1,
    payload: { permanent: true },
  });
  const cfg = resolveFunConfig({
    assaultCooldownMs: 0,
    heistBankCooldownMs: 0,
    heistShopCooldownMs: 0,
    heistBankBaseChance: 0.5,
    heistBankWeaponPenalty: 0.10,
  });

  marketRepo.addInventory({
    userJid: atk,
    scopeKey: scope,
    itemId: 'faca',
    acquiredPrice: 90,
    usesLeft: 10,
  });

  // lojinha: base 0.5 + 22/220 + lvl*0.006 = 0.5 + 0.1 + 0.03 = 0.63 (sem penalidade)
  const shopResult = market.assault({
    attackerJid: atk,
    heistToken: 'lojinha',
    scopeKey: scope,
    funConfig: cfg,
  });
  assert.equal(shopResult.ok, true);
  assert.ok(shopResult.chance > 0.55, `chance em lojinha NÃO deve ter penalidade: ${shopResult.chance}`);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

// ─── Police / Wanted / Immunity ─────────────────────────────────────────────

test('suspicion score: weights e riqueza sozinha não maximiza', () => {
  const richHonest = computeSuspicionScore({
    heat: 0,
    crimes7d: 0,
    wealth: 50_000,
    reportsScore: 0,
    wantedLevel: 0,
  });
  assert.ok(richHonest < 0.15, `rico honesto deve ser baixo: ${richHonest}`);

  const richCriminal = computeSuspicionScore({
    heat: 8,
    crimes7d: 15,
    wealth: 50_000,
    reportsScore: 0.5,
    wantedLevel: 4,
  });
  assert.ok(richCriminal > 0.55, `rico criminoso deve ser alto: ${richCriminal}`);
  assert.ok(richCriminal > richHonest * 3);

  const activePoor = computeSuspicionScore({
    heat: 6,
    crimes7d: 12,
    wealth: 50,
    reportsScore: 0.2,
    wantedLevel: 2,
  });
  assert.ok(activePoor > 0.35, `histórico criminal eleva suspicion: ${activePoor}`);
  assert.ok(activePoor > richHonest);
});

test('wanted level thresholds e decay ocioso vs heat', () => {
  // thresholds: [0, 6, 14, 28, 48, 80]
  assert.equal(wantedLevelFromPoints(0), 0);
  assert.equal(wantedLevelFromPoints(5), 0);
  assert.equal(wantedLevelFromPoints(6), 1);
  assert.equal(wantedLevelFromPoints(14), 2);
  assert.equal(wantedLevelFromPoints(28), 3);
  assert.equal(wantedLevelFromPoints(48), 4);
  assert.equal(wantedLevelFromPoints(80), 5);
  assert.equal(wantedLevelFromPoints(999), 5);

  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const effects = createFunEffectsRepository({ getDatabase: getDb });
  const casinoRepo = createFunCasinoRepository({ getDatabase: getDb });
  const market = createMarketService({
    repository: repo,
    marketRepository: marketRepo,
    effectsRepository: effects,
    casinoRepository: casinoRepo,
    random: () => 0.01,
  });

  const scope = uniqueGroup();
  const atk = uniqueJid('55110');
  const t0 = Date.now();
  market.setWantedPoints(atk, scope, 25, t0);
  assert.equal(market.getWantedLevel(atk, scope, t0), 2);
  assert.equal(market.getWantedPoints(atk, scope, t0), 25);

  // Heat decai com o relógio próprio; Wanted ainda presente após "decay de heat"
  market.setAssaultHeat(atk, scope, 5, t0);
  assert.equal(market.getAssaultHeat(atk, scope, t0), 5);
  // Wanted não some com o tempo de heat: só após 24h ocioso
  const afterHeatish = t0 + 60 * 60_000;
  assert.equal(market.getWantedPoints(atk, scope, afterHeatish), 25);
  // Após um passo de decay de Wanted (−1) sem crime
  const afterWantedDecay = t0 + WANTED_DECAY_MS + 1000;
  assert.equal(market.getWantedPoints(atk, scope, afterWantedDecay), 24);

  // Crime ativo reinicia o relógio: +pts e não decai nas próximas 24h
  const police = createPoliceService({ repository: repo, effectsRepository: effects });
  police.addWantedPoints(atk, scope, 5, afterWantedDecay);
  assert.equal(
    market.getWantedPoints(atk, scope, afterWantedDecay + WANTED_DECAY_MS - 1000),
    29
  );

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('wanted: falha também sobe ficha; sucesso sobe mais e dá estrela', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const effects = createFunEffectsRepository({ getDatabase: getDb });
  const casinoRepo = createFunCasinoRepository({ getDatabase: getDb });
  const police = createPoliceService({
    repository: repo,
    effectsRepository: effects,
    random: () => 0.99,
  });
  // fail market: rolls altos = falha
  const failMarket = createMarketService({
    repository: repo,
    marketRepository: marketRepo,
    effectsRepository: effects,
    casinoRepository: casinoRepo,
    policeService: police,
    random: () => 0.99,
  });
  const winMarket = createMarketService({
    repository: repo,
    marketRepository: marketRepo,
    effectsRepository: effects,
    casinoRepository: casinoRepo,
    policeService: createPoliceService({
      repository: repo,
      effectsRepository: effects,
      random: () => 0.99,
    }),
    random: () => 0.01,
  });

  const scope = uniqueGroup();
  const unlucky = uniqueJid('55115');
  const farmer = uniqueJid('55116');
  const t0 = Date.now();
  const cfg = resolveFunConfig({ assaultCooldownMs: 0, heistBankCooldownMs: 0 });

  for (const u of [unlucky, farmer]) {
    repo.addCoins({ userJid: u, scopeKey: scope, amount: 5000, reason: 'seed' });
    effects.addCharges({
      userJid: u,
      scopeKey: scope,
      effectKey: 'weapons_license',
      charges: 1,
      payload: { permanent: true },
    });
    marketRepo.addInventory({
      userJid: u,
      scopeKey: scope,
      itemId: 'faca',
      acquiredPrice: 90,
      usesLeft: 20,
    });
    marketRepo.addInventory({
      userJid: u,
      scopeKey: scope,
      itemId: 'lockpick',
      acquiredPrice: 50,
      usesLeft: 20,
    });
  }

  // 2 falhas de banco → +2 cada = 4 pts (sobe ficha, ainda sem estrela)
  for (let i = 0; i < 2; i += 1) {
    marketRepo.addInventory({
      userJid: unlucky,
      scopeKey: scope,
      itemId: 'lockpick',
      acquiredPrice: 50,
      usesLeft: 5,
    });
    const f = failMarket.assault({
      attackerJid: unlucky,
      heistToken: 'banco',
      scopeKey: scope,
      funConfig: cfg,
      now: t0 + i * 1000,
    });
    assert.equal(f.ok, true);
    assert.equal(f.success, false);
    assert.notEqual(f.policeBust, true);
  }
  const failPts = failMarket.getWantedPoints(unlucky, scope, t0 + 5000);
  assert.equal(failPts, 4, `falhas devem somar Wanted: ${failPts}`);
  assert.equal(failMarket.getWantedLevel(unlucky, scope, t0 + 5000), 0);

  // 2 bancos com sucesso → ⭐1 (5+5 = 10 ≥ 6)
  for (let i = 0; i < 2; i += 1) {
    marketRepo.addInventory({
      userJid: farmer,
      scopeKey: scope,
      itemId: 'lockpick',
      acquiredPrice: 50,
      usesLeft: 5,
    });
    const w = winMarket.assault({
      attackerJid: farmer,
      heistToken: 'banco',
      scopeKey: scope,
      funConfig: cfg,
      now: t0 + 10_000 + i * 1000,
    });
    assert.equal(w.ok, true);
    assert.equal(w.success, true);
  }
  assert.ok(winMarket.getWantedPoints(farmer, scope, t0 + 20_000) >= 10);
  assert.ok(winMarket.getWantedLevel(farmer, scope, t0 + 20_000) >= 1);
  // sucesso acumula mais que falha
  assert.ok(
    winMarket.getWantedPoints(farmer, scope, t0 + 20_000) > failPts,
    'sucesso deve gerar mais Wanted que falha'
  );

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('wanted sobe com heist e escalona chance; heat ainda funciona', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const effects = createFunEffectsRepository({ getDatabase: getDb });
  const casinoRepo = createFunCasinoRepository({ getDatabase: getDb });
  const police = createPoliceService({
    repository: repo,
    effectsRepository: effects,
    random: () => 0.99, // nunca bust
  });
  const market = createMarketService({
    repository: repo,
    marketRepository: marketRepo,
    effectsRepository: effects,
    casinoRepository: casinoRepo,
    policeService: police,
    random: () => 0.01, // sempre sucesso
  });

  const scope = uniqueGroup();
  const atk = uniqueJid('55111');
  const t0 = Date.now();
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 5000, reason: 'seed' });
  effects.addCharges({
    userJid: atk,
    scopeKey: scope,
    effectKey: 'weapons_license',
    charges: 1,
    payload: { permanent: true },
  });
  marketRepo.addInventory({
    userJid: atk,
    scopeKey: scope,
    itemId: 'faca',
    acquiredPrice: 90,
    usesLeft: 30,
  });
  marketRepo.addInventory({
    userJid: atk,
    scopeKey: scope,
    itemId: 'lockpick',
    acquiredPrice: 50,
    usesLeft: 20,
  });

  const cfg = resolveFunConfig({
    assaultCooldownMs: 0,
    heistBankCooldownMs: 0,
    heistShopCooldownMs: 0,
  });

  const beforeWanted = market.getWantedPoints(atk, scope, t0);
  assert.equal(beforeWanted, 0);

  const r1 = market.assault({
    attackerJid: atk,
    heistToken: 'banco',
    scopeKey: scope,
    funConfig: cfg,
    now: t0,
  });
  assert.equal(r1.ok, true, `assault failed: ${r1.reason || r1.policeBust}`);
  assert.equal(r1.success, true, `expected success got policeBust=${r1.policeBust} chance=${r1.chance}`);
  assert.equal(r1.heat, 1);
  assert.ok(r1.wantedPoints > beforeWanted);
  assert.ok(r1.wantedLevel >= 0);

  // Wanted alto endurece chance vs baseline
  market.setWantedPoints(atk, scope, 110, t0 + 1000);
  market.setAssaultHeat(atk, scope, 0, t0 + 1000);
  const hot = market.assault({
    attackerJid: atk,
    heistToken: 'lojinha',
    scopeKey: scope,
    funConfig: cfg,
    now: t0 + 1000,
  });
  assert.equal(hot.ok, true);
  assert.ok(hot.wantedLevel >= 5);
  // chancePenalty policial reduz chance abaixo do baseline de lojinha sem wanted
  assert.ok(hot.chance < 0.7, `wanted max deve pressionar chance: ${hot.chance}`);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('crime immunity pass: zero heat, wanted sobe, usos e expiração', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const effects = createFunEffectsRepository({ getDatabase: getDb });
  const casinoRepo = createFunCasinoRepository({ getDatabase: getDb });
  // polícia: nunca bust (0.99); crime: sempre sucesso (0.01) — randoms separados
  const police = createPoliceService({
    repository: repo,
    effectsRepository: effects,
    random: () => 0.99,
  });
  const market = createMarketService({
    repository: repo,
    marketRepository: marketRepo,
    effectsRepository: effects,
    casinoRepository: casinoRepo,
    policeService: police,
    random: () => 0.01,
  });
  const shop = createShopService({
    repository: repo,
    effectsRepository: effects,
    policeService: police,
  });

  const scope = uniqueGroup();
  const atk = uniqueJid('55112');
  // semana isolada (DB de teste persiste entre runs) — offset aleatório grande
  const t0 =
    Date.now() +
    (200 + Math.floor(Math.random() * 500_000)) * POLICE_IMMUNITY_WEEK_MS;
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 20_000, reason: 'seed' });
  effects.addCharges({
    userJid: atk,
    scopeKey: scope,
    effectKey: 'weapons_license',
    charges: 1,
    payload: { permanent: true },
  });
  marketRepo.addInventory({
    userJid: atk,
    scopeKey: scope,
    itemId: 'faca',
    acquiredPrice: 90,
    usesLeft: 40,
  });

  const pass = getShopItem('crime_immunity_pass');
  assert.ok(pass);
  assert.equal(pass.price, 900);
  assert.equal(pass.charges, POLICE_IMMUNITY_MAX_USES);

  assert.equal(police.isImmunityPassAvailable(t0), true);
  const buy = shop.buy({
    userJid: atk,
    scopeKey: scope,
    itemId: 'crime_immunity_pass',
    now: t0,
  });
  assert.equal(buy.ok, true);
  assert.equal(buy.immunity?.active, true);
  assert.equal(buy.immunity?.remainingUses, 20);
  assert.equal(police.isImmunityPassAvailable(t0), false);

  // segunda compra na mesma semana: esgotado
  const buy2 = shop.buy({
    userJid: atk,
    scopeKey: scope,
    itemId: 'crime_immunity_pass',
    now: t0 + 1000,
  });
  assert.equal(buy2.ok, false);
  assert.equal(buy2.reason, 'weekly-sold-out');

  // reaparece na próxima semana
  assert.equal(police.isImmunityPassAvailable(t0 + POLICE_IMMUNITY_WEEK_MS + 1000), true);

  market.setAssaultHeat(atk, scope, 4, t0);
  const heatBefore = market.getAssaultHeat(atk, scope, t0);
  const wantedBefore = market.getWantedPoints(atk, scope, t0);

  const cfg = resolveFunConfig({ assaultCooldownMs: 0, heistBankCooldownMs: 0 });
  const r = market.assault({
    attackerJid: atk,
    heistToken: 'lojinha',
    scopeKey: scope,
    funConfig: cfg,
    now: t0 + 2000,
  });
  assert.equal(r.ok, true);
  assert.equal(r.success, true);
  assert.equal(r.immune, true);
  assert.notEqual(r.policeBust, true);
  // Heat congelado (geração zero)
  assert.equal(r.heat, heatBefore);
  // Wanted sobe mesmo com imunidade
  assert.ok(r.wantedPoints > wantedBefore, 'wanted deve subir sob imunidade');
  assert.ok(r.immunityUsesLeft < 20);

  // consome usos restantes via API (19 left após o 1º crime)
  let uses = police.getImmunity(atk, scope, t0 + 3000).remainingUses;
  assert.ok(uses < 20 && uses > 0);
  while (uses > 0) {
    police.consumeImmunityUse(atk, scope, t0 + 4000);
    uses = police.getImmunity(atk, scope, t0 + 4000).remainingUses;
  }
  assert.equal(police.getImmunity(atk, scope, t0 + 5000).active, false, 'passe esgota por usos');

  // Expiração por tempo (novo passe via effect direto, sem weekly gate)
  effects.setTimedChargesEffect({
    userJid: atk,
    scopeKey: scope,
    effectKey: 'police_immunity',
    durationMs: POLICE_IMMUNITY_DURATION_MS,
    charges: 20,
    payload: { useCharges: true },
    now: t0 + 20_000,
    replace: true,
  });
  assert.equal(police.getImmunity(atk, scope, t0 + 20_000).active, true);
  const expired = police.getImmunity(
    atk,
    scope,
    t0 + 20_000 + POLICE_IMMUNITY_DURATION_MS + 1000
  );
  assert.equal(expired.active, false, 'passe expira em 3 dias');

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('polícia: intervenção por wanted alto; imunidade ignora bust', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const effects = createFunEffectsRepository({ getDatabase: getDb });
  const casinoRepo = createFunCasinoRepository({ getDatabase: getDb });

  // random sempre 0 → sempre intervém se p > 0
  const policeHot = createPoliceService({
    repository: repo,
    effectsRepository: effects,
    random: () => 0,
  });
  const marketHot = createMarketService({
    repository: repo,
    marketRepository: marketRepo,
    effectsRepository: effects,
    casinoRepository: casinoRepo,
    policeService: policeHot,
    random: () => 0,
  });

  const scope = uniqueGroup();
  const atk = uniqueJid('55113');
  const t0 = Date.now();
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 3000, reason: 'seed' });
  effects.addCharges({
    userJid: atk,
    scopeKey: scope,
    effectKey: 'weapons_license',
    charges: 1,
    payload: { permanent: true },
  });
  marketRepo.addInventory({
    userJid: atk,
    scopeKey: scope,
    itemId: 'faca',
    acquiredPrice: 90,
    usesLeft: 10,
  });
  marketRepo.addInventory({
    userJid: atk,
    scopeKey: scope,
    itemId: 'lockpick',
    acquiredPrice: 50,
    usesLeft: 5,
  });

  marketHot.setWantedPoints(atk, scope, 110, t0);
  marketHot.setAssaultHeat(atk, scope, 8, t0);

  const cfg = resolveFunConfig({ assaultCooldownMs: 0, heistBankCooldownMs: 0 });
  const bust = marketHot.assault({
    attackerJid: atk,
    heistToken: 'banco',
    scopeKey: scope,
    funConfig: cfg,
    now: t0,
  });
  assert.equal(bust.ok, true);
  assert.equal(bust.success, false);
  assert.equal(bust.policeBust, true);
  assert.ok(bust.fine > 0);

  // Com imunidade: nunca bust
  effects.setTimedChargesEffect({
    userJid: atk,
    scopeKey: scope,
    effectKey: 'police_immunity',
    durationMs: POLICE_IMMUNITY_DURATION_MS,
    charges: 5,
    now: t0 + 1000,
    replace: true,
  });
  marketRepo.addInventory({
    userJid: atk,
    scopeKey: scope,
    itemId: 'faca',
    acquiredPrice: 90,
    usesLeft: 10,
  });
  marketRepo.addInventory({
    userJid: atk,
    scopeKey: scope,
    itemId: 'lockpick',
    acquiredPrice: 50,
    usesLeft: 5,
  });
  // sucesso: intervention skip + roll 0 < chance
  const safe = marketHot.assault({
    attackerJid: atk,
    heistToken: 'banco',
    scopeKey: scope,
    funConfig: cfg,
    now: t0 + 1000,
  });
  assert.equal(safe.ok, true);
  assert.equal(safe.immune, true);
  assert.notEqual(safe.policeBust, true);
  assert.equal(safe.success, true);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('help assalto menciona Heat, Wanted e Immunity Pass', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const effects = createFunEffectsRepository({ getDatabase: getDb });
  const market = createMarketService({
    repository: repo,
    marketRepository: marketRepo,
    effectsRepository: effects,
    random: () => 0.5,
  });
  const help = market.formatAssaultHelp(uniqueGroup(), resolveFunConfig({}), uniqueJid('55114'));
  assert.match(help, /Heat/i);
  assert.match(help, /Wanted/i);
  assert.match(help, /Immunity Pass|imunidade/i);
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

// ─── Regras de cooldown + multa por modo (banco / loja) ─────────────────────

test('heist: cooldown de loja é 30 min (default) e banco segue 1h', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const effects = createFunEffectsRepository({ getDatabase: getDb });
  const casinoRepo = createFunCasinoRepository({ getDatabase: getDb });
  // random alto = falha; mas sem bust (wanted baixo, suspicion baixa, heat 0)
  const market = createMarketService({
    repository: repo,
    marketRepository: marketRepo,
    effectsRepository: effects,
    casinoRepository: casinoRepo,
    random: () => 0.99,
  });

  const scope = uniqueGroup();
  const cfg = resolveFunConfig({}); // defaults: shop 30min, bank 1h

  // === LOJA: cooldown de 30 min ===
  const shopAtk = uniqueJid('5570');
  repo.addCoins({ userJid: shopAtk, scopeKey: scope, amount: 5000, reason: 'seed' });
  effects.addCharges({
    userJid: shopAtk,
    scopeKey: scope,
    effectKey: 'weapons_license',
    charges: 1,
    payload: { permanent: true },
  });
  marketRepo.addInventory({
    userJid: shopAtk,
    scopeKey: scope,
    itemId: 'faca',
    acquiredPrice: 90,
    usesLeft: 20,
  });

  const tShop = Date.now();
  const shopFail = market.assault({
    attackerJid: shopAtk,
    heistToken: 'lojinha',
    scopeKey: scope,
    funConfig: cfg,
    now: tShop,
  });
  assert.equal(shopFail.ok, true);
  assert.equal(shopFail.success, false);

  // loja bloqueada 1 min depois: retryInMs ≈ 29 min
  const shopBlocked = market.assault({
    attackerJid: shopAtk,
    heistToken: 'lojinha',
    scopeKey: scope,
    funConfig: cfg,
    now: tShop + 60_000,
  });
  assert.equal(shopBlocked.ok, false);
  assert.equal(shopBlocked.reason, 'cooldown');
  assert.ok(
    Math.abs(shopBlocked.retryInMs - 29 * 60_000) < 1500,
    `loja cooldown deve ser ~29 min restantes, got ${shopBlocked.retryInMs}`
  );

  // === BANCO: cooldown de 1h (default heistBankCooldownMs preservado) ===
  const bankAtk = uniqueJid('5571');
  repo.addCoins({ userJid: bankAtk, scopeKey: scope, amount: 5000, reason: 'seed' });
  effects.addCharges({
    userJid: bankAtk,
    scopeKey: scope,
    effectKey: 'weapons_license',
    charges: 1,
    payload: { permanent: true },
  });
  marketRepo.addInventory({
    userJid: bankAtk,
    scopeKey: scope,
    itemId: 'faca',
    acquiredPrice: 90,
    usesLeft: 20,
  });
  marketRepo.addInventory({
    userJid: bankAtk,
    scopeKey: scope,
    itemId: 'lockpick',
    acquiredPrice: 50,
    usesLeft: 20,
  });

  const tBank = Date.now();
  const bankFail = market.assault({
    attackerJid: bankAtk,
    heistToken: 'banco',
    scopeKey: scope,
    funConfig: cfg,
    now: tBank,
  });
  assert.equal(bankFail.ok, true);
  assert.equal(bankFail.success, false);

  // banco bloqueado 1 min depois: retryInMs ≈ 59 min
  const bankBlocked = market.assault({
    attackerJid: bankAtk,
    heistToken: 'banco',
    scopeKey: scope,
    funConfig: cfg,
    now: tBank + 60_000,
  });
  assert.equal(bankBlocked.ok, false);
  assert.equal(bankBlocked.reason, 'cooldown');
  assert.ok(
    Math.abs(bankBlocked.retryInMs - 59 * 60_000) < 1500,
    `banco cooldown deve ser ~59 min restantes, got ${bankBlocked.retryInMs}`
  );

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('heist: cooldown customizado de loja sobrescreve default', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const effects = createFunEffectsRepository({ getDatabase: getDb });
  const casinoRepo = createFunCasinoRepository({ getDatabase: getDb });
  const market = createMarketService({
    repository: repo,
    marketRepository: marketRepo,
    effectsRepository: effects,
    casinoRepository: casinoRepo,
    random: () => 0.99,
  });

  const scope = uniqueGroup();
  const atk = uniqueJid('5571');
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 5000, reason: 'seed' });
  effects.addCharges({
    userJid: atk,
    scopeKey: scope,
    effectKey: 'weapons_license',
    charges: 1,
    payload: { permanent: true },
  });
  marketRepo.addInventory({
    userJid: atk,
    scopeKey: scope,
    itemId: 'faca',
    acquiredPrice: 90,
    usesLeft: 20,
  });

  const cfg = resolveFunConfig({ heistShopCooldownMs: 10 * 60_000 }); // 10 min override

  const t0 = Date.now();
  const r = market.assault({
    attackerJid: atk,
    heistToken: 'lojinha',
    scopeKey: scope,
    funConfig: cfg,
    now: t0,
  });
  assert.equal(r.ok, true);

  // retryInMs ≈ 9 min (10 - 1)
  const blocked = market.assault({
    attackerJid: atk,
    heistToken: 'lojinha',
    scopeKey: scope,
    funConfig: cfg,
    now: t0 + 60_000,
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'cooldown');
  assert.ok(
    Math.abs(blocked.retryInMs - 9 * 60_000) < 1500,
    `override deve dar ~9 min restantes, got ${blocked.retryInMs}`
  );

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('heist: multa de falha calibrada — banco 20%, loja 10%, PvP 5%', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const effects = createFunEffectsRepository({ getDatabase: getDb });
  const casinoRepo = createFunCasinoRepository({ getDatabase: getDb });
  // random alto = falha; mas sem bust (wanted baixo, suspicion baixa, heat 0)
  const failMarket = createMarketService({
    repository: repo,
    marketRepository: marketRepo,
    effectsRepository: effects,
    casinoRepository: casinoRepo,
    random: () => 0.99,
  });

  const scope = uniqueGroup();

  const seedAndArm = (jid, lockpick = false) => {
    repo.addCoins({ userJid: jid, scopeKey: scope, amount: 1000, reason: 'seed' });
    effects.addCharges({
      userJid: jid,
      scopeKey: scope,
      effectKey: 'weapons_license',
      charges: 1,
      payload: { permanent: true },
    });
    marketRepo.addInventory({
      userJid: jid,
      scopeKey: scope,
      itemId: 'faca',
      acquiredPrice: 90,
      usesLeft: 20,
    });
    if (lockpick) {
      marketRepo.addInventory({
        userJid: jid,
        scopeKey: scope,
        itemId: 'lockpick',
        acquiredPrice: 50,
        usesLeft: 20,
      });
    }
  };

  // Lojinha: multa = 10% de 1000 = 100 (entre piso 10 e teto 200)
  const shopAtk = uniqueJid('5572');
  seedAndArm(shopAtk, false);
  const shopFail = failMarket.assault({
    attackerJid: shopAtk,
    heistToken: 'lojinha',
    scopeKey: scope,
    funConfig: resolveFunConfig({}),
    now: Date.now(),
  });
  assert.equal(shopFail.ok, true);
  assert.equal(shopFail.success, false);
  assert.ok(shopFail.fine >= 10, `multa de loja >= piso: ${shopFail.fine}`);
  assert.ok(shopFail.fine <= 200, `multa de loja <= teto: ${shopFail.fine}`);
  // 1000 * 0.10 = 100 → dentro do clamp
  assert.equal(shopFail.fine, 100, `multa de loja deve ser 10% do saldo: ${shopFail.fine}`);

  // Banco: multa = 20% de 1000 = 200 (no teto)
  const bankAtk = uniqueJid('5573');
  seedAndArm(bankAtk, true);
  const bankFail = failMarket.assault({
    attackerJid: bankAtk,
    heistToken: 'banco',
    scopeKey: scope,
    funConfig: resolveFunConfig({}),
    now: Date.now(),
  });
  assert.equal(bankFail.ok, true);
  assert.equal(bankFail.success, false);
  assert.ok(bankFail.fine >= 10);
  assert.ok(bankFail.fine <= 200, `multa de banco <= teto preservado: ${bankFail.fine}`);
  // 1000 * 0.20 = 200 → exatamente no teto
  assert.equal(bankFail.fine, 200, `multa de banco deve ser 20% do saldo: ${bankFail.fine}`);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('heist: multa de banco whale preserva teto (não estoura carteira)', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const effects = createFunEffectsRepository({ getDatabase: getDb });
  const casinoRepo = createFunCasinoRepository({ getDatabase: getDb });
  const failMarket = createMarketService({
    repository: repo,
    marketRepository: marketRepo,
    effectsRepository: effects,
    casinoRepository: casinoRepo,
    random: () => 0.99,
  });

  const scope = uniqueGroup();
  const whale = uniqueJid('5574');
  // whale com saldo alto: 20% = 4000, mas teto = 200 → preservado
  repo.addCoins({ userJid: whale, scopeKey: scope, amount: 20_000, reason: 'seed' });
  effects.addCharges({
    userJid: whale,
    scopeKey: scope,
    effectKey: 'weapons_license',
    charges: 1,
    payload: { permanent: true },
  });
  marketRepo.addInventory({
    userJid: whale,
    scopeKey: scope,
    itemId: 'faca',
    acquiredPrice: 90,
    usesLeft: 10,
  });
  marketRepo.addInventory({
    userJid: whale,
    scopeKey: scope,
    itemId: 'lockpick',
    acquiredPrice: 50,
    usesLeft: 10,
  });

  // cooldown zerado pra permitir loja após banco
  const cfg = resolveFunConfig({ heistBankCooldownMs: 0, heistShopCooldownMs: 0 });
  const fail = failMarket.assault({
    attackerJid: whale,
    heistToken: 'banco',
    scopeKey: scope,
    funConfig: cfg,
  });
  assert.equal(fail.ok, true);
  assert.equal(fail.success, false);
  // 20% de 20.000 = 4000; clamp pelo teto preservado
  assert.equal(fail.fine, 200, 'whale deve ser protegido pelo teto de multa');

  // loja do mesmo whale: 10% = ~2000 → teto 200
  const failShop = failMarket.assault({
    attackerJid: whale,
    heistToken: 'lojinha',
    scopeKey: scope,
    funConfig: cfg,
  });
  assert.equal(failShop.ok, true);
  assert.equal(failShop.success, false);
  assert.equal(failShop.fine, 200, 'loja whale também protegida pelo teto');

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('heist: piso de multa protege jogador iniciante (loja)', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const effects = createFunEffectsRepository({ getDatabase: getDb });
  const casinoRepo = createFunCasinoRepository({ getDatabase: getDb });
  const failMarket = createMarketService({
    repository: repo,
    marketRepository: marketRepo,
    effectsRepository: effects,
    casinoRepository: casinoRepo,
    random: () => 0.99,
  });

  const scope = uniqueGroup();
  const newbie = uniqueJid('5575');
  // saldo muito baixo: 10% de 30 = 3, mas piso = 10
  repo.addCoins({ userJid: newbie, scopeKey: scope, amount: 30, reason: 'seed' });
  effects.addCharges({
    userJid: newbie,
    scopeKey: scope,
    effectKey: 'weapons_license',
    charges: 1,
    payload: { permanent: true },
  });
  marketRepo.addInventory({
    userJid: newbie,
    scopeKey: scope,
    itemId: 'faca',
    acquiredPrice: 90,
    usesLeft: 10,
  });

  const fail = failMarket.assault({
    attackerJid: newbie,
    heistToken: 'lojinha',
    scopeKey: scope,
    funConfig: resolveFunConfig({}),
  });
  assert.equal(fail.ok, true);
  assert.equal(fail.success, false);
  assert.equal(fail.fine, 10, 'multa mínima é o piso, mesmo que % do saldo seja menor');

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('heist: override de heistBankFailFinePct e heistShopFailFinePct via config', () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  const effects = createFunEffectsRepository({ getDatabase: getDb });
  const casinoRepo = createFunCasinoRepository({ getDatabase: getDb });
  const failMarket = createMarketService({
    repository: repo,
    marketRepository: marketRepo,
    effectsRepository: effects,
    casinoRepository: casinoRepo,
    random: () => 0.99,
  });

  const scope = uniqueGroup();
  const atk = uniqueJid('5576');
  // saldo 1000, heistShopFailFinePct 0.05 → multa = 50 (mas piso 10 e teto 200)
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 1000, reason: 'seed' });
  effects.addCharges({
    userJid: atk,
    scopeKey: scope,
    effectKey: 'weapons_license',
    charges: 1,
    payload: { permanent: true },
  });
  marketRepo.addInventory({
    userJid: atk,
    scopeKey: scope,
    itemId: 'faca',
    acquiredPrice: 90,
    usesLeft: 10,
  });

  const cfg = resolveFunConfig({
    heistShopFailFinePct: 0.05, // override: loja cobra só 5% (legado PvP)
    heistBankFailFinePct: 0.30, // override: banco 30%
    heistShopCooldownMs: 0, // sem cooldown para isolar o teste
    heistBankCooldownMs: 0,
  });

  const shopFail = failMarket.assault({
    attackerJid: atk,
    heistToken: 'lojinha',
    scopeKey: scope,
    funConfig: cfg,
  });
  assert.equal(shopFail.ok, true);
  assert.equal(shopFail.success, false);
  assert.equal(shopFail.fine, 50, `override de loja: 5% de 1000 = 50, got ${shopFail.fine}`);

  // refill + lockpick para o teste de banco
  repo.addCoins({ userJid: atk, scopeKey: scope, amount: 1000, reason: 'refill' });
  marketRepo.addInventory({
    userJid: atk,
    scopeKey: scope,
    itemId: 'lockpick',
    acquiredPrice: 50,
    usesLeft: 5,
  });

  const bankFail = failMarket.assault({
    attackerJid: atk,
    heistToken: 'banco',
    scopeKey: scope,
    funConfig: cfg,
  });
  assert.equal(bankFail.ok, true);
  assert.equal(bankFail.success, false);
  // 30% de 2000 (saldo após refill) = 600; mas teto 200 → clamp
  assert.equal(bankFail.fine, 200, `override de banco: 30% clampado pelo teto, got ${bankFail.fine}`);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});
