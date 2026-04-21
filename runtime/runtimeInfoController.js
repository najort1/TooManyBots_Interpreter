import path from 'path';

export function createRuntimeInfoController({
  getConfig,
  runtimeModeProduction,
  getDashboardFlow,
  getConversationFlow,
  getCommandFlows,
  normalizeDashboardTelemetryLevel,
  resolveDashboardIsolationMode,
  getWhatsAppHealthState,
  getRuntimeGuardState,
  refreshAuthStateStorageSnapshot,
  getReconnectController,
  trimTimestampWindow,
  readPerMinute,
  toPercentile,
  getAuthPersistenceStats,
  getAuthCleanupStats,
  getAuthStorageCache,
  getHandoffMediaMaintenanceStats,
  evaluateRuntimeGuardState,
  getEngineRuntimeStats,
  getIngestionRuntimeCounters,
  getRuntimeStatsStartedAt,
  queueSnapshotOrFallback,
  getIngestionQueue,
  getDispatchScheduler,
  getPostProcessQueue,
  getMediaPipelineQueue,
} = {}) {
  function safeAverage(total, count) {
    if (!Number.isFinite(total) || !Number.isFinite(count) || count <= 0) return 0;
    return Number((total / count).toFixed(2));
  }

  function toPerSecond(count, startedAt) {
    const uptimeSeconds = Math.max(1, (Date.now() - Number(startedAt || Date.now())) / 1000);
    return Number(((Number(count) || 0) / uptimeSeconds).toFixed(2));
  }

  function getWhatsAppHealthSnapshot() {
    const whatsappHealthState = getWhatsAppHealthState();
    const runtimeGuardState = getRuntimeGuardState();
    const authPersistenceStats = getAuthPersistenceStats();
    const authCleanupStats = getAuthCleanupStats();
    const authStorageCache = getAuthStorageCache();
    const handoffMediaMaintenanceStats = getHandoffMediaMaintenanceStats();

    const nowTs = Date.now();
    trimTimestampWindow(whatsappHealthState.reconnectHistory, 24 * 60 * 60 * 1000, nowTs);
    trimTimestampWindow(whatsappHealthState.successfulReconnectHistory, 24 * 60 * 60 * 1000, nowTs);
    refreshAuthStateStorageSnapshot();

    const connectedNow = whatsappHealthState.connectedSince > 0;
    const totalConnectedMs = whatsappHealthState.totalConnectedMs + (
      connectedNow ? Math.max(0, nowTs - whatsappHealthState.connectedSince) : 0
    );
    const degradedTotalMs = runtimeGuardState.totalDegradedMs + (
      runtimeGuardState.degradedMode && runtimeGuardState.lastEnteredAt > 0
        ? Math.max(0, nowTs - runtimeGuardState.lastEnteredAt)
        : 0
    );

    return {
      connected: connectedNow,
      connectedSince: whatsappHealthState.connectedSince || 0,
      uptimeConnectedMs: connectedNow ? Math.max(0, nowTs - whatsappHealthState.connectedSince) : 0,
      totalConnectedMs,
      lastConnectedAt: whatsappHealthState.lastConnectedAt || 0,
      lastDisconnectedAt: whatsappHealthState.lastDisconnectedAt || 0,
      lastDisconnectDurationMs: whatsappHealthState.lastDisconnectDurationMs || 0,
      disconnectCount: whatsappHealthState.disconnectCount,
      disconnectByStatusCode: { ...whatsappHealthState.disconnectByStatusCode },
      disconnectByCategory: { ...whatsappHealthState.disconnectByCategory },
      reconnectsScheduledLast24h: whatsappHealthState.reconnectHistory.length,
      reconnectsSuccessfulLast24h: whatsappHealthState.successfulReconnectHistory.length,
      reconnectController: getReconnectController()?.getSnapshot?.() || null,
      eventVolumePerMinute: {
        incoming: readPerMinute(whatsappHealthState.minuteCounters.incoming, 1),
        outgoingTotal: readPerMinute(whatsappHealthState.minuteCounters.outgoingTotal, 1),
        outgoingService: readPerMinute(whatsappHealthState.minuteCounters.outgoingService, 1),
        outgoingBroadcast: readPerMinute(whatsappHealthState.minuteCounters.outgoingBroadcast, 1),
        events: readPerMinute(whatsappHealthState.minuteCounters.events, 1),
        messagesUpsert: readPerMinute(whatsappHealthState.minuteCounters.messagesUpsert, 1),
        connectionUpdate: readPerMinute(whatsappHealthState.minuteCounters.connectionUpdate, 1),
        credsUpdate: readPerMinute(whatsappHealthState.minuteCounters.credsUpdate, 1),
      },
      callback: {
        calls: whatsappHealthState.callback.calls,
        avgMs: safeAverage(whatsappHealthState.callback.totalMs, whatsappHealthState.callback.calls),
        p95Ms: toPercentile(whatsappHealthState.callback.samples, 0.95),
        maxMs: whatsappHealthState.callback.maxMs,
        lastMs: whatsappHealthState.callback.lastMs,
      },
      processingLag: {
        count: whatsappHealthState.queueLag.count,
        avgMs: safeAverage(whatsappHealthState.queueLag.totalMs, whatsappHealthState.queueLag.count),
        p95Ms: toPercentile(whatsappHealthState.queueLag.samples, 0.95),
        maxMs: whatsappHealthState.queueLag.maxMs,
      },
      events: {
        ...whatsappHealthState.events,
      },
      sendFailuresByCategory: { ...whatsappHealthState.sendFailuresByCategory },
      authState: {
        persistence: {
          ...authPersistenceStats,
          writeAvgMs: safeAverage(authPersistenceStats.totalWriteMs, authPersistenceStats.writeAttempts),
          updateEventsPerMinute: readPerMinute(whatsappHealthState.minuteCounters.credsUpdate, 1),
        },
        cleanup: {
          ...authCleanupStats,
        },
        storage: {
          ...authStorageCache.snapshot,
          refreshErrors: authStorageCache.refreshErrors,
        },
      },
      mediaMaintenance: {
        ...handoffMediaMaintenanceStats,
      },
      guard: {
        active: runtimeGuardState.degradedMode,
        reason: runtimeGuardState.reason,
        changedAt: runtimeGuardState.changedAt,
        toggles: runtimeGuardState.toggles,
        totalDegradedMs: degradedTotalMs,
        droppedPostTasks: runtimeGuardState.droppedPostTasks,
        droppedMediaTasks: runtimeGuardState.droppedMediaTasks,
      },
      updatedAt: nowTs,
    };
  }

  function getIngestionSnapshot() {
    const config = getConfig();
    const runtimeGuardState = getRuntimeGuardState();
    const ingestionRuntimeCounters = getIngestionRuntimeCounters();
    const runtimeStatsStartedAt = getRuntimeStatsStartedAt();

    const ingestionQueueSnapshot = queueSnapshotOrFallback(getIngestionQueue(), {
      concurrency: Number(config?.ingestionConcurrency ?? 8),
      maxQueueSize: Number(config?.ingestionQueueMax ?? 5000),
      warnThreshold: Number(config?.ingestionQueueWarnThreshold ?? 1000),
      queued: 0,
      running: 0,
      activeKeys: 0,
      accepted: 0,
      rejected: 0,
      started: 0,
      completed: 0,
      failed: 0,
      maxQueuedObserved: 0,
      avgWaitMs: 0,
      avgProcessMs: 0,
      acceptedPerSecond: 0,
      processedPerSecond: 0,
      droppedPerSecond: 0,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    });
    const dispatchQueueSnapshot = queueSnapshotOrFallback(getDispatchScheduler(), {
      globalConcurrency: Number(config?.schedulerGlobalConcurrency ?? 16),
      maxPerJid: Number(config?.schedulerPerJidConcurrency ?? 1),
      maxPerFlowPath: Number(config?.schedulerPerFlowPathConcurrency ?? 4),
      maxQueueSize: 20000,
      warnThreshold: 5000,
      queued: 0,
      running: 0,
      runningJids: 0,
      runningFlowPaths: 0,
      accepted: 0,
      rejected: 0,
      started: 0,
      completed: 0,
      failed: 0,
      maxQueuedObserved: 0,
      avgWaitMs: 0,
      avgProcessMs: 0,
      acceptedPerSecond: 0,
      processedPerSecond: 0,
      droppedPerSecond: 0,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    });
    const postProcessSnapshot = queueSnapshotOrFallback(getPostProcessQueue(), {
      concurrency: Number(config?.postProcessConcurrency ?? 2),
      maxQueueSize: Number(config?.postProcessQueueMax ?? 5000),
      warnThreshold: Math.min(Number(config?.postProcessQueueMax ?? 5000), 1000),
      queued: 0,
      running: 0,
      activeKeys: 0,
      accepted: 0,
      rejected: 0,
      started: 0,
      completed: 0,
      failed: 0,
      maxQueuedObserved: 0,
      avgWaitMs: 0,
      avgProcessMs: 0,
      acceptedPerSecond: 0,
      processedPerSecond: 0,
      droppedPerSecond: 0,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    });
    const mediaPipelineSnapshot = queueSnapshotOrFallback(getMediaPipelineQueue(), {
      concurrency: Number(config?.mediaPipelineConcurrency ?? 2),
      maxQueueSize: Number(config?.mediaPipelineQueueMax ?? 500),
      warnThreshold: Math.min(Number(config?.mediaPipelineQueueMax ?? 500), 100),
      queued: 0,
      running: 0,
      activeKeys: 0,
      accepted: 0,
      rejected: 0,
      started: 0,
      completed: 0,
      failed: 0,
      maxQueuedObserved: 0,
      avgWaitMs: 0,
      avgProcessMs: 0,
      acceptedPerSecond: 0,
      processedPerSecond: 0,
      droppedPerSecond: 0,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    });

    evaluateRuntimeGuardState();
    const engineStats = getEngineRuntimeStats();
    const whatsappHealth = getWhatsAppHealthSnapshot();

    return {
      callback: {
        received: ingestionRuntimeCounters.received,
        parseDropped: ingestionRuntimeCounters.parseDropped,
        filteredOut: ingestionRuntimeCounters.filteredOut,
        queueOverflowDropped: ingestionRuntimeCounters.queueOverflowDropped,
        duplicateDropped: Number(engineStats?.duplicateDropped || 0),
        processedMessages: ingestionRuntimeCounters.processedMessages,
        processingFailed: ingestionRuntimeCounters.processingFailed,
        parseAvgMs: safeAverage(ingestionRuntimeCounters.parseMsTotal, ingestionRuntimeCounters.processedMessages + ingestionRuntimeCounters.parseDropped),
        routingAvgMs: safeAverage(ingestionRuntimeCounters.routingMsTotal, ingestionRuntimeCounters.processedMessages),
        totalAvgMs: safeAverage(ingestionRuntimeCounters.totalMsTotal, ingestionRuntimeCounters.processedMessages),
        receivedPerSecond: toPerSecond(ingestionRuntimeCounters.received, runtimeStatsStartedAt),
        processedPerSecond: toPerSecond(ingestionRuntimeCounters.processedMessages, runtimeStatsStartedAt),
        droppedPerSecond: toPerSecond(
          ingestionRuntimeCounters.queueOverflowDropped + ingestionRuntimeCounters.parseDropped + ingestionRuntimeCounters.filteredOut + Number(engineStats?.duplicateDropped || 0),
          runtimeStatsStartedAt
        ),
        updatedAt: Date.now(),
      },
      postProcessing: {
        queued: ingestionRuntimeCounters.postTasksQueued,
        dropped: ingestionRuntimeCounters.postTasksDropped,
        failed: ingestionRuntimeCounters.postTasksFailed,
        queue: postProcessSnapshot,
      },
      media: {
        queued: ingestionRuntimeCounters.mediaQueued,
        captured: ingestionRuntimeCounters.mediaCaptured,
        failed: ingestionRuntimeCounters.mediaCaptureFailed,
        queueDropped: ingestionRuntimeCounters.mediaQueueDropped,
        tooLargeDropped: ingestionRuntimeCounters.mediaTooLargeDropped,
        droppedByDegradedMode: ingestionRuntimeCounters.mediaDroppedByDegradedMode,
        queue: mediaPipelineSnapshot,
      },
      runtimeGuard: {
        degradedMode: runtimeGuardState.degradedMode,
        reason: runtimeGuardState.reason,
        droppedPostTasks: ingestionRuntimeCounters.postTasksDroppedByDegradedMode,
        droppedMediaTasks: ingestionRuntimeCounters.mediaDroppedByDegradedMode,
      },
      whatsappHealth,
      engine: engineStats,
      ingestionQueue: ingestionQueueSnapshot,
      dispatchScheduler: dispatchQueueSnapshot,
    };
  }

  function normalizeRuntimeInfo() {
    const config = getConfig();
    const dashboardFlow = getDashboardFlow();
    const flowFile = path.basename(String(dashboardFlow?.flowPath ?? config?.flowPath ?? ''));
    const runtimeMode = String(config?.runtimeMode ?? runtimeModeProduction);
    const conversationFlow = getConversationFlow();
    const commandFlows = getCommandFlows();
    const availableModes = [
      ...(conversationFlow ? ['conversation'] : []),
      ...(commandFlows.length > 0 ? ['command'] : []),
    ];
    const mode = conversationFlow ? 'conversation' : (commandFlows.length > 0 ? 'command' : 'conversation');
    const flowPath = dashboardFlow?.flowPath ?? path.resolve(String(config?.flowPath ?? ''));
    return {
      flowFile,
      mode,
      runtimeMode,
      flowPath,
      flowPathsByMode: {
        conversation: conversationFlow ? [conversationFlow.flowPath] : [],
        command: commandFlows.map(flow => flow.flowPath),
      },
      availableModes,
      dashboard: {
        telemetryLevel: normalizeDashboardTelemetryLevel(config?.dashboardTelemetryLevel) || 'operational',
        isolationMode: resolveDashboardIsolationMode(),
      },
      whatsapp: getWhatsAppHealthSnapshot(),
      ingestion: getIngestionSnapshot(),
    };
  }

  return {
    getWhatsAppHealthSnapshot,
    getIngestionSnapshot,
    normalizeRuntimeInfo,
  };
}
