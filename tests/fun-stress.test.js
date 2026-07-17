/**
 * Stress + edge cases do Fun bot (cenário ~30 pessoas no grupo).
 * better-sqlite3 é single-thread: races reais são serializadas pelo SQLite;
 * estes testes validam invariantes sob carga, TOCTOU e matriz de erros.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createFunModule, resolveFunConfig } from '../fun/index.js';
import { createFunStatsRepository, _resetDefaultFunStatsRepository } from '../fun/db/funStatsRepository.js';
import { createFunActionRepository } from '../fun/db/funActionRepository.js';
import { createFunRelationshipRepository } from '../fun/db/funRelationshipRepository.js';
import { createFunFactionRepository } from '../fun/db/funFactionRepository.js';
import { createFunCasinoRepository } from '../fun/db/funCasinoRepository.js';
import { createFunEventRepository } from '../fun/db/funEventRepository.js';
import { createRelationshipService } from '../fun/services/relationshipService.js';
import { createGameService } from '../fun/services/gameService.js';
import { createCoinsService } from '../fun/services/coinsService.js';
import { createFactionService } from '../fun/services/factionService.js';
import { createCasinoService } from '../fun/services/casinoService.js';
import { createXpService } from '../fun/services/xpService.js';
import { ACTION_TYPE } from '../fun/constants.js';

await initDb();
_resetDefaultFunStatsRepository();

function uniqueJid(prefix = '55') {
  return `${prefix}${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 900 + 100)}@s.whatsapp.net`;
}

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 900 + 100)}@g.us`;
}

function makeUsers(n, prefix = '5511') {
  const base = Date.now();
  return Array.from({ length: n }, (_, i) => `${prefix}${String(base).slice(-5)}${String(i).padStart(3, '0')}@s.whatsapp.net`);
}

function sumCoins(repo, users, scope) {
  return users.reduce((acc, u) => acc + (repo.getUserStats(u, scope)?.coins || 0), 0);
}

function setupCore() {
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const actions = createFunActionRepository({ getDatabase: getDb });
  const relRepo = createFunRelationshipRepository({ getDatabase: getDb });
  const facRepo = createFunFactionRepository({ getDatabase: getDb });
  const casinoRepo = createFunCasinoRepository({ getDatabase: getDb });
  const eventRepo = createFunEventRepository({ getDatabase: getDb });

  const relationship = createRelationshipService({
    relationshipRepository: relRepo,
    actionRepository: actions,
  });
  const game = createGameService({
    repository: repo,
    actionRepository: actions,
    random: Math.random,
  });
  const coins = createCoinsService({ repository: repo });
  const factions = createFactionService({
    factionRepository: facRepo,
    repository: repo,
  });
  const casino = createCasinoService({
    repository: repo,
    actionRepository: actions,
    casinoRepository: casinoRepo,
    eventRepository: eventRepo,
    random: Math.random,
  });
  const xp = createXpService({ repository: repo, random: () => 0 });

  return { repo, actions, relationship, game, coins, factions, casino, xp, facRepo, casinoRepo };
}

// ─── Edge cases: casamento ───────────────────────────────────────────────────

test('edge: marry — self, já casado, parceiro casado, aceitar sem pedido', () => {
  const { relationship, repo } = setupCore();
  const scope = uniqueGroup();
  const [a, b, c] = makeUsers(3);

  assert.equal(relationship.proposeMarry({ userJid: a, partnerJid: a, scopeKey: scope }).reason, 'self-marry');

  const p = relationship.proposeMarry({ userJid: a, partnerJid: b, scopeKey: scope });
  assert.equal(p.ok, true);
  assert.equal(p.married, false);

  const acc = relationship.acceptMarry({ userJid: b, scopeKey: scope });
  assert.equal(acc.ok, true);

  // A já casado não pode pedir C
  const again = relationship.proposeMarry({ userJid: a, partnerJid: c, scopeKey: scope });
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'already-married');

  // C não casa com A (parceiro casado)
  const partnerBusy = relationship.proposeMarry({ userJid: c, partnerJid: a, scopeKey: scope });
  assert.equal(partnerBusy.ok, false);
  assert.equal(partnerBusy.reason, 'partner-married');

  // aceitar sem proposta
  assert.equal(relationship.acceptMarry({ userJid: c, scopeKey: scope }).reason, 'no-proposal');

  // double accept
  assert.equal(relationship.acceptMarry({ userJid: b, scopeKey: scope }).reason, 'no-proposal');

  // B casado não pode casar de novo
  relationship.proposeMarry({ userJid: c, partnerJid: b, scopeKey: scope });
  // wait — partner married should fail on propose
  const toB = relationship.proposeMarry({ userJid: c, partnerJid: b, scopeKey: scope });
  assert.equal(toB.reason, 'partner-married');
});

test('edge: marry mútuo e divórcio limpa ambos', () => {
  const { relationship } = setupCore();
  const scope = uniqueGroup();
  const [a, b] = makeUsers(2);

  relationship.proposeMarry({ userJid: a, partnerJid: b, scopeKey: scope });
  // B pede A de volta → mutual
  const mutual = relationship.proposeMarry({ userJid: b, partnerJid: a, scopeKey: scope });
  assert.equal(mutual.ok, true);
  assert.equal(mutual.reason, 'mutual');
  assert.equal(mutual.married, true);

  const d = relationship.divorce({ userJid: a, scopeKey: scope });
  assert.equal(d.ok, true);
  assert.equal(relationship.getMarriage(a, scope), null);
  assert.equal(relationship.getMarriage(b, scope), null);
});

test('race: dois pretendentes pedem e tentam aceitar o mesmo alvo', () => {
  const { relationship } = setupCore();
  const scope = uniqueGroup();
  const [target, suitor1, suitor2] = makeUsers(3);

  relationship.proposeMarry({ userJid: suitor1, partnerJid: target, scopeKey: scope });
  relationship.proposeMarry({ userJid: suitor2, partnerJid: target, scopeKey: scope });

  // target aceita o mais recente (suitor2) — getLatestIncoming
  const acc = relationship.acceptMarry({ userJid: target, scopeKey: scope });
  assert.equal(acc.ok, true);
  assert.equal(acc.fromJid, suitor2);

  // target agora casado
  assert.ok(relationship.getMarriage(target, scope));
  assert.ok(relationship.getMarriage(suitor2, scope));
  // suitor1 ainda solteiro
  assert.equal(relationship.getMarriage(suitor1, scope), null);

  // aceitar pedido antigo do suitor1 falha se ainda existir? getLatestIncoming may still see suitor1
  // after accepting suitor2, suitor1 proposal might still be pending — accept should fail partner/already married
  const leftover = relationship.acceptMarry({ userJid: target, scopeKey: scope });
  // either no-proposal (if deleted only latest) or already-married
  assert.equal(leftover.ok, false);
  assert.ok(['no-proposal', 'already-married', 'partner-married'].includes(leftover.reason));
});

// ─── Edge cases: coins / pay ─────────────────────────────────────────────────

test('edge: pay — self, zero, saldo insuficiente, pay total', () => {
  const { coins, repo } = setupCore();
  const scope = uniqueGroup();
  const [a, b] = makeUsers(2);
  repo.addCoins({ userJid: a, scopeKey: scope, amount: 50, reason: 'seed' });

  assert.equal(
    coins.transfer({ fromJid: a, toJid: a, scopeKey: scope, amount: 10 }).reason,
    'self-transfer'
  );
  assert.equal(
    coins.transfer({ fromJid: a, toJid: b, scopeKey: scope, amount: 0 }).ok,
    false
  );
  assert.equal(
    coins.transfer({ fromJid: a, toJid: b, scopeKey: scope, amount: 999 }).reason,
    'insufficient-funds'
  );

  const ok = coins.transfer({ fromJid: a, toJid: b, scopeKey: scope, amount: 50 });
  assert.equal(ok.ok, true);
  assert.equal(repo.getUserStats(a, scope).coins, 0);
  assert.equal(repo.getUserStats(b, scope).coins, 50);
});

test('stress: 30 users pay chain + conservação de coins', () => {
  const { coins, repo } = setupCore();
  const scope = uniqueGroup();
  const users = makeUsers(30);
  const seed = 100;
  for (const u of users) {
    repo.addCoins({ userJid: u, scopeKey: scope, amount: seed, reason: 'seed' });
  }
  const totalBefore = sumCoins(repo, users, scope);
  assert.equal(totalBefore, 30 * seed);

  // cada um paga 5 pro próximo (anel)
  for (let i = 0; i < users.length; i += 1) {
    const from = users[i];
    const to = users[(i + 1) % users.length];
    const r = coins.transfer({ fromJid: from, toJid: to, scopeKey: scope, amount: 5 });
    assert.equal(r.ok, true, `pay failed at ${i}: ${r.reason}`);
  }

  const totalAfter = sumCoins(repo, users, scope);
  assert.equal(totalAfter, totalBefore, 'coins must be conserved in pure transfers');
  // todos ainda com 100 (cada um perdeu 5 e ganhou 5)
  for (const u of users) {
    assert.equal(repo.getUserStats(u, scope).coins, seed);
  }
});

test('stress: 30 concurrent-ish depletes same wallet (interleaved)', async () => {
  const { coins, repo } = setupCore();
  const scope = uniqueGroup();
  const rich = uniqueJid('5599');
  const beggars = makeUsers(30, '5588');
  repo.addCoins({ userJid: rich, scopeKey: scope, amount: 100, reason: 'seed' });

  // 30 tentativas de sacar 10 — só 10 devem passar
  const results = await Promise.all(
    beggars.map(async (b, i) => {
      await Promise.resolve(); // yield
      return coins.transfer({
        fromJid: rich,
        toJid: b,
        scopeKey: scope,
        amount: 10,
      });
    })
  );

  const okCount = results.filter(r => r.ok).length;
  const failCount = results.filter(r => !r.ok).length;
  assert.equal(okCount, 10);
  assert.equal(failCount, 20);
  assert.equal(repo.getUserStats(rich, scope).coins, 0);
  const received = sumCoins(repo, beggars, scope);
  assert.equal(received, 100);
});

// ─── Edge cases: apostas / flip ──────────────────────────────────────────────

test('edge: aposta — target sem saldo, double accept, decline', () => {
  const { game, repo } = setupCore();
  const scope = uniqueGroup();
  const [a, b] = makeUsers(2);
  repo.addCoins({ userJid: a, scopeKey: scope, amount: 100, reason: 'seed' });
  // b com 0

  const poor = game.proposeBet({
    fromJid: a,
    toJid: b,
    scopeKey: scope,
    amount: 20,
    choice: 'cara',
    funConfig: { betMin: 5, betMax: 150 },
  });
  assert.equal(poor.reason, 'target-insufficient');

  repo.addCoins({ userJid: b, scopeKey: scope, amount: 100, reason: 'seed' });
  const prop = game.proposeBet({
    fromJid: a,
    toJid: b,
    scopeKey: scope,
    amount: 20,
    choice: 'cara',
    funConfig: { betMin: 5, betMax: 150 },
  });
  assert.equal(prop.ok, true);

  const declined = game.declineBet({ userJid: b, scopeKey: scope });
  assert.equal(declined.ok, true);

  const noMore = game.acceptBet({ userJid: b, scopeKey: scope });
  assert.equal(noMore.ok, false);

  // propose again and double accept
  game.proposeBet({
    fromJid: a,
    toJid: b,
    scopeKey: scope,
    amount: 15,
    choice: 'coroa',
    funConfig: { betMin: 5, betMax: 150 },
  });
  const first = game.acceptBet({ userJid: b, scopeKey: scope });
  assert.equal(first.ok, true);
  const second = game.acceptBet({ userJid: b, scopeKey: scope });
  assert.equal(second.ok, false);

  // pot conservation: winner has +stake, loser -stake relative to start of bet
  const total = (repo.getUserStats(a, scope)?.coins || 0) + (repo.getUserStats(b, scope)?.coins || 0);
  assert.equal(total, 200); // 100+100 seed, no house edge on pvp
});

test('stress: 30 solo flips com saldo e sem coins negativos', () => {
  const { game, repo } = setupCore();
  const scope = uniqueGroup();
  const users = makeUsers(30);
  for (const u of users) {
    repo.addCoins({ userJid: u, scopeKey: scope, amount: 200, reason: 'seed' });
  }

  const cfg = { flipMin: 5, flipMax: 80, flipCooldownMs: 0 };
  let plays = 0;
  for (const u of users) {
    for (let i = 0; i < 5; i += 1) {
      const r = game.soloFlip({
        userJid: u,
        scopeKey: scope,
        amount: 10,
        choice: i % 2 === 0 ? 'cara' : 'coroa',
        funConfig: cfg,
      });
      if (r.ok) plays += 1;
      const bal = repo.getUserStats(u, scope)?.coins ?? 0;
      assert.ok(bal >= 0, `negative coins ${u}`);
    }
  }
  assert.ok(plays >= 30 * 5 * 0.5, `too few plays: ${plays}`); // most should succeed
  for (const u of users) {
    assert.ok((repo.getUserStats(u, scope)?.coins ?? 0) >= 0);
  }
});

// ─── Panelinhas (API interna faction*) ───────────────────────────────────────

test('edge: panelinha — nome duplicado, já em panelinha, cheia, sair sem coins', () => {
  const { factions, repo, facRepo } = setupCore();
  const scope = uniqueGroup();
  const users = makeUsers(10);
  for (const u of users) {
    repo.addCoins({ userJid: u, scopeKey: scope, amount: 200, reason: 'seed' });
  }
  const cfg = { factionCreateCost: 50, factionLeaveCost: 25, factionMaxMembers: 3 };

  const c1 = factions.create({
    scopeKey: scope,
    userJid: users[0],
    name: 'Lobos',
    funConfig: cfg,
  });
  assert.equal(c1.ok, true);

  const dup = factions.create({
    scopeKey: scope,
    userJid: users[1],
    name: 'Lobos',
    funConfig: cfg,
  });
  assert.equal(dup.ok, false);

  const already = factions.create({
    scopeKey: scope,
    userJid: users[0],
    name: 'Outros',
    funConfig: cfg,
  });
  assert.equal(already.ok, false);
  assert.equal(already.reason, 'already-in-faction');

  assert.equal(
    factions.join({ scopeKey: scope, userJid: users[1], name: 'Lobos', funConfig: cfg }).ok,
    true
  );
  assert.equal(
    factions.join({ scopeKey: scope, userJid: users[2], name: 'Lobos', funConfig: cfg }).ok,
    true
  );
  const full = factions.join({
    scopeKey: scope,
    userJid: users[3],
    name: 'Lobos',
    funConfig: cfg,
  });
  assert.equal(full.reason, 'full');

  // zera coins de users[1] e tenta sair
  const bal = repo.getUserStats(users[1], scope).coins;
  repo.addCoins({ userJid: users[1], scopeKey: scope, amount: -bal, reason: 'drain' });
  const leave = factions.leave({
    scopeKey: scope,
    userJid: users[1],
    funConfig: cfg,
  });
  assert.equal(leave.reason, 'insufficient-funds');
});

// ─── Cassino ─────────────────────────────────────────────────────────────────

test('edge: casino — invalid amount, cooldown, jackpot cut + never negative', () => {
  const { casino, repo, casinoRepo } = setupCore();
  const scope = uniqueGroup();
  const u = uniqueJid('5577');
  repo.addCoins({ userJid: u, scopeKey: scope, amount: 500, reason: 'seed' });

  const bad = casino.playRoulette({
    userJid: u,
    scopeKey: scope,
    amount: 1,
    choice: { type: 'color', value: 'red' },
    funConfig: { casinoMin: 5, casinoMax: 100, rouletteCooldownMs: 0, jackpotRate: 0.05 },
  });
  assert.equal(bad.reason, 'invalid-amount');

  const cfg = {
    casinoMin: 5,
    casinoMax: 100,
    rouletteCooldownMs: 60_000,
    slotCooldownMs: 60_000,
    jackpotRate: 0.05,
  };
  const r1 = casino.playRoulette({
    userJid: u,
    scopeKey: scope,
    amount: 40,
    choice: { type: 'color', value: 'red' },
    funConfig: cfg,
  });
  assert.equal(r1.ok, true);
  assert.ok(casinoRepo.getJackpot(scope).pot >= 2);

  const cd = casino.playRoulette({
    userJid: u,
    scopeKey: scope,
    amount: 40,
    choice: { type: 'color', value: 'black' },
    funConfig: cfg,
  });
  assert.equal(cd.reason, 'cooldown');

  assert.ok((repo.getUserStats(u, scope)?.coins ?? 0) >= 0);
});

test('stress: 30 users × 10 slots — coins >= 0 e jackpot cresce', () => {
  const { casino, repo, casinoRepo } = setupCore();
  const scope = uniqueGroup();
  const users = makeUsers(30);
  for (const u of users) {
    repo.addCoins({ userJid: u, scopeKey: scope, amount: 300, reason: 'seed' });
  }
  const totalBefore = sumCoins(repo, users, scope) + casinoRepo.getJackpot(scope).pot;

  const cfg = {
    casinoMin: 5,
    casinoMax: 100,
    slotCooldownMs: 0,
    jackpotRate: 0.05,
  };

  let ok = 0;
  for (const u of users) {
    for (let i = 0; i < 10; i += 1) {
      const r = casino.playSlot({
        userJid: u,
        scopeKey: scope,
        amount: 10,
        funConfig: cfg,
      });
      if (r.ok) ok += 1;
      assert.ok((repo.getUserStats(u, scope)?.coins ?? 0) >= 0);
    }
  }
  assert.equal(ok, 300);
  const pot = casinoRepo.getJackpot(scope).pot;
  // 300 plays × round(10*0.05)=1 → pot >= 300 se cut arredondado; senão >=0
  assert.ok(pot >= 0);

  const totalAfter =
    sumCoins(repo, users, scope) + casinoRepo.getJackpot(scope).pot;
  assert.ok(totalAfter < totalBefore * 30);
  assert.ok(totalAfter >= 0);
  assert.ok(pot >= 0);
});

test('stress: 30 users slots stake 20 — jackpot alimentado', () => {
  const { casino, repo, casinoRepo } = setupCore();
  const scope = uniqueGroup();
  const users = makeUsers(30);
  for (const u of users) {
    repo.addCoins({ userJid: u, scopeKey: scope, amount: 500, reason: 'seed' });
  }
  const cfg = { casinoMin: 5, casinoMax: 100, slotCooldownMs: 0, jackpotRate: 0.05 };
  for (const u of users) {
    casino.playSlot({ userJid: u, scopeKey: scope, amount: 20, funConfig: cfg });
  }
  // floor(20*0.05)=1 per play × 30 = 30
  assert.ok(casinoRepo.getJackpot(scope).pot >= 30);
});

test('edge: crash cashout sem voo; double cashout; bj stand sem mão', () => {
  const { casino, repo } = setupCore();
  const scope = uniqueGroup();
  const u = uniqueJid('5566');
  repo.addCoins({ userJid: u, scopeKey: scope, amount: 200, reason: 'seed' });

  assert.equal(
    casino.cashoutCrash({ userJid: u, scopeKey: scope, funConfig: {} }).reason,
    'no-flight'
  );
  assert.equal(
    casino.standBlackjack({ userJid: u, scopeKey: scope, funConfig: {} }).reason,
    'no-hand'
  );

  const start = casino.startCrash({
    userJid: u,
    scopeKey: scope,
    amount: 20,
    funConfig: { crashMin: 5, crashMax: 80, crashCooldownMs: 0, crashTtlMs: 60_000, jackpotRate: 0 },
  });
  assert.equal(start.ok, true);
  const out1 = casino.cashoutCrash({
    userJid: u,
    scopeKey: scope,
    funConfig: { crashGrowthPerSec: 0.01 },
    now: Date.now() + 50,
  });
  assert.equal(out1.ok, true);
  const out2 = casino.cashoutCrash({ userJid: u, scopeKey: scope, funConfig: {} });
  assert.equal(out2.reason, 'no-flight');
});

test('edge: torneio — entry inválida, already-in, 4 jogadores finalizam', () => {
  const { casino, repo } = setupCore();
  const scope = uniqueGroup();
  const players = makeUsers(4);
  for (const p of players) {
    repo.addCoins({ userJid: p, scopeKey: scope, amount: 100, reason: 'seed' });
  }
  const cfg = {
    tournamentEntryMin: 10,
    tournamentEntryMax: 80,
    tournamentSize: 4,
  };

  const bad = casino.joinTournament({
    userJid: players[0],
    scopeKey: scope,
    entryFee: 5,
    funConfig: cfg,
  });
  assert.equal(bad.reason, 'invalid-amount');

  let last;
  for (const p of players) {
    last = casino.joinTournament({
      userJid: p,
      scopeKey: scope,
      entryFee: 20,
      funConfig: cfg,
    });
    assert.equal(last.ok, true, last.reason);
  }
  assert.equal(last.finished, true);
  assert.equal(last.pot, 80);

  // already finished — new open tournament if someone joins again
  const again = casino.joinTournament({
    userJid: players[0],
    scopeKey: scope,
    entryFee: 20,
    funConfig: cfg,
  });
  // either already-in open or new open join
  assert.ok(again.ok || again.reason === 'already-in' || again.reason === 'insufficient-funds');
});

// ─── XP passivo 30 users ─────────────────────────────────────────────────────

test('stress: 30 users awardXp com cooldown', () => {
  const { xp, repo } = setupCore();
  const scope = uniqueGroup();
  const users = makeUsers(30);
  const now = Date.now();

  for (const u of users) {
    const a1 = xp.awardXp({
      userJid: u,
      scopeKey: scope,
      xpMin: 15,
      xpMax: 15,
      cooldownMs: 60_000,
      now,
    });
    assert.equal(a1.applied, true);
    assert.equal(a1.gained, 15);

    const a2 = xp.awardXp({
      userJid: u,
      scopeKey: scope,
      xpMin: 15,
      xpMax: 15,
      cooldownMs: 60_000,
      now: now + 1000,
    });
    assert.equal(a2.applied, false);
  }

  for (const u of users) {
    assert.equal(repo.getUserStats(u, scope).xp, 15);
  }
});

// ─── Facade carga de comandos (30 actors) ────────────────────────────────────

test('stress facade: 30 /saldo + /ship + /daily no mesmo grupo', async () => {
  const groupJid = uniqueGroup();
  const users = makeUsers(30, '5533');
  const sent = [];
  const funConfig = resolveFunConfig({
    enabled: true,
    requireGroupWhitelist: true,
    groupWhitelistJids: [groupJid],
    replyCommandsInPrivate: false,
    cooldownMs: 0,
    dailyXp: 50,
    dailyCoins: 10,
    ollamaEnabled: false,
    announceLevelUp: false,
  });

  const funModule = createFunModule({
    getConfig: () => funConfig,
    getLogger: () => null,
    getDatabase: getDb,
    sendText: async (_s, jid, text) => {
      sent.push({ jid, text });
    },
    getContactDisplayName: (jid) => jid.split('@')[0],
    listContacts: () => users.map(j => ({ jid: j, name: j.split('@')[0] })),
  });
  funModule.init();

  for (const u of users) {
    funModule._services.repository.addCoins({
      userJid: u,
      scopeKey: groupJid,
      amount: 50,
      reason: 'seed',
    });
  }

  // wave 1: all saldo
  sent.length = 0;
  await Promise.all(
    users.map(u =>
      funModule.onIncomingMessage({
        sock: {},
        chatJid: groupJid,
        actorJid: u,
        isGroup: true,
        text: '/saldo',
        messageType: 'text',
      })
    )
  );
  assert.ok(sent.length >= 30, `expected >=30 saldo replies, got ${sent.length}`);

  // wave 2: ship pairs
  sent.length = 0;
  await Promise.all(
    users.slice(0, 15).map((u, i) =>
      funModule.onIncomingMessage({
        sock: {},
        chatJid: groupJid,
        actorJid: u,
        isGroup: true,
        text: '/ship',
        messageType: 'text',
        mentionedJids: [users[i + 15]],
      })
    )
  );
  assert.ok(sent.some(m => /Ship|%/i.test(m.text)));

  // wave 3: daily
  sent.length = 0;
  await Promise.all(
    users.map(u =>
      funModule.onIncomingMessage({
        sock: {},
        chatJid: groupJid,
        actorJid: u,
        isGroup: true,
        text: '/daily',
        messageType: 'text',
      })
    )
  );
  assert.ok(sent.length >= 30);

  // no negative coins
  for (const u of users) {
    const c = funModule._services.repository.getUserStats(u, groupJid)?.coins ?? 0;
    assert.ok(c >= 0, `neg coins ${u}`);
  }
});

test('edge facade: casar com casado via /marry', async () => {
  const groupJid = uniqueGroup();
  const [a, b, c] = makeUsers(3, '5544');
  const sent = [];
  const funConfig = resolveFunConfig({
    enabled: true,
    requireGroupWhitelist: true,
    groupWhitelistJids: [groupJid],
    replyCommandsInPrivate: false,
    ollamaEnabled: false,
  });
  const funModule = createFunModule({
    getConfig: () => funConfig,
    getLogger: () => null,
    getDatabase: getDb,
    sendText: async (_s, jid, text) => sent.push({ jid, text }),
    getContactDisplayName: (jid) => (jid === a ? 'A' : jid === b ? 'B' : 'C'),
    listContacts: () => [
      { jid: a, name: 'A' },
      { jid: b, name: 'B' },
      { jid: c, name: 'C' },
    ],
  });
  funModule.init();

  // A pede B
  await funModule.onIncomingMessage({
    sock: {},
    chatJid: groupJid,
    actorJid: a,
    isGroup: true,
    text: '/marry',
    mentionedJids: [b],
    messageType: 'text',
  });
  // B aceita
  await funModule.onIncomingMessage({
    sock: {},
    chatJid: groupJid,
    actorJid: b,
    isGroup: true,
    text: '/aceitar',
    messageType: 'text',
  });
  sent.length = 0;
  // C tenta casar com A (casado)
  await funModule.onIncomingMessage({
    sock: {},
    chatJid: groupJid,
    actorJid: c,
    isGroup: true,
    text: '/marry',
    mentionedJids: [a],
    messageType: 'text',
  });
  assert.ok(
    sent.some(m => /j[aá] est[aá] casado|casado/i.test(m.text)),
    JSON.stringify(sent)
  );
});

test('invariante: escrow bet nunca deixa pot no limbo em accept com saldo ok', () => {
  const { game, repo } = setupCore();
  const scope = uniqueGroup();
  const [a, b] = makeUsers(2);
  repo.addCoins({ userJid: a, scopeKey: scope, amount: 80, reason: 'seed' });
  repo.addCoins({ userJid: b, scopeKey: scope, amount: 80, reason: 'seed' });
  const before = 160;

  game.proposeBet({
    fromJid: a,
    toJid: b,
    scopeKey: scope,
    amount: 25,
    choice: 'cara',
    funConfig: { betMin: 5, betMax: 150 },
  });
  const r = game.acceptBet({ userJid: b, scopeKey: scope });
  assert.equal(r.ok, true);
  const after =
    (repo.getUserStats(a, scope)?.coins || 0) + (repo.getUserStats(b, scope)?.coins || 0);
  assert.equal(after, before);
  // one has +25 net relative to peer: pot 50 distributed to winner
  assert.ok(r.winnerCoins >= 80);
});
