import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { spawn } from 'node:child_process';
import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcode from 'qrcode-terminal';

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
import { cleanupAuthSignalSessions, useSqliteAuthState } from './db/authState.js';
import { getFlowBotType, loadFlows } from './engine/flowLoader.js';
import { parseMessage } from './engine/messageParser.js';
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
import { createTaskScheduler } from './runtime/taskScheduler.js';

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
let reloadInProgress = false;
let pendingReload = false;
let reloadDebounceTimer = null;
let flowWatchers = [];
let terminalCommandInterface = null;
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
let dashboardAutoOpenAttempted = false;
let ingestionQueue = null;
let dispatchScheduler = null;
let postProcessQueue = null;
let mediaPipelineQueue = null;
const runtimeStatsStartedAt = Date.now();
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
};

function normalizePersistableContactName(name, jid) {
  const normalizedJid = String(jid ?? '').trim();
  const rawName = String(name ?? '').trim();
  if (!rawName) return '';
  const cleaned = rawName.replace(/^~+\s*/, '').trim() || rawName;
  if (!cleaned) return '';
  if (normalizedJid && cleaned === normalizedJid) return '';
  const jidLocal = normalizedJid.split('@')[0] || '';
  if (jidLocal && cleaned === jidLocal) return '';
  return cleaned.slice(0, 180);
}

class PersistentContactCache extends Map {
  constructor({ onPersistName = null } = {}) {
    super();
    this.onPersistName = typeof onPersistName === 'function' ? onPersistName : null;
    this.persistedNames = new Map();
    this.hydrating = false;
  }

  hydrate(entries = []) {
    this.hydrating = true;
    try {
      for (const entry of entries) {
        const jid = String(entry?.jid ?? '').trim();
        const name = String(entry?.name ?? '').trim();
        if (!jid) continue;
        const normalizedName = normalizePersistableContactName(name, jid) || jid;
        this.persistedNames.set(jid, normalizedName);
        super.set(jid, { jid, name: normalizedName });
      }
    } finally {
      this.hydrating = false;
    }
  }

  set(key, value) {
    const normalizedJid = String(key ?? value?.jid ?? '').trim();
    if (!normalizedJid) return this;

    const normalizedValue =
      value && typeof value === 'object'
        ? { ...value, jid: normalizedJid, name: String(value?.name ?? normalizedJid).trim() || normalizedJid }
        : { jid: normalizedJid, name: normalizedJid };

    const result = super.set(normalizedJid, normalizedValue);

    if (!this.hydrating && this.onPersistName) {
      const normalizedName = normalizePersistableContactName(normalizedValue.name, normalizedJid);
      if (normalizedName) {
        const previousPersistedName = this.persistedNames.get(normalizedJid) || '';
        if (previousPersistedName !== normalizedName) {
          this.persistedNames.set(normalizedJid, normalizedName);
          this.onPersistName({ jid: normalizedJid, name: normalizedName });
        }
      }
    }

    return result;
  }

  clear() {
    super.clear();
    this.persistedNames.clear();
  }
}

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

function formatError(err) {
  if (!err) return 'Unknown error';
  if (err instanceof Error) {
    return `${err.name}: ${err.message}\n${err.stack ?? ''}`;
  }
  try {
    return JSON.stringify(err, null, 2);
  } catch {
    return String(err);
  }
}

function appendFatalLog(prefix, err) {
  const payload = [
    '============================================================',
    `[${new Date().toISOString()}] ${prefix}`,
    formatError(err),
    '',
  ].join('\n');
  try {
    fs.appendFileSync(FATAL_LOG_FILE, payload, 'utf-8');
  } catch {
    // ignore
  }
}

async function waitForEnter(message) {
  if (!process.stdin.isTTY) return;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise(resolve => rl.question(message, () => resolve()));
  rl.close();
}

let exiting = false;
async function handleFatal(prefix, err) {
  if (exiting) return;
  exiting = true;

  appendFatalLog(prefix, err);
  console.error(`\nERROR: ${prefix}`);
  console.error(formatError(err));
  console.error(`\n(Log salvo em: ${FATAL_LOG_FILE})\n`);
  await waitForEnter('Pressione Enter para sair...');
  process.exit(1);
}

process.on('unhandledRejection', reason => {
  void handleFatal('Unhandled Promise Rejection', reason);
});

process.on('uncaughtException', err => {
  void handleFatal('Uncaught Exception', err);
});

const LIBSIGNAL_NOISE_PREFIXES = [
  'Failed to decrypt message with any known session',
  'Session error:',
  'Closing open session in favor of incoming prekey bundle',
  'Closing session:',
  'Decrypted message with closed session.',
];

let libSignalNoiseFilterInstalled = false;

function shouldSuppressLibSignalConsoleNoise(args) {
  const firstText = args.find(arg => typeof arg === 'string');
  if (!firstText) return false;
  return LIBSIGNAL_NOISE_PREFIXES.some(prefix => firstText.startsWith(prefix));
}

function installLibSignalNoiseFilter(enabled) {
  if (!enabled || libSignalNoiseFilterInstalled) return;
  libSignalNoiseFilterInstalled = true;

  const original = {
    error: console.error.bind(console),
    warn: console.warn.bind(console),
    info: console.info.bind(console),
  };

  console.error = (...args) => {
    if (shouldSuppressLibSignalConsoleNoise(args)) return;
    original.error(...args);
  };

  console.warn = (...args) => {
    if (shouldSuppressLibSignalConsoleNoise(args)) return;
    original.warn(...args);
  };

  console.info = (...args) => {
    if (shouldSuppressLibSignalConsoleNoise(args)) return;
    original.info(...args);
  };
}

function shouldSuppressBaileysDecryptNoise(args) {
  const msg = [...args].reverse().find(arg => typeof arg === 'string') || '';
  if (msg !== 'failed to decrypt message') return false;

  const meta = args.find(arg => arg && typeof arg === 'object' && !Array.isArray(arg));
  const err = meta?.err ?? {};
  const errName = String(err?.name ?? err?.type ?? '');
  const errMessage = String(err?.message ?? '');

  return errName === 'SessionError' && errMessage.includes('No matching sessions found for message');
}

function createRuntimeLogger(currentConfig) {
  const suppressDecryptNoise =
    currentConfig.runtimeMode === RUNTIME_MODE.PRODUCTION &&
    String(process.env.TMB_SUPPRESS_SIGNAL_NOISE ?? '1') !== '0';

  const pinoOptions = currentConfig.prettyLogs
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {};

  if (suppressDecryptNoise) {
    pinoOptions.hooks = {
      logMethod(args, method) {
        if (shouldSuppressBaileysDecryptNoise(args)) return;
        method.apply(this, args);
      },
    };
  }

  const runtimeLogger = pino(pinoOptions);
  runtimeLogger.level = currentConfig.logLevel;
  return runtimeLogger;
}

function isDevelopmentMode(currentConfig) {
  return String(currentConfig?.runtimeMode ?? '').toLowerCase() === RUNTIME_MODE.DEVELOPMENT;
}

function getActiveFlows() {
  return Array.isArray(currentFlowRegistry?.all) ? currentFlowRegistry.all : [];
}

function getConversationFlow() {
  return currentFlowRegistry?.conversationFlow ?? null;
}

function getCommandFlows() {
  return Array.isArray(currentFlowRegistry?.commandFlows) ? currentFlowRegistry.commandFlows : [];
}

function getDashboardFlow() {
  const conversationFlow = getConversationFlow();
  if (conversationFlow) return conversationFlow;
  return getActiveFlows()[0] ?? null;
}

function currentPrimaryFlowPathForLogs() {
  return getDashboardFlow()?.flowPath ?? String(config?.flowPath ?? '');
}

function resolveConfiguredFlowPaths(currentConfig) {
  const selectedPaths = Array.isArray(currentConfig?.flowPaths) ? currentConfig.flowPaths : [];
  const fallback = String(currentConfig?.flowPath ?? '').trim();
  const unique = new Set();
  const result = [];

  for (const item of selectedPaths) {
    const value = String(item ?? '').trim();
    if (!value || unique.has(value)) continue;
    unique.add(value);
    result.push(value);
  }

  if (!result.length && fallback) {
    result.push(fallback);
  }

  return result;
}

function loadFlowRegistryFromConfig(currentConfig) {
  const flowPaths = resolveConfiguredFlowPaths(currentConfig);
  return loadFlows(flowPaths);
}

function normalizeTimeoutMinutes(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

function applyFlowSessionTimeoutOverrides(registry, currentConfig) {
  if (!registry || !Array.isArray(registry.all)) return registry;
  const overrides = currentConfig?.flowSessionTimeoutOverrides && typeof currentConfig.flowSessionTimeoutOverrides === 'object'
    ? currentConfig.flowSessionTimeoutOverrides
    : {};

  for (const flow of registry.all) {
    const flowPath = String(flow?.flowPath ?? '').trim();
    if (!flowPath) continue;
    const override = normalizeTimeoutMinutes(overrides[flowPath]);
    if (override == null) continue;
    if (!flow.runtimeConfig || typeof flow.runtimeConfig !== 'object') {
      flow.runtimeConfig = {};
    }
    if (!flow.runtimeConfig.sessionLimits || typeof flow.runtimeConfig.sessionLimits !== 'object') {
      flow.runtimeConfig.sessionLimits = {};
    }
    flow.runtimeConfig.sessionLimits.sessionTimeoutMinutes = override;
  }

  return registry;
}

function getFlowSessionTimeoutMinutes(flow) {
  const value = Number(flow?.runtimeConfig?.sessionLimits?.sessionTimeoutMinutes);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function parseHumanHandoff(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function buildSessionManagementOverview() {
  const activeSessions = getActiveSessions({ botType: 'conversation' });
  const nowTs = Date.now();

  let handoffSessions = 0;
  let durationTotal = 0;
  let durationCount = 0;

  const flowCounts = new Map();
  for (const session of activeSessions) {
    const waitingForHuman = String(session?.waitingFor || '').trim().toLowerCase() === 'human';
    const handoff = parseHumanHandoff(session?.variables?.__humanHandoff);
    if (waitingForHuman || handoff.active === true) {
      handoffSessions += 1;
    }

    const startedAt = Number(session?.variables?.__sessionStartedAt) || 0;
    if (startedAt > 0 && startedAt <= nowTs) {
      durationTotal += nowTs - startedAt;
      durationCount += 1;
    }

    const flowPath = String(session?.flowPath || '').trim() || '(sem-flow)';
    flowCounts.set(flowPath, (flowCounts.get(flowPath) || 0) + 1);
  }

  const averageSessionDurationMs = durationCount > 0 ? Math.round(durationTotal / durationCount) : 0;
  return {
    activeSessions: activeSessions.length,
    handoffSessions,
    averageSessionDurationMs,
    byFlow: [...flowCounts.entries()]
      .map(([flowPath, activeCount]) => ({ flowPath, activeCount }))
      .sort((a, b) => b.activeCount - a.activeCount),
  };
}

function listSessionManagementFlows() {
  return getActiveFlows()
    .filter(flow => getFlowBotType(flow) === 'conversation')
    .map(flow => ({
    flowPath: flow.flowPath,
    botType: getFlowBotType(flow),
    sessionTimeoutMinutes: getFlowSessionTimeoutMinutes(flow),
  }));
}

function listActiveSessionsForManagement({ search = '', limit = 200 } = {}) {
  const normalizedSearch = String(search ?? '').trim().toLowerCase();
  const normalizedLimit = Math.max(1, Math.min(2000, Number(limit) || 200));
  const nowTs = Date.now();

  const rows = getActiveSessions({ botType: 'conversation' })
    .filter(session => {
      if (!normalizedSearch) return true;
      const jid = String(session?.jid || '').toLowerCase();
      const flowPath = String(session?.flowPath || '').toLowerCase();
      const displayName = resolveContactDisplayName(session?.jid).toLowerCase();
      return jid.includes(normalizedSearch) || flowPath.includes(normalizedSearch) || displayName.includes(normalizedSearch);
    })
    .slice(0, normalizedLimit)
    .map(session => {
      const startedAt = Number(session?.variables?.__sessionStartedAt) || 0;
      const lastActivityAt = Number(session?.variables?.__sessionLastActivityAt) || 0;
      const handoff = parseHumanHandoff(session?.variables?.__humanHandoff);
      const waitingForHuman = String(session?.waitingFor || '').trim().toLowerCase() === 'human';
      return {
        jid: session.jid,
        flowPath: session.flowPath,
        botType: session.botType,
        waitingFor: session.waitingFor,
        blockIndex: session.blockIndex,
        displayName: resolveContactDisplayName(session.jid),
        startedAt,
        lastActivityAt,
        durationMs: startedAt > 0 && startedAt <= nowTs ? nowTs - startedAt : 0,
        handoffActive: waitingForHuman || handoff.active === true,
      };
    });

  return rows;
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
  addConversationEvent({
    occurredAt: Number(occurredAt) || Date.now(),
    eventType,
    direction,
    jid,
    flowPath: String(flowPath || '').trim() || currentPrimaryFlowPathForLogs(),
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
  remaining = 0,
  percent = 0,
  status = 'sending',
  jid = '',
  recipientStatus = '',
  error = '',
} = {}) {
  if (!dashboardServer) return;

  const attemptedSafe = Math.max(0, Number(attempted) || 0);
  const processedSafe = Math.max(0, Math.min(attemptedSafe, Number(processed) || 0));
  const sentSafe = Math.max(0, Number(sent) || 0);
  const failedSafe = Math.max(0, Number(failed) || 0);
  const remainingSafe = Math.max(0, Number(remaining) || 0);
  const percentSafe = Math.max(0, Math.min(100, Number(percent) || 0));
  const statusSafe = String(status || 'sending');

  dashboardServer.broadcast({
    occurredAt: Date.now(),
    eventType: 'broadcast-send-progress',
    direction: 'system',
    jid: String(jid || 'system'),
    flowPath: currentPrimaryFlowPathForLogs(),
    messageText: `Broadcast ${sentSafe}/${attemptedSafe}`,
    metadata: {
      source: 'dashboard-broadcast',
      actor: String(actor || 'dashboard-agent'),
      target: String(target || 'all'),
      campaignId: Number(campaignId) || 0,
      attempted: attemptedSafe,
      processed: processedSafe,
      sent: sentSafe,
      failed: failedSafe,
      remaining: remainingSafe,
      percent: percentSafe,
      status: statusSafe,
      recipientStatus: String(recipientStatus || ''),
      error: String(error || ''),
    },
  });
}

function extractOutgoingMessageText(content) {
  if (!content || typeof content !== 'object') return '';
  if (typeof content.text === 'string' && content.text.trim()) return content.text;
  if (content.image?.caption) return String(content.image.caption);
  if (content.image) return '[imagem]';
  if (content.react?.text) return `[react] ${content.react.text}`;
  if (content.listMessage?.description) return content.listMessage.description;
  if (content.listMessage?.title) return content.listMessage.title;
  if (content.buttonsMessage?.contentText) return content.buttonsMessage.contentText;
  return '';
}

function extractOutgoingKind(content) {
  if (!content || typeof content !== 'object') return 'unknown';
  if (content.text) return 'text';
  if (content.image) return 'image';
  if (content.react) return 'reaction';
  if (content.listMessage) return 'list';
  if (content.buttons) return 'buttons';
  return Object.keys(content)[0] || 'unknown';
}

function extractApiHostFromTemplateUrl(rawUrl) {
  const input = String(rawUrl ?? '').trim();
  if (!input) return 'host-desconhecido';

  const normalized = input.replace(/\{\{[^}]+\}\}/g, 'x');

  try {
    const parsed = new URL(normalized);
    return parsed.host || parsed.hostname || 'host-desconhecido';
  } catch {
    try {
      const parsedWithBase = new URL(normalized, 'http://localhost');
      if (parsedWithBase.host && parsedWithBase.host !== 'localhost') {
        return parsedWithBase.host;
      }
    } catch {
      // ignore
    }

    const match = normalized.match(/^(?:[a-z]+:\/\/)?([^\/\s?#]+)/i);
    return String(match?.[1] ?? 'host-desconhecido');
  }
}

function sanitizeMediaFileName(value) {
  return String(value ?? '')
    .replace(/[^\w.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 90);
}

function extensionFromMimeType(mimeType) {
  if (mimeType === 'image/jpeg') return '.jpg';
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'image/gif') return '.gif';
  return '.bin';
}

function saveIncomingHandoffImage({ buffer, mimeType, fileName = '' }) {
  fs.mkdirSync(HANDOFF_MEDIA_DIR, { recursive: true });
  const ext = extensionFromMimeType(mimeType);
  const base = sanitizeMediaFileName(fileName).replace(/\.[^.]+$/, '') || 'incoming';
  const mediaId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${base}${ext}`;
  const mediaPath = path.resolve(HANDOFF_MEDIA_DIR, mediaId);
  fs.writeFileSync(mediaPath, buffer);
  return {
    mediaId,
    mediaPath,
    mediaUrl: `/api/handoff/media/${encodeURIComponent(mediaId)}`,
  };
}

async function captureIncomingImageForDashboard({ msg, sock, mimeType, fileName }) {
  const normalizedMime = String(mimeType || '').toLowerCase();
  if (!ALLOWED_INCOMING_IMAGE_MIME.has(normalizedMime)) return null;

  try {
    const buffer = await downloadMediaMessage(
      msg,
      'buffer',
      {},
      {
        logger,
        reuploadRequest: sock?.updateMediaMessage,
      }
    );

    if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
      return null;
    }
    if (buffer.length > 8 * 1024 * 1024) {
      return null;
    }

    return saveIncomingHandoffImage({
      buffer,
      mimeType: normalizedMime,
      fileName,
    });
  } catch {
    return null;
  }
}

function cleanupSignalAuthState({ reason = 'manual', forceLog = false } = {}) {
  try {
    const summary = cleanupAuthSignalSessions();
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

    return summary;
  } catch (error) {
    console.error(`[AuthState] cleanup falhou (${reason}):`, error?.message || error);
    return null;
  }
}

function startAuthStateMaintenance() {
  if (authStateMaintenanceTimer) return;

  const intervalMs = Math.max(60_000, Number(process.env.TMB_AUTH_CLEANUP_INTERVAL_MS) || (10 * 60 * 1000));
  authStateMaintenanceTimer = setInterval(() => {
    cleanupSignalAuthState({ reason: 'interval' });
  }, intervalMs);

  if (typeof authStateMaintenanceTimer.unref === 'function') {
    authStateMaintenanceTimer.unref();
  }
}

function attachOutgoingMessageLogger(sock) {
  if (!sock || sock.__tmbSendMessageWrapped) return;

  const original = sock.sendMessage.bind(sock);
  sock.sendMessage = async (jid, content, options) => {
    const safeOptions = options && typeof options === 'object' ? { ...options } : {};
    const skipConversationLog = safeOptions.__skipConversationLog === true;
    const flowPath = String(safeOptions.__flowPath || '').trim();
    delete safeOptions.__skipConversationLog;
    delete safeOptions.__flowPath;

    const text = extractOutgoingMessageText(content);
    const kind = extractOutgoingKind(content);

    try {
      const result = await original(jid, content, safeOptions);
      if (!skipConversationLog) {
        logConversationEventAsync({
          eventType: 'message-outgoing',
          direction: 'outgoing',
          jid,
          flowPath,
          messageText: text,
          metadata: { kind },
        }, { key: jid });
      }
      return result;
    } catch (err) {
      if (!skipConversationLog) {
        logConversationEventAsync({
          eventType: 'message-outgoing-error',
          direction: 'system',
          jid,
          flowPath,
          messageText: text,
          metadata: {
            kind,
            error: formatError(err),
          },
        }, { key: jid });
      }
      throw err;
    }
  };

  sock.__tmbSendMessageWrapped = true;
}

function safeAverage(total, count) {
  if (!Number.isFinite(total) || !Number.isFinite(count) || count <= 0) return 0;
  return Number((total / count).toFixed(2));
}

function toPerSecond(count, startedAt) {
  const uptimeSeconds = Math.max(1, (Date.now() - Number(startedAt || Date.now())) / 1000);
  return Number(((Number(count) || 0) / uptimeSeconds).toFixed(2));
}

function queueSnapshotOrFallback(queue, fallback = {}) {
  if (!queue || typeof queue.getSnapshot !== 'function') return { ...fallback };
  return queue.getSnapshot();
}

function getIngestionSnapshot() {
  const ingestionQueueSnapshot = queueSnapshotOrFallback(ingestionQueue, {
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
  const dispatchQueueSnapshot = queueSnapshotOrFallback(dispatchScheduler, {
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
  const postProcessSnapshot = queueSnapshotOrFallback(postProcessQueue, {
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
  const mediaPipelineSnapshot = queueSnapshotOrFallback(mediaPipelineQueue, {
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

  const engineStats = getEngineRuntimeStats();

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
      queue: mediaPipelineSnapshot,
    },
    engine: engineStats,
    ingestionQueue: ingestionQueueSnapshot,
    dispatchScheduler: dispatchQueueSnapshot,
  };
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

function normalizeRuntimeInfo() {
  const dashboardFlow = getDashboardFlow();
  const flowFile = path.basename(String(dashboardFlow?.flowPath ?? config?.flowPath ?? ''));
  const runtimeMode = String(config?.runtimeMode ?? RUNTIME_MODE.PRODUCTION);
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
    ingestion: getIngestionSnapshot(),
  };
}

function startDbSizeSnapshotMaintenance() {
  if (dbSizeSnapshotMaintenanceTimer) return;
  const intervalMs = Math.max(60 * 60 * 1000, Number(process.env.TMB_DB_SIZE_SNAPSHOT_INTERVAL_MS) || (60 * 60 * 1000));
  dbSizeSnapshotMaintenanceTimer = setInterval(() => {
    try {
      getDatabaseInfo();
    } catch {
      // ignore snapshot maintenance failures
    }
  }, intervalMs);

  if (typeof dbSizeSnapshotMaintenanceTimer.unref === 'function') {
    dbSizeSnapshotMaintenanceTimer.unref();
  }
}

function normalizeBroadcastSendIntervalMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
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

function buildDatabaseRuntimeConfigFromCurrentConfig(currentConfig = config) {
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

function applyDatabaseRuntimeConfigFromAppConfig(currentConfig = config) {
  return configureDatabaseRuntime(buildDatabaseRuntimeConfigFromCurrentConfig(currentConfig));
}

function stopDatabaseMaintenanceScheduler() {
  if (!dbMaintenanceTimer) return;
  clearInterval(dbMaintenanceTimer);
  dbMaintenanceTimer = null;
}

function startDatabaseMaintenanceScheduler() {
  stopDatabaseMaintenanceScheduler();

  if (config?.dbMaintenanceEnabled === false) return;
  const intervalMinutes = Math.max(5, Number(config?.dbMaintenanceIntervalMinutes) || 30);
  const intervalMs = intervalMinutes * 60 * 1000;

  dbMaintenanceTimer = setInterval(() => {
    try {
      const result = runDatabaseMaintenance({ reason: 'scheduled', force: false, runRetention: true });
      if (!result?.ok && !result?.skipped) {
        logger?.warn?.(
          { error: String(result?.error || 'db-maintenance-failed') },
          'Scheduled DB maintenance failed'
        );
      }
    } catch (error) {
      logger?.warn?.(
        { error: String(error?.message || 'db-maintenance-failed') },
        'Scheduled DB maintenance failed'
      );
    }
  }, intervalMs);

  if (typeof dbMaintenanceTimer.unref === 'function') {
    dbMaintenanceTimer.unref();
  }
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
  return {
    botRuntimeMode: String(config?.botRuntimeMode || 'single-flow'),
    flowPath: String(config?.flowPath || ''),
    flowPaths: toTrimmedStringArray(config?.flowPaths),
    runtimeMode: String(config?.runtimeMode || RUNTIME_MODE.PRODUCTION),
    autoReloadFlows: config?.autoReloadFlows !== false,
    broadcastSendIntervalMs: Number(config?.broadcastSendIntervalMs ?? 250),
    ingestionConcurrency: Number(config?.ingestionConcurrency ?? 8),
    ingestionQueueMax: Number(config?.ingestionQueueMax ?? 5000),
    ingestionQueueWarnThreshold: Number(config?.ingestionQueueWarnThreshold ?? 1000),
    schedulerGlobalConcurrency: Number(config?.schedulerGlobalConcurrency ?? 16),
    schedulerPerJidConcurrency: Number(config?.schedulerPerJidConcurrency ?? 1),
    schedulerPerFlowPathConcurrency: Number(config?.schedulerPerFlowPathConcurrency ?? 4),
    postProcessConcurrency: Number(config?.postProcessConcurrency ?? 2),
    postProcessQueueMax: Number(config?.postProcessQueueMax ?? 5000),
    mediaPipelineConcurrency: Number(config?.mediaPipelineConcurrency ?? 2),
    mediaPipelineQueueMax: Number(config?.mediaPipelineQueueMax ?? 500),
    testTargetMode: String(config?.testTargetMode || 'contacts-and-groups'),
    testJid: String(config?.testJid || ''),
    testJids: toTrimmedStringArray(config?.testJids),
    groupWhitelistJids: toTrimmedStringArray(config?.groupWhitelistJids),
    dashboardHost: String(config?.dashboardHost || '127.0.0.1'),
    dashboardPort: Number(config?.dashboardPort || 8787),
  };
}

function normalizeSetupSearch(value) {
  return String(value ?? '').trim().toLowerCase();
}

function hydrateContactCacheFromDb(limit = 10000) {
  const rows = listContactDisplayNames(limit);
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  contactCache.hydrate(
    rows.map(item => ({
      jid: item?.jid,
      name: item?.name,
    }))
  );
  return rows.length;
}

function resolveContactDisplayName(jid) {
  const normalizedJid = String(jid ?? '').trim();
  if (!normalizedJid) return '';
  const raw = String(contactCache.get(normalizedJid)?.name ?? '').trim();
  if (raw) return raw.replace(/^~+\s*/, '').trim() || raw;
  const persisted = getContactDisplayName(normalizedJid);
  if (persisted) {
    contactCache.hydrate([{ jid: normalizedJid, name: persisted }]);
    return persisted;
  }
  return normalizedJid;
}

function targetMatchesSearch(target, normalizedSearch) {
  if (!normalizedSearch) return true;
  const jid = String(target?.jid ?? '').toLowerCase();
  const name = String(target?.name ?? '').toLowerCase();
  return jid.includes(normalizedSearch) || name.includes(normalizedSearch);
}

async function listSetupSelectableTargets({ search = '', limit = 300 } = {}) {
  const normalizedSearch = normalizeSetupSearch(search);
  const maxLimit = Math.max(1, Math.min(1000, Number(limit) || 300));

  const contactsFromCache = await fetchSelectableContacts(contactCache);
  const groupsFromSocket = currentSocket
    ? await fetchSelectableGroups(currentSocket).catch(() => [])
    : [];
  const recoveredFromDb = fetchSavedTestTargetJidsFromDb(contactCache, 2500);

  const contactsByJid = new Map();
  const groupsByJid = new Map();

  for (const contact of contactsFromCache) {
    const jid = String(contact?.jid ?? '').trim();
    if (!isUserJid(jid)) continue;
    contactsByJid.set(jid, {
      jid,
      name: String(contact?.name ?? jid).trim() || jid,
      source: 'cache',
    });
  }

  for (const group of groupsFromSocket) {
    const jid = String(group?.jid ?? '').trim();
    if (!isGroupJid(jid)) continue;
    groupsByJid.set(jid, {
      jid,
      name: String(group?.name ?? jid).trim() || jid,
      participants: Math.max(0, Number(group?.participants) || 0),
      source: 'socket',
    });
  }

  for (const entry of recoveredFromDb) {
    const jid = String(entry?.jid ?? '').trim();
    if (!jid) continue;

    if (isUserJid(jid)) {
      if (!contactsByJid.has(jid)) {
        contactsByJid.set(jid, {
          jid,
          name: String(entry?.name ?? jid).trim() || jid,
          source: 'db',
        });
      }
      continue;
    }

    if (isGroupJid(jid) && !groupsByJid.has(jid)) {
      groupsByJid.set(jid, {
        jid,
        name: String(entry?.name ?? jid).trim() || jid,
        participants: 0,
        source: 'db',
      });
    }
  }

  const contacts = [...contactsByJid.values()]
    .filter(target => targetMatchesSearch(target, normalizedSearch))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, maxLimit);

  const groups = [...groupsByJid.values()]
    .filter(target => targetMatchesSearch(target, normalizedSearch))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, maxLimit);

  return {
    contacts,
    groups,
    socketReady: Boolean(currentSocket),
    updatedAt: Date.now(),
  };
}

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
  if (input.dashboardHost !== undefined) {
    patch.dashboardHost = String(input.dashboardHost || '').trim();
  }
  if (input.dashboardPort !== undefined) {
    patch.dashboardPort = Number(input.dashboardPort);
  }

  return patch;
}

function openDashboardInBrowser(url) {
  if (dashboardAutoOpenAttempted) return;
  dashboardAutoOpenAttempted = true;

  if (String(process.env.TMB_DASHBOARD_AUTO_OPEN ?? '1') === '0') return;
  if (!process.stdout?.isTTY) return;

  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
      return;
    }
    if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
      return;
    }
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // ignore auto-open failures
  }
}

async function applyRuntimeConfigFromDashboard(input = {}) {
  const patchOrError = normalizeSetupPatch(input);
  if (patchOrError == null) {
    return { ok: false, error: 'invalid setup payload' };
  }
  if (patchOrError.error) {
    return { ok: false, error: patchOrError.error };
  }

  const nextConfig = normalizeUserConfig({
    ...config,
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

  config = nextConfig;
  currentFlowRegistry = nextRegistry;
  warnedMissingTestTargets = false;
  runtimeSetupDone = true;
  saveUserConfig(config);

  const suppressSignalNoise =
    config.runtimeMode === RUNTIME_MODE.PRODUCTION &&
    String(process.env.TMB_SUPPRESS_SIGNAL_NOISE ?? '1') !== '0';
  installLibSignalNoiseFilter(suppressSignalNoise);
  if (logger) {
    logger.level = config.logLevel;
  }
  initializeRuntimeSchedulers(config);
  applyDatabaseRuntimeConfigFromAppConfig(config);
  startDatabaseMaintenanceScheduler();

  if (currentSocket) {
    startSessionCleanup(currentSocket, getActiveFlows());
  }

  setupFlowWatcher();
  requiresInitialSetup = false;
  hasSavedConfigAtBoot = true;

  await ensureWhatsAppRuntimeStarted();

  return {
    ok: true,
    needsInitialSetup: requiresInitialSetup,
    hasSavedConfig: true,
    config: buildSetupConfigSnapshot(),
  };
}

async function ensureWhatsAppRuntimeStarted() {
  if (whatsappRuntimeStarted) return;
  if (whatsappRuntimeStartPromise) {
    await whatsappRuntimeStartPromise;
    return;
  }

  whatsappRuntimeStartPromise = (async () => {
    const { state, saveCreds } = useSqliteAuthState();
    const { version } = await fetchLatestBaileysVersion();
    console.log(`Versao Baileys: ${version.join('.')}\n`);
    await connectToWhatsApp({ state, saveCreds, version });
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

  dashboardServer = new DashboardServer({
    host: config.dashboardHost,
    port: config.dashboardPort,
    logger,
    getRuntimeInfo: () => ({
      ...normalizeRuntimeInfo(),
      needsInitialSetup: requiresInitialSetup,
      apis: getActiveFlows()
        .flatMap(flow => flow.blocks || [])
        ?.filter(b => b.type === 'http-request')
        .map(b => ({
          name: extractApiHostFromTemplateUrl(b.config?.url),
          url: b.config?.url || 'Desconhecida',
        })) || []
    }),
    getFlowBlocks: () => getDashboardFlow()?.blocks ?? [],
    getContactName: (jid) => {
      const name = resolveContactDisplayName(jid);
      return name || null;
    },
    onReload: async () => await reloadFlow({ source: 'dashboard' }),
    onHumanSendMessage: async ({ jid, text, actor }) => {
      const sock = currentSocket;
      if (!sock) {
        return { ok: false, error: 'socket-not-ready' };
      }

      try {
        await sendTextMessage(sock, jid, text, { __skipConversationLog: true });
        logConversationEvent({
          eventType: 'human-message-outgoing',
          direction: 'outgoing',
          jid,
          messageText: text,
          metadata: {
            kind: 'text',
            actor,
            source: 'dashboard-human-support',
          },
        });
        return { ok: true };
      } catch (error) {
        return { ok: false, error: String(error?.message || error || 'send-failed') };
      }
    },
    onHumanSendImage: async ({ jid, actor, caption, imageBuffer, mimeType, mediaId, mediaUrl, fileName }) => {
      const sock = currentSocket;
      if (!sock) {
        return { ok: false, error: 'socket-not-ready' };
      }

      try {
        await sendImageMessage(sock, jid, {
          imageBuffer,
          caption: String(caption || '').trim() || undefined,
          mimeType: mimeType || '',
        }, { __skipConversationLog: true });

        logConversationEvent({
          eventType: 'human-image-outgoing',
          direction: 'outgoing',
          jid,
          messageText: String(caption || '').trim() || `[Imagem] ${fileName || mediaId || ''}`.trim(),
          metadata: {
            kind: 'image',
            actor,
            source: 'dashboard-human-support',
            mediaId: mediaId || null,
            mediaUrl: mediaUrl || null,
            mediaType: mimeType || null,
            fileName: fileName || null,
          },
        });
        return { ok: true };
      } catch (error) {
        return { ok: false, error: String(error?.message || error || 'send-image-failed') };
      }
    },
    onHumanResumeSession: async ({ jid, targetBlockIndex, targetBlockId, actor }) => {
      const sock = currentSocket;
      const flow = getDashboardFlow();
      if (!sock || !flow) {
        return { ok: false, error: 'runtime-not-ready' };
      }

      const result = await resumeSessionFromHumanHandoff({
        sock,
        jid,
        flow,
        targetBlockIndex,
        actor,
      });

      if (!result?.ok) return result;

      logConversationEvent({
        eventType: 'human-handoff-resume-request',
        direction: 'system',
        jid,
        messageText: `Retomada solicitada para bloco ${targetBlockId || targetBlockIndex}`,
        metadata: {
          actor,
          targetBlockId: targetBlockId || null,
          targetBlockIndex,
          source: 'dashboard-human-support',
        },
      });

      return result;
    },
    onHumanEndSession: async ({ jid, reason, actor }) => {
      const flow = getDashboardFlow();
      if (!flow) {
        return { ok: false, error: 'runtime-not-ready' };
      }

      const result = await endSessionFromDashboard({ jid, flow, reason, actor });
      if (!result?.ok) return result;

      logConversationEvent({
        eventType: 'human-handoff-ended',
        direction: 'system',
        jid,
        messageText: 'Sessao encerrada manualmente pela equipe',
        metadata: {
          actor,
          reason,
          source: 'dashboard-human-support',
        },
      });

      return result;
    },
    onBroadcastListContacts: async ({ search, limit }) => {
      if (!broadcastService) {
        return [];
      }
      const contacts = broadcastService.listContacts({ search, limit });
      return contacts.map(contact => ({
        ...contact,
        name: String(contact?.name || '').trim() || resolveContactDisplayName(contact?.jid),
      }));
    },
    onBroadcastSend: async ({ actor, target, selectedJids, message }) => {
      const sock = currentSocket;
      if (!sock) {
        return { ok: false, error: 'socket-not-ready' };
      }
      if (!broadcastService) {
        return { ok: false, error: 'broadcast-service-not-ready' };
      }

      try {
        const builtMessage = buildBroadcastMessage({
          text: message?.text ?? '',
          imageDataUrl: message?.imageDataUrl ?? '',
          mimeType: message?.mimeType ?? '',
          fileName: message?.fileName ?? '',
        });

        const result = await broadcastService.send({
          sock,
          actor,
          target,
          selectedJids,
          message: builtMessage,
          onProgress: (progress) => {
            emitDashboardBroadcastProgress({
              actor,
              target,
              ...progress,
            });
          },
        });

        const sentSummaryText = `Campanha #${result.campaignId}: ${result.sent}/${result.attempted} envios`;
        logConversationEvent({
          eventType: 'broadcast-dispatch',
          direction: 'system',
          jid: 'system',
          messageText: sentSummaryText,
          metadata: {
            actor,
            target: result.target,
            attempted: result.attempted,
            sent: result.sent,
            failed: result.failed,
            campaignId: result.campaignId,
          },
        });

        return { ok: true, ...result };
      } catch (error) {
        logger?.error?.(
          {
            err: {
              name: error?.name || 'Error',
              message: error?.message || 'broadcast-send-failed',
              stack: error?.stack || '',
            },
            actor,
            target,
          },
          'Broadcast send failed'
        );
        return { ok: false, error: String(error?.message || 'broadcast-send-failed') };
      }
    },
    onGetSetupState: async () => ({
      needsInitialSetup: requiresInitialSetup,
      hasSavedConfig: hasSavedConfigAtBoot || !requiresInitialSetup,
      config: buildSetupConfigSnapshot(),
    }),
    onApplySetupState: async (input) => {
      const result = await applyRuntimeConfigFromDashboard(input);
      return result;
    },
    onListSetupTargets: async ({ search, limit }) => (
      listSetupSelectableTargets({ search, limit })
    ),
    onGetSettings: async () => ({
      autoReloadFlows: config.autoReloadFlows !== false,
      broadcastSendIntervalMs: Number(config.broadcastSendIntervalMs ?? 250),
      runtimeMode: String(config.runtimeMode || ''),
      dbMaintenanceEnabled: config.dbMaintenanceEnabled !== false,
      dbMaintenanceIntervalMinutes: Number(config.dbMaintenanceIntervalMinutes ?? 30),
      dbRetentionDays: Number(config.dbRetentionDays ?? 30),
      dbRetentionArchiveEnabled: config.dbRetentionArchiveEnabled !== false,
      dbEventBatchEnabled: config.dbEventBatchEnabled !== false,
      dbEventBatchFlushMs: Number(config.dbEventBatchFlushMs ?? 1000),
      dbEventBatchSize: Number(config.dbEventBatchSize ?? 200),
    }),
    onUpdateSettings: async ({
      autoReloadFlows,
      broadcastSendIntervalMs,
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

      config = {
        ...config,
        ...(hasAutoReloadPatch ? { autoReloadFlows } : {}),
        ...(hasBroadcastIntervalPatch ? { broadcastSendIntervalMs: normalizedBroadcastInterval } : {}),
        ...(hasDbMaintenanceEnabledPatch ? { dbMaintenanceEnabled: normalizedDbMaintenanceEnabled } : {}),
        ...(hasDbMaintenanceIntervalPatch ? { dbMaintenanceIntervalMinutes: normalizedDbMaintenanceInterval } : {}),
        ...(hasDbRetentionDaysPatch ? { dbRetentionDays: normalizedDbRetentionDays } : {}),
        ...(hasDbRetentionArchivePatch ? { dbRetentionArchiveEnabled: normalizedDbRetentionArchiveEnabled } : {}),
        ...(hasDbEventBatchEnabledPatch ? { dbEventBatchEnabled: normalizedDbEventBatchEnabled } : {}),
        ...(hasDbEventBatchFlushMsPatch ? { dbEventBatchFlushMs: normalizedDbEventBatchFlushMs } : {}),
        ...(hasDbEventBatchSizePatch ? { dbEventBatchSize: normalizedDbEventBatchSize } : {}),
      };
      saveUserConfig(config);
      setupFlowWatcher();
      applyDatabaseRuntimeConfigFromAppConfig(config);
      startDatabaseMaintenanceScheduler();
      logger?.info?.({
        ...(hasAutoReloadPatch ? { autoReloadFlows } : {}),
        ...(hasBroadcastIntervalPatch ? { broadcastSendIntervalMs: normalizedBroadcastInterval } : {}),
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
        autoReloadFlows: config.autoReloadFlows !== false,
        broadcastSendIntervalMs: Number(config.broadcastSendIntervalMs ?? 250),
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
    onClearRuntimeCache: async () => {
      try {
        clearEngineRuntimeCaches();
        contactCache.clear();
        logger?.info?.('Runtime caches cleared from dashboard settings');
        return { ok: true };
      } catch (error) {
        logger?.error?.(
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
    onGetDbMaintenance: async () => ({
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
    }),
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

      config = {
        ...config,
        ...(normalizedEnabled !== null ? { dbMaintenanceEnabled: normalizedEnabled } : {}),
        ...(normalizedInterval !== null ? { dbMaintenanceIntervalMinutes: normalizedInterval } : {}),
        ...(normalizedRetentionDays !== null ? { dbRetentionDays: normalizedRetentionDays } : {}),
        ...(normalizedRetentionArchive !== null ? { dbRetentionArchiveEnabled: normalizedRetentionArchive } : {}),
        ...(normalizedBatchEnabled !== null ? { dbEventBatchEnabled: normalizedBatchEnabled } : {}),
        ...(normalizedBatchFlushMs !== null ? { dbEventBatchFlushMs: normalizedBatchFlushMs } : {}),
        ...(normalizedBatchSize !== null ? { dbEventBatchSize: normalizedBatchSize } : {}),
      };

      saveUserConfig(config);
      const runtimeConfig = applyDatabaseRuntimeConfigFromAppConfig(config);
      startDatabaseMaintenanceScheduler();

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
        logger?.info?.({ removed: removed.length }, 'Cleared all active sessions');
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
        logger?.info?.({ flowPath: normalizedFlowPath, removed: removed.length }, 'Cleared active sessions by flow');
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
        logger?.info?.({ jid: normalizedJid, removed: active.length }, 'Reset sessions by JID');
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

      config = {
        ...config,
        flowSessionTimeoutOverrides: {
          ...(config.flowSessionTimeoutOverrides || {}),
          [normalizedFlowPath]: normalizedTimeout,
        },
      };
      saveUserConfig(config);
      logger?.info?.({ flowPath: normalizedFlowPath, sessionTimeoutMinutes: normalizedTimeout }, 'Updated flow timeout');

      return {
        ok: true,
        flowPath: normalizedFlowPath,
        sessionTimeoutMinutes: normalizedTimeout,
      };
    },
  });

  await dashboardServer.start();

  if (removeConversationEventListener) {
    removeConversationEventListener();
  }
  removeConversationEventListener = onConversationEvent(event => {
    dashboardServer?.broadcast(event);
  });

  console.log(`Dashboard HTTP: ${dashboardServer.getUrl()}`);
  openDashboardInBrowser(dashboardServer.getUrl());
}

function stopFlowWatcher() {
  if (!Array.isArray(flowWatchers) || flowWatchers.length === 0) return;
  for (const watcher of flowWatchers) {
    try {
      watcher?.close?.();
    } catch {
      // ignore
    }
  }
  flowWatchers = [];
}

function scheduleFlowReload(source) {
  clearTimeout(reloadDebounceTimer);
  reloadDebounceTimer = setTimeout(() => {
    void reloadFlow({ source });
  }, 350);
}

function setupFlowWatcher() {
  stopFlowWatcher();
  clearTimeout(reloadDebounceTimer);

  if (!isDevelopmentMode(config) || config.autoReloadFlows === false) return;

  const flowPaths = getActiveFlows().map(flow => path.resolve(flow.flowPath));
  const byDirectory = new Map();

  for (const absoluteFlowPath of flowPaths) {
    const flowDir = path.dirname(absoluteFlowPath);
    const fileSet = byDirectory.get(flowDir) ?? new Set();
    fileSet.add(path.basename(absoluteFlowPath).toLowerCase());
    byDirectory.set(flowDir, fileSet);
  }

  for (const [flowDir, fileSet] of byDirectory.entries()) {
    try {
      const watcher = fs.watch(flowDir, { persistent: true }, (eventType, filename) => {
        const normalizedFilename = String(filename ?? '').trim().toLowerCase();
        if (normalizedFilename && !fileSet.has(normalizedFilename)) return;
        scheduleFlowReload(`watch:${eventType || 'change'}`);
      });

      watcher.on('error', err => {
        console.error('Falha no watcher de hot-reload:', err.message || err);
      });

      flowWatchers.push(watcher);
    } catch (err) {
      console.error('Nao foi possivel iniciar hot-reload no dev mode:', err.message || err);
    }
  }

  for (const flowPath of flowPaths) {
    console.log(`Hot-reload ativo (dev mode) para: ${flowPath}`);
  }
}

async function reloadFlow({ source = 'manual' } = {}) {
  if (reloadInProgress) {
    pendingReload = true;
    return;
  }

  reloadInProgress = true;

  try {
    const previousFlows = getActiveFlows();
    let endedSessions = 0;
    for (const flow of previousFlows) {
      endedSessions += await resetActiveSessions('flow-reload', flow);
    }

    const nextRegistry = loadFlowRegistryFromConfig(config);
    currentFlowRegistry = applyFlowSessionTimeoutOverrides(nextRegistry, config);
    warnedMissingTestTargets = false;

    if (currentSocket) {
      startSessionCleanup(currentSocket, getActiveFlows());
    }

    logConversationEvent({
      eventType: 'flow-reload',
      direction: 'system',
      jid: 'system',
      flowPath: currentPrimaryFlowPathForLogs(),
      messageText: `Reload aplicado via ${source}`,
      metadata: {
        source,
        flowPaths: getActiveFlows().map(flow => flow.flowPath),
        endedSessions,
      },
    });

    console.log(`Reload concluido (${source}). Sessoes reiniciadas: ${endedSessions}.`);
  } catch (err) {
    console.error(`Falha ao recarregar fluxo (${source}):`, err.message || err);
  } finally {
    reloadInProgress = false;
    if (pendingReload) {
      pendingReload = false;
      scheduleFlowReload('pending');
    }
  }
}

function printTerminalCommandHelp() {
  console.log('Comandos de terminal disponiveis:');
  console.log('  /reload   recarrega o .tmb atual sem reiniciar processo');
  console.log('  /help     mostra esta ajuda');
}

async function handleTerminalCommand(rawLine) {
  const input = String(rawLine ?? '').trim();
  if (!input) return;

  const command = input.toLowerCase();

  if (command === '/reload' || command === 'reload') {
    await reloadFlow({ source: 'terminal' });
    return;
  }

  if (command === '/help' || command === 'help') {
    printTerminalCommandHelp();
    return;
  }

  console.log(`Comando desconhecido: ${input}`);
  printTerminalCommandHelp();
}

function initializeTerminalCommands() {
  if (!process.stdin.isTTY) return;
  if (terminalCommandInterface) return;

  terminalCommandInterface = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  terminalCommandInterface.on('line', line => {
    void handleTerminalCommand(line).catch(err => {
      console.error('Erro ao processar comando de terminal:', err.message || err);
    });
  });

  printTerminalCommandHelp();
}

async function start() {
  console.log('Iniciando Interpretador de Bot WhatsApp...\n');

  runtimeSetupPromise = null;
  runtimeSetupDone = false;
  warnedMissingTestTargets = false;
  dashboardAutoOpenAttempted = false;

  const savedConfig = loadSavedUserConfig();
  hasSavedConfigAtBoot = Boolean(savedConfig);
  requiresInitialSetup = !hasSavedConfigAtBoot;

  config = await getConfig({ interactive: false });

  const suppressSignalNoise =
    config.runtimeMode === RUNTIME_MODE.PRODUCTION &&
    String(process.env.TMB_SUPPRESS_SIGNAL_NOISE ?? '1') !== '0';
  installLibSignalNoiseFilter(suppressSignalNoise);

  logger = createRuntimeLogger(config);
  initializeRuntimeSchedulers(config);
  broadcastService = createBroadcastService({
    logger,
    getSendDelayMs: () => Number(config?.broadcastSendIntervalMs ?? 250),
  });

  await initDb();
  applyDatabaseRuntimeConfigFromAppConfig(config);
  console.log('Banco de dados inicializado (better-sqlite3 + WAL)');
  const hydratedContacts = hydrateContactCacheFromDb(15000);
  if (hydratedContacts > 0) {
    console.log(`Cache de contatos restaurado do banco: ${hydratedContacts} registro(s)`);
  }
  cleanupSignalAuthState({ reason: 'startup', forceLog: true });
  startAuthStateMaintenance();
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

function resolveQueueJidFromIncomingMessage(msg) {
  const messageKey = msg?.key && typeof msg.key === 'object' ? msg.key : {};
  const remoteJid = String(messageKey.remoteJid ?? messageKey.remote_jid ?? '').trim();
  if (!remoteJid) return '';
  const senderPn = String(messageKey.senderPn ?? messageKey.sender_pn ?? '').trim();
  if (remoteJid.endsWith('@lid') && senderPn) {
    return senderPn;
  }
  return remoteJid;
}

function enqueuePostProcessTask({ key = 'post', taskName = 'post-task', task }) {
  if (typeof task !== 'function') return;
  ingestionRuntimeCounters.postTasksQueued += 1;

  if (!postProcessQueue) {
    try {
      task();
    } catch (error) {
      ingestionRuntimeCounters.postTasksFailed += 1;
      logger?.error?.(
        {
          taskName,
          err: {
            name: error?.name || 'Error',
            message: error?.message || 'post-task-failed',
            stack: error?.stack || '',
          },
        },
        'Post-process task failed (direct execution)'
      );
    }
    return;
  }

  const result = postProcessQueue.enqueue({
    key: String(key || 'post'),
    priority: 'low',
    payload: null,
    handler: async () => {
      try {
        await task();
      } catch (error) {
        ingestionRuntimeCounters.postTasksFailed += 1;
        logger?.error?.(
          {
            taskName,
            err: {
              name: error?.name || 'Error',
              message: error?.message || 'post-task-failed',
              stack: error?.stack || '',
            },
          },
          'Post-process task failed'
        );
      }
    },
  });

  if (!result?.accepted) {
    ingestionRuntimeCounters.postTasksDropped += 1;
    const dropped = ingestionRuntimeCounters.postTasksDropped;
    if (dropped === 1 || dropped % 100 === 0) {
      logger?.warn?.(
        {
          taskName,
          dropped,
          queued: Number(result?.snapshot?.queued ?? 0),
          maxQueueSize: Number(result?.snapshot?.maxQueueSize ?? 0),
        },
        'Post-process task dropped due to queue overflow'
      );
    }
  }
}

function logConversationEventAsync(event, { key = '' } = {}) {
  const queueKey = String(key || event?.jid || 'post');
  enqueuePostProcessTask({
    key: queueKey,
    taskName: `conversation-event:${String(event?.eventType || 'unknown')}`,
    task: () => {
      logConversationEvent(event);
    },
  });
}

function enqueueIncomingMediaCapture({
  sock,
  msg,
  jid,
  actorJid,
  id,
  mediaMimeType,
  mediaFileName,
  flowPaths = [],
}) {
  ingestionRuntimeCounters.mediaQueued += 1;
  const queueKey = String(jid || 'media');

  if (!mediaPipelineQueue) {
    void (async () => {
      try {
        const media = await captureIncomingImageForDashboard({
          msg,
          sock,
          mimeType: mediaMimeType,
          fileName: mediaFileName || `incoming-${id || Date.now()}`,
        });
        if (!media) return;
        ingestionRuntimeCounters.mediaCaptured += 1;
        for (const flowPath of flowPaths) {
          logConversationEventAsync({
            eventType: 'message-media-captured',
            direction: 'system',
            jid: actorJid || jid,
            flowPath,
            messageText: '[Imagem armazenada para dashboard]',
            metadata: {
              id: id || null,
              actorJid: actorJid || null,
              chatJid: jid,
              mediaType: mediaMimeType || null,
              mediaUrl: media.mediaUrl || null,
              mediaId: media.mediaId || null,
            },
          }, { key: jid });
        }
      } catch {
        ingestionRuntimeCounters.mediaCaptureFailed += 1;
      }
    })();
    return;
  }

  const enqueueResult = mediaPipelineQueue.enqueue({
    key: queueKey,
    priority: 'low',
    payload: null,
    handler: async () => {
      try {
        const media = await captureIncomingImageForDashboard({
          msg,
          sock,
          mimeType: mediaMimeType,
          fileName: mediaFileName || `incoming-${id || Date.now()}`,
        });
        if (!media) return;
        ingestionRuntimeCounters.mediaCaptured += 1;
        for (const flowPath of flowPaths) {
          logConversationEventAsync({
            eventType: 'message-media-captured',
            direction: 'system',
            jid: actorJid || jid,
            flowPath,
            messageText: '[Imagem armazenada para dashboard]',
            metadata: {
              id: id || null,
              actorJid: actorJid || null,
              chatJid: jid,
              mediaType: mediaMimeType || null,
              mediaUrl: media.mediaUrl || null,
              mediaId: media.mediaId || null,
            },
          }, { key: jid });
        }
      } catch {
        ingestionRuntimeCounters.mediaCaptureFailed += 1;
      }
    },
  });

  if (!enqueueResult?.accepted) {
    ingestionRuntimeCounters.mediaQueueDropped += 1;
    const dropped = ingestionRuntimeCounters.mediaQueueDropped;
    if (dropped === 1 || dropped % 50 === 0) {
      logger?.warn?.(
        {
          dropped,
          queued: Number(enqueueResult?.snapshot?.queued ?? 0),
          maxQueueSize: Number(enqueueResult?.snapshot?.maxQueueSize ?? 0),
        },
        'Incoming media capture dropped due to media pipeline queue overflow'
      );
    }
  }
}

function resolveDispatchPriority({ messageType }) {
  if (messageType === 'unknown') return 'low';
  return 'high';
}

async function processIncomingUpsertMessage({ sock, msg, type }) {
  const totalStartedAt = Date.now();
  const rawMessageKey = msg?.key && typeof msg.key === 'object' ? msg.key : {};
  mergeContactCacheEntry(contactCache, {
    ...msg,
    key: rawMessageKey,
    notify:
      rawMessageKey.notify ??
      rawMessageKey.Notify ??
      msg?.notify ??
      msg?.Notify ??
      msg?.pushName ??
      msg?.pushname ??
      '',
    verifiedName:
      rawMessageKey.verifiedBizName ??
      rawMessageKey.verifiedName ??
      msg?.verifiedBizName ??
      msg?.verifiedName ??
      '',
  });

  const activeFlows = getActiveFlows();
  if (activeFlows.length === 0) return;

  if (config.debugMode) {
    console.log('Incoming raw', getMessageDebugInfo(msg, type));
  }

  const parseStartedAt = Date.now();
  const parsed = parseMessage(msg);
  ingestionRuntimeCounters.parseMsTotal += Math.max(0, Date.now() - parseStartedAt);
  if (!parsed) {
    ingestionRuntimeCounters.parseDropped += 1;
    if (config.debugMode) {
      console.log('Dropped by parser', getMessageDebugInfo(msg, type));
    }
    return;
  }

  const { id, jid, text, listId, isGroup, messageKey, messageType, mediaMimeType, mediaFileName } = parsed;
  const actorJid = resolveIncomingActorJid(parsed);

  const groupWhitelist = getGroupWhitelistJids(config);
  const allowedTestJids = getAllowedTestJids(config);

  if (config.testMode) {
    if (allowedTestJids.size === 0) {
      if (!warnedMissingTestTargets) {
        console.warn('testMode ativo, mas nenhum contato/grupo permitido foi selecionado.');
        warnedMissingTestTargets = true;
      }
      ingestionRuntimeCounters.filteredOut += 1;
      return;
    }
    if (!allowedTestJids.has(jid)) {
      ingestionRuntimeCounters.filteredOut += 1;
      return;
    }
  }

  const incomingText = String(text ?? '').trim();
  const hasCommandPrefix = incomingText.startsWith('/');
  const dispatchFlows = [];
  const routingStartedAt = Date.now();

  for (const flow of activeFlows) {
    const interactionScope = normalizeInteractionScope(flow);
    const requiresGroupWhitelist = isGroupWhitelistScope(flow);
    if (!shouldProcessByInteractionScope(isGroup, flow)) {
      continue;
    }

    if (requiresGroupWhitelist && isGroup) {
      if (groupWhitelist.size === 0) continue;
      if (!groupWhitelist.has(jid)) continue;
    }

    const scope = { flowPath: flow.flowPath, botType: getFlowBotType(flow) };
    const existingSession = getSession(jid, scope);
    const hasActiveSession = existingSession?.status === 'active';
    const botType = getFlowBotType(flow);

    if (botType === 'command') {
      if (!hasActiveSession && !hasCommandPrefix) continue;
      dispatchFlows.push(flow);
      continue;
    }

    if (hasActiveSession || !hasCommandPrefix) {
      dispatchFlows.push(flow);
    }

    if (config.debugMode) {
      console.log('Decision', {
        id,
        jid,
        flowPath: flow.flowPath,
        botType,
        actorJid: actorJid || null,
        textLength: incomingText.length,
        listId,
        isGroup,
        interactionScope,
        requiresGroupWhitelist,
        hasActiveSession,
        groupWhitelistCount: groupWhitelist.size,
        testMode: config.testMode,
        testJidsCount: allowedTestJids.size,
        passesTestMode: !config.testMode || allowedTestJids.has(jid),
      });
    }
  }
  ingestionRuntimeCounters.routingMsTotal += Math.max(0, Date.now() - routingStartedAt);

  if (dispatchFlows.length === 0) {
    ingestionRuntimeCounters.filteredOut += 1;
    return;
  }

  if (messageType === 'image') {
    enqueueIncomingMediaCapture({
      sock,
      msg,
      jid,
      actorJid,
      id,
      mediaMimeType,
      mediaFileName,
      flowPaths: dispatchFlows.map(item => item.flowPath),
    });
  }

  const resolvedMessageText =
    incomingText ||
    (messageType === 'image' ? '[Imagem recebida]' : '');

  const mediaState = messageType === 'image' ? 'queued' : 'none';
  for (const flow of dispatchFlows) {
    logConversationEventAsync({
      eventType: 'message-incoming',
      direction: 'incoming',
      jid: actorJid || jid,
      flowPath: flow.flowPath,
      messageText: resolvedMessageText,
      metadata: {
        id,
        listId: listId ?? null,
        isGroup,
        actorJid: actorJid || null,
        chatJid: jid,
        kind: messageType || 'unknown',
        mediaType: messageType === 'image' ? mediaMimeType || null : null,
        mediaState,
        mediaUrl: null,
        mediaId: null,
        routedFlowPath: flow.flowPath,
        routedFlowBotType: getFlowBotType(flow),
        routedFlowPaths: dispatchFlows.map(item => item.flowPath),
      },
    }, { key: jid });
  }

  if (config.debugMode) {
    console.log(`Mensagem de ${jid}: "${text}" ${listId ? `(listId: ${listId})` : ''} [ID msg: ${id || 'unknown'}]`);
  }

  const dispatchPriority = resolveDispatchPriority({ messageType });
  const taskPromises = [];
  for (const flow of dispatchFlows) {
    if (!dispatchScheduler) {
      taskPromises.push(handleIncoming(sock, jid, text, listId, flow, id, messageKey));
      continue;
    }

    const scheduled = dispatchScheduler.enqueue({
      jid,
      flowPath: flow.flowPath,
      priority: dispatchPriority,
      payload: null,
      handler: async () => {
        await handleIncoming(sock, jid, text, listId, flow, id, messageKey);
      },
    });

    if (!scheduled?.accepted) {
      logger?.warn?.(
        {
          jid,
          flowPath: flow.flowPath,
          queued: Number(scheduled?.snapshot?.queued ?? 0),
          maxQueueSize: Number(scheduled?.snapshot?.maxQueueSize ?? 0),
        },
        'Dispatch task dropped due to scheduler overflow'
      );
      continue;
    }
    taskPromises.push(scheduled.promise);
  }

  try {
    await Promise.all(taskPromises);
    ingestionRuntimeCounters.processedMessages += 1;
  } catch (err) {
    ingestionRuntimeCounters.processingFailed += 1;
    console.error(`Erro no motor para ${jid}:`, err);
    logConversationEventAsync({
      eventType: 'engine-error',
      direction: 'system',
      jid,
      messageText: 'Erro no motor ao processar mensagem',
      metadata: {
        id,
        actorJid: actorJid || null,
        chatJid: jid,
        error: formatError(err),
      },
    }, { key: jid });
  } finally {
    ingestionRuntimeCounters.totalMsTotal += Math.max(0, Date.now() - totalStartedAt);
  }
}

function enqueueIncomingUpsertMessage({ sock, msg, type }) {
  ingestionRuntimeCounters.received += 1;
  if (!ingestionQueue) {
    void processIncomingUpsertMessage({ sock, msg, type });
    return;
  }

  const queueKey = resolveQueueJidFromIncomingMessage(msg);
  const quickMessage = msg?.message && typeof msg.message === 'object' ? msg.message : {};
  const isLikelyMedia = Boolean(
    quickMessage.imageMessage ||
    quickMessage.videoMessage ||
    quickMessage.documentMessage
  );
  const enqueueResult = ingestionQueue.enqueue({
    key: queueKey || 'unknown',
    priority: isLikelyMedia ? 'low' : 'high',
    payload: { sock, msg, type },
    handler: async (payload) => {
      try {
        await processIncomingUpsertMessage(payload);
      } catch (error) {
        logger?.error?.(
          {
            queueKey: queueKey || 'unknown',
            err: {
              name: error?.name || 'Error',
              message: error?.message || 'ingestion-queue-task-failed',
              stack: error?.stack || '',
            },
          },
          'Ingestion queue task failed'
        );
        throw error;
      }
    },
  });

  if (!enqueueResult?.accepted) {
    ingestionRuntimeCounters.queueOverflowDropped += 1;
    const rejectedCount = Number(enqueueResult?.snapshot?.rejected ?? 0);
    if (rejectedCount === 1 || rejectedCount % 100 === 0) {
      logger?.warn?.(
        {
          queueKey: queueKey || 'unknown',
          rejected: rejectedCount,
          queued: Number(enqueueResult?.snapshot?.queued ?? 0),
          maxQueueSize: Number(enqueueResult?.snapshot?.maxQueueSize ?? 0),
        },
        'Incoming message dropped due to ingestion queue overflow'
      );
    }
  }
}

async function connectToWhatsApp({ state, saveCreds, version }) {
  const sock = makeWASocket({
    version,
    logger,
    auth: state,
    printQRInTerminal: false,
    browser: ['WhatsApp Bot', 'Chrome', '120.0.0'],
    markOnlineOnConnect: false,
  });

  currentSocket = sock;
  attachOutgoingMessageLogger(sock);

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('messaging-history.set', ({ contacts, chats }) => {
    mergeContactList(contactCache, contacts);
    mergeChatsIntoContactCache(contactCache, chats);
  });
  sock.ev.on('contacts.upsert', contacts => {
    mergeContactList(contactCache, contacts);
  });
  sock.ev.on('contacts.update', updates => {
    mergeContactList(contactCache, updates);
  });
  sock.ev.on('chats.upsert', chats => {
    mergeChatsIntoContactCache(contactCache, chats);
  });
  sock.ev.on('chats.update', chats => {
    mergeChatsIntoContactCache(contactCache, chats);
  });

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('\nEscaneie este codigo QR com o WhatsApp:\n');
      qrcode.generate(qr, { small: true });
      console.log('');
    }

    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log(
        shouldReconnect
          ? `Conexao fechada (codigo ${statusCode}). Reconectando...`
          : 'Desconectado. Delete as entradas auth_state do banco de dados para reautenticar.'
      );

      if (shouldReconnect) {
        setTimeout(() => {
          void connectToWhatsApp({ state, saveCreds, version });
        }, 3000);
      }
    }

    if (connection === 'open') {
      console.log('Conectado ao WhatsApp!\n');

      runtimeSetupDone = true;

      startSessionCleanup(sock, getActiveFlows());
      initializeTerminalCommands();

      if (config.debugMode) {
        const testJids = Array.from(getAllowedTestJids(config));
        const groupWhitelist = Array.from(getGroupWhitelistJids(config));
        console.log('Debug mode ativo', {
          runtimeMode: config.runtimeMode,
          testMode: config.testMode,
          testJidsCount: testJids.length,
          groupWhitelistCount: groupWhitelist.length,
        });
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    if (reloadInProgress) return;

    if (runtimeSetupPromise) {
      try {
        await runtimeSetupPromise;
      } catch {
        return;
      }
    }

    for (const msg of messages) {
      enqueueIncomingUpsertMessage({ sock, msg, type });
    }
  });

  return sock;
}

start().catch(err => {
  void handleFatal('Erro fatal no start()', err);
});

