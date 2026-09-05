import test from 'node:test';
import assert from 'node:assert/strict';
import { startFunDashboardServer } from '../fun/dashboard/server.js';
import { DEFAULT_FUN_CONFIG } from '../fun/constants.js';

test('constants: imageGenApiKey está vazia por padrão', () => {
  assert.equal(DEFAULT_FUN_CONFIG.imageGenApiKey, '');
});

test('dashboard security: bypass de ownership, rotas admin e mascaramento público', async () => {
  const scopeKey = '12345678@g.us';
  const ownerJid = '5511999990001@s.whatsapp.net';
  const visitorJid = '5511999990002@s.whatsapp.net';

  const ownerTokenData = { scopeKey, userJid: ownerJid, tokenId: 1 };
  const visitorTokenData = { scopeKey, userJid: visitorJid, tokenId: 2 };

  const houseData = {
    cleanliness: 90,
    securityLevel: 3,
  };
  const avatarData = {
    schemaVersion: 2,
    revision: 3,
    catalogRevision: 1,
    slots: { hair: 'hair_01' },
    level: 5,
  };

  const groupSettings = {
    groupJid: scopeKey,
    xpMin: 10,
    xpMax: 20,
    enabled: true,
  };

  const calls = {
    collect: 0,
    upsertGroupSettings: 0,
    launchDaily: 0,
    changelog: 0,
    chaos: 0,
  };

  const mockServices = {
    repository: {
      countUsersInScope: () => 42,
      getUserStats: (jid) => ({ coins: jid === ownerJid ? 500 : 100 }),
      getLeaderboard: () => [
        { rank: 1, userJid: '5511999990001@s.whatsapp.net', xp: 1200, level: 10 },
      ],
      getCoinsLeaderboard: () => [
        { rank: 1, userJid: '5511999990001@s.whatsapp.net', coins: 500, level: 10 },
      ],
    },
    groupRepository: {
      getGroupSettings: () => ({ ...groupSettings }),
      resolveEffectiveRates: () => ({ ...groupSettings }),
      upsertGroupSettings: (input) => {
        calls.upsertGroupSettings += 1;
        return { ...input, ok: true };
      },
    },
    casinoRepository: {
      getJackpot: () => ({ pot: 777 }),
      getLeaderboard: () => [],
    },
    eventRepository: {
      get: () => ({ eventType: 'double_xp', endsAt: Date.now() + 60_000, multiplier: 2 }),
    },
    factionRepository: {
      listByScope: () => [],
    },
    houseRepository: {
      listHouses: () => [],
      listGiftsReceived: () => [],
      getHouseByPublicId: () => null,
    },
    houseService: {
      getHouse: () => ({ house: houseData, items: [] }),
      listShop: () => [{ id: 'sofa', price: 100 }],
      collect: () => {
        calls.collect += 1;
        return { ok: true, coins: 50 };
      },
      move: () => ({ ok: true, item: { id: 1, itemId: 'chair', placed: true } }),
      applyStyle: () => ({ ok: true, house: houseData, coins: 400, purchased: false }),
      place: () => ({ ok: true, item: { id: 2, itemId: 'lamp', placed: true }, coins: 350 }),
      sell: () => ({ ok: true, coins: 450 }),
      upgradeSecurity: () => ({ ok: true, house: houseData, coins: 300 }),
    },
    avatarService: {
      get: () => ({ ...avatarData }),
      publicAvatar: (s) => ({ ...s, publicOnly: true }),
      equip: () => ({ ok: true, state: { ...avatarData } }),
      apply: () => ({ ok: true, state: { ...avatarData } }),
      buy: () => ({ ok: true, state: { ...avatarData }, coins: 200 }),
    },
    visitService: {
      mural: () => ({ visits: [] }),
      visit: () => ({ ok: true, visit: { note: 'oi', createdAt: Date.now() } }),
    },
    giftService: {
      give: () => ({ ok: true, gift: { coins: 10, itemInstanceId: null } }),
    },
    robberyService: {
      rob: () => ({ ok: true, result: 'safe', item: null }),
    },
    soundSystemService: null,
    houseLinkService: {
      resolve: async (token) => {
        if (token === 'token-owner') return ownerTokenData;
        if (token === 'token-visitor') return visitorTokenData;
        return null;
      },
    },
    chaosEventService: {
      tryStartEvent: () => {
        calls.chaos += 1;
        return { ok: true, event: { scopeKey } };
      },
      formatStartAnnouncement: () => 'Chaos iniciado!',
    },
  };

  const fakeFunModule = {
    _services: mockServices,
    launchDailyChallengeForWhitelist: async () => {
      calls.launchDaily += 1;
      return { ok: true, sent: 1 };
    },
    broadcastChangelog: async () => {
      calls.changelog += 1;
      return { ok: true, sentCount: 1 };
    },
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
    getContactDisplayName: (jid) => (jid === ownerJid ? 'Dono Da Casa' : 'Visitante'),
    isSocketReady: () => true,
    getSock: () => ({ user: { id: 'bot@s.whatsapp.net' } }),
    sendText: async () => {},
  });

  const { port } = server.address();
  const api = `http://127.0.0.1:${port}`;

  try {
    // 1) Visão da casa para visitante vs dono
    const visitorHouseRes = await fetch(`${api}/api/fun/houses/token-owner`, {
      headers: { 'x-house-token': 'token-visitor' },
    });
    assert.equal(visitorHouseRes.status, 200);
    const visitorHouseJson = await visitorHouseRes.json();
    assert.equal(visitorHouseJson.owns, false);
    assert.equal(visitorHouseJson.coins, undefined);
    assert.equal(visitorHouseJson.host?.nickname, 'Dono Da Casa');

    const ownerHouseRes = await fetch(`${api}/api/fun/houses/token-owner`, {
      headers: { 'x-house-token': 'token-owner' },
    });
    assert.equal(ownerHouseRes.status, 200);
    const ownerHouseJson = await ownerHouseRes.json();
    assert.equal(ownerHouseJson.owns, true);
    assert.equal(ownerHouseJson.coins, 500);

    // 2) Mutações bloqueadas para quem não é dono (403)
    const collectBlocked = await fetch(`${api}/api/fun/houses/token-owner/collect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-house-token': 'token-visitor' },
      body: '{}',
    });
    assert.equal(collectBlocked.status, 403);
    assert.equal((await collectBlocked.json()).error, 'somente-dono');
    assert.equal(calls.collect, 0);

    const placeBlocked = await fetch(`${api}/api/fun/houses/token-owner/items/place`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-house-token': 'token-visitor' },
      body: JSON.stringify({ itemId: 'sofa', x: 1, y: 1 }),
    });
    assert.equal(placeBlocked.status, 403);

    const moveBlocked = await fetch(`${api}/api/fun/houses/token-owner/items/move`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-house-token': 'token-visitor' },
      body: JSON.stringify({ itemId: 1, x: 2, y: 2 }),
    });
    assert.equal(moveBlocked.status, 403);

    const shopBlocked = await fetch(`${api}/api/fun/houses/token-owner/shop`, {
      headers: { 'x-house-token': 'token-visitor' },
    });
    assert.equal(shopBlocked.status, 403);

    // 3) Coleta autorizada com token de dono
    const collectAllowed = await fetch(`${api}/api/fun/houses/token-owner/collect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-house-token': 'token-owner' },
      body: '{}',
    });
    assert.equal(collectAllowed.status, 200);
    assert.equal(calls.collect, 1);

    // 4) Rotas administrativas protegidas com requireAdmin (401 se sem admin)
    const adminRoutes = [
      { method: 'POST', path: '/api/fun/daily-challenge/launch-all', body: { type: 'guess_game' } },
      { method: 'POST', path: '/api/fun/changelog', body: { body: 'Release notas' } },
      { method: 'POST', path: '/api/fun/chaos/trigger', body: { scope: scopeKey } },
      { method: 'PUT', path: `/api/fun/groups/${encodeURIComponent(scopeKey)}/settings`, body: { enabled: false } },
      { method: 'POST', path: `/api/fun/groups/${encodeURIComponent(scopeKey)}/settings`, body: { enabled: true } },
    ];

    for (const route of adminRoutes) {
      const unauth = await fetch(`${api}${route.path}`, {
        method: route.method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(route.body),
      });
      assert.equal(unauth.status, 401, `Esperava 401 em ${route.method} ${route.path}`);
      assert.equal((await unauth.json()).error, 'unauthorized');
    }

    // Com credencial de admin (header x-api-key)
    const adminHeaders = {
      'content-type': 'application/json',
      'x-api-key': 'secret-admin-key',
    };
    const launchAdmin = await fetch(`${api}/api/fun/daily-challenge/launch-all`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ type: 'guess_game' }),
    });
    assert.equal(launchAdmin.status, 200);
    assert.equal(calls.launchDaily, 1);

    const changelogAdmin = await fetch(`${api}/api/fun/changelog`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ body: 'Release v2' }),
    });
    assert.equal(changelogAdmin.status, 200);
    assert.equal(calls.changelog, 1);

    const chaosAdmin = await fetch(`${api}/api/fun/chaos/trigger`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ scope: scopeKey }),
    });
    assert.equal(chaosAdmin.status, 200);
    assert.equal(calls.chaos, 1);

    const settingsAdmin = await fetch(`${api}/api/fun/groups/${encodeURIComponent(scopeKey)}/settings`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({ enabled: false }),
    });
    assert.equal(settingsAdmin.status, 200);
    assert.equal(calls.upsertGroupSettings, 1);

    // 5) Mascaramento de dados em endpoints públicos (groups, overview, leaderboard)
    const publicGroupsRes = await fetch(`${api}/api/fun/groups`);
    const publicGroupsJson = await publicGroupsRes.json();
    assert.equal(publicGroupsJson.groups[0].jid, scopeKey); // grupo @g.us mantido

    const publicOverviewRes = await fetch(`${api}/api/fun/overview?scope=${encodeURIComponent(scopeKey)}`);
    const publicOverviewJson = await publicOverviewRes.json();
    assert.equal(publicOverviewJson.topXp[0].userJid, 'user_****0001');
    assert.equal(publicOverviewJson.topCoins[0].userJid, 'user_****0001');

    const publicLeaderboardRes = await fetch(`${api}/api/fun/leaderboard?scope=${encodeURIComponent(scopeKey)}`);
    const publicLeaderboardJson = await publicLeaderboardRes.json();
    assert.equal(publicLeaderboardJson.entries[0].userJid, 'user_****0001');

    // Com requireAdmin satisfeito, retorna JID original
    const adminOverviewRes = await fetch(`${api}/api/fun/overview?scope=${encodeURIComponent(scopeKey)}`, {
      headers: { 'x-api-key': 'secret-admin-key' },
    });
    const adminOverviewJson = await adminOverviewRes.json();
    assert.equal(adminOverviewJson.topXp[0].userJid, ownerJid);
  } finally {
    process.env.FUN_DASHBOARD_API_KEY = oldApiKey;
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
