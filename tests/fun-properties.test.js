import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import {
  _resetDefaultFunStatsRepository,
  createFunStatsRepository,
} from '../fun/db/funStatsRepository.js';
import { createFunPropertyRepository } from '../fun/db/funPropertyRepository.js';
import { createPropertyService } from '../fun/services/propertyService.js';
import { getProperty } from '../fun/shop/properties.js';
import { handlePropertyCommand } from '../fun/commands/handlers/property.js';

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
  const propertyRepository = createFunPropertyRepository({ getDatabase: getDb });
  const propertyService = createPropertyService({ repository, propertyRepository });
  return { repository, propertyRepository, propertyService };
}

test('properties: catálogo e aliases', () => {
  assert.ok(getProperty('barraca'));
  assert.equal(getProperty('pastel')?.id, 'barraca');
  assert.equal(getProperty('cassino')?.cost, 4500);
  assert.equal(getProperty('firma')?.incomePerTick, 55);
});

test('properties: compra, buffer tick, coletar, assalto buffer', () => {
  const { repository, propertyService } = setup();
  const scope = uniqueGroup();
  const owner = uniqueJid('5511');
  const robber = uniqueJid('5512');
  const cfg = { propertiesEnabled: true, propertyTickMs: 1000, propertyMaxOwned: 2 };

  repository.addCoins({ userJid: owner, scopeKey: scope, amount: 5000, reason: 'seed' });

  const buy = propertyService.buy({
    userJid: owner,
    scopeKey: scope,
    propertyId: 'barraca',
    funConfig: cfg,
  });
  assert.equal(buy.ok, true);
  assert.equal(buy.def.id, 'barraca');

  const again = propertyService.buy({
    userJid: owner,
    scopeKey: scope,
    propertyId: 'barraca',
    funConfig: cfg,
  });
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'already-owned');

  // força last_tick no passado
  const owned = propertyService.listOwned(scope, owner);
  assert.equal(owned.length, 1);
  const propId = owned[0].id;
  // set lastTickAt to 0 via tick after manual buffer
  propertyService.tickScope(scope, cfg, Date.now() + 60_000);
  const afterTick = propertyService.listOwned(scope, owner)[0];
  assert.ok(afterTick.bufferCoins > 0, 'buffer should fill');

  const bufBefore = afterTick.bufferCoins;
  const rob = propertyService.robBuffer({
    targetJid: owner,
    scopeKey: scope,
    maxWant: 100,
  });
  assert.ok(rob.stolen > 0);
  assert.equal(rob.source, 'buffer');
  assert.ok(rob.damage > 0);

  const afterRob = propertyService.listOwned(scope, owner)[0];
  assert.ok(afterRob.bufferCoins < bufBefore);
  assert.ok(afterRob.health < 100);

  // repor buffer e coletar
  propertyService.tickScope(scope, { ...cfg, propertyTickMs: 1 }, Date.now() + 120_000);
  const col = propertyService.collect({ userJid: owner, scopeKey: scope, funConfig: cfg });
  assert.equal(col.ok, true);
  assert.ok(col.total > 0);

  const repair = propertyService.repair({
    userJid: owner,
    scopeKey: scope,
    propertyId: 'barraca',
    funConfig: cfg,
  });
  assert.equal(repair.ok, true);
  assert.equal(Math.round(repair.property.health), 100);

  void robber;
  void propId;
});

test('properties: max owned e saldo insuficiente', () => {
  const { repository, propertyService } = setup();
  const scope = uniqueGroup();
  const u = uniqueJid();
  const cfg = { propertiesEnabled: true, propertyMaxOwned: 2 };

  repository.addCoins({ userJid: u, scopeKey: scope, amount: 20000, reason: 'seed' });
  assert.equal(
    propertyService.buy({ userJid: u, scopeKey: scope, propertyId: 'barraca', funConfig: cfg })
      .ok,
    true
  );
  assert.equal(
    propertyService.buy({
      userJid: u,
      scopeKey: scope,
      propertyId: 'cassino',
      funConfig: cfg,
    }).ok,
    true
  );
  const third = propertyService.buy({
    userJid: u,
    scopeKey: scope,
    propertyId: 'firma',
    funConfig: cfg,
  });
  assert.equal(third.ok, false);
  assert.equal(third.reason, 'max-owned');

  const poor = uniqueJid('5519');
  repository.addCoins({ userJid: poor, scopeKey: scope, amount: 10, reason: 'seed' });
  const fail = propertyService.buy({
    userJid: poor,
    scopeKey: scope,
    propertyId: 'barraca',
    funConfig: cfg,
  });
  assert.equal(fail.ok, false);
  assert.equal(fail.reason, 'no-coins');
});

test('properties: venda de propriedade, atualização de saldo, liberação de slot e erros', () => {
  const { repository, propertyService } = setup();
  const scope = uniqueGroup();
  const u = uniqueJid();
  const cfg = { propertiesEnabled: true, propertyMaxOwned: 2 };

  // Saldo inicial suficiente para compras
  repository.addCoins({ userJid: u, scopeKey: scope, amount: 30000, reason: 'seed' });

  // Comprar 2 propriedades (atingir o limite de 2)
  const buy1 = propertyService.buy({ userJid: u, scopeKey: scope, propertyId: 'barraca', funConfig: cfg });
  assert.equal(buy1.ok, true);

  const buy2 = propertyService.buy({ userJid: u, scopeKey: scope, propertyId: 'cassino', funConfig: cfg });
  assert.equal(buy2.ok, true);

  assert.equal(propertyService.listOwned(scope, u).length, 2);

  // Tentar comprar a 3ª propriedade deve falhar por limite de slots
  const buy3Fail = propertyService.buy({ userJid: u, scopeKey: scope, propertyId: 'firma', funConfig: cfg });
  assert.equal(buy3Fail.ok, false);
  assert.equal(buy3Fail.reason, 'max-owned');

  const coinsBeforeSell = repository.getUserStats(u, scope).coins;

  // Vender a 1ª propriedade (barraca: custo 900 -> 50% = 450 coins de reembolso base)
  const sellResult = propertyService.sell({ userJid: u, scopeKey: scope, propertyId: 'barraca', funConfig: cfg });
  assert.equal(sellResult.ok, true);
  assert.equal(sellResult.def.id, 'barraca');
  assert.equal(sellResult.baseRefund, 450);
  assert.equal(sellResult.refund, 450);

  // Verificar atualização correta do saldo
  const coinsAfterSell = repository.getUserStats(u, scope).coins;
  assert.equal(coinsAfterSell, coinsBeforeSell + 450);

  // Slot foi liberado: agora possui apenas 1 propriedade ativa
  assert.equal(propertyService.listOwned(scope, u).length, 1);

  // Com a liberação do slot, agora é possível comprar a 3ª propriedade (firma)
  const buy3Success = propertyService.buy({ userJid: u, scopeKey: scope, propertyId: 'firma', funConfig: cfg });
  assert.equal(buy3Success.ok, true);
  assert.equal(propertyService.listOwned(scope, u).length, 2);

  // Vender a 2ª propriedade (cassino) e a 3ª propriedade (firma) para liberar todos os slots
  const sell2 = propertyService.sell({ userJid: u, scopeKey: scope, propertyId: 'cassino', funConfig: cfg });
  assert.equal(sell2.ok, true);

  const sell3 = propertyService.sell({ userJid: u, scopeKey: scope, propertyId: 'firma', funConfig: cfg });
  assert.equal(sell3.ok, true);

  // Usuário agora não tem nenhuma propriedade e pode possuir todas as 3 sequencialmente se 2 forem vendidas
  assert.equal(propertyService.listOwned(scope, u).length, 0);

  // Tratamento de erro: tentar vender propriedade já vendida / não possuída
  const sellNotOwned = propertyService.sell({ userJid: u, scopeKey: scope, propertyId: 'barraca', funConfig: cfg });
  assert.equal(sellNotOwned.ok, false);
  assert.equal(sellNotOwned.reason, 'not-owned');

  // Tratamento de erro: tentar vender propriedade inexistente no catálogo
  const sellUnknown = propertyService.sell({ userJid: u, scopeKey: scope, propertyId: 'inexistente', funConfig: cfg });
  assert.equal(sellUnknown.ok, false);
  assert.equal(sellUnknown.reason, 'unknown');
});

test('properties: venda com buffer acumulado transfere reembolso base e caixa', () => {
  const { repository, propertyRepository, propertyService } = setup();
  const scope = uniqueGroup();
  const u = uniqueJid();
  const cfg = { propertiesEnabled: true };

  repository.addCoins({ userJid: u, scopeKey: scope, amount: 5000, reason: 'seed' });
  const buy = propertyService.buy({ userJid: u, scopeKey: scope, propertyId: 'barraca', funConfig: cfg });
  assert.equal(buy.ok, true);

  // Injetar bufferCoins no negócio
  const owned = propertyService.listOwned(scope, u)[0];
  propertyRepository.setBuffer(owned.id, 75);

  const coinsBefore = repository.getUserStats(u, scope).coins;
  const sell = propertyService.sell({ userJid: u, scopeKey: scope, propertyId: 'barraca', funConfig: cfg });

  assert.equal(sell.ok, true);
  assert.equal(sell.baseRefund, 450);
  assert.equal(sell.bufferCoins, 75);
  assert.equal(sell.refund, 525);
  assert.equal(repository.getUserStats(u, scope).coins, coinsBefore + 525);
  assert.equal(propertyService.listOwned(scope, u).length, 0);
});

test('properties: handler de comando /negocio vender responde corretamente', async () => {
  const { repository, propertyService } = setup();
  const scope = uniqueGroup();
  const u = uniqueJid();
  const cfg = { propertiesEnabled: true, propertyMaxOwned: 2 };

  repository.addCoins({ userJid: u, scopeKey: scope, amount: 5000, reason: 'seed' });
  propertyService.buy({ userJid: u, scopeKey: scope, propertyId: 'barraca', funConfig: cfg });

  let replyText = '';
  const reply = async (msg) => {
    replyText = msg;
  };

  // Vender barraca
  const res = await handlePropertyCommand({
    userJid: u,
    scopeKey: scope,
    propertyService,
    funConfig: cfg,
    reply,
    args: ['vender', 'barraca'],
  });

  assert.equal(res.handled, true);
  assert.equal(res.result.ok, true);
  assert.ok(replyText.includes('Barraca de Pastel'));
  assert.ok(replyText.includes('450'));
  assert.ok(replyText.includes('450'));

  // Tentativa de vender novamente
  await handlePropertyCommand({
    userJid: u,
    scopeKey: scope,
    propertyService,
    funConfig: cfg,
    reply,
    args: ['vender', 'barraca'],
  });

  assert.ok(replyText.includes('Você não tem esse negócio para vender.'));

  // Tentativa de vender negócio inexistente
  await handlePropertyCommand({
    userJid: u,
    scopeKey: scope,
    propertyService,
    funConfig: cfg,
    reply,
    args: ['vender', 'invalido'],
  });

  assert.ok(replyText.includes('Negócio inválido'));
});

test('properties: formatList inclui instrução de venda', () => {
  const { propertyService } = setup();
  const scope = uniqueGroup();
  const u = uniqueJid();
  const text = propertyService.formatList(scope, u);
  assert.ok(text.includes('/negocio vender <id>'));
});
