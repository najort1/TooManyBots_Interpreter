import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getActiveSessions,
  getConversationDashboardStats,
  getConversationSessionsTotal,
  getConversationEndedByReasonCount,
  listConversationSessionStarts,
  listConversationSessionEndsByReason,
  listConversationEvents,
  listConversationEventsByFlowPath,
  listConversationEventsByJids,
  listConversationEventsSince,
  listConversationEventsSinceByFlowPath,
} from '../db/index.js';
import { normalizeInt } from '../utils/normalization.js';
import { createDashboardHttpServer } from './httpServer.js';
import { setupDashboardWebsocketServer, broadcastDashboardPayload, stopDashboardWebsocketServer } from './websocketManager.js';
import { sendJson, sendText, decodePathComponent, isPathInsideRoot, tryServePublicAsset, readJsonBody } from './staticFileHandler.js';
import {
  buildConversationFunnel,
  buildRecentErrors,
  buildStatsCacheKey,
  buildWeeklyTrend,
  defaultWsClientState,
  formatActorLabel,
  inferEventChannel,
  normalizeActorJidFromEvent,
  normalizeChatJidFromEvent,
  normalizeTelemetryLevel,
  normalizeWsChannels,
  normalizeWsMode,
  readFreshCacheEntry,
  resolveClientAddress,
  safeAverage,
  toPercentile,
} from './serverMetricsUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LEGACY_PUBLIC_DIR = path.join(__dirname, 'public');
const VITE_DIST_DIR = path.resolve(__dirname, '..', 'tmb_dashboard', 'dist');
const PUBLIC_DIR = fs.existsSync(path.join(VITE_DIST_DIR, 'index.html')) ? VITE_DIST_DIR : LEGACY_PUBLIC_DIR;
const HANDOFF_MEDIA_DIR = path.resolve(__dirname, '..', 'data', 'handoff-media');

const STATIC_MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

const ALLOWED_HANDOFF_IMAGE_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const STATS_CACHE_TTL_MS = 1500;
const HANDOFF_SESSIONS_CACHE_TTL_MS = 1000;
const WS_BATCH_FLUSH_MS = 250;
const WS_BATCH_MAX_EVENTS = 60;
const ROUTE_RATE_LIMITS = new Map([
  ['/api/stats', { windowMs: 1000, max: 8 }],
  ['/api/logs', { windowMs: 1000, max: 10 }],
  ['/api/observability', { windowMs: 1000, max: 6 }],
  ['/api/handoff/sessions', { windowMs: 1000, max: 6 }],
  ['/api/setup/targets', { windowMs: 1000, max: 6 }],
  ['/api/broadcast/contacts', { windowMs: 1000, max: 6 }],
]);
const TELEMETRY_SAMPLE_CAP_BY_LEVEL = {
  minimum: 0,
  operational: 120,
  diagnostic: 400,
  verbose: 1000,
};
const TELEMETRY_TABLE_LIMIT_BY_LEVEL = {
  minimum: 0,
  operational: 10,
  diagnostic: 30,
  verbose: 100,
};

function toInt(value, fallback) {
  return normalizeInt(value, fallback);
}

function getTodayBounds(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  return { start, end };
}

function sanitizeFileName(value) {
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
  return '';
}

function parseDataUrlImage(dataUrl, declaredMimeType = '') {
  const raw = String(dataUrl ?? '').trim();
  const match = raw.match(/^data:([^;]+);base64,([a-z0-9+/=]+)$/i);
  if (!match) {
    throw new Error('imageDataUrl inválido');
  }

  const inferredMimeType = String(match[1] || '').toLowerCase();
  const mimeType = String(declaredMimeType || inferredMimeType).toLowerCase();
  if (!ALLOWED_HANDOFF_IMAGE_MIME.has(mimeType)) {
    throw new Error('Tipo de imagem não suportado');
  }

  const base64 = match[2];
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) throw new Error('Imagem vazia');
  if (buffer.length > 8 * 1024 * 1024) throw new Error('Imagem excede limite de 8MB');
  return { buffer, mimeType };
}

function saveHandoffMedia({ imageBuffer, mimeType, fileName = '' }) {
  fs.mkdirSync(HANDOFF_MEDIA_DIR, { recursive: true });

  const ext = extensionFromMimeType(mimeType) || '.bin';
  const baseName = sanitizeFileName(fileName).replace(/\.[^.]+$/, '') || 'upload';
  const mediaId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${baseName}${ext}`;
  const mediaPath = path.resolve(HANDOFF_MEDIA_DIR, mediaId);

  fs.writeFileSync(mediaPath, imageBuffer);
  return {
    mediaId,
    mediaPath,
    mediaUrl: `/api/handoff/media/${encodeURIComponent(mediaId)}`,
  };
}

function normalizeFlowPath(value) {
  return String(value ?? '').trim();
}

function normalizeModeParam(value, fallback = 'conversation') {
  const normalized = String(value ?? fallback).trim().toLowerCase();
  return normalized === 'command' ? 'command' : 'conversation';
}

function toFlowPathArray(value) {
  if (!Array.isArray(value)) return [];
  const dedup = new Set();
  const result = [];
  for (const item of value) {
    const flowPath = normalizeFlowPath(item);
    if (!flowPath || dedup.has(flowPath)) continue;
    dedup.add(flowPath);
    result.push(flowPath);
  }
  return result;
}

function resolveFlowPathsForMode(runtimeInfo, mode) {
  const byMode = runtimeInfo?.flowPathsByMode && typeof runtimeInfo.flowPathsByMode === 'object'
    ? runtimeInfo.flowPathsByMode
    : {};
  const direct = toFlowPathArray(byMode?.[mode]);
  if (direct.length > 0) return direct;

  const fallbackSingle = normalizeFlowPath(runtimeInfo?.flowPath);
  return fallbackSingle ? [fallbackSingle] : [];
}

function dedupeSortEvents(events = [], limit = 200) {
  const byKey = new Map();
  for (const event of events) {
    const key = Number.isFinite(event?.id)
      ? `id:${event.id}`
      : `${Number(event?.occurredAt) || 0}:${event?.eventType || ''}:${event?.jid || ''}:${event?.messageText || ''}`;
    const prev = byKey.get(key);
    if (!prev || (Number(event?.id) || 0) > (Number(prev?.id) || 0)) {
      byKey.set(key, event);
    }
  }

  return [...byKey.values()]
    .sort((a, b) => (Number(a?.occurredAt) || 0) - (Number(b?.occurredAt) || 0) || (Number(a?.id) || 0) - (Number(b?.id) || 0))
    .slice(-Math.max(1, Math.min(5000, Number(limit) || 200)));
}

function listModeEvents({ runtimeInfo, mode, since = 0, limit = 500 }) {
  const flowPaths = resolveFlowPathsForMode(runtimeInfo, mode);
  if (flowPaths.length === 0) {
    return since > 0
      ? listConversationEventsSince(since, limit)
      : listConversationEvents(limit);
  }

  const rows = flowPaths.flatMap(flowPath => (
    since > 0
      ? listConversationEventsSinceByFlowPath(flowPath, since, limit)
      : listConversationEventsByFlowPath(flowPath, limit)
  ));

  return dedupeSortEvents(rows, limit);
}

function normalizeActor(value, fallback = 'dashboard-agent') {
  return String(value ?? '').trim() || fallback;
}

function parseObjectValue(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function getHumanHandoffFromSession(session) {
  return parseObjectValue(session?.variables?.__humanHandoff);
}

function findLastMessageForSession(events = []) {
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const text = String(event?.messageText ?? '').trim();
    if (!text) continue;
    if (
      event?.eventType === 'message-incoming' ||
      event?.eventType === 'message-outgoing' ||
      event?.eventType === 'human-message-outgoing' ||
      event?.eventType === 'human-image-outgoing'
    ) {
      return {
        eventType: event.eventType,
        occurredAt: Number(event.occurredAt) || 0,
        text,
      };
    }
  }

  return { eventType: '', occurredAt: 0, text: '' };
}

function normalizeFlowBlocks(blocks = []) {
  if (!Array.isArray(blocks)) return [];
  return blocks
    .map((block, index) => ({
      index,
      id: String(block?.id ?? '').trim(),
      type: String(block?.type ?? '').trim(),
      name: String(block?.name ?? '').trim(),
    }))
    .filter(block => block.id);
}

function resolveBlockIndex(targetBlockIndex, targetBlockId, flowBlocks = []) {
  const byIndex = Number(targetBlockIndex);
  if (Number.isInteger(byIndex) && byIndex >= 0 && byIndex < flowBlocks.length) {
    return byIndex;
  }

  const targetId = String(targetBlockId ?? '').trim();
  if (!targetId) return -1;

  const matched = flowBlocks.find(block => block.id === targetId);
  return matched ? matched.index : -1;
}


export class DashboardServer {
  constructor({
    host = '127.0.0.1',
    port = 8787,
    getRuntimeInfo = () => ({}),
    getFlowBlocks = () => [],
    getContactName = () => null,
    onReload = async () => {},
    onHumanSendMessage = async () => ({ ok: false, error: 'not-implemented' }),
    onHumanSendImage = async () => ({ ok: false, error: 'not-implemented' }),
    onHumanResumeSession = async () => ({ ok: false, error: 'not-implemented' }),
    onHumanEndSession = async () => ({ ok: false, error: 'not-implemented' }),
    onBroadcastListContacts = async () => ({ contacts: [] }),
    onBroadcastSend = async () => ({ ok: false, error: 'not-implemented' }),
    onBroadcastStatus = async () => ({ ok: true, active: false, campaign: null }),
    onBroadcastPause = async () => ({ ok: false, error: 'not-implemented' }),
    onBroadcastResume = async () => ({ ok: false, error: 'not-implemented' }),
    onBroadcastCancel = async () => ({ ok: false, error: 'not-implemented' }),
    onGetSetupState = async () => ({ needsInitialSetup: false, hasSavedConfig: true, config: {} }),
    onApplySetupState = async () => ({ ok: false, error: 'not-implemented' }),
    onListSetupTargets = async () => ({ contacts: [], groups: [], socketReady: false, updatedAt: Date.now() }),
    onGetSettings = async () => ({ autoReloadFlows: true }),
    onUpdateSettings = async () => ({ ok: false, error: 'not-implemented' }),
    onClearRuntimeCache = async () => ({ ok: false, error: 'not-implemented' }),
    onGetDbInfo = async () => ({}),
    onGetDbMaintenance = async () => ({ ok: false, error: 'not-implemented' }),
    onUpdateDbMaintenance = async () => ({ ok: false, error: 'not-implemented' }),
    onRunDbMaintenance = async () => ({ ok: false, error: 'not-implemented' }),
    onGetSessionManagementOverview = async () => ({}),
    onListSessionManagementFlows = async () => [],
    onListActiveSessionsForManagement = async () => [],
    onClearActiveSessionsAll = async () => ({ ok: false, error: 'not-implemented' }),
    onClearActiveSessionsByFlow = async () => ({ ok: false, error: 'not-implemented' }),
    onResetSessionsByJid = async () => ({ ok: false, error: 'not-implemented' }),
    onUpdateFlowSessionTimeout = async () => ({ ok: false, error: 'not-implemented' }),
    logger = null,
  } = {}) {
    this.host = host;
    this.port = port;
    this.getRuntimeInfo = getRuntimeInfo;
    this.getFlowBlocks = getFlowBlocks;
    this.getContactName = getContactName;
    this.onReload = onReload;
    this.onHumanSendMessage = onHumanSendMessage;
    this.onHumanSendImage = onHumanSendImage;
    this.onHumanResumeSession = onHumanResumeSession;
    this.onHumanEndSession = onHumanEndSession;
    this.onBroadcastListContacts = onBroadcastListContacts;
    this.onBroadcastSend = onBroadcastSend;
    this.onBroadcastStatus = onBroadcastStatus;
    this.onBroadcastPause = onBroadcastPause;
    this.onBroadcastResume = onBroadcastResume;
    this.onBroadcastCancel = onBroadcastCancel;
    this.onGetSetupState = onGetSetupState;
    this.onApplySetupState = onApplySetupState;
    this.onListSetupTargets = onListSetupTargets;
    this.onGetSettings = onGetSettings;
    this.onUpdateSettings = onUpdateSettings;
    this.onClearRuntimeCache = onClearRuntimeCache;
    this.onGetDbInfo = onGetDbInfo;
    this.onGetDbMaintenance = onGetDbMaintenance;
    this.onUpdateDbMaintenance = onUpdateDbMaintenance;
    this.onRunDbMaintenance = onRunDbMaintenance;
    this.onGetSessionManagementOverview = onGetSessionManagementOverview;
    this.onListSessionManagementFlows = onListSessionManagementFlows;
    this.onListActiveSessionsForManagement = onListActiveSessionsForManagement;
    this.onClearActiveSessionsAll = onClearActiveSessionsAll;
    this.onClearActiveSessionsByFlow = onClearActiveSessionsByFlow;
    this.onResetSessionsByJid = onResetSessionsByJid;
    this.onUpdateFlowSessionTimeout = onUpdateFlowSessionTimeout;
    this.logger = logger?.child ? logger.child({ module: 'dashboard-server' }) : logger;
    this.server = null;
    this.wss = null;
    this.startupTime = Date.now();
    this.statsSnapshotCache = new Map();
    this.handoffSessionsSnapshot = null;
    this.handoffSessionsSnapshotExpiresAt = 0;
    this.wsClientState = new WeakMap();
    this.routeRateState = new Map();
    this.currentTelemetryLevel = 'operational';
    this.observability = {
      startedAt: Date.now(),
      processCpuStartedAt: process.cpuUsage(),
      http: {
        total: 0,
        errors: 0,
        byRoute: new Map(),
      },
      db: {
        byQuery: new Map(),
      },
      ws: {
        connectionsOpened: 0,
        connectionsClosed: 0,
        eventsSent: 0,
        immediateEventsSent: 0,
        batchedEventsSent: 0,
        batchesSent: 0,
        bytesSent: 0,
        peakConnectedClients: 0,
        byMinute: new Map(),
        lastSentAt: 0,
      },
    };
  }

  buildHandoffSessionsSnapshot() {
    const activeSessions = this.timedDbQuery(
      'getActiveSessions:conversation',
      () => getActiveSessions({ botType: 'conversation' })
    );
    const filtered = activeSessions.filter(session => {
      const handoff = getHumanHandoffFromSession(session);
      const waitingForHuman = String(session.waitingFor || '').trim().toLowerCase() === 'human';
      const handoffActive = handoff.active === true;
      return waitingForHuman || handoffActive;
    });
    if (filtered.length === 0) return [];

    const jids = filtered.map(session => String(session.jid ?? '').trim()).filter(Boolean);
    const eventsByJid = this.timedDbQuery(
      'listConversationEventsByJids',
      () => listConversationEventsByJids(jids, 120)
    );

    return filtered
      .map(session => {
        const handoff = getHumanHandoffFromSession(session);
        const history = Array.isArray(eventsByJid?.[session.jid]) ? eventsByJid[session.jid] : [];
        const lastMessage = findLastMessageForSession(history);
        return {
          jid: session.jid,
          displayName: formatActorLabel(this.getContactName, session.jid),
          flowPath: session.flowPath,
          botType: session.botType,
          waitingFor: session.waitingFor,
          blockIndex: session.blockIndex,
          status: session.status,
          queue: String(handoff.queue ?? '').trim() || 'default',
          reason: String(handoff.reason ?? '').trim(),
          requestedAt: Number(handoff.requestedAt) || 0,
          lastMessage,
          lastActivityAt: Number(handoff.updatedAt) || Number(lastMessage.occurredAt) || 0,
        };
      })
      .sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0));
  }

  getCachedHandoffSessionsSnapshot({ force = false } = {}) {
    const nowTs = Date.now();
    if (!force && this.handoffSessionsSnapshot && this.handoffSessionsSnapshotExpiresAt > nowTs) {
      return this.handoffSessionsSnapshot;
    }

    const snapshot = this.buildHandoffSessionsSnapshot();
    this.handoffSessionsSnapshot = snapshot;
    this.handoffSessionsSnapshotExpiresAt = nowTs + HANDOFF_SESSIONS_CACHE_TTL_MS;
    return snapshot;
  }

  buildStatsSnapshot({ runtimeInfo, mode }) {
    const flowPaths = resolveFlowPathsForMode(runtimeInfo, mode);
    const flowPath = flowPaths.length === 1 ? flowPaths[0] : '';
    const { start, end } = getTodayBounds(new Date());

    const baseStats = this.timedDbQuery(
      'getConversationDashboardStats:daily',
      () => getConversationDashboardStats({ from: start, to: end, flowPath })
    );
    const todayEvents = this.timedDbQuery(
      'listModeEvents:daily',
      () => listModeEvents({
        runtimeInfo,
        mode,
        since: start,
        limit: 10000,
      })
    );

    const hourlyVolume = Array(24).fill(0);
    const userCounts = {};
    const commandCounts = {};
    let totalCommands = 0;
    const scopedEvents = todayEvents.filter(ev => ev.occurredAt >= start && ev.occurredAt <= end);
    const recentErrors = buildRecentErrors(scopedEvents);

    for (const ev of scopedEvents) {
      const hour = new Date(ev.occurredAt).getHours();
      hourlyVolume[hour] += 1;

      if (ev.direction !== 'incoming') continue;
      const actorJid = normalizeActorJidFromEvent(ev);
      if (!actorJid) continue;
      if (actorJid.endsWith('@g.us') || actorJid === 'status@broadcast') continue;

      if (!userCounts[actorJid]) {
        userCounts[actorJid] = { count: 0, commands: {}, lastActivity: 0 };
      }
      userCounts[actorJid].count += 1;
      userCounts[actorJid].lastActivity = Math.max(
        userCounts[actorJid].lastActivity || 0,
        Number(ev.occurredAt) || 0
      );

      if (ev.messageText && ev.messageText.startsWith('/')) {
        totalCommands += 1;
        const cmd = ev.messageText.split(' ')[0].substring(0, 15);
        commandCounts[cmd] = (commandCounts[cmd] || 0) + 1;
        userCounts[actorJid].commands[cmd] = (userCounts[actorJid].commands[cmd] || 0) + 1;
      }
    }

    const topUsers = Object.entries(userCounts)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 15)
      .map(([jid, data]) => {
        const name = formatActorLabel(this.getContactName, jid);
        let favCmd = 'N/A';
        let maxCmd = 0;
        for (const [cmd, count] of Object.entries(data.commands)) {
          if (count > maxCmd) {
            maxCmd = count;
            favCmd = cmd;
          }
        }
        return {
          jid,
          name,
          messageCount: data.count,
          lastActivity: data.lastActivity || 0,
          totalCommands: Object.values(data.commands).reduce((a, b) => a + b, 0),
          favoriteCommand: favCmd,
        };
      });

    const topCommands = Object.entries(commandCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([cmd, count]) => ({
        command: cmd,
        count,
        percentage: Math.round((count / (totalCommands || 1)) * 100),
      }));
    if (topCommands.length === 0 && totalCommands > 0) {
      topCommands.push({ command: '/comando', count: totalCommands, percentage: 100 });
    } else if (topCommands.length === 0) {
      topCommands.push({ command: 'Nenhum comando hoje', count: 1, percentage: 100 });
    }

    if (mode === 'conversation') {
      const totalStats = this.timedDbQuery(
        'getConversationDashboardStats:total',
        () => getConversationDashboardStats({ flowPath })
      );
      const completedSessionsTotal =
        this.timedDbQuery(
          'getConversationEndedByReasonCount:flow-complete-total',
          () => getConversationEndedByReasonCount({ endReason: 'flow-complete', flowPath })
        ) +
        this.timedDbQuery(
          'getConversationEndedByReasonCount:end-conversation-total',
          () => getConversationEndedByReasonCount({ endReason: 'end-conversation', flowPath })
        );
      const totalSessions = this.timedDbQuery(
        'getConversationSessionsTotal',
        () => getConversationSessionsTotal(flowPath)
      );
      const completionRateTotal = totalSessions > 0
        ? Number((completedSessionsTotal / totalSessions).toFixed(4))
        : 0;
      const completedSessions =
        this.timedDbQuery(
          'getConversationEndedByReasonCount:flow-complete-daily',
          () => getConversationEndedByReasonCount({ from: start, to: end, endReason: 'flow-complete', flowPath })
        ) +
        this.timedDbQuery(
          'getConversationEndedByReasonCount:end-conversation-daily',
          () => getConversationEndedByReasonCount({ from: start, to: end, endReason: 'end-conversation', flowPath })
        );

      const weekStart = start - (6 * 24 * 60 * 60 * 1000);
      const weeklyStarted = this.timedDbQuery(
        'listConversationSessionStarts:weekly',
        () => listConversationSessionStarts({ from: weekStart, to: end, flowPath })
      );
      const weeklyAbandoned = this.timedDbQuery(
        'listConversationSessionEndsByReason:weekly-timeout',
        () => listConversationSessionEndsByReason({
          from: weekStart,
          to: end,
          endReason: 'timeout',
          flowPath,
        })
      );

      return {
        ...baseStats,
        totalSessions,
        conversationsTotal: totalStats.conversationsStarted,
        abandonmentRateTotal: totalStats.abandonmentRate,
        averageDurationTotalMs: totalStats.averageDurationMs,
        completionRateTotal,
        completedSessions,
        medianDurationMs: baseStats.averageDurationMs,
        hourlyVolume,
        funnel: buildConversationFunnel({
          started: baseStats.conversationsStarted,
          abandoned: baseStats.abandonedSessions,
          completed: completedSessions,
        }),
        topContacts: topUsers,
        weeklyTrend: buildWeeklyTrend({
          now: new Date(),
          days: 7,
          startedTimestamps: weeklyStarted,
          abandonedTimestamps: weeklyAbandoned,
        }),
      };
    }

    const info = runtimeInfo;
    return {
      totalExecutions: totalCommands || 0,
      avgLatencyMs: 245,
      successRate: 0.982,
      peakPerHour: Math.max(...hourlyVolume),
      commands: topCommands,
      hourlyVolume,
      topUsers,
      apiHealth: info.apis && info.apis.length > 0
        ? info.apis.map(api => ({
            name: api.name,
            avgLatencyMs: api.avgLatencyMs ?? 0,
            uptime: api.uptime ?? 1.0,
            status: api.status || 'unknown',
          }))
        : [{ name: 'Bot Backend', avgLatencyMs: 0, uptime: 1.0, status: 'healthy' }],
      recentErrors,
    };
  }

  getCachedStatsSnapshot({ runtimeInfo, mode, force = false }) {
    const { start } = getTodayBounds(new Date());
    const cacheKey = buildStatsCacheKey({
      mode,
      flowPaths: resolveFlowPathsForMode(runtimeInfo, mode),
      dayStart: start,
    });
    const nowTs = Date.now();
    if (!force) {
      const cached = readFreshCacheEntry(this.statsSnapshotCache.get(cacheKey), nowTs);
      if (cached) return cached;
    }

    const snapshot = this.buildStatsSnapshot({ runtimeInfo, mode });
    this.statsSnapshotCache.set(cacheKey, {
      value: snapshot,
      expiresAt: nowTs + STATS_CACHE_TTL_MS,
    });
    if (this.statsSnapshotCache.size > 24) {
      const keys = [...this.statsSnapshotCache.keys()];
      for (let i = 0; i < keys.length - 24; i++) {
        this.statsSnapshotCache.delete(keys[i]);
      }
    }
    return snapshot;
  }

  getWsClientState(client) {
    const existing = this.wsClientState.get(client);
    if (existing) return existing;
    const state = defaultWsClientState();
    this.wsClientState.set(client, state);
    return state;
  }

  updateWsSubscription(client, payload = {}) {
    const state = this.getWsClientState(client);
    state.mode = normalizeWsMode(payload?.mode, state.mode || 'all');
    state.flowPaths = new Set(toFlowPathArray(payload?.flowPaths));
    state.channels = normalizeWsChannels(payload?.channels);
    state.lastEventId = Math.max(0, Number(payload?.lastEventId) || 0);
    return {
      mode: state.mode,
      flowPaths: [...state.flowPaths],
      channels: [...state.channels],
      lastEventId: state.lastEventId,
    };
  }

  shouldDeliverWsPayload(clientState, payload = {}) {
    const channel = inferEventChannel(payload);
    if (!clientState?.channels?.has('all') && !clientState?.channels?.has(channel)) {
      return false;
    }

    const payloadId = Number(payload?.id) || 0;
    if (payloadId > 0 && Number(clientState?.lastEventId) > 0 && payloadId <= clientState.lastEventId) {
      return false;
    }

    const flowPaths = clientState?.flowPaths instanceof Set ? clientState.flowPaths : new Set();
    if (flowPaths.size > 0) {
      const payloadFlowPath = normalizeFlowPath(payload?.flowPath);
      if (!payloadFlowPath || !flowPaths.has(payloadFlowPath)) {
        return false;
      }
    }

    return true;
  }

  flushWsClientBatch(client) {
    if (!client || client.readyState !== WebSocket.OPEN) return;
    const state = this.getWsClientState(client);
    if (state.batchTimer) {
      clearTimeout(state.batchTimer);
      state.batchTimer = null;
    }
    if (!Array.isArray(state.batch) || state.batch.length === 0) return;

    const payload = state.batch.splice(0, state.batch.length);
    try {
      const wire = JSON.stringify({ type: 'events', payload });
      client.send(wire);
      this.recordWsSend({
        bytes: Buffer.byteLength(wire, 'utf8'),
        events: payload.length,
        batched: true,
      });
    } catch {
      // ignore socket send failures
    }
  }

  queueWsPayload(client, payload = {}) {
    if (!client || client.readyState !== WebSocket.OPEN) return;
    const state = this.getWsClientState(client);
    state.batch.push(payload);
    if (state.batch.length >= WS_BATCH_MAX_EVENTS) {
      this.flushWsClientBatch(client);
      return;
    }
    if (state.batchTimer) return;
    state.batchTimer = setTimeout(() => {
      this.flushWsClientBatch(client);
    }, WS_BATCH_FLUSH_MS);
    if (typeof state.batchTimer?.unref === 'function') {
      state.batchTimer.unref();
    }
  }

  handleWsIncomingMessage(client, rawMessage) {
    if (!rawMessage) return;
    let parsed = null;
    try {
      parsed = JSON.parse(String(rawMessage));
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== 'object') return;

    const type = String(parsed?.type ?? '').trim().toLowerCase();
    if (type === 'subscribe') {
      const applied = this.updateWsSubscription(client, parsed?.payload || {});
      try {
        client.send(JSON.stringify({ type: 'subscribed', payload: applied }));
      } catch {
        // ignore
      }
      return;
    }

    if (type === 'unsubscribe') {
      const state = this.getWsClientState(client);
      state.mode = 'all';
      state.flowPaths = new Set();
      state.channels = new Set(['all']);
      state.lastEventId = 0;
      return;
    }

    if (type === 'ping') {
      try {
        client.send(JSON.stringify({ type: 'pong', now: Date.now() }));
      } catch {
        // ignore
      }
    }
  }

  consumeRouteQuota(req, routePath) {
    const cfg = ROUTE_RATE_LIMITS.get(routePath);
    if (!cfg) return { ok: true, retryAfterMs: 0 };

    const nowTs = Date.now();
    const windowMs = Math.max(100, Number(cfg.windowMs) || 1000);
    const max = Math.max(1, Number(cfg.max) || 1);
    const client = resolveClientAddress(req);
    const key = `${routePath}::${client}`;
    const state = this.routeRateState.get(key) ?? { windowStartAt: nowTs, count: 0 };

    if ((nowTs - Number(state.windowStartAt || 0)) >= windowMs) {
      state.windowStartAt = nowTs;
      state.count = 0;
    }

    if (state.count >= max) {
      const retryAfterMs = Math.max(100, windowMs - Math.max(0, nowTs - Number(state.windowStartAt || nowTs)));
      this.routeRateState.set(key, state);
      return { ok: false, retryAfterMs };
    }

    state.count += 1;
    this.routeRateState.set(key, state);

    if (this.routeRateState.size > 5000) {
      const entries = [...this.routeRateState.entries()];
      const cutoff = nowTs - (windowMs * 5);
      for (const [entryKey, entryState] of entries) {
        if ((Number(entryState?.windowStartAt) || 0) < cutoff) {
          this.routeRateState.delete(entryKey);
        }
      }
    }

    return { ok: true, retryAfterMs: 0 };
  }

  bumpWsMinuteCounter(deltaEvents = 1, timestamp = Date.now()) {
    const bucket = Math.floor((Number(timestamp) || Date.now()) / 60000);
    const counter = this.observability.ws.byMinute;
    counter.set(bucket, Math.max(0, Number(counter.get(bucket) || 0) + Math.max(0, Number(deltaEvents) || 0)));
    const minBucket = bucket - 120;
    for (const [key] of counter.entries()) {
      if (key < minBucket) {
        counter.delete(key);
      }
    }
  }

  recordHttpRoute(routePath, durationMs, { statusCode = 200 } = {}) {
    const safeRoutePath = String(routePath || '');
    const safeDuration = Math.max(0, Number(durationMs) || 0);
    const safeStatusCode = Number(statusCode) || 0;
    const telemetryLevel = normalizeTelemetryLevel(this.currentTelemetryLevel, 'operational');
    const httpStats = this.observability.http;
    httpStats.total += 1;
    if (safeStatusCode >= 500 || safeStatusCode === 0) {
      httpStats.errors += 1;
    }

    if (telemetryLevel === 'minimum') {
      return;
    }

    const routeStats = httpStats.byRoute.get(safeRoutePath) ?? {
      count: 0,
      errors: 0,
      totalMs: 0,
      maxMs: 0,
      samples: [],
      lastStatusCode: 0,
      lastAt: 0,
    };
    routeStats.count += 1;
    routeStats.totalMs += safeDuration;
    routeStats.maxMs = Math.max(routeStats.maxMs, safeDuration);
    routeStats.lastStatusCode = safeStatusCode;
    routeStats.lastAt = Date.now();
    if (safeStatusCode >= 500 || safeStatusCode === 0) {
      routeStats.errors += 1;
    }
    routeStats.samples.push(safeDuration);
    const sampleCap = TELEMETRY_SAMPLE_CAP_BY_LEVEL[telemetryLevel] ?? TELEMETRY_SAMPLE_CAP_BY_LEVEL.operational;
    while (routeStats.samples.length > sampleCap) {
      routeStats.samples.shift();
    }
    httpStats.byRoute.set(safeRoutePath, routeStats);
  }

  recordDbQuery(queryName, durationMs) {
    const safeQueryName = String(queryName || 'unknown');
    const safeDuration = Math.max(0, Number(durationMs) || 0);
    const telemetryLevel = normalizeTelemetryLevel(this.currentTelemetryLevel, 'operational');
    if (telemetryLevel === 'minimum') {
      return;
    }
    const dbStats = this.observability.db;
    const queryStats = dbStats.byQuery.get(safeQueryName) ?? {
      count: 0,
      totalMs: 0,
      maxMs: 0,
      samples: [],
      lastAt: 0,
    };
    queryStats.count += 1;
    queryStats.totalMs += safeDuration;
    queryStats.maxMs = Math.max(queryStats.maxMs, safeDuration);
    queryStats.lastAt = Date.now();
    queryStats.samples.push(safeDuration);
    const sampleCap = TELEMETRY_SAMPLE_CAP_BY_LEVEL[telemetryLevel] ?? TELEMETRY_SAMPLE_CAP_BY_LEVEL.operational;
    while (queryStats.samples.length > sampleCap) {
      queryStats.samples.shift();
    }
    dbStats.byQuery.set(safeQueryName, queryStats);
  }

  timedDbQuery(queryName, queryFn) {
    const startedAt = Date.now();
    const result = queryFn();
    this.recordDbQuery(queryName, Date.now() - startedAt);
    return result;
  }

  recordWsSend({ bytes = 0, events = 1, batched = false, immediate = false } = {}) {
    const wsStats = this.observability.ws;
    wsStats.eventsSent += Math.max(0, Number(events) || 0);
    wsStats.bytesSent += Math.max(0, Number(bytes) || 0);
    wsStats.lastSentAt = Date.now();
    if (batched) {
      wsStats.batchesSent += 1;
      wsStats.batchedEventsSent += Math.max(0, Number(events) || 0);
    }
    if (immediate) {
      wsStats.immediateEventsSent += Math.max(0, Number(events) || 0);
    }
    this.bumpWsMinuteCounter(events, wsStats.lastSentAt);
  }

  buildObservabilitySnapshot() {
    const runtimeInfo = this.getRuntimeInfo();
    const telemetryLevel = normalizeTelemetryLevel(runtimeInfo?.dashboard?.telemetryLevel, this.currentTelemetryLevel);
    this.currentTelemetryLevel = telemetryLevel;
    const nowTs = Date.now();
    const wsStats = this.observability.ws;
    const httpStats = this.observability.http;
    const dbStats = this.observability.db;
    const connectedClients = this.wss?.clients?.size ?? 0;
    wsStats.peakConnectedClients = Math.max(wsStats.peakConnectedClients, connectedClients);
    const tableLimit = TELEMETRY_TABLE_LIMIT_BY_LEVEL[telemetryLevel] ?? TELEMETRY_TABLE_LIMIT_BY_LEVEL.operational;

    const httpRoutes = [...httpStats.byRoute.entries()]
      .map(([route, stats]) => ({
        route,
        count: Number(stats.count) || 0,
        errors: Number(stats.errors) || 0,
        avgMs: safeAverage(stats.totalMs, stats.count),
        p95Ms: toPercentile(stats.samples, 0.95),
        maxMs: Number(stats.maxMs) || 0,
        lastStatusCode: Number(stats.lastStatusCode) || 0,
        lastAt: Number(stats.lastAt) || 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, tableLimit);

    const dbQueries = [...dbStats.byQuery.entries()]
      .map(([query, stats]) => ({
        query,
        count: Number(stats.count) || 0,
        avgMs: safeAverage(stats.totalMs, stats.count),
        p95Ms: toPercentile(stats.samples, 0.95),
        maxMs: Number(stats.maxMs) || 0,
        lastAt: Number(stats.lastAt) || 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, tableLimit);

    const nowBucket = Math.floor(nowTs / 60000);
    const wsEventsPerMinute = Number(wsStats.byMinute.get(nowBucket) || 0);
    const wsEventsPerMinuteSeries = telemetryLevel === 'verbose'
      ? [...wsStats.byMinute.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([bucket, events]) => ({
          minuteTs: bucket * 60000,
          events: Number(events) || 0,
        }))
      : [];
    const processCpu = process.cpuUsage(this.observability.processCpuStartedAt);
    const processMem = process.memoryUsage();
    const ingestion = runtimeInfo?.ingestion && typeof runtimeInfo.ingestion === 'object'
      ? runtimeInfo.ingestion
      : {};
    const engine = ingestion?.engine && typeof ingestion.engine === 'object'
      ? ingestion.engine
      : {};
    const callback = ingestion?.callback && typeof ingestion.callback === 'object'
      ? ingestion.callback
      : {};
    const queues = ingestion?.ingestionQueue && typeof ingestion.ingestionQueue === 'object'
      ? ingestion.ingestionQueue
      : {};
    const dispatchScheduler = ingestion?.dispatchScheduler && typeof ingestion.dispatchScheduler === 'object'
      ? ingestion.dispatchScheduler
      : {};
    const whatsapp = runtimeInfo?.whatsapp && typeof runtimeInfo.whatsapp === 'object'
      ? runtimeInfo.whatsapp
      : {};
    const whatsappEventVolume = whatsapp?.eventVolumePerMinute && typeof whatsapp.eventVolumePerMinute === 'object'
      ? whatsapp.eventVolumePerMinute
      : {};
    const whatsappCallback = whatsapp?.callback && typeof whatsapp.callback === 'object'
      ? whatsapp.callback
      : {};
    const reconnectController = whatsapp?.reconnectController && typeof whatsapp.reconnectController === 'object'
      ? whatsapp.reconnectController
      : {};
    const handlerErrors = Array.isArray(engine?.handlers)
      ? engine.handlers.map(item => ({
        handlerType: String(item?.type || 'unknown'),
        failed: Number(item?.failed || 0),
        count: Number(item?.count || 0),
      }))
      : [];
    const handlerErrorSummary = handlerErrors.reduce(
      (acc, current) => ({
        totalFailed: acc.totalFailed + (Number(current.failed) || 0),
        totalProcessed: acc.totalProcessed + (Number(current.count) || 0),
      }),
      { totalFailed: 0, totalProcessed: 0 }
    );
    const sqliteQueryAvgMs = dbQueries.length > 0
      ? safeAverage(
        dbQueries.reduce((acc, item) => acc + (Number(item.avgMs) || 0), 0),
        dbQueries.length
      )
      : 0;

    return {
      now: nowTs,
      uptimeMs: nowTs - this.startupTime,
      telemetryLevel,
      process: {
        pid: process.pid,
        memory: processMem,
        cpuUsageMicros: processCpu,
        loadAverage: os.loadavg(),
        cpuCount: os.cpus().length,
      },
      http: {
        totalRequests: Number(httpStats.total) || 0,
        totalErrors: Number(httpStats.errors) || 0,
        routes: telemetryLevel === 'minimum' ? [] : httpRoutes,
      },
      sqlite: {
        queries: telemetryLevel === 'minimum' ? [] : dbQueries,
      },
      websocket: {
        connectedClients,
        peakConnectedClients: Number(wsStats.peakConnectedClients) || 0,
        connectionsOpened: Number(wsStats.connectionsOpened) || 0,
        connectionsClosed: Number(wsStats.connectionsClosed) || 0,
        eventsSent: Number(wsStats.eventsSent) || 0,
        immediateEventsSent: Number(wsStats.immediateEventsSent) || 0,
        batchedEventsSent: Number(wsStats.batchedEventsSent) || 0,
        batchesSent: Number(wsStats.batchesSent) || 0,
        bytesSent: Number(wsStats.bytesSent) || 0,
        eventsPerMinute: wsEventsPerMinute,
        eventsPerMinuteSeries: wsEventsPerMinuteSeries,
        lastSentAt: Number(wsStats.lastSentAt) || 0,
      },
      runtime: {
        messageLatencyAvgMs: Number(callback?.totalAvgMs || engine?.handleIncomingAvgMs || 0) || 0,
        messageLatencyP95Ms: Number(whatsappCallback?.p95Ms || 0) || 0,
        sqliteQueryAvgMs,
        backlog: {
          ingestionQueue: Number(queues?.queued || 0) || 0,
          dispatchQueue: Number(dispatchScheduler?.queued || 0) || 0,
        },
        sessionsActive: Number(runtimeInfo?.ingestion?.engine?.activeSessions ?? runtimeInfo?.whatsapp?.authState?.storage?.totalRows ?? 0) || 0,
        errorsByHandler: telemetryLevel === 'minimum' ? [] : handlerErrors.slice(0, tableLimit),
        errorsByHandlerSummary: handlerErrorSummary,
        socketReconnectRatePerDay: Number(whatsapp?.reconnectsScheduledLast24h || 0) || 0,
        broadcastThroughputPerMinute: Number(whatsappEventVolume?.outgoingBroadcast || 0) || 0,
        reconnectPending: Boolean(reconnectController?.pending),
      },
      dashboard: {
        isolationMode: String(runtimeInfo?.dashboard?.isolationMode || 'inline'),
      },
    };
  }

  async start() {
    if (this.server) return;

    this.server = createDashboardHttpServer({
      server: this,
      publicDir: PUBLIC_DIR,
      handoffMediaDir: HANDOFF_MEDIA_DIR,
      staticMimeTypes: STATIC_MIME_TYPES,
      helpers: {
        sendJson,
        sendText,
        readJsonBody,
        normalizeFlowBlocks,
        normalizeFlowPath,
        normalizeModeParam,
        resolveFlowPathsForMode,
        toInt,
        normalizeActor,
        listModeEvents,
        parseDataUrlImage,
        saveHandoffMedia,
        decodePathComponent,
        isPathInsideRoot,
        resolveBlockIndex,
        tryServePublicAsset,
      },
      context: {
        __dirname,
      },
    });

    setupDashboardWebsocketServer(this, this.server);

    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, this.host, () => {
        this.server.off('error', reject);
        resolve();
      });
    });
  }

  broadcast(payload) {
    broadcastDashboardPayload(this, payload);
  }

  async stop() {
    stopDashboardWebsocketServer(this);

    if (!this.server) return;

    await new Promise(resolve => {
      this.server.close(() => resolve());
    });
    this.server = null;
  }

  getUrl() {
    return `http://${this.host}:${this.port}`;
  }
}
