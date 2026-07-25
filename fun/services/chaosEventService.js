/**
 * Evento "10 Minutos de Crime" — referência ao filme Uma Noite de Crime.
 * Ativa 1x/dia por 10 minutos em horário configurável.
 * Durante o evento: assalto livre, sem arma = 50%, saldo negativo, heat desativado.
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

  function opts(funConfig = {}) {
    return {
      enabled: funConfig.chaosEventEnabled !== false,
      hour: Math.max(0, Math.min(23, Math.floor(numOr(funConfig.chaosEventHour, 20)))),
      durationMs: Math.max(60_000, Math.floor(numOr(funConfig.chaosEventDurationMs, 10 * 60_000))),
      noWeaponSuccess: Math.min(0.75, Math.max(0.1, numOr(funConfig.chaosEventNoWeaponSuccess, 0.50))),
      weaponBaseChance: Math.min(0.85, Math.max(0.1, numOr(funConfig.chaosEventWeaponBaseChance, 0.60))),
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
      payload: { label: '10 MINUTOS DE CRIME' },
    });

    return {
      ok: true,
      eventType: 'crime_chaos',
      event,
      durationMs: duration,
      endsAt: now + duration,
      remainingMs: duration,
      label: '10 MINUTOS DE CRIME',
    };
  }

  /**
   * Assalto durante o evento "10 Minutos de Crime".
   * - Jogador escolhe quanto quer roubar (amount)
   * - Sem arma: 50% de sucesso
   * - Com arma: chance base maior, ajustada pelo poder da arma
   * - Alvo pode ficar com saldo negativo
   * - Heat não é alterado
   */
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
    const desired = Math.max(1, Math.floor(Number(amount) || 1));
    if (!a || !t || a === t) return { ok: false, reason: 'invalid-target' };

    const event = isEventActive(scopeKey, now);
    if (!event) return { ok: false, reason: 'event-inactive' };

    const o = opts(funConfig);

    const ms = typeof getMarketService === 'function' ? getMarketService() : null;
    const weapon = ms?.findBestWeapon ? ms.findBestWeapon(a, scopeKey) : null;
    const hasWeapon = Boolean(weapon);
    const wCol = weapon?.collectible;

    const aStats = repository.getUserStats(a, scopeKey) || repository.ensureUserRow(a, scopeKey, now);
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

    const actualSteal = Math.min(desired, desired);

    const taken = Math.min(actualSteal, Math.max(0, tCoins));
    const debt = actualSteal - taken;

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
      '🔪 *10 MINUTOS DE CRIME*',
      '',
      'As regras normais foram suspensas.',
      'Durante *10 minutos*, vale tudo:',
      `• Assalte usando \`/crime @alvo quantia\``,
      '• Sem arma: 50% de chance',
      '• Com arma: mais chances, mais poder',
      '• Saldo negativo permitido — vá até o fundo',
      '• Polícia (heat) desligado — sem wanted',
      '',
      `⏱ *${minutes} minutos de caos. Aproveite.*`,
      '_— Referência ao filme "Uma Noite de Crime"_',
    ].join('\n');
  }

  function formatEndAnnouncement() {
    return [
      '🔪 *FIM DO EVENTO — 10 MINUTOS DE CRIME*',
      '',
      'O caos acabou. As regras voltaram ao normal.',
      '_A polícia está de volta. Comportem-se._',
    ].join('\n');
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

  return {
    isEventActive,
    tryStartEvent,
    doCrimeAssault,
    formatStartAnnouncement,
    formatEndAnnouncement,
    isHeatDisabled,
    cooldownRemaining,
  };
}
