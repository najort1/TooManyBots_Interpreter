import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import {
  _resetDefaultFunStatsRepository,
  createFunStatsRepository,
} from '../fun/db/funStatsRepository.js';
import { createFunMarketRepository } from '../fun/db/funMarketRepository.js';
import { createFunCasinoRepository } from '../fun/db/funCasinoRepository.js';
import { createFunFactionRepository } from '../fun/db/funFactionRepository.js';
import { startFunDashboardServer } from '../fun/dashboard/server.js';
import { computeGini } from '../fun/economy/regulator.js';

await initDb();
_resetDefaultFunStatsRepository();

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

function uniqueJid(prefix = '5511') {
  return `${prefix}${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 90 + 10)}@s.whatsapp.net`;
}

test('dashboard economia: GET /api/fun/economy/metrics e POST /api/fun/economy/intervene', async () => {
  const scopeKey = uniqueGroup();
  const adminKey = 'secret-test-admin-key';
  process.env.FUN_DASHBOARD_API_KEY = adminKey;

  const statsRepo = createFunStatsRepository();
  const marketRepo = createFunMarketRepository();
  const casinoRepo = createFunCasinoRepository();
  const factionRepo = createFunFactionRepository();

  // Configura saldos iniciais de 5 jogadores com distribuição desigual
  const user1 = uniqueJid('551191');
  const user2 = uniqueJid('551192');
  const user3 = uniqueJid('551193');
  const user4 = uniqueJid('551194');
  const user5 = uniqueJid('551195');

  statsRepo.addCoins({ userJid: user1, scopeKey, amount: 10000, reason: 'test-rich' });
  statsRepo.addCoins({ userJid: user2, scopeKey, amount: 2000, reason: 'test-mid' });
  statsRepo.addCoins({ userJid: user3, scopeKey, amount: 500, reason: 'test-mid' });
  statsRepo.addCoins({ userJid: user4, scopeKey, amount: 100, reason: 'test-base' });
  statsRepo.addCoins({ userJid: user5, scopeKey, amount: 50, reason: 'test-base' });

  // Membros passivos: 15 membros com saldo 0 (só conversam, não jogam a economia)
  const passiveJids = Array.from({ length: 15 }, (_, i) => uniqueJid(`551198${i}`));
  for (const pj of passiveJids) {
    // Registra a linha no escopo sem nunca creditar moedas (saldo 0)
    statsRepo.ensureUserRow(pj, scopeKey);
  }

  // Cria facção com cofre
  const facCreated = factionRepo.createFaction({
    scopeKey,
    name: 'Cartel do Pix',
    emoji: '💰',
    leaderJid: user1,
  });
  const factionId = facCreated.faction.id;
  factionRepo.depositToVault({ factionId, amount: 3500 });

  // Jackpot inicial
  casinoRepo.addJackpot(scopeKey, 1500);

  const fakeFunModule = {
    _services: {
      repository: statsRepo,
      groupRepository: {
        listAll: () => [{ jid: scopeKey, name: 'Grupo Economia Teste', settings: {} }],
        getSettings: () => ({}),
      },
      casinoRepository: casinoRepo,
      marketRepository: marketRepo,
      factionRepository: factionRepo,
    },
  };

  const allowedScopes = [scopeKey];
  const server = await startFunDashboardServer({
    port: 0,
    getConfig: () => ({
      dashboardHost: '127.0.0.1',
      dashboardAllowedOrigins: ['http://127.0.0.1:3000'],
      groupWhitelistJids: allowedScopes,
    }),
    funModule: fakeFunModule,
    getContactDisplayName: (jid) => (jid === scopeKey ? 'Grupo Economia Teste' : 'Player'),
    isSocketReady: () => true,
    getSock: () => ({ user: { id: 'bot@s.whatsapp.net' } }),
    sendText: async () => {},
  });

  const { port } = server.address();
  const api = `http://127.0.0.1:${port}`;

  try {
    // 1) GET /api/fun/economy/metrics sem auth (leitura pública permitida para escopo autorizado)
    const metricsRes = await fetch(`${api}/api/fun/economy/metrics?scope=${encodeURIComponent(scopeKey)}`);
    assert.equal(metricsRes.status, 200);
    const metrics = await metricsRes.json();

    assert.equal(metrics.ok, true);
    assert.equal(metrics.scope, scopeKey);
    assert.equal(metrics.groupName, 'Grupo Economia Teste');
    assert.equal(metrics.circulatingCoins, 12650);
    assert.ok(metrics.baselineCoins > 0);
    assert.ok(metrics.gini > 0 && metrics.gini <= 1);
    assert.equal(metrics.activePlayers, 5);

    // Participação econômica: 5 econômicos de 20 membros (15 passivos com saldo 0)
    assert.equal(metrics.economicPlayers, 5);
    assert.equal(metrics.totalMembers, 20);
    assert.equal(metrics.passiveMembers, 15);
    assert.equal(metrics.participationRate, 0.25);

    assert.equal(metrics.jackpot, 1500);
    assert.equal(metrics.factionsCount, 1);
    assert.equal(metrics.factionsVaultTotal, 3500);
    assert.ok(['stable', 'inflationary', 'deflationary', 'high_inequality', 'hyperinflation'].includes(metrics.inflationState));
    assert.ok(typeof metrics.inflationLabel === 'string');

    // Gini calculado apenas sobre os 5 jogadores econômicos (sem os 15 zeros)
    // Com [10000, 2000, 500, 100, 50]: gini ≈ 0.689 — NÃO deve explodir para ~0.9+
    // que aconteceria se os 15 saldos 0 fossem incluídos.
    const giniOnlyEconomic = computeGini([10000, 2000, 500, 100, 50]);
    assert.equal(metrics.gini, giniOnlyEconomic);

    // Wealth distribution calculada sobre jogadores econômicos
    assert.ok(metrics.wealthDistribution);
    assert.ok(metrics.wealthDistribution.top1Percent > 0);
    assert.ok(metrics.wealthDistribution.top10Percent > 0);
    assert.ok(Array.isArray(metrics.wealthDistribution.brackets));
    assert.equal(metrics.wealthDistribution.brackets.length, 4);
    // Soma dos jogadores nos brackets deve fechar com os econômicos (5), não com 20
    const bracketPlayersTotal = metrics.wealthDistribution.brackets.reduce(
      (acc, b) => acc + b.players,
      0
    );
    assert.equal(bracketPlayersTotal, 5);

    // Regulator knobs
    assert.ok(metrics.regulator);
    assert.equal(metrics.regulator.volMult, 1);
    assert.equal(metrics.regulator.rewardMult, 1);

    // 2) POST /api/fun/economy/intervene sem auth (deve falhar 401)
    const noAuthRes = await fetch(`${api}/api/fun/economy/intervene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: scopeKey,
        action: 'inject_jackpot',
        amount: 500,
      }),
    });
    assert.equal(noAuthRes.status, 401);

    // 3) POST /api/fun/economy/intervene com auth: inject_jackpot
    const injectRes = await fetch(`${api}/api/fun/economy/intervene`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': adminKey,
      },
      body: JSON.stringify({
        scope: scopeKey,
        action: 'inject_jackpot',
        amount: 2500,
      }),
    });
    assert.equal(injectRes.status, 200);
    const injectJson = await injectRes.json();
    assert.equal(injectJson.ok, true);
    assert.equal(injectJson.action, 'inject_jackpot');
    assert.equal(injectJson.previousValue, 1500);
    assert.equal(injectJson.newValue, 4000);

    // 4) POST /api/fun/economy/intervene: burn_jackpot
    const burnRes = await fetch(`${api}/api/fun/economy/intervene`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': adminKey,
      },
      body: JSON.stringify({
        scope: scopeKey,
        action: 'burn_jackpot',
        amount: 1000,
      }),
    });
    assert.equal(burnRes.status, 200);
    const burnJson = await burnRes.json();
    assert.equal(burnJson.ok, true);
    assert.equal(burnJson.action, 'burn_jackpot');
    assert.equal(burnJson.previousValue, 4000);
    assert.equal(burnJson.newValue, 3000);

    // 5) POST /api/fun/economy/intervene: set_baseline
    const baselineRes = await fetch(`${api}/api/fun/economy/intervene`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': adminKey,
      },
      body: JSON.stringify({
        scope: scopeKey,
        action: 'set_baseline',
        amount: 25000,
      }),
    });
    assert.equal(baselineRes.status, 200);
    const baselineJson = await baselineRes.json();
    assert.equal(baselineJson.ok, true);
    assert.equal(baselineJson.newValue, 25000);

    // 6) POST /api/fun/economy/intervene: trigger_seed
    const seedRes = await fetch(`${api}/api/fun/economy/intervene`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': adminKey,
      },
      body: JSON.stringify({
        scope: scopeKey,
        action: 'trigger_seed',
        seed: 'liquidity_wave',
      }),
    });
    assert.equal(seedRes.status, 200);
    const seedJson = await seedRes.json();
    assert.equal(seedJson.ok, true);
    assert.ok(seedJson.newValue.includes('liquidity_wave'));

    // 7) POST /api/fun/economy/intervene: adjust_knobs
    const knobsRes = await fetch(`${api}/api/fun/economy/intervene`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': adminKey,
      },
      body: JSON.stringify({
        scope: scopeKey,
        action: 'adjust_knobs',
        knobs: {
          volMult: 1.5,
          rewardMult: 1.2,
          deceptionRate: 0.20,
        },
      }),
    });
    assert.equal(knobsRes.status, 200);
    const knobsJson = await knobsRes.json();
    assert.equal(knobsJson.ok, true);
    assert.equal(knobsJson.newValue.volMult, 1.5);
    assert.equal(knobsJson.newValue.rewardMult, 1.2);
    assert.equal(knobsJson.newValue.deceptionRate, 0.20);

    // 8) Re-verificação de métricas após intervenções
    const metricsAfterRes = await fetch(`${api}/api/fun/economy/metrics?scope=${encodeURIComponent(scopeKey)}`);
    assert.equal(metricsAfterRes.status, 200);
    const metricsAfter = await metricsAfterRes.json();
    assert.equal(metricsAfter.jackpot, 3000);
    assert.equal(metricsAfter.baselineCoins, 25000);
    assert.equal(metricsAfter.regulator.volMult, 1.5);
    assert.ok(metricsAfter.regulator.narrativeSeeds.includes('liquidity_wave'));

    // 9) POST /api/fun/economy/intervene: burn_jackpot sem amount queima todo o saldo restante
    const burnAllRes = await fetch(`${api}/api/fun/economy/intervene`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': adminKey,
      },
      body: JSON.stringify({
        scope: scopeKey,
        action: 'burn_jackpot',
      }),
    });
    assert.equal(burnAllRes.status, 200);
    const burnAllJson = await burnAllRes.json();
    assert.equal(burnAllJson.ok, true);
    assert.equal(burnAllJson.newValue, 0);

    // 10) Ação desconhecida / inválida retorna 400
    const invalidActionRes = await fetch(`${api}/api/fun/economy/intervene`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': adminKey,
      },
      body: JSON.stringify({
        scope: scopeKey,
        action: 'acao_fantasma',
      }),
    });
    assert.equal(invalidActionRes.status, 400);

    // 11) Scope não permitido retorna 404
    const unallowedRes = await fetch(`${api}/api/fun/economy/metrics?scope=99999999@g.us`);
    assert.equal(unallowedRes.status, 404);

    // 12) set_baseline com valor inválido (< 1 ou > 100 bilhões) retorna 400
    const invalidBaselineRes = await fetch(`${api}/api/fun/economy/intervene`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': adminKey,
      },
      body: JSON.stringify({
        scope: scopeKey,
        action: 'set_baseline',
        amount: -50,
      }),
    });
    assert.equal(invalidBaselineRes.status, 400);

    // 13) trigger_seed sanitiza slug com caracteres especiais e espaços
    const seedSanitizeRes = await fetch(`${api}/api/fun/economy/intervene`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': adminKey,
      },
      body: JSON.stringify({
        scope: scopeKey,
        action: 'trigger_seed',
        seed: 'CRASH PETROLEO 2026!',
      }),
    });
    assert.equal(seedSanitizeRes.status, 200);
    const seedSanitizeJson = await seedSanitizeRes.json();
    assert.ok(seedSanitizeJson.newValue.some(s => s.startsWith('crash_petroleo')));

    // 14) Grupo vazio (0 jogadores, 0 moedas) - sem divisão por zero ou NaN
    const emptyScope = uniqueGroup();
    allowedScopes.push(emptyScope);
    fakeFunModule._services.groupRepository = {
      listAll: () => [
        { jid: scopeKey, name: 'Grupo Economia Teste', settings: {} },
        { jid: emptyScope, name: 'Grupo Vazio', settings: {} },
      ],
      getSettings: () => ({}),
    };
    const emptyMetricsRes = await fetch(`${api}/api/fun/economy/metrics?scope=${encodeURIComponent(emptyScope)}`);
    assert.equal(emptyMetricsRes.status, 200);
    const emptyMetrics = await emptyMetricsRes.json();
    assert.equal(emptyMetrics.circulatingCoins, 0);
    assert.equal(emptyMetrics.gini, 0);
    assert.equal(emptyMetrics.wealthDistribution.top1Percent, 0);
    assert.equal(emptyMetrics.wealthDistribution.top10Percent, 0);
    assert.equal(emptyMetrics.wealthDistribution.bottom50Percent, 0);
    for (const b of emptyMetrics.wealthDistribution.brackets) {
      assert.equal(b.percentage, 0);
      assert.equal(b.totalCoins, 0);
    }
  } finally {
    server.close();
  }
});
