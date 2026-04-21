export function createRuntimeGuardController({
  getRuntimeGuardState,
  getConfig,
  getLogger,
  queueSnapshotOrFallback,
  getIngestionQueue,
  getMediaPipelineQueue,
  getReconnectController,
  computeQueuePressurePercent,
} = {}) {
  function setRuntimeDegradedMode(nextActive, reason = 'normal') {
    const runtimeGuardState = getRuntimeGuardState();
    const active = nextActive === true;
    if (runtimeGuardState.degradedMode === active && runtimeGuardState.reason === reason) {
      return;
    }

    const nowTs = Date.now();
    if (runtimeGuardState.degradedMode && runtimeGuardState.lastEnteredAt > 0) {
      runtimeGuardState.totalDegradedMs += Math.max(0, nowTs - runtimeGuardState.lastEnteredAt);
    }

    runtimeGuardState.degradedMode = active;
    runtimeGuardState.reason = String(reason || (active ? 'pressure' : 'normal'));
    runtimeGuardState.changedAt = nowTs;
    runtimeGuardState.toggles += 1;
    runtimeGuardState.lastEnteredAt = active ? nowTs : 0;

    getLogger()?.warn?.(
      {
        degradedMode: runtimeGuardState.degradedMode,
        reason: runtimeGuardState.reason,
        toggles: runtimeGuardState.toggles,
      },
      'Runtime degraded mode changed'
    );
  }

  function evaluateRuntimeGuardState() {
    const config = getConfig();
    const ingestionSnapshot = queueSnapshotOrFallback(getIngestionQueue(), {
      queued: 0,
      maxQueueSize: Number(config?.ingestionQueueMax ?? 5000),
    });
    const mediaSnapshot = queueSnapshotOrFallback(getMediaPipelineQueue(), {
      queued: 0,
      maxQueueSize: Number(config?.mediaPipelineQueueMax ?? 500),
    });
    const reconnectSnapshot = getReconnectController()?.getSnapshot?.() || { pending: false, nextReconnectAt: 0 };

    const ingestionPressurePct = computeQueuePressurePercent(ingestionSnapshot);
    const mediaPressurePct = computeQueuePressurePercent(mediaSnapshot);
    const degradedThreshold = Math.max(50, Number(config?.runtimeDegradedQueueRatio ?? 90));
    const reconnectPendingMs = reconnectSnapshot?.pending
      ? Math.max(0, Number(reconnectSnapshot.nextReconnectAt || 0) - Date.now())
      : 0;
    const reconnectThresholdMs = Math.max(0, Number(config?.runtimeDegradedReconnectPendingMs ?? 20_000));

    const shouldDegrade =
      ingestionPressurePct >= degradedThreshold ||
      mediaPressurePct >= degradedThreshold ||
      reconnectPendingMs >= reconnectThresholdMs;

    const reason = reconnectPendingMs >= reconnectThresholdMs
      ? 'reconnect-pending'
      : (ingestionPressurePct >= degradedThreshold ? 'ingestion-pressure' : (mediaPressurePct >= degradedThreshold ? 'media-pressure' : 'normal'));

    setRuntimeDegradedMode(shouldDegrade, reason);
  }

  return {
    setRuntimeDegradedMode,
    evaluateRuntimeGuardState,
  };
}
