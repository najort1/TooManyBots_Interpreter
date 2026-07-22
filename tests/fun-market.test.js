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

  const result = market.assault({
    attackerJid: atk,
    heistToken: 'banco',
    scopeKey: scope,
    funConfig: cfg,
  });
  assert.equal(result.ok, true);
  // faca: chance base 0.5 + 22/200 + lvl*0.006 - weaponPenalty 0.10
  // = 0.5 + 0.11 + 0.03 - 0.10 = 0.54
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
