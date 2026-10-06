import test from 'node:test';
import assert from 'node:assert/strict';
import { LogBuffer, getLogBuffer } from '../fun/dashboard/logBuffer.js';
import { startFunDashboardServer } from '../fun/dashboard/server.js';

test('LogBuffer unit tests: ring buffer eviction and filtering', () => {
  const buffer = new LogBuffer(5);
  buffer.clear();

  assert.equal(buffer.buffer.length, 0);

  // Inserir entradas
  buffer.add({ level: 'info', domain: 'system', message: 'Iniciando sistema' });
  buffer.add({ level: 'warn', domain: 'economy', message: 'Alerta de inflação', scope: 'group1@g.us' });
  buffer.add({ level: 'error', domain: 'casino', message: 'Falha no jackpot' });
  buffer.add({ level: 'debug', domain: 'llm', message: 'Prompt gerado' });
  buffer.add({ level: 'info', domain: 'games', message: 'Jogo Quiz iniciado', scope: 'group1@g.us' });

  assert.equal(buffer.buffer.length, 5);
  assert.equal(buffer.dropped, 0);

  // Inserir 6ª entrada: deve descartar a mais antiga (eviction circular)
  buffer.add({ level: 'info', domain: 'whatsapp', message: 'Mensagem recebida' });
  assert.equal(buffer.buffer.length, 5);
  assert.equal(buffer.dropped, 1);

  // Testar filtro por nível
  const errorLogs = buffer.getLogs({ level: 'error' });
  assert.equal(errorLogs.logs.length, 1);
  assert.equal(errorLogs.logs[0].domain, 'casino');

  // Testar filtro por domínio
  const economyLogs = buffer.getLogs({ domain: 'economy' });
  assert.equal(economyLogs.logs.length, 1);
  assert.equal(economyLogs.logs[0].level, 'warn');

  // Testar filtro por busca textual
  const searchLogs = buffer.getLogs({ search: 'Quiz' });
  assert.equal(searchLogs.logs.length, 1);
  assert.equal(searchLogs.logs[0].message, 'Jogo Quiz iniciado');

  // Testar filtro por scope (inclui scoped e globais sem scope)
  const scopeLogs = buffer.getLogs({ scope: 'group1@g.us' });
  assert.equal(scopeLogs.logs.length, 5); // 2 de group1 + 3 sem scope

  // Testar parâmetro since
  const t0 = buffer.buffer[2].timestamp;
  const sinceLogs = buffer.getLogs({ since: t0 });
  assert.ok(sinceLogs.logs.every((l) => l.timestamp > t0));
});

test('HTTP GET /api/fun/logs contract and event emission', async () => {
  const scopeKey = 'test-logs@g.us';
  const logBuffer = getLogBuffer();
  logBuffer.clear();

  const mockServices = {
    repository: {
      countUsersInScope: () => 10,
      getUserStats: () => ({ coins: 100 }),
      getLeaderboard: () => [],
      getCoinsLeaderboard: () => [],
    },
    groupRepository: {
      getGroupSettings: () => ({ enabled: true }),
      resolveEffectiveRates: () => ({ enabled: true }),
    },
    chaosEventService: {
      tryStartEvent: () => ({ ok: true, event: { scopeKey } }),
      formatStartAnnouncement: () => 'Chaos iniciado!',
    },
    gameManager: {
      createRoom: async () => ({
        ok: true,
        room: { id: 'room-log-test', scopeKey, gameType: 'quiz_royale', prize: 500, startsAt: Date.now() + 60000, status: 'waiting' },
        gameLink: '/jogos/room-log-test',
        announcementText: 'Partida criada!',
      }),
      getActiveRoomByScope: () => null,
      publicRoomState: (r) => r,
    },
  };

  const fakeFunModule = {
    _services: mockServices,
    launchDailyChallengeForWhitelist: async () => ({ ok: true, okCount: 1, failCount: 0 }),
    broadcastChangelog: async () => ({ ok: true, okCount: 1, failCount: 0 }),
  };

  const oldApiKey = process.env.FUN_DASHBOARD_API_KEY;
  process.env.FUN_DASHBOARD_API_KEY = 'secret-admin-key';

  const server = await startFunDashboardServer({
    port: 0,
    getConfig: () => ({
      dashboardHost: '127.0.0.1',
      dashboardAllowedOrigins: ['http://127.0.0.1:3000'],
      groupWhitelistJids: [scopeKey],
    }),
    funModule: fakeFunModule,
    getContactDisplayName: () => 'Jogador Teste',
    isSocketReady: () => true,
    getSock: () => ({ user: { id: 'bot@s.whatsapp.net' } }),
    sendText: async () => {},
  });

  const { port } = server.address();
  const api = `http://127.0.0.1:${port}`;

  try {
    // 1) Testar GET /api/fun/logs inicial
    const res1 = await fetch(`${api}/api/fun/logs`);
    assert.equal(res1.status, 200);
    const json1 = await res1.json();

    assert.equal(json1.ok, true);
    assert.ok(Array.isArray(json1.logs));
    assert.ok(typeof json1.total === 'number');
    assert.ok(typeof json1.bufferCapacity === 'number');
    assert.ok(typeof json1.dropped === 'number');
    assert.ok(typeof json1.lastTimestamp === 'number');

    // 2) Disparar spawn de jogo e verificar log
    const spawnRes = await fetch(`${api}/api/fun/games/spawn`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'secret-admin-key',
      },
      body: JSON.stringify({
        scope: scopeKey,
        gameType: 'quiz_royale',
        prize: 500,
      }),
    });
    assert.equal(spawnRes.status, 200);

    // 3) Disparar evento de caos e verificar log
    const chaosRes = await fetch(`${api}/api/fun/chaos/trigger`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'secret-admin-key',
      },
      body: JSON.stringify({ scope: scopeKey }),
    });
    assert.equal(chaosRes.status, 200);

    // 4) Disparar changelog e verificar log
    const changelogRes = await fetch(`${api}/api/fun/changelog`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'secret-admin-key',
      },
      body: JSON.stringify({
        version: 'v2.0.0',
        title: 'Atualização',
        body: 'Nova versão disponível',
      }),
    });
    assert.equal(changelogRes.status, 200);

    // 5) Consultar logs filtrados por domain=games
    const logsGames = await fetch(`${api}/api/fun/logs?domain=games`);
    assert.equal(logsGames.status, 200);
    const jsonGames = await logsGames.json();
    assert.ok(jsonGames.logs.length >= 1);
    assert.ok(jsonGames.logs.some((l) => l.message.includes('quiz_royale')));

    // 6) Consultar logs filtrados por domain=casino
    const logsCasino = await fetch(`${api}/api/fun/logs?domain=casino`);
    const jsonCasino = await logsCasino.json();
    assert.ok(jsonCasino.logs.some((l) => l.message.includes('PURGA') || l.message.includes('Caos')));

    // 7) Consultar logs filtrados por domain=whatsapp
    const logsWa = await fetch(`${api}/api/fun/logs?domain=whatsapp`);
    const jsonWa = await logsWa.json();
    assert.ok(jsonWa.logs.some((l) => l.message.includes('changelog')));

    // 8) Testar parâmetro search
    const logsSearch = await fetch(`${api}/api/fun/logs?search=quiz_royale`);
    const jsonSearch = await logsSearch.json();
    assert.ok(jsonSearch.logs.length >= 1);
    assert.ok(jsonSearch.logs[0].message.includes('quiz_royale'));

    // 9) Testar polling com since
    const lastTs = json1.lastTimestamp;
    const logsSince = await fetch(`${api}/api/fun/logs?since=${lastTs}`);
    const jsonSince = await logsSince.json();
    assert.ok(jsonSince.logs.length >= 3);
  } finally {
    process.env.FUN_DASHBOARD_API_KEY = oldApiKey;
    await new Promise((resolve) => server.close(resolve));
  }
});
