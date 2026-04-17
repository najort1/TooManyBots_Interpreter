import fs from 'fs';
import path from 'path';

export const RUNTIME_MODE = {
  PRODUCTION: 'production',
  DEVELOPMENT: 'development',
  RESTRICTED_TEST: 'restricted-test',
};

export const BOT_RUNTIME_MODE = {
  SINGLE_FLOW: 'single-flow',
  MULTI_BOT: 'multi-bot',
};

const MODE_LOG_LEVEL = {
  [RUNTIME_MODE.PRODUCTION]: 'warn',
  [RUNTIME_MODE.DEVELOPMENT]: 'debug',
  [RUNTIME_MODE.RESTRICTED_TEST]: 'info',
};

const VALID_MODES = new Set(Object.values(RUNTIME_MODE));
const VALID_BOT_RUNTIME_MODES = new Set(Object.values(BOT_RUNTIME_MODE));

export const config = {
  botRuntimeMode: BOT_RUNTIME_MODE.SINGLE_FLOW,
  flowPath: './bots/flow.tmb',
  flowPaths: ['./bots/flow.tmb'],
  runtimeMode: RUNTIME_MODE.PRODUCTION,
  autoReloadFlows: true,
  broadcastSendIntervalMs: 250,
  ingestionConcurrency: 8,
  ingestionQueueMax: 5000,
  ingestionQueueWarnThreshold: 1000,
  schedulerGlobalConcurrency: 16,
  schedulerPerJidConcurrency: 1,
  schedulerPerFlowPathConcurrency: 4,
  postProcessConcurrency: 2,
  postProcessQueueMax: 5000,
  mediaPipelineConcurrency: 2,
  mediaPipelineQueueMax: 500,
  whatsappReconnectBaseDelayMs: 3000,
  whatsappReconnectMaxDelayMs: 60000,
  whatsappReconnectBackoffMultiplier: 2,
  whatsappReconnectJitterPct: 20,
  whatsappReconnectAttemptsWindowMs: 10 * 60 * 1000,
  whatsappReconnectMaxAttemptsPerWindow: 12,
  whatsappReconnectCooldownMs: 2 * 60 * 1000,
  authCredsDebounceMs: 250,
  authMetricsRefreshMs: 30 * 1000,
  incomingMediaMaxBytes: 8 * 1024 * 1024,
  handoffMediaRetentionMinutes: 180,
  handoffMediaCleanupIntervalMinutes: 15,
  handoffMediaMaxStorageMb: 512,
  whatsappMaxInboundPerMinute: 600,
  whatsappMaxServiceOutboundPerMinute: 300,
  whatsappMaxBroadcastOutboundPerMinute: 120,
  runtimeDegradedQueueRatio: 90,
  runtimeDegradedReconnectPendingMs: 20 * 1000,
  runtimeDegradedDropConversationEvents: true,
  dbMaintenanceEnabled: true,
  dbMaintenanceIntervalMinutes: 30,
  dbRetentionDays: 30,
  dbRetentionArchiveEnabled: true,
  dbEventBatchEnabled: true,
  dbEventBatchFlushMs: 1000,
  dbEventBatchSize: 200,
  flowSessionTimeoutOverrides: {},
  testTargetMode: 'contacts-and-groups',
  testJid: '',
  testJids: [],
  groupWhitelistJids: [],
  dashboardHost: '127.0.0.1',
  dashboardPort: 8787,
};

const USER_CONFIG_FILE = path.resolve('./config.user.json');

function toStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => String(item ?? '').trim()).filter(Boolean);
}

function normalizeRuntimeMode(value) {
  const mode = String(value ?? '').trim().toLowerCase();
  if (VALID_MODES.has(mode)) return mode;
  return null;
}

function normalizeBotRuntimeMode(value) {
  const mode = String(value ?? '').trim().toLowerCase();
  if (VALID_BOT_RUNTIME_MODES.has(mode)) return mode;
  return null;
}

function deriveRuntimeModeFromLegacy(input) {
  const explicit = normalizeRuntimeMode(input.runtimeMode);
  if (explicit) return explicit;

  if (Boolean(input.testMode)) return RUNTIME_MODE.RESTRICTED_TEST;
  if (Boolean(input.debugMode)) return RUNTIME_MODE.DEVELOPMENT;
  return RUNTIME_MODE.PRODUCTION;
}

function toPortNumber(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n <= 0 || n > 65535) return fallback;
  return Math.floor(n);
}

function toNonNegativeMs(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

function toIntInRange(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const normalized = Math.floor(n);
  if (normalized < min || normalized > max) return fallback;
  return normalized;
}

function toNumberInRange(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < min || n > max) return fallback;
  return n;
}

function normalizeFlowPaths(input) {
  const values = Array.isArray(input) ? input : [];
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const normalized = String(value ?? '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function normalizeTimeoutOverrides(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const result = {};
  for (const [key, value] of Object.entries(input)) {
    const normalizedKey = String(key ?? '').trim();
    const normalizedValue = Number(value);
    if (!normalizedKey) continue;
    if (!Number.isFinite(normalizedValue) || normalizedValue < 0) continue;
    result[normalizedKey] = Math.floor(normalizedValue);
  }
  return result;
}

function normalizeConfigShape(input) {
  const normalized = { ...input };

  normalized.runtimeMode = deriveRuntimeModeFromLegacy(normalized);
  normalized.botRuntimeMode =
    normalizeBotRuntimeMode(normalized.botRuntimeMode) ??
    (Array.isArray(normalized.flowPaths) && normalized.flowPaths.length > 1
      ? BOT_RUNTIME_MODE.MULTI_BOT
      : BOT_RUNTIME_MODE.SINGLE_FLOW);

  normalized.flowPath = String(normalized.flowPath ?? config.flowPath).trim() || config.flowPath;
  normalized.flowPaths = normalizeFlowPaths(normalized.flowPaths);
  if (!normalized.flowPaths.includes(normalized.flowPath)) {
    normalized.flowPaths = [normalized.flowPath, ...normalized.flowPaths].filter(Boolean);
  }

  if (normalized.botRuntimeMode === BOT_RUNTIME_MODE.SINGLE_FLOW) {
    normalized.flowPaths = [normalized.flowPath];
  } else if (normalized.flowPaths.length === 0) {
    normalized.flowPaths = [normalized.flowPath];
  }

  normalized.flowPath = normalized.flowPaths[0] || config.flowPath;
  normalized.autoReloadFlows = normalized.autoReloadFlows !== false;
  normalized.broadcastSendIntervalMs = toNonNegativeMs(
    normalized.broadcastSendIntervalMs,
    config.broadcastSendIntervalMs
  );
  normalized.ingestionConcurrency = toIntInRange(
    normalized.ingestionConcurrency,
    config.ingestionConcurrency,
    { min: 1, max: 64 }
  );
  normalized.ingestionQueueMax = toIntInRange(
    normalized.ingestionQueueMax,
    config.ingestionQueueMax,
    { min: 1, max: 200000 }
  );
  const warnThresholdFallback = Math.min(config.ingestionQueueWarnThreshold, normalized.ingestionQueueMax);
  normalized.ingestionQueueWarnThreshold = toIntInRange(
    normalized.ingestionQueueWarnThreshold,
    warnThresholdFallback,
    { min: 1, max: normalized.ingestionQueueMax }
  );
  normalized.schedulerGlobalConcurrency = toIntInRange(
    normalized.schedulerGlobalConcurrency,
    config.schedulerGlobalConcurrency,
    { min: 1, max: 256 }
  );
  normalized.schedulerPerJidConcurrency = toIntInRange(
    normalized.schedulerPerJidConcurrency,
    config.schedulerPerJidConcurrency,
    { min: 1, max: 64 }
  );
  normalized.schedulerPerFlowPathConcurrency = toIntInRange(
    normalized.schedulerPerFlowPathConcurrency,
    config.schedulerPerFlowPathConcurrency,
    { min: 1, max: 256 }
  );
  normalized.postProcessConcurrency = toIntInRange(
    normalized.postProcessConcurrency,
    config.postProcessConcurrency,
    { min: 1, max: 64 }
  );
  normalized.postProcessQueueMax = toIntInRange(
    normalized.postProcessQueueMax,
    config.postProcessQueueMax,
    { min: 1, max: 200000 }
  );
  normalized.mediaPipelineConcurrency = toIntInRange(
    normalized.mediaPipelineConcurrency,
    config.mediaPipelineConcurrency,
    { min: 1, max: 64 }
  );
  normalized.mediaPipelineQueueMax = toIntInRange(
    normalized.mediaPipelineQueueMax,
    config.mediaPipelineQueueMax,
    { min: 1, max: 100000 }
  );
  normalized.whatsappReconnectBaseDelayMs = toIntInRange(
    normalized.whatsappReconnectBaseDelayMs,
    config.whatsappReconnectBaseDelayMs,
    { min: 100, max: 10 * 60 * 1000 }
  );
  normalized.whatsappReconnectMaxDelayMs = toIntInRange(
    normalized.whatsappReconnectMaxDelayMs,
    config.whatsappReconnectMaxDelayMs,
    { min: normalized.whatsappReconnectBaseDelayMs, max: 60 * 60 * 1000 }
  );
  normalized.whatsappReconnectBackoffMultiplier = toNumberInRange(
    normalized.whatsappReconnectBackoffMultiplier,
    config.whatsappReconnectBackoffMultiplier,
    { min: 1, max: 5 }
  );
  normalized.whatsappReconnectJitterPct = toIntInRange(
    normalized.whatsappReconnectJitterPct,
    config.whatsappReconnectJitterPct,
    { min: 0, max: 90 }
  );
  normalized.whatsappReconnectAttemptsWindowMs = toIntInRange(
    normalized.whatsappReconnectAttemptsWindowMs,
    config.whatsappReconnectAttemptsWindowMs,
    { min: 60 * 1000, max: 24 * 60 * 60 * 1000 }
  );
  normalized.whatsappReconnectMaxAttemptsPerWindow = toIntInRange(
    normalized.whatsappReconnectMaxAttemptsPerWindow,
    config.whatsappReconnectMaxAttemptsPerWindow,
    { min: 1, max: 500 }
  );
  normalized.whatsappReconnectCooldownMs = toIntInRange(
    normalized.whatsappReconnectCooldownMs,
    config.whatsappReconnectCooldownMs,
    { min: 1000, max: 60 * 60 * 1000 }
  );
  normalized.authCredsDebounceMs = toIntInRange(
    normalized.authCredsDebounceMs,
    config.authCredsDebounceMs,
    { min: 0, max: 60 * 1000 }
  );
  normalized.authMetricsRefreshMs = toIntInRange(
    normalized.authMetricsRefreshMs,
    config.authMetricsRefreshMs,
    { min: 1000, max: 60 * 60 * 1000 }
  );
  normalized.incomingMediaMaxBytes = toIntInRange(
    normalized.incomingMediaMaxBytes,
    config.incomingMediaMaxBytes,
    { min: 64 * 1024, max: 512 * 1024 * 1024 }
  );
  normalized.handoffMediaRetentionMinutes = toIntInRange(
    normalized.handoffMediaRetentionMinutes,
    config.handoffMediaRetentionMinutes,
    { min: 1, max: 365 * 24 * 60 }
  );
  normalized.handoffMediaCleanupIntervalMinutes = toIntInRange(
    normalized.handoffMediaCleanupIntervalMinutes,
    config.handoffMediaCleanupIntervalMinutes,
    { min: 1, max: 24 * 60 }
  );
  normalized.handoffMediaMaxStorageMb = toIntInRange(
    normalized.handoffMediaMaxStorageMb,
    config.handoffMediaMaxStorageMb,
    { min: 32, max: 1024 * 10 }
  );
  normalized.whatsappMaxInboundPerMinute = toIntInRange(
    normalized.whatsappMaxInboundPerMinute,
    config.whatsappMaxInboundPerMinute,
    { min: 1, max: 100000 }
  );
  normalized.whatsappMaxServiceOutboundPerMinute = toIntInRange(
    normalized.whatsappMaxServiceOutboundPerMinute,
    config.whatsappMaxServiceOutboundPerMinute,
    { min: 1, max: 100000 }
  );
  normalized.whatsappMaxBroadcastOutboundPerMinute = toIntInRange(
    normalized.whatsappMaxBroadcastOutboundPerMinute,
    config.whatsappMaxBroadcastOutboundPerMinute,
    { min: 1, max: 100000 }
  );
  normalized.runtimeDegradedQueueRatio = toIntInRange(
    normalized.runtimeDegradedQueueRatio,
    config.runtimeDegradedQueueRatio,
    { min: 50, max: 100 }
  );
  normalized.runtimeDegradedReconnectPendingMs = toIntInRange(
    normalized.runtimeDegradedReconnectPendingMs,
    config.runtimeDegradedReconnectPendingMs,
    { min: 0, max: 60 * 60 * 1000 }
  );
  normalized.runtimeDegradedDropConversationEvents = normalized.runtimeDegradedDropConversationEvents !== false;
  normalized.dbMaintenanceEnabled = normalized.dbMaintenanceEnabled !== false;
  normalized.dbMaintenanceIntervalMinutes = toIntInRange(
    normalized.dbMaintenanceIntervalMinutes,
    config.dbMaintenanceIntervalMinutes,
    { min: 5, max: 1440 }
  );
  normalized.dbRetentionDays = toIntInRange(
    normalized.dbRetentionDays,
    config.dbRetentionDays,
    { min: 1, max: 3650 }
  );
  normalized.dbRetentionArchiveEnabled = normalized.dbRetentionArchiveEnabled !== false;
  normalized.dbEventBatchEnabled = normalized.dbEventBatchEnabled !== false;
  normalized.dbEventBatchFlushMs = toIntInRange(
    normalized.dbEventBatchFlushMs,
    config.dbEventBatchFlushMs,
    { min: 100, max: 60000 }
  );
  normalized.dbEventBatchSize = toIntInRange(
    normalized.dbEventBatchSize,
    config.dbEventBatchSize,
    { min: 10, max: 5000 }
  );
  normalized.flowSessionTimeoutOverrides = normalizeTimeoutOverrides(normalized.flowSessionTimeoutOverrides);

  normalized.testTargetMode = String(normalized.testTargetMode ?? config.testTargetMode).trim() || config.testTargetMode;
  normalized.testJid = String(normalized.testJid ?? '').trim();
  normalized.testJids = toStringArray(normalized.testJids);
  normalized.groupWhitelistJids = toStringArray(normalized.groupWhitelistJids);

  if (normalized.testJid && !normalized.testJids.includes(normalized.testJid)) {
    normalized.testJids = [normalized.testJid, ...normalized.testJids];
  }

  normalized.dashboardHost = String(normalized.dashboardHost ?? config.dashboardHost).trim() || config.dashboardHost;
  normalized.dashboardPort = toPortNumber(normalized.dashboardPort, config.dashboardPort);

  normalized.testMode = normalized.runtimeMode === RUNTIME_MODE.RESTRICTED_TEST;
  normalized.debugMode = normalized.runtimeMode === RUNTIME_MODE.DEVELOPMENT;
  normalized.logLevel = MODE_LOG_LEVEL[normalized.runtimeMode] ?? MODE_LOG_LEVEL[RUNTIME_MODE.PRODUCTION];
  normalized.prettyLogs = Boolean(process.stdout?.isTTY);

  if (!normalized.testMode) {
    normalized.testJids = [];
    normalized.testJid = '';
  }

  return normalized;
}

export function normalizeUserConfig(input) {
  return normalizeConfigShape(input);
}

function sanitizeConfigForSave(input) {
  const { __startupChoice, ...rest } = input;
  const normalized = normalizeConfigShape(rest);
  return {
    botRuntimeMode: normalized.botRuntimeMode,
    flowPath: normalized.flowPath,
    flowPaths: normalized.flowPaths,
    runtimeMode: normalized.runtimeMode,
    autoReloadFlows: normalized.autoReloadFlows,
    broadcastSendIntervalMs: normalized.broadcastSendIntervalMs,
    ingestionConcurrency: normalized.ingestionConcurrency,
    ingestionQueueMax: normalized.ingestionQueueMax,
    ingestionQueueWarnThreshold: normalized.ingestionQueueWarnThreshold,
    schedulerGlobalConcurrency: normalized.schedulerGlobalConcurrency,
    schedulerPerJidConcurrency: normalized.schedulerPerJidConcurrency,
    schedulerPerFlowPathConcurrency: normalized.schedulerPerFlowPathConcurrency,
    postProcessConcurrency: normalized.postProcessConcurrency,
    postProcessQueueMax: normalized.postProcessQueueMax,
    mediaPipelineConcurrency: normalized.mediaPipelineConcurrency,
    mediaPipelineQueueMax: normalized.mediaPipelineQueueMax,
    whatsappReconnectBaseDelayMs: normalized.whatsappReconnectBaseDelayMs,
    whatsappReconnectMaxDelayMs: normalized.whatsappReconnectMaxDelayMs,
    whatsappReconnectBackoffMultiplier: normalized.whatsappReconnectBackoffMultiplier,
    whatsappReconnectJitterPct: normalized.whatsappReconnectJitterPct,
    whatsappReconnectAttemptsWindowMs: normalized.whatsappReconnectAttemptsWindowMs,
    whatsappReconnectMaxAttemptsPerWindow: normalized.whatsappReconnectMaxAttemptsPerWindow,
    whatsappReconnectCooldownMs: normalized.whatsappReconnectCooldownMs,
    authCredsDebounceMs: normalized.authCredsDebounceMs,
    authMetricsRefreshMs: normalized.authMetricsRefreshMs,
    incomingMediaMaxBytes: normalized.incomingMediaMaxBytes,
    handoffMediaRetentionMinutes: normalized.handoffMediaRetentionMinutes,
    handoffMediaCleanupIntervalMinutes: normalized.handoffMediaCleanupIntervalMinutes,
    handoffMediaMaxStorageMb: normalized.handoffMediaMaxStorageMb,
    whatsappMaxInboundPerMinute: normalized.whatsappMaxInboundPerMinute,
    whatsappMaxServiceOutboundPerMinute: normalized.whatsappMaxServiceOutboundPerMinute,
    whatsappMaxBroadcastOutboundPerMinute: normalized.whatsappMaxBroadcastOutboundPerMinute,
    runtimeDegradedQueueRatio: normalized.runtimeDegradedQueueRatio,
    runtimeDegradedReconnectPendingMs: normalized.runtimeDegradedReconnectPendingMs,
    runtimeDegradedDropConversationEvents: normalized.runtimeDegradedDropConversationEvents,
    dbMaintenanceEnabled: normalized.dbMaintenanceEnabled,
    dbMaintenanceIntervalMinutes: normalized.dbMaintenanceIntervalMinutes,
    dbRetentionDays: normalized.dbRetentionDays,
    dbRetentionArchiveEnabled: normalized.dbRetentionArchiveEnabled,
    dbEventBatchEnabled: normalized.dbEventBatchEnabled,
    dbEventBatchFlushMs: normalized.dbEventBatchFlushMs,
    dbEventBatchSize: normalized.dbEventBatchSize,
    flowSessionTimeoutOverrides: normalized.flowSessionTimeoutOverrides,
    testTargetMode: normalized.testTargetMode,
    testJid: normalized.testJid,
    testJids: normalized.testJids,
    groupWhitelistJids: normalized.groupWhitelistJids,
    dashboardHost: normalized.dashboardHost,
    dashboardPort: normalized.dashboardPort,
  };
}

export function loadSavedUserConfig() {
  if (!fs.existsSync(USER_CONFIG_FILE)) return null;
  try {
    const raw = fs.readFileSync(USER_CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return normalizeConfigShape(parsed);
  } catch {
    return null;
  }
}

export function saveUserConfig(userConfig) {
  const payload = sanitizeConfigForSave(userConfig);
  fs.writeFileSync(USER_CONFIG_FILE, JSON.stringify(payload, null, 2), 'utf-8');
}

export async function getConfig({ interactive = true } = {}) {
  const saved = loadSavedUserConfig();
  if (saved && !interactive) {
    return normalizeConfigShape({ ...config, ...saved });
  }

  if (!interactive) {
    return normalizeConfigShape({ ...config });
  }

  try {
    const { runConfigWizard } = await import('./configWizard.js');
    const projectRoot = path.resolve('.');

    const chosen = await runConfigWizard({
      projectRoot,
      defaults: normalizeConfigShape({ ...config, ...(saved ?? {}) }),
      hasSavedConfig: Boolean(saved),
      onUseSavedConfig: () => normalizeConfigShape({ ...config, ...saved, __startupChoice: 'use_previous' }),
    });

    if (!chosen) {
      throw new Error('Configuracao cancelada pelo usuario.');
    }

    saveUserConfig(chosen);
    return normalizeConfigShape(chosen);
  } catch (err) {
    console.error('Falha ao obter configuracao interativa:', err);
    throw err;
  }
}
