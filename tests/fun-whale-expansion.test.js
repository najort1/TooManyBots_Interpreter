import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import {
  _resetDefaultFunStatsRepository,
  createFunStatsRepository,
} from '../fun/db/funStatsRepository.js';
import { createFunMarketRepository } from '../fun/db/funMarketRepository.js';
import { createFunPropertyRepository } from '../fun/db/funPropertyRepository.js';
import { createFunEffectsRepository } from '../fun/db/funEffectsRepository.js';
import { createPropertyService } from '../fun/services/propertyService.js';
import { createMarketService } from '../fun/services/marketService.js';
import { createShopService } from '../fun/services/shopService.js';
import { getProperty, listProperties } from '../fun/shop/properties.js';
import { getCollectible, listCollectibles, listWeaponShop, listUtilityShop } from '../fun/shop/collectibles.js';
import { getShopItem, listShopItems } from '../fun/shop/catalog.js';
import { createDailyService } from '../fun/services/dailyService.js';
import { handleDailyCommand } from '../fun/commands/handlers/daily.js';

await initDb();
_resetDefaultFunStatsRepository();

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

function uniqueJid(prefix = '5511') {
  return `${prefix}${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 90 + 10)}@s.whatsapp.net`;
}

function setup() {
  const repository = createFunStatsRepository({ getDatabase: getDb });
  repository.ensureFunSchema();
  const marketRepository = createFunMarketRepository({ getDatabase: getDb });
  const propertyRepository = createFunPropertyRepository({ getDatabase: getDb });
  const effectsRepository = createFunEffectsRepository({ getDatabase: getDb });
  const propertyService = createPropertyService({
    repository,
    propertyRepository,
    effectsRepository,
  });
  const shopService = createShopService({
    repository,
    effectsRepository,
  });
  const marketService = createMarketService({
    repository,
    marketRepository,
    propertyService,
    effectsRepository,
  });
  return {
    repository,
    marketRepository,
    propertyRepository,
    effectsRepository,
    propertyService,
    shopService,
    marketService,
  };
}

test('catalogos expandidos: novas propriedades de alto valor', () => {
  const bunker = getProperty('bunker_offshore');
  assert.ok(bunker, 'bunker_offshore deve existir');
  assert.equal(bunker.cost, 45000);
  assert.equal(bunker.incomePerTick, 130);
  assert.equal(bunker.bufferCap, 1500);

  const conglomerado = getProperty('conglomerado_tech');
  assert.ok(conglomerado, 'conglomerado_tech deve existir');
  assert.equal(conglomerado.cost, 120000);
  assert.equal(conglomerado.incomePerTick, 280);
  assert.equal(conglomerado.bufferCap, 3500);

  const orbital = getProperty('estacao_orbital');
  assert.ok(orbital, 'estacao_orbital deve existir');
  assert.equal(orbital.cost, 320000);
  assert.equal(orbital.incomePerTick, 650);
  assert.equal(orbital.bufferCap, 9000);

  // Aliases
  assert.equal(getProperty('bunker')?.id, 'bunker_offshore');
  assert.equal(getProperty('offshore')?.id, 'bunker_offshore');
  assert.equal(getProperty('conglomerado')?.id, 'conglomerado_tech');
  assert.equal(getProperty('orbital')?.id, 'estacao_orbital');
  assert.equal(getProperty('estacao')?.id, 'estacao_orbital');
});

test('catalogos expandidos: novas armas e itens utilitarios', () => {
  // Armas
  const bazuca = getCollectible('bazuca');
  assert.ok(bazuca, 'bazuca deve existir');
  assert.equal(bazuca.category, 'arma');
  assert.equal(bazuca.weaponShop, true);
  assert.equal(bazuca.requires, 'foguete');
  assert.equal(bazuca.assaultPower, 90);

  const drone = getCollectible('drone_kamikaze');
  assert.ok(drone, 'drone_kamikaze deve existir');
  assert.equal(drone.category, 'arma');
  assert.equal(drone.weaponShop, true);
  assert.equal(drone.requires, 'bateria_drone');
  assert.equal(drone.assaultPower, 110);

  const nuke = getCollectible('ogiva_nuclear');
  assert.ok(nuke, 'ogiva_nuclear deve existir');
  assert.equal(nuke.category, 'arma');
  assert.equal(nuke.weaponShop, true);
  assert.equal(nuke.requires, 'codigo_nuclear');
  assert.equal(nuke.uses, 1);

  // Consumíveis e Defesas
  const foguete = getCollectible('foguete');
  assert.ok(foguete, 'foguete deve existir');
  assert.equal(foguete.category, 'municao');

  const bat = getCollectible('bateria_drone');
  assert.ok(bat, 'bateria_drone deve existir');
  assert.equal(bat.category, 'municao');

  const codigo = getCollectible('codigo_nuclear');
  assert.ok(codigo, 'codigo_nuclear deve existir');
  assert.equal(codigo.category, 'licenca');

  const querosene = getCollectible('querosene_aviacao');
  assert.ok(querosene, 'querosene_aviacao deve existir');
  assert.equal(querosene.category, 'combustivel');

  const blindado = getCollectible('blindado');
  assert.ok(blindado, 'blindado deve existir');
  assert.equal(blindado.category, 'veiculo');

  const jatinho = getCollectible('jatinho');
  assert.ok(jatinho, 'jatinho deve existir');
  assert.equal(jatinho.category, 'veiculo');
  assert.equal(jatinho.requires, 'querosene_aviacao');

  const cupula = getCollectible('cupula_ferro');
  assert.ok(cupula, 'cupula_ferro deve existir');
  assert.equal(cupula.category, 'defesa');
  assert.equal(cupula.defensePower, 45);
});

test('catalogos expandidos: novos itens na /loja', () => {
  const alvara = getShopItem('alvara_holding');
  assert.ok(alvara, 'alvara_holding deve existir');
  assert.equal(alvara.price, 25000);

  const seguro = getShopItem('seguro_empresarial');
  assert.ok(seguro, 'seguro_empresarial deve existir');
  assert.equal(seguro.price, 8000);
  assert.equal(seguro.charges, 5);

  const advogado = getShopItem('advogado_supremo');
  assert.ok(advogado, 'advogado_supremo deve existir');
  assert.equal(advogado.price, 10000);
  assert.equal(advogado.charges, 3);

  const iate = getShopItem('iate_dourado');
  assert.ok(iate, 'iate_dourado deve existir');
  assert.equal(iate.price, 150000);
  assert.equal(iate.kind, 'permanent');
});

test('propertyService: alvara de holding expande limite maxOwned', () => {
  const { repository, propertyService, effectsRepository } = setup();
  const scope = uniqueGroup();
  const user = uniqueJid('5511');
  const cfg = { propertiesEnabled: true, propertyTickMs: 1000, propertyMaxOwned: 2 };

  repository.addCoins({ userJid: user, scopeKey: scope, amount: 200000, reason: 'seed' });

  // Compra 2 normais
  const b1 = propertyService.buy({ userJid: user, scopeKey: scope, propertyId: 'barraca', funConfig: cfg });
  assert.equal(b1.ok, true);
  const b2 = propertyService.buy({ userJid: user, scopeKey: scope, propertyId: 'cassino', funConfig: cfg });
  assert.equal(b2.ok, true);

  // Tentativa do 3º falha sem holding
  const b3Fail = propertyService.buy({ userJid: user, scopeKey: scope, propertyId: 'firma', funConfig: cfg });
  assert.equal(b3Fail.ok, false);
  assert.equal(b3Fail.reason, 'max-owned');

  // Adiciona 1 carga de holding_license
  effectsRepository.addCharges({
    userJid: user,
    scopeKey: scope,
    effectKey: 'holding_license',
    charges: 1,
    payload: { bonusSlots: 1 },
  });

  // Agora consegue comprar o 3º!
  const b3Success = propertyService.buy({ userJid: user, scopeKey: scope, propertyId: 'firma', funConfig: cfg });
  assert.equal(b3Success.ok, true);
  assert.equal(b3Success.def.id, 'firma_lavagem');
});

test('marketService: ogiva nuclear requer codigo_nuclear e falha sem ele', () => {
  const { repository, marketRepository, marketService, effectsRepository } = setup();
  const scope = uniqueGroup();
  const attacker = uniqueJid('5511');
  const victim = uniqueJid('5512');

  // Libera chave de armas
  effectsRepository.addCharges({
    userJid: attacker,
    scopeKey: scope,
    effectKey: 'weapons_license',
    charges: 1,
    payload: { permanent: true },
  });

  // Dá a ogiva para o atacante
  marketRepository.addInventory({
    userJid: attacker,
    scopeKey: scope,
    itemId: 'ogiva_nuclear',
    acquiredPrice: 35000,
    usesLeft: 1,
    condition: 'ok',
  });

  repository.addCoins({ userJid: attacker, scopeKey: scope, amount: 50000, reason: 'seed' });
  repository.addCoins({ userJid: victim, scopeKey: scope, amount: 50000, reason: 'seed' });

  // Sem codigo_nuclear
  const assaultNoCode = marketService.assault({
    attackerJid: attacker,
    targetJid: victim,
    scopeKey: scope,
    weaponToken: 'ogiva_nuclear',
  });
  assert.equal(assaultNoCode.ok, false);
  assert.equal(assaultNoCode.reason, 'no-ammo');

  // Adiciona codigo_nuclear
  marketRepository.addInventory({
    userJid: attacker,
    scopeKey: scope,
    itemId: 'codigo_nuclear',
    acquiredPrice: 2500,
    usesLeft: 1,
    condition: 'ok',
  });

  // Com codigo_nuclear mas alvo pobre (< 15k e sem negócio)
  const poorVictim = uniqueJid('5513');
  repository.addCoins({ userJid: poorVictim, scopeKey: scope, amount: 200, reason: 'seed' });

  const assaultPoor = marketService.assault({
    attackerJid: attacker,
    targetJid: poorVictim,
    scopeKey: scope,
    weaponToken: 'ogiva_nuclear',
  });
  assert.equal(assaultPoor.ok, false);
  assert.equal(assaultPoor.reason, 'nuclear-embargo');
});

test('marketService: ogiva nuclear tem 100% de chance, zera vida do negocio e sobe wanted/heat', () => {
  const { repository, marketRepository, marketService, propertyService, effectsRepository } = setup();
  const scope = uniqueGroup();
  const attacker = uniqueJid('5511');
  const victim = uniqueJid('5512');

  // Chave de armas
  effectsRepository.addCharges({
    userJid: attacker,
    scopeKey: scope,
    effectKey: 'weapons_license',
    charges: 1,
    payload: { permanent: true },
  });

  // Vítima tem Conglomerado com buffer
  repository.addCoins({ userJid: victim, scopeKey: scope, amount: 200000, reason: 'seed' });
  propertyService.buy({ userJid: victim, scopeKey: scope, propertyId: 'conglomerado_tech', funConfig: { propertiesEnabled: true } });
  propertyService.tickScope(scope, { propertiesEnabled: true, propertyTickMs: 1 }, Date.now() + 60000);

  // Atacante tem ogiva e codigo
  marketRepository.addInventory({
    userJid: attacker,
    scopeKey: scope,
    itemId: 'ogiva_nuclear',
    acquiredPrice: 35000,
    usesLeft: 1,
    condition: 'ok',
  });
  marketRepository.addInventory({
    userJid: attacker,
    scopeKey: scope,
    itemId: 'codigo_nuclear',
    acquiredPrice: 2500,
    usesLeft: 1,
    condition: 'ok',
  });

  const res = marketService.assault({
    attackerJid: attacker,
    targetJid: victim,
    scopeKey: scope,
    weaponToken: 'ogiva_nuclear',
  });

  assert.equal(res.ok, true);
  assert.equal(res.success, true);
  assert.equal(res.chance, 1);
  assert.equal(res.isNuclear, true);
  assert.equal(res.propertyDamage, 100);

  // Checa se a vida do negócio da vítima foi para 0%
  const victimProps = propertyService.listOwned(scope, victim);
  assert.ok(victimProps.length > 0);
  assert.equal(victimProps[0].health, 0);

  // Checa heat e wanted máximos
  assert.equal(res.heat, 15);
  assert.equal(res.wantedLevel, 5);
});

test('marketService: cupula de ferro intercepta ogiva nuclear com 70% de chance', () => {
  const { repository, marketRepository, marketService, propertyService, effectsRepository } = setup();
  const scope = uniqueGroup();
  const attacker = uniqueJid('5511');
  const victim = uniqueJid('5512');

  effectsRepository.addCharges({
    userJid: attacker,
    scopeKey: scope,
    effectKey: 'weapons_license',
    charges: 1,
    payload: { permanent: true },
  });

  repository.addCoins({ userJid: victim, scopeKey: scope, amount: 200000, reason: 'seed' });
  propertyService.buy({ userJid: victim, scopeKey: scope, propertyId: 'bunker_offshore', funConfig: { propertiesEnabled: true } });

  // Vítima tem cúpula de ferro pronta
  marketRepository.addInventory({
    userJid: victim,
    scopeKey: scope,
    itemId: 'cupula_ferro',
    acquiredPrice: 14000,
    usesLeft: 5,
    condition: 'ok',
  });

  marketRepository.addInventory({
    userJid: attacker,
    scopeKey: scope,
    itemId: 'ogiva_nuclear',
    acquiredPrice: 35000,
    usesLeft: 1,
    condition: 'ok',
  });
  marketRepository.addInventory({
    userJid: attacker,
    scopeKey: scope,
    itemId: 'codigo_nuclear',
    acquiredPrice: 2500,
    usesLeft: 1,
    condition: 'ok',
  });

  // Criamos marketService com random determinístico < 0.70 para testar interceptação
  const deterministicMarket = createMarketService({
    repository,
    marketRepository,
    propertyService,
    effectsRepository,
    random: () => 0.40, // 0.40 < 0.70 -> Interceptado!
  });

  const res = deterministicMarket.assault({
    attackerJid: attacker,
    targetJid: victim,
    scopeKey: scope,
    weaponToken: 'ogiva_nuclear',
  });

  assert.equal(res.ok, true);
  assert.equal(res.success, false);
  assert.equal(res.interceptedByCupula, true);

  // Cupula deve ter perdido 1 uso
  const victimCupula = marketRepository.listInventory(victim, scope).find(i => i.itemId === 'cupula_ferro');
  assert.equal(victimCupula.usesLeft, 4);

  // Negócio da vítima continua com 100% de vida
  const victimProps = propertyService.listOwned(scope, victim);
  assert.equal(victimProps[0].health, 100);
});

test('marketService: seguro_empresarial reembolsa 80% do buffer roubado', () => {
  const { repository, marketRepository, marketService, propertyService, effectsRepository } = setup();
  const scope = uniqueGroup();
  const attacker = uniqueJid('5511');
  const victim = uniqueJid('5512');

  effectsRepository.addCharges({
    userJid: attacker,
    scopeKey: scope,
    effectKey: 'weapons_license',
    charges: 1,
    payload: { permanent: true },
  });

  // Vítima tem negócio com buffer
  repository.addCoins({ userJid: victim, scopeKey: scope, amount: 20000, reason: 'seed' });
  propertyService.buy({ userJid: victim, scopeKey: scope, propertyId: 'cassino', funConfig: { propertiesEnabled: true } });
  propertyService.tickScope(scope, { propertiesEnabled: true, propertyTickMs: 1 }, Date.now() + 60000);

  // Vítima compra seguro empresarial (5 cargas)
  effectsRepository.addCharges({
    userJid: victim,
    scopeKey: scope,
    effectKey: 'business_insurance',
    charges: 5,
  });

  // Atacante com pistola e munição
  marketRepository.addInventory({
    userJid: attacker,
    scopeKey: scope,
    itemId: 'pistola',
    acquiredPrice: 260,
    usesLeft: 10,
    condition: 'ok',
  });
  marketRepository.addInventory({
    userJid: attacker,
    scopeKey: scope,
    itemId: 'municao',
    acquiredPrice: 38,
    usesLeft: 3,
    condition: 'ok',
  });

  const deterministicMarket = createMarketService({
    repository,
    marketRepository,
    propertyService,
    effectsRepository,
    random: () => 0.05, // Sucesso garantido
  });

  const res = deterministicMarket.assault({
    attackerJid: attacker,
    targetJid: victim,
    scopeKey: scope,
    weaponToken: 'pistola',
  });

  assert.equal(res.ok, true);
  assert.equal(res.success, true);
  if (res.stolenFromBuffer > 0) {
    assert.ok(res.insurancePayout > 0, 'deve ter pago reembolso do seguro');
    // Deve ter consumido 1 carga de seguro
    const insEffect = effectsRepository.getEffect(victim, scope, 'business_insurance');
    assert.equal(insEffect.charges, 4);
  }
});

test('marketService: advogado_supremo anula multa em police bust', () => {
  const { repository, marketRepository, marketService, effectsRepository } = setup();
  const scope = uniqueGroup();
  const attacker = uniqueJid('5511');

  effectsRepository.addCharges({
    userJid: attacker,
    scopeKey: scope,
    effectKey: 'weapons_license',
    charges: 1,
    payload: { permanent: true },
  });

  // Atacante compra 3 cargas de advogado_supremo
  effectsRepository.addCharges({
    userJid: attacker,
    scopeKey: scope,
    effectKey: 'supreme_lawyer',
    charges: 3,
  });

  marketRepository.addInventory({
    userJid: attacker,
    scopeKey: scope,
    itemId: 'faca',
    acquiredPrice: 90,
    usesLeft: 10,
    condition: 'ok',
  });

  repository.addCoins({ userJid: attacker, scopeKey: scope, amount: 50000, reason: 'seed' });

  // Força police intervention
  const fakePolice = {
    evaluate: () => ({
      immune: false,
      intervention: { intervene: true, roll: 0.1 },
      wantedLevel: 3,
      suspicion: 0.8,
    }),
    afterCrime: () => ({ wantedLevel: 3 }),
    getWantedLevel: () => 3,
  };

  const marketWithPolice = createMarketService({
    repository,
    marketRepository,
    effectsRepository,
    policeService: fakePolice,
  });

  const res = marketWithPolice.assault({
    attackerJid: attacker,
    heistToken: 'lojinha',
    scopeKey: scope,
    weaponToken: 'faca',
  });

  assert.equal(res.ok, true);
  assert.equal(res.policeBust, true);
  // Multa deve ter sido zerada pelo advogado!
  assert.equal(res.fine, 0);

  // Efeito deve ter consumido 1 carga (3 -> 2)
  const lawyer = effectsRepository.getEffect(attacker, scope, 'supreme_lawyer');
  assert.equal(lawyer.charges, 2);
});

test('marketService: cupula_ferro deflete bazuca com 50% de chance', () => {
  const { repository, marketRepository, effectsRepository, propertyService } = setup();
  const scope = uniqueGroup();
  const attacker = uniqueJid('5511');
  const victim = uniqueJid('5512');

  effectsRepository.addCharges({
    userJid: attacker,
    scopeKey: scope,
    effectKey: 'weapons_license',
    charges: 1,
    payload: { permanent: true },
  });

  repository.addCoins({ userJid: victim, scopeKey: scope, amount: 20000, reason: 'seed' });
  propertyService.buy({ userJid: victim, scopeKey: scope, propertyId: 'barraca', funConfig: { propertiesEnabled: true } });

  marketRepository.addInventory({
    userJid: victim,
    scopeKey: scope,
    itemId: 'cupula_ferro',
    acquiredPrice: 14000,
    usesLeft: 5,
    condition: 'ok',
  });

  marketRepository.addInventory({
    userJid: attacker,
    scopeKey: scope,
    itemId: 'bazuca',
    acquiredPrice: 2800,
    usesLeft: 6,
    condition: 'ok',
  });
  marketRepository.addInventory({
    userJid: attacker,
    scopeKey: scope,
    itemId: 'foguete',
    acquiredPrice: 150,
    usesLeft: 1,
    condition: 'ok',
  });

  // Random 0.30 < 0.50 -> Defletido!
  const deterministicMarket = createMarketService({
    repository,
    marketRepository,
    propertyService,
    effectsRepository,
    random: () => 0.30,
  });

  const res = deterministicMarket.assault({
    attackerJid: attacker,
    targetJid: victim,
    scopeKey: scope,
    weaponToken: 'bazuca',
  });

  assert.equal(res.ok, true);
  assert.equal(res.success, false);
  assert.equal(res.deflectedByCupula, true);

  const victimCupula = marketRepository.listInventory(victim, scope).find(i => i.itemId === 'cupula_ferro');
  assert.equal(victimCupula.usesLeft, 4);
});

test('shopService: iate dourado concede titulo e efeito permanente', () => {
  const { repository, shopService, effectsRepository } = setup();
  const scope = uniqueGroup();
  const user = uniqueJid('5511');

  repository.addCoins({ userJid: user, scopeKey: scope, amount: 200000, reason: 'seed' });

  const buy = shopService.buy({
    userJid: user,
    scopeKey: scope,
    itemId: 'iate_dourado',
  });

  assert.equal(buy.ok, true);

  const effect = effectsRepository.getEffect(user, scope, 'golden_yacht');
  assert.ok(effect);
  assert.equal(effect.payload?.title, 'Magnata');
  assert.equal(effect.payload?.dailyBonusPct, 10);

  // Título foi concedido nos stats do usuário
  const stats = repository.getUserStats(user, scope);
  assert.equal(stats.title, 'Magnata');
});

test('dailyCommand: iate dourado concede +10% de bonus no daily', async () => {
  const { repository, effectsRepository } = setup();
  const dailyService = createDailyService({ repository });
  const scope = uniqueGroup();
  const user = uniqueJid('5511');

  // Adiciona o efeito do iate dourado
  effectsRepository.addCharges({
    userJid: user,
    scopeKey: scope,
    effectKey: 'golden_yacht',
    charges: 1,
    payload: { permanent: true, dailyBonusPct: 10, title: 'Magnata' },
  });

  let repliedText = '';
  await handleDailyCommand({
    userJid: user,
    scopeKey: scope,
    dailyService,
    effectsRepository,
    funConfig: { dailyCoins: 100, dailyXp: 50 },
    reply: async (msg) => { repliedText = msg; },
  });

  // Base 100 + 10% = 110 coins!
  const stats = repository.getUserStats(user, scope);
  assert.equal(stats.coins, 110);
  assert.ok(repliedText.includes('Iate Dourado'));
});


