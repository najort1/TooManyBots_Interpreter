/**
 * Hooks pós-ação: ponte, missão, bônus de evento.
 */

export function createSocialHooks({
  bridgeService,
  missionService,
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

    return {
      recorded: true,
      mission,
      eventBonus: null,
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
