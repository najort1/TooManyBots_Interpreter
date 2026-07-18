import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import {
  _resetDefaultFunStatsRepository,
  createFunStatsRepository,
} from '../fun/db/funStatsRepository.js';
import { createFunAchievementRepository } from '../fun/db/funAchievementRepository.js';
import { createAchievementService } from '../fun/services/achievementService.js';
import { ACHIEVEMENTS } from '../fun/constants.js';

await initDb();
_resetDefaultFunStatsRepository();

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

function uniqueJid() {
  return `5511${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 90 + 10)}@s.whatsapp.net`;
}

test('achievements: catalog e unlock idempotente', () => {
  const repository = createFunStatsRepository({ getDatabase: getDb });
  repository.ensureFunSchema();
  const achievementRepository = createFunAchievementRepository({ getDatabase: getDb });
  const service = createAchievementService({ achievementRepository, repository });

  assert.ok(Object.keys(ACHIEVEMENTS).length >= 8);

  const scope = uniqueGroup();
  const u = uniqueJid();
  repository.addCoins({ userJid: u, scopeKey: scope, amount: 2500, reason: 'seed' });

  const first = service.check(u, scope, 'coins', { coins: 2500 }, {});
  assert.ok(first.some((a) => a.id === 'coins_2k'));

  const second = service.check(u, scope, 'coins', { coins: 2500 }, {});
  assert.equal(second.length, 0);

  const list = service.listUser(scope, u);
  assert.ok(list.some((a) => a.id === 'coins_2k'));
});

test('achievements: counters assault e crash', () => {
  const repository = createFunStatsRepository({ getDatabase: getDb });
  repository.ensureFunSchema();
  const achievementRepository = createFunAchievementRepository({ getDatabase: getDb });
  const service = createAchievementService({ achievementRepository, repository });
  const scope = uniqueGroup();
  const u = uniqueJid();

  for (let i = 0; i < 14; i++) {
    assert.equal(service.check(u, scope, 'assault_win', {}, {}).length, 0);
  }
  const hit = service.check(u, scope, 'assault_win', {}, {});
  assert.ok(hit.some((a) => a.id === 'assault_win_15'));

  for (let i = 0; i < 4; i++) {
    service.check(u, scope, 'crash_loss', {}, {});
  }
  const crash = service.check(u, scope, 'crash_loss', {}, {});
  assert.ok(crash.some((a) => a.id === 'crash_unlucky_5'));

  const longshot = service.check(u, scope, 'crash_win', { mult: 5.2 }, {});
  assert.ok(longshot.some((a) => a.id === 'longshot_win'));
});
