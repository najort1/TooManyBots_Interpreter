/**
 * Hooks pós-ação: ponte, missão, bônus de evento.
 */

export function createSocialHooks({
  bridgeService,
  missionService,
  eventService,
  factionService,
  repository,
} = {}) {
  function onSocialPair({
    scopeKey,
    fromJid,
    toJid,
    kind,
    now = Date.now(),
    funConfig = {},
  }) {
    if (!fromJid || !toJid || fromJid === toJid) {
      return { recorded: false };
    }

    if (bridgeService) {
      bridgeService.recordInteraction({
        scopeKey,
        fromJid,
        toJid,
        kind,
        now,
      });
    }

    let mission = null;
    if (missionService) {
      mission = missionService.onActivity({
        scopeKey,
        userJid: fromJid,
        otherJid: toJid,
        kind: kind === 'bet' ? 'bet' : kind === 'ship' ? 'ship' : kind,
        now,
      });
      // also mark reverse membership activity for bet
      if (kind === 'bet') {
        missionService.onActivity({
          scopeKey,
          userJid: toJid,
          otherJid: fromJid,
          kind: 'bet',
          now,
        });
      }
    }

    let eventBonus = null;
    if (eventService && factionService && repository) {
      const cross = eventService.getCrossMultiplier({
        scopeKey,
        fromJid,
        toJid,
        factionService,
        now,
      });
      if (cross.cross && cross.mult > 1) {
        const bonus = Math.max(1, Math.floor(8 * cross.mult));
        repository.addCoins({
          userJid: fromJid,
          scopeKey,
          amount: bonus,
          now,
          reason: 'event-cross',
        });
        repository.addCoins({
          userJid: toJid,
          scopeKey,
          amount: bonus,
          now,
          reason: 'event-cross',
        });
        repository.awardXp({
          userJid: fromJid,
          scopeKey,
          amount: Math.floor(15 * cross.mult),
          now,
          cooldownMs: 0,
        });
        repository.awardXp({
          userJid: toJid,
          scopeKey,
          amount: Math.floor(15 * cross.mult),
          now,
          cooldownMs: 0,
        });
        eventBonus = { bonusCoins: bonus, mult: cross.mult };
      }
    }

    return {
      recorded: true,
      mission,
      eventBonus,
    };
  }

  function onDaily({ scopeKey, userJid, now = Date.now() }) {
    if (!missionService) return null;
    return missionService.onActivity({
      scopeKey,
      userJid,
      kind: 'daily',
      now,
    });
  }

  return {
    onSocialPair,
    onDaily,
  };
}
