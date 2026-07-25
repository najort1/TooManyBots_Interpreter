/**
 * Purga — evento diário de 10 minutos (referência ao filme Uma Noite de Crime).
 * Ativa 1x/dia em horário configurável.
 * Durante o evento: assalto livre, sem arma = 50%, saldo negativo limitado, heat desativado.
 * Defesa: alvo resolve conta de matemática em 4s para bloquear o assalto.
 */

function numOr(v, fb) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function generateMathChallenge(random) {
  const terms = 2;
  const nums = [];
  const ops = [];
  let expression = '';
  let total = 0;

  for (let i = 0; i < terms; i++) {
    const n = 1 + Math.floor(random() * 19);
    nums.push(n);
  }

  for (let i = 0; i < terms - 1; i++) {
    ops.push(random() < 0.5 ? '+' : '-');
  }

  total = nums[0];
  expression = String(nums[0]);
  for (let i = 0; i < ops.length; i++) {
    expression += ` ${ops[i]} ${nums[i + 1]}`;
    if (ops[i] === '+') {
      total += nums[i + 1];
    } else {
      total -= nums[i + 1];
    }
  }

  if (total < 0) {
    return generateMathChallenge(random);
  }

  return { expression, answer: total };
}

export function createChaosEventService({
  repository,
  eventRepository,
  getMarketService = null,
  random = Math.random,
} = {}) {
  if (!repository) throw new Error('[fun/chaosEventService] repository required');
  if (!eventRepository) throw new Error('[fun/chaosEventService] eventRepository required');

  /** @type {Map<string, { attackers: Map<string,number>, victims: Map<string,number>, startAt: number }>} */
  const leaderboards = new Map();

  /** @type {Map<string, Map<string, { attackerJid: string, amount: number, taken: number, debt: number, expression: string, answer: number, expiresAt: number, now: number }>>} */
  const challenges = new Map();

  function opts(funConfig = {}) {
    return {
      enabled: funConfig.chaosEventEnabled !== false,
      hour: Math.max(0, Math.min(23, Math.floor(numOr(funConfig.chaosEventHour, 20)))),
      durationMs: Math.max(60_000, Math.floor(numOr(funConfig.chaosEventDurationMs, 10 * 60_000))),
      noWeaponSuccess: Math.min(0.75, Math.max(0.1, numOr(funConfig.chaosEventNoWeaponSuccess, 0.50))),
      weaponBaseChance: Math.min(0.85, Math.max(0.1, numOr(funConfig.chaosEventWeaponBaseChance, 0.60))),
      maxStealAmount: Math.max(1, Math.floor(numOr(funConfig.chaosEventMaxStealAmount, 100))),
      maxDebt: Math.max(0, Math.floor(numOr(funConfig.chaosEventMaxDebt, 100))),
      defenseEnabled: funConfig.chaosEventDefenseEnabled !== false,
      defenseTimeoutMs: Math.max(1000, Math.floor(numOr(funConfig.chaosEventDefenseTimeoutMs, 4000))),
    };
  }

  function isEventActive(scopeKey, now = Date.now()) {
    const raw = eventRepository.get(scopeKey);
    if (raw.eventType !== 'crime_chaos') return false;
    if (raw.endsAt <= now) return false;
    return {
      active: true,
      eventType: 'crime_chaos',
      startsAt: raw.startsAt,
      endsAt: raw.endsAt,
      remainingMs: Math.max(0, raw.endsAt - now),
    };
  }

  function tryStartEvent(scopeKey, funConfig = {}, now = Date.now()) {
    const o = opts(funConfig);
    if (!o.enabled) return { ok: false, reason: 'disabled' };

    const already = isEventActive(scopeKey, now);
    if (already) return { ok: false, reason: 'already-active', status: already };

    const hour = numOr(funConfig.chaosEventHour, 20);
    const currentHour = new Date(now).getHours();
    if (currentHour !== hour) return { ok: false, reason: 'wrong-hour' };

    const raw = eventRepository.get(scopeKey);
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = todayStart.getTime() + 24 * 60 * 60_000;

    if (raw.lastSpawnAt >= todayStart.getTime() && raw.lastSpawnAt < todayEnd) {
      return { ok: false, reason: 'already-today' };
    }

    const duration = o.durationMs;
    const event = eventRepository.upsert(scopeKey, {
      eventType: 'crime_chaos',
      multiplier: 1,
      startsAt: now,
      endsAt: now + duration,
      lastSpawnAt: now,
      payload: { label: 'PURGA' },
    });

    leaderboards.set(scopeKey, {
      attackers: new Map(),
      victims: new Map(),
      startAt: now,
    });

    return {
      ok: true,
      eventType: 'crime_chaos',
      event,
      durationMs: duration,
      endsAt: now + duration,
      remainingMs: duration,
      label: 'PURGA',
    };
  }

  function getTimeRemaining(scopeKey, now = Date.now()) {
    const event = isEventActive(scopeKey, now);
    if (!event) return 0;
    return event.remainingMs;
  }

  function recordLeaderboard(scopeKey, attackerJid, victimJid, stolen) {
    let lb = leaderboards.get(scopeKey);
    if (!lb) {
      lb = { attackers: new Map(), victims: new Map(), startAt: Date.now() };
      leaderboards.set(scopeKey, lb);
    }
    const atk = String(attackerJid || '');
    const vic = String(victimJid || '');
    lb.attackers.set(atk, (lb.attackers.get(atk) || 0) + stolen);
    lb.victims.set(vic, (lb.victims.get(vic) || 0) + stolen);
  }

  function getEventLeaderboard(scopeKey) {
    const lb = leaderboards.get(scopeKey);
    if (!lb) return { attackers: [], victims: [] };
    const attackers = [...lb.attackers.entries()]
      .map(([jid, total]) => ({ jid, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
    const victims = [...lb.victims.entries()]
      .map(([jid, total]) => ({ jid, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 3);
    return { attackers, victims };
  }

  function cleanupLeaderboard(scopeKey) {
    leaderboards.delete(scopeKey);
  }

  function executeAssaultTransfer(scopeKey, attackerJid, targetJid, taken, debt, desired, tCoins, now) {
    const finalTaken = Math.min(desired, Math.max(0, tCoins));
    let finalDebt = desired - finalTaken;

    if (finalDebt > 0) {
      const currentNegative = Math.abs(Math.min(0, tCoins - finalTaken));
      const maxAdditionalDebt = Math.max(0, opts({}).maxDebt - currentNegative);
      finalDebt = Math.min(finalDebt, maxAdditionalDebt);
    }

    if (finalTaken > 0) {
      repository.addCoins({
        userJid: targetJid, scopeKey, amount: -finalTaken, now, reason: 'crime-victim',
      });
    }

    if (finalDebt > 0) {
      repository.addCoinsAllowNegative({
        userJid: targetJid, scopeKey, amount: -finalDebt, now, reason: 'crime-debt',
      });
    }

    const totalStolen = finalTaken + finalDebt;
    repository.addCoins({
      userJid: attackerJid, scopeKey, amount: totalStolen, now, reason: 'crime-win',
    });

    recordLeaderboard(scopeKey, attackerJid, targetJid, totalStolen);

    return { stolen: totalStolen, stolenFromWallet: finalTaken, stolenFromDebt: finalDebt };
  }

  function doCrimeAssault({
    attackerJid,
    targetJid,
    scopeKey,
    amount,
    funConfig = {},
    now = Date.now(),
  }) {
    const a = String(attackerJid || '');
    const t = String(targetJid || '');
    if (!a || !t || a === t) return { ok: false, reason: 'invalid-target' };

    const event = isEventActive(scopeKey, now);
    if (!event) return { ok: false, reason: 'event-inactive' };

    const o = opts(funConfig);

    const requested = Math.max(1, Math.floor(Number(amount) || 1));
    const desired = Math.min(requested, o.maxStealAmount);

    const ms = typeof getMarketService === 'function' ? getMarketService() : null;
    const weapon = ms?.findBestWeapon ? ms.findBestWeapon(a, scopeKey) : null;
    const hasWeapon = Boolean(weapon);
    const wCol = weapon?.collectible;

    const tStats = repository.getUserStats(t, scopeKey) || repository.ensureUserRow(t, scopeKey, now);
    const tCoins = Number(tStats.coins) || 0;
    const aStats = repository.getUserStats(a, scopeKey) || repository.ensureUserRow(a, scopeKey, now);

    let success = false;
    let chance = 0;

    if (hasWeapon && wCol) {
      if (wCol.requires === 'municao') {
        if (!ms?.consumeOneConsumable(a, scopeKey, 'municao')) {
          return { ok: false, reason: 'no-ammo' };
        }
      }
      const power = Number(wCol.assaultPower) || 0;
      chance = Math.min(0.85, Math.max(0.12, o.weaponBaseChance + power / 200));
      if (ms?.consumeUse) ms.consumeUse(weapon, now);
      const roll = random();
      success = roll < chance;
    } else {
      chance = o.noWeaponSuccess;
      const roll = random();
      success = roll < chance;
    }

    if (!success) {
      return {
        ok: true, success: false, mode: 'crime_event',
        event: true, chance, weapon: wCol || null,
        stolen: 0, reason: 'failed',
        coins: repository.getUserStats(a, scopeKey)?.coins || 0,
      };
    }

    if (!o.defenseEnabled) {
      const transfer = executeAssaultTransfer(scopeKey, a, t, 0, 0, desired, tCoins, now);
      return {
        ok: true, success: true, mode: 'crime_event',
        event: true, chance, weapon: wCol || null,
        stolen: transfer.stolen, stolenFromWallet: transfer.stolenFromWallet,
        stolenFromDebt: transfer.stolenFromDebt, targetCoins: tCoins,
        targetAfter: Number(repository.getUserStats(t, scopeKey)?.coins) || 0,
        coins: repository.getUserStats(a, scopeKey)?.coins || 0,
      };
    }

    const challenge = generateMathChallenge(random);
    const challengeData = {
      attackerJid: a,
      amount: desired,
      tCoins,
      expression: challenge.expression,
      answer: challenge.answer,
      expiresAt: now + o.defenseTimeoutMs,
      now,
    };

    let scopeChallenges = challenges.get(scopeKey);
    if (!scopeChallenges) {
      scopeChallenges = new Map();
      challenges.set(scopeKey, scopeChallenges);
    }
    scopeChallenges.set(t, challengeData);

    return {
      ok: true, success: 'pending', mode: 'crime_event',
      event: true, chance, weapon: wCol || null,
      stolen: 0, reason: 'defense',
      challenge: {
        targetJid: t,
        attackerJid: a,
        expression: challenge.expression,
        answer: challenge.answer,
        expiresAt: challengeData.expiresAt,
      },
      coins: repository.getUserStats(a, scopeKey)?.coins || 0,
    };
  }

  function getPendingChallenge(scopeKey, targetJid, now = Date.now()) {
    const scopeChallenges = challenges.get(String(scopeKey || ''));
    if (!scopeChallenges) return null;
    const c = scopeChallenges.get(String(targetJid || ''));
    if (!c) return null;
    if (now > c.expiresAt) {
      scopeChallenges.delete(String(targetJid || ''));
      if (scopeChallenges.size === 0) challenges.delete(String(scopeKey || ''));
      return { expired: true, ...c };
    }
    return { ...c };
  }

  function resolveChallenge({
    scopeKey,
    targetJid,
    answer,
    now = Date.now(),
  }) {
    const t = String(targetJid || '');
    const s = String(scopeKey || '');
    const scopeChallenges = challenges.get(s);
    if (!scopeChallenges) return { ok: false, reason: 'no-challenge' };

    const c = scopeChallenges.get(t);
    if (!c) return { ok: false, reason: 'no-challenge' };
    scopeChallenges.delete(t);
    if (scopeChallenges.size === 0) challenges.delete(s);

    if (now > c.expiresAt) {
      const transfer = executeAssaultTransfer(s, c.attackerJid, t, 0, 0, c.amount, c.tCoins, now);
      return {
        ok: true, defended: false, timedOut: true,
        attackerJid: c.attackerJid, expression: c.expression, correctAnswer: c.answer,
        stolen: transfer.stolen,
        stolenFromWallet: transfer.stolenFromWallet,
        stolenFromDebt: transfer.stolenFromDebt,
      };
    }

    const parsed = Math.floor(Number(answer));
    if (!Number.isFinite(parsed)) {
      const transfer = executeAssaultTransfer(s, c.attackerJid, t, 0, 0, c.amount, c.tCoins, now);
      return {
        ok: true, defended: false, invalid: true,
        attackerJid: c.attackerJid, expression: c.expression, correctAnswer: c.answer,
        stolen: transfer.stolen,
        stolenFromWallet: transfer.stolenFromWallet,
        stolenFromDebt: transfer.stolenFromDebt,
      };
    }

    if (parsed === c.answer) {
      return {
        ok: true, defended: true,
        attackerJid: c.attackerJid, expression: c.expression, correctAnswer: c.answer,
        stolen: 0,
      };
    }

    const transfer = executeAssaultTransfer(s, c.attackerJid, t, 0, 0, c.amount, c.tCoins, now);
    return {
      ok: true, defended: false,
      attackerJid: c.attackerJid, expression: c.expression, correctAnswer: c.answer,
      givenAnswer: parsed,
      stolen: transfer.stolen,
      stolenFromWallet: transfer.stolenFromWallet,
      stolenFromDebt: transfer.stolenFromDebt,
    };
  }

  function processExpiredChallenges(scopeKey, now = Date.now()) {
    const scopeChallenges = challenges.get(String(scopeKey || ''));
    if (!scopeChallenges) return [];
    const results = [];
    for (const [targetJid, c] of scopeChallenges) {
      if (now > c.expiresAt) {
        const t = String(targetJid);
        scopeChallenges.delete(targetJid);
        const transfer = executeAssaultTransfer(
          String(scopeKey), c.attackerJid, t, 0, 0, c.amount, c.tCoins, now
        );
        results.push({
          targetJid: t, attackerJid: c.attackerJid,
          expression: c.expression, correctAnswer: c.answer,
          stolen: transfer.stolen, timedOut: true,
        });
      }
    }
    if (scopeChallenges.size === 0) challenges.delete(String(scopeKey || ''));
    return results;
  }

  function formatStartAnnouncement(result) {
    if (!result?.ok) return '';
    const minutes = Math.max(1, Math.round((result.durationMs || 0) / 60000));
    return [
      '🚨🚨 *PURGA — ESTADO DE EMERGÊNCIA*',
      '',
      'A cidade entrou em colapso.',
      'A polícia abandonou as ruas.',
      '',
      `Durante *${minutes} minutos*:`,
      '💰 Qualquer valor pode ser roubado',
      '🔫 Assaltos ficaram mais fáceis',
      '🧮 Defenda-se resolvendo a conta em 4s',
      '🔥 Heat foi desativado — sem wanted',
      '💸 Saldo negativo permitido (limitado)',
      '',
      `\`/crime @alvo quantia\``,
      '🧮 Se for atacado, DIGITE O NÚMERO da conta para se defender',
      '',
      'Boa sorte...',
    ].join('\n');
  }

  function formatWarningAnnouncement(remainingMs) {
    const min = Math.ceil(remainingMs / 60000);
    if (min <= 0) return '';
    return [
      '⚠️ *PURGA — AVISO*',
      '',
      `Faltam apenas *${min} minuto${min !== 1 ? 's' : ''}* de caos.`,
      'Preparem-se para o retorno da lei.',
    ].join('\n');
  }

  function formatEndAnnouncement(scopeKey, getContactDisplayName) {
    const lb = getEventLeaderboard(scopeKey);
    const lines = [
      '🚓🚓 *FIM DA PURGA*',
      '',
      'As forças policiais retomaram o controle da cidade.',
      'O evento terminou. O heat está de volta.',
    ];

    if (lb.attackers.length > 0) {
      lines.push('', '🏆 *Maiores criminosos:*');
      const medals = ['🥇', '🥈', '🥉'];
      lb.attackers.forEach((entry, i) => {
        const name = nameOr(entry.jid, getContactDisplayName);
        lines.push(`${medals[i] || '▪'} ${name} — *${entry.total}* roubados`);
      });
    }

    if (lb.victims.length > 0) {
      lines.push('', '😭 *Maiores vítimas:*');
      lb.victims.slice(0, 1).forEach((entry) => {
        const name = nameOr(entry.jid, getContactDisplayName);
        lines.push(`😭 ${name} perdeu *${entry.total}*`);
      });
    }

    lines.push('', '_Até a próxima Purga._');
    cleanupLeaderboard(scopeKey);
    return lines.join('\n');
  }

  function nameOr(jid, getName) {
    try {
      return typeof getName === 'function' ? getName(jid) : jid.split('@')[0];
    } catch {
      return jid.split('@')[0];
    }
  }

  function isHeatDisabled(scopeKey, now = Date.now()) {
    return Boolean(isEventActive(scopeKey, now));
  }

  function cooldownRemaining(scopeKey, now = Date.now()) {
    const raw = eventRepository.get(scopeKey);
    if (raw.eventType !== 'crime_chaos') return 0;
    if (raw.endsAt <= now) return 0;
    return raw.endsAt - now;
  }

  const warningSent = new Map();

  function shouldSendWarning(scopeKey, now = Date.now()) {
    const event = isEventActive(scopeKey, now);
    if (!event) return false;
    const remaining = event.remainingMs;
    const warningWindow = 140_000;
    if (remaining > warningWindow || remaining < 10_000) return false;
    const key = `${scopeKey}:2min`;
    if (warningSent.get(key)) return false;
    warningSent.set(key, true);
    return true;
  }

  function resetWarning(scopeKey) {
    warningSent.delete(`${scopeKey}:2min`);
  }

  function checkMessageForChallenge(scopeKey, senderJid, text, now = Date.now()) {
    const t = String(senderJid || '');
    const s = String(scopeKey || '');
    if (!t || !s) return { matched: false };

    const pending = getPendingChallenge(s, t, now);
    if (!pending || pending.expired) return { matched: false };

    const parsed = Math.floor(Number(String(text || '').trim()));
    if (!Number.isFinite(parsed)) return { matched: false };

    if (parsed === pending.answer) {
      const result = resolveChallenge({ scopeKey: s, targetJid: t, answer: parsed, now });
      return { matched: true, result };
    }

    return { matched: false };
  }

  return {
    isEventActive,
    tryStartEvent,
    getTimeRemaining,
    doCrimeAssault,
    getPendingChallenge,
    resolveChallenge,
    processExpiredChallenges,
    checkMessageForChallenge,
    formatStartAnnouncement,
    formatWarningAnnouncement,
    formatEndAnnouncement,
    getEventLeaderboard,
    isHeatDisabled,
    cooldownRemaining,
    shouldSendWarning,
    resetWarning,
  };
}
