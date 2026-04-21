export function createDatabaseMaintenanceController({
  getConfig,
  configureDatabaseRuntime,
  runDatabaseMaintenance,
  getLogger,
  getDbMaintenanceTimer,
  setDbMaintenanceTimer,
  dashboardTelemetryLevels,
} = {}) {
  function normalizeBroadcastSendIntervalMs(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.floor(n);
  }

  function normalizeDashboardTelemetryLevel(value) {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (!normalized) return null;
    return dashboardTelemetryLevels.has(normalized) ? normalized : null;
  }

  function normalizeDbMaintenanceIntervalMinutes(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const normalized = Math.floor(n);
    if (normalized < 5 || normalized > 1440) return null;
    return normalized;
  }

  function normalizeDbRetentionDays(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const normalized = Math.floor(n);
    if (normalized < 1 || normalized > 3650) return null;
    return normalized;
  }

  function normalizeDbEventBatchFlushMs(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const normalized = Math.floor(n);
    if (normalized < 100 || normalized > 60000) return null;
    return normalized;
  }

  function normalizeDbEventBatchSize(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const normalized = Math.floor(n);
    if (normalized < 10 || normalized > 5000) return null;
    return normalized;
  }

  function toBooleanOrNull(value) {
    if (typeof value === 'boolean') return value;
    return null;
  }

  function buildDatabaseRuntimeConfigFromCurrentConfig(currentConfig = getConfig()) {
    return {
      maintenanceEnabled: currentConfig?.dbMaintenanceEnabled !== false,
      maintenanceIntervalMinutes: Number(currentConfig?.dbMaintenanceIntervalMinutes ?? 30),
      retentionDays: Number(currentConfig?.dbRetentionDays ?? 30),
      retentionArchiveEnabled: currentConfig?.dbRetentionArchiveEnabled !== false,
      eventBatchingEnabled: currentConfig?.dbEventBatchEnabled !== false,
      eventBatchFlushMs: Number(currentConfig?.dbEventBatchFlushMs ?? 1000),
      eventBatchSize: Number(currentConfig?.dbEventBatchSize ?? 200),
    };
  }

  function applyDatabaseRuntimeConfigFromAppConfig(currentConfig = getConfig()) {
    return configureDatabaseRuntime(buildDatabaseRuntimeConfigFromCurrentConfig(currentConfig));
  }

  function stopDatabaseMaintenanceScheduler() {
    const timer = getDbMaintenanceTimer();
    if (!timer) return;
    clearInterval(timer);
    setDbMaintenanceTimer(null);
  }

  function startDatabaseMaintenanceScheduler() {
    stopDatabaseMaintenanceScheduler();

    const config = getConfig();
    if (config?.dbMaintenanceEnabled === false) return;
    const intervalMinutes = Math.max(5, Number(config?.dbMaintenanceIntervalMinutes) || 30);
    const intervalMs = intervalMinutes * 60 * 1000;

    const timer = setInterval(() => {
      try {
        const result = runDatabaseMaintenance({ reason: 'scheduled', force: false, runRetention: true });
        if (!result?.ok && !result?.skipped) {
          getLogger()?.warn?.(
            { error: String(result?.error || 'db-maintenance-failed') },
            'Scheduled DB maintenance failed'
          );
        }
      } catch (error) {
        getLogger()?.warn?.(
          { error: String(error?.message || 'db-maintenance-failed') },
          'Scheduled DB maintenance failed'
        );
      }
    }, intervalMs);

    setDbMaintenanceTimer(timer);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
  }

  return {
    normalizeBroadcastSendIntervalMs,
    normalizeDashboardTelemetryLevel,
    normalizeDbMaintenanceIntervalMinutes,
    normalizeDbRetentionDays,
    normalizeDbEventBatchFlushMs,
    normalizeDbEventBatchSize,
    toBooleanOrNull,
    buildDatabaseRuntimeConfigFromCurrentConfig,
    applyDatabaseRuntimeConfigFromAppConfig,
    stopDatabaseMaintenanceScheduler,
    startDatabaseMaintenanceScheduler,
  };
}
