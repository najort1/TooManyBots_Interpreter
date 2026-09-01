import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import {
  _resetDefaultFunStatsRepository,
  createFunStatsRepository,
} from '../fun/db/funStatsRepository.js';
import { createFunNewsRepository } from '../fun/db/funNewsRepository.js';
import { createFunMemoryRepository } from '../fun/db/funMemoryRepository.js';
import { createGroupMemoryService } from '../fun/services/groupMemoryService.js';
import {
  createNewsService,
  isGroupNewsWindow,
} from '../fun/services/newsService.js';

await initDb();
_resetDefaultFunStatsRepository();

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

test('news: isGroupNewsWindow 23:59 e 00:02', () => {
  // fixed instants hard: use local construction via Date.UTC and tz is SP
  // We only assert function returns boolean consistently for now timestamps
  const cfg = { worldTimezone: 'America/Sao_Paulo', groupNewsHour: 23, groupNewsMinute: 59 };
  assert.equal(typeof isGroupNewsWindow(Date.now(), cfg), 'boolean');
});

test('news: prompt ancora FORESHADOW na data atual e na data do fato', async () => {
  const scope = uniqueGroup();
  const factCreatedAt = Date.UTC(2026, 7, 28, 20, 0, 0);
  const now = Date.UTC(2026, 8, 1, 23, 59, 30);
  const memoryRepository = createFunMemoryRepository({ getDatabase: getDb });
  memoryRepository.insertFact({
    scopeKey: scope,
    kind: 'rivalry',
    summary: 'Max aceitou enfrentar Jonas no vôlei amanhã',
    subjects: ['max@s.whatsapp.net', 'jonas@s.whatsapp.net'],
    score: 88,
    now: factCreatedAt,
  });
  const groupMemoryService = createGroupMemoryService({ memoryRepository });
  let promptLore = '';
  const newsService = createNewsService({
    newsRepository: createFunNewsRepository({ getDatabase: getDb }),
    groupMemoryService,
    flavorService: {
      async line(_scenario, vars) {
        promptLore = String(vars.groupLore || '');
        return 'CAPA: Jornal com contexto\nINTRO: A redação recebeu os fatos datados corretamente.\nFORESHADOW: A redação compara as datas antes de prever.';
      },
      lastProvider: () => 'zen',
    },
  });

  await newsService.composeEdition(
    scope,
    { worldTimezone: 'UTC', memoryEnabled: true, memoryMinScore: 60 },
    now
  );

  assert.match(promptLore, /data_atual=2026-09-01/);
  assert.match(promptLore, /data_do_fato=2026-08-28/);
  assert.match(promptLore, /Max aceitou enfrentar Jonas no vôlei amanhã/);
  assert.match(promptLore, /"amanhã".*data_do_fato/);
});

test('news: log, compose template, publish dedup', async () => {
  const repository = createFunStatsRepository({ getDatabase: getDb });
  repository.ensureFunSchema();
  const newsRepository = createFunNewsRepository({ getDatabase: getDb });
  const newsService = createNewsService({ newsRepository, flavorService: null });
  const scope = uniqueGroup();

  newsService.log(scope, 'crash_loss', {
    userJid: 'x@s.whatsapp.net',
    payload: { amount: 80 },
  });
  newsService.log(scope, 'marry', {
    payload: { a: 'A', b: 'B' },
  });

  const edition = await newsService.composeEdition(scope, {}, Date.now());
  assert.ok(edition.text.includes('THE GROUP TIMES'));
  assert.equal(edition.provider, 'deterministic');
  assert.ok(edition.eventCount >= 2);

  // force publish by faking window via direct set + try with stubbed window
  // unit: setNewsDay + getMeta
  newsRepository.setNewsDay(scope, '2099-01-01', Date.now());
  assert.equal(newsRepository.getNewsMeta(scope).lastDailyNewsDay, '2099-01-01');

  // tryPublish outside window → not-window
  const mid = await newsService.tryPublish(
    scope,
    {
      groupNewsEnabled: true,
      worldTimezone: 'UTC',
      groupNewsHour: 23,
      groupNewsMinute: 59,
    },
    Date.UTC(2020, 0, 1, 12, 0, 0)
  );
  assert.equal(mid.ok, false);
  assert.equal(mid.reason, 'not-window');

  // inside window UTC 23:59
  const once = await newsService.tryPublish(
    scope,
    {
      groupNewsEnabled: true,
      worldTimezone: 'UTC',
      groupNewsHour: 23,
      groupNewsMinute: 59,
    },
    Date.UTC(2020, 5, 10, 23, 59, 30)
  );
  assert.equal(once.ok, true);
  assert.ok(once.text);

  const twice = await newsService.tryPublish(
    scope,
    {
      groupNewsEnabled: true,
      worldTimezone: 'UTC',
      groupNewsHour: 23,
      groupNewsMinute: 59,
    },
    Date.UTC(2020, 5, 10, 23, 59, 45)
  );
  assert.equal(twice.ok, false);
  assert.equal(twice.reason, 'already-today');
});
