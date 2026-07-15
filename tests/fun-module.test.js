import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import {
  createFunModule,
  parseFunCommand,
  isFunCommandText,
  xpToNext,
  totalXpForLevel,
  levelFromTotalXp,
  progressInLevel,
  resolveFunConfig,
  getFunGroupWhitelistSet,
} from '../fun/index.js';
import { createFunStatsRepository, _resetDefaultFunStatsRepository } from '../fun/db/funStatsRepository.js';
import { createFunGroupRepository } from '../fun/db/funGroupRepository.js';
import { createFunRelationshipRepository } from '../fun/db/funRelationshipRepository.js';
import { createFunActionRepository } from '../fun/db/funActionRepository.js';
import { createXpService } from '../fun/services/xpService.js';
import { createRankService } from '../fun/services/rankService.js';
import { createDailyService } from '../fun/services/dailyService.js';
import { createCoinsService } from '../fun/services/coinsService.js';
import { createRelationshipService } from '../fun/services/relationshipService.js';
import { createGameService } from '../fun/services/gameService.js';
import { createShopService } from '../fun/services/shopService.js';
import { createFunEffectsRepository } from '../fun/db/funEffectsRepository.js';
import { resolveFunScope } from '../fun/pipeline/onIncomingMessage.js';
import { renderRankCardPng, encodePngRgb } from '../fun/formatters/rankCardImage.js';
import { DAY_MS, ACTION_TYPE } from '../fun/constants.js';

await initDb();
_resetDefaultFunStatsRepository();

function uniqueJid(prefix = '5511') {
  return `${prefix}${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 90 + 10)}@s.whatsapp.net`;
}

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

// ─── Curva ───────────────────────────────────────────────────────────────────

test('levelCurve: xpToNext e totalXpForLevel consistentes', () => {
  assert.equal(xpToNext(1), 100);
  assert.equal(totalXpForLevel(2), 100);
  assert.equal(totalXpForLevel(3), 250);
  assert.equal(levelFromTotalXp(100), 2);
  assert.equal(progressInLevel(100).level, 2);
});

test('normalizeFunConfig: defaults standalone', () => {
  const defaults = resolveFunConfig({});
  assert.equal(defaults.enabled, true);
  assert.equal(defaults.rankCardImage, true);
  assert.equal(defaults.dashboardEnabled, true);
  assert.equal(defaults.dashboardPort, 8790);
});

test('parseFunCommand: pay/marry/ship aliases', () => {
  assert.deepEqual(parseFunCommand('/pay 50', '/'), { command: 'pay', args: ['50'] });
  assert.equal(parseFunCommand('/pagar 10', '/').command, 'pay');
  assert.equal(parseFunCommand('/casar', '/').command, 'marry');
  assert.equal(parseFunCommand('/ship', '/').command, 'ship');
  assert.equal(parseFunCommand('/saldo', '/').command, 'coins');
  assert.equal(isFunCommandText('/rank'), true);
});

// ─── award / cooldown / leaderboard / daily ──────────────────────────────────

test('awardXp cooldown e level-up', () => {
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const userJid = uniqueJid();
  const scopeKey = uniqueGroup();
  const t0 = Date.now();

  const first = repo.awardXp({ userJid, scopeKey, amount: 100, now: t0, cooldownMs: 60_000 });
  assert.equal(first.applied, true);
  assert.equal(first.level, 2);

  const blocked = repo.awardXp({ userJid, scopeKey, amount: 20, now: t0 + 1000, cooldownMs: 60_000 });
  assert.equal(blocked.reason, 'cooldown');
});

test('leaderboard e rank position', () => {
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const scopeKey = uniqueGroup();
  const now = Date.now();
  const a = uniqueJid('55110');
  const b = uniqueJid('55111');
  repo.awardXp({ userJid: a, scopeKey, amount: 50, now, cooldownMs: 0 });
  repo.awardXp({ userJid: b, scopeKey, amount: 200, now: now + 1, cooldownMs: 0 });
  const board = repo.getLeaderboard(scopeKey, 10);
  assert.equal(board[0].userJid, b);
  assert.equal(repo.getUserRankPosition(a, scopeKey).rank, 2);
});

test('claimDaily streak', () => {
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const userJid = uniqueJid();
  const scopeKey = uniqueGroup();
  const t0 = Date.now();
  const first = repo.claimDaily({ userJid, scopeKey, now: t0, rewardXp: 150, rewardCoins: 50 });
  assert.equal(first.claimed, true);
  assert.equal(first.coins, 50);
  assert.equal(repo.claimDaily({ userJid, scopeKey, now: t0 + 1, rewardXp: 10, rewardCoins: 0 }).reason, 'already-claimed');
  const next = repo.claimDaily({ userJid, scopeKey, now: t0 + DAY_MS + 1, rewardXp: 10, rewardCoins: 5 });
  assert.equal(next.dailyStreak, 2);
});

// ─── Coins / pay ─────────────────────────────────────────────────────────────

test('transferCoins: pay entre users', () => {
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const coins = createCoinsService({ repository: repo });
  const scopeKey = uniqueGroup();
  const from = uniqueJid('55120');
  const to = uniqueJid('55121');

  repo.addCoins({ userJid: from, scopeKey, amount: 100, reason: 'test' });
  const fail = coins.transfer({ fromJid: from, toJid: to, scopeKey, amount: 200 });
  assert.equal(fail.ok, false);
  assert.equal(fail.reason, 'insufficient-funds');

  const ok = coins.transfer({ fromJid: from, toJid: to, scopeKey, amount: 40 });
  assert.equal(ok.ok, true);
  assert.equal(ok.fromCoins, 60);
  assert.equal(coins.getBalance(to, scopeKey), 40);
});

// ─── Marry / ship ────────────────────────────────────────────────────────────

test('marry com proposta aceitar/recusar + ship', () => {
  const relRepo = createFunRelationshipRepository({ getDatabase: getDb });
  const actRepo = createFunActionRepository({ getDatabase: getDb });
  const rel = createRelationshipService({
    relationshipRepository: relRepo,
    actionRepository: actRepo,
  });
  const scopeKey = uniqueGroup();
  const a = uniqueJid('55130');
  const b = uniqueJid('55131');

  const prop = rel.proposeMarry({ userJid: a, partnerJid: b, scopeKey });
  assert.equal(prop.ok, true);
  assert.equal(prop.married, false);
  assert.equal(rel.getMarriage(a, scopeKey), null);

  const declined = rel.declineMarry({ userJid: b, scopeKey });
  assert.equal(declined.ok, true);

  const prop2 = rel.proposeMarry({ userJid: a, partnerJid: b, scopeKey });
  assert.equal(prop2.ok, true);
  const accepted = rel.acceptMarry({ userJid: b, scopeKey });
  assert.equal(accepted.ok, true);
  assert.equal(rel.getMarriage(a, scopeKey).partnerJid, b);
  assert.equal(rel.getMarriage(b, scopeKey).partnerJid, a);

  assert.equal(rel.divorce({ userJid: a, scopeKey }).ok, true);
  assert.equal(rel.getMarriage(a, scopeKey), null);

  const ship = rel.ship(a, b);
  assert.equal(ship.ok, true);
  assert.equal(rel.ship(a, b).percent, ship.percent);
});

test('rank coins e jogos solo/aposta', () => {
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const actRepo = createFunActionRepository({ getDatabase: getDb });
  const games = createGameService({
    repository: repo,
    actionRepository: actRepo,
    random: () => 0.1, // win paths
  });
  const rank = createRankService({ repository: repo });
  const scopeKey = uniqueGroup();
  const a = uniqueJid('55150');
  const b = uniqueJid('55151');

  repo.addCoins({ userJid: a, scopeKey, amount: 100, reason: 'seed' });
  repo.addCoins({ userJid: b, scopeKey, amount: 30, reason: 'seed' });

  const coinsBoard = rank.getCoinsLeaderboard(scopeKey, 10);
  assert.equal(coinsBoard[0].userJid, a);
  assert.equal(rank.getUserCoinsRankPosition(b, scopeKey).rank, 2);

  // random 0.1 < 0.5 → cai no lado escolhido
  const flip = games.soloFlip({
    userJid: a,
    scopeKey,
    amount: 10,
    choice: 'cara',
    funConfig: { flipMin: 5, flipMax: 100, flipCooldownMs: 0 },
  });
  assert.equal(flip.ok, true);
  assert.equal(flip.pick, 'cara');
  assert.equal(flip.win, true);
  assert.equal(flip.side, 'cara');
  assert.equal(flip.win, flip.side === flip.pick);

  // random 0.9 >= 0.5 → cai no oposto
  const gamesLose = createGameService({
    repository: repo,
    actionRepository: actRepo,
    random: () => 0.9,
  });
  repo.addCoins({ userJid: a, scopeKey, amount: 50, reason: 'seed2' });
  const lose = gamesLose.soloFlip({
    userJid: a,
    scopeKey,
    amount: 10,
    choice: 'coroa',
    funConfig: { flipMin: 5, flipMax: 100, flipCooldownMs: 0 },
  });
  assert.equal(lose.ok, true);
  assert.equal(lose.pick, 'coroa');
  assert.equal(lose.side, 'cara');
  assert.equal(lose.win, false);
  assert.equal(lose.win, lose.side === lose.pick);

  const noChoice = games.soloFlip({
    userJid: a,
    scopeKey,
    amount: 10,
    funConfig: { flipMin: 5, flipMax: 100, flipCooldownMs: 0 },
  });
  assert.equal(noChoice.reason, 'missing-choice');

  const job = games.doJob({
    userJid: a,
    scopeKey,
    funConfig: { jobMin: 10, jobMax: 10, jobCooldownMs: 0 },
  });
  assert.equal(job.ok, true);
  assert.equal(job.gain, 10);

  const bet = games.proposeBet({
    fromJid: a,
    toJid: b,
    scopeKey,
    amount: 15,
    choice: 'coroa',
    funConfig: { betMin: 5, betMax: 200 },
  });
  assert.equal(bet.ok, true);
  assert.equal(bet.choice, 'coroa');
  assert.equal(bet.action.actionType, ACTION_TYPE.BET_COINFLIP);

  const accepted = games.acceptBet({ userJid: b, scopeKey });
  assert.equal(accepted.ok, true);
  assert.ok(accepted.pot === 30);
});

test('loja: compra boost e gasta coins', () => {
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const effects = createFunEffectsRepository({ getDatabase: getDb });
  const shop = createShopService({ repository: repo, effectsRepository: effects });
  const scopeKey = uniqueGroup();
  const u = uniqueJid('55160');
  repo.addCoins({ userJid: u, scopeKey, amount: 500, reason: 'seed' });

  const buy = shop.buy({ userJid: u, scopeKey, itemId: 'boost_xp' });
  assert.equal(buy.ok, true);
  assert.equal(buy.coins, 380);
  const boost = effects.isXpBoostActive(u, scopeKey);
  assert.equal(boost.active, true);
  assert.equal(boost.multiplier, 2);

  const title = shop.buy({
    userJid: u,
    scopeKey,
    itemId: 'title',
    titleText: 'Lenda',
    funConfig: { titleMaxLen: 16 },
  });
  assert.equal(title.ok, true);
  assert.equal(repo.getUserStats(u, scopeKey).title, 'Lenda');
});



// ─── Group settings ──────────────────────────────────────────────────────────

test('fun_group_settings override rates', () => {
  const groups = createFunGroupRepository({ getDatabase: getDb });
  const groupJid = uniqueGroup();
  const global = resolveFunConfig({ xpMin: 15, xpMax: 25, cooldownMs: 60000 });

  const defaults = groups.resolveEffectiveRates(groupJid, global);
  assert.equal(defaults.source, 'global');
  assert.equal(defaults.xpMin, 15);

  groups.upsertGroupSettings({
    groupJid,
    enabled: true,
    xpMin: 5,
    xpMax: 8,
    cooldownMs: 1000,
    dailyXp: 99,
    dailyCoins: 11,
    rankLimit: 5,
  });

  const eff = groups.resolveEffectiveRates(groupJid, global);
  assert.equal(eff.source, 'group');
  assert.equal(eff.xpMin, 5);
  assert.equal(eff.xpMax, 8);
  assert.equal(eff.dailyXp, 99);
  assert.equal(eff.rankLimit, 5);
});

// ─── Rank card PNG ───────────────────────────────────────────────────────────

test('rank card PNG valido', () => {
  const tiny = encodePngRgb(2, 2, Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]));
  assert.equal(tiny[0], 137);
  assert.ok(tiny.length > 50);

  const png = renderRankCardPng({
    title: 'RANK',
    entries: [
      { rank: 1, displayName: 'Alice', userJid: uniqueJid(), level: 3, xp: 250 },
      { rank: 2, displayName: 'Bob', userJid: uniqueJid(), level: 2, xp: 120 },
    ],
    yourRank: 2,
    yourTotal: 2,
  });
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.ok(png.length > 200);
});

// ─── Facade integration ──────────────────────────────────────────────────────

test('pay resolve LID mention para PN real', async () => {
  const {
    createIdentityMap,
    findJidByDisplayName,
    extractNameQueryFromArgs,
    resolveUserTarget,
  } = await import('../fun/utils/identity.js');

  assert.equal(extractNameQueryFromArgs(['5', '@Anjo', 'Azul']), 'Anjo Azul');
  assert.equal(
    findJidByDisplayName('Anjo Azul', [
      { jid: '5511999999999@s.whatsapp.net', name: 'Anjo Azul' },
      { jid: '5511888888888@s.whatsapp.net', name: 'Outro' },
    ]),
    '5511999999999@s.whatsapp.net'
  );

  const map = createIdentityMap();
  const lid = '281350775005409@lid';
  const pn = '5511987654321@s.whatsapp.net';
  map.remember(lid, pn);
  assert.equal(map.resolve(lid), pn);
  assert.equal(map.resolve('281350775005409'), pn);
  // LID disfarçado de user jid
  map.remember('281350775005409@s.whatsapp.net', pn);
  assert.equal(map.resolve('281350775005409@s.whatsapp.net'), pn);

  const sock = {
    groupMetadata: async () => ({
      participants: [
        { id: lid, lid, jid: pn, notify: 'Anjo Azul' },
        { id: '5511111111111@s.whatsapp.net', jid: '5511111111111@s.whatsapp.net', notify: 'Edu' },
      ],
    }),
  };

  const byMention = await resolveUserTarget({
    mentionedJids: [lid],
    args: ['5'],
    excludeJid: '5511111111111@s.whatsapp.net',
    identityMap: map,
    sock,
    groupJid: '120363999@g.us',
    contacts: [],
  });
  assert.equal(byMention.jid, pn);

  const byName = await resolveUserTarget({
    mentionedJids: [],
    args: ['5', '@Anjo', 'Azul'],
    excludeJid: '5511111111111@s.whatsapp.net',
    identityMap: createIdentityMap(),
    sock,
    groupJid: '120363999@g.us',
    contacts: [{ jid: pn, name: 'Anjo Azul' }],
  });
  assert.equal(byName.jid, pn);
});

test('facade: pay, rank image path, group rates', async () => {
  const groupJid = uniqueGroup();
  // JIDs curtos estilo BR para não cair na heurística de LID opaco
  const userA = `5511999${String(Date.now()).slice(-6)}01@s.whatsapp.net`;
  const userB = `5511888${String(Date.now()).slice(-6)}02@s.whatsapp.net`;
  const sent = [];
  const images = [];

  const funConfig = resolveFunConfig({
    enabled: true,
    cooldownMs: 0,
    xpMin: 20,
    xpMax: 20,
    dailyXp: 100,
    dailyCoins: 10,
    rankLimit: 10,
    announceLevelUp: false,
    requireGroupWhitelist: true,
    groupWhitelistJids: [groupJid],
    rankCardImage: true,
  });

  const funModule = createFunModule({
    getConfig: () => funConfig,
    getLogger: () => null,
    getDatabase: getDb,
    sendText: async (_s, jid, text) => { sent.push({ jid, text }); },
    sendImage: async (_s, jid, payload) => { images.push({ jid, ...payload }); },
    getContactDisplayName: (jid) => (jid === userA ? 'Alice' : jid === userB ? 'Bob' : ''),
    listContacts: () => [
      { jid: userA, name: 'Alice' },
      { jid: userB, name: 'Bob' },
    ],
  });
  funModule.init();

  // seed coins for A
  funModule._services.repository.addCoins({ userJid: userA, scopeKey: groupJid, amount: 80, reason: 'seed' });

  await funModule.onIncomingMessage({
    sock: {
      groupMetadata: async () => ({
        participants: [
          { id: userA, jid: userA, notify: 'Alice' },
          { id: userB, jid: userB, notify: 'Bob' },
        ],
      }),
    },
    chatJid: groupJid,
    actorJid: userA,
    isGroup: true,
    text: '/pay 30',
    messageType: 'text',
    mentionedJids: [userB],
  });
  assert.ok(
    sent.some(m => /Pagamento|coins|Saldo/i.test(m.text)),
    `pay reply missing, got: ${JSON.stringify(sent)}`
  );
  assert.equal(funModule._services.coinsService.getBalance(userB, groupJid), 30);

  // rank com imagem
  funModule._services.repository.awardXp({
    userJid: userA, scopeKey: groupJid, amount: 50, now: Date.now(), cooldownMs: 0,
  });
  images.length = 0;
  await funModule.onIncomingMessage({
    sock: {},
    chatJid: groupJid,
    actorJid: userA,
    isGroup: true,
    text: '/rank',
    messageType: 'text',
  });
  assert.ok(images.length >= 1);
  assert.equal(images[0].imageBuffer[0], 137);

  // ship
  sent.length = 0;
  await funModule.onIncomingMessage({
    sock: {},
    chatJid: groupJid,
    actorJid: userA,
    isGroup: true,
    text: '/ship',
    messageType: 'text',
    mentionedJids: [userB],
  });
  assert.ok(sent.some(m => /Ship|%/i.test(m.text)));
});

test('resolveFunScope whitelist propria', () => {
  const groupJid = uniqueGroup();
  const funConfig = resolveFunConfig({
    enabled: true,
    requireGroupWhitelist: true,
    groupWhitelistJids: [groupJid],
  });
  assert.equal(
    resolveFunScope({
      chatJid: groupJid,
      isGroup: true,
      funConfig,
      groupWhitelist: getFunGroupWhitelistSet(funConfig),
    }).eligible,
    true
  );
});

test('services xp/rank/daily still work', () => {
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const xpService = createXpService({ repository: repo, random: () => 0 });
  const rankService = createRankService({ repository: repo });
  const dailyService = createDailyService({ repository: repo });
  const userJid = uniqueJid();
  const scopeKey = uniqueGroup();
  const now = Date.now();
  assert.equal(xpService.awardXp({ userJid, scopeKey, xpMin: 15, xpMax: 25, cooldownMs: 0, now }).gained, 15);
  assert.equal(rankService.getProfile(userJid, scopeKey).rank, 1);
  assert.equal(dailyService.claimDaily({ userJid, scopeKey, now: now + 1, rewardXp: 50, rewardCoins: 5 }).claimed, true);
});
