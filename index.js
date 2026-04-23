import fs from 'fs';
import path from 'path';
import {
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
} from '@whiskeysockets/baileys';

import {
  initDb,
  addConversationEvent,
  configureDatabaseRuntime,
  getDatabaseRuntimeConfig,
  getDatabaseMaintenanceStatus,
  runDatabaseMaintenance,
  getSession,
  getActiveSessions,
  deleteSession,
  onConversationEvent,
  getDatabaseInfo,
  clearActiveSessions,
  clearActiveSessionsByFlowPath,
  getContactDisplayName,
  listContactDisplayNames,
  upsertContactDisplayName,
} from './db/index.js';
import { cleanupAuthSignalSessions, getAuthStateStorageStats, useSqliteAuthState } from './db/authState.js';
import { getFlowBotType, loadFlows } from './engine/flowLoader.js';
import { parseMessage } from './engine/messageParser.js';
import { getApiMetrics, extractApiName } from './engine/apiMetrics.js';
import {
  handleIncoming,
  getEngineRuntimeStats,
  startSessionCleanup,
  resetActiveSessions,
  resumeSessionFromHumanHandoff,
  endSessionFromDashboard,
  clearEngineRuntimeCaches,
} from './engine/flowEngine.js';
import { configureConversationEventEmitter } from './engine/conversationEvents.js';
import {
  getConfig,
  loadSavedUserConfig,
  normalizeUserConfig,
  saveUserConfig,
  RUNTIME_MODE,
} from './config/index.js';
import { DashboardServer } from './dashboard/server.js';
import { BROADCAST_LIMITS } from './config/constants.js';
import { createBroadcastService } from './engine/broadcastService.js';
import { buildBroadcastMessage } from './engine/broadcastMessageBuilder.js';
import { sendImageMessage, sendTextMessage } from './engine/sender.js';
import {
  fetchSavedTestTargetJidsFromDb,
  fetchSelectableContacts,
  fetchSelectableGroups,
  getAllowedTestJids,
  getGroupWhitelistJids,
  getMessageDebugInfo,
  isGroupJid,
  isGroupWhitelistScope,
  isUserJid,
  mergeChatsIntoContactCache,
  mergeContactCacheEntry,
  mergeContactList,
  normalizeInteractionScope,
  resolveIncomingActorJid,
  shouldProcessByInteractionScope,
  toJidString,
} from './runtime/contactUtils.js';
import { createIngestionQueue } from './runtime/ingestionQueue.js';
import { createReconnectController } from './runtime/reconnectController.js';
import { createTaskScheduler } from './runtime/taskScheduler.js';
import {
  PersistentContactCache,
  normalizePersistableContactName,
} from './runtime/persistentContactCache.js';
import {
  HEALTH_SAMPLE_MAX,
  MINUTE_COUNTER_RETENTION,
  incrementObjectCounter,
  pushSample,
  trimTimestampWindow,
  toPercentile,
  bumpMinuteCounter,
  readPerMinute,
  computeQueuePressurePercent,
} from './runtime/healthMetrics.js';
import { createInstanceLock } from './runtime/instanceLock.js';
import {
  createDashboardBridgeController,
  openDashboardInBrowser as launchDashboardInBrowser,
} from './runtime/dashboardBridge.js';
import { createIngestionPipelineController } from './runtime/ingestionPipeline.js';
import { createWhatsAppRuntimeController } from './runtime/whatsappRuntime.js';
import { createDashboardSettingsSessionHandlers } from './runtime/dashboardSettingsSessionHandlers.js';
import { createDashboardInteractionHandlers } from './runtime/dashboardInteractionHandlers.js';
import { createFlowRuntimeManager } from './runtime/flowRuntimeManager.js';
import { createSetupConfigController } from './runtime/setupConfigController.js';
import { createSetupRuntimeStateController } from './runtime/setupRuntimeState.js';
import { createRuntimeInfoController } from './runtime/runtimeInfoController.js';
import { createMaintenanceController } from './runtime/maintenanceController.js';
import { createDatabaseMaintenanceController } from './runtime/databaseMaintenanceController.js';
import { createHandoffMediaCaptureController } from './runtime/handoffMediaCapture.js';
import { createAuthStateController } from './runtime/authStateController.js';
import { createFlowSessionController } from './runtime/flowSessionController.js';
import { createRuntimeGuardController } from './runtime/runtimeGuardController.js';
import { createRuntimeDiagnosticsController } from './runtime/runtimeDiagnosticsController.js';
import { createRuntimeLoggingController } from './runtime/runtimeLoggingController.js';
import { createFatalLifecycleController } from './runtime/fatalLifecycleController.js';
import { createFlowRegistryController } from './runtime/flowRegistryController.js';
import { createMessageTelemetryController } from './runtime/messageTelemetryController.js';

let config;
let logger;
let currentFlowRegistry = {
  all: [],
  byPath: new Map(),
  byBotType: { conversation: [], command: [] },
  conversationFlow: null,
  commandFlows: [],
};
let currentSocket = null;
let runtimeSetupPromise = null;
let runtimeSetupDone = false;
let warnedMissingTestTargets = false;
let dashboardServer = null;
let removeConversationEventListener = null;
let authStateMaintenanceTimer = null;
let dbSizeSnapshotMaintenanceTimer = null;
let dbMaintenanceTimer = null;
let broadcastService = null;
let hasSavedConfigAtBoot = false;
let requiresInitialSetup = false;
let whatsappRuntimeStarted = false;
let whatsappRuntimeStartPromise = null;
let socketGeneration = 0;
let dashboardAutoOpenAttempted = false;
let ingestionQueue = null;
let dispatchScheduler = null;
let postProcessQueue = null;
let mediaPipelineQueue = null;
const runtimeStatsStartedAt = Date.now();
const DASHBOARD_TELEMETRY_LEVELS = new Set(['minimum', 'operational', 'diagnostic', 'verbose']);
const ingestionRuntimeCounters = {
  received: 0,
  parseDropped: 0,
  filteredOut: 0,
  queueOverflowDropped: 0,
  duplicateDropped: 0,
  processedMessages: 0,
  processingFailed: 0,
  parseMsTotal: 0,
  routingMsTotal: 0,
  totalMsTotal: 0,
  postTasksQueued: 0,
  postTasksDropped: 0,
  postTasksFailed: 0,
  mediaQueued: 0,
  mediaCaptured: 0,
  mediaCaptureFailed: 0,
  mediaQueueDropped: 0,
  mediaTooLargeDropped: 0,
  mediaDroppedByDegradedMode: 0,
  postTasksDroppedByDegradedMode: 0,
};


const contactCache = new PersistentContactCache({
  onPersistName: ({ jid, name }) => {
    upsertContactDisplayName({
      jid,
      displayName: name,
      source: 'runtime-cache',
      updatedAt: Date.now(),
    });
  },
});
const HANDOFF_MEDIA_DIR = path.resolve('./data/handoff-media');
const ALLOWED_INCOMING_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);


const FATAL_LOG_FILE = path.resolve('./fatal-error.log');
const RUNTIME_LOCK_FILE = path.resolve('./data/runtime-single-instance.lock');

const disconnectReasonNameByCode = new Map(
  Object.entries(DisconnectReason).map(([name, code]) => [Number(code), String(name)])
);

let reconnectController = null;
let saveCredsImmediate = null;
let saveCredsDebounceTimer = null;
let mediaCleanupTimer = null;

// Single-instance lock — protects against multiple concurrent runtimes.
const instanceLock = createInstanceLock(RUNTIME_LOCK_FILE);
const dashboardBridge = createDashboardBridgeController({
  getLogger: () => logger,
});
const ingestionPipeline = createIngestionPipelineController({
  getConfig: () => config,
  getLogger: () => logger,
  getRuntimeGuardState: () => runtimeGuardState,
  getIngestionRuntimeCounters: () => ingestionRuntimeCounters,
  getPostProcessQueue: () => postProcessQueue,
  getMediaPipelineQueue: () => mediaPipelineQueue,
  getDispatchScheduler: () => dispatchScheduler,
  getIngestionQueue: () => ingestionQueue,
  getContactCache: () => contactCache,
  getWhatsappHealthState: () => whatsappHealthState,
  getWarnedMissingTestTargets: () => warnedMissingTestTargets,
  setWarnedMissingTestTargets: next => {
    warnedMissingTestTargets = Boolean(next);
  },
  maybeLogThroughputPressure,
  noteQueueLag,
  evaluateRuntimeGuardState,
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
  getActiveFlows,
  handleIncoming,
  formatError,
  bumpMinuteCounter,
});
const flowRegistryController = createFlowRegistryController({
  getCurrentFlowRegistry: () => currentFlowRegistry,
  getConfig: () => config,
  loadFlows,
  runtimeModeDevelopment: RUNTIME_MODE.DEVELOPMENT,
});
const flowRuntimeManager = createFlowRuntimeManager({
  getConfig: () => config,
  isDevelopmentMode,
  getActiveFlows,
  resetActiveSessions,
  loadFlowRegistryFromConfig,
  applyFlowSessionTimeoutOverrides,
  setCurrentFlowRegistry: registry => {
    currentFlowRegistry = registry;
  },
  setWarnedMissingTestTargets: next => {
    warnedMissingTestTargets = Boolean(next);
  },
  getCurrentSocket: () => currentSocket,
  startSessionCleanup,
  logConversationEvent,
  currentPrimaryFlowPathForLogs,
});
const setupRuntimeStateController = createSetupRuntimeStateController({
  getConfig: () => config,
  runtimeModeProduction: RUNTIME_MODE.PRODUCTION,
  toTrimmedStringArray,
  listContactDisplayNames,
  contactCache,
  getContactDisplayName,
  fetchSelectableContacts,
  fetchSelectableGroups,
  getCurrentSocket: () => currentSocket,
  fetchSavedTestTargetJidsFromDb,
  isUserJid,
  isGroupJid,
});
const setupConfigController = createSetupConfigController({
  getConfig: () => config,
  setConfig: nextConfig => {
    config = nextConfig;
  },
  setCurrentFlowRegistry: registry => {
    currentFlowRegistry = registry;
  },
  setWarnedMissingTestTargets: next => {
    warnedMissingTestTargets = Boolean(next);
  },
  setRuntimeSetupDone: next => {
    runtimeSetupDone = Boolean(next);
  },
  saveUserConfig,
  normalizeUserConfig,
  applyFlowSessionTimeoutOverrides,
  loadFlowRegistryFromConfig,
  isGroupWhitelistScope,
  getGroupWhitelistJids,
  getAllowedTestJids,
  installLibSignalNoiseFilter,
  getLogger: () => logger,
  initializeRuntimeSchedulers,
  initializeReconnectPolicy,
  getMediaCleanupTimer: () => mediaCleanupTimer,
  setMediaCleanupTimer: next => {
    mediaCleanupTimer = next;
  },
  startHandoffMediaMaintenance,
  applyDatabaseRuntimeConfigFromAppConfig,
  startDatabaseMaintenanceScheduler,
  getCurrentSocket: () => currentSocket,
  startSessionCleanup,
  getActiveFlows,
  setupFlowWatcher: () => flowRuntimeManager.setupFlowWatcher(),
  setRequiresInitialSetup: next => {
    requiresInitialSetup = Boolean(next);
  },
  setHasSavedConfigAtBoot: next => {
    hasSavedConfigAtBoot = Boolean(next);
  },
  ensureWhatsAppRuntimeStarted,
  buildSetupConfigSnapshot,
  toTrimmedStringArray,
  normalizeBroadcastSendIntervalMs,
  runtimeModeProduction: RUNTIME_MODE.PRODUCTION,
});
const whatsappRuntime = createWhatsAppRuntimeController({
  initializeReconnectPolicy,
  getReconnectController: () => reconnectController,
  getConfig: () => config,
  incrementSocketGeneration: () => {
    socketGeneration += 1;
    return socketGeneration;
  },
  getSocketGeneration: () => socketGeneration,
  getLogger: () => logger,
  setCurrentSocket: sock => {
    currentSocket = sock;
  },
  getCurrentSocket: () => currentSocket,
  attachOutgoingMessageLogger,
  noteSocketEvent,
  scheduleCredsSave,
  mergeContactList,
  mergeChatsIntoContactCache,
  getContactCache: () => contactCache,
  flushCredsNow,
  resolveDisconnectReasonName,
  classifyDisconnectCategory,
  isLoggedOutDisconnect: statusCode => statusCode === DisconnectReason.loggedOut,
  getWhatsappHealthState: () => whatsappHealthState,
  incrementObjectCounter,
  evaluateRuntimeGuardState,
  setRuntimeSetupDone: next => {
    runtimeSetupDone = Boolean(next);
  },
  startSessionCleanup,
  getActiveFlows,
  initializeTerminalCommands,
  getAllowedTestJids,
  getGroupWhitelistJids,
  enqueueIncomingUpsertMessage: payload => {
    ingestionPipeline.enqueueIncomingUpsertMessage(payload);
  },
  isReloadInProgress: () => flowRuntimeManager.isReloadInProgress(),
  getRuntimeSetupPromise: () => runtimeSetupPromise,
  noteSocketCallbackDuration,
});

const authPersistenceStats = {
  updateEvents: 0,
  debouncedFlushes: 0,
  writeAttempts: 0,
  writeErrors: 0,
  totalWriteMs: 0,
  lastWriteAt: 0,
  lastFlushDurationMs: 0,
  lastFlushReason: '',
  lastError: '',
};

const authCleanupStats = {
  runs: 0,
  changedRows: 0,
  deletedRows: 0,
  removedSessions: 0,
  lastSummary: null,
  lastRunAt: 0,
};

const authStorageCache = {
  snapshot: {
    totalRows: 0,
    totalValueBytes: 0,
    sessionRows: 0,
    sessionValueBytes: 0,
    updatedAt: 0,
  },
  lastRefreshAt: 0,
  refreshErrors: 0,
};

const runtimeGuardState = {
  degradedMode: false,
  reason: 'normal',
  changedAt: Date.now(),
  toggles: 0,
  totalDegradedMs: 0,
  lastEnteredAt: 0,
  droppedPostTasks: 0,
  droppedMediaTasks: 0,
};
const runtimeGuardController = createRuntimeGuardController({
  getRuntimeGuardState: () => runtimeGuardState,
  getConfig: () => config,
  getLogger: () => logger,
  queueSnapshotOrFallback,
  getIngestionQueue: () => ingestionQueue,
  getMediaPipelineQueue: () => mediaPipelineQueue,
  getReconnectController: () => reconnectController,
  computeQueuePressurePercent,
});

const handoffMediaMaintenanceStats = {
  runs: 0,
  deletedFiles: 0,
  deletedBytes: 0,
  lastRunAt: 0,
  lastDurationMs: 0,
  lastError: '',
  lastSummary: null,
};

const whatsappHealthState = {
  startedAt: Date.now(),
  connectedSince: 0,
  lastConnectedAt: 0,
  lastDisconnectedAt: 0,
  totalConnectedMs: 0,
  lastDisconnectDurationMs: 0,
  disconnectCount: 0,
  disconnectByStatusCode: {},
  disconnectByCategory: {},
  reconnectHistory: [],
  successfulReconnectHistory: [],
  events: {
    connectionUpdate: 0,
    messagesUpsert: 0,
    credsUpdate: 0,
  },
  callback: {
    calls: 0,
    totalMs: 0,
    maxMs: 0,
    lastMs: 0,
    samples: [],
  },
  queueLag: {
    count: 0,
    totalMs: 0,
    maxMs: 0,
    samples: [],
  },
  sendFailuresByCategory: {},
  minuteCounters: {
    incoming: new Map(),
    outgoingTotal: new Map(),
    outgoingService: new Map(),
    outgoingBroadcast: new Map(),
    events: new Map(),
    messagesUpsert: new Map(),
    connectionUpdate: new Map(),
    credsUpdate: new Map(),
  },
};
const runtimeDiagnosticsController = createRuntimeDiagnosticsController({
  disconnectReasonNameByCode,
  getConfig: () => config,
  getLogger: () => logger,
  getWhatsappHealthState: () => whatsappHealthState,
  readPerMinute,
  bumpMinuteCounter,
  pushSample,
});
const runtimeLoggingController = createRuntimeLoggingController({
  runtimeModeProduction: RUNTIME_MODE.PRODUCTION,
});
const fatalLifecycleController = createFatalLifecycleController({
  fatalLogFile: FATAL_LOG_FILE,
  flushCredsNow: reason => flushCredsNow(reason),
  closeReconnectController: () => reconnectController?.close?.(),
  releaseInstanceLock: () => instanceLock.release(),
});
const authStateController = createAuthStateController({
  getConfig: () => config,
  getAuthStorageCache: () => authStorageCache,
  getAuthStateStorageStats,
  getSaveCredsDebounceTimer: () => saveCredsDebounceTimer,
  setSaveCredsDebounceTimer: next => {
    saveCredsDebounceTimer = next;
  },
  getSaveCredsImmediate: () => saveCredsImmediate,
  getAuthPersistenceStats: () => authPersistenceStats,
  cleanupAuthSignalSessions,
  getAuthCleanupStats: () => authCleanupStats,
  getAuthStateMaintenanceTimer: () => authStateMaintenanceTimer,
  setAuthStateMaintenanceTimer: next => {
    authStateMaintenanceTimer = next;
  },
});
const runtimeInfoController = createRuntimeInfoController({
  getConfig: () => config,
  runtimeModeProduction: RUNTIME_MODE.PRODUCTION,
  getDashboardFlow,
  getConversationFlow,
  getCommandFlows,
  normalizeDashboardTelemetryLevel,
  resolveDashboardIsolationMode,
  getWhatsAppHealthState: () => whatsappHealthState,
  getRuntimeGuardState: () => runtimeGuardState,
  refreshAuthStateStorageSnapshot,
  getReconnectController: () => reconnectController,
  trimTimestampWindow,
  readPerMinute,
  toPercentile,
  getAuthPersistenceStats: () => authPersistenceStats,
  getAuthCleanupStats: () => authCleanupStats,
  getAuthStorageCache: () => authStorageCache,
  getHandoffMediaMaintenanceStats: () => handoffMediaMaintenanceStats,
  evaluateRuntimeGuardState,
  getEngineRuntimeStats,
  getIngestionRuntimeCounters: () => ingestionRuntimeCounters,
  getRuntimeStatsStartedAt: () => runtimeStatsStartedAt,
  queueSnapshotOrFallback,
  getIngestionQueue: () => ingestionQueue,
  getDispatchScheduler: () => dispatchScheduler,
  getPostProcessQueue: () => postProcessQueue,
  getMediaPipelineQueue: () => mediaPipelineQueue,
});
const maintenanceController = createMaintenanceController({
  handoffMediaDir: HANDOFF_MEDIA_DIR,
  getConfig: () => config,
  getLogger: () => logger,
  getDatabaseInfo,
  getDbSizeSnapshotMaintenanceTimer: () => dbSizeSnapshotMaintenanceTimer,
  setDbSizeSnapshotMaintenanceTimer: next => {
    dbSizeSnapshotMaintenanceTimer = next;
  },
  getMediaCleanupTimer: () => mediaCleanupTimer,
  setMediaCleanupTimer: next => {
    mediaCleanupTimer = next;
  },
  getHandoffMediaMaintenanceStats: () => handoffMediaMaintenanceStats,
});
const databaseMaintenanceController = createDatabaseMaintenanceController({
  getConfig: () => config,
  configureDatabaseRuntime,
  runDatabaseMaintenance,
  getLogger: () => logger,
  getDbMaintenanceTimer: () => dbMaintenanceTimer,
  setDbMaintenanceTimer: next => {
    dbMaintenanceTimer = next;
  },
  dashboardTelemetryLevels: DASHBOARD_TELEMETRY_LEVELS,
});
const handoffMediaCaptureController = createHandoffMediaCaptureController({
  handoffMediaDir: HANDOFF_MEDIA_DIR,
  allowedIncomingImageMime: ALLOWED_INCOMING_IMAGE_MIME,
  downloadMediaMessage,
  getLogger: () => logger,
  getConfig: () => config,
  getIngestionRuntimeCounters: () => ingestionRuntimeCounters,
});
const flowSessionController = createFlowSessionController({
  getActiveSessions,
  getActiveFlows,
  getFlowBotType,
  resolveContactDisplayName,
});
const messageTelemetryController = createMessageTelemetryController({
  addConversationEvent,
  currentPrimaryFlowPathForLogs: () => currentPrimaryFlowPathForLogs(),
  broadcastDashboardEvent: event => broadcastDashboardEvent(event),
});


function normalizeErrorCategory(error) {
  return runtimeDiagnosticsController.normalizeErrorCategory(error);
}

function resolveDisconnectReasonName(statusCode) {
  return runtimeDiagnosticsController.resolveDisconnectReasonName(statusCode);
}

function classifyDisconnectCategory(statusCode) {
  return runtimeDiagnosticsController.classifyDisconnectCategory(statusCode);
}

function maybeLogThroughputPressure() {
  runtimeDiagnosticsController.maybeLogThroughputPressure();
}


function formatError(err) {
  return fatalLifecycleController.formatError(err);
}

function appendFatalLog(prefix, err) {
  fatalLifecycleController.appendFatalLog(prefix, err);
}

async function waitForEnter(message) {
  await fatalLifecycleController.waitForEnter(message);
}

function refreshAuthStateStorageSnapshot({ force = false } = {}) {
  return authStateController.refreshAuthStateStorageSnapshot({ force });
}

function clearCredsDebounceTimer() {
  authStateController.clearCredsDebounceTimer();
}

function flushCredsNow(reason = 'manual') {
  return authStateController.flushCredsNow(reason);
}

function scheduleCredsSave(reason = 'update') {
  authStateController.scheduleCredsSave(reason);
}

function setRuntimeDegradedMode(nextActive, reason = 'normal') {
  runtimeGuardController.setRuntimeDegradedMode(nextActive, reason);
}

function evaluateRuntimeGuardState() {
  runtimeGuardController.evaluateRuntimeGuardState();
}

function noteSocketEvent(eventName) {
  runtimeDiagnosticsController.noteSocketEvent(eventName);
}

function noteSocketCallbackDuration(durationMs) {
  runtimeDiagnosticsController.noteSocketCallbackDuration(durationMs);
}

function noteQueueLag(durationMs) {
  runtimeDiagnosticsController.noteQueueLag(durationMs);
}

async function handleFatal(prefix, err) {
  await fatalLifecycleController.handleFatal(prefix, err);
}
fatalLifecycleController.registerProcessHandlers();

function installLibSignalNoiseFilter(enabled) {
  runtimeLoggingController.installLibSignalNoiseFilter(enabled);
}

function createRuntimeLogger(currentConfig) {
  return runtimeLoggingController.createRuntimeLogger(currentConfig);
}

function isDevelopmentMode(currentConfig) {
  return flowRegistryController.isDevelopmentMode(currentConfig);
}

function getActiveFlows() {
  return flowRegistryController.getActiveFlows();
}

function getConversationFlow() {
  return flowRegistryController.getConversationFlow();
}

function getCommandFlows() {
  return flowRegistryController.getCommandFlows();
}

function getDashboardFlow() {
  return flowRegistryController.getDashboardFlow();
}

function currentPrimaryFlowPathForLogs() {
  return flowRegistryController.currentPrimaryFlowPathForLogs();
}

function resolveConfiguredFlowPaths(currentConfig) {
  return flowRegistryController.resolveConfiguredFlowPaths(currentConfig);
}

function loadFlowRegistryFromConfig(currentConfig) {
  return flowRegistryController.loadFlowRegistryFromConfig(currentConfig);
}

function normalizeTimeoutMinutes(value) {
  return flowSessionController.normalizeTimeoutMinutes(value);
}

function applyFlowSessionTimeoutOverrides(registry, currentConfig) {
  return flowSessionController.applyFlowSessionTimeoutOverrides(registry, currentConfig);
}

function getFlowSessionTimeoutMinutes(flow) {
  return flowSessionController.getFlowSessionTimeoutMinutes(flow);
}

function parseHumanHandoff(value) {
  return flowSessionController.parseHumanHandoff(value);
}

function buildSessionManagementOverview() {
  return flowSessionController.buildSessionManagementOverview();
}

function listSessionManagementFlows() {
  return flowSessionController.listSessionManagementFlows();
}

function listActiveSessionsForManagement({ search = '', limit = 200 } = {}) {
  return flowSessionController.listActiveSessionsForManagement({ search, limit });
}

function logConversationEvent({
  occurredAt = Date.now(),
  eventType = 'message',
  direction = 'system',
  jid = 'unknown',
  flowPath = '',
  messageText = '',
  metadata = {},
}) {
  messageTelemetryController.logConversationEvent({
    occurredAt,
    eventType,
    direction,
    jid,
    flowPath,
    messageText,
    metadata,
  });
}

function emitDashboardBroadcastProgress({
  actor = 'dashboard-agent',
  target = 'all',
  campaignId = 0,
  attempted = 0,
  processed = 0,
  sent = 0,
  failed = 0,
  cancelled = 0,
  remaining = 0,
  percent = 0,
  status = 'sending',
  controlStatus = 'running',
  jid = '',
  recipientType = '',
  recipientStatus = '',
  recipientCounts = null,
  error = '',
  metrics = null,
} = {}) {
  messageTelemetryController.emitDashboardBroadcastProgress({
    actor,
    target,
    campaignId,
    attempted,
    processed,
    sent,
    failed,
    cancelled,
    remaining,
    percent,
    status,
    controlStatus,
    jid,
    recipientType,
    recipientStatus,
    recipientCounts,
    error,
    metrics,
  });
}

function extractOutgoingMessageText(content) {
  return messageTelemetryController.extractOutgoingMessageText(content);
}

function extractOutgoingKind(content) {
  return messageTelemetryController.extractOutgoingKind(content);
}

function extractApiHostFromTemplateUrl(rawUrl) {
  return messageTelemetryController.extractApiHostFromTemplateUrl(rawUrl);
}

function saveIncomingHandoffImage({ buffer, mimeType, fileName = '' }) {
  return handoffMediaCaptureController.saveIncomingHandoffImage({ buffer, mimeType, fileName });
}

async function captureIncomingImageForDashboard({ msg, sock, mimeType, fileName }) {
  return handoffMediaCaptureController.captureIncomingImageForDashboard({
    msg,
    sock,
    mimeType,
    fileName,
  });
}

function cleanupSignalAuthState({ reason = 'manual', forceLog = false } = {}) {
  return authStateController.cleanupSignalAuthState({ reason, forceLog });
}

function startAuthStateMaintenance() {
  authStateController.startAuthStateMaintenance();
}

function attachOutgoingMessageLogger(sock) {
  if (!sock || sock.__tmbSendMessageWrapped) return;

  const original = sock.sendMessage.bind(sock);
  sock.sendMessage = async (jid, content, options) => {
    const safeOptions = options && typeof options === 'object' ? { ...options } : {};
    const skipConversationLog = safeOptions.__skipConversationLog === true;
    const flowPath = String(safeOptions.__flowPath || '').trim();
    const sendSource = String(safeOptions.__sendSource || 'service').trim().toLowerCase() === 'broadcast'
      ? 'broadcast'
      : 'service';
    delete safeOptions.__skipConversationLog;
    delete safeOptions.__flowPath;
    delete safeOptions.__sendSource;

    const text = extractOutgoingMessageText(content);
    const kind = extractOutgoingKind(content);

    try {
      const result = await original(jid, content, safeOptions);
      bumpMinuteCounter(whatsappHealthState.minuteCounters.outgoingTotal, Date.now());
      if (sendSource === 'broadcast') {
        bumpMinuteCounter(whatsappHealthState.minuteCounters.outgoingBroadcast, Date.now());
      } else {
        bumpMinuteCounter(whatsappHealthState.minuteCounters.outgoingService, Date.now());
      }
      maybeLogThroughputPressure();
      if (!skipConversationLog) {
        logConversationEventAsync({
          eventType: 'message-outgoing',
          direction: 'outgoing',
          jid,
          flowPath,
          messageText: text,
          metadata: { kind, source: sendSource },
        }, { key: jid });
      }
      return result;
    } catch (err) {
      incrementObjectCounter(whatsappHealthState.sendFailuresByCategory, normalizeErrorCategory(err));
      if (!skipConversationLog) {
        logConversationEventAsync({
          eventType: 'message-outgoing-error',
          direction: 'system',
          jid,
          flowPath,
          messageText: text,
          metadata: {
            kind,
            source: sendSource,
            error: formatError(err),
          },
        }, { key: jid });
      }
      throw err;
    }
  };

  sock.__tmbSendMessageWrapped = true;
}

function queueSnapshotOrFallback(queue, fallback = {}) {
  if (!queue || typeof queue.getSnapshot !== 'function') return { ...fallback };
  return queue.getSnapshot();
}

function getWhatsAppHealthSnapshot() {
  return runtimeInfoController.getWhatsAppHealthSnapshot();
}

function getIngestionSnapshot() {
  return runtimeInfoController.getIngestionSnapshot();
}

function initializeRuntimeSchedulers(currentConfig) {
  ingestionQueue = createIngestionQueue({
    concurrency: Number(currentConfig?.ingestionConcurrency ?? 8),
    maxQueueSize: Number(currentConfig?.ingestionQueueMax ?? 5000),
    warnThreshold: Number(currentConfig?.ingestionQueueWarnThreshold ?? 1000),
    onWarn: (snapshot) => {
      logger?.warn?.(
        {
          queued: snapshot?.queued ?? 0,
          running: snapshot?.running ?? 0,
          maxQueueSize: snapshot?.maxQueueSize ?? 0,
          rejected: snapshot?.rejected ?? 0,
        },
        'Ingestion queue backlog reached warn threshold'
      );
    },
  });

  dispatchScheduler = createTaskScheduler({
    globalConcurrency: Number(currentConfig?.schedulerGlobalConcurrency ?? 16),
    maxPerJid: Number(currentConfig?.schedulerPerJidConcurrency ?? 1),
    maxPerFlowPath: Number(currentConfig?.schedulerPerFlowPathConcurrency ?? 4),
    maxQueueSize: 20000,
    warnThreshold: 5000,
    onWarn: (snapshot) => {
      logger?.warn?.(
        {
          queued: snapshot?.queued ?? 0,
          running: snapshot?.running ?? 0,
          rejected: snapshot?.rejected ?? 0,
        },
        'Dispatch scheduler backlog reached warn threshold'
      );
    },
  });

  postProcessQueue = createIngestionQueue({
    concurrency: Number(currentConfig?.postProcessConcurrency ?? 2),
    maxQueueSize: Number(currentConfig?.postProcessQueueMax ?? 5000),
    warnThreshold: Math.min(Number(currentConfig?.postProcessQueueMax ?? 5000), 1000),
    onWarn: (snapshot) => {
      logger?.warn?.(
        {
          queued: snapshot?.queued ?? 0,
          running: snapshot?.running ?? 0,
          maxQueueSize: snapshot?.maxQueueSize ?? 0,
          rejected: snapshot?.rejected ?? 0,
        },
        'Post-processing queue backlog reached warn threshold'
      );
    },
  });

  mediaPipelineQueue = createIngestionQueue({
    concurrency: Number(currentConfig?.mediaPipelineConcurrency ?? 2),
    maxQueueSize: Number(currentConfig?.mediaPipelineQueueMax ?? 500),
    warnThreshold: Math.min(Number(currentConfig?.mediaPipelineQueueMax ?? 500), 100),
    onWarn: (snapshot) => {
      logger?.warn?.(
        {
          queued: snapshot?.queued ?? 0,
          running: snapshot?.running ?? 0,
          maxQueueSize: snapshot?.maxQueueSize ?? 0,
          rejected: snapshot?.rejected ?? 0,
        },
        'Media pipeline queue backlog reached warn threshold'
      );
    },
  });

  configureConversationEventEmitter((event = {}) => {
    const queueKey = String(event?.jid || event?.flowPath || 'conversation-events');
    logConversationEventAsync(event, { key: queueKey });
  });
}

function initializeReconnectPolicy(currentConfig) {
  reconnectController?.close?.();
  reconnectController = createReconnectController({
    minDelayMs: Number(currentConfig?.whatsappReconnectBaseDelayMs ?? 3000),
    maxDelayMs: Number(currentConfig?.whatsappReconnectMaxDelayMs ?? 60000),
    backoffMultiplier: Number(currentConfig?.whatsappReconnectBackoffMultiplier ?? 2),
    jitterRatio: Math.max(0, Number(currentConfig?.whatsappReconnectJitterPct ?? 20) / 100),
    attemptWindowMs: Number(currentConfig?.whatsappReconnectAttemptsWindowMs ?? (10 * 60 * 1000)),
    maxAttemptsPerWindow: Number(currentConfig?.whatsappReconnectMaxAttemptsPerWindow ?? 12),
    cooldownMs: Number(currentConfig?.whatsappReconnectCooldownMs ?? (2 * 60 * 1000)),
  });
}

function normalizeRuntimeInfo() {
  return runtimeInfoController.normalizeRuntimeInfo();
}

function startDbSizeSnapshotMaintenance() {
  maintenanceController.startDbSizeSnapshotMaintenance();
}

function cleanupHandoffMediaFiles({ reason = 'manual' } = {}) {
  return maintenanceController.cleanupHandoffMediaFiles({ reason });
}

function startHandoffMediaMaintenance() {
  maintenanceController.startHandoffMediaMaintenance();
}

function normalizeBroadcastSendIntervalMs(value) {
  return databaseMaintenanceController.normalizeBroadcastSendIntervalMs(value);
}

function normalizeDashboardTelemetryLevel(value) {
  return databaseMaintenanceController.normalizeDashboardTelemetryLevel(value);
}

function normalizeDbMaintenanceIntervalMinutes(value) {
  return databaseMaintenanceController.normalizeDbMaintenanceIntervalMinutes(value);
}

function normalizeDbRetentionDays(value) {
  return databaseMaintenanceController.normalizeDbRetentionDays(value);
}

function normalizeDbEventBatchFlushMs(value) {
  return databaseMaintenanceController.normalizeDbEventBatchFlushMs(value);
}

function normalizeDbEventBatchSize(value) {
  return databaseMaintenanceController.normalizeDbEventBatchSize(value);
}

function toBooleanOrNull(value) {
  return databaseMaintenanceController.toBooleanOrNull(value);
}

function buildDatabaseRuntimeConfigFromCurrentConfig(currentConfig = config) {
  return databaseMaintenanceController.buildDatabaseRuntimeConfigFromCurrentConfig(currentConfig);
}

function applyDatabaseRuntimeConfigFromAppConfig(currentConfig = config) {
  return databaseMaintenanceController.applyDatabaseRuntimeConfigFromAppConfig(currentConfig);
}

function stopDatabaseMaintenanceScheduler() {
  databaseMaintenanceController.stopDatabaseMaintenanceScheduler();
}

function startDatabaseMaintenanceScheduler() {
  databaseMaintenanceController.startDatabaseMaintenanceScheduler();
}

function toTrimmedStringArray(value) {
  if (!Array.isArray(value)) return [];
  const dedup = new Set();
  const result = [];
  for (const item of value) {
    const normalized = String(item ?? '').trim();
    if (!normalized || dedup.has(normalized)) continue;
    dedup.add(normalized);
    result.push(normalized);
  }
  return result;
}

function buildSetupConfigSnapshot() {
  return setupRuntimeStateController.buildSetupConfigSnapshot();
}

function hydrateContactCacheFromDb(limit = 10000) {
  return setupRuntimeStateController.hydrateContactCacheFromDb(limit);
}

function resolveContactDisplayName(jid) {
  return setupRuntimeStateController.resolveContactDisplayName(jid);
}

async function listSetupSelectableTargets({ search = '', limit = 300 } = {}) {
  return setupRuntimeStateController.listSetupSelectableTargets({ search, limit });
}

function normalizeSetupPatch(input = {}) {
  return setupConfigController.normalizeSetupPatch(input);
}

function openDashboardInBrowser(url) {
  if (dashboardAutoOpenAttempted) return;
  dashboardAutoOpenAttempted = true;
  launchDashboardInBrowser(url);
}

function resolveDashboardIsolationMode() {
  const envMode = String(process.env.TMB_DASHBOARD_ISOLATION_MODE || '').trim().toLowerCase();
  if (envMode === 'process') return 'process';
  if (envMode === 'inline') return 'inline';
  return String(config?.dashboardIsolationMode || 'inline').trim().toLowerCase() === 'process'
    ? 'process'
    : 'inline';
}

function getDashboardPublicUrl() {
  return `http://${config.dashboardHost}:${config.dashboardPort}`;
}

function stopDashboardStateSync() {
  dashboardBridge.stopDashboardStateSync();
}

function sendDashboardBridgeState() {
  dashboardBridge.sendDashboardBridgeState();
}

function broadcastDashboardEvent(event = {}) {
  dashboardBridge.broadcastDashboardEvent(event, dashboardServer);
}

async function stopDashboardIsolatedProcess() {
  await dashboardBridge.stopDashboardIsolatedProcess();
}

async function startDashboardIsolatedProcess(options = {}) {
  return dashboardBridge.startDashboardIsolatedProcess({
    handlers: options,
    host: config.dashboardHost,
    port: config.dashboardPort,
    childScript: path.resolve('./dashboard/isolatedProcess.js'),
    publicUrl: getDashboardPublicUrl(),
  });
}

async function applyRuntimeConfigFromDashboard(input = {}) {
  return setupConfigController.applyRuntimeConfigFromDashboard(input);
}

async function ensureWhatsAppRuntimeStarted() {
  if (whatsappRuntimeStarted) return;
  if (whatsappRuntimeStartPromise) {
    await whatsappRuntimeStartPromise;
    return;
  }

  whatsappRuntimeStartPromise = (async () => {
    const { state, saveCreds } = useSqliteAuthState();
    saveCredsImmediate = saveCreds;
    refreshAuthStateStorageSnapshot({ force: true });
    const { version } = await fetchLatestBaileysVersion();
    console.log(`Versao Baileys: ${version.join('.')}\n`);
    await connectToWhatsApp({ state, version });
    whatsappRuntimeStarted = true;
  })();

  try {
    await whatsappRuntimeStartPromise;
  } finally {
    if (!whatsappRuntimeStarted) {
      whatsappRuntimeStartPromise = null;
    }
  }
}

async function startDashboardServer() {
  if (dashboardServer) {
    await dashboardServer.stop();
    dashboardServer = null;
  }
  await stopDashboardIsolatedProcess();

  const dashboardOptions = {
    host: config.dashboardHost,
    port: config.dashboardPort,
    logger,
    ...createDashboardInteractionHandlers({
      normalizeRuntimeInfo,
      getRequiresInitialSetup: () => requiresInitialSetup,
      getActiveFlows,
      extractApiHostFromTemplateUrl,
      getApiMetrics,
      getDashboardFlow,
      resolveContactDisplayName,
      reloadFlow,
      getCurrentSocket: () => currentSocket,
      sendTextMessage,
      sendImageMessage,
      logConversationEvent,
      resumeSessionFromHumanHandoff,
      endSessionFromDashboard,
      getBroadcastService: () => broadcastService,
      buildBroadcastMessage,
      emitDashboardBroadcastProgress,
      getLogger: () => logger,
      getHasSavedConfigAtBoot: () => hasSavedConfigAtBoot,
      buildSetupConfigSnapshot,
      applyRuntimeConfigFromDashboard,
      listSetupSelectableTargets,
    }),
    ...createDashboardSettingsSessionHandlers({
      getConfig: () => config,
      setConfig: nextConfig => {
        config = nextConfig;
      },
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
      getContactCache: () => contactCache,
      getLogger: () => logger,
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
    }),
  };

  dashboardBridge.setRpcHandlers(dashboardOptions);
  const isolationMode = resolveDashboardIsolationMode();
  let dashboardUrl = getDashboardPublicUrl();
  if (isolationMode === 'process') {
    try {
      dashboardUrl = await startDashboardIsolatedProcess(dashboardOptions);
    } catch (error) {
      await stopDashboardIsolatedProcess();
      logger?.warn?.(
        { error: String(error?.message || error || 'dashboard-bridge-start-failed') },
        'Isolated dashboard process failed to start, falling back to inline mode'
      );
      dashboardServer = new DashboardServer(dashboardOptions);
      await dashboardServer.start();
    }
  } else {
    dashboardServer = new DashboardServer(dashboardOptions);
    await dashboardServer.start();
    sendDashboardBridgeState();
  }

  if (removeConversationEventListener) {
    removeConversationEventListener();
  }
  removeConversationEventListener = onConversationEvent(event => {
    broadcastDashboardEvent(event);
  });

  console.log(`Dashboard HTTP: ${dashboardUrl}`);
  openDashboardInBrowser(dashboardUrl);
}

function stopFlowWatcher() {
  flowRuntimeManager.stopFlowWatcher();
}

function setupFlowWatcher() {
  flowRuntimeManager.setupFlowWatcher();
}

async function reloadFlow({ source = 'manual' } = {}) {
  await flowRuntimeManager.reloadFlow({ source });
}

function initializeTerminalCommands() {
  flowRuntimeManager.initializeTerminalCommands();
}

async function start() {
  console.log('Iniciando Interpretador de Bot WhatsApp...\n');

  flowRuntimeManager.resetState();
  runtimeSetupPromise = null;
  runtimeSetupDone = false;
  warnedMissingTestTargets = false;
  dashboardAutoOpenAttempted = false;

  const savedConfig = loadSavedUserConfig();
  hasSavedConfigAtBoot = Boolean(savedConfig);
  requiresInitialSetup = !hasSavedConfigAtBoot;

  config = await getConfig({ interactive: false });
  instanceLock.acquire();

  const suppressSignalNoise =
    config.runtimeMode === RUNTIME_MODE.PRODUCTION &&
    String(process.env.TMB_SUPPRESS_SIGNAL_NOISE ?? '1') !== '0';
  installLibSignalNoiseFilter(suppressSignalNoise);

  logger = createRuntimeLogger(config);
  initializeRuntimeSchedulers(config);
  initializeReconnectPolicy(config);
  broadcastService = createBroadcastService({
    logger,
    getSendDelayMs: () => {
      const baseDelayMs = Math.max(0, Number(config?.broadcastSendIntervalMs ?? 250));
      const broadcastLimitPerMinute = Math.max(1, Number(config?.whatsappMaxBroadcastOutboundPerMinute ?? 120));
      const pacingDelayMs = Math.ceil(60_000 / broadcastLimitPerMinute);
      const currentBroadcastRate = readPerMinute(whatsappHealthState.minuteCounters.outgoingBroadcast, 1);
      const currentServiceRate = readPerMinute(whatsappHealthState.minuteCounters.outgoingService, 1);
      const currentInboundRate = readPerMinute(whatsappHealthState.minuteCounters.incoming, 1);
      const serviceLimitPerMinute = Math.max(1, Number(config?.whatsappMaxServiceOutboundPerMinute ?? 300));
      const inboundLimitPerMinute = Math.max(1, Number(config?.whatsappMaxInboundPerMinute ?? 600));
      const pressureRatio = Math.max(
        currentBroadcastRate / broadcastLimitPerMinute,
        currentServiceRate / serviceLimitPerMinute
      );
      const pressurePenaltyMs = pressureRatio >= 1
        ? Math.ceil((pressureRatio - 1 + 1) * 500)
        : (pressureRatio >= 0.8 ? 250 : 0);

      // Contrapressao por atendimento conversacional: se a fila de ingestao
      // esta enchendo ou se estamos recebendo perto do limite de entrada,
      // o broadcast cede espaco aplicando um delay adicional.
      const ingestionSnapshot = ingestionQueue?.getSnapshot?.() || null;
      const queuedRatio = ingestionSnapshot
        ? Math.min(2, (Number(ingestionSnapshot.queued) || 0) / Math.max(1, Number(ingestionSnapshot.warnThreshold) || 1000))
        : 0;
      const inboundRatio = Math.min(2, currentInboundRate / inboundLimitPerMinute);
      const conversationPressure = Math.max(queuedRatio, inboundRatio);
      const conversationPenaltyMs = conversationPressure >= 1
        ? BROADCAST_LIMITS.BACKPRESSURE_DELAY_MS * 2
        : conversationPressure >= 0.6
          ? BROADCAST_LIMITS.BACKPRESSURE_DELAY_MS
          : 0;

      return Math.max(baseDelayMs, pacingDelayMs + pressurePenaltyMs + conversationPenaltyMs);
    },
  });

  await initDb();
  applyDatabaseRuntimeConfigFromAppConfig(config);
  console.log('Banco de dados inicializado (better-sqlite3 + WAL)');
  const hydratedContacts = hydrateContactCacheFromDb(15000);
  if (hydratedContacts > 0) {
    console.log(`Cache de contatos restaurado do banco: ${hydratedContacts} registro(s)`);
  }
  cleanupSignalAuthState({ reason: 'startup', forceLog: true });
  cleanupHandoffMediaFiles({ reason: 'startup' });
  startAuthStateMaintenance();
  startHandoffMediaMaintenance();
  startDbSizeSnapshotMaintenance();
  startDatabaseMaintenanceScheduler();

  if (!requiresInitialSetup) {
    try {
      currentFlowRegistry = applyFlowSessionTimeoutOverrides(loadFlowRegistryFromConfig(config), config);
      const activeFlows = getActiveFlows();
      console.log(`Fluxos carregados - ${activeFlows.length} ativo(s)\n`);
      for (const flow of activeFlows) {
        const flowLabel = `${path.basename(flow.flowPath)} [${getFlowBotType(flow)}]`;
        console.log(`Fluxo: ${flowLabel} - ${flow.blocks.length} bloco(s) ativo(s)`);
        flow.blocks.forEach((b, i) => console.log(`   [${i}] ${b.type.padEnd(20)} id=${b.id}`));
        console.log('');
      }
    } catch (error) {
      requiresInitialSetup = true;
      console.error('Configuracao salva invalida. Redirecionando para Setup Inicial:', String(error?.message || error));
    }
  }

  if (requiresInitialSetup) {
    currentFlowRegistry = {
      all: [],
      byPath: new Map(),
      byBotType: { conversation: [], command: [] },
      conversationFlow: null,
      commandFlows: [],
    };
    console.log('Nenhuma configuracao salva detectada. Abra a aba "Setup Inicial" na dashboard para continuar.\n');
  }

  await startDashboardServer();
  if (!requiresInitialSetup) {
    setupFlowWatcher();
  }
  await ensureWhatsAppRuntimeStarted();
}

function logConversationEventAsync(event, options = {}) {
  ingestionPipeline.logConversationEventAsync(event, options);
}

async function connectToWhatsApp({ state, version }) {
  return whatsappRuntime.connectToWhatsApp({ state, version });
}

start().catch(err => {
  void handleFatal('Erro fatal no start()', err);
});





