import test from 'node:test';
import assert from 'node:assert/strict';
import { startFunDashboardServer } from '../fun/dashboard/server.js';

test('dashboard overview: metrics economy (stable, inflationary, deflationary, high_inequality), activity e botStatus', async () => {
  const scopeKey = '12345678@g.us';

  let mockBalances = [100, 100, 100, 100];
  let mockBaseline = 400;
  let activeUsersCount = 12;

  const mockServices = {
    repository: {
      countUsersInScope: () => 50,
      countActiveUsersInScope: () => activeUsersCount,
      listScopeCoinBalances: () => mockBalances,
      getUserStats: () => ({ coins: 100 }),
      getLeaderboard: () => [{ rank: 1, userJid: 'user1@s.whatsapp.net', xp: 500, level: 5 }],
      getCoinsLeaderboard: () => [{ rank: 1, userJid: 'user1@s.whatsapp.net', coins: 100, level: 5 }],
    },
    groupRepository: {
      getGroupSettings: () => ({ groupJid: scopeKey, enabled: true }),
    },
    casinoRepository: {
      getJackpot: () => ({ pot: 1500 }),
    },
    marketRepository: {
      getMeta: () => ({
        economy: {
          baselineCoins: mockBaseline,
        },
      }),
    },
  };

  const fakeFunModule = {
    _services: mockServices,
  };

  let socketReady = true;

  const server = await startFunDashboardServer({
    port: 0,
    getConfig: () => ({
      dashboardHost: '127.0.0.1',
      groupWhitelistJids: [scopeKey],
    }),
    funModule: fakeFunModule,
    getContactDisplayName: () => 'Jogador Teste',
    isSocketReady: () => socketReady,
  });

  const { port } = server.address();
  const api = `http://127.0.0.1:${port}`;

  try {
    // 1) Caso Estável (balances iguais -> Gini = 0, circulating = 400, baseline = 400)
    const resStable = await fetch(`${api}/api/fun/overview?scope=${encodeURIComponent(scopeKey)}`);
    assert.equal(resStable.status, 200);
    const jsonStable = await resStable.json();
    assert.equal(jsonStable.economy.circulatingCoins, 400);
    assert.equal(jsonStable.economy.baselineCoins, 400);
    assert.equal(jsonStable.economy.healthStatus, 'stable');
    assert.equal(jsonStable.economy.healthLabel, 'Estável');
    assert.equal(jsonStable.economy.gini, 0);
    assert.equal(jsonStable.activity.activePlayers24h, 12);
    assert.equal(typeof jsonStable.botStatus.uptimeSeconds, 'number');
    assert.equal(jsonStable.botStatus.socketReady, true);

    // 2) Caso Inflacionário (circulating > baseline * 1.3)
    mockBalances = [250, 250, 250, 250]; // total 1000 > 400 * 1.3 (520)
    const resInf = await fetch(`${api}/api/fun/overview?scope=${encodeURIComponent(scopeKey)}`);
    const jsonInf = await resInf.json();
    assert.equal(jsonInf.economy.circulatingCoins, 1000);
    assert.equal(jsonInf.economy.healthStatus, 'inflationary');
    assert.equal(jsonInf.economy.healthLabel, 'Pressão Inflacionária');

    // 3) Caso Deflacionário (circulating < baseline * 0.7)
    mockBalances = [50, 50, 50, 50]; // total 200 < 400 * 0.7 (280)
    const resDef = await fetch(`${api}/api/fun/overview?scope=${encodeURIComponent(scopeKey)}`);
    const jsonDef = await resDef.json();
    assert.equal(jsonDef.economy.circulatingCoins, 200);
    assert.equal(jsonDef.economy.healthStatus, 'deflationary');
    assert.equal(jsonDef.economy.healthLabel, 'Contração Monetária');

    // 4) Caso Alta Desigualdade (gini > 0.55 sobre jogadores econômicos)
    mockBalances = [50, 50, 50, 850]; // concentração real entre participantes
    mockBaseline = 1000;
    const resGini = await fetch(`${api}/api/fun/overview?scope=${encodeURIComponent(scopeKey)}`);
    const jsonGini = await resGini.json();
    assert.equal(jsonGini.economy.healthStatus, 'high_inequality');
    assert.equal(jsonGini.economy.healthLabel, 'Alta Desigualdade');
    assert.ok(jsonGini.economy.gini > 0.55);

    // 4b) Membros passivos (saldo 0) NÃO distorcem o Gini nem o healthStatus
    mockBalances = [100, 100, 100, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const resPassive = await fetch(`${api}/api/fun/overview?scope=${encodeURIComponent(scopeKey)}`);
    const jsonPassive = await resPassive.json();
    // 20 saldos listados, mas só 4 com saldo > 0 → gini deve seguir 0 (igualdade entre ativos)
    assert.equal(jsonPassive.economy.gini, 0);
    assert.notEqual(jsonPassive.economy.healthStatus, 'high_inequality');
    // circulatingCoins só soma participantes econômicos (4 * 100 = 400)
    assert.equal(jsonPassive.economy.circulatingCoins, 400);
    // Payload de participação: 4 econômicos de 50 membros registrados (46 passivos)
    assert.equal(jsonPassive.economy.economicPlayers, 4);
    assert.equal(jsonPassive.economy.totalMembers, 50);
    assert.equal(jsonPassive.economy.passiveMembers, 46);
    assert.equal(jsonPassive.economy.participationRate, 0.08);

    // 5) Verificação de botStatus com socket desconectado
    socketReady = false;
    const resDown = await fetch(`${api}/api/fun/overview?scope=${encodeURIComponent(scopeKey)}`);
    const jsonDown = await resDown.json();
    assert.equal(jsonDown.botStatus.socketReady, false);

    // 6) Whitelist de scope: escopo não autorizado retorna 403
    const resUnauthorized = await fetch(`${api}/api/fun/overview?scope=${encodeURIComponent('unauthorized-scope@g.us')}`);
    assert.equal(resUnauthorized.status, 403);
    const jsonUnauthorized = await resUnauthorized.json();
    assert.equal(jsonUnauthorized.error, 'scope-not-allowed');

    // 7) Boundary cases: limiares exatos de inflação e deflação
    // Limiar exato de inflação: 1000 * 1.3 = 1300 (exato não é inflacionário, 1301 é)
    mockBaseline = 1000;
    mockBalances = [325, 325, 325, 325]; // soma = 1300
    const resExact1300 = await fetch(`${api}/api/fun/overview?scope=${encodeURIComponent(scopeKey)}`);
    const jsonExact1300 = await resExact1300.json();
    assert.equal(jsonExact1300.economy.healthStatus, 'stable');

    mockBalances = [325, 325, 325, 326]; // soma = 1301 > 1300
    const resOver1300 = await fetch(`${api}/api/fun/overview?scope=${encodeURIComponent(scopeKey)}`);
    const jsonOver1300 = await resOver1300.json();
    assert.equal(jsonOver1300.economy.healthStatus, 'inflationary');

    // Limiar exato de deflação: 1000 * 0.7 = 700 (exato não é deflacionário, 699 é)
    mockBalances = [175, 175, 175, 175]; // soma = 700
    const resExact700 = await fetch(`${api}/api/fun/overview?scope=${encodeURIComponent(scopeKey)}`);
    const jsonExact700 = await resExact700.json();
    assert.equal(jsonExact700.economy.healthStatus, 'stable');

    mockBalances = [175, 175, 175, 174]; // soma = 699 < 700
    const resUnder700 = await fetch(`${api}/api/fun/overview?scope=${encodeURIComponent(scopeKey)}`);
    const jsonUnder700 = await resUnder700.json();
    assert.equal(jsonUnder700.economy.healthStatus, 'deflationary');
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
