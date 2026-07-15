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
import {
  makeBingoCard,
  evaluateBingoCard,
  resolveBingoRound,
  soloBingoPayout,
  formatBingoCard,
  pickDistinct,
  normalizeBingoMode,
  snapshotBingoPlayers,
} from '../fun/services/bingoLogic.js';
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
  assert.equal(parseFunCommand('/bingo 15', '/').command, FUN_COMMANDS.BINGO);
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

test('bingoLogic: cartela, linha, full, pot e solo payout', () => {
  const card = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const row = evaluateBingoCard(card, [1, 2, 3]);
  assert.equal(row.hasLine, true);
  assert.equal(row.full, false);
  assert.ok(row.lines.includes('r0'));

  const full = evaluateBingoCard(card, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(full.full, true);
  assert.equal(full.hasLine, true);

  const diag = evaluateBingoCard(card, [1, 5, 9]);
  assert.ok(diag.lines.includes('d0'));

  const text = formatBingoCard(card, [1, 5]);
  assert.match(text, /✅/);
  assert.equal(text.split('\n').length, 3);

  const pot = resolveBingoRound(
    [
      { jid: 'a@s.whatsapp.net', card: [1, 2, 3, 10, 11, 12, 13, 14, 15] },
      { jid: 'b@s.whatsapp.net', card: [20, 21, 22, 23, 24, 25, 26, 27, 28] },
    ],
    [1, 2, 3],
    100,
    { houseEdge: 0.05 }
  );
  assert.equal(pot.refund, false);
  assert.equal(pot.tier, 'line');
  assert.equal(pot.winners.length, 1);
  assert.equal(pot.winners[0].jid, 'a@s.whatsapp.net');
  assert.equal(pot.netPot, 95);
  assert.equal(pot.winners[0].payout, 95);

  const none = resolveBingoRound(
    [{ jid: 'a@s.whatsapp.net', card: [1, 2, 3, 4, 5, 6, 7, 8, 9] }],
    [30, 29, 28],
    40,
    { houseEdge: 0 }
  );
  assert.equal(none.refund, true);
  assert.equal(none.tier, 'none');

  assert.equal(soloBingoPayout({ full: true, hasLine: true }, 10, { fullMult: 8 }), 80);
  assert.equal(soloBingoPayout({ full: false, hasLine: true }, 10, { lineMult: 2.5 }), 25);
  assert.equal(soloBingoPayout({ full: false, hasLine: false }, 10), 0);

  // pickDistinct determinístico com random fixo
  let i = 0;
  const seq = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const nums = pickDistinct(5, 30, () => seq[Math.min(i++, seq.length - 1)] || 0);
  assert.equal(nums.length, 5);
  assert.equal(new Set(nums).size, 5);
  assert.ok(nums.every((n) => n >= 1 && n <= 30));

  const card2 = makeBingoCard(() => 0.5, { poolMax: 30 });
  assert.equal(card2.length, 9);
  assert.equal(new Set(card2).size, 9);

  assert.equal(normalizeBingoMode('classico'), 'classic');
  assert.equal(normalizeBingoMode('rapido'), 'fast');
  assert.equal(normalizeBingoMode(''), 'fast');

  const snap = snapshotBingoPlayers(
    [{ jid: 'x@s.whatsapp.net', card: [1, 2, 3, 4, 5, 6, 7, 8, 9] }],
    [1, 2, 3]
  );
  assert.equal(snap[0].hasLine, true);
  assert.equal(snap[0].markedCount, 3);
});

test('bingo multiplayer: join, cartela, start com linha e reembolso se vazio', () => {
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const actionRepo = createFunActionRepository({ getDatabase: getDb });
  const casinoRepo = createFunCasinoRepository({ getDatabase: getDb });

  // random: cartelas previsíveis + draw
  // makeBingoCard usa pickDistinct(9,30) — com random=0 sempre pega 1..9 na ordem do swap
  // pickDistinct com random 0: j=i+0 => identidade → card = [1..9]
  // segundo jogador mesmo random 0 → same card — ok for refund/line tests we control draw

  const casino = createCasinoService({
    repository: repo,
    actionRepository: actionRepo,
    casinoRepository: casinoRepo,
    random: () => 0,
  });

  const scope = uniqueGroup();
  const a = uniqueJid('5521');
  const b = uniqueJid('5522');
  repo.addCoins({ userJid: a, scopeKey: scope, amount: 200, reason: 'seed' });
  repo.addCoins({ userJid: b, scopeKey: scope, amount: 200, reason: 'seed' });

  const cfg = resolveFunConfig({
    bingoMin: 5,
    bingoMax: 100,
    bingoSize: 4,
    bingoMinPlayers: 2,
    bingoDrawCount: 12,
    bingoPoolMax: 30,
    bingoHouseEdge: 0,
    bingoCooldownMs: 0,
  });

  const j1 = casino.joinBingo({
    userJid: a,
    scopeKey: scope,
    entryFee: 20,
    funConfig: cfg,
  });
  assert.equal(j1.ok, true);
  assert.equal(j1.finished, false);
  assert.equal(j1.fee, 20);
  assert.equal(j1.myCard.length, 9);
  assert.equal(repo.getUserStats(a, scope).coins, 180);

  const mine = casino.bingoMyCard({ userJid: a, scopeKey: scope });
  assert.equal(mine.ok, true);
  assert.equal(mine.card.length, 9);

  const j2 = casino.joinBingo({
    userJid: b,
    scopeKey: scope,
    entryFee: 0,
    funConfig: cfg,
  });
  assert.equal(j2.ok, true);
  assert.equal(j2.finished, false);
  assert.equal(j2.room.pot, 40);
  assert.equal(j2.room.players.length, 2);

  // start com 2 — random 0: drawn = primeiros 12 de 1..30 = 1..12
  // cartelas 1..9 → full card for both
  const started = casino.startBingo({ userJid: a, scopeKey: scope, funConfig: cfg });
  assert.equal(started.ok, true);
  assert.equal(started.finished, true);
  assert.equal(started.refund, false);
  assert.equal(started.tier, 'full');
  assert.equal(started.winners.length, 2);
  assert.equal(started.pot, 40);
  // split 20 each (house edge 0)
  assert.equal(started.winners[0].payout + started.winners[1].payout, 40);
  assert.equal(casino.bingoStatus(scope), null);

  // leave + refund path: nova sala
  const c = uniqueJid('5523');
  repo.addCoins({ userJid: c, scopeKey: scope, amount: 100, reason: 'seed' });
  const j3 = casino.joinBingo({
    userJid: c,
    scopeKey: scope,
    entryFee: 10,
    funConfig: cfg,
  });
  assert.equal(j3.ok, true);
  const left = casino.leaveBingo({ userJid: c, scopeKey: scope });
  assert.equal(left.ok, true);
  assert.equal(left.closed, true);
  assert.equal(repo.getUserStats(c, scope).coins, 100);
});

test('bingo multiplayer: auto-start no tamanho da sala', () => {
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const actionRepo = createFunActionRepository({ getDatabase: getDb });
  const casinoRepo = createFunCasinoRepository({ getDatabase: getDb });
  const casino = createCasinoService({
    repository: repo,
    actionRepository: actionRepo,
    casinoRepository: casinoRepo,
    random: () => 0,
  });

  const scope = uniqueGroup();
  const players = [uniqueJid('5531'), uniqueJid('5532'), uniqueJid('5533')];
  for (const p of players) {
    repo.addCoins({ userJid: p, scopeKey: scope, amount: 100, reason: 'seed' });
  }

  const cfg = resolveFunConfig({
    bingoMin: 5,
    bingoMax: 50,
    bingoSize: 3,
    bingoMinPlayers: 2,
    bingoHouseEdge: 0.05,
    bingoDrawCount: 12,
    bingoCooldownMs: 0,
  });

  let last;
  for (const p of players) {
    last = casino.joinBingo({
      userJid: p,
      scopeKey: scope,
      entryFee: 10,
      funConfig: cfg,
    });
    assert.equal(last.ok, true);
  }
  assert.equal(last.finished, true);
  assert.equal(last.autoStarted, true);
  assert.equal(last.pot, 30);
  assert.equal(casino.bingoStatus(scope), null);
});

test('bingo solo: aposta, cooldown e bloqueio com sala aberta', () => {
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const actionRepo = createFunActionRepository({ getDatabase: getDb });
  const casinoRepo = createFunCasinoRepository({ getDatabase: getDb });
  const casino = createCasinoService({
    repository: repo,
    actionRepository: actionRepo,
    casinoRepository: casinoRepo,
    random: () => 0,
  });

  const scope = uniqueGroup();
  const u = uniqueJid('5541');
  const other = uniqueJid('5542');
  repo.addCoins({ userJid: u, scopeKey: scope, amount: 200, reason: 'seed' });
  repo.addCoins({ userJid: other, scopeKey: scope, amount: 200, reason: 'seed' });

  const cfg = resolveFunConfig({
    bingoMin: 5,
    bingoMax: 100,
    bingoCooldownMs: 60_000,
    bingoSoloFullMult: 8,
    bingoSoloLineMult: 2.5,
    bingoDrawCount: 12,
    bingoPoolMax: 30,
    jackpotRate: 0,
  });

  // random 0 → card 1..9, drawn 1..12 → full → 8x
  const solo = casino.playBingoSolo({
    userJid: u,
    scopeKey: scope,
    amount: 10,
    funConfig: cfg,
  });
  assert.equal(solo.ok, true);
  assert.equal(solo.solo, true);
  assert.equal(solo.full, true);
  assert.equal(solo.payout, 80);
  assert.equal(solo.profit, 70);
  assert.equal(repo.getUserStats(u, scope).coins, 270);

  const cd = casino.playBingoSolo({
    userJid: u,
    scopeKey: scope,
    amount: 10,
    funConfig: cfg,
  });
  assert.equal(cd.ok, false);
  assert.equal(cd.reason, 'cooldown');

  // sala aberta bloqueia solo
  const cfgNoCd = resolveFunConfig({ ...cfg, bingoCooldownMs: 0 });
  casino.joinBingo({
    userJid: other,
    scopeKey: scope,
    entryFee: 15,
    funConfig: cfgNoCd,
  });
  const blocked = casino.playBingoSolo({
    userJid: u,
    scopeKey: scope,
    amount: 10,
    funConfig: cfgNoCd,
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'room-open');
});

test('bingo: lobby expirado devolve entrada', () => {
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const actionRepo = createFunActionRepository({ getDatabase: getDb });
  const casinoRepo = createFunCasinoRepository({ getDatabase: getDb });
  const casino = createCasinoService({
    repository: repo,
    actionRepository: actionRepo,
    casinoRepository: casinoRepo,
    random: () => 0,
  });

  const scope = uniqueGroup();
  const u = uniqueJid('5551');
  repo.addCoins({ userJid: u, scopeKey: scope, amount: 50, reason: 'seed' });

  const t0 = Date.now();
  const joined = casino.joinBingo({
    userJid: u,
    scopeKey: scope,
    entryFee: 25,
    funConfig: resolveFunConfig({
      bingoMin: 5,
      bingoMax: 100,
      bingoLobbyTtlMs: 60_000,
      bingoSize: 4,
    }),
    now: t0,
  });
  assert.equal(joined.ok, true);
  assert.equal(repo.getUserStats(u, scope).coins, 25);

  const after = casino.bingoStatus(scope, t0 + 120_000);
  assert.equal(after, null);
  assert.equal(repo.getUserStats(u, scope).coins, 50);
});

test('bingo clássico: bolas 1 a 1, marcação auto, settle no fim', () => {
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const actionRepo = createFunActionRepository({ getDatabase: getDb });
  const casinoRepo = createFunCasinoRepository({ getDatabase: getDb });
  const casino = createCasinoService({
    repository: repo,
    actionRepository: actionRepo,
    casinoRepository: casinoRepo,
    random: () => 0,
  });

  const scope = uniqueGroup();
  const a = uniqueJid('5571');
  const b = uniqueJid('5572');
  repo.addCoins({ userJid: a, scopeKey: scope, amount: 100, reason: 'seed' });
  repo.addCoins({ userJid: b, scopeKey: scope, amount: 100, reason: 'seed' });

  const cfg = resolveFunConfig({
    bingoMin: 5,
    bingoMax: 100,
    bingoSize: 4,
    bingoMinPlayers: 2,
    bingoDrawCount: 12,
    bingoPoolMax: 30,
    bingoHouseEdge: 0,
    bingoClassicIntervalMs: 0,
    bingoClassicEarlyEndOnFull: true,
    bingoCooldownMs: 0,
  });

  const j1 = casino.joinBingo({
    userJid: a,
    scopeKey: scope,
    entryFee: 10,
    mode: 'classic',
    funConfig: cfg,
  });
  assert.equal(j1.ok, true);
  assert.equal(j1.room.mode, 'classic');

  const j2 = casino.joinBingo({
    userJid: b,
    scopeKey: scope,
    entryFee: 0,
    funConfig: cfg,
  });
  assert.equal(j2.ok, true);
  assert.equal(j2.room.mode, 'classic');

  const start = casino.startBingo({ userJid: a, scopeKey: scope, funConfig: cfg });
  assert.equal(start.ok, true);
  assert.equal(start.classic, true);
  assert.equal(start.finished, false);
  assert.equal(start.totalBalls, 12);

  // mid-game: não sai, não entra solo
  const leaveBlocked = casino.leaveBingo({ userJid: a, scopeKey: scope });
  assert.equal(leaveBlocked.ok, false);
  assert.equal(leaveBlocked.reason, 'game-running');

  let final = null;
  for (let i = 0; i < 20; i += 1) {
    const step = casino.classicBingoTick({ scopeKey: scope, funConfig: cfg });
    assert.equal(step.ok, true);
    if (step.step) {
      assert.ok(step.number >= 1 && step.number <= 30);
      assert.ok(step.index >= 1);
    }
    if (step.finished) {
      final = step;
      break;
    }
  }
  assert.ok(final);
  assert.equal(final.finished, true);
  assert.equal(final.classic, true);
  // cartelas 1..9 + bolas 1..12 + early full → full winners
  assert.equal(final.refund, false);
  assert.equal(final.tier, 'full');
  assert.ok(final.winners.length >= 1);
  assert.equal(casino.bingoStatus(scope), null);
});

test('bingo: parse modos e join rapido default', () => {
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const actionRepo = createFunActionRepository({ getDatabase: getDb });
  const casinoRepo = createFunCasinoRepository({ getDatabase: getDb });
  const casino = createCasinoService({
    repository: repo,
    actionRepository: actionRepo,
    casinoRepository: casinoRepo,
    random: () => 0,
  });
  const scope = uniqueGroup();
  const u = uniqueJid('5581');
  repo.addCoins({ userJid: u, scopeKey: scope, amount: 50, reason: 'seed' });

  const j = casino.joinBingo({
    userJid: u,
    scopeKey: scope,
    entryFee: 10,
    funConfig: resolveFunConfig({ bingoDefaultMode: 'fast', bingoMin: 5, bingoMax: 100 }),
  });
  assert.equal(j.ok, true);
  assert.equal(j.room.mode, 'fast');
});

test('facade: /bingo solo e /bingo sala', async () => {
  const groupJid = uniqueGroup();
  const userA = uniqueJid('5561');
  const userB = uniqueJid('5562');
  const sent = [];
  const funConfig = resolveFunConfig({
    enabled: true,
    requireGroupWhitelist: true,
    groupWhitelistJids: [groupJid],
    replyCommandsInPrivate: false,
    bingoMin: 5,
    bingoMax: 100,
    bingoCooldownMs: 0,
    bingoSize: 4,
    bingoMinPlayers: 2,
    bingoHouseEdge: 0,
    jackpotRate: 0,
    ollamaEnabled: false,
  });

  const funModule = createFunModule({
    getConfig: () => funConfig,
    getLogger: () => null,
    getDatabase: getDb,
    sendText: async (_s, jid, text) => {
      sent.push({ jid, text });
    },
    getContactDisplayName: (jid) => String(jid).slice(0, 8),
  });
  funModule.init();
  for (const u of [userA, userB]) {
    funModule._services.repository.addCoins({
      userJid: u,
      scopeKey: groupJid,
      amount: 100,
      reason: 'seed',
    });
  }

  await funModule.onIncomingMessage({
    sock: {},
    chatJid: groupJid,
    actorJid: userA,
    isGroup: true,
    text: '/bingo solo 10',
    messageType: 'text',
  });
  assert.ok(sent.some((m) => /Bingo solo/i.test(m.text)), JSON.stringify(sent));

  sent.length = 0;
  await funModule.onIncomingMessage({
    sock: {},
    chatJid: groupJid,
    actorJid: userA,
    isGroup: true,
    text: '/bingo 10',
    messageType: 'text',
  });
  assert.ok(sent.some((m) => /Entrou no bingo|Bingo/i.test(m.text)), JSON.stringify(sent));

  sent.length = 0;
  await funModule.onIncomingMessage({
    sock: {},
    chatJid: groupJid,
    actorJid: userB,
    isGroup: true,
    text: '/bingo',
    messageType: 'text',
  });
  assert.ok(sent.some((m) => /Entrou no bingo/i.test(m.text)), JSON.stringify(sent));

  sent.length = 0;
  await funModule.onIncomingMessage({
    sock: {},
    chatJid: groupJid,
    actorJid: userA,
    isGroup: true,
    text: '/bingo start',
    messageType: 'text',
  });
  assert.ok(sent.some((m) => /Bingo!|sorteados|devolvida|Linha|cheia/i.test(m.text)), JSON.stringify(sent));
});

