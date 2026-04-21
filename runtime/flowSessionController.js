export function createFlowSessionController({
  getActiveSessions,
  getActiveFlows,
  getFlowBotType,
  resolveContactDisplayName,
} = {}) {
  function normalizeTimeoutMinutes(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.floor(n);
  }

  function applyFlowSessionTimeoutOverrides(registry, currentConfig) {
    if (!registry || !Array.isArray(registry.all)) return registry;
    const overrides = currentConfig?.flowSessionTimeoutOverrides && typeof currentConfig.flowSessionTimeoutOverrides === 'object'
      ? currentConfig.flowSessionTimeoutOverrides
      : {};

    for (const flow of registry.all) {
      const flowPath = String(flow?.flowPath ?? '').trim();
      if (!flowPath) continue;
      const override = normalizeTimeoutMinutes(overrides[flowPath]);
      if (override == null) continue;
      if (!flow.runtimeConfig || typeof flow.runtimeConfig !== 'object') {
        flow.runtimeConfig = {};
      }
      if (!flow.runtimeConfig.sessionLimits || typeof flow.runtimeConfig.sessionLimits !== 'object') {
        flow.runtimeConfig.sessionLimits = {};
      }
      flow.runtimeConfig.sessionLimits.sessionTimeoutMinutes = override;
    }

    return registry;
  }

  function getFlowSessionTimeoutMinutes(flow) {
    const value = Number(flow?.runtimeConfig?.sessionLimits?.sessionTimeoutMinutes);
    if (!Number.isFinite(value) || value < 0) return 0;
    return Math.floor(value);
  }

  function parseHumanHandoff(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    if (typeof value !== 'string' || !value.trim()) return {};
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function buildSessionManagementOverview() {
    const activeSessions = getActiveSessions({ botType: 'conversation' });
    const nowTs = Date.now();

    let handoffSessions = 0;
    let durationTotal = 0;
    let durationCount = 0;

    const flowCounts = new Map();
    for (const session of activeSessions) {
      const waitingForHuman = String(session?.waitingFor || '').trim().toLowerCase() === 'human';
      const handoff = parseHumanHandoff(session?.variables?.__humanHandoff);
      if (waitingForHuman || handoff.active === true) {
        handoffSessions += 1;
      }

      const startedAt = Number(session?.variables?.__sessionStartedAt) || 0;
      if (startedAt > 0 && startedAt <= nowTs) {
        durationTotal += nowTs - startedAt;
        durationCount += 1;
      }

      const flowPath = String(session?.flowPath || '').trim() || '(sem-flow)';
      flowCounts.set(flowPath, (flowCounts.get(flowPath) || 0) + 1);
    }

    const averageSessionDurationMs = durationCount > 0 ? Math.round(durationTotal / durationCount) : 0;
    return {
      activeSessions: activeSessions.length,
      handoffSessions,
      averageSessionDurationMs,
      byFlow: [...flowCounts.entries()]
        .map(([flowPath, activeCount]) => ({ flowPath, activeCount }))
        .sort((a, b) => b.activeCount - a.activeCount),
    };
  }

  function listSessionManagementFlows() {
    return getActiveFlows()
      .filter(flow => getFlowBotType(flow) === 'conversation')
      .map(flow => ({
        flowPath: flow.flowPath,
        botType: getFlowBotType(flow),
        sessionTimeoutMinutes: getFlowSessionTimeoutMinutes(flow),
      }));
  }

  function listActiveSessionsForManagement({ search = '', limit = 200 } = {}) {
    const normalizedSearch = String(search ?? '').trim().toLowerCase();
    const normalizedLimit = Math.max(1, Math.min(2000, Number(limit) || 200));
    const nowTs = Date.now();

    return getActiveSessions({ botType: 'conversation' })
      .filter(session => {
        if (!normalizedSearch) return true;
        const jid = String(session?.jid || '').toLowerCase();
        const flowPath = String(session?.flowPath || '').toLowerCase();
        const displayName = resolveContactDisplayName(session?.jid).toLowerCase();
        return jid.includes(normalizedSearch) || flowPath.includes(normalizedSearch) || displayName.includes(normalizedSearch);
      })
      .slice(0, normalizedLimit)
      .map(session => {
        const startedAt = Number(session?.variables?.__sessionStartedAt) || 0;
        const lastActivityAt = Number(session?.variables?.__sessionLastActivityAt) || 0;
        const handoff = parseHumanHandoff(session?.variables?.__humanHandoff);
        const waitingForHuman = String(session?.waitingFor || '').trim().toLowerCase() === 'human';
        return {
          jid: session.jid,
          flowPath: session.flowPath,
          botType: session.botType,
          waitingFor: session.waitingFor,
          blockIndex: session.blockIndex,
          displayName: resolveContactDisplayName(session.jid),
          startedAt,
          lastActivityAt,
          durationMs: startedAt > 0 && startedAt <= nowTs ? nowTs - startedAt : 0,
          handoffActive: waitingForHuman || handoff.active === true,
        };
      });
  }

  return {
    normalizeTimeoutMinutes,
    applyFlowSessionTimeoutOverrides,
    getFlowSessionTimeoutMinutes,
    parseHumanHandoff,
    buildSessionManagementOverview,
    listSessionManagementFlows,
    listActiveSessionsForManagement,
  };
}
