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
