import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { ensureFunSchema } from '../fun/schema.js';
import { createFunAccountRepository } from '../fun/db/funAccountRepository.js';
import { createFunFactionRepository } from '../fun/db/funFactionRepository.js';
import { createGameAuthService } from '../fun/games/auth.js';
import { createGameManager, GAME_TYPES, ROOM_STATUS } from '../fun/games/gameManager.js';
import { createGameRoutes, DEFAULT_GAME_TEST_KEY } from '../fun/games/routes.js';
import { handleGameEventCommand } from '../fun/commands/handlers/gameEvent.js';

function createTestDatabase() {
  const db = new Database(':memory:');
  db.exec("ATTACH DATABASE ':memory:' AS analytics;");
  ensureFunSchema(db);
  return db;
}

test('Multiplayer Games - Auth & Panelinha Detection', async (t) => {
  const db = createTestDatabase();
  const getDatabase = () => db;
  const accountRepo = createFunAccountRepository({ getDatabase });
  const factionRepo = createFunFactionRepository({ getDatabase });
  const authService = createGameAuthService({
    accountRepository: accountRepo,
    factionRepository: factionRepo,
  });

  const scopeKey = '120363020000000000@g.us';
  const userJid1 = '5511999990001@s.whatsapp.net';
  const userJid2 = '5511999990002@s.whatsapp.net';

  // 1. Cadastra conta para o jogador 1 e jogador 2
  accountRepo.createAccount({
    userJid: userJid1,
    username: 'CapitaoJack',
    password: 'password123',
    pin: '1234',
  });

  accountRepo.createAccount({
    userJid: userJid2,
    username: 'SemPanelinha',
    password: 'password123',
    pin: '1234',
  });

  // 2. Cria panelinha no grupo e adiciona apenas o jogador 1
  factionRepo.createFaction({
    scopeKey,
    name: 'Os Piratas',
    leaderJid: userJid1,
  });

  await t.test('bloqueia login com credenciais inválidas', async () => {
    const res = await authService.login({
      username: 'NaoExiste',
      password: 'password123',
      scopeKey,
    });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'account_not_found');
    assert.match(res.message, /\/cadastrar/);
  });

  await t.test('bloqueia login de jogador que não tem panelinha', async () => {
    const res = await authService.login({
      username: 'SemPanelinha',
      password: 'password123',
      scopeKey,
    });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'no_faction');
    assert.match(res.message, /\/panelinha/);
  });

  await t.test('permite login e gera token para jogador com panelinha', async () => {
    const res = await authService.login({
      username: 'CapitaoJack',
      password: 'password123',
      scopeKey,
    });
    assert.equal(res.ok, true);
    assert.ok(res.token);
    assert.equal(res.player.username, 'CapitaoJack');
    assert.equal(res.player.faction.name, 'Os Piratas');

    // Valida resolução do token
    const session = authService.resolveToken(res.token);
    assert.ok(session);
    assert.equal(session.userJid, userJid1);
  });

  await t.test('bloqueia por rate_limited após 5 tentativas consecutivas com senha errada', async () => {
    // 5 tentativas erradas
    for (let i = 0; i < 5; i++) {
      const failRes = await authService.login({
        username: 'CapitaoJack',
        password: 'wrong-password',
        scopeKey,
      });
      assert.equal(failRes.ok, false);
      assert.equal(failRes.error, 'invalid_password');
    }

    // 6ª tentativa deve ser bloqueada imediatamente por rate_limited
    const lockedRes = await authService.login({
      username: 'CapitaoJack',
      password: 'wrong-password',
      scopeKey,
    });
    assert.equal(lockedRes.ok, false);
    assert.equal(lockedRes.error, 'rate_limited');
    assert.match(lockedRes.message, /segurança/);

    // Após expirar o período de bloqueio de 5 minutos, concede novo ciclo de tentativas
    const fiveMinutesLater = Date.now() + 5 * 60 * 1000 + 1000;
    const unlockedRes = await authService.login({
      username: 'CapitaoJack',
      password: 'wrong-password',
      scopeKey,
      now: fiveMinutesLater,
    });
    assert.equal(unlockedRes.error, 'invalid_password');
    assert.match(unlockedRes.message, /4 tentativa\(s\) restante\(s\)/);
  });
});

test('Multiplayer Games - GameManager Lifecycle & Prize Payout', async (t) => {
  const db = createTestDatabase();
  const getDatabase = () => db;
  const accountRepo = createFunAccountRepository({ getDatabase });
  const factionRepo = createFunFactionRepository({ getDatabase });
  const scopeKey = '120363020000000000@g.us';

  const userJid1 = '5511999990001@s.whatsapp.net';
  const userJid2 = '5511999990002@s.whatsapp.net';

  accountRepo.createAccount({ userJid: userJid1, username: 'Jack', password: 'password123', pin: '1234' });
  accountRepo.createAccount({ userJid: userJid2, username: 'Ninja', password: 'password123', pin: '1234' });

  const fac1 = factionRepo.createFaction({ scopeKey, name: 'Piratas', leaderJid: userJid1 });
  const fac2 = factionRepo.createFaction({ scopeKey, name: 'Ninjas', leaderJid: userJid2 });

  let sentMessages = [];
  const gameManager = createGameManager({
    factionRepository: {
      ...factionRepo,
      getDatabase,
    },
    accountRepository: accountRepo,
    funConfig: { publicBaseUrl: 'https://test-tunnel.trycloudflare.com' },
    sendGroupMessage: async (s, msg) => {
      sentMessages.push({ scopeKey: s, text: msg });
    },
  });

  await t.test('cria sala de jogo com link e anúncio no grupo', async () => {
    const res = await gameManager.createRoom({
      scopeKey,
      gameType: GAME_TYPES.QUIZ_ROYALE,
      prize: 1500,
      startInMinutes: 3,
    });

    assert.equal(res.ok, true);
    assert.match(res.gameLink, /\/jogos\//);
    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0].text, /EVENTO DIÁRIO DAS PANELINHAS/);
    assert.match(sentMessages[0].text, /\+1500 moedas/);
  });

  await t.test('permite jogadores entrarem na sala', async () => {
    const room = gameManager.getActiveRoomByScope(scopeKey);
    assert.ok(room);

    const join1 = gameManager.joinRoom(room.id, {
      userJid: userJid1,
      username: 'Jack',
      faction: { id: fac1.faction.id, name: 'Piratas', emoji: '🏴‍☠️' },
    });
    assert.equal(join1.ok, true);

    const join2 = gameManager.joinRoom(room.id, {
      userJid: userJid2,
      username: 'Ninja',
      faction: { id: fac2.faction.id, name: 'Ninjas', emoji: '🥷' },
    });
    assert.equal(join2.ok, true);

    const state = gameManager.publicRoomState(room);
    assert.equal(state.players.length, 2);
    assert.equal(state.factions.length, 2);
  });

  await t.test('inicia partida e premia cofre da panelinha vencedora', async () => {
    const room = gameManager.getActiveRoomByScope(scopeKey);
    await gameManager.startGame(room.id);
    assert.equal(room.status, ROOM_STATUS.IN_PROGRESS);

    // Finaliza premiando os Piratas
    await gameManager.finishGame(room.id, fac1.faction.id);
    assert.equal(room.status, ROOM_STATUS.FINISHED);

    // Verifica se as 1500 moedas foram adicionadas ao cofre da panelinha dos Piratas
    const updatedFac1 = factionRepo.getById(fac1.faction.id);
    assert.equal(updatedFac1.vaultCoins, 1500);

    // Verifica anúncio de vitória no grupo
    const lastMsg = sentMessages[sentMessages.length - 1];
    assert.match(lastMsg.text, /FIM DE JOGO/);
    assert.match(lastMsg.text, /Piratas/);

    gameManager.cleanup();
  });

  await t.test('não envia mensagens no grupo se announce for false ou isTest for true', async () => {
    let testSentMessages = [];
    const silentGameManager = createGameManager({
      factionRepository: {
        ...factionRepo,
        getDatabase,
      },
      accountRepository: accountRepo,
      funConfig: { publicBaseUrl: 'https://test-tunnel.trycloudflare.com' },
      sendGroupMessage: async (s, msg) => {
        testSentMessages.push({ scopeKey: s, text: msg });
      },
    });

    try {
      // 1. Cria sala com announce: false e isTest: true
      const res = await silentGameManager.createRoom({
        scopeKey,
        gameType: GAME_TYPES.QUIZ_ROYALE,
        prize: 1000,
        startInMinutes: 3,
        announce: false,
        isTest: true,
      });

      assert.equal(res.ok, true);
      assert.equal(res.room.isTest, true);
      assert.equal(res.room.announce, false);
      // Não deve ter enviado mensagem de anúncio
      assert.equal(testSentMessages.length, 0);

      // 2. Entra na sala e finaliza
      silentGameManager.joinRoom(res.room.id, {
        userJid: userJid1,
        username: 'Jack',
        faction: { id: fac1.faction.id, name: 'Piratas', emoji: '🏴‍☠️' },
      });
      silentGameManager.joinRoom(res.room.id, {
        userJid: userJid2,
        username: 'Ninja',
        faction: { id: fac2.faction.id, name: 'Ninjas', emoji: '🥷' },
      });

      await silentGameManager.startGame(res.room.id);
      await silentGameManager.finishGame(res.room.id, fac1.faction.id);

      // Não deve ter enviado mensagem de vitória/encerramento
      assert.equal(testSentMessages.length, 0);
    } finally {
      silentGameManager.cleanup();
    }
  });
});

test('Multiplayer Games - HTTP & SSE Routes', async () => {
  const db = createTestDatabase();
  const getDatabase = () => db;
  const accountRepo = createFunAccountRepository({ getDatabase });
  const factionRepo = createFunFactionRepository({ getDatabase });
  const authService = createGameAuthService({ accountRepository: accountRepo, factionRepository: factionRepo });
  const gameManager = createGameManager({ factionRepository: factionRepo, accountRepository: accountRepo });
  const routes = createGameRoutes({ gameManager, authService });

  const scopeKey = '120363020000000000@g.us';
  const userJid = '5511999990001@s.whatsapp.net';
  accountRepo.createAccount({ userJid, username: 'Player1', password: 'password123', pin: '1234' });
  factionRepo.createFaction({ scopeKey, name: 'Aliados', leaderJid: userJid });

  const roomRes = await gameManager.createRoom({
    scopeKey,
    gameType: GAME_TYPES.KING_OF_THE_HILL,
    prize: 1000,
    startInMinutes: 5,
  });
  const roomId = roomRes.room.id;

  // Mock de response
  function createMockResponse() {
    const headers = {};
    let statusCode = 200;
    let body = '';
    return {
      setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
      writeHead: (code) => { statusCode = code; },
      end: (data) => { body = data; },
      write: (data) => { body += data; },
      getStatus: () => statusCode,
      getBody: () => body ? JSON.parse(body) : null,
      getRawBody: () => body,
      getHeader: (k) => headers[k.toLowerCase()],
    };
  }

  // 1. GET /api/fun/games/room/:roomId
  const reqRoom = { method: 'GET', url: `/api/fun/games/room/${roomId}` };
  const resRoom = createMockResponse();
  const handledRoom = await routes.handleRequest(reqRoom, resRoom, new URL(reqRoom.url, 'http://localhost'));
  assert.equal(handledRoom, true);
  assert.equal(resRoom.getStatus(), 200);
  assert.equal(resRoom.getBody().room.id, roomId);

  // 2. POST /api/fun/games/auth/login
  const routesWithBody = createGameRoutes({
    gameManager,
    authService,
    readBody: async () => ({
      username: 'Player1',
      password: 'password123',
      roomId,
    }),
  });

  const reqLogin = { method: 'POST', url: '/api/fun/games/auth/login', headers: {} };
  const resLogin = createMockResponse();
  const handledLogin = await routesWithBody.handleRequest(reqLogin, resLogin, new URL(reqLogin.url, 'http://localhost'));
  assert.equal(handledLogin, true);
  assert.equal(resLogin.getStatus(), 200);
  const loginBody = resLogin.getBody();
  assert.ok(loginBody.token);
  assert.equal(loginBody.player.username, 'Player1');

  // 3. GET /api/fun/games/events/:roomId (SSE)
  const reqEvents = { method: 'GET', url: `/api/fun/games/events/${roomId}`, headers: {}, on: () => {} };
  const resEvents = createMockResponse();
  const handledEvents = await routes.handleRequest(reqEvents, resEvents, new URL(reqEvents.url, 'http://localhost'));
  assert.equal(handledEvents, true);
  assert.equal(resEvents.getHeader('content-type'), 'text/event-stream; charset=utf-8');
  assert.match(resEvents.getRawBody(), /event: init/);

  gameManager.cleanup();
});

test('Multiplayer Games - Bot Command /jogododia', async () => {
  const db = createTestDatabase();
  const getDatabase = () => db;
  const accountRepo = createFunAccountRepository({ getDatabase });
  const factionRepo = createFunFactionRepository({ getDatabase });
  const scopeKey = '120363020000000000@g.us';

  const gameManager = createGameManager({ factionRepository: factionRepo, accountRepository: accountRepo });

  let replies = [];
  const reply = async (msg) => replies.push(msg);

  // Rejeita fora de grupos
  const resDm = await handleGameEventCommand({
    scopeKey: 'user@s.whatsapp.net',
    isGroup: false,
    gameManager,
    reply,
  });
  assert.equal(resDm.error, 'group_only');

  // Inicia jogo no grupo
  const resGroup = await handleGameEventCommand({
    scopeKey,
    isGroup: true,
    args: ['quiz', '3'],
    gameManager,
    reply,
  });
  assert.equal(resGroup.handled, true);
  assert.ok(resGroup.room);
  assert.equal(resGroup.room.gameType, GAME_TYPES.QUIZ_ROYALE);

  gameManager.cleanup();
});

test('Multiplayer Games - Test Room Creation & Mock Test Key Authorization', async (t) => {
  assert.ok(DEFAULT_GAME_TEST_KEY);
  assert.equal(typeof DEFAULT_GAME_TEST_KEY, 'string');
  assert.ok(DEFAULT_GAME_TEST_KEY.length > 5);

  const db = createTestDatabase();
  const getDatabase = () => db;
  const accountRepo = createFunAccountRepository({ getDatabase });
  const factionRepo = createFunFactionRepository({ getDatabase });
  const authService = createGameAuthService({ accountRepository: accountRepo, factionRepository: factionRepo });
  const gameManager = createGameManager({ factionRepository: factionRepo, accountRepository: accountRepo });
  t.after(() => gameManager.cleanup());

  const scopeKey = '120363020000000000@g.us';

  function createMockResponse() {
    const headers = {};
    let statusCode = 200;
    let body = '';
    return {
      setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
      writeHead: (code) => { statusCode = code; },
      end: (data) => { body = data; },
      write: (data) => { body += data; },
      getStatus: () => statusCode,
      getBody: () => body ? JSON.parse(body) : null,
      getRawBody: () => body,
      getHeader: (k) => headers[k.toLowerCase()],
    };
  }

  function createAuthorizeFunction(customEnvKey) {
    return (req) => {
      const remoteAddress = String(req.socket?.remoteAddress || '');
      const isLocalRequest = remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1';
      const expectedKey = String(customEnvKey || DEFAULT_GAME_TEST_KEY).trim();
      const providedKey = String(req.headers?.['x-game-test-key'] || '').trim();
      return isLocalRequest && Boolean(expectedKey) && providedKey === expectedKey;
    };
  }

  const routes = createGameRoutes({
    gameManager,
    authService,
    authorizeCreateRoom: createAuthorizeFunction(),
    readBody: async () => ({
      gameType: GAME_TYPES.QUIZ_ROYALE,
      scopeKey,
      prize: 1000,
      startInMinutes: 3,
    }),
  });

  await t.test('permite criacao de sala com a chave mockada padrao a partir de localhost', async () => {
    const req = {
      method: 'POST',
      url: '/api/fun/games/create',
      headers: {
        'x-game-test-key': DEFAULT_GAME_TEST_KEY,
      },
      socket: { remoteAddress: '127.0.0.1' },
    };
    const res = createMockResponse();
    const handled = await routes.handleRequest(req, res, new URL(req.url, 'http://localhost'));
    assert.equal(handled, true);
    assert.equal(res.getStatus(), 200);
    const body = res.getBody();
    assert.equal(body.ok, true);
    assert.ok(body.room?.id);
    assert.equal(body.room?.isTest, true);
    assert.equal(body.room?.announce, false);
  });

  await t.test('bloqueia criacao quando a chave enviada nao confere', async () => {
    const req = {
      method: 'POST',
      url: '/api/fun/games/create',
      headers: {
        'x-game-test-key': 'chave-incorreta',
      },
      socket: { remoteAddress: '127.0.0.1' },
    };
    const res = createMockResponse();
    const handled = await routes.handleRequest(req, res, new URL(req.url, 'http://localhost'));
    assert.equal(handled, true);
    assert.equal(res.getStatus(), 403);
    assert.equal(res.getBody().error, 'test_room_creation_forbidden');
  });

  await t.test('bloqueia criacao quando nenhuma chave e fornecida', async () => {
    const req = {
      method: 'POST',
      url: '/api/fun/games/create',
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
    };
    const res = createMockResponse();
    const handled = await routes.handleRequest(req, res, new URL(req.url, 'http://localhost'));
    assert.equal(handled, true);
    assert.equal(res.getStatus(), 403);
    assert.equal(res.getBody().error, 'test_room_creation_forbidden');
  });

  await t.test('bloqueia criacao quando a requisicao nao e de IP local', async () => {
    const req = {
      method: 'POST',
      url: '/api/fun/games/create',
      headers: {
        'x-game-test-key': DEFAULT_GAME_TEST_KEY,
      },
      socket: { remoteAddress: '198.51.100.42' },
    };
    const res = createMockResponse();
    const handled = await routes.handleRequest(req, res, new URL(req.url, 'http://localhost'));
    assert.equal(handled, true);
    assert.equal(res.getStatus(), 403);
    assert.equal(res.getBody().error, 'test_room_creation_forbidden');
  });

  await t.test('permite customizacao de chave via variavel de ambiente', async () => {
    const customKey = 'minha-chave-customizada-123';
    const customScopeKey = '120363020000000002@g.us';
    const customRoutes = createGameRoutes({
      gameManager,
      authService,
      authorizeCreateRoom: createAuthorizeFunction(customKey),
      readBody: async () => ({
        gameType: GAME_TYPES.GRID_CTF,
        scopeKey: customScopeKey,
        prize: 500,
        startInMinutes: 2,
      }),
    });

    const reqValidCustom = {
      method: 'POST',
      url: '/api/fun/games/create',
      headers: {
        'x-game-test-key': customKey,
      },
      socket: { remoteAddress: '127.0.0.1' },
    };
    const resValidCustom = createMockResponse();
    const handledValid = await customRoutes.handleRequest(reqValidCustom, resValidCustom, new URL(reqValidCustom.url, 'http://localhost'));
    assert.equal(handledValid, true);
    assert.equal(resValidCustom.getStatus(), 200);

    const reqOldDefault = {
      method: 'POST',
      url: '/api/fun/games/create',
      headers: {
        'x-game-test-key': DEFAULT_GAME_TEST_KEY,
      },
      socket: { remoteAddress: '127.0.0.1' },
    };
    const resOldDefault = createMockResponse();
    const handledInvalid = await customRoutes.handleRequest(reqOldDefault, resOldDefault, new URL(reqOldDefault.url, 'http://localhost'));
    assert.equal(handledInvalid, true);
    assert.equal(resOldDefault.getStatus(), 403);
  });

  await t.test('substitui sala de teste anterior ao alternar jogos de teste sem erro de circularidade', async () => {
    // 1. Cria primeira sala (ex: quiz)
    const req1 = {
      method: 'POST',
      url: '/api/fun/games/create',
      headers: { 'x-game-test-key': DEFAULT_GAME_TEST_KEY },
      socket: { remoteAddress: '127.0.0.1' },
    };
    const res1 = createMockResponse();
    await routes.handleRequest(req1, res1, new URL(req1.url, 'http://localhost'));
    assert.equal(res1.getStatus(), 200);
    const room1 = res1.getBody().room;
    assert.ok(room1.id);

    // 2. Tenta criar segunda sala (ex: hill) para o mesmo escopo com isTest: true
    const hillRoutes = createGameRoutes({
      gameManager,
      authService,
      authorizeCreateRoom: createAuthorizeFunction(),
      readBody: async () => ({
        gameType: GAME_TYPES.KING_OF_THE_HILL,
        scopeKey,
        prize: 1000,
        startInMinutes: 3,
        isTest: true,
      }),
    });
    const req2 = {
      method: 'POST',
      url: '/api/fun/games/create',
      headers: { 'x-game-test-key': DEFAULT_GAME_TEST_KEY },
      socket: { remoteAddress: '127.0.0.1' },
    };
    const res2 = createMockResponse();
    // NÃO pode lançar erro de circularidade (Converting circular structure to JSON)
    const handled2 = await hillRoutes.handleRequest(req2, res2, new URL(req2.url, 'http://localhost'));
    assert.equal(handled2, true);
    assert.equal(res2.getStatus(), 200);
    const room2 = res2.getBody().room;
    assert.ok(room2.id);
    assert.equal(room2.gameType, GAME_TYPES.KING_OF_THE_HILL);
  });

  gameManager.cleanup();
});
