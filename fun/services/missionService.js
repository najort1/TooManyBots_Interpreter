/**
 * Missões mistas — squads multi-facção.
 */

export function createMissionService({
  missionRepository,
  factionRepository,
  repository,
  bridgeService = null,
} = {}) {
  if (!missionRepository) throw new Error('[fun/missionService] missionRepository required');
  if (!factionRepository) throw new Error('[fun/missionService] factionRepository required');
  if (!repository) throw new Error('[fun/missionService] repository required');

  function getActive(scopeKey, now = Date.now()) {
    return missionRepository.getActive(scopeKey, now);
  }

  /**
   * Sorteia 1 membro de facções diferentes.
   */
  function pickMixedSquad(scopeKey, size = 3) {
    const factions = factionRepository.listByScope(scopeKey)
      .map(f => ({
        faction: f,
        members: factionRepository.listMembers(f.id).map(m => m.userJid),
      }))
      .filter(f => f.members.length > 0);

    if (factions.length < 2) {
      return { ok: false, reason: 'need-factions', factions: factions.length };
    }

    // embaralha facções
    const shuffled = [...factions].sort(() => Math.random() - 0.5);
    const pickCount = Math.min(size, shuffled.length, 4);
    const members = [];
    for (let i = 0; i < pickCount; i += 1) {
      const fac = shuffled[i];
      const userJid = fac.members[Math.floor(Math.random() * fac.members.length)];
      members.push({
        userJid,
        factionId: fac.faction.id,
        factionName: fac.faction.name,
      });
    }

    if (members.length < 2) {
      return { ok: false, reason: 'need-members' };
    }
    return { ok: true, members };
  }

  function spawn({ scopeKey, funConfig = {}, now = Date.now() }) {
    const size = Math.max(2, Math.floor(Number(funConfig.missionSquadSize) || 3));
    const picked = pickMixedSquad(scopeKey, size);
    if (!picked.ok) return picked;

    const goals = [
      { id: 'daily', label: 'Todos do squad darem /daily', type: 'all_daily' },
      { id: 'bet', label: 'Uma /aposta entre dois do squad', type: 'any_bet' },
      { id: 'ship', label: 'Um /ship envolvendo o squad', type: 'any_ship' },
    ];

    const mission = missionRepository.createMission({
      scopeKey,
      members: picked.members,
      goals,
      rewardEach: Math.floor(Number(funConfig.missionRewardPerMember) || 30),
      durationMs: Number(funConfig.missionDurationMs) || 12 * 60 * 60_000,
      now,
    });

    return { ok: true, mission };
  }

  function isMember(mission, userJid) {
    return (mission?.members || []).some(m => m.userJid === userJid);
  }

  function allGoalsDone(mission) {
    const progress = mission.progress || {};
    return (mission.goals || []).every(g => progress[g.id]);
  }

  /**
   * Atualiza progresso conforme ação (daily/bet/ship).
   */
  function onActivity({
    scopeKey,
    userJid,
    kind,
    otherJid = '',
    now = Date.now(),
  }) {
    const mission = missionRepository.getActive(scopeKey, now);
    if (!mission) return { ok: false, reason: 'no-mission' };

    const progress = { ...(mission.progress || {}) };
    let changed = false;
    const memberJids = new Set((mission.members || []).map(m => m.userJid));

    if (kind === 'daily' && memberJids.has(userJid)) {
      const dailyMap = { ...(progress.dailyMap || {}) };
      dailyMap[userJid] = true;
      progress.dailyMap = dailyMap;
      const allDaily = (mission.members || []).every(m => dailyMap[m.userJid]);
      if (allDaily && !progress.daily) {
        progress.daily = true;
        changed = true;
      } else if (!progress.daily) {
        changed = true; // partial
      }
    }

    if (kind === 'bet' && memberJids.has(userJid) && memberJids.has(otherJid) && userJid !== otherJid) {
      if (!progress.bet) {
        progress.bet = true;
        progress.betPair = [userJid, otherJid];
        changed = true;
      }
    }

    if (kind === 'ship') {
      const involved = [userJid, otherJid].filter(j => memberJids.has(j));
      if (involved.length >= 1 && !progress.ship) {
        // ship "envolvendo" squad: pelo menos um membro
        progress.ship = true;
        changed = true;
      }
    }

    if (!changed && kind !== 'daily') {
      return { ok: true, mission, updated: false };
    }

    // recompute daily flag
    if (progress.dailyMap) {
      progress.daily = (mission.members || []).every(m => progress.dailyMap[m.userJid]);
    }

    let next = missionRepository.updateProgress(mission.id, progress, now);

    if (allGoalsDone(next)) {
      next = completeAndReward(next, now);
      return { ok: true, mission: next, updated: true, completed: true };
    }

    return { ok: true, mission: next, updated: true, completed: false };
  }

  function completeAndReward(mission, now = Date.now()) {
    const completed = missionRepository.complete(mission.id, now);
    const reward = Math.floor(Number(mission.rewardEach) || 30);
    for (const m of mission.members || []) {
      repository.addCoins({
        userJid: m.userJid,
        scopeKey: mission.scopeKey,
        amount: reward,
        now,
        reason: 'mission-reward',
      });
      // pequena borda social artificial entre squad
      if (bridgeService) {
        for (const other of mission.members || []) {
          if (other.userJid === m.userJid) continue;
          bridgeService.recordInteraction({
            scopeKey: mission.scopeKey,
            fromJid: m.userJid,
            toJid: other.userJid,
            kind: 'mission',
            now,
          });
        }
      }
    }
    return completed;
  }

  function statusForUser(scopeKey, userJid, now = Date.now()) {
    const mission = missionRepository.getActive(scopeKey, now);
    if (!mission) return { ok: false, reason: 'no-mission' };
    return {
      ok: true,
      mission,
      isMember: isMember(mission, userJid),
    };
  }

  return {
    getActive,
    spawn,
    onActivity,
    statusForUser,
    isMember,
    pickMixedSquad,
  };
}
