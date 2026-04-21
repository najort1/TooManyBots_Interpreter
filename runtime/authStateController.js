export function createAuthStateController({
  getConfig,
  getAuthStorageCache,
  getAuthStateStorageStats,
  getSaveCredsDebounceTimer,
  setSaveCredsDebounceTimer,
  getSaveCredsImmediate,
  getAuthPersistenceStats,
  cleanupAuthSignalSessions,
  getAuthCleanupStats,
  getAuthStateMaintenanceTimer,
  setAuthStateMaintenanceTimer,
} = {}) {
  function refreshAuthStateStorageSnapshot({ force = false } = {}) {
    const config = getConfig();
    const authStorageCache = getAuthStorageCache();
    const refreshEveryMs = Math.max(1000, Number(config?.authMetricsRefreshMs ?? 30_000));
    const nowTs = Date.now();
    if (!force && nowTs - authStorageCache.lastRefreshAt < refreshEveryMs) {
      return authStorageCache.snapshot;
    }

    try {
      authStorageCache.snapshot = getAuthStateStorageStats();
      authStorageCache.lastRefreshAt = nowTs;
    } catch {
      authStorageCache.refreshErrors += 1;
    }

    return authStorageCache.snapshot;
  }

  function clearCredsDebounceTimer() {
    const saveCredsDebounceTimer = getSaveCredsDebounceTimer();
    if (!saveCredsDebounceTimer) return;
    clearTimeout(saveCredsDebounceTimer);
    setSaveCredsDebounceTimer(null);
  }

  function flushCredsNow(reason = 'manual') {
    clearCredsDebounceTimer();
    const saveCredsImmediate = getSaveCredsImmediate();
    if (typeof saveCredsImmediate !== 'function') return false;

    const authPersistenceStats = getAuthPersistenceStats();
    const startedAt = Date.now();
    authPersistenceStats.writeAttempts += 1;
    authPersistenceStats.lastFlushReason = String(reason || 'manual');
    try {
      saveCredsImmediate();
      authPersistenceStats.lastWriteAt = Date.now();
      authPersistenceStats.lastFlushDurationMs = Math.max(0, Date.now() - startedAt);
      authPersistenceStats.totalWriteMs += authPersistenceStats.lastFlushDurationMs;
      refreshAuthStateStorageSnapshot({ force: true });
      return true;
    } catch (error) {
      authPersistenceStats.writeErrors += 1;
      authPersistenceStats.lastError = String(error?.message || error);
      return false;
    }
  }

  function scheduleCredsSave(reason = 'update') {
    const authPersistenceStats = getAuthPersistenceStats();
    authPersistenceStats.updateEvents += 1;

    const config = getConfig();
    const delayMs = Math.max(0, Number(config?.authCredsDebounceMs ?? 250));
    if (delayMs === 0) {
      flushCredsNow(reason);
      return;
    }

    if (getSaveCredsDebounceTimer()) {
      return;
    }

    authPersistenceStats.debouncedFlushes += 1;
    const timer = setTimeout(() => {
      flushCredsNow('debounced-creds-update');
    }, delayMs);
    setSaveCredsDebounceTimer(timer);

    if (typeof timer.unref === 'function') {
      timer.unref();
    }
  }

  function cleanupSignalAuthState({ reason = 'manual', forceLog = false } = {}) {
    const authCleanupStats = getAuthCleanupStats();
    try {
      const summary = cleanupAuthSignalSessions();
      authCleanupStats.runs += 1;
      authCleanupStats.changedRows += Math.max(0, Number(summary?.changedRows) || 0);
      authCleanupStats.deletedRows += Math.max(0, Number(summary?.deletedRows) || 0);
      authCleanupStats.removedSessions += Math.max(0, Number(summary?.removedSessions) || 0);
      authCleanupStats.lastSummary = summary;
      authCleanupStats.lastRunAt = Date.now();

      const shouldLog =
        forceLog ||
        summary.changedRows > 0 ||
        summary.deletedRows > 0 ||
        summary.removedSessions > 0;

      if (shouldLog) {
        console.log(
          `[AuthState] cleanup(${reason}) rows=${summary.scannedRows} changed=${summary.changedRows} deleted=${summary.deletedRows} removedSessions=${summary.removedSessions}`
        );
      }

      refreshAuthStateStorageSnapshot({ force: true });
      return summary;
    } catch (error) {
      console.error(`[AuthState] cleanup falhou (${reason}):`, error?.message || error);
      return null;
    }
  }

  function startAuthStateMaintenance() {
    if (getAuthStateMaintenanceTimer()) return;

    const intervalMs = Math.max(60_000, Number(process.env.TMB_AUTH_CLEANUP_INTERVAL_MS) || (10 * 60 * 1000));
    const timer = setInterval(() => {
      cleanupSignalAuthState({ reason: 'interval' });
    }, intervalMs);
    setAuthStateMaintenanceTimer(timer);

    if (typeof timer.unref === 'function') {
      timer.unref();
    }
  }

  return {
    refreshAuthStateStorageSnapshot,
    clearCredsDebounceTimer,
    flushCredsNow,
    scheduleCredsSave,
    cleanupSignalAuthState,
    startAuthStateMaintenance,
  };
}
