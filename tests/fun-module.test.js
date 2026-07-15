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
import { createFunFactionRepository } from '../fun/db/funFactionRepository.js';
import { createFunSocialRepository } from '../fun/db/funSocialRepository.js';
import { createFunMissionRepository } from '../fun/db/funMissionRepository.js';
import { createFunEventRepository } from '../fun/db/funEventRepository.js';
import { createBridgeService } from '../fun/services/bridgeService.js';
import { createFactionService } from '../fun/services/factionService.js';
import { createMissionService } from '../fun/services/missionService.js';
import { createEventService } from '../fun/services/eventService.js';

await initDb();
_resetDefaultFunStatsRepository();

function uniqueJid(prefix = '5511') {
  return `${prefix}${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 90 + 10)}@s.whatsapp.net`;
}

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

// â”€â”€â”€ Curva â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€ award / cooldown / leaderboard / daily â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€ Coins / pay â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€ Marry / ship â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

  // random 0.1 < 0.5 â†’ cai no lado escolhido
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

  // random 0.9 >= 0.5 â†’ cai no oposto
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

test('P0 facÃ§Ãµes, ponte, missÃ£o e evento', () => {
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const factionRepo = createFunFactionRepository({ getDatabase: getDb });
  const socialRepo = createFunSocialRepository({ getDatabase: getDb });
  const missionRepo = createFunMissionRepository({ getDatabase: getDb });
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const bridge = createBridgeService({
    socialRepository: socialRepo,
    factionRepository: factionRepo,
  });
  const factions = createFactionService({
    factionRepository: factionRepo,
    repository: repo,
    bridgeService: bridge,
  });
  const missions = createMissionService({
    missionRepository: missionRepo,
    factionRepository: factionRepo,
    repository: repo,
    bridgeService: bridge,
  });
  const events = createEventService({ eventRepository: eventRepo });

  const scope = uniqueGroup();
  const a = `5511911${String(Date.now()).slice(-6)}01@s.whatsapp.net`;
  const b = `5511922${String(Date.now()).slice(-6)}02@s.whatsapp.net`;
  const c = `5511933${String(Date.now()).slice(-6)}03@s.whatsapp.net`;
  repo.addCoins({ userJid: a, scopeKey: scope, amount: 200, reason: 'seed' });
  repo.addCoins({ userJid: b, scopeKey: scope, amount: 200, reason: 'seed' });
  repo.addCoins({ userJid: c, scopeKey: scope, amount: 200, reason: 'seed' });

  const f1 = factions.create({
    scopeKey: scope,
    userJid: a,
    name: 'Fundao',
    funConfig: { factionCreateCost: 50, factionMaxMembers: 8 },
  });
  assert.equal(f1.ok, true);
  const f2 = factions.create({
    scopeKey: scope,
    userJid: b,
    name: 'Mafia',
    funConfig: { factionCreateCost: 50, factionMaxMembers: 8 },
  });
  assert.equal(f2.ok, true);
  assert.equal(factions.join({
    scopeKey: scope,
    userJid: c,
    name: 'Mafia',
    funConfig: { factionMaxMembers: 8 },
  }).ok, true);

  const don = factions.donate({ scopeKey: scope, userJid: a, amount: 40 });
  assert.equal(don.ok, true);
  assert.equal(don.faction.vaultCoins, 40);

  bridge.recordInteraction({ scopeKey: scope, fromJid: a, toJid: a, kind: 'pay' }); // no-op same
  for (let i = 0; i < 8; i += 1) {
    bridge.recordInteraction({ scopeKey: scope, fromJid: a, toJid: b, kind: 'pay' });
  }
  for (let i = 0; i < 2; i += 1) {
    bridge.recordInteraction({ scopeKey: scope, fromJid: a, toJid: a, kind: 'pay' });
  }
  // internal for fundao alone doesn't count well - add internal between a and... only a in fundao
  // cross a-b: external for both
  const br = bridge.getFactionBridge(scope, f1.faction.id, { bridgeMinActions: 5, bridgeDebuffThreshold: 0.25 });
  assert.ok(br.total >= 5);
  assert.ok(br.external >= 5);

  const report = bridge.listPanelinhaReport(scope, { bridgeMinActions: 5 });
  assert.ok(report.rows.length >= 2);

  const spawned = missions.spawn({
    scopeKey: scope,
    funConfig: { missionSquadSize: 2, missionRewardPerMember: 20, missionDurationMs: 3600000 },
  });
  assert.equal(spawned.ok, true);
  assert.ok(spawned.mission.members.length >= 2);

  const ev = events.startCrossFaction({
    scopeKey: scope,
    funConfig: { eventDurationMs: 600000, eventCooldownMs: 0, eventCrossMultiplier: 2 },
    force: true,
  });
  assert.equal(ev.ok, true);
  const st = events.getStatus(scope);
  assert.equal(st.active, true);
  assert.equal(st.multiplier, 2);
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



// â”€â”€â”€ Group settings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€ Rank card PNG â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€ Facade integration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
  // LID disfarÃ§ado de user jid
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
  // JIDs curtos estilo BR para nÃ£o cair na heurÃ­stica de LID opaco
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

test('ollama config defaults + flavorService fallback', async () => {
  const cfg = resolveFunConfig({});
  assert.equal(cfg.ollamaEnabled, true);
  assert.equal(cfg.ollamaModel, 'gemma4:latest');
  assert.ok(cfg.ollamaBaseUrl.includes('11434'));
  assert.equal(cfg.zenEnabled, true);
  assert.ok(String(cfg.zenBaseUrl || '').includes('3000'));

  const { createFlavorService } = await import('../fun/llm/flavorService.js');

  // offline / disabled → fallback sem chamar generate
  let calls = 0;
  const offline = createFlavorService({
    getConfig: () => resolveFunConfig({ ollamaEnabled: false, zenEnabled: false }),
    generate: async () => {
      calls += 1;
      return 'nao deveria';
    },
  });
  const lineOff = await offline.line('faction_create', { name: 'Lobos' });
  assert.ok(lineOff.length > 5);
  assert.equal(calls, 0);

  // generate falha → fallback (zen desligado)
  const failing = createFlavorService({
    getConfig: () => resolveFunConfig({ ollamaEnabled: true, zenEnabled: false, ollamaTimeoutMs: 500 }),
    generate: async () => {
      throw new Error('network');
    },
  });
  const lineFail = await failing.line('flip_win', {});
  assert.ok(lineFail.length > 5);

  // generate ok → usa resposta sanitizada
  const ok = createFlavorService({
    getConfig: () => resolveFunConfig({ ollamaEnabled: true, zenEnabled: false }),
    generate: async () => '  "A moeda brilhou pro lado certo."  ',
  });
  const lineOk = await ok.line('flip_win', {});
  assert.match(lineOk, /moeda/i);
  assert.ok(!lineOk.startsWith('"'));

  const italic = await ok.italicLine('flip_win', {});
  assert.ok(italic.startsWith('_') && italic.endsWith('_'));

  // cascata: zen falha → ollama mock
  const cascade = createFlavorService({
    getConfig: () => resolveFunConfig({ zenEnabled: true, ollamaEnabled: true }),
    zenGenerate: async () => {
      throw new Error('zen-down');
    },
    generate: async () => 'Frase do ollama mock.',
  });
  const lineCascade = await cascade.line('ship', { percent: 10 });
  assert.match(lineCascade, /ollama mock/i);
  assert.equal(cascade.lastProvider(), 'ollama');
});

test('facade: flavorService injetado em /cf e /faccao criar', async () => {
  const groupJid = uniqueGroup();
  const userA = `5511777${String(Date.now()).slice(-6)}03@s.whatsapp.net`;
  const sent = [];
  const funConfig = resolveFunConfig({
    enabled: true,
    cooldownMs: 0,
    flipMin: 5,
    flipMax: 80,
    flipCooldownMs: 0,
    requireGroupWhitelist: true,
    groupWhitelistJids: [groupJid],
    factionCreateCost: 0,
    ollamaEnabled: true,
    zenEnabled: false,
  });

  const { createFlavorService } = await import('../fun/llm/flavorService.js');
  const flavorService = createFlavorService({
    getConfig: () => funConfig,
    generate: async ({ prompt }) => {
      const p = String(prompt);
      if (/fac|panelinha/i.test(p)) {
        return 'Narrador: Panelinha no ar, pessoal.';
      }
      return 'Sorte absurda no flip de teste.';
    },
  });

  const funModule = createFunModule({
    getConfig: () => funConfig,
    getLogger: () => null,
    getDatabase: getDb,
    flavorService,
    sendText: async (_s, jid, text) => {
      sent.push({ jid, text });
    },
    getContactDisplayName: (jid) => (jid === userA ? 'Tester' : ''),
    listContacts: () => [{ jid: userA, name: 'Tester' }],
  });
  funModule.init();
  funModule._services.repository.addCoins({
    userJid: userA,
    scopeKey: groupJid,
    amount: 100,
    reason: 'seed',
  });

  sent.length = 0;
  await funModule.onIncomingMessage({
    sock: {},
    chatJid: groupJid,
    actorJid: userA,
    isGroup: true,
    text: '/faccao criar Os Testadores',
    messageType: 'text',
  });
  assert.ok(
    sent.some(m => /Nova fac/i.test(m.text) && /Panelinha no ar/i.test(m.text)),
    `faccao flavor missing: ${JSON.stringify(sent)}`
  );

  sent.length = 0;
  // forÃ§a resultado determinÃ­stico? gameService usa random â€” sÃ³ checa que linha de flavor aparece no final se vitÃ³ria/derrota
  await funModule.onIncomingMessage({
    sock: {},
    chatJid: groupJid,
    actorJid: userA,
    isGroup: true,
    text: '/cf 10 cara',
    messageType: 'text',
  });
  assert.ok(
    sent.some(m => /Cara ou coroa/i.test(m.text) && /Sorte absurda|moeda|lado|Errou|Acertou/i.test(m.text)),
    `flip reply missing flavor path: ${JSON.stringify(sent)}`
  );
  assert.ok(funModule._services.flavorService);
});

test('ollama keep_alive + warmup API', async () => {
  const { normalizeKeepAlive, ollamaWarmup } = await import('../fun/llm/ollamaClient.js');
  assert.equal(normalizeKeepAlive(-1), -1);
  assert.equal(normalizeKeepAlive('30m'), '30m');
  assert.equal(normalizeKeepAlive(undefined, -1), -1);

  const { createFlavorService } = await import('../fun/llm/flavorService.js');
  let warmCalls = 0;
  let genKeepAlive = null;
  const svc = createFlavorService({
    getConfig: () =>
      resolveFunConfig({
        ollamaEnabled: true,
        zenEnabled: false,
        ollamaKeepAlive: -1,
        ollamaKeepAliveRefreshMs: 0,
      }),
    warmup: async (opts) => {
      warmCalls += 1;
      assert.equal(opts.keepAlive, -1);
      return { ok: true, model: opts.model, ms: 12 };
    },
    generate: async (opts) => {
      genKeepAlive = opts.keepAlive;
      return 'Frase quente de teste.';
    },
  });

  const w = await svc.warmup();
  assert.equal(w.ok, true);
  assert.equal(warmCalls, 1);
  assert.equal(svc.isWarm(), true);

  const line = await svc.line('flip_win', {});
  assert.match(line, /quente/i);
  assert.equal(genKeepAlive, -1);

  svc.stopKeepAliveLoop();
});

test('replyCommandsInPrivate: solo vai DM, aposta/facÃ§Ã£o no grupo', async () => {
  const groupJid = uniqueGroup();
  const userA = `5511666${String(Date.now()).slice(-6)}04@s.whatsapp.net`;
  const sent = [];
  const funConfig = resolveFunConfig({
    enabled: true,
    cooldownMs: 0,
    flipCooldownMs: 0,
    flipMin: 5,
    flipMax: 80,
    requireGroupWhitelist: true,
    groupWhitelistJids: [groupJid],
    replyCommandsInPrivate: true,
    factionCreateCost: 0,
    ollamaEnabled: false,
  });

  const funModule = createFunModule({
    getConfig: () => funConfig,
    getLogger: () => null,
    getDatabase: getDb,
    sendText: async (_s, jid, text) => {
      sent.push({ jid, text });
    },
    getContactDisplayName: () => 'Tester',
    listContacts: () => [{ jid: userA, name: 'Tester' }],
  });
  funModule.init();
  funModule._services.repository.addCoins({
    userJid: userA,
    scopeKey: groupJid,
    amount: 200,
    reason: 'seed',
  });

  sent.length = 0;
  await funModule.onIncomingMessage({
    sock: {},
    chatJid: groupJid,
    actorJid: userA,
    isGroup: true,
    text: '/saldo',
    messageType: 'text',
  });
  assert.ok(sent.length >= 1, 'saldo should reply');
  assert.ok(
    sent.every(m => m.jid === userA),
    `saldo deve ir no DM: ${JSON.stringify(sent)}`
  );

  sent.length = 0;
  await funModule.onIncomingMessage({
    sock: {},
    chatJid: groupJid,
    actorJid: userA,
    isGroup: true,
    text: '/faccao criar DMTest',
    messageType: 'text',
  });
  assert.ok(sent.some(m => /fac|Nova fac/i.test(m.text)));
  assert.ok(
    sent.every(m => m.jid === groupJid),
    `faccao deve ficar no grupo: ${JSON.stringify(sent)}`
  );
});
