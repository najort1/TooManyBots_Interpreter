import test from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createFunStatsRepository } from '../fun/db/funStatsRepository.js';
import { createFunMarketRepository } from '../fun/db/funMarketRepository.js';
import { createFunCarRepository, DEFAULT_CAR_STATE } from '../fun/db/funCarRepository.js';
import { createCarService } from '../fun/services/carService.js';
import { createCarLinkService } from '../fun/services/carLinkService.js';
import { handleCarCommand, handleMyCarCommand } from '../fun/commands/handlers/car.js';
import { parseFunCommand, routeFunCommand } from '../fun/commands/router.js';
import { handleFunIncomingMessage } from '../fun/pipeline/onIncomingMessage.js';
import { FUN_COMMANDS } from '../fun/constants.js';
import {
  calculateCarCustomizationQuote,
  calculateCarPerformance,
  validateCarCustomization,
} from '../shared/car/domain.js';
import { startFunDashboardServer } from '../fun/dashboard/server.js';

await initDb();

const unique = (prefix) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

function setupTest() {
  const repository = createFunStatsRepository({ getDatabase: getDb });
  const marketRepository = createFunMarketRepository({ getDatabase: getDb });
  const carRepository = createFunCarRepository({ getDatabase: getDb });
  const carLinkService = createCarLinkService({ carRepository });
  const carService = createCarService({
    repository,
    carRepository,
    marketRepository,
    getDatabase: getDb,
  });

  const scopeKey = unique('scope');
  const userJid = unique('user') + '@s.whatsapp.net';
  const otherUserJid = unique('other') + '@s.whatsapp.net';

  return {
    repository,
    marketRepository,
    carRepository,
    carLinkService,
    carService,
    scopeKey,
    userJid,
    otherUserJid,
  };
}

test('roteador de comandos: parseia /carro e meu_carro (com ou sem barra)', () => {
  const parsed1 = parseFunCommand('/carro');
  assert.equal(parsed1?.command, FUN_COMMANDS.CAR);

  const parsed1b = parseFunCommand('/carros');
  assert.equal(parsed1b?.command, FUN_COMMANDS.CAR);

  const parsed1c = parseFunCommand('/garagem');
  assert.equal(parsed1c?.command, FUN_COMMANDS.CAR);

  const parsed2 = parseFunCommand('/car');
  assert.equal(parsed2?.command, FUN_COMMANDS.CAR);

  const parsed3 = parseFunCommand('/meu_carro');
  assert.equal(parsed3?.command, FUN_COMMANDS.MY_CAR);

  const parsed4 = parseFunCommand('/meucarro');
  assert.equal(parsed4?.command, FUN_COMMANDS.MY_CAR);

  const parsed5 = parseFunCommand('meu_carro');
  assert.equal(parsed5?.command, FUN_COMMANDS.MY_CAR);

  const parsed6 = parseFunCommand('meucarro');
  assert.equal(parsed6?.command, FUN_COMMANDS.MY_CAR);
});

test('/carro em grupo instrui abertura de conversa no privado', async () => {
  const { carService, carLinkService } = setupTest();
  const replies = [];

  const result = await handleCarCommand({
    isGroup: true,
    scopeKey: 'grupo@g.us',
    userJid: 'user@s.whatsapp.net',
    carService,
    carLinkService,
    reply: async (text) => replies.push(text),
  });

  assert.equal(result.handled, true);
  assert.equal(replies.length, 1);
  assert.match(replies[0], /privado/i);
});

test('/carro no privado quando o usuário NÃO possui carro na loja: informa noCarOwned', async () => {
  const { carService, carLinkService, scopeKey, userJid } = setupTest();
  const replies = [];

  const result = await handleCarCommand({
    isGroup: false,
    scopeKey,
    userJid,
    carService,
    carLinkService,
    reply: async (text) => replies.push(text),
  });

  assert.equal(result.handled, true);
  assert.equal(result.reason, 'car-not-owned');
  assert.equal(replies.length, 1);
  assert.match(replies[0], /não possui um carro/i);
});

test('/carro no privado quando o carro foi comprado em OUTRO grupo: resolve escopo efetivo e envia link', async () => {
  const { carService, carLinkService, marketRepository, repository, userJid } = setupTest();
  const dmScopeKey = 'grupo-dm-padrao@g.us';
  const realCarGroup = 'grupo-onde-comprou@g.us';
  const replies = [];

  // Adiciona moedas e carro no grupo real (onde comprou), mas o DM inicia com outro scopeKey
  repository.addCoins({ userJid, scopeKey: realCarGroup, amount: 777 });
  marketRepository.addInventory({
    userJid,
    scopeKey: realCarGroup,
    itemId: 'carro',
    acquiredPrice: 680,
  });

  let preferredSaved = null;
  const prefsRepository = {
    setPreferredScope: (jid, sk) => {
      preferredSaved = sk;
    },
  };

  const result = await handleCarCommand({
    isGroup: false,
    scopeKey: dmScopeKey,
    userJid,
    carService,
    carLinkService,
    repository,
    prefsRepository,
    funConfig: { dashboardUiPort: 3001 },
    reply: async (text) => replies.push(text),
  });

  assert.equal(result.handled, true);
  assert.equal(result.scopeKey, realCarGroup);
  assert.equal(preferredSaved, realCarGroup);
  assert.equal(replies.length, 1);
  assert.match(replies[0], /\/carros\/[A-Za-z0-9_-]+/);
  assert.match(replies[0], /Garagem VIP/i);
  assert.match(replies[0], /777/);
});

test('/carro no privado quando o carro está quebrado (sucata): alerta o usuário para consertar', async () => {
  const { carService, carLinkService, marketRepository, scopeKey, userJid } = setupTest();
  const replies = [];

  // Carro quebrado
  marketRepository.addInventory({
    userJid,
    scopeKey,
    itemId: 'carro',
    condition: 'broken',
    acquiredPrice: 680,
  });

  const result = await handleCarCommand({
    isGroup: false,
    scopeKey,
    userJid,
    carService,
    carLinkService,
    reply: async (text) => replies.push(text),
  });

  assert.equal(result.handled, true);
  assert.equal(result.reason, 'car-broken');
  assert.equal(replies.length, 1);
  assert.match(replies[0], /quebrado/i);
  assert.match(replies[0], /consertar/i);
});

test('compra de carro no inventário e liberação de /carro no privado com link seguro', async () => {
  const { carService, carLinkService, marketRepository, repository, scopeKey, userJid } = setupTest();
  const replies = [];

  // Dá moedas e adiciona carro ao inventário
  repository.addCoins({ userJid, scopeKey, amount: 500 });
  marketRepository.addInventory({
    userJid,
    scopeKey,
    itemId: 'carro',
    acquiredPrice: 680,
  });

  assert.equal(carService.ownsCar({ scopeKey, userJid }), true);

  const result = await handleCarCommand({
    isGroup: false,
    scopeKey,
    userJid,
    carService,
    carLinkService,
    repository,
    funConfig: { dashboardUiPort: 3001 },
    reply: async (text) => replies.push(text),
  });

  assert.equal(result.handled, true);
  assert.equal(replies.length, 1);
  assert.match(replies[0], /\/carros\/[A-Za-z0-9_-]+/);
  assert.match(replies[0], /Garagem VIP/i);
});

test('revogação de link e validação de token seguro', async () => {
  const { carLinkService, carRepository, scopeKey, userJid, otherUserJid } = setupTest();

  // Gera token para userJid
  const link = await carLinkService.generate({ scopeKey, userJid });
  assert.ok(link.token);

  // Resolução com token correto
  const resolved = await carLinkService.resolve(link.token);
  assert.equal(resolved?.userJid, userJid);
  assert.equal(resolved?.scopeKey, scopeKey);

  // Outro usuário não pode usar token falso ou aleatório
  const invalid = await carLinkService.resolve('token-falso-inexistente');
  assert.equal(invalid, null);

  // Revogação de token
  const replies = [];
  await handleCarCommand({
    isGroup: false,
    scopeKey,
    userJid,
    carService: { ownsCar: () => true },
    carLinkService,
    args: ['revogar'],
    reply: async (text) => replies.push(text),
  });

  assert.match(replies[0], /revogado/i);

  // Token revogado não resolve mais
  const resolvedAfterRevoke = await carLinkService.resolve(link.token);
  assert.equal(resolvedAfterRevoke, null);
});

test('customização: validação de parâmetros e cálculo de orçamento', () => {
  const valid = validateCarCustomization({
    color: '#00f0ff',
    wheels: 'classic',
    spoiler: 'gt_wing',
    suspension: 'slammed',
    neon: 'blue',
    decal: 'stripes',
    windowTint: 'dark',
    plateText: 'VELOZ-01',
  });

  assert.equal(valid.ok, true);
  assert.equal(valid.sanitized.color, '#00f0ff');
  assert.equal(valid.sanitized.wheels, 'classic');
  assert.equal(valid.sanitized.plateText, 'VELOZ-01');

  // Cálculo de custo
  const quote = calculateCarCustomizationQuote(DEFAULT_CAR_STATE, valid.sanitized);
  assert.ok(quote.total > 0);
  assert.ok(quote.items.length > 0);

  // Opções inválidas rejeitadas
  const invalid = validateCarCustomization({
    wheels: 'roda_alienigena_inexistente',
    spoiler: 'asa_de_aviao',
  });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.length >= 2);
});

test('simulação AAA: cálculo de telemetria de performance e PR Score', () => {
  const stock = calculateCarPerformance(DEFAULT_CAR_STATE);
  assert.ok(stock.horsepower >= 480);
  assert.ok(stock.topSpeedKmh >= 300);
  assert.ok(stock.zeroToHundredSec <= 3.5);
  assert.ok(stock.prScore > 500);

  const tuned = calculateCarPerformance({
    ...DEFAULT_CAR_STATE,
    bodykit: 'time_attack',
    spoiler: 'gt_wing',
    suspension: 'slammed',
    wheels: 'turbofan',
    camber: 'stance',
    rollCage: 'full_race',
    neon: 'blue',
    finish: 'chameleon',
    decal: 'dragon',
  });

  assert.ok(tuned.horsepower > stock.horsepower);
  assert.ok(tuned.handling > stock.handling);
  assert.ok(tuned.styleScore > stock.styleScore);
  assert.ok(tuned.prScore > stock.prScore);
});

test('customização AAA: bodykit, acabamento perolizado, faróis e interior com quote correto', () => {
  const custom = validateCarCustomization({
    finish: 'chameleon',
    bodykit: 'widebody',
    headlight: 'demon',
    interior: 'red_alcantara',
    rollCage: 'clubsport',
    camber: 'stance',
    spoiler: 'gt_wing',
  });

  assert.equal(custom.ok, true);
  assert.equal(custom.sanitized.finish, 'chameleon');
  assert.equal(custom.sanitized.bodykit, 'widebody');
  assert.equal(custom.sanitized.headlight, 'demon');
  assert.equal(custom.sanitized.interior, 'red_alcantara');

  const quote = calculateCarCustomizationQuote(DEFAULT_CAR_STATE, custom.sanitized);
  assert.ok(quote.total > 500);
  assert.ok(quote.items.some((i) => i.category === 'bodykit'));
  assert.ok(quote.items.some((i) => i.category === 'interior'));
  assert.ok(quote.items.some((i) => i.category === 'headlight'));
});

test('customização: dedução de moedas insuficiente impede a transação', async () => {
  const { carService, marketRepository, repository, scopeKey, userJid } = setupTest();

  // Usuário possui carro mas tem 0 moedas
  marketRepository.addInventory({ userJid, scopeKey, itemId: 'carro' });
  repository.ensureUserRow(userJid, scopeKey);

  const result = carService.applyCustomization({
    scopeKey,
    userJid,
    customizations: {
      color: '#ffd166', // custa 80 coins
      wheels: 'deep_dish', // custa 150 coins
    },
    funConfig: { carEnabled: true },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'insufficient-coins');
  assert.ok(result.need > 0);
});

test('customização: transação atômica deduz moedas e salva novo estado com idempotência', async () => {
  const { carService, carRepository, marketRepository, repository, scopeKey, userJid } = setupTest();

  // Usuário possui carro e 1000 moedas
  marketRepository.addInventory({ userJid, scopeKey, itemId: 'carro' });
  repository.addCoins({ userJid, scopeKey, amount: 1000 });

  const idempotencyKey = 'custom-op-1';
  const result = carService.applyCustomization({
    scopeKey,
    userJid,
    customizations: {
      color: '#00f0ff', // 120 coins
      wheels: 'chrome', // 220 coins
      spoiler: 'gt_wing', // 160 coins
      neon: 'blue', // 90 coins
      plateText: 'TOP-2026',
    },
    idempotencyKey,
    funConfig: { carEnabled: true },
  });

  assert.equal(result.ok, true);
  assert.ok(result.debited > 0);
  assert.equal(result.state.color, '#00f0ff');
  assert.equal(result.state.wheels, 'chrome');
  assert.equal(result.state.spoiler, 'gt_wing');
  assert.equal(result.state.neon, 'blue');
  assert.equal(result.state.plateText, 'TOP-2026');

  // Verifica que o saldo foi devidamente deduzido
  const remainingStats = repository.getUserStats(userJid, scopeKey);
  assert.equal(remainingStats.coins, 1000 - result.debited);

  // Idempotência: reexecutar com a mesma chave retorna resultado sem debitar novamente
  const replayed = carService.applyCustomization({
    scopeKey,
    userJid,
    customizations: {
      color: '#00f0ff',
      wheels: 'chrome',
      spoiler: 'gt_wing',
      neon: 'blue',
      plateText: 'TOP-2026',
    },
    idempotencyKey,
    funConfig: { carEnabled: true },
  });

  assert.equal(replayed.ok, true);
  assert.equal(replayed.replayed, true);
  assert.equal(repository.getUserStats(userJid, scopeKey).coins, 1000 - result.debited);
});

test('comando meu_carro: usuário sem carro não recebe nada', async () => {
  const { carService, scopeKey, userJid } = setupTest();
  let imageSent = false;

  const result = await handleMyCarCommand({
    scopeKey,
    userJid,
    carService,
    reply: async () => {},
    replyImage: async () => {
      imageSent = true;
    },
  });

  assert.equal(result.handled, true);
  assert.equal(result.reason, 'car-not-owned');
  assert.equal(imageSent, false);
});

test('comando meu_carro: usuário com carro gera screenshot PNG via sharp e envia imagem', async () => {
  const { carService, carRepository, marketRepository, repository, scopeKey, userJid } = setupTest();

  // Adiciona carro e customiza
  marketRepository.addInventory({ userJid, scopeKey, itemId: 'carro' });
  repository.addCoins({ userJid, scopeKey, amount: 500 });
  carRepository.save(scopeKey, userJid, {
    color: '#00f0ff',
    secondaryColor: '#1d3557',
    wheels: 'chrome',
    spoiler: 'gt_wing',
    suspension: 'low',
    neon: 'blue',
    decal: 'stripes',
    windowTint: 'dark',
    plateText: 'TEST-01',
    revision: 2,
  });

  let capturedBuffer = null;
  let capturedCaption = '';

  const result = await handleMyCarCommand({
    scopeKey,
    userJid,
    carService,
    getContactDisplayName: () => 'Ayrton Senna',
    repository,
    reply: async () => {},
    replyImage: async (buf, cap) => {
      capturedBuffer = buf;
      capturedCaption = cap;
    },
  });

  assert.equal(result.handled, true);
  assert.equal(result.rendered, true);
  assert.ok(capturedBuffer instanceof Buffer);
  assert.ok(capturedBuffer.length > 5000);
  // Verifica cabeçalho mágico PNG: 0x89 0x50 0x4E 0x47
  assert.equal(capturedBuffer[0], 0x89);
  assert.equal(capturedBuffer[1], 0x50);
  assert.equal(capturedBuffer[2], 0x4e);
  assert.equal(capturedBuffer[3], 0x47);

  assert.match(capturedCaption, /Ayrton Senna/);
  assert.match(capturedCaption, /TEST-01/);
  assert.match(capturedCaption, /CHROME/);
});

test('geração de screenshot renderCarScreenshot: retorna buffer PNG válido com peças personalizadas', async () => {
  const { carService, marketRepository, carRepository, scopeKey, userJid } = setupTest();

  marketRepository.addInventory({ userJid, scopeKey, itemId: 'carro' });
  carRepository.save(scopeKey, userJid, {
    color: '#ff007f',
    secondaryColor: '#ffffff',
    wheels: 'turbofan',
    spoiler: 'drag_wing',
    suspension: 'slammed',
    neon: 'purple',
    decal: 'flames',
    windowTint: 'medium',
    plateText: 'TUNER-99',
  });

  const renderResult = await carService.renderCarScreenshot({
    scopeKey,
    userJid,
    ownerName: 'Piloto Tuner',
  });

  assert.equal(renderResult.ok, true);
  assert.ok(renderResult.buffer instanceof Buffer);
  assert.equal(renderResult.buffer.slice(0, 4).toString('hex'), '89504e47');
});

test('servidor HTTP de carros: endpoints GET, PUT e renderização de imagem', async () => {
  const { repository, marketRepository, carRepository, carService, carLinkService, scopeKey, userJid, otherUserJid } = setupTest();

  // Configura usuário com carro e saldo
  marketRepository.addInventory({ userJid, scopeKey, itemId: 'carro' });
  repository.addCoins({ userJid, scopeKey, amount: 800 });

  const link = await carLinkService.generate({ scopeKey, userJid });
  const otherLink = await carLinkService.generate({ scopeKey, userJid: otherUserJid });

  const funModule = {
    _services: {
      repository,
      carRepository,
      carService,
      carLinkService,
      houseLinkService: { resolve: async () => null },
    },
  };

  const server = await startFunDashboardServer({
    port: 0,
    getConfig: () => ({
      dashboardHost: '127.0.0.1',
      dashboardAllowedOrigins: ['http://localhost:3001'],
    }),
    funModule,
    getContactDisplayName: (jid) => (jid === userJid ? 'Piloto Teste' : 'Outro'),
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}/api/fun/cars/${link.token}`;

  try {
    // 1. Token inválido retorna 404
    const resInvalid = await fetch(`http://127.0.0.1:${address.port}/api/fun/cars/token_inexistente`);
    assert.equal(resInvalid.status, 404);

    // 2. Acesso cruzado não autorizado (outro usuário tentando acessar carro alheio)
    const resUnauthorized = await fetch(baseUrl, {
      headers: { 'x-car-token': otherLink.token },
    });
    assert.equal(resUnauthorized.status, 403);

    // 3. GET /api/fun/cars/:token com token válido retorna dados completos
    const resGet = await fetch(baseUrl, {
      headers: { 'x-car-token': link.token },
    });
    assert.equal(resGet.status, 200);
    const dataGet = await resGet.json();
    assert.equal(dataGet.ok, true);
    assert.equal(dataGet.owns, true);
    assert.equal(dataGet.ownsCar, true);
    assert.equal(dataGet.owner.nickname, 'Piloto Teste');
    assert.equal(dataGet.coins, 800);
    assert.ok(dataGet.catalog.colors.length > 0);

    // 4. PUT /api/fun/cars/:token aplica customizações com sucesso
    const resPut = await fetch(baseUrl, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-car-token': link.token,
      },
      body: JSON.stringify({
        customizations: {
          color: '#00f0ff',
          wheels: 'turbofan',
          spoiler: 'ducktail',
          neon: 'purple',
        },
      }),
    });
    assert.equal(resPut.status, 200);
    const dataPut = await resPut.json();
    assert.equal(dataPut.ok, true);
    assert.equal(dataPut.state.color, '#00f0ff');
    assert.equal(dataPut.state.wheels, 'turbofan');
    assert.equal(dataPut.state.spoiler, 'ducktail');
    assert.ok(dataPut.debited > 0);
    assert.equal(dataPut.coins, 800 - dataPut.debited);

    // 5. GET /api/fun/cars/:token/image retorna PNG válido
    const resImg = await fetch(`${baseUrl}/image`, {
      headers: { 'x-car-token': link.token },
    });
    assert.equal(resImg.status, 200);
    assert.equal(resImg.headers.get('content-type'), 'image/png');
    const imgBuf = Buffer.from(await resImg.arrayBuffer());
    assert.ok(imgBuf.length > 1000);
    assert.equal(imgBuf.slice(0, 4).toString('hex'), '89504e47');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('subcomandos AAA: /carro dyno e /carro presets', async () => {
  const { carService, carLinkService, marketRepository, repository, scopeKey, userJid } = setupTest();

  marketRepository.addInventory({ userJid, scopeKey, itemId: 'carro' });
  repository.addCoins({ userJid, scopeKey, amount: 200 });

  const dynoReplies = [];
  const dynoRes = await handleCarCommand({
    isGroup: false,
    scopeKey,
    userJid,
    carService,
    carLinkService,
    getContactDisplayName: () => 'Piloto Turbo',
    args: ['dyno'],
    reply: async (text) => dynoReplies.push(text),
  });

  assert.equal(dynoRes.handled, true);
  assert.match(dynoReplies[0], /DINAMOMÉTRICA/);
  assert.match(dynoReplies[0], /Potência de Pico/);
  assert.match(dynoReplies[0], /Torque Máximo/);
  assert.match(dynoReplies[0], /PR/);

  const presetReplies = [];
  const presetRes = await handleCarCommand({
    isGroup: false,
    scopeKey,
    userJid,
    carService,
    carLinkService,
    args: ['presets'],
    reply: async (text) => presetReplies.push(text),
  });

  assert.equal(presetRes.handled, true);
  assert.match(presetReplies[0], /PILOTOS LENDÁRIOS/);
  assert.match(presetReplies[0], /Cyberpunk/);
  assert.match(presetReplies[0], /Drift King/);

  // meu_carro dyno
  const myCarDynoReplies = [];
  const myCarDyno = await handleMyCarCommand({
    scopeKey,
    userJid,
    carService,
    getContactDisplayName: () => 'Piloto Pro',
    args: ['dyno'],
    reply: async (text) => myCarDynoReplies.push(text),
  });
  assert.equal(myCarDyno.handled, true);
  assert.match(myCarDynoReplies[0], /DINAMOMÉTRICA/);
});

test('pipeline de mensagens: /carro no privado gera link da oficina e não diz que está desativado', async () => {
  const { carService, carLinkService, marketRepository, repository, scopeKey, userJid } = setupTest();

  // Usuário possui carro no inventário e moedas
  marketRepository.addInventory({ userJid, scopeKey, itemId: 'carro' });
  repository.addCoins({ userJid, scopeKey, amount: 350 });

  const sentMessages = [];
  const fakeSock = {};

  const deps = {
    carService,
    carLinkService,
    repository,
    funConfig: { enabled: true, allowDm: true, carEnabled: true, prefix: '/' },
    getContactDisplayName: () => 'Piloto Campeão',
    sendText: async (sock, jid, text) => {
      sentMessages.push({ jid, text });
      return { key: { id: 'msg-1' } };
    },
    membershipService: {
      resolveDmScope: async () => ({
        ok: true,
        scopeKey,
        source: 'single',
        groups: [{ jid: scopeKey, name: 'Grupo dos Pilotos' }],
      }),
    },
    prefsRepository: {
      get: () => ({ preferredScopeKey: scopeKey, lastGroupJid: scopeKey }),
      setPreferredScope: () => {},
    },
  };

  const ctx = {
    sock: fakeSock,
    chatJid: userJid,
    actorJid: userJid,
    isGroup: false,
    text: '/carro',
    messageType: 'text',
  };

  const result = await handleFunIncomingMessage(deps, ctx);
  assert.equal(result.handled, true);
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].jid, userJid);
  // Não pode responder que está desativado
  assert.doesNotMatch(sentMessages[0].text, /desativada neste bot/i);
  // Deve gerar o link para a oficina 3D
  assert.match(sentMessages[0].text, /\/carros\/[a-zA-Z0-9_-]+/i);
  assert.match(sentMessages[0].text, /Sua Garagem VIP/i);
  assert.match(sentMessages[0].text, /Saldo: \*350 coins\*/);
});

