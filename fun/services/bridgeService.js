/**
 * Ponte Social + índice de panelinha.
 */

import { getWeekKey } from '../db/funSocialRepository.js';

export function createBridgeService({
  socialRepository,
  factionRepository,
  effectsRepository = null,
} = {}) {
  if (!socialRepository) throw new Error('[fun/bridgeService] socialRepository required');
  if (!factionRepository) throw new Error('[fun/bridgeService] factionRepository required');

  function recordInteraction({ scopeKey, fromJid, toJid, kind = 'interact', now = Date.now() }) {
    return socialRepository.recordEdge({
      scopeKey,
      fromJid,
      toJid,
      kind,
      now,
    });
  }

  function getFactionMemberSet(factionId) {
    return new Set(
      factionRepository.listMembers(factionId).map(m => m.userJid)
    );
  }

  /**
   * @returns {{ score: number, internal: number, external: number, total: number, weekKey: string, debuff: boolean }}
   */
  function getFactionBridge(scopeKey, factionId, funConfig = {}, weekKey = getWeekKey()) {
    const members = getFactionMemberSet(factionId);
    if (members.size === 0) {
      return { score: 0, internal: 0, external: 0, total: 0, weekKey, debuff: false };
    }

    const edges = socialRepository.listEdgesForWeek(scopeKey, weekKey);
    let internal = 0;
    let external = 0;

    for (const e of edges) {
      const fromIn = members.has(e.fromJid);
      const toIn = members.has(e.toJid);
      if (!fromIn && !toIn) continue;
      if (fromIn && toIn) internal += e.count;
      else if (fromIn || toIn) external += e.count;
    }

    const total = internal + external;
    const minActions = Math.max(1, Math.floor(Number(funConfig.bridgeMinActions) || 10));
    const score = total > 0 ? external / total : 0.5;
    const threshold = Number(funConfig.bridgeDebuffThreshold) ?? 0.25;
    const debuff = total >= minActions && score < threshold;

    return {
      score,
      internal,
      external,
      total,
      weekKey,
      debuff,
      ready: total >= minActions,
    };
  }

  function listPanelinhaReport(scopeKey, funConfig = {}, weekKey = getWeekKey()) {
    const factions = factionRepository.listByScope(scopeKey);
    const rows = factions.map(f => ({
      faction: f,
      bridge: getFactionBridge(scopeKey, f.id, funConfig, weekKey),
      memberCount: factionRepository.countMembers(f.id),
    }));

    // pior ponte primeiro (mais panelinha)
    rows.sort((a, b) => {
      if (a.bridge.ready !== b.bridge.ready) return a.bridge.ready ? -1 : 1;
      return a.bridge.score - b.bridge.score;
    });

    return { weekKey, rows };
  }

  /**
   * Multiplicador de XP de daily por panelinha (debuff se ponte baixa).
   */
  function getDailyXpMultiplier(scopeKey, userJid, funConfig = {}, now = Date.now()) {
    const uf = factionRepository.getUserFaction(scopeKey, userJid);
    if (!uf) return { mult: 1, debuff: false };
    const bridge = getFactionBridge(scopeKey, uf.faction.id, funConfig, getWeekKey(now));
    if (!bridge.debuff) return { mult: 1, debuff: false, bridge };
    const mult = Number(funConfig.bridgeDebuffXpMult) || 0.9;
    return { mult, debuff: true, bridge };
  }

  /**
   * Aplica/remove effect debuff isolado para membros (leve).
   */
  function syncDebuffEffects(scopeKey, funConfig = {}, now = Date.now()) {
    if (!effectsRepository) return;
    const factions = factionRepository.listByScope(scopeKey);
    for (const f of factions) {
      const bridge = getFactionBridge(scopeKey, f.id, funConfig, getWeekKey(now));
      const members = factionRepository.listMembers(f.id);
      for (const m of members) {
        if (bridge.debuff) {
          effectsRepository.setTimedEffect({
            userJid: m.userJid,
            scopeKey,
            effectKey: 'panelinha_debuff',
            durationMs: 24 * 60 * 60_000,
            payload: { xpMult: Number(funConfig.bridgeDebuffXpMult) || 0.9 },
            now,
          });
        }
      }
    }
  }

  return {
    recordInteraction,
    getFactionBridge,
    listPanelinhaReport,
    getDailyXpMultiplier,
    syncDebuffEffects,
    getWeekKey,
  };
}
