/**
 * db/analyticsRepository.js
 *
 * Conversation analytics and session-history read model operations.
 * Extracted from db/index.js to reduce monolithic responsibilities.
 */

export function createAnalyticsRepository({ getStmts }) {
  function createConversationSessionRecord({
    sessionId,
    jid,
    flowPath = '',
    startedAt = Date.now(),
  }) {
    if (!sessionId || !jid) return;
    const stmts = getStmts();
    stmts.createConversationSession.run(
      String(sessionId),
      String(jid),
      String(flowPath || ''),
      Number(startedAt) || Date.now()
    );
  }

  function finishConversationSessionRecord({
    sessionId,
    endedAt = Date.now(),
    endReason = 'unknown',
  }) {
    if (!sessionId) return;
    const stmts = getStmts();
    stmts.finishConversationSession.run(
      Number(endedAt) || Date.now(),
      String(endReason || 'unknown'),
      String(sessionId)
    );
  }

  function getConversationDashboardStats({ from, to, flowPath = '' }) {
    const stmts = getStmts();
    const fromTs = Number(from) || 0;
    const toTs = Number(to) || Date.now();
    const normalizedFlowPath = String(flowPath ?? '').trim();

    const started = normalizedFlowPath
      ? (stmts.countStartedSessionsInRangeByFlowPath.get(fromTs, toTs, normalizedFlowPath)?.total ?? 0)
      : (stmts.countStartedSessionsInRange.get(fromTs, toTs)?.total ?? 0);
    const abandoned = normalizedFlowPath
      ? (stmts.countEndedByReasonInRangeByFlowPath.get(fromTs, toTs, 'timeout', normalizedFlowPath)?.total ?? 0)
      : (stmts.countEndedByReasonInRange.get(fromTs, toTs, 'timeout')?.total ?? 0);
    const avgDurationMs = normalizedFlowPath
      ? (stmts.avgEndedDurationInRangeByFlowPath.get(fromTs, toTs, normalizedFlowPath)?.avgDurationMs ?? 0)
      : (stmts.avgEndedDurationInRange.get(fromTs, toTs)?.avgDurationMs ?? 0);
    const activeSessions = normalizedFlowPath
      ? (stmts.countOpenSessionsByFlowPath.get(normalizedFlowPath)?.total ?? 0)
      : (stmts.countOpenSessions.get()?.total ?? 0);

    return {
      conversationsStarted: Number(started) || 0,
      abandonedSessions: Number(abandoned) || 0,
      abandonmentRate: (Number(started) || 0) > 0
        ? Number(((Number(abandoned) || 0) / Number(started)).toFixed(4))
        : 0,
      averageDurationMs: Number(avgDurationMs) || 0,
      activeSessions: Number(activeSessions) || 0,
    };
  }

  function getConversationSessionsTotal(flowPath = '') {
    const stmts = getStmts();
    const normalizedFlowPath = String(flowPath ?? '').trim();
    if (normalizedFlowPath) {
      return Number(stmts.countConversationSessionsTotalByFlowPath.get(normalizedFlowPath)?.total ?? 0) || 0;
    }
    return Number(stmts.countConversationSessionsTotal.get()?.total ?? 0) || 0;
  }

  function getConversationEndedByReasonCount({ from, to, endReason, flowPath = '' }) {
    const stmts = getStmts();
    const fromTs = Number(from) || 0;
    const toTs = Number(to) || Date.now();
    const reason = String(endReason ?? '').trim();
    if (!reason) return 0;

    const normalizedFlowPath = String(flowPath ?? '').trim();
    if (normalizedFlowPath) {
      return Number(
        stmts.countEndedByReasonInRangeByFlowPath.get(fromTs, toTs, reason, normalizedFlowPath)?.total ?? 0
      ) || 0;
    }

    return Number(stmts.countEndedByReasonInRange.get(fromTs, toTs, reason)?.total ?? 0) || 0;
  }

  function listConversationSessionStarts({ from, to, flowPath = '' }) {
    const stmts = getStmts();
    const fromTs = Number(from) || 0;
    const toTs = Number(to) || Date.now();
    const normalizedFlowPath = String(flowPath ?? '').trim();

    const rows = normalizedFlowPath
      ? stmts.listStartedSessionsInRangeByFlowPath.all(fromTs, toTs, normalizedFlowPath)
      : stmts.listStartedSessionsInRange.all(fromTs, toTs);

    return rows.map(row => Number(row.started_at) || 0).filter(Boolean);
  }

  function listConversationSessionEndsByReason({ from, to, endReason, flowPath = '' }) {
    const stmts = getStmts();
    const fromTs = Number(from) || 0;
    const toTs = Number(to) || Date.now();
    const reason = String(endReason ?? '').trim();
    if (!reason) return [];

    const normalizedFlowPath = String(flowPath ?? '').trim();
    const rows = normalizedFlowPath
      ? stmts.listEndedByReasonInRangeByFlowPath.all(fromTs, toTs, reason, normalizedFlowPath)
      : stmts.listEndedByReasonInRange.all(fromTs, toTs, reason);

    return rows.map(row => Number(row.ended_at) || 0).filter(Boolean);
  }

  return {
    createConversationSessionRecord,
    finishConversationSessionRecord,
    getConversationDashboardStats,
    getConversationSessionsTotal,
    getConversationEndedByReasonCount,
    listConversationSessionStarts,
    listConversationSessionEndsByReason,
  };
}
