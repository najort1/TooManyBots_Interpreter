export function createSetupConfigController({
  getConfig,
  setConfig,
  setCurrentFlowRegistry,
  setWarnedMissingTestTargets,
  setRuntimeSetupDone,
  saveUserConfig,
  normalizeUserConfig,
  applyFlowSessionTimeoutOverrides,
  loadFlowRegistryFromConfig,
  isGroupWhitelistScope,
  getGroupWhitelistJids,
  getAllowedTestJids,
  installLibSignalNoiseFilter,
  getLogger,
  initializeRuntimeSchedulers,
  initializeReconnectPolicy,
  getMediaCleanupTimer,
  setMediaCleanupTimer,
  startHandoffMediaMaintenance,
  applyDatabaseRuntimeConfigFromAppConfig,
  startDatabaseMaintenanceScheduler,
  getCurrentSocket,
  startSessionCleanup,
  getActiveFlows,
  setupFlowWatcher,
  setRequiresInitialSetup,
  setHasSavedConfigAtBoot,
  ensureWhatsAppRuntimeStarted,
  buildSetupConfigSnapshot,
  toTrimmedStringArray,
  normalizeBroadcastSendIntervalMs,
  runtimeModeProduction,
} = {}) {
  function normalizeSetupPatch(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return null;
    }

    const patch = {};

    if (input.botRuntimeMode !== undefined) {
      patch.botRuntimeMode = String(input.botRuntimeMode || '').trim();
    }
    if (input.flowPath !== undefined) {
      patch.flowPath = String(input.flowPath || '').trim();
    }
    if (input.flowPaths !== undefined) {
      patch.flowPaths = toTrimmedStringArray(input.flowPaths);
    }
    if (input.runtimeMode !== undefined) {
      patch.runtimeMode = String(input.runtimeMode || '').trim();
    }
    if (input.autoReloadFlows !== undefined) {
      patch.autoReloadFlows = Boolean(input.autoReloadFlows);
    }
    if (input.broadcastSendIntervalMs !== undefined) {
      const normalizedBroadcastInterval = normalizeBroadcastSendIntervalMs(input.broadcastSendIntervalMs);
      if (normalizedBroadcastInterval == null) {
        return { error: 'broadcastSendIntervalMs must be >= 0' };
      }
      patch.broadcastSendIntervalMs = normalizedBroadcastInterval;
    }
    if (input.ingestionConcurrency !== undefined) {
      patch.ingestionConcurrency = Number(input.ingestionConcurrency);
    }
    if (input.ingestionQueueMax !== undefined) {
      patch.ingestionQueueMax = Number(input.ingestionQueueMax);
    }
    if (input.ingestionQueueWarnThreshold !== undefined) {
      patch.ingestionQueueWarnThreshold = Number(input.ingestionQueueWarnThreshold);
    }
    if (input.schedulerGlobalConcurrency !== undefined) {
      patch.schedulerGlobalConcurrency = Number(input.schedulerGlobalConcurrency);
    }
    if (input.schedulerPerJidConcurrency !== undefined) {
      patch.schedulerPerJidConcurrency = Number(input.schedulerPerJidConcurrency);
    }
    if (input.schedulerPerFlowPathConcurrency !== undefined) {
      patch.schedulerPerFlowPathConcurrency = Number(input.schedulerPerFlowPathConcurrency);
    }
    if (input.postProcessConcurrency !== undefined) {
      patch.postProcessConcurrency = Number(input.postProcessConcurrency);
    }
    if (input.postProcessQueueMax !== undefined) {
      patch.postProcessQueueMax = Number(input.postProcessQueueMax);
    }
    if (input.mediaPipelineConcurrency !== undefined) {
      patch.mediaPipelineConcurrency = Number(input.mediaPipelineConcurrency);
    }
    if (input.mediaPipelineQueueMax !== undefined) {
      patch.mediaPipelineQueueMax = Number(input.mediaPipelineQueueMax);
    }
    if (input.whatsappReconnectBaseDelayMs !== undefined) {
      patch.whatsappReconnectBaseDelayMs = Number(input.whatsappReconnectBaseDelayMs);
    }
    if (input.whatsappReconnectMaxDelayMs !== undefined) {
      patch.whatsappReconnectMaxDelayMs = Number(input.whatsappReconnectMaxDelayMs);
    }
    if (input.whatsappReconnectBackoffMultiplier !== undefined) {
      patch.whatsappReconnectBackoffMultiplier = Number(input.whatsappReconnectBackoffMultiplier);
    }
    if (input.whatsappReconnectJitterPct !== undefined) {
      patch.whatsappReconnectJitterPct = Number(input.whatsappReconnectJitterPct);
    }
    if (input.whatsappReconnectAttemptsWindowMs !== undefined) {
      patch.whatsappReconnectAttemptsWindowMs = Number(input.whatsappReconnectAttemptsWindowMs);
    }
    if (input.whatsappReconnectMaxAttemptsPerWindow !== undefined) {
      patch.whatsappReconnectMaxAttemptsPerWindow = Number(input.whatsappReconnectMaxAttemptsPerWindow);
    }
    if (input.whatsappReconnectCooldownMs !== undefined) {
      patch.whatsappReconnectCooldownMs = Number(input.whatsappReconnectCooldownMs);
    }
    if (input.authCredsDebounceMs !== undefined) {
      patch.authCredsDebounceMs = Number(input.authCredsDebounceMs);
    }
    if (input.authMetricsRefreshMs !== undefined) {
      patch.authMetricsRefreshMs = Number(input.authMetricsRefreshMs);
    }
    if (input.incomingMediaMaxBytes !== undefined) {
      patch.incomingMediaMaxBytes = Number(input.incomingMediaMaxBytes);
    }
    if (input.handoffMediaRetentionMinutes !== undefined) {
      patch.handoffMediaRetentionMinutes = Number(input.handoffMediaRetentionMinutes);
    }
    if (input.handoffMediaCleanupIntervalMinutes !== undefined) {
      patch.handoffMediaCleanupIntervalMinutes = Number(input.handoffMediaCleanupIntervalMinutes);
    }
    if (input.handoffMediaMaxStorageMb !== undefined) {
      patch.handoffMediaMaxStorageMb = Number(input.handoffMediaMaxStorageMb);
    }
    if (input.whatsappMaxInboundPerMinute !== undefined) {
      patch.whatsappMaxInboundPerMinute = Number(input.whatsappMaxInboundPerMinute);
    }
    if (input.whatsappMaxServiceOutboundPerMinute !== undefined) {
      patch.whatsappMaxServiceOutboundPerMinute = Number(input.whatsappMaxServiceOutboundPerMinute);
    }
    if (input.whatsappMaxBroadcastOutboundPerMinute !== undefined) {
      patch.whatsappMaxBroadcastOutboundPerMinute = Number(input.whatsappMaxBroadcastOutboundPerMinute);
    }
    if (input.runtimeDegradedQueueRatio !== undefined) {
      patch.runtimeDegradedQueueRatio = Number(input.runtimeDegradedQueueRatio);
    }
    if (input.runtimeDegradedReconnectPendingMs !== undefined) {
      patch.runtimeDegradedReconnectPendingMs = Number(input.runtimeDegradedReconnectPendingMs);
    }
    if (input.runtimeDegradedDropConversationEvents !== undefined) {
      patch.runtimeDegradedDropConversationEvents = Boolean(input.runtimeDegradedDropConversationEvents);
    }
    if (input.testTargetMode !== undefined) {
      patch.testTargetMode = String(input.testTargetMode || '').trim() || 'contacts-and-groups';
    }
    if (input.testJid !== undefined) {
      patch.testJid = String(input.testJid || '').trim();
    }
    if (input.testJids !== undefined) {
      patch.testJids = toTrimmedStringArray(input.testJids);
    }
    if (input.groupWhitelistJids !== undefined) {
      patch.groupWhitelistJids = toTrimmedStringArray(input.groupWhitelistJids);
    }
    if (input.surveyConfigsByFlowPath !== undefined) {
      patch.surveyConfigsByFlowPath = input.surveyConfigsByFlowPath;
    }
    if (input.dashboardHost !== undefined) {
      patch.dashboardHost = String(input.dashboardHost || '').trim();
    }
    if (input.dashboardPort !== undefined) {
      patch.dashboardPort = Number(input.dashboardPort);
    }

    return patch;
  }

  async function applyRuntimeConfigFromDashboard(input = {}) {
    const patchOrError = normalizeSetupPatch(input);
    if (patchOrError == null) {
      return { ok: false, error: 'invalid setup payload' };
    }
    if (patchOrError.error) {
      return { ok: false, error: patchOrError.error };
    }

    const currentConfig = getConfig();
    const nextConfig = normalizeUserConfig({
      ...currentConfig,
      ...patchOrError,
    });

    let nextRegistry;
    try {
      nextRegistry = applyFlowSessionTimeoutOverrides(loadFlowRegistryFromConfig(nextConfig), nextConfig);
    } catch (error) {
      return { ok: false, error: String(error?.message || 'invalid-flow-selection') };
    }

    const hasGroupWhitelistScopeFlow = nextRegistry.all.some(flow => isGroupWhitelistScope(flow));
    if (hasGroupWhitelistScopeFlow && getGroupWhitelistJids(nextConfig).size === 0) {
      return {
        ok: false,
        error: 'Selecione ao menos 1 grupo na whitelist para flows com escopo group-whitelist.',
      };
    }

    if (nextConfig.testMode && getAllowedTestJids(nextConfig).size === 0) {
      return {
        ok: false,
        error: 'Modo Teste restrito exige ao menos 1 contato/grupo permitido.',
      };
    }

    setConfig(nextConfig);
    setCurrentFlowRegistry(nextRegistry);
    setWarnedMissingTestTargets(false);
    setRuntimeSetupDone(true);
    saveUserConfig(nextConfig);

    const suppressSignalNoise =
      nextConfig.runtimeMode === runtimeModeProduction &&
      String(process.env.TMB_SUPPRESS_SIGNAL_NOISE ?? '1') !== '0';
    installLibSignalNoiseFilter(suppressSignalNoise);

    const logger = getLogger();
    if (logger) {
      logger.level = nextConfig.logLevel;
    }

    initializeRuntimeSchedulers(nextConfig);
    initializeReconnectPolicy(nextConfig);

    const mediaCleanupTimer = getMediaCleanupTimer();
    if (mediaCleanupTimer) {
      clearInterval(mediaCleanupTimer);
      setMediaCleanupTimer(null);
    }

    startHandoffMediaMaintenance();
    applyDatabaseRuntimeConfigFromAppConfig(nextConfig);
    startDatabaseMaintenanceScheduler();

    const currentSocket = getCurrentSocket();
    if (currentSocket) {
      startSessionCleanup(currentSocket, getActiveFlows());
    }

    setupFlowWatcher();
    setRequiresInitialSetup(false);
    setHasSavedConfigAtBoot(true);

    await ensureWhatsAppRuntimeStarted();

    return {
      ok: true,
      needsInitialSetup: false,
      hasSavedConfig: true,
      config: buildSetupConfigSnapshot(),
    };
  }

  return {
    normalizeSetupPatch,
    applyRuntimeConfigFromDashboard,
  };
}
