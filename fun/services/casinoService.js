/**
 * Cassino Fun — roleta, slot, jackpot, duelo de dados, crash, blackjack, torneio, bingo.
 * RNG no servidor; nunca depende de LLM.
 */

import {
  ACTION_TYPE,
  BET_TTL_MS,
  CRASH_TTL_MS,
  BLACKJACK_TTL_MS,
  TOURNAMENT_SIZE,
} from '../constants.js';
import {
  BINGO_ROOM_USER,
  BINGO_ROOM_KIND,
  BINGO_DEFAULTS,
  BINGO_MODES,
  makeBingoCard,
  pickDistinct,
  evaluateBingoCard,
  formatBingoCard,
  resolveBingoRound,
  soloBingoPayout,
  normalizeBingoMode,
} from './bingoLogic.js';

const RED_NUMBERS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

const SLOT_REELS = ['🍒', '🍋', '🍋', '7️⃣', '🍒', '⭐', '🍋', '💎', '7️⃣', '🍒', '⭐'];

function numOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatRetry(ms) {
  const sec = Math.ceil(Math.max(0, ms) / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

function rollInt(min, max, random) {
  const a = Math.floor(Number(min) || 0);
  const b = Math.max(a, Math.floor(Number(max) || a));
  if (b === a) return a;
  return a + Math.floor(random() * (b - a + 1));
}

function cardValue(rank) {
  if (rank === 1) return 11;
  if (rank >= 11) return 10;
  return rank;
}

function handTotal(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += cardValue(c);
    if (c === 1) aces += 1;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

function cardLabel(rank) {
  if (rank === 1) return 'A';
  if (rank === 11) return 'J';
  if (rank === 12) return 'Q';
  if (rank === 13) return 'K';
  return String(rank);
}

function formatHand(cards) {
  return cards.map(cardLabel).join(' ');
}

export function createCasinoService({
  repository,
  actionRepository,
  casinoRepository,
  effectsRepository = null,
  eventRepository = null,
  random = Math.random,
} = {}) {
  if (!repository) throw new Error('[fun/casinoService] repository required');
  if (!actionRepository) throw new Error('[fun/casinoService] actionRepository required');
  if (!casinoRepository) throw new Error('[fun/casinoService] casinoRepository required');

  function stakeBounds(funConfig) {
    return {
      min: Math.max(1, Math.floor(numOr(funConfig.casinoMin, 5))),
      max: Math.max(1, Math.floor(numOr(funConfig.casinoMax, 100))),
    };
  }

  function happyMult(scopeKey, now = Date.now()) {
    if (!eventRepository?.get) return 1;
    const ev = eventRepository.get(scopeKey);
    if (!ev || ev.eventType !== 'casino_happy') return 1;
    if (Number(ev.endsAt) <= now) return 1;
    return Number(ev.multiplier) || 1.12;
  }

  function applyJackpotCut(scopeKey, stake, funConfig, now) {
    const rate = Math.min(0.05, Math.max(0, Number(funConfig.jackpotRate) || 0.01));
    // round: stake 10 @ 5% → 1 (floor daria 0 e o pot nunca enchia com apostas pequenas)
    const cut = Math.max(0, Math.round(Number(stake) * rate));
    if (cut > 0) casinoRepository.addJackpot(scopeKey, cut, now);
    return cut;
  }

  function tryJackpotHit(scopeKey, userJid, funConfig, now) {
    const potInfo = casinoRepository.getJackpot(scopeKey);
    const minHit = Math.max(1, Math.floor(numOr(funConfig.jackpotMinHit, 50)));
    if (potInfo.pot < minHit) return null;
    // ~0.8% chance when pot is ready
    if (random() > 0.008) return null;
    const taken = casinoRepository.takeJackpot(scopeKey, now);
    if (taken.taken <= 0) return null;
    repository.addCoins({
      userJid,
      scopeKey,
      amount: taken.taken,
      now,
      reason: 'jackpot-hit',
    });
    casinoRepository.recordStats({
      userJid,
      scopeKey,
      won: taken.taken,
      games: 0,
      now,
    });
    return taken.taken;
  }

  function finishSolo({
    userJid,
    scopeKey,
    stake,
    payout,
    game,
    now,
  }) {
    const won = payout > 0;
    if (payout > 0) {
      repository.addCoins({
        userJid,
        scopeKey,
        amount: payout,
        now,
        reason: `${game}-win`,
      });
    }
    casinoRepository.recordStats({
      userJid,
      scopeKey,
      wagered: stake,
      won: won ? payout : 0,
      lost: won ? 0 : stake,
      games: 1,
      now,
    });
    return repository.getUserStats(userJid, scopeKey)?.coins || 0;
  }

  function debitStake({ userJid, scopeKey, stake, game, cooldownMs, now, reason }) {
    const cd = casinoRepository.checkCooldown(userJid, scopeKey, game, cooldownMs, now);
    if (!cd.ok) {
      return { ok: false, reason: 'cooldown', retryIn: formatRetry(cd.retryInMs), retryInMs: cd.retryInMs };
    }
    const bal = repository.getUserStats(userJid, scopeKey)?.coins
      ?? repository.ensureUserRow(userJid, scopeKey, now).coins;
    if (bal < stake) return { ok: false, reason: 'insufficient-funds', coins: bal };

    const lock = repository.applyGameCoinDelta({
      userJid,
      scopeKey,
      delta: -stake,
      game: 'flip', // coluna genérica; cooldown real fica no casino_cooldowns
      cooldownMs: 0,
      now,
      reason: reason || `${game}-bet`,
    });
    if (!lock.ok) {
      if (lock.reason === 'insufficient-funds') {
        return { ok: false, reason: 'insufficient-funds', coins: lock.coins };
      }
      return lock;
    }
    casinoRepository.touchCooldown(userJid, scopeKey, game, now);
    return { ok: true, coinsBefore: lock.coinsBefore };
  }

  function parseRouletteBet(args = []) {
    let amount = null;
    let choice = null;
    for (const raw of args) {
      const t = String(raw || '').trim().toLowerCase();
      if (!t) continue;
      if (/^\d+$/.test(t) && amount == null) {
        amount = Number(t);
        continue;
      }
      const n = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (['vermelho', 'red', 'r', 'v'].includes(n)) choice = { type: 'color', value: 'red' };
      else if (['preto', 'black', 'b', 'p'].includes(n)) choice = { type: 'color', value: 'black' };
      else if (['verde', 'green', 'zero', '0'].includes(n)) choice = { type: 'number', value: 0 };
      else if (/^\d{1,2}$/.test(n)) {
        const num = Number(n);
        if (num >= 0 && num <= 36) choice = { type: 'number', value: num };
      }
    }
    return { amount, choice };
  }

  function playRoulette({ userJid, scopeKey, amount, choice, funConfig = {}, now = Date.now() }) {
    const min = Math.floor(numOr(funConfig.casinoMin, 5));
    const max = Math.floor(numOr(funConfig.casinoMax, 100));
    const stake = Math.floor(Number(amount) || 0);
    if (!choice) return { ok: false, reason: 'missing-choice' };
    if (stake < min || stake > max) return { ok: false, reason: 'invalid-amount', min, max };

    // amuleto roleta
    let colorBoost = 0;
    let usedCharm = false;
    if (effectsRepository) {
      const charm = effectsRepository.getEffect(userJid, scopeKey, 'roulette_charm', now);
      if (charm?.charges > 0 && choice.type === 'color') {
        colorBoost = 0.05;
        usedCharm = true;
      }
    }

    const debit = debitStake({
      userJid,
      scopeKey,
      stake,
      game: 'roulette',
      cooldownMs: numOr(funConfig.rouletteCooldownMs, 15_000),
      now,
      reason: 'roulette-bet',
    });
    if (!debit.ok) return debit;
    if (usedCharm) effectsRepository.consumeCharge(userJid, scopeKey, 'roulette_charm', now);

    const jackpotCut = applyJackpotCut(scopeKey, stake, funConfig, now);
    const ball = rollInt(0, 36, random);
    const color = ball === 0 ? 'green' : RED_NUMBERS.has(ball) ? 'red' : 'black';

    let win = false;
    let payoutMult = 0;
    if (choice.type === 'color') {
      // european: 18/37 — small house edge; charm slightly helps via re-roll bias
      let landed = color;
      if (colorBoost > 0 && landed !== choice.value && ball !== 0 && random() < colorBoost) {
        landed = choice.value;
      }
      win = landed === choice.value;
      payoutMult = win ? 2 : 0;
      // use actual ball color for display; if charm flipped result for payout only
      if (win && color !== choice.value) {
        // charm "won" against ball — still show real ball but pay as win
      }
    } else {
      win = ball === choice.value;
      payoutMult = win ? 36 : 0;
    }

    const happy = happyMult(scopeKey, now);
    let payout = win ? Math.floor(stake * payoutMult * happy) : 0;
    // house edge soft trim on big number wins
    const edge = Math.min(0.1, Math.max(0, Number(funConfig.casinoHouseEdge) || 0.03));
    if (win && choice.type === 'number' && edge > 0) {
      payout = Math.max(stake, Math.floor(payout * (1 - edge * 0.25)));
    }

    const coins = finishSolo({ userJid, scopeKey, stake, payout, game: 'roulette', now });
    const jackpotHit = tryJackpotHit(scopeKey, userJid, funConfig, now);

    return {
      ok: true,
      ball,
      color,
      choice,
      win,
      stake,
      payout,
      profit: payout - stake,
      coins,
      jackpotCut,
      jackpotHit,
      happy,
      usedCharm,
      pot: casinoRepository.getJackpot(scopeKey).pot,
    };
  }

  function playSlot({ userJid, scopeKey, amount, funConfig = {}, now = Date.now() }) {
    const min = Math.floor(numOr(funConfig.casinoMin, 5));
    const max = Math.floor(numOr(funConfig.casinoMax, 100));
    const stake = Math.floor(Number(amount) || 0);
    if (stake < min || stake > max) return { ok: false, reason: 'invalid-amount', min, max };

    let multBoost = 1;
    let usedCharm = false;
    if (effectsRepository) {
      const charm = effectsRepository.getEffect(userJid, scopeKey, 'slot_charm', now);
      if (charm?.charges > 0) {
        multBoost = Number(charm.payload?.payoutMult) || 1.25;
        usedCharm = true;
      }
    }

    const debit = debitStake({
      userJid,
      scopeKey,
      stake,
      game: 'slot',
      cooldownMs: numOr(funConfig.slotCooldownMs, 20_000),
      now,
      reason: 'slot-bet',
    });
    if (!debit.ok) return debit;
    if (usedCharm) effectsRepository.consumeCharge(userJid, scopeKey, 'slot_charm', now);

    const jackpotCut = applyJackpotCut(scopeKey, stake, funConfig, now);
    const reels = [
      SLOT_REELS[Math.floor(random() * SLOT_REELS.length)],
      SLOT_REELS[Math.floor(random() * SLOT_REELS.length)],
      SLOT_REELS[Math.floor(random() * SLOT_REELS.length)],
    ];

    let baseMult = 0;
    if (reels[0] === reels[1] && reels[1] === reels[2]) {
      if (reels[0] === '💎') baseMult = 20;
      else if (reels[0] === '7️⃣') baseMult = 10;
      else if (reels[0] === '⭐') baseMult = 5;
      else if (reels[0] === '🍒') baseMult = 3;
      else baseMult = 2;
    } else if (reels.filter(r => r === '💎').length >= 2) {
      baseMult = 1.5;
    } else if (reels.filter(r => r === '7️⃣').length >= 2) {
      baseMult = 1.2;
    }

    const happy = happyMult(scopeKey, now);
    const payout = baseMult > 0 ? Math.floor(stake * baseMult * multBoost * happy) : 0;
    const coins = finishSolo({ userJid, scopeKey, stake, payout, game: 'slot', now });
    const jackpotHit = tryJackpotHit(scopeKey, userJid, funConfig, now);

    return {
      ok: true,
      reels,
      stake,
      payout,
      mult: baseMult,
      win: payout > 0,
      profit: payout - stake,
      coins,
      jackpotCut,
      jackpotHit,
      happy,
      usedCharm,
      pot: casinoRepository.getJackpot(scopeKey).pot,
    };
  }

  function getJackpot(scopeKey) {
    return casinoRepository.getJackpot(scopeKey);
  }

  function proposeDiceDuel({
    fromJid,
    toJid,
    scopeKey,
    amount,
    funConfig = {},
    now = Date.now(),
  }) {
    const min = Math.floor(numOr(funConfig.diceDuelMin, funConfig.betMin || 5));
    const max = Math.floor(numOr(funConfig.diceDuelMax, funConfig.betMax || 150));
    const stake = Math.floor(Number(amount) || 0);
    const a = String(fromJid || '').trim();
    const b = String(toJid || '').trim();
    const s = String(scopeKey || '').trim();
    if (!a || !b || a === b) return { ok: false, reason: 'invalid-target' };
    if (stake < min || stake > max) return { ok: false, reason: 'invalid-amount', min, max };

    const aBal = repository.getUserStats(a, s)?.coins ?? repository.ensureUserRow(a, s, now).coins;
    const bBal = repository.getUserStats(b, s)?.coins ?? repository.ensureUserRow(b, s, now).coins;
    if (aBal < stake) return { ok: false, reason: 'insufficient-funds', coins: aBal };
    if (bBal < stake) return { ok: false, reason: 'target-insufficient', coins: bBal };

    const action = actionRepository.createAction({
      scopeKey: s,
      actionType: ACTION_TYPE.BET_DICE,
      fromJid: a,
      toJid: b,
      payload: { amount: stake },
      ttlMs: BET_TTL_MS,
      now,
    });

    return { ok: true, action, amount: stake, expiresInMs: BET_TTL_MS };
  }

  function acceptDiceDuel({ userJid, scopeKey, now = Date.now() }) {
    const u = String(userJid || '').trim();
    const s = String(scopeKey || '').trim();
    const pending = actionRepository.getLatestIncoming({
      scopeKey: s,
      toJid: u,
      actionType: ACTION_TYPE.BET_DICE,
      now,
    });
    if (!pending) return { ok: false, reason: 'no-bet' };
    const stake = Math.floor(Number(pending.payload?.amount) || 0);
    if (stake <= 0) {
      actionRepository.deleteAction(pending.id);
      return { ok: false, reason: 'invalid-bet' };
    }

    const lock = repository.escrowBet({
      scopeKey: s,
      aJid: pending.fromJid,
      bJid: u,
      amount: stake,
      now,
    });
    if (!lock.ok) {
      return { ok: false, reason: lock.reason, aCoins: lock.aCoins, bCoins: lock.bCoins };
    }
    actionRepository.deleteAction(pending.id);

    let aRoll = rollInt(1, 20, random);
    let bRoll = rollInt(1, 20, random);
    let guards = 0;
    while (aRoll === bRoll && guards < 5) {
      aRoll = rollInt(1, 20, random);
      bRoll = rollInt(1, 20, random);
      guards += 1;
    }

    const pot = lock.pot;
    let winnerJid;
    let loserJid;
    let tie = false;
    if (aRoll === bRoll) {
      tie = true;
      // devolve stake
      repository.addCoins({ userJid: pending.fromJid, scopeKey: s, amount: stake, now, reason: 'dice-tie' });
      repository.addCoins({ userJid: u, scopeKey: s, amount: stake, now, reason: 'dice-tie' });
    } else if (aRoll > bRoll) {
      winnerJid = pending.fromJid;
      loserJid = u;
      repository.payoutBetWinner({ scopeKey: s, winnerJid, pot, now });
    } else {
      winnerJid = u;
      loserJid = pending.fromJid;
      repository.payoutBetWinner({ scopeKey: s, winnerJid, pot, now });
    }

    if (!tie) {
      casinoRepository.recordStats({
        userJid: winnerJid,
        scopeKey: s,
        wagered: stake,
        won: pot,
        games: 1,
        now,
      });
      casinoRepository.recordStats({
        userJid: loserJid,
        scopeKey: s,
        wagered: stake,
        lost: stake,
        games: 1,
        now,
      });
    }

    return {
      ok: true,
      tie,
      fromJid: pending.fromJid,
      toJid: u,
      aRoll,
      bRoll,
      winnerJid: winnerJid || '',
      loserJid: loserJid || '',
      stake,
      pot,
      winnerCoins: winnerJid ? repository.getUserStats(winnerJid, s)?.coins || 0 : 0,
    };
  }

  function declineDiceDuel({ userJid, scopeKey, now = Date.now() }) {
    const pending = actionRepository.getLatestIncoming({
      scopeKey,
      toJid: userJid,
      actionType: ACTION_TYPE.BET_DICE,
      now,
    });
    if (!pending) return { ok: false, reason: 'no-bet' };
    actionRepository.deleteAction(pending.id);
    return {
      ok: true,
      fromJid: pending.fromJid,
      toJid: userJid,
      amount: Number(pending.payload?.amount) || 0,
    };
  }

  function startCrash({ userJid, scopeKey, amount, funConfig = {}, now = Date.now() }) {
    const min = Math.floor(numOr(funConfig.crashMin, 5));
    const max = Math.floor(numOr(funConfig.crashMax, 80));
    const stake = Math.floor(Number(amount) || 0);
    if (stake < min || stake > max) return { ok: false, reason: 'invalid-amount', min, max };

    if (casinoRepository.getSession(userJid, scopeKey, 'crash', now)) {
      return { ok: false, reason: 'already-flying' };
    }

    const debit = debitStake({
      userJid,
      scopeKey,
      stake,
      game: 'crash',
      cooldownMs: numOr(funConfig.crashCooldownMs, 30_000),
      now,
      reason: 'crash-bet',
    });
    if (!debit.ok) return debit;

    applyJackpotCut(scopeKey, stake, funConfig, now);

    // crash point: ~ house edge distribution, min 1.05
    const maxMult = Math.max(2, Number(funConfig.crashMaxMult) || 12);
    const u = Math.max(0.001, random());
    let crashAt = Math.floor((1 / u) * 100) / 100; // heavy tail
    crashAt = Math.min(maxMult, Math.max(1.05, crashAt));

    const ttl = Math.floor(numOr(funConfig.crashTtlMs, CRASH_TTL_MS));
    const session = casinoRepository.upsertSession({
      userJid,
      scopeKey,
      kind: 'crash',
      stake,
      ttlMs: ttl,
      now,
      state: { crashAt, startedAt: now },
    });

    return {
      ok: true,
      stake,
      ttlMs: ttl,
      sessionId: session?.id,
      expiresAt: session?.expiresAt,
    };
  }

  function cashoutCrash({ userJid, scopeKey, funConfig = {}, now = Date.now() }) {
    const session = casinoRepository.getSession(userJid, scopeKey, 'crash', now);
    if (!session) return { ok: false, reason: 'no-flight' };

    const growth = Number(funConfig.crashGrowthPerSec) || 0.18;
    const crashAt = Number(session.state?.crashAt) || 1.1;
    const startedAt = Number(session.state?.startedAt) || session.createdAt;
    const elapsedSec = Math.max(0, (now - startedAt) / 1000);
    const currentMult = Math.floor((1 + elapsedSec * growth) * 100) / 100;
    const stake = session.stake;

    casinoRepository.deleteSession(session.id);

    if (currentMult >= crashAt) {
      casinoRepository.recordStats({
        userJid,
        scopeKey,
        wagered: stake,
        lost: stake,
        games: 1,
        now,
      });
      return {
        ok: true,
        crashed: true,
        crashAt,
        currentMult: Math.min(currentMult, crashAt),
        stake,
        payout: 0,
        profit: -stake,
        coins: repository.getUserStats(userJid, scopeKey)?.coins || 0,
      };
    }

    const happy = happyMult(scopeKey, now);
    const payout = Math.max(1, Math.floor(stake * currentMult * happy));
    const coins = finishSolo({ userJid, scopeKey, stake, payout, game: 'crash', now });

    return {
      ok: true,
      crashed: false,
      crashAt,
      currentMult,
      stake,
      payout,
      profit: payout - stake,
      coins,
      happy,
    };
  }

  function drawCard() {
    return rollInt(1, 13, random);
  }

  function startBlackjack({ userJid, scopeKey, amount, funConfig = {}, now = Date.now() }) {
    const min = Math.floor(numOr(funConfig.blackjackMin, 5));
    const max = Math.floor(numOr(funConfig.blackjackMax, 80));
    const stake = Math.floor(Number(amount) || 0);
    if (stake < min || stake > max) return { ok: false, reason: 'invalid-amount', min, max };

    if (casinoRepository.getSession(userJid, scopeKey, 'blackjack', now)) {
      return { ok: false, reason: 'already-playing' };
    }

    const debit = debitStake({
      userJid,
      scopeKey,
      stake,
      game: 'blackjack',
      cooldownMs: numOr(funConfig.blackjackCooldownMs, 25_000),
      now,
      reason: 'bj-bet',
    });
    if (!debit.ok) return debit;
    applyJackpotCut(scopeKey, stake, funConfig, now);

    const player = [drawCard(), drawCard()];
    const dealer = [drawCard(), drawCard()];
    const pTotal = handTotal(player);

    // natural blackjack
    if (pTotal === 21) {
      const dTotal = handTotal(dealer);
      if (dTotal === 21) {
        repository.addCoins({
          userJid,
          scopeKey,
          amount: stake,
          now,
          reason: 'bj-push',
        });
        casinoRepository.recordStats({
          userJid,
          scopeKey,
          wagered: stake,
          games: 1,
          now,
        });
        return {
          ok: true,
          done: true,
          result: 'push',
          player,
          dealer,
          pTotal,
          dTotal,
          stake,
          payout: stake,
          coins: repository.getUserStats(userJid, scopeKey)?.coins || 0,
        };
      }
      const happy = happyMult(scopeKey, now);
      const payout = Math.floor(stake * 2.5 * happy);
      const coins = finishSolo({ userJid, scopeKey, stake, payout, game: 'blackjack', now });
      return {
        ok: true,
        done: true,
        result: 'blackjack',
        player,
        dealer,
        pTotal,
        dTotal,
        stake,
        payout,
        coins,
      };
    }

    const session = casinoRepository.upsertSession({
      userJid,
      scopeKey,
      kind: 'blackjack',
      stake,
      ttlMs: BLACKJACK_TTL_MS,
      now,
      state: { player, dealer },
    });

    return {
      ok: true,
      done: false,
      player,
      dealerVisible: dealer[0],
      pTotal,
      stake,
      sessionId: session?.id,
    };
  }

  function resolveDealer(player, dealer) {
    const d = [...dealer];
    while (handTotal(d) < 17) d.push(drawCard());
    const pTotal = handTotal(player);
    const dTotal = handTotal(d);
    let result = 'lose';
    if (pTotal > 21) result = 'bust';
    else if (dTotal > 21) result = 'win';
    else if (pTotal > dTotal) result = 'win';
    else if (pTotal === dTotal) result = 'push';
    else result = 'lose';
    return { dealer: d, pTotal, dTotal, result };
  }

  function hitBlackjack({ userJid, scopeKey, funConfig = {}, now = Date.now() }) {
    const session = casinoRepository.getSession(userJid, scopeKey, 'blackjack', now);
    if (!session) return { ok: false, reason: 'no-hand' };
    const player = [...(session.state.player || [])];
    const dealer = [...(session.state.dealer || [])];
    player.push(drawCard());
    const pTotal = handTotal(player);
    const stake = session.stake;

    if (pTotal > 21) {
      casinoRepository.deleteSession(session.id);
      casinoRepository.recordStats({
        userJid,
        scopeKey,
        wagered: stake,
        lost: stake,
        games: 1,
        now,
      });
      return {
        ok: true,
        done: true,
        result: 'bust',
        player,
        dealer,
        pTotal,
        dTotal: handTotal(dealer),
        stake,
        payout: 0,
        coins: repository.getUserStats(userJid, scopeKey)?.coins || 0,
      };
    }

    casinoRepository.updateSession(session.id, {
      state: { player, dealer },
      expiresAt: now + BLACKJACK_TTL_MS,
    });

    return {
      ok: true,
      done: false,
      player,
      dealerVisible: dealer[0],
      pTotal,
      stake,
    };
  }

  function standBlackjack({ userJid, scopeKey, funConfig = {}, now = Date.now() }) {
    const session = casinoRepository.getSession(userJid, scopeKey, 'blackjack', now);
    if (!session) return { ok: false, reason: 'no-hand' };
    const player = [...(session.state.player || [])];
    const dealerStart = [...(session.state.dealer || [])];
    const stake = session.stake;
    casinoRepository.deleteSession(session.id);

    const { dealer, pTotal, dTotal, result } = resolveDealer(player, dealerStart);
    const happy = happyMult(scopeKey, now);
    let payout = 0;
    if (result === 'win') payout = Math.floor(stake * 2 * happy);
    else if (result === 'push') payout = stake;

    if (payout > 0) {
      repository.addCoins({
        userJid,
        scopeKey,
        amount: payout,
        now,
        reason: result === 'push' ? 'bj-push' : 'bj-win',
      });
    }
    casinoRepository.recordStats({
      userJid,
      scopeKey,
      wagered: stake,
      won: result === 'win' ? payout : result === 'push' ? stake : 0,
      lost: result === 'lose' || result === 'bust' ? stake : 0,
      games: 1,
      now,
    });

    return {
      ok: true,
      done: true,
      result,
      player,
      dealer,
      pTotal,
      dTotal,
      stake,
      payout,
      profit: payout - stake,
      coins: repository.getUserStats(userJid, scopeKey)?.coins || 0,
      happy,
    };
  }

  function joinTournament({
    userJid,
    scopeKey,
    entryFee,
    funConfig = {},
    now = Date.now(),
  }) {
    const min = Math.floor(numOr(funConfig.tournamentEntryMin, 10));
    const max = Math.floor(numOr(funConfig.tournamentEntryMax, 80));
    const size = Math.max(2, Math.floor(numOr(funConfig.tournamentSize, TOURNAMENT_SIZE)));
    let fee = Math.floor(Number(entryFee) || 0);
    let open = casinoRepository.getOpenTournament(scopeKey);

    if (open) {
      fee = open.entryFee;
      if (open.players.includes(userJid)) {
        return { ok: false, reason: 'already-in', tournament: open };
      }
    } else {
      if (fee <= 0) fee = min;
      if (fee < min || fee > max) return { ok: false, reason: 'invalid-amount', min, max };
      open = casinoRepository.createTournament({ scopeKey, entryFee: fee, now });
    }

    const bal = repository.getUserStats(userJid, scopeKey)?.coins
      ?? repository.ensureUserRow(userJid, scopeKey, now).coins;
    if (bal < fee) return { ok: false, reason: 'insufficient-funds', coins: bal, fee };

    const lock = repository.applyGameCoinDelta({
      userJid,
      scopeKey,
      delta: -fee,
      game: 'flip',
      cooldownMs: 0,
      now,
      reason: 'tournament-entry',
    });
    if (!lock.ok) return { ok: false, reason: lock.reason, coins: lock.coins };

    const players = [...(open.players || []), userJid];
    let t = {
      ...open,
      players,
      pot: (open.pot || 0) + fee,
      status: 'open',
    };

    if (players.length >= size) {
      // bracket: semis + final with d20
      const [p0, p1, p2, p3] = players;
      const roll = () => rollInt(1, 20, random);
      const s1a = roll();
      const s1b = roll();
      const s2a = roll();
      const s2b = roll();
      const w1 = s1a >= s1b ? p0 : p1;
      const w2 = s2a >= s2b ? p2 : p3;
      const f1 = roll();
      const f2 = roll();
      const winner = f1 >= f2 ? w1 : w2;
      const pot = t.pot;
      repository.addCoins({
        userJid: winner,
        scopeKey,
        amount: pot,
        now,
        reason: 'tournament-win',
      });
      casinoRepository.recordStats({
        userJid: winner,
        scopeKey,
        wagered: fee,
        won: pot,
        games: 1,
        now,
      });
      for (const p of players) {
        if (p !== winner) {
          casinoRepository.recordStats({
            userJid: p,
            scopeKey,
            wagered: fee,
            lost: fee,
            games: 1,
            now,
          });
        }
      }
      t = {
        ...t,
        status: 'done',
        winnerJid: winner,
        bracket: {
          semi1: { a: p0, b: p1, aRoll: s1a, bRoll: s1b, winner: w1 },
          semi2: { a: p2, b: p3, aRoll: s2a, bRoll: s2b, winner: w2 },
          final: { a: w1, b: w2, aRoll: f1, bRoll: f2, winner },
        },
      };
      t = casinoRepository.saveTournament(t, now);
      return {
        ok: true,
        started: true,
        finished: true,
        tournament: t,
        winnerJid: winner,
        pot,
        fee,
        coins: repository.getUserStats(userJid, scopeKey)?.coins || 0,
      };
    }

    t = casinoRepository.saveTournament(t, now);
    return {
      ok: true,
      started: false,
      finished: false,
      tournament: t,
      fee,
      need: size - players.length,
      coins: repository.getUserStats(userJid, scopeKey)?.coins || 0,
    };
  }

  function tournamentStatus(scopeKey) {
    return casinoRepository.getOpenTournament(scopeKey);
  }

  function bingoOpts(funConfig = {}) {
    const defaultMode = normalizeBingoMode(
      funConfig.bingoDefaultMode ?? BINGO_DEFAULTS.mode
    );
    return {
      min: Math.max(1, Math.floor(numOr(funConfig.bingoMin, funConfig.casinoMin || 5))),
      max: Math.max(1, Math.floor(numOr(funConfig.bingoMax, funConfig.casinoMax || 100))),
      size: Math.max(2, Math.min(8, Math.floor(numOr(funConfig.bingoSize, BINGO_DEFAULTS.size)))),
      minPlayers: Math.max(2, Math.min(8, Math.floor(numOr(funConfig.bingoMinPlayers, BINGO_DEFAULTS.minPlayers)))),
      lobbyTtlMs: Math.max(60_000, Math.floor(numOr(funConfig.bingoLobbyTtlMs, 5 * 60_000))),
      poolMax: Math.max(9, Math.floor(numOr(funConfig.bingoPoolMax, BINGO_DEFAULTS.poolMax))),
      drawCount: Math.max(5, Math.min(30, Math.floor(numOr(funConfig.bingoDrawCount, BINGO_DEFAULTS.drawCount)))),
      houseEdge: Math.min(0.2, Math.max(0, Number(funConfig.bingoHouseEdge ?? BINGO_DEFAULTS.houseEdge))),
      soloLineMult: Math.max(1.1, Number(funConfig.bingoSoloLineMult) || BINGO_DEFAULTS.soloLineMult),
      soloFullMult: Math.max(2, Number(funConfig.bingoSoloFullMult) || BINGO_DEFAULTS.soloFullMult),
      cooldownMs: Math.max(0, Math.floor(numOr(funConfig.bingoCooldownMs, 15_000))),
      defaultMode,
    };
  }

  function readBingoRoom(scopeKey) {
    return casinoRepository.getSessionRaw(BINGO_ROOM_USER, scopeKey, BINGO_ROOM_KIND);
  }

  function refundBingoPlayers(scopeKey, players, fee, now) {
    const list = Array.isArray(players) ? players : [];
    const entry = Math.max(0, Math.floor(Number(fee) || 0));
    for (const p of list) {
      const jid = String(p?.jid || p || '');
      if (!jid || entry <= 0) continue;
      repository.addCoins({
        userJid: jid,
        scopeKey,
        amount: entry,
        now,
        reason: 'bingo-refund',
      });
    }
  }

  function mapBingoRoom(session) {
    if (!session) return null;
    const st = session.state || {};
    const mode = normalizeBingoMode(st.mode || BINGO_MODES.FAST);
    const status = String(st.status || 'open');
    return {
      id: session.id,
      scopeKey: session.scopeKey,
      entryFee: Number(st.entryFee) || session.stake || 0,
      pot: Number(st.pot) || 0,
      players: Array.isArray(st.players) ? st.players : [],
      status,
      mode,
      balls: Array.isArray(st.balls) ? st.balls : [],
      drawn: Array.isArray(st.drawn) ? st.drawn : [],
      expiresAt: session.expiresAt,
      createdAt: session.createdAt,
      size: Number(st.size) || BINGO_DEFAULTS.size,
    };
  }

  /**
   * Sessão de bingo (open ou running). Expira → reembolso + apaga.
   */
  function getBingoSession(scopeKey, now = Date.now()) {
    const session = readBingoRoom(scopeKey);
    if (!session) return null;
    if (Number(session.expiresAt) < Number(now)) {
      const fee = Number(session.state?.entryFee) || session.stake || 0;
      refundBingoPlayers(scopeKey, session.state?.players, fee, now);
      casinoRepository.deleteSession(session.id);
      return null;
    }
    return mapBingoRoom(session);
  }

  /** Só lobby aberto (join/leave/start). */
  function getOpenBingoRoom(scopeKey, now = Date.now()) {
    const room = getBingoSession(scopeKey, now);
    if (!room || room.status !== 'open') return null;
    return room;
  }

  function saveBingoRoom(scopeKey, data, ttlMs, now = Date.now()) {
    return casinoRepository.upsertSession({
      userJid: BINGO_ROOM_USER,
      scopeKey,
      kind: BINGO_ROOM_KIND,
      stake: Math.max(0, Math.floor(Number(data.entryFee) || 0)),
      ttlMs,
      now,
      id: data.id || undefined,
      state: {
        status: String(data.status || 'open'),
        mode: normalizeBingoMode(data.mode || BINGO_MODES.FAST),
        entryFee: Math.max(0, Math.floor(Number(data.entryFee) || 0)),
        pot: Math.max(0, Math.floor(Number(data.pot) || 0)),
        players: Array.isArray(data.players) ? data.players : [],
        size: Math.max(2, Math.floor(Number(data.size) || BINGO_DEFAULTS.size)),
        balls: Array.isArray(data.balls) ? data.balls : [],
        drawn: Array.isArray(data.drawn) ? data.drawn : [],
      },
    });
  }

  function settleBingoWithDrawn({
    scopeKey,
    players,
    fee,
    pot,
    drawn,
    funConfig = {},
    now = Date.now(),
    mode = BINGO_MODES.FAST,
  }) {
    const opts = bingoOpts(funConfig);
    const happy = happyMult(scopeKey, now);
    const resolved = resolveBingoRound(players, drawn, pot, { houseEdge: opts.houseEdge });

    let results = resolved.results;
    if (!resolved.refund && happy > 1) {
      results = results.map((r) => {
        if (r.payout <= 0) return r;
        return { ...r, payout: Math.max(1, Math.floor(r.payout * happy)) };
      });
    }

    if (resolved.refund) {
      refundBingoPlayers(scopeKey, players, fee, now);
      for (const p of players) {
        const jid = String(p?.jid || '');
        if (!jid) continue;
        casinoRepository.recordStats({
          userJid: jid,
          scopeKey,
          wagered: fee,
          won: fee,
          lost: 0,
          games: 1,
          now,
        });
      }
    } else {
      for (const r of results) {
        if (!r.jid) continue;
        if (r.payout > 0) {
          repository.addCoins({
            userJid: r.jid,
            scopeKey,
            amount: r.payout,
            now,
            reason: 'bingo-win',
          });
        }
        casinoRepository.recordStats({
          userJid: r.jid,
          scopeKey,
          wagered: fee,
          won: r.payout > 0 ? r.payout : 0,
          lost: r.payout > 0 ? 0 : fee,
          games: 1,
          now,
        });
      }
    }

    const session = readBingoRoom(scopeKey);
    if (session?.id) casinoRepository.deleteSession(session.id);

    const houseCut = Math.max(0, Math.floor(Number(pot) || 0) - Math.floor(Number(resolved.netPot) || 0));
    const playersOut = results.map((r) => {
      const payout = Math.max(0, Math.floor(Number(r.payout) || 0));
      // entrada já saiu no join; lucro real = payout - fee (perdedor: -fee)
      const profit = resolved.refund ? 0 : payout - fee;
      const coins = repository.getUserStats(r.jid, scopeKey)?.coins || 0;
      return {
        jid: r.jid,
        card: r.card,
        full: r.full,
        hasLine: r.hasLine,
        lines: r.lines,
        markedCount: r.markedCount,
        payout,
        fee,
        profit,
        coins,
        cardText: formatBingoCard(r.card, drawn),
      };
    });

    return {
      ok: true,
      finished: true,
      classic: mode === BINGO_MODES.CLASSIC,
      mode,
      refund: resolved.refund,
      tier: resolved.refund ? 'none' : resolved.tier,
      drawn: Array.isArray(drawn) ? drawn : [],
      pot,
      netPot: resolved.netPot,
      houseCut,
      entryFee: fee,
      happy,
      players: playersOut,
      winners: playersOut
        .filter((r) => r.payout > 0)
        .map((r) => ({
          jid: r.jid,
          payout: r.payout,
          full: r.full,
          profit: r.profit,
          fee: r.fee,
          coins: r.coins,
        })),
      losers: playersOut
        .filter((r) => !resolved.refund && r.payout <= 0)
        .map((r) => ({
          jid: r.jid,
          fee: r.fee,
          profit: r.profit,
          coins: r.coins,
        })),
    };
  }

  function runBingoGame({ scopeKey, room, funConfig = {}, now = Date.now() }) {
    const opts = bingoOpts(funConfig);
    const players = Array.isArray(room.players) ? room.players : [];
    const fee = Math.max(0, Math.floor(Number(room.entryFee) || 0));
    const pot = Math.max(0, Math.floor(Number(room.pot) || 0));
    const drawn = pickDistinct(opts.drawCount, opts.poolMax, random);
    return settleBingoWithDrawn({
      scopeKey,
      players,
      fee,
      pot,
      drawn,
      funConfig,
      now,
      mode: BINGO_MODES.FAST,
    });
  }

  function maybeAutoStartRoom({ scopeKey, room, funConfig, now, joinedMeta }) {
    if (!room || room.players.length < bingoOpts(funConfig).size) {
      return null;
    }
    // só modo rápido — 1 resposta no fim (sem flood de bolas)
    const finished = runBingoGame({ scopeKey, room, funConfig, now });
    return {
      ...finished,
      joined: true,
      autoStarted: true,
      ...joinedMeta,
    };
  }

  function joinBingo({
    userJid,
    scopeKey,
    entryFee,
    mode: modeInput,
    funConfig = {},
    now = Date.now(),
  }) {
    const opts = bingoOpts(funConfig);
    let fee = Math.floor(Number(entryFee) || 0);
    const running = getBingoSession(scopeKey, now);
    if (running?.status === 'running') {
      return { ok: false, reason: 'game-running', room: running };
    }

    let room = getOpenBingoRoom(scopeKey, now);
    // modo clássico depreciado — sempre rápido
    const mode = BINGO_MODES.FAST;
    void modeInput;
    void opts.defaultMode;

    if (room) {
      fee = room.entryFee;
      if (room.players.some((p) => p.jid === userJid)) {
        return { ok: false, reason: 'already-in', room };
      }
      if (room.players.length >= opts.size) {
        return { ok: false, reason: 'room-full', room };
      }
    } else {
      if (fee <= 0) fee = opts.min;
      if (fee < opts.min || fee > opts.max) {
        return { ok: false, reason: 'invalid-amount', min: opts.min, max: opts.max };
      }
    }

    const bal = repository.getUserStats(userJid, scopeKey)?.coins
      ?? repository.ensureUserRow(userJid, scopeKey, now).coins;
    if (bal < fee) return { ok: false, reason: 'insufficient-funds', coins: bal, fee };

    const lock = repository.applyGameCoinDelta({
      userJid,
      scopeKey,
      delta: -fee,
      game: 'flip',
      cooldownMs: 0,
      now,
      reason: 'bingo-entry',
    });
    if (!lock.ok) return { ok: false, reason: lock.reason, coins: lock.coins };

    const card = makeBingoCard(random, { poolMax: opts.poolMax });
    const player = { jid: userJid, card };

    if (!room) {
      room = {
        entryFee: fee,
        pot: fee,
        players: [player],
        size: opts.size,
        mode,
        status: 'open',
      };
    } else {
      room = {
        ...room,
        pot: room.pot + fee,
        players: [...room.players, player],
        size: opts.size,
        mode: room.mode,
        status: 'open',
      };
    }

    const remainingTtl = room.expiresAt
      ? Math.max(30_000, Number(room.expiresAt) - now)
      : opts.lobbyTtlMs;

    saveBingoRoom(scopeKey, room, room.id ? remainingTtl : opts.lobbyTtlMs, now);
    room = getOpenBingoRoom(scopeKey, now);

    const meta = {
      myCard: card,
      myCardText: formatBingoCard(card),
      fee,
      coins: repository.getUserStats(userJid, scopeKey)?.coins || 0,
    };

    const auto = maybeAutoStartRoom({
      scopeKey,
      room,
      funConfig,
      now,
      joinedMeta: meta,
    });
    if (auto) return auto;

    return {
      ok: true,
      finished: false,
      joined: true,
      room,
      need: Math.max(0, opts.size - (room?.players?.length || 0)),
      minStart: opts.minPlayers,
      ...meta,
    };
  }

  function startBingo({ userJid, scopeKey, funConfig = {}, now = Date.now() }) {
    const opts = bingoOpts(funConfig);
    const session = getBingoSession(scopeKey, now);
    if (!session) return { ok: false, reason: 'no-room' };
    if (session.status === 'running') {
      return { ok: false, reason: 'already-running', room: session };
    }
    if (session.status !== 'open') return { ok: false, reason: 'no-room' };

    const room = session;
    if (!room.players.some((p) => p.jid === userJid)) {
      return { ok: false, reason: 'not-in', room };
    }
    if (room.players.length < opts.minPlayers) {
      return {
        ok: false,
        reason: 'need-players',
        have: room.players.length,
        need: opts.minPlayers,
        room,
      };
    }

    const finished = runBingoGame({ scopeKey, room, funConfig, now });
    return {
      ...finished,
      startedBy: userJid,
      coins: repository.getUserStats(userJid, scopeKey)?.coins || 0,
    };
  }

  function leaveBingo({ userJid, scopeKey, now = Date.now() }) {
    const session = getBingoSession(scopeKey, now);
    if (!session) return { ok: false, reason: 'no-room' };
    if (session.status === 'running') {
      return { ok: false, reason: 'game-running', room: session };
    }
    const room = session.status === 'open' ? session : null;
    if (!room) return { ok: false, reason: 'no-room' };

    const idx = room.players.findIndex((p) => p.jid === userJid);
    if (idx < 0) return { ok: false, reason: 'not-in', room };

    const fee = room.entryFee;
    const nextPlayers = room.players.filter((p) => p.jid !== userJid);
    repository.addCoins({
      userJid,
      scopeKey,
      amount: fee,
      now,
      reason: 'bingo-leave-refund',
    });

    if (nextPlayers.length === 0) {
      const raw = readBingoRoom(scopeKey);
      if (raw?.id) casinoRepository.deleteSession(raw.id);
      return {
        ok: true,
        left: true,
        closed: true,
        fee,
        coins: repository.getUserStats(userJid, scopeKey)?.coins || 0,
      };
    }

    const remainingTtl = Math.max(30_000, Number(room.expiresAt) - now);
    saveBingoRoom(
      scopeKey,
      {
        id: room.id,
        status: 'open',
        mode: room.mode,
        entryFee: fee,
        pot: Math.max(0, room.pot - fee),
        players: nextPlayers,
        size: room.size,
        balls: [],
        drawn: [],
      },
      remainingTtl,
      now
    );

    return {
      ok: true,
      left: true,
      closed: false,
      fee,
      room: getOpenBingoRoom(scopeKey, now),
      coins: repository.getUserStats(userJid, scopeKey)?.coins || 0,
    };
  }

  function bingoStatus(scopeKey, now = Date.now()) {
    return getBingoSession(scopeKey, now);
  }

  function bingoMyCard({ userJid, scopeKey, now = Date.now() }) {
    const room = getBingoSession(scopeKey, now);
    if (!room) return { ok: false, reason: 'no-room' };
    const me = room.players.find((p) => p.jid === userJid);
    if (!me) return { ok: false, reason: 'not-in', room };
    return {
      ok: true,
      card: me.card,
      cardText: formatBingoCard(me.card, room.drawn || []),
      room,
    };
  }

  function playBingoSolo({
    userJid,
    scopeKey,
    amount,
    funConfig = {},
    now = Date.now(),
  }) {
    const opts = bingoOpts(funConfig);
    const stake = Math.floor(Number(amount) || 0);
    if (stake < opts.min || stake > opts.max) {
      return { ok: false, reason: 'invalid-amount', min: opts.min, max: opts.max };
    }

    const existing = getBingoSession(scopeKey, now);
    if (existing) {
      return { ok: false, reason: 'room-open', room: existing };
    }

    const debit = debitStake({
      userJid,
      scopeKey,
      stake,
      game: 'bingo',
      cooldownMs: opts.cooldownMs,
      now,
      reason: 'bingo-solo',
    });
    if (!debit.ok) return debit;

    applyJackpotCut(scopeKey, stake, funConfig, now);

    const card = makeBingoCard(random, { poolMax: opts.poolMax });
    const drawn = pickDistinct(opts.drawCount, opts.poolMax, random);
    const ev = evaluateBingoCard(card, drawn);
    const happy = happyMult(scopeKey, now);
    const payout = soloBingoPayout(ev, stake, {
      lineMult: opts.soloLineMult,
      fullMult: opts.soloFullMult,
      happy,
    });
    const coins = finishSolo({
      userJid,
      scopeKey,
      stake,
      payout,
      game: 'bingo',
      now,
    });

    return {
      ok: true,
      solo: true,
      mode: BINGO_MODES.FAST,
      stake,
      payout,
      profit: payout - stake,
      full: ev.full,
      hasLine: ev.hasLine,
      lines: ev.lines,
      markedCount: ev.markedCount,
      card,
      drawn,
      cardText: formatBingoCard(card, drawn),
      happy,
      coins,
    };
  }

  function rankCasino(scopeKey, limit = 10) {
    return casinoRepository.getLeaderboard(scopeKey, limit);
  }

  function getUserCasinoStats(userJid, scopeKey) {
    return casinoRepository.getStats(userJid, scopeKey);
  }

  return {
    parseRouletteBet,
    playRoulette,
    playSlot,
    getJackpot,
    proposeDiceDuel,
    acceptDiceDuel,
    declineDiceDuel,
    startCrash,
    cashoutCrash,
    startBlackjack,
    hitBlackjack,
    standBlackjack,
    joinTournament,
    tournamentStatus,
    joinBingo,
    startBingo,
    leaveBingo,
    bingoStatus,
    bingoMyCard,
    playBingoSolo,
    formatBingoCard,
    rankCasino,
    getUserCasinoStats,
    formatRetry,
    formatHand,
    handTotal,
    happyMult,
  };
}
