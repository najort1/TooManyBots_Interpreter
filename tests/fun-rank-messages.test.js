import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createFunModule, parseFunCommand, resolveFunConfig } from '../fun/index.js';
import { _resetDefaultFunStatsRepository } from '../fun/db/funStatsRepository.js';
import { FUN_COMMANDS } from '../fun/constants.js';

await initDb();
_resetDefaultFunStatsRepository();

test('parseFunCommand: topmsg aliases', () => {
  assert.equal(parseFunCommand('/topmsg', '/').command, FUN_COMMANDS.RANK_MESSAGES);
  assert.equal(parseFunCommand('/mensagens', '/').command, FUN_COMMANDS.RANK_MESSAGES);
  assert.equal(parseFunCommand('/maisativos', '/').command, FUN_COMMANDS.RANK_MESSAGES);
  assert.equal(parseFunCommand('/rankmsg', '/').command, FUN_COMMANDS.RANK_MESSAGES);
});
