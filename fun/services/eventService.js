/**
 * Evento relâmpago cross-facção.
 */

export function createEventService({ eventRepository } = {}) {
  if (!eventRepository) throw new Error('[fun/eventService] eventRepository required');

  function getStatus(scopeKey, now = Date.now()) {
    const active = eventRepository.getActiveCrossEvent(scopeKey, now);
    const raw = eventRepository.get(scopeKey);
    if (active) {
      return {
        active: true,
        eventType: active.eventType,
        multiplier: active.multiplier,
        endsAt: active.endsAt,
        remainingMs: Math.max(0, active.endsAt - now),
        lastSpawnAt: raw.lastSpawnAt,
      };
    }
    return {
      active: false,
      eventType: 'none',
      multiplier: 1,
      endsAt: 0,
      remainingMs: 0,
      lastSpawnAt: raw.lastSpawnAt,
    };
  }

  function startCrossFaction({
    scopeKey,
    funConfig = {},
    now = Date.now(),
    force = false,
  }) {
    const duration = Math.max(5 * 60_000, Math.floor(Number(funConfig.eventDurationMs) || 90 * 60_000));
    const cooldown = Math.max(0, Math.floor(Number(funConfig.eventCooldownMs) || 6 * 60 * 60_000));
    const mult = Number(funConfig.eventCrossMultiplier) || 2;
    const current = eventRepository.get(scopeKey);

    if (!force && current.lastSpawnAt > 0 && now - current.lastSpawnAt < cooldown) {
      return {
        ok: false,
        reason: 'cooldown',
        retryInMs: cooldown - (now - current.lastSpawnAt),
      };
    }

    if (!force && eventRepository.getActiveCrossEvent(scopeKey, now)) {
      return { ok: false, reason: 'already-active', status: getStatus(scopeKey, now) };
    }

    const event = eventRepository.upsert(scopeKey, {
      eventType: 'cross_faction',
      multiplier: mult,
      startsAt: now,
      endsAt: now + duration,
      lastSpawnAt: now,
      payload: { label: 'TRÉGUA FALSA' },
    });

    return {
      ok: true,
      event,
      durationMs: duration,
      multiplier: mult,
    };
  }

  /**
   * Multiplicador se interação for entre facções diferentes durante evento.
   */
  function getCrossMultiplier({
    scopeKey,
    fromJid,
    toJid,
    factionService,
    now = Date.now(),
  }) {
    const active = eventRepository.getActiveCrossEvent(scopeKey, now);
    if (!active) return { mult: 1, active: false };

    const a = factionService?.getUserFaction?.(scopeKey, fromJid);
    const b = factionService?.getUserFaction?.(scopeKey, toJid);
    if (!a?.faction || !b?.faction) return { mult: 1, active: true, cross: false };
    if (a.faction.id === b.faction.id) return { mult: 1, active: true, cross: false };

    return {
      mult: Number(active.multiplier) || 2,
      active: true,
      cross: true,
    };
  }

  return {
    getStatus,
    startCrossFaction,
    getCrossMultiplier,
  };
}
