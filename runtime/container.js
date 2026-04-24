import path from 'path';
import { DisconnectReason, downloadMediaMessage } from '@whiskeysockets/baileys';

import { createInstanceLock } from './instanceLock.js';
import { createDashboardBridgeController } from './dashboardBridge.js';
import { createIngestionPipelineController } from './ingestionPipeline.js';
import { createFlowRegistryController } from './flowRegistryController.js';
import { createFlowRuntimeManager } from './flowRuntimeManager.js';
import { createSetupConfigController } from './setupConfigController.js';
import { createSetupRuntimeStateController } from './setupRuntimeState.js';
import { createWhatsAppRuntimeController } from './whatsappRuntime.js';
import { createRuntimeGuardController } from './runtimeGuardController.js';
import { createRuntimeDiagnosticsController } from './runtimeDiagnosticsController.js';
import { createRuntimeLoggingController } from './runtimeLoggingController.js';
import { createFatalLifecycleController } from './fatalLifecycleController.js';
import { createAuthStateController } from './authStateController.js';
import { createRuntimeInfoController } from './runtimeInfoController.js';
import { createMaintenanceController } from './maintenanceController.js';
import { createDatabaseMaintenanceController } from './databaseMaintenanceController.js';
import { createHandoffMediaCaptureController } from './handoffMediaCapture.js';
import { createFlowSessionController } from './flowSessionController.js';
import { createMessageTelemetryController } from './messageTelemetryController.js';

import { getFlowBotType, loadFlows } from '../engine/flowLoader.js';
import { parseMessage } from '../engine/messageParser.js';
import {
  handleIncoming,
  resetActiveSessions,
  startSessionCleanup,
  getEngineRuntimeStats,
} from '../engine/flowEngine.js';
import {
  getSession,
  listContactDisplayNames,
  getContactDisplayName,
  getDatabaseInfo,
  configureDatabaseRuntime,
  runDatabaseMaintenance,
  addConversationEvent,
  getActiveSessions,
} from '../db/index.js';
import { getAuthStateStorageStats, cleanupAuthSignalSessions } from '../db/authState.js';
import {
  mergeContactCacheEntry,
  getMessageDebugInfo,
  resolveIncomingActorJid,
  getGroupWhitelistJids,
  getAllowedTestJids,
  normalizeInteractionScope,
  isGroupWhitelistScope,
  shouldProcessByInteractionScope,
  fetchSelectableContacts,
  fetchSelectableGroups,
  fetchSavedTestTargetJidsFromDb,
  isUserJid,
  isGroupJid,
  mergeContactList,
  mergeChatsIntoContactCache,
} from './contactUtils.js';
import {
  bumpMinuteCounter,
  readPerMinute,
  pushSample,
  trimTimestampWindow,
  toPercentile,
  incrementObjectCounter,
  computeQueuePressurePercent,
} from './healthMetrics.js';
import { saveUserConfig, normalizeUserConfig, RUNTIME_MODE } from '../config/index.js';

/**
 * Initializes all runtime controllers and connects them.
 * 
 * @param {Object} deps - Dependencies from index.js
 * @returns {Object} - Initialized controllers
 */
export function initRuntimeContainer(deps) {
  const {
    // State Getters/Setters
    getConfig,
    setConfig,
    getLogger,
    getCurrentFlowRegistry,
    setCurrentFlowRegistry,
    getCurrentSocket,
    setCurrentSocket,
    getRuntimeSetupPromise,
    setRuntimeSetupDone,
    getWarnedMissingTestTargets,
    setWarnedMissingTestTargets,
    getRequiresInitialSetup,
    setRequiresInitialSetup,
    getHasSavedConfigAtBoot,
    setHasSavedConfigAtBoot,
    getSocketGeneration,
    incrementSocketGeneration,
    
    // State Objects
    ingestionRuntimeCounters,
    contactCache,
    runtimeGuardState,
    whatsappHealthState,
    handoffMediaMaintenanceStats,
    authPersistenceStats,
    authCleanupStats,
    authStorageCache,
    
    // Schedulers / Controllers that are re-initialized
    getIngestionQueue,
    getDispatchScheduler,
    getPostProcessQueue,
    getMediaPipelineQueue,
    getReconnectController,
    
    // Timers Getters/Setters
    getSaveCredsDebounceTimer,
    setSaveCredsDebounceTimer,
    getSaveCredsImmediate,
    getAuthStateMaintenanceTimer,
    setAuthStateMaintenanceTimer,
    getDbSizeSnapshotMaintenanceTimer,
    setDbSizeSnapshotMaintenanceTimer,
    getDbMaintenanceTimer,
    setDbMaintenanceTimer,
    getMediaCleanupTimer,
    setMediaCleanupTimer,

    // Constants
    RUNTIME_LOCK_FILE,
    FATAL_LOG_FILE,
    HANDOFF_MEDIA_DIR,
    ALLOWED_IMAGE_MIME,
    DASHBOARD_TELEMETRY_LEVELS,
    disconnectReasonNameByCode,
    runtimeStatsStartedAt,

    // Local Functions from index.js
    formatError,
    flushCredsNow,
    scheduleCredsSave,
    evaluateRuntimeGuardState,
    noteSocketEvent,
    noteSocketCallbackDuration,
    noteQueueLag,
    maybeLogThroughputPressure,
    logConversationEvent,
    captureIncomingImageForDashboard,
    installLibSignalNoiseFilter,
    initializeRuntimeSchedulers,
    initializeReconnectPolicy,
    startHandoffMediaMaintenance,
    applyDatabaseRuntimeConfigFromAppConfig,
    startDatabaseMaintenanceScheduler,
    ensureWhatsAppRuntimeStarted,
    buildSetupConfigSnapshot,
    normalizeBroadcastSendIntervalMs,
    attachOutgoingMessageLogger,
    initializeTerminalCommands,
    queueSnapshotOrFallback,
    getDashboardFlow,
    getConversationFlow,
    getCommandFlows,
    normalizeDashboardTelemetryLevel,
    resolveDashboardIsolationMode,
    refreshAuthStateStorageSnapshot,
    broadcastDashboardEvent,
    currentPrimaryFlowPathForLogs,
    toTrimmedStringArray,
    resolveContactDisplayName,
  } = deps;

  // 1. instanceLock
  const instanceLock = createInstanceLock(RUNTIME_LOCK_FILE);

  // 2. dashboardBridge
  const dashboardBridge = createDashboardBridgeController({
    getLogger: () => getLogger(),
  });

  // 3. runtimeDiagnosticsController
  const runtimeDiagnosticsController = createRuntimeDiagnosticsController({
    disconnectReasonNameByCode,
    getConfig: () => getConfig(),
    getLogger: () => getLogger(),
    getWhatsappHealthState: () => whatsappHealthState,
    readPerMinute,
    bumpMinuteCounter,
    pushSample,
  });

  // 4. runtimeGuardController
  const runtimeGuardController = createRuntimeGuardController({
    getRuntimeGuardState: () => runtimeGuardState,
    getConfig: () => getConfig(),
    getLogger: () => getLogger(),
    queueSnapshotOrFallback,
    getIngestionQueue,
    getMediaPipelineQueue,
    getReconnectController,
    computeQueuePressurePercent,
  });

  // 5. ingestionPipeline
  const ingestionPipeline = createIngestionPipelineController({
    getConfig: () => getConfig(),
    getLogger: () => getLogger(),
    getRuntimeGuardState: () => runtimeGuardState,
    getIngestionRuntimeCounters: () => ingestionRuntimeCounters,
    getPostProcessQueue,
    getMediaPipelineQueue,
    getDispatchScheduler,
    getIngestionQueue,
    getContactCache: () => contactCache,
    getWhatsappHealthState: () => whatsappHealthState,
    getWarnedMissingTestTargets: () => getWarnedMissingTestTargets(),
    setWarnedMissingTestTargets: next => setWarnedMissingTestTargets(next),
    maybeLogThroughputPressure: () => runtimeDiagnosticsController.maybeLogThroughputPressure(),
    noteQueueLag: durationMs => runtimeDiagnosticsController.noteQueueLag(durationMs),
    evaluateRuntimeGuardState: () => runtimeGuardController.evaluateRuntimeGuardState(),
    logConversationEvent,
    captureIncomingImageForDashboard,
    mergeContactCacheEntry,
    parseMessage,
    getMessageDebugInfo,
    resolveIncomingActorJid,
    getGroupWhitelistJids,
    getAllowedTestJids,
    normalizeInteractionScope,
    isGroupWhitelistScope,
    shouldProcessByInteractionScope,
    getFlowBotType,
    getSession,
    getActiveFlows: () => flowRegistryController.getActiveFlows(),
    handleIncoming,
    formatError,
    bumpMinuteCounter,
  });

  // 6. flowRegistryController
  const flowRegistryController = createFlowRegistryController({
    getCurrentFlowRegistry: () => getCurrentFlowRegistry(),
    getConfig: () => getConfig(),
    loadFlows,
    runtimeModeDevelopment: RUNTIME_MODE.DEVELOPMENT,
  });

  // 7. flowRuntimeManager
  const flowRuntimeManager = createFlowRuntimeManager({
    getConfig: () => getConfig(),
    isDevelopmentMode: (currentConfig) => flowRegistryController.isDevelopmentMode(currentConfig),
    getActiveFlows: () => flowRegistryController.getActiveFlows(),
    resetActiveSessions,
    loadFlowRegistryFromConfig: (currentConfig) => flowRegistryController.loadFlowRegistryFromConfig(currentConfig),
    applyFlowSessionTimeoutOverrides: (registry, currentConfig) => flowSessionController.applyFlowSessionTimeoutOverrides(registry, currentConfig),
    setCurrentFlowRegistry: registry => setCurrentFlowRegistry(registry),
    setWarnedMissingTestTargets: next => setWarnedMissingTestTargets(next),
    getCurrentSocket: () => getCurrentSocket(),
    startSessionCleanup,
    logConversationEvent,
    currentPrimaryFlowPathForLogs: () => flowRegistryController.currentPrimaryFlowPathForLogs(),
  });

  // 8. setupRuntimeStateController
  const setupRuntimeStateController = createSetupRuntimeStateController({
    getConfig: () => getConfig(),
    runtimeModeProduction: RUNTIME_MODE.PRODUCTION,
    toTrimmedStringArray,
    listContactDisplayNames,
    contactCache,
    getContactDisplayName,
    fetchSelectableContacts,
    fetchSelectableGroups,
    getCurrentSocket: () => getCurrentSocket(),
    fetchSavedTestTargetJidsFromDb,
    isUserJid,
    isGroupJid,
  });

  // 9. setupConfigController
  const setupConfigController = createSetupConfigController({
    getConfig: () => getConfig(),
    setConfig: nextConfig => setConfig(nextConfig),
    setCurrentFlowRegistry: registry => setCurrentFlowRegistry(registry),
    setWarnedMissingTestTargets: next => setWarnedMissingTestTargets(next),
    setRuntimeSetupDone: next => setRuntimeSetupDone(next),
    saveUserConfig,
    normalizeUserConfig,
    applyFlowSessionTimeoutOverrides: (registry, currentConfig) => flowSessionController.applyFlowSessionTimeoutOverrides(registry, currentConfig),
    loadFlowRegistryFromConfig: (currentConfig) => flowRegistryController.loadFlowRegistryFromConfig(currentConfig),
    isGroupWhitelistScope,
    getGroupWhitelistJids,
    getAllowedTestJids,
    installLibSignalNoiseFilter,
    getLogger: () => getLogger(),
    initializeRuntimeSchedulers,
    initializeReconnectPolicy,
    getMediaCleanupTimer,
    setMediaCleanupTimer,
    startHandoffMediaMaintenance,
    applyDatabaseRuntimeConfigFromAppConfig,
    startDatabaseMaintenanceScheduler,
    getCurrentSocket: () => getCurrentSocket(),
    startSessionCleanup,
    getActiveFlows: () => flowRegistryController.getActiveFlows(),
    setupFlowWatcher: () => flowRuntimeManager.setupFlowWatcher(),
    setRequiresInitialSetup: next => setRequiresInitialSetup(next),
    setHasSavedConfigAtBoot: next => setHasSavedConfigAtBoot(next),
    ensureWhatsAppRuntimeStarted,
    buildSetupConfigSnapshot,
    toTrimmedStringArray,
    normalizeBroadcastSendIntervalMs,
    runtimeModeProduction: RUNTIME_MODE.PRODUCTION,
  });

  // 10. whatsappRuntime
  const whatsappRuntime = createWhatsAppRuntimeController({
    initializeReconnectPolicy,
    getReconnectController,
    getConfig: () => getConfig(),
    incrementSocketGeneration: () => incrementSocketGeneration(),
    getSocketGeneration: () => getSocketGeneration(),
    getLogger: () => getLogger(),
    setCurrentSocket: sock => setCurrentSocket(sock),
    getCurrentSocket: () => getCurrentSocket(),
    attachOutgoingMessageLogger,
    noteSocketEvent: eventName => runtimeDiagnosticsController.noteSocketEvent(eventName),
    scheduleCredsSave: reason => authStateController.scheduleCredsSave(reason),
    mergeContactList,
    mergeChatsIntoContactCache,
    getContactCache: () => contactCache,
    flushCredsNow: reason => authStateController.flushCredsNow(reason),
    resolveDisconnectReasonName: statusCode => runtimeDiagnosticsController.resolveDisconnectReasonName(statusCode),
    classifyDisconnectCategory: statusCode => runtimeDiagnosticsController.classifyDisconnectCategory(statusCode),
    isLoggedOutDisconnect: statusCode => statusCode === DisconnectReason.loggedOut,
    getWhatsappHealthState: () => whatsappHealthState,
    incrementObjectCounter,
    evaluateRuntimeGuardState: () => runtimeGuardController.evaluateRuntimeGuardState(),
    setRuntimeSetupDone: next => setRuntimeSetupDone(next),
    startSessionCleanup,
    getActiveFlows: () => flowRegistryController.getActiveFlows(),
    initializeTerminalCommands,
    getAllowedTestJids,
    getGroupWhitelistJids,
    enqueueIncomingUpsertMessage: payload => {
      ingestionPipeline.enqueueIncomingUpsertMessage(payload);
    },
    isReloadInProgress: () => flowRuntimeManager.isReloadInProgress(),
    getRuntimeSetupPromise,
    noteSocketCallbackDuration: durationMs => runtimeDiagnosticsController.noteSocketCallbackDuration(durationMs),
  });

  // 11. runtimeLoggingController
  const runtimeLoggingController = createRuntimeLoggingController({
    runtimeModeProduction: RUNTIME_MODE.PRODUCTION,
  });

  // 12. fatalLifecycleController
  const fatalLifecycleController = createFatalLifecycleController({
    fatalLogFile: FATAL_LOG_FILE,
    flushCredsNow: reason => authStateController.flushCredsNow(reason),
    closeReconnectController: () => getReconnectController()?.close?.(),
    releaseInstanceLock: () => instanceLock.release(),
  });

  // 13. authStateController
  const authStateController = createAuthStateController({
    getConfig: () => getConfig(),
    getAuthStorageCache: () => authStorageCache,
    getAuthStateStorageStats,
    getSaveCredsDebounceTimer,
    setSaveCredsDebounceTimer,
    getSaveCredsImmediate,
    getAuthPersistenceStats: () => authPersistenceStats,
    cleanupAuthSignalSessions,
    getAuthCleanupStats: () => authCleanupStats,
    getAuthStateMaintenanceTimer,
    setAuthStateMaintenanceTimer,
  });

  // 14. runtimeInfoController
  const runtimeInfoController = createRuntimeInfoController({
    getConfig: () => getConfig(),
    runtimeModeProduction: RUNTIME_MODE.PRODUCTION,
    getDashboardFlow: () => flowRegistryController.getDashboardFlow(),
    getConversationFlow: () => flowRegistryController.getConversationFlow(),
    getCommandFlows: () => flowRegistryController.getCommandFlows(),
    normalizeDashboardTelemetryLevel,
    resolveDashboardIsolationMode,
    getWhatsAppHealthState: () => whatsappHealthState,
    getRuntimeGuardState: () => runtimeGuardState,
    refreshAuthStateStorageSnapshot,
    getReconnectController,
    trimTimestampWindow,
    readPerMinute,
    toPercentile,
    getAuthPersistenceStats: () => authPersistenceStats,
    getAuthCleanupStats: () => authCleanupStats,
    getAuthStorageCache: () => authStorageCache,
    getHandoffMediaMaintenanceStats: () => handoffMediaMaintenanceStats,
    evaluateRuntimeGuardState: () => runtimeGuardController.evaluateRuntimeGuardState(),
    getEngineRuntimeStats,
    getIngestionRuntimeCounters: () => ingestionRuntimeCounters,
    getRuntimeStatsStartedAt: () => runtimeStatsStartedAt,
    queueSnapshotOrFallback,
    getIngestionQueue,
    getDispatchScheduler,
    getPostProcessQueue,
    getMediaPipelineQueue,
  });

  // 15. maintenanceController
  const maintenanceController = createMaintenanceController({
    handoffMediaDir: HANDOFF_MEDIA_DIR,
    getConfig: () => getConfig(),
    getLogger: () => getLogger(),
    getDatabaseInfo,
    getDbSizeSnapshotMaintenanceTimer,
    setDbSizeSnapshotMaintenanceTimer,
    getMediaCleanupTimer,
    setMediaCleanupTimer,
    getHandoffMediaMaintenanceStats: () => handoffMediaMaintenanceStats,
  });

  // 16. databaseMaintenanceController
  const databaseMaintenanceController = createDatabaseMaintenanceController({
    getConfig: () => getConfig(),
    configureDatabaseRuntime,
    runDatabaseMaintenance,
    getLogger: () => getLogger(),
    getDbMaintenanceTimer,
    setDbMaintenanceTimer,
    dashboardTelemetryLevels: DASHBOARD_TELEMETRY_LEVELS,
  });

  // 17. handoffMediaCaptureController
  const handoffMediaCaptureController = createHandoffMediaCaptureController({
    handoffMediaDir: HANDOFF_MEDIA_DIR,
    allowedIncomingImageMime: ALLOWED_IMAGE_MIME,
    downloadMediaMessage,
    getLogger: () => getLogger(),
    getConfig: () => getConfig(),
    getIngestionRuntimeCounters: () => ingestionRuntimeCounters,
  });

  // 18. flowSessionController
  const flowSessionController = createFlowSessionController({
    getActiveSessions,
    getActiveFlows: () => flowRegistryController.getActiveFlows(),
    getFlowBotType,
    resolveContactDisplayName,
  });

  // 19. messageTelemetryController
  const messageTelemetryController = createMessageTelemetryController({
    addConversationEvent,
    currentPrimaryFlowPathForLogs: () => flowRegistryController.currentPrimaryFlowPathForLogs(),
    broadcastDashboardEvent,
  });

  return {
    instanceLock,
    dashboardBridge,
    ingestionPipeline,
    flowRegistryController,
    flowRuntimeManager,
    setupRuntimeStateController,
    setupConfigController,
    whatsappRuntime,
    runtimeGuardController,
    runtimeDiagnosticsController,
    runtimeLoggingController,
    fatalLifecycleController,
    authStateController,
    runtimeInfoController,
    maintenanceController,
    databaseMaintenanceController,
    handoffMediaCaptureController,
    flowSessionController,
    messageTelemetryController,
  };
}
