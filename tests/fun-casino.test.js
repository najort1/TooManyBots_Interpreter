import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import {
  createFunModule,
  parseFunCommand,
  resolveFunConfig,
} from '../fun/index.js';
import { createFunStatsRepository, _resetDefaultFunStatsRepository } from '../fun/db/funStatsRepository.js';
import { createFunActionRepository } from '../fun/db/funActionRepository.js';
import { createFunEventRepository } from '../fun/db/funEventRepository.js';
import { createFunCasinoRepository } from '../fun/db/funCasinoRepository.js';
import { createCasinoService } from '../fun/services/casinoService.js';
import { createEventService } from '../fun/services/eventService.js';
import { FUN_COMMANDS, ACTION_TYPE } from '../fun/constants.js';

await initDb();
_resetDefaultFunStatsRepository();

function uniqueJid(prefix = '5511') {
  return `${prefix}${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 90 + 10)}@s.whatsapp.net`;
}

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

test('parseFunCommand: aliases cassino', () => {
  assert.equal(parseFunCommand('/roleta 10 vermelho', '/').command, FUN_COMMANDS.ROULETTE);
  assert.equal(parseFunCommand('/slot 15', '/').command, FUN_COMMANDS.SLOT);
  assert.equal(parseFunCommand('/desafio', '/').command, FUN_COMMANDS.DICE_DUEL);
  assert.equal(parseFunCommand('/crash 20', '/').command, FUN_COMMANDS.CRASH);
  assert.equal(parseFunCommand('/sair', '/').command, FUN_COMMANDS.CASHOUT);
  assert.equal(parseFunCommand('/bj 25', '/').command, FUN_COMMANDS.BLACKJACK);
  assert.equal(parseFunCommand('/torneio 20', '/').command, FUN_COMMANDS.TOURNAMENT);
  assert.equal(parseFunCommand('/rankcassino', '/').command, FUN_COMMANDS.RANK_CASINO);
  assert.equal(parseFunCommand('/jackpot', '/').command, FUN_COMMANDS.JACKPOT);
});

test('casino P0: roleta, slot, jackpot, duelo dados', () => {
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const actionRepo = createFunActionRepository({ getDatabase: getDb });
  const casinoRepo = createFunCasinoRepository({ getDatabase: getDb });

  let seq = [0.1];
  let i = 0;
  const random = () => {
    const v = seq[i % seq.length];
    i += 1;
    return v;
  };

  const casino = createCasinoService({
    repository: repo,
    actionRepository: actionRepo,
    casinoRepository: casinoRepo,
    random,
  });

  const scope = uniqueGroup();
  const a = uniqueJid('5511');
  const b = uniqueJid('5512');
  repo.addCoins({ userJid: a, scopeKey: scope, amount: 500, reason: 'seed' });
  repo.addCoins({ userJid: b, scopeKey: scope, amount: 500, reason: 'seed' });

  i = 0;
  seq = [0.1]; // ball = floor(0.1*37)=3 red
  const roul = casino.playRoulette({
    userJid: a,
    scopeKey: scope,
    amount: 40,
    choice: { type: 'color', value: 'red' },
    funConfig: resolveFunConfig({
      casinoMin: 5,
      casinoMax: 100,
      rouletteCooldownMs: 0,
      jackpotRate: 0.05, // max clamp — floor(40*0.05)=2
    }),
  });
  assert.equal(roul.ok, true);
  assert.equal(roul.ball, 3);
  assert.equal(roul.color, 'red');
  assert.equal(roul.win, true);
  assert.ok(roul.payout >= 80);
  assert.ok(roul.pot >= 2, `jackpot pot expected >=2 got ${roul.pot}`);

  i = 0;
  seq = [0.0, 0.0, 0.0];
  const slot = casino.playSlot({
    userJid: a,
    scopeKey: scope,
    amount: 10,
    funConfig: resolveFunConfig({
      casinoMin: 5,
      casinoMax: 100,
      slotCooldownMs: 0,
      jackpotRate: 0,
    }),
  });
  assert.equal(slot.ok, true);
  assert.equal(slot.reels.length, 3);

  const prop = casino.proposeDiceDuel({
    fromJid: a,
    toJid: b,
    scopeKey: scope,
    amount: 20,
    funConfig: resolveFunConfig({ diceDuelMin: 5, diceDuelMax: 150 }),
  });
  assert.equal(prop.ok, true);

  i = 0;
  seq = [0.95, 0.05];
  const acc = casino.acceptDiceDuel({ userJid: b, scopeKey: scope });
  assert.equal(acc.ok, true);
  if (!acc.tie) {
    assert.ok(acc.winnerJid);
    assert.equal(acc.pot, 40);
  }
});

test('casino P1: crash + blackjack', () => {
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const actionRepo = createFunActionRepository({ getDatabase: getDb });
  const casinoRepo = createFunCasinoRepository({ getDatabase: getDb });

  let n = 0;
  const random = () => {
    n += 1;
    if (n === 1) return 0.2;
    return 0.5;
  };

  const casino = createCasinoService({
    repository: repo,
    actionRepository: actionRepo,
    casinoRepository: casinoRepo,
    random,
  });

  const scope = uniqueGroup();
  const u = uniqueJid('5513');
  repo.addCoins({ userJid: u, scopeKey: scope, amount: 300, reason: 'seed' });

  const start = casino.startCrash({
    userJid: u,
    scopeKey: scope,
    amount: 20,
    funConfig: resolveFunConfig({
      crashMin: 5,
      crashMax: 80,
      crashCooldownMs: 0,
      crashGrowthPerSec: 0.5,
      crashTtlMs: 60_000,
      jackpotRate: 0,
    }),
  });
  assert.equal(start.ok, true);

  const out = casino.cashoutCrash({
    userJid: u,
    scopeKey: scope,
    funConfig: resolveFunConfig({ crashGrowthPerSec: 0.01, crashMaxMult: 12 }),
    now: Date.now() + 100,
  });
  assert.equal(out.ok, true);
  assert.equal(typeof out.crashed, 'boolean');

  n = 0;
  const ranks = [0.3, 0.4, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75];
  const randomBj = () => ranks[Math.min(n++, ranks.length - 1)];
  const casino2 = createCasinoService({
    repository: repo,
    actionRepository: actionRepo,
    casinoRepository: casinoRepo,
    random: randomBj,
  });

  const bj = casino2.startBlackjack({
    userJid: u,
    scopeKey: scope,
    amount: 15,
    funConfig: resolveFunConfig({
      blackjackMin: 5,
      blackjackMax: 80,
      blackjackCooldownMs: 0,
      jackpotRate: 0,
    }),
  });
  assert.equal(bj.ok, true);
  if (!bj.done) {
    const stand = casino2.standBlackjack({
      userJid: u,
      scopeKey: scope,
      funConfig: resolveFunConfig({}),
    });
    assert.equal(stand.ok, true);
    assert.equal(stand.done, true);
  }
});

test('casino P2: torneio + rank + happy hour', () => {
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const actionRepo = createFunActionRepository({ getDatabase: getDb });
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  const casinoRepo = createFunCasinoRepository({ getDatabase: getDb });
  const casino = createCasinoService({
    repository: repo,
    actionRepository: actionRepo,
    casinoRepository: casinoRepo,
    eventRepository: eventRepo,
    random: () => 0.5,
  });
  const eventService = createEventService({ eventRepository: eventRepo });

  const scope = uniqueGroup();
  const players = [
    uniqueJid('5514'),
    uniqueJid('5515'),
    uniqueJid('5516'),
    uniqueJid('5517'),
  ];
  for (const p of players) {
    repo.addCoins({ userJid: p, scopeKey: scope, amount: 200, reason: 'seed' });
  }

  const cfg = resolveFunConfig({
    tournamentEntryMin: 10,
    tournamentEntryMax: 80,
    tournamentSize: 4,
    happyHourDurationMs: 60_000,
    happyHourPayoutMult: 1.2,
    happyHourCooldownMs: 0,
  });

  let last;
  for (const p of players) {
    last = casino.joinTournament({
      userJid: p,
      scopeKey: scope,
      entryFee: 20,
      funConfig: cfg,
    });
    assert.equal(last.ok, true);
  }
  assert.equal(last.finished, true);
  assert.ok(last.winnerJid);
  assert.equal(last.pot, 80);

  const board = casino.rankCasino(scope, 10);
  assert.ok(board.length >= 1);

  // happy hour agora é auto-spawn do bot (force via tryAutoSpawn)
  const happy = eventService.tryAutoSpawn({
    scopeKey: scope,
    funConfig: {
      ...cfg,
      eventAutoSpawn: true,
      eventAutoSpawnChance: 1,
      eventHappyWeight: 1,
      eventCrossWeight: 0,
      eventCooldownMs: 0,
    },
    forceRoll: true,
  });
  assert.equal(happy.ok, true);
  assert.equal(happy.eventType, 'casino_happy');
  assert.equal(casino.happyMult(scope), 1.2);
});

test('eventos: só bot inicia — tryAutoSpawn + /evento nega start', async () => {
  const eventRepo = createFunEventRepository({ getDatabase: getDb });
  let rolls = [0.01, 0.1]; // pass chance, pick happy
  let ri = 0;
  const eventService = createEventService({
    eventRepository: eventRepo,
    random: () => rolls[Math.min(ri++, rolls.length - 1)],
  });
  const scope = uniqueGroup();
  const cfg = resolveFunConfig({
    eventAutoSpawn: true,
    eventAutoSpawnChance: 1,
    eventHappyWeight: 1,
    eventCrossWeight: 0,
    eventCooldownMs: 0,
    happyHourDurationMs: 60_000,
    happyHourPayoutMult: 1.15,
  });

  const auto = eventService.tryAutoSpawn({
    scopeKey: scope,
    funConfig: cfg,
    forceRoll: true,
  });
  assert.equal(auto.ok, true);
  assert.equal(auto.eventType, 'casino_happy');
  assert.match(eventService.formatAnnouncement(auto), /HAPPY HOUR/i);

  // cooldown / already active
  const again = eventService.tryAutoSpawn({
    scopeKey: scope,
    funConfig: cfg,
    forceRoll: true,
  });
  assert.equal(again.ok, false);

  // facade: /evento start não inicia
  const groupJid = uniqueGroup();
  const userA = uniqueJid('5599');
  const sent = [];
  const funConfig = resolveFunConfig({
    enabled: true,
    requireGroupWhitelist: true,
    groupWhitelistJids: [groupJid],
    replyCommandsInPrivate: false,
    eventAutoSpawn: true,
    eventCooldownMs: 0,
    ollamaEnabled: false,
  });
  const funModule = createFunModule({
    getConfig: () => funConfig,
    getLogger: () => null,
    getDatabase: getDb,
    sendText: async (_s, jid, text) => sent.push({ jid, text }),
  });
  funModule.init();
  await funModule.onIncomingMessage({
    sock: {},
    chatJid: groupJid,
    actorJid: userA,
    isGroup: true,
    text: '/evento start',
    messageType: 'text',
  });
  assert.ok(
    sent.some(m => /sorteados pelo bot|bot sorteia|ninguém inicia/i.test(m.text)),
    JSON.stringify(sent)
  );
});

test('facade: /roleta e /rankcassino', async () => {
  const groupJid = uniqueGroup();
  const userA = `5511555${String(Date.now()).slice(-6)}09@s.whatsapp.net`;
  const sent = [];
  const funConfig = resolveFunConfig({
    enabled: true,
    requireGroupWhitelist: true,
    groupWhitelistJids: [groupJid],
    replyCommandsInPrivate: false,
    rouletteCooldownMs: 0,
    casinoMin: 5,
    casinoMax: 100,
    jackpotRate: 0.01,
    ollamaEnabled: false,
  });

  const funModule = createFunModule({
    getConfig: () => funConfig,
    getLogger: () => null,
    getDatabase: getDb,
    sendText: async (_s, jid, text) => {
      sent.push({ jid, text });
    },
    getContactDisplayName: () => 'Cass',
  });
  funModule.init();
  funModule._services.repository.addCoins({
    userJid: userA,
    scopeKey: groupJid,
    amount: 100,
    reason: 'seed',
  });

  await funModule.onIncomingMessage({
    sock: {},
    chatJid: groupJid,
    actorJid: userA,
    isGroup: true,
    text: '/roleta 10 vermelho',
    messageType: 'text',
  });
  assert.ok(sent.some(m => /Roleta/i.test(m.text)), JSON.stringify(sent));

  sent.length = 0;
  await funModule.onIncomingMessage({
    sock: {},
    chatJid: groupJid,
    actorJid: userA,
    isGroup: true,
    text: '/rankcassino',
    messageType: 'text',
  });
  assert.ok(
    sent.some(m => /Rank Cassino|cassino|histórico/i.test(m.text)),
    JSON.stringify(sent)
  );
});

test('ACTION_TYPE dice present', () => {
  assert.equal(ACTION_TYPE.BET_DICE, 'bet_dice');
});
