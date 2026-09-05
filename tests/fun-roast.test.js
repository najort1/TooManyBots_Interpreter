import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import {
  _resetDefaultFunStatsRepository,
  createFunStatsRepository,
} from '../fun/db/funStatsRepository.js';
import { createRoastService } from '../fun/services/roastService.js';

await initDb();
_resetDefaultFunStatsRepository();

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

function uniqueJid() {
  return `5511${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 90 + 10)}@s.whatsapp.net`;
}

test('roast: dossiê e template sem LLM', async () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repository = createFunStatsRepository({ getDatabase: getDb });
  repository.ensureFunSchema();
  const scope = uniqueGroup();
  const u = uniqueJid();
  repository.addCoins({ userJid: u, scopeKey: scope, amount: 100, reason: 'seed' });
  repository.addCoins({
    userJid: u,
    scopeKey: scope,
    amount: -40,
    reason: 'crash-bet',
  });

  const roastService = createRoastService({
    repository,
    flavorService: null,
  });

  const dossier = roastService.buildDossier({
    userJid: u,
    scopeKey: scope,
    getContactDisplayName: () => 'João Teste',
  });
  assert.equal(dossier.name, 'João Teste');
  assert.ok(dossier.coins >= 0);

  const hit = await roastService.roast({
    userJid: u,
    scopeKey: scope,
    funConfig: { roastEnabled: true },
    getContactDisplayName: () => 'João Teste',
  });
  assert.equal(hit.ok, true);
  assert.ok(hit.text.length > 10);
  assert.equal(hit.provider, 'template');
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('roast: incorpora bio, nick e resumo de lore no dossiê', async () => {
  const repository = createFunStatsRepository({ getDatabase: getDb });
  repository.ensureFunSchema();
  const scope = uniqueGroup();
  const u = uniqueJid();

  let capturedVars = null;
  const flavorService = {
    line: async (scenario, vars) => {
      capturedVars = { scenario, vars };
      return 'Você gasta tudo no tigrinho e ainda quer respeito.';
    },
    lastProvider: () => 'zen',
  };

  const roastService = createRoastService({
    repository,
    flavorService,
    profileService: {
      getProfile: () => ({
        nickname: 'Jão Foguete',
        bio: 'Mestre da procrastinação e fã de pastel',
        title: 'Membro Caótico',
      }),
      getNickname: () => 'Jão Foguete',
    },
    groupMemoryService: {
      buildLoreContext: () => '<group_lore>\n- [running_gag] Sempre pede PIX depois das 23h\n</group_lore>',
    },
  });

  const res = await roastService.roast({
    userJid: u,
    scopeKey: scope,
    funConfig: { roastEnabled: true },
    getContactDisplayName: () => 'João',
  });

  assert.equal(res.ok, true);
  assert.equal(res.provider, 'zen');
  assert.equal(res.dossier.customNick, 'Jão Foguete');
  assert.match(res.dossier.bio, /Mestre da procrastinação/);
  assert.match(res.dossier.loreSummary, /PIX depois das 23h/);
  assert.match(capturedVars.vars.facts, /Jão Foguete/);
  assert.match(capturedVars.vars.facts, /Mestre da procrastinação/);
  assert.match(capturedVars.vars.facts, /PIX depois das 23h/);
});
