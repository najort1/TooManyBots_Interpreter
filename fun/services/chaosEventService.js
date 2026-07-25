/**
 * Purga — evento diário de 10 minutos (referência ao filme Uma Noite de Crime).
 * Ativa 1x/dia em horário configurável.
 * Durante o evento: assalto livre, sem arma = 50%, saldo negativo limitado, heat desativado.
 */

function numOr(v, fb) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
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

  function opts(funConfig = {}) {
    return {
      enabled: funConfig.chaosEventEnabled !== false,
      hour: Math.max(0, Math.min(23, Math.floor(numOr(funConfig.chaosEventHour, 20)))),
      durationMs: Math.max(60_000, Math.floor(numOr(funConfig.chaosEventDurationMs, 10 * 60_000))),
      noWeaponSuccess: Math.min(0.75, Math.max(0.1, numOr(funConfig.chaosEventNoWeaponSuccess, 0.50))),
      weaponBaseChance: Math.min(0.85, Math.max(0.1, numOr(funConfig.chaosEventWeaponBaseChance, 0.60))),
      maxStealAmount: Math.max(1, Math.floor(numOr(funConfig.chaosEventMaxStealAmount, 100_000))),
      maxDebt: Math.max(0, Math.floor(numOr(funConfig.chaosEventMaxDebt, 10_000))),
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

  function recordLeaderboardEntry(scopeKey, attackerJid, victimJid, stolen) {
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
        ok: true,
        success: false,
        mode: 'crime_event',
        event: true,
        chance,
        weapon: wCol || null,
        stolen: 0,
        reason: 'failed',
        coins: repository.getUserStats(a, scopeKey)?.coins || 0,
      };
    }

    const taken = Math.min(desired, Math.max(0, tCoins));
    let debt = desired - taken;

    if (debt > 0) {
      const currentNegative = Math.abs(Math.min(0, tCoins - taken));
      const maxAdditionalDebt = Math.max(0, o.maxDebt - currentNegative);
      debt = Math.min(debt, maxAdditionalDebt);
    }

    if (taken > 0) {
      repository.addCoins({
        userJid: t,
        scopeKey,
        amount: -taken,
        now,
        reason: 'crime-victim',
      });
    }

    if (debt > 0) {
      repository.addCoinsAllowNegative({
        userJid: t,
        scopeKey,
        amount: -debt,
        now,
        reason: 'crime-debt',
      });
    }

    const totalStolen = taken + debt;
    repository.addCoins({
      userJid: a,
      scopeKey,
      amount: totalStolen,
      now,
      reason: 'crime-win',
    });

    recordLeaderboardEntry(scopeKey, a, t, totalStolen);

    return {
      ok: true,
      success: true,
      mode: 'crime_event',
      event: true,
      chance,
      weapon: wCol || null,
      stolen: totalStolen,
      stolenFromWallet: taken,
      stolenFromDebt: debt,
      targetCoins: tCoins,
      targetAfter: Number(repository.getUserStats(t, scopeKey)?.coins) || 0,
      coins: repository.getUserStats(a, scopeKey)?.coins || 0,
    };
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
      '🔥 Heat foi desativado — sem wanted',
      '💸 Saldo negativo permitido (limitado)',
      '',
      `\`/crime @alvo quantia\``,
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

  /** @type {Map<string, boolean>} */
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

  return {
    isEventActive,
    tryStartEvent,
    getTimeRemaining,
    doCrimeAssault,
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
