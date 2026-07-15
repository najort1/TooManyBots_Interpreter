/**
 * Jogos e apostas de coins.
 */

import { ACTION_TYPE, BET_TTL_MS } from '../constants.js';

function rollBool(random = Math.random) {
  return random() < 0.5;
}

function oppositeSide(side) {
  return side === 'cara' ? 'coroa' : 'cara';
}

function rollInt(min, max, random = Math.random) {
  const a = Math.floor(Number(min) || 0);
  const b = Math.max(a, Math.floor(Number(max) || a));
  if (b === a) return a;
  return a + Math.floor(random() * (b - a + 1));
}

function formatRetry(ms) {
  const sec = Math.ceil(Math.max(0, ms) / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

/** Default só quando valor é null/undefined/NaN — 0 é válido (sem cooldown). */
function numOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function createGameService({
  repository,
  actionRepository,
  effectsRepository = null,
  random = Math.random,
} = {}) {
  if (!repository) throw new Error('[fun/gameService] repository required');
  if (!actionRepository) throw new Error('[fun/gameService] actionRepository required');

  /**
   * Parse "cara" | "coroa" a partir de texto livre.
   * @returns {'cara'|'coroa'|null}
   */
  function parseCoinSide(raw) {
    const t = String(raw || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    if (!t) return null;
    if (['cara', 'c', 'heads', 'h', 'frente'].includes(t)) return 'cara';
    if (['coroa', 'k', 'tails', 't', 'verso'].includes(t)) return 'coroa';
    return null;
  }

  function soloFlip({
    userJid,
    scopeKey,
    amount,
    choice = null,
    funConfig = {},
    now = Date.now(),
  }) {
    const min = numOr(funConfig.flipMin, 5);
    const max = numOr(funConfig.flipMax, 80);
    const cd = Math.max(0, Math.floor(numOr(funConfig.flipCooldownMs, 45_000)));
    const stake = Math.floor(Number(amount) || 0);
    const pick = parseCoinSide(choice);

    if (!pick) {
      return { ok: false, reason: 'missing-choice' };
    }

    if (stake < min || stake > max) {
      return { ok: false, reason: 'invalid-amount', min, max };
    }

    // amuleto: 65% de a moeda cair no lado escolhido
    let winChance = 0.5;
    let usedLucky = false;
    if (effectsRepository) {
      const lucky = effectsRepository.getEffect(userJid, scopeKey, 'flip_lucky', now);
      if (lucky && lucky.charges > 0) {
        winChance = Number(lucky.payload?.winChance) || 0.65;
        usedLucky = true;
      }
    }

    // debita stake com cooldown
    const lock = repository.applyGameCoinDelta({
      userJid,
      scopeKey,
      delta: -stake,
      game: 'flip',
      cooldownMs: cd,
      now,
      reason: 'flip-bet',
    });
    if (!lock.ok) {
      if (lock.reason === 'cooldown') {
        return { ok: false, reason: 'cooldown', retryIn: formatRetry(lock.retryInMs), retryInMs: lock.retryInMs };
      }
      if (lock.reason === 'insufficient-funds') {
        return { ok: false, reason: 'insufficient-funds', coins: lock.coins };
      }
      return lock;
    }

    if (usedLucky) {
      effectsRepository.consumeCharge(userJid, scopeKey, 'flip_lucky', now);
    }

    // 1) sorteia o resultado da moeda (50/50, ou enviesado pro lado escolhido se amuleto)
    // 2) só ganha se o resultado === escolha do jogador
    // NUNCA sortear "vitória" separado do lado da moeda.
    const landOnPick = random() < winChance;
    const resultSide = landOnPick ? pick : oppositeSide(pick);
    const win = resultSide === pick;

    if (win) {
      repository.addCoins({
        userJid,
        scopeKey,
        amount: stake * 2,
        now,
        reason: 'flip-win',
      });
    }

    const coins = repository.getUserStats(userJid, scopeKey)?.coins || 0;
    return {
      ok: true,
      win,
      pick,
      side: resultSide,
      stake,
      profit: win ? stake : -stake,
      coins,
      usedLucky,
    };
  }

  function doJob({ userJid, scopeKey, funConfig = {}, now = Date.now() }) {
    const min = numOr(funConfig.jobMin, 5);
    const max = numOr(funConfig.jobMax, 14);
    const cd = Math.max(0, Math.floor(numOr(funConfig.jobCooldownMs, 2 * 60 * 60_000)));
    const gain = rollInt(min, max, random);

    const result = repository.applyGameCoinDelta({
      userJid,
      scopeKey,
      delta: gain,
      game: 'job',
      cooldownMs: cd,
      now,
      reason: 'job',
    });
    if (!result.ok) {
      if (result.reason === 'cooldown') {
        return { ok: false, reason: 'cooldown', retryIn: formatRetry(result.retryInMs), retryInMs: result.retryInMs };
      }
      return result;
    }

    const jobs = [
      'entregou pizza no grupo (e ainda pediu gorjeta em coin)',
      'arregaçou nas tasks do bot como se fosse CLT emocional',
      'vendeu meme raro no mercado paralelo do chat',
      'fez freela de sticker e cobrou em moral',
      'organizou a bagunça do grupo… ou piorou com estilo',
      'passou o pano pro chefe imaginário e saiu pago',
      'tirou o atraso de três dailys com um café e fé',
    ];
    const flavor = jobs[Math.floor(random() * jobs.length)] || jobs[0];

    return {
      ok: true,
      gain,
      coins: result.coinsAfter,
      flavor,
    };
  }

  function doLucky({ userJid, scopeKey, funConfig = {}, now = Date.now() }) {
    const min = numOr(funConfig.luckyMin, 5);
    const max = numOr(funConfig.luckyMax, 40);
    const cd = Math.max(0, Math.floor(numOr(funConfig.luckyCooldownMs, 3 * 60 * 60_000)));
    // 40% chance de zero, 60% ganha
    const hit = random() < 0.6;
    const gain = hit ? rollInt(min, max, random) : 0;

    // sempre aplica cooldown mesmo com 0
    const result = repository.applyGameCoinDelta({
      userJid,
      scopeKey,
      delta: gain,
      game: 'lucky',
      cooldownMs: cd,
      now,
      reason: gain > 0 ? 'lucky-win' : 'lucky-miss',
    });
    if (!result.ok) {
      if (result.reason === 'cooldown') {
        return { ok: false, reason: 'cooldown', retryIn: formatRetry(result.retryInMs), retryInMs: result.retryInMs };
      }
      return result;
    }

    return {
      ok: true,
      gain,
      coins: result.coinsAfter,
      hit: gain > 0,
    };
  }

  function proposeBet({
    fromJid,
    toJid,
    scopeKey,
    amount,
    choice = null,
    funConfig = {},
    now = Date.now(),
  }) {
    const min = numOr(funConfig.betMin, 5);
    const max = numOr(funConfig.betMax, 150);
    const stake = Math.floor(Number(amount) || 0);
    const a = String(fromJid || '').trim();
    const b = String(toJid || '').trim();
    const s = String(scopeKey || '').trim();
    const pick = parseCoinSide(choice);

    if (!a || !b || a === b) return { ok: false, reason: 'invalid-target' };
    if (stake < min || stake > max) return { ok: false, reason: 'invalid-amount', min, max };
    if (!pick) return { ok: false, reason: 'missing-choice' };

    const aBal = repository.getUserStats(a, s)?.coins
      ?? repository.ensureUserRow(a, s, now).coins;
    const bBal =
      repository.getUserStats(b, s)?.coins
      ?? repository.ensureUserRow(b, s, now).coins;

    if (aBal < stake) return { ok: false, reason: 'insufficient-funds', coins: aBal };
    if (bBal < stake) return { ok: false, reason: 'target-insufficient', coins: bBal };

    const action = actionRepository.createAction({
      scopeKey: s,
      actionType: ACTION_TYPE.BET_COINFLIP,
      fromJid: a,
      toJid: b,
      payload: { amount: stake, choice: pick },
      ttlMs: BET_TTL_MS,
      now,
    });

    return {
      ok: true,
      action,
      amount: stake,
      choice: pick,
      expiresInMs: BET_TTL_MS,
    };
  }

  function acceptBet({ userJid, scopeKey, now = Date.now() }) {
    const u = String(userJid || '').trim();
    const s = String(scopeKey || '').trim();
    const pending = actionRepository.getLatestIncoming({
      scopeKey: s,
      toJid: u,
      actionType: ACTION_TYPE.BET_COINFLIP,
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
      // não deleta se falta saldo — deixa tentar de novo ou expirar
      return {
        ok: false,
        reason: lock.reason,
        aCoins: lock.aCoins,
        bCoins: lock.bCoins,
      };
    }

    actionRepository.deleteAction(pending.id);

    // Desafiante escolheu um lado; oponente fica com o outro
    const challengerPick = parseCoinSide(pending.payload?.choice) || 'cara';
    const resultSide = rollBool(random) ? 'cara' : 'coroa';
    const fromWins = resultSide === challengerPick;
    const winnerJid = fromWins ? pending.fromJid : u;
    const loserJid = fromWins ? u : pending.fromJid;
    const side = resultSide;
    const pot = lock.pot;

    repository.payoutBetWinner({
      scopeKey: s,
      winnerJid,
      pot,
      now,
    });

    // escudo de aposta: perdedor recupera metade da stake
    let shieldRefund = 0;
    if (effectsRepository) {
      const shield = effectsRepository.consumeCharge(loserJid, s, 'bet_shield', now);
      if (shield) {
        const ratio = Number(shield.payload?.refundRatio) || 0.5;
        shieldRefund = Math.floor(stake * ratio);
        if (shieldRefund > 0) {
          repository.addCoins({
            userJid: loserJid,
            scopeKey: s,
            amount: shieldRefund,
            now,
            reason: 'bet-shield',
          });
        }
      }
    }

    return {
      ok: true,
      reason: 'ok',
      fromJid: pending.fromJid,
      toJid: u,
      winnerJid,
      loserJid,
      side,
      stake,
      pot,
      shieldRefund,
      winnerCoins: repository.getUserStats(winnerJid, s)?.coins || 0,
      loserCoins: repository.getUserStats(loserJid, s)?.coins || 0,
    };
  }

  function declineBet({ userJid, scopeKey, now = Date.now() }) {
    const u = String(userJid || '').trim();
    const s = String(scopeKey || '').trim();
    const pending = actionRepository.getLatestIncoming({
      scopeKey: s,
      toJid: u,
      actionType: ACTION_TYPE.BET_COINFLIP,
      now,
    });
    if (!pending) return { ok: false, reason: 'no-bet' };
    actionRepository.deleteAction(pending.id);
    return {
      ok: true,
      reason: 'declined',
      fromJid: pending.fromJid,
      toJid: u,
      amount: Number(pending.payload?.amount) || 0,
    };
  }

  /**
   * Aceita a pendência mais recente (marry ou bet).
   */
  function peekIncoming(userJid, scopeKey, now = Date.now()) {
    return actionRepository.getLatestIncoming({
      scopeKey,
      toJid: userJid,
      now,
    });
  }

  return {
    parseCoinSide,
    soloFlip,
    doJob,
    doLucky,
    proposeBet,
    acceptBet,
    declineBet,
    peekIncoming,
    formatRetry,
  };
}
