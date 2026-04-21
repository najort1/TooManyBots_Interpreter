export function createDashboardSettingsSessionHandlers({
  getConfig,
  setConfig,
  saveUserConfig,
  setupFlowWatcher,
  applyDatabaseRuntimeConfigFromAppConfig,
  startDatabaseMaintenanceScheduler,
  normalizeDashboardTelemetryLevel,
  resolveDashboardIsolationMode,
  normalizeBroadcastSendIntervalMs,
  normalizeDbMaintenanceIntervalMinutes,
  normalizeDbRetentionDays,
  normalizeDbEventBatchFlushMs,
  normalizeDbEventBatchSize,
  toBooleanOrNull,
  clearEngineRuntimeCaches,
  getContactCache,
  getLogger,
  getDatabaseInfo,
  getDatabaseRuntimeConfig,
  getDatabaseMaintenanceStatus,
  runDatabaseMaintenance,
  buildSessionManagementOverview,
  listSessionManagementFlows,
  listActiveSessionsForManagement,
  clearActiveSessions,
  clearActiveSessionsByFlowPath,
  getActiveSessions,
  deleteSession,
  normalizeTimeoutMinutes,
  getActiveFlows,
} = {}) {
  return {
    onGetSettings: async () => {
      const config = getConfig();
      return {
        autoReloadFlows: config.autoReloadFlows !== false,
        broadcastSendIntervalMs: Number(config.broadcastSendIntervalMs ?? 250),
        dashboardTelemetryLevel: normalizeDashboardTelemetryLevel(config.dashboardTelemetryLevel) || 'operational',
        dashboardIsolationMode: resolveDashboardIsolationMode(),
        runtimeMode: String(config.runtimeMode || ''),
        dbMaintenanceEnabled: config.dbMaintenanceEnabled !== false,
        dbMaintenanceIntervalMinutes: Number(config.dbMaintenanceIntervalMinutes ?? 30),
        dbRetentionDays: Number(config.dbRetentionDays ?? 30),
        dbRetentionArchiveEnabled: config.dbRetentionArchiveEnabled !== false,
        dbEventBatchEnabled: config.dbEventBatchEnabled !== false,
        dbEventBatchFlushMs: Number(config.dbEventBatchFlushMs ?? 1000),
        dbEventBatchSize: Number(config.dbEventBatchSize ?? 200),
      };
    },

    onUpdateSettings: async ({
      autoReloadFlows,
      broadcastSendIntervalMs,
      dashboardTelemetryLevel,
      dbMaintenanceEnabled,
      dbMaintenanceIntervalMinutes,
      dbRetentionDays,
      dbRetentionArchiveEnabled,
      dbEventBatchEnabled,
      dbEventBatchFlushMs,
      dbEventBatchSize,
    }) => {
      const hasAutoReloadPatch = autoReloadFlows !== undefined;
      const hasBroadcastIntervalPatch = broadcastSendIntervalMs !== undefined;
      const hasTelemetryLevelPatch = dashboardTelemetryLevel !== undefined;
      const hasDbMaintenanceEnabledPatch = dbMaintenanceEnabled !== undefined;
      const hasDbMaintenanceIntervalPatch = dbMaintenanceIntervalMinutes !== undefined;
      const hasDbRetentionDaysPatch = dbRetentionDays !== undefined;
      const hasDbRetentionArchivePatch = dbRetentionArchiveEnabled !== undefined;
      const hasDbEventBatchEnabledPatch = dbEventBatchEnabled !== undefined;
      const hasDbEventBatchFlushMsPatch = dbEventBatchFlushMs !== undefined;
      const hasDbEventBatchSizePatch = dbEventBatchSize !== undefined;

      if (
        !hasAutoReloadPatch &&
        !hasBroadcastIntervalPatch &&
        !hasTelemetryLevelPatch &&
        !hasDbMaintenanceEnabledPatch &&
        !hasDbMaintenanceIntervalPatch &&
        !hasDbRetentionDaysPatch &&
        !hasDbRetentionArchivePatch &&
        !hasDbEventBatchEnabledPatch &&
        !hasDbEventBatchFlushMsPatch &&
        !hasDbEventBatchSizePatch
      ) {
        return { ok: false, error: 'at least one setting must be provided' };
      }

      if (hasAutoReloadPatch && typeof autoReloadFlows !== 'boolean') {
        return { ok: false, error: 'autoReloadFlows must be boolean' };
      }

      const normalizedBroadcastInterval = hasBroadcastIntervalPatch
        ? normalizeBroadcastSendIntervalMs(broadcastSendIntervalMs)
        : null;
      if (hasBroadcastIntervalPatch && normalizedBroadcastInterval == null) {
        return { ok: false, error: 'broadcastSendIntervalMs must be >= 0' };
      }

      const normalizedTelemetryLevel = hasTelemetryLevelPatch
        ? normalizeDashboardTelemetryLevel(dashboardTelemetryLevel)
        : null;
      if (hasTelemetryLevelPatch && !normalizedTelemetryLevel) {
        return { ok: false, error: 'dashboardTelemetryLevel must be one of: minimum, operational, diagnostic, verbose' };
      }

      const normalizedDbMaintenanceEnabled = hasDbMaintenanceEnabledPatch
        ? toBooleanOrNull(dbMaintenanceEnabled)
        : null;
      if (hasDbMaintenanceEnabledPatch && normalizedDbMaintenanceEnabled == null) {
        return { ok: false, error: 'dbMaintenanceEnabled must be boolean' };
      }

      const normalizedDbMaintenanceInterval = hasDbMaintenanceIntervalPatch
        ? normalizeDbMaintenanceIntervalMinutes(dbMaintenanceIntervalMinutes)
        : null;
      if (hasDbMaintenanceIntervalPatch && normalizedDbMaintenanceInterval == null) {
        return { ok: false, error: 'dbMaintenanceIntervalMinutes must be between 5 and 1440' };
      }

      const normalizedDbRetentionDays = hasDbRetentionDaysPatch
        ? normalizeDbRetentionDays(dbRetentionDays)
        : null;
      if (hasDbRetentionDaysPatch && normalizedDbRetentionDays == null) {
        return { ok: false, error: 'dbRetentionDays must be between 1 and 3650' };
      }

      const normalizedDbRetentionArchiveEnabled = hasDbRetentionArchivePatch
        ? toBooleanOrNull(dbRetentionArchiveEnabled)
        : null;
      if (hasDbRetentionArchivePatch && normalizedDbRetentionArchiveEnabled == null) {
        return { ok: false, error: 'dbRetentionArchiveEnabled must be boolean' };
      }

      const normalizedDbEventBatchEnabled = hasDbEventBatchEnabledPatch
        ? toBooleanOrNull(dbEventBatchEnabled)
        : null;
      if (hasDbEventBatchEnabledPatch && normalizedDbEventBatchEnabled == null) {
        return { ok: false, error: 'dbEventBatchEnabled must be boolean' };
      }

      const normalizedDbEventBatchFlushMs = hasDbEventBatchFlushMsPatch
        ? normalizeDbEventBatchFlushMs(dbEventBatchFlushMs)
        : null;
      if (hasDbEventBatchFlushMsPatch && normalizedDbEventBatchFlushMs == null) {
        return { ok: false, error: 'dbEventBatchFlushMs must be between 100 and 60000' };
      }

      const normalizedDbEventBatchSize = hasDbEventBatchSizePatch
        ? normalizeDbEventBatchSize(dbEventBatchSize)
        : null;
      if (hasDbEventBatchSizePatch && normalizedDbEventBatchSize == null) {
        return { ok: false, error: 'dbEventBatchSize must be between 10 and 5000' };
      }

      const config = getConfig();
      const nextConfig = {
        ...config,
        ...(hasAutoReloadPatch ? { autoReloadFlows } : {}),
        ...(hasBroadcastIntervalPatch ? { broadcastSendIntervalMs: normalizedBroadcastInterval } : {}),
        ...(hasTelemetryLevelPatch ? { dashboardTelemetryLevel: normalizedTelemetryLevel } : {}),
        ...(hasDbMaintenanceEnabledPatch ? { dbMaintenanceEnabled: normalizedDbMaintenanceEnabled } : {}),
        ...(hasDbMaintenanceIntervalPatch ? { dbMaintenanceIntervalMinutes: normalizedDbMaintenanceInterval } : {}),
        ...(hasDbRetentionDaysPatch ? { dbRetentionDays: normalizedDbRetentionDays } : {}),
        ...(hasDbRetentionArchivePatch ? { dbRetentionArchiveEnabled: normalizedDbRetentionArchiveEnabled } : {}),
        ...(hasDbEventBatchEnabledPatch ? { dbEventBatchEnabled: normalizedDbEventBatchEnabled } : {}),
        ...(hasDbEventBatchFlushMsPatch ? { dbEventBatchFlushMs: normalizedDbEventBatchFlushMs } : {}),
        ...(hasDbEventBatchSizePatch ? { dbEventBatchSize: normalizedDbEventBatchSize } : {}),
      };

      setConfig(nextConfig);
      saveUserConfig(nextConfig);
      setupFlowWatcher();
      applyDatabaseRuntimeConfigFromAppConfig(nextConfig);
      startDatabaseMaintenanceScheduler();

      getLogger()?.info?.({
        ...(hasAutoReloadPatch ? { autoReloadFlows } : {}),
        ...(hasBroadcastIntervalPatch ? { broadcastSendIntervalMs: normalizedBroadcastInterval } : {}),
        ...(hasTelemetryLevelPatch ? { dashboardTelemetryLevel: normalizedTelemetryLevel } : {}),
        ...(hasDbMaintenanceEnabledPatch ? { dbMaintenanceEnabled: normalizedDbMaintenanceEnabled } : {}),
        ...(hasDbMaintenanceIntervalPatch ? { dbMaintenanceIntervalMinutes: normalizedDbMaintenanceInterval } : {}),
        ...(hasDbRetentionDaysPatch ? { dbRetentionDays: normalizedDbRetentionDays } : {}),
        ...(hasDbRetentionArchivePatch ? { dbRetentionArchiveEnabled: normalizedDbRetentionArchiveEnabled } : {}),
        ...(hasDbEventBatchEnabledPatch ? { dbEventBatchEnabled: normalizedDbEventBatchEnabled } : {}),
        ...(hasDbEventBatchFlushMsPatch ? { dbEventBatchFlushMs: normalizedDbEventBatchFlushMs } : {}),
        ...(hasDbEventBatchSizePatch ? { dbEventBatchSize: normalizedDbEventBatchSize } : {}),
      }, 'Settings updated');

      return {
        ok: true,
        autoReloadFlows: nextConfig.autoReloadFlows !== false,
        broadcastSendIntervalMs: Number(nextConfig.broadcastSendIntervalMs ?? 250),
        dashboardTelemetryLevel: normalizeDashboardTelemetryLevel(nextConfig.dashboardTelemetryLevel) || 'operational',
        dashboardIsolationMode: resolveDashboardIsolationMode(),
        runtimeMode: String(nextConfig.runtimeMode || ''),
        dbMaintenanceEnabled: nextConfig.dbMaintenanceEnabled !== false,
        dbMaintenanceIntervalMinutes: Number(nextConfig.dbMaintenanceIntervalMinutes ?? 30),
        dbRetentionDays: Number(nextConfig.dbRetentionDays ?? 30),
        dbRetentionArchiveEnabled: nextConfig.dbRetentionArchiveEnabled !== false,
        dbEventBatchEnabled: nextConfig.dbEventBatchEnabled !== false,
        dbEventBatchFlushMs: Number(nextConfig.dbEventBatchFlushMs ?? 1000),
        dbEventBatchSize: Number(nextConfig.dbEventBatchSize ?? 200),
      };
    },

    onClearRuntimeCache: async () => {
      try {
        clearEngineRuntimeCaches();
        getContactCache()?.clear?.();
        getLogger()?.info?.('Runtime caches cleared from dashboard settings');
        return { ok: true };
      } catch (error) {
        getLogger()?.error?.(
          {
            err: {
              name: error?.name || 'Error',
              message: error?.message || 'clear-runtime-cache-failed',
              stack: error?.stack || '',
            },
          },
          'Failed to clear runtime cache'
        );
        return { ok: false, error: String(error?.message || 'clear-runtime-cache-failed') };
      }
    },

    onGetDbInfo: async () => getDatabaseInfo(),

    onGetDbMaintenance: async () => {
      const config = getConfig();
      return {
        ok: true,
        config: {
          dbMaintenanceEnabled: config.dbMaintenanceEnabled !== false,
          dbMaintenanceIntervalMinutes: Number(config.dbMaintenanceIntervalMinutes ?? 30),
          dbRetentionDays: Number(config.dbRetentionDays ?? 30),
          dbRetentionArchiveEnabled: config.dbRetentionArchiveEnabled !== false,
          dbEventBatchEnabled: config.dbEventBatchEnabled !== false,
          dbEventBatchFlushMs: Number(config.dbEventBatchFlushMs ?? 1000),
          dbEventBatchSize: Number(config.dbEventBatchSize ?? 200),
        },
        runtimeConfig: getDatabaseRuntimeConfig(),
        maintenanceStatus: getDatabaseMaintenanceStatus(),
      };
    },

    onUpdateDbMaintenance: async (input = {}) => {
      const normalizedEnabled = input.dbMaintenanceEnabled === undefined
        ? null
        : toBooleanOrNull(input.dbMaintenanceEnabled);
      if (input.dbMaintenanceEnabled !== undefined && normalizedEnabled == null) {
        return { ok: false, error: 'dbMaintenanceEnabled must be boolean' };
      }

      const normalizedInterval = input.dbMaintenanceIntervalMinutes === undefined
        ? null
        : normalizeDbMaintenanceIntervalMinutes(input.dbMaintenanceIntervalMinutes);
      if (input.dbMaintenanceIntervalMinutes !== undefined && normalizedInterval == null) {
        return { ok: false, error: 'dbMaintenanceIntervalMinutes must be between 5 and 1440' };
      }

      const normalizedRetentionDays = input.dbRetentionDays === undefined
        ? null
        : normalizeDbRetentionDays(input.dbRetentionDays);
      if (input.dbRetentionDays !== undefined && normalizedRetentionDays == null) {
        return { ok: false, error: 'dbRetentionDays must be between 1 and 3650' };
      }

      const normalizedRetentionArchive = input.dbRetentionArchiveEnabled === undefined
        ? null
        : toBooleanOrNull(input.dbRetentionArchiveEnabled);
      if (input.dbRetentionArchiveEnabled !== undefined && normalizedRetentionArchive == null) {
        return { ok: false, error: 'dbRetentionArchiveEnabled must be boolean' };
      }

      const normalizedBatchEnabled = input.dbEventBatchEnabled === undefined
        ? null
        : toBooleanOrNull(input.dbEventBatchEnabled);
      if (input.dbEventBatchEnabled !== undefined && normalizedBatchEnabled == null) {
        return { ok: false, error: 'dbEventBatchEnabled must be boolean' };
      }

      const normalizedBatchFlushMs = input.dbEventBatchFlushMs === undefined
        ? null
        : normalizeDbEventBatchFlushMs(input.dbEventBatchFlushMs);
      if (input.dbEventBatchFlushMs !== undefined && normalizedBatchFlushMs == null) {
        return { ok: false, error: 'dbEventBatchFlushMs must be between 100 and 60000' };
      }

      const normalizedBatchSize = input.dbEventBatchSize === undefined
        ? null
        : normalizeDbEventBatchSize(input.dbEventBatchSize);
      if (input.dbEventBatchSize !== undefined && normalizedBatchSize == null) {
        return { ok: false, error: 'dbEventBatchSize must be between 10 and 5000' };
      }

      const hasAnyPatch =
        normalizedEnabled !== null ||
        normalizedInterval !== null ||
        normalizedRetentionDays !== null ||
        normalizedRetentionArchive !== null ||
        normalizedBatchEnabled !== null ||
        normalizedBatchFlushMs !== null ||
        normalizedBatchSize !== null;

      if (!hasAnyPatch) {
        return { ok: false, error: 'at least one maintenance field must be provided' };
      }

      const config = getConfig();
      const nextConfig = {
        ...config,
        ...(normalizedEnabled !== null ? { dbMaintenanceEnabled: normalizedEnabled } : {}),
        ...(normalizedInterval !== null ? { dbMaintenanceIntervalMinutes: normalizedInterval } : {}),
        ...(normalizedRetentionDays !== null ? { dbRetentionDays: normalizedRetentionDays } : {}),
        ...(normalizedRetentionArchive !== null ? { dbRetentionArchiveEnabled: normalizedRetentionArchive } : {}),
        ...(normalizedBatchEnabled !== null ? { dbEventBatchEnabled: normalizedBatchEnabled } : {}),
        ...(normalizedBatchFlushMs !== null ? { dbEventBatchFlushMs: normalizedBatchFlushMs } : {}),
        ...(normalizedBatchSize !== null ? { dbEventBatchSize: normalizedBatchSize } : {}),
      };

      setConfig(nextConfig);
      saveUserConfig(nextConfig);
      const runtimeConfig = applyDatabaseRuntimeConfigFromAppConfig(nextConfig);
      startDatabaseMaintenanceScheduler();

      return {
        ok: true,
        config: {
          dbMaintenanceEnabled: nextConfig.dbMaintenanceEnabled !== false,
          dbMaintenanceIntervalMinutes: Number(nextConfig.dbMaintenanceIntervalMinutes ?? 30),
          dbRetentionDays: Number(nextConfig.dbRetentionDays ?? 30),
          dbRetentionArchiveEnabled: nextConfig.dbRetentionArchiveEnabled !== false,
          dbEventBatchEnabled: nextConfig.dbEventBatchEnabled !== false,
          dbEventBatchFlushMs: Number(nextConfig.dbEventBatchFlushMs ?? 1000),
          dbEventBatchSize: Number(nextConfig.dbEventBatchSize ?? 200),
        },
        runtimeConfig,
        maintenanceStatus: getDatabaseMaintenanceStatus(),
      };
    },

    onRunDbMaintenance: async ({ force = true } = {}) => {
      const result = runDatabaseMaintenance({
        reason: 'dashboard-manual',
        force: Boolean(force),
        runRetention: true,
      });
      return result;
    },

    onGetSessionManagementOverview: async () => buildSessionManagementOverview(),
    onListSessionManagementFlows: async () => listSessionManagementFlows(),
    onListActiveSessionsForManagement: async ({ search, limit }) => (
      listActiveSessionsForManagement({ search, limit })
    ),

    onClearActiveSessionsAll: async () => {
      try {
        const removed = clearActiveSessions();
        getLogger()?.info?.({ removed: removed.length }, 'Cleared all active sessions');
        return { ok: true, removed: removed.length };
      } catch (error) {
        return { ok: false, error: String(error?.message || 'failed-to-clear-active-sessions') };
      }
    },

    onClearActiveSessionsByFlow: async ({ flowPath }) => {
      const normalizedFlowPath = String(flowPath ?? '').trim();
      if (!normalizedFlowPath) {
        return { ok: false, error: 'flowPath is required' };
      }
      try {
        const removed = clearActiveSessionsByFlowPath(normalizedFlowPath);
        getLogger()?.info?.({ flowPath: normalizedFlowPath, removed: removed.length }, 'Cleared active sessions by flow');
        return { ok: true, removed: removed.length };
      } catch (error) {
        return { ok: false, error: String(error?.message || 'failed-to-clear-flow-sessions') };
      }
    },

    onResetSessionsByJid: async ({ jid }) => {
      const normalizedJid = String(jid ?? '').trim();
      if (!normalizedJid) {
        return { ok: false, error: 'jid is required' };
      }

      try {
        const active = getActiveSessions({ botType: 'conversation' })
          .filter(session => String(session?.jid || '').trim() === normalizedJid);
        for (const session of active) {
          deleteSession(normalizedJid, {
            flowPath: session.flowPath,
            botType: session.botType,
          });
        }
        getLogger()?.info?.({ jid: normalizedJid, removed: active.length }, 'Reset sessions by JID');
        return { ok: true, removed: active.length };
      } catch (error) {
        return { ok: false, error: String(error?.message || 'failed-to-reset-session-by-jid') };
      }
    },

    onUpdateFlowSessionTimeout: async ({ flowPath, sessionTimeoutMinutes }) => {
      const normalizedFlowPath = String(flowPath ?? '').trim();
      const normalizedTimeout = normalizeTimeoutMinutes(sessionTimeoutMinutes);
      if (!normalizedFlowPath) {
        return { ok: false, error: 'flowPath is required' };
      }
      if (normalizedTimeout == null) {
        return { ok: false, error: 'sessionTimeoutMinutes must be >= 0' };
      }

      const flow = getActiveFlows().find(item => String(item.flowPath) === normalizedFlowPath);
      if (!flow) {
        return { ok: false, error: 'flow-not-found' };
      }

      if (!flow.runtimeConfig || typeof flow.runtimeConfig !== 'object') {
        flow.runtimeConfig = {};
      }
      if (!flow.runtimeConfig.sessionLimits || typeof flow.runtimeConfig.sessionLimits !== 'object') {
        flow.runtimeConfig.sessionLimits = {};
      }
      flow.runtimeConfig.sessionLimits.sessionTimeoutMinutes = normalizedTimeout;

      const config = getConfig();
      const nextConfig = {
        ...config,
        flowSessionTimeoutOverrides: {
          ...(config.flowSessionTimeoutOverrides || {}),
          [normalizedFlowPath]: normalizedTimeout,
        },
      };
      setConfig(nextConfig);
      saveUserConfig(nextConfig);
      getLogger()?.info?.({ flowPath: normalizedFlowPath, sessionTimeoutMinutes: normalizedTimeout }, 'Updated flow timeout');

      return {
        ok: true,
        flowPath: normalizedFlowPath,
        sessionTimeoutMinutes: normalizedTimeout,
      };
    },
  };
}
