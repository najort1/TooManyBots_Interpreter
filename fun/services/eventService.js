/**
 * Eventos do Fun — só o bot inicia (surpresa + cooldown).
 * Só casino_happy (happy hour) — trégua falsa removida.
 */

function numOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function createEventService({
  eventRepository,
  random = Math.random,
} = {}) {
  if (!eventRepository) throw new Error('[fun/eventService] eventRepository required');

  function getHappyHourStatus(scopeKey, now = Date.now()) {
    const raw = eventRepository.get(scopeKey);
    if (raw.eventType !== 'casino_happy' || raw.endsAt <= now) {
      return { active: false, multiplier: 1, remainingMs: 0, endsAt: 0 };
    }
    return {
      active: true,
      eventType: 'casino_happy',
      multiplier: Number(raw.multiplier) || 1.12,
      remainingMs: Math.max(0, raw.endsAt - now),
      endsAt: raw.endsAt,
      startsAt: raw.startsAt,
    };
  }

  function getActiveEvent(scopeKey, now = Date.now()) {
    const happy = getHappyHourStatus(scopeKey, now);
    if (happy.active) {
      return {
        active: true,
        eventType: 'casino_happy',
        multiplier: happy.multiplier,
        endsAt: happy.endsAt,
        remainingMs: happy.remainingMs,
        label: 'HAPPY HOUR',
      };
    }
    return null;
  }

  function getStatus(scopeKey, now = Date.now()) {
    const active = getActiveEvent(scopeKey, now);
    const raw = eventRepository.get(scopeKey);
    if (active) {
      return {
        active: true,
        eventType: active.eventType,
        multiplier: active.multiplier,
        endsAt: active.endsAt,
        remainingMs: active.remainingMs,
        lastSpawnAt: raw.lastSpawnAt,
        label: active.label,
      };
    }
    return {
      active: false,
      eventType: 'none',
      multiplier: 1,
      endsAt: 0,
      remainingMs: 0,
      lastSpawnAt: raw.lastSpawnAt,
      label: null,
    };
  }

  function cooldownRemaining(scopeKey, funConfig = {}, now = Date.now()) {
    const cooldown = Math.max(0, Math.floor(numOr(funConfig.eventCooldownMs, 6 * 60 * 60_000)));
    const current = eventRepository.get(scopeKey);
    if (!current.lastSpawnAt || cooldown <= 0) return 0;
    const left = cooldown - (now - current.lastSpawnAt);
    return left > 0 ? left : 0;
  }

  function startHappyHour({
    scopeKey,
    funConfig = {},
    now = Date.now(),
    force = false,
  }) {
    const duration = Math.max(
      5 * 60_000,
      Math.floor(numOr(funConfig.happyHourDurationMs, 45 * 60_000))
    );
    const mult = Number(funConfig.happyHourPayoutMult) || 1.12;

    if (!force) {
      const cd = cooldownRemaining(scopeKey, funConfig, now);
      if (cd > 0) return { ok: false, reason: 'cooldown', retryInMs: cd };
      if (getActiveEvent(scopeKey, now)) {
        return { ok: false, reason: 'already-active', status: getStatus(scopeKey, now) };
      }
    }

    const event = eventRepository.upsert(scopeKey, {
      eventType: 'casino_happy',
      multiplier: mult,
      startsAt: now,
      endsAt: now + duration,
      lastSpawnAt: now,
      payload: { label: 'HAPPY HOUR' },
    });

    return {
      ok: true,
      eventType: 'casino_happy',
      event,
      durationMs: duration,
      multiplier: mult,
      label: 'HAPPY HOUR',
    };
  }

  /**
   * Sorteio automático (só bot).
   * - Mensagem de usuário: chance baixa (eventAutoSpawnChance).
   * - Relógio do mundo (tick=true): chance maior (eventTickChance) — autonomia.
   * - happyOnly: só casino_happy (ex.: grupo com world events off ainda anuncia HH).
   * @returns {{ ok: true, eventType, ... } | { ok: false, reason }}
   */
  function tryAutoSpawn({
    scopeKey,
    funConfig = {},
    now = Date.now(),
    forceRoll = false,
    tick = false,
    happyOnly = false,
  } = {}) {
    if (funConfig.eventAutoSpawn === false) {
      return { ok: false, reason: 'disabled' };
    }

    if (getActiveEvent(scopeKey, now)) {
      return { ok: false, reason: 'already-active' };
    }

    const cd = cooldownRemaining(scopeKey, funConfig, now);
    if (cd > 0) {
      return { ok: false, reason: 'cooldown', retryInMs: cd };
    }

    const chance = tick
      ? Math.min(1, Math.max(0, Number(funConfig.eventTickChance) ?? 0.12))
      : Math.min(1, Math.max(0, Number(funConfig.eventAutoSpawnChance) ?? 0.028));
    if (!forceRoll && random() > chance) {
      return { ok: false, reason: 'no-roll' };
    }

    return startHappyHour({ scopeKey, funConfig, now, force: true });
  }

  function formatAnnouncement(spawned) {
    if (!spawned?.ok) return '';
    const minutes = Math.max(1, Math.round((spawned.durationMs || 0) / 60000));
    return [
      '🍸 *HAPPY HOUR — CASSINO*',
      `O bot abriu a mesa por *${minutes} min*.`,
      `Payouts de roleta/slot/crash/bj em *x${spawned.multiplier}*.`,
      '_Surpresa do cassino — aproveitem._',
    ].join('\n');
  }

  return {
    getStatus,
    getActiveEvent,
    getHappyHourStatus,
    startHappyHour,
    tryAutoSpawn,
    cooldownRemaining,
    formatAnnouncement,
  };
}
