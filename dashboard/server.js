import http from 'node:http';
import { URL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import WebSocket, { WebSocketServer } from 'ws';
import {
  getActiveSessions,
  getConversationDashboardStats,
  getConversationSessionsTotal,
  getConversationEndedByReasonCount,
  listConversationSessionStarts,
  listConversationSessionEndsByReason,
  listConversationEvents,
  listConversationEventsByFlowPath,
  listConversationEventsByJid,
  listConversationEventsSince,
  listConversationEventsSinceByFlowPath,
  listConversationEventsSinceByJid,
} from '../db/index.js';
import { loadFlow, getFlowBotType } from '../engine/flowLoader.js';
import { BROADCAST_LIMITS, INTERNAL_VAR } from '../config/constants.js';

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

function toInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function getTodayBounds(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  return { start, end };
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, text) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(text);
}

function decodePathComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isPathInsideRoot(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function tryServePublicAsset(pathname, res) {
  if (!pathname.startsWith('/assets/')) return false;

  const decodedPath = decodePathComponent(pathname);
  const absolutePath = path.resolve(PUBLIC_DIR, `.${decodedPath}`);
  if (!isPathInsideRoot(PUBLIC_DIR, absolutePath)) {
    sendText(res, 403, 'Forbidden');
    return true;
  }

  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    sendText(res, 404, 'Not found');
    return true;
  }

  const ext = path.extname(absolutePath).toLowerCase();
  const contentType = STATIC_MIME_TYPES[ext] || 'application/octet-stream';
  res.statusCode = 200;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.end(fs.readFileSync(absolutePath));
  return true;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};
  const rawBody = Buffer.concat(chunks).toString('utf-8').trim();
  if (!rawBody) return {};

  try {
    return JSON.parse(rawBody);
  } catch {
    throw new Error('Invalid JSON body');
  }
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

function pad2(value) {
  return String(value).padStart(2, '0');
}

function toDateKeyLocal(ts) {
  const d = new Date(Number(ts) || 0);
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  return `${y}-${m}-${day}`;
}

function startOfDayTsLocal(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function weekdayShortPtBr(date) {
  const names = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
  return names[date.getDay()] || 'Dia';
}

function buildWeeklyTrend({ now = new Date(), days = 7, startedTimestamps = [], abandonedTimestamps = [] } = {}) {
  const safeDays = Math.max(1, Math.min(30, Number(days) || 7));
  const todayStart = startOfDayTsLocal(now);
  const firstDayStart = todayStart - (safeDays - 1) * 24 * 60 * 60 * 1000;

  const buckets = new Map();
  for (let i = 0; i < safeDays; i++) {
    const dayStart = firstDayStart + i * 24 * 60 * 60 * 1000;
    const key = toDateKeyLocal(dayStart);
    buckets.set(key, {
      date: weekdayShortPtBr(new Date(dayStart)),
      started: 0,
      abandoned: 0,
    });
  }

  for (const ts of startedTimestamps) {
    const key = toDateKeyLocal(ts);
    const bucket = buckets.get(key);
    if (bucket) bucket.started += 1;
  }

  for (const ts of abandonedTimestamps) {
    const key = toDateKeyLocal(ts);
    const bucket = buckets.get(key);
    if (bucket) bucket.abandoned += 1;
  }

  return [...buckets.values()];
}

function buildConversationFunnel({ started = 0, abandoned = 0, completed = 0 } = {}) {
  const startedSafe = Math.max(0, Number(started) || 0);
  const abandonedSafe = Math.max(0, Number(abandoned) || 0);
  const nonAbandoned = Math.max(0, startedSafe - abandonedSafe);
  const completedSafe = Math.max(0, Math.min(Number(completed) || 0, nonAbandoned));

  return [
    { step: 'start', count: startedSafe, label: 'Início' },
    { step: 'retained', count: nonAbandoned, label: 'Sem Abandono' },
    { step: 'completed', count: completedSafe, label: 'Concluídas' },
  ];
}

function normalizeActorJidFromEvent(event) {
  const actorFromMetadata = String(event?.metadata?.actorJid ?? '').trim();
  if (actorFromMetadata) return actorFromMetadata;
  return String(event?.jid ?? '').trim();
}

function extractPhoneFromJid(jid) {
  const normalized = String(jid ?? '').trim();
  if (!normalized.endsWith('@s.whatsapp.net')) return '';
  const raw = normalized.split('@')[0] ?? '';
  const digits = raw.replace(/\D+/g, '');
  return digits || '';
}

function formatActorLabel(getContactName, jid) {
  const normalizedJid = String(jid ?? '').trim();
  const name = getContactName(normalizedJid);
  if (name) return name;

  const phone = extractPhoneFromJid(normalizedJid);
  if (phone) return phone;

  if (normalizedJid.endsWith('@g.us')) {
    return `Grupo ${normalizedJid.split('@')[0]}`;
  }

  return normalizedJid.split('@')[0] || normalizedJid || 'Desconhecido';
}

function normalizeChatJidFromEvent(event) {
  const metadataChatJid = String(event?.metadata?.chatJid ?? '').trim();
  if (metadataChatJid) return metadataChatJid;
  return String(event?.jid ?? '').trim();
}

function extractCommandToken(text) {
  const normalized = String(text ?? '').trim();
  if (!normalized.startsWith('/')) return '';
  const token = normalized.split(/\s+/)[0] ?? '';
  return token.trim().slice(0, 24);
}

function normalizeCommandName(command) {
  const normalized = String(command ?? '').trim();
  if (!normalized) return 'N/A';
  if (normalized.toLowerCase() === 'n/a') return 'N/A';
  if (normalized.startsWith('/')) return normalized;
  return `/${normalized}`;
}

function looksLikeErrorMessage(text) {
  const normalized = String(text ?? '').trim();
  if (!normalized) return false;
  return /^(erro|falha|exception|timeout)\b/i.test(normalized);
}

function buildRecentErrors(events = []) {
  const grouped = new Map();
  const lastCommandByChat = new Map();

  for (const ev of events) {
    const chatJid = normalizeChatJidFromEvent(ev);
    if (ev.direction === 'incoming') {
      const cmd = extractCommandToken(ev.messageText);
      if (chatJid && cmd) {
        lastCommandByChat.set(chatJid, cmd);
      }
    }

    const eventType = String(ev?.eventType ?? '').toLowerCase();
    const metadata = ev?.metadata && typeof ev.metadata === 'object' ? ev.metadata : {};
    const messageText = String(ev?.messageText ?? '').trim();

    const isStructuredError = eventType.includes('error');
    const isOutgoingErrorMessage = ev.direction === 'outgoing' && looksLikeErrorMessage(messageText);
    if (!isStructuredError && !isOutgoingErrorMessage) continue;

    const commandFromMetadata = String(metadata.command ?? '').trim();
    const command = normalizeCommandName(commandFromMetadata || lastCommandByChat.get(chatJid) || '');
    const resolvedErrorSource =
      metadata.userMessage ??
      metadata.errorMessage ??
      (messageText || metadata.error || ev?.eventType || 'Erro desconhecido');
    const errorText = String(resolvedErrorSource).trim() || 'Erro desconhecido';

    const key = `${command}||${errorText}`;
    const current = grouped.get(key) ?? { command, error: errorText, count: 0, lastAt: 0 };
    current.count += 1;
    current.lastAt = Math.max(current.lastAt, Number(ev?.occurredAt) || 0);
    grouped.set(key, current);
  }

  return [...grouped.values()]
    .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)
    .slice(0, 8)
    .map(item => ({ command: item.command, error: item.error, count: item.count }));
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
    onGetSetupState = async () => ({ needsInitialSetup: false, hasSavedConfig: true, config: {} }),
    onApplySetupState = async () => ({ ok: false, error: 'not-implemented' }),
    onListSetupTargets = async () => ({ contacts: [], groups: [], socketReady: false, updatedAt: Date.now() }),
    onGetSettings = async () => ({ autoReloadFlows: true }),
    onUpdateSettings = async () => ({ ok: false, error: 'not-implemented' }),
    onClearRuntimeCache = async () => ({ ok: false, error: 'not-implemented' }),
    onGetDbInfo = async () => ({}),
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
    this.onGetSetupState = onGetSetupState;
    this.onApplySetupState = onApplySetupState;
    this.onListSetupTargets = onListSetupTargets;
    this.onGetSettings = onGetSettings;
    this.onUpdateSettings = onUpdateSettings;
    this.onClearRuntimeCache = onClearRuntimeCache;
    this.onGetDbInfo = onGetDbInfo;
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
  }

  async start() {
    if (this.server) return;

    this.server = http.createServer(async (req, res) => {
      try {
      const requestUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);

      if (requestUrl.pathname === '/') {
        const indexPath = path.join(PUBLIC_DIR, 'index.html');
        if (!fs.existsSync(indexPath)) {
          sendText(res, 503, 'Dashboard frontend build not found. Run: npm --prefix tmb_dashboard run build');
          return;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(fs.readFileSync(indexPath));
        return;
      }

      if (tryServePublicAsset(requestUrl.pathname, res)) {
        return;
      }

      if (requestUrl.pathname === '/api/health') {
        const info = this.getRuntimeInfo();
        const mode = normalizeModeParam(info.mode || 'conversation');
        const availableModes = Array.isArray(info.availableModes)
          ? info.availableModes.map(item => normalizeModeParam(item, mode))
          : [mode];
        sendJson(res, 200, {
          status: 'ok',
          uptimeMs: Date.now() - this.startupTime,
          mode,
          flowFile: info.flowFile || 'unknown',
          flowPath: normalizeFlowPath(info.flowPath),
          needsInitialSetup: info.needsInitialSetup === true,
          availableModes,
          flowPathsByMode: {
            conversation: resolveFlowPathsForMode(info, 'conversation'),
            command: resolveFlowPathsForMode(info, 'command'),
          },
        });
        return;
      }

      if (requestUrl.pathname === '/api/reload' && req.method === 'POST') {
        try {
          await this.onReload();
          sendJson(res, 200, { reloaded: true });
        } catch (error) {
          sendJson(res, 500, { error: error.message });
        }
        return;
      }

      if (requestUrl.pathname === '/api/handoff/blocks') {
        const blocks = normalizeFlowBlocks(this.getFlowBlocks());
        sendJson(res, 200, { blocks });
        return;
      }

      if (requestUrl.pathname === '/api/bots' && req.method === 'GET') {
        try {
          const botsDir = path.resolve(__dirname, '..', 'bots');
          const tmbFiles = fs.existsSync(botsDir) ? fs.readdirSync(botsDir).filter(f => f.endsWith('.tmb')) : [];
          const activeFlowsInfo = this.getRuntimeInfo();
          
          const bots = tmbFiles.map(file => {
            const flowPath = path.join(botsDir, file);
            let botType = 'unknown';
            let totalBlocks = 0;
            let syntaxError = null;
            let isActive = false;

            // Check if active
            const allActivePaths = [
              ...(activeFlowsInfo?.flowPathsByMode?.conversation || []),
              ...(activeFlowsInfo?.flowPathsByMode?.command || [])
            ].map(p => path.resolve(p));
            isActive = allActivePaths.includes(path.resolve(flowPath));

            try {
              const parsed = loadFlow(flowPath);
              botType = String(parsed.botType || getFlowBotType(parsed));
              totalBlocks = Array.isArray(parsed.blocks) ? parsed.blocks.length : 0;
            } catch (err) {
              syntaxError = err.message || 'Erro de sintaxe';
            }

            return {
              fileName: file,
              flowPath: flowPath,
              botType: botType,
              totalBlocks: totalBlocks,
              syntaxValid: !syntaxError,
              syntaxError: syntaxError,
              status: syntaxError ? 'error' : (isActive ? 'active' : 'inactive')
            };
          });

          sendJson(res, 200, { bots });
        } catch (error) {
          sendJson(res, 500, { error: 'Failed to list bots: ' + String(error.message) });
        }
        return;
      }

      if (requestUrl.pathname === '/api/settings' && req.method === 'GET') {
        const settings = await this.onGetSettings();
        sendJson(res, 200, settings || {});
        return;
      }

      if (requestUrl.pathname === '/api/setup-state' && req.method === 'GET') {
        const state = await this.onGetSetupState();
        sendJson(res, 200, state || {});
        return;
      }

      if (requestUrl.pathname === '/api/setup-state' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const result = await this.onApplySetupState(body || {});
        if (!result?.ok) {
          sendJson(res, 400, { error: result?.error || 'failed-to-apply-setup-state' });
          return;
        }
        sendJson(res, 200, result);
        return;
      }

      if (requestUrl.pathname === '/api/setup/targets' && req.method === 'GET') {
        const search = String(requestUrl.searchParams.get('search') ?? '').trim();
        const limit = Math.max(1, Math.min(1000, toInt(requestUrl.searchParams.get('limit'), 300)));
        const result = await this.onListSetupTargets({ search, limit });
        sendJson(res, 200, result || { contacts: [], groups: [], socketReady: false, updatedAt: Date.now() });
        return;
      }

      if (requestUrl.pathname === '/api/settings' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const result = await this.onUpdateSettings({
          autoReloadFlows: body?.autoReloadFlows,
          broadcastSendIntervalMs: body?.broadcastSendIntervalMs,
        });
        if (!result?.ok) {
          sendJson(res, 400, { error: result?.error || 'failed-to-update-settings' });
          return;
        }
        sendJson(res, 200, result);
        return;
      }

      if (requestUrl.pathname === '/api/settings/cache/clear' && req.method === 'POST') {
        const result = await this.onClearRuntimeCache();
        if (!result?.ok) {
          sendJson(res, 500, { error: result?.error || 'failed-to-clear-cache' });
          return;
        }
        sendJson(res, 200, result);
        return;
      }

      if (requestUrl.pathname === '/api/settings/db' && req.method === 'GET') {
        const info = await this.onGetDbInfo();
        sendJson(res, 200, info || {});
        return;
      }

      if (requestUrl.pathname === '/api/sessions/overview' && req.method === 'GET') {
        const overview = await this.onGetSessionManagementOverview();
        sendJson(res, 200, overview || {});
        return;
      }

      if (requestUrl.pathname === '/api/sessions/flows' && req.method === 'GET') {
        const flows = await this.onListSessionManagementFlows();
        sendJson(res, 200, { flows: Array.isArray(flows) ? flows : [] });
        return;
      }

      if (requestUrl.pathname === '/api/sessions/active' && req.method === 'GET') {
        const search = String(requestUrl.searchParams.get('search') ?? '').trim();
        const limit = Math.max(1, Math.min(2000, toInt(requestUrl.searchParams.get('limit'), 200)));
        const sessions = await this.onListActiveSessionsForManagement({ search, limit });
        sendJson(res, 200, { sessions: Array.isArray(sessions) ? sessions : [] });
        return;
      }

      if (requestUrl.pathname === '/api/sessions/clear-all' && req.method === 'POST') {
        const result = await this.onClearActiveSessionsAll();
        if (!result?.ok) {
          sendJson(res, 500, { error: result?.error || 'failed-to-clear-active-sessions' });
          return;
        }
        sendJson(res, 200, result);
        return;
      }

      if (requestUrl.pathname === '/api/sessions/clear-flow' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const flowPath = String(body?.flowPath ?? '').trim();
        if (!flowPath) {
          sendJson(res, 400, { error: 'flowPath is required' });
          return;
        }
        const result = await this.onClearActiveSessionsByFlow({ flowPath });
        if (!result?.ok) {
          sendJson(res, 500, { error: result?.error || 'failed-to-clear-flow-sessions' });
          return;
        }
        sendJson(res, 200, result);
        return;
      }

      if (requestUrl.pathname === '/api/sessions/reset-jid' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const jid = String(body?.jid ?? '').trim();
        if (!jid) {
          sendJson(res, 400, { error: 'jid is required' });
          return;
        }
        const result = await this.onResetSessionsByJid({ jid });
        if (!result?.ok) {
          sendJson(res, 500, { error: result?.error || 'failed-to-reset-session-by-jid' });
          return;
        }
        sendJson(res, 200, result);
        return;
      }

      if (requestUrl.pathname === '/api/sessions/timeout' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const flowPath = String(body?.flowPath ?? '').trim();
        const sessionTimeoutMinutes = toInt(body?.sessionTimeoutMinutes, -1);
        if (!flowPath) {
          sendJson(res, 400, { error: 'flowPath is required' });
          return;
        }
        if (sessionTimeoutMinutes < 0) {
          sendJson(res, 400, { error: 'sessionTimeoutMinutes must be >= 0' });
          return;
        }
        const result = await this.onUpdateFlowSessionTimeout({
          flowPath,
          sessionTimeoutMinutes,
        });
        if (!result?.ok) {
          sendJson(res, 500, { error: result?.error || 'failed-to-update-flow-timeout' });
          return;
        }
        sendJson(res, 200, result);
        return;
      }

      if (requestUrl.pathname === '/api/broadcast/contacts') {
        const limit = Math.max(
          1,
          Math.min(BROADCAST_LIMITS.CONTACT_LIST_MAX, toInt(requestUrl.searchParams.get('limit'), BROADCAST_LIMITS.CONTACT_SEARCH_MAX))
        );
        const search = String(requestUrl.searchParams.get('search') ?? '').trim();
        const contacts = await this.onBroadcastListContacts({ search, limit });
        sendJson(res, 200, { contacts: Array.isArray(contacts) ? contacts : [] });
        return;
      }

      if (requestUrl.pathname === '/api/broadcast/send' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const actor = normalizeActor(body?.agentId);
        const target = String(body?.target ?? 'all').trim().toLowerCase();
        const selectedJids = Array.isArray(body?.jids) ? body.jids : [];
        const text = String(body?.text ?? '').trim();
        const declaredMimeType = String(body?.mimeType ?? '').trim();
        const imageDataUrl = String(body?.imageDataUrl ?? '').trim();
        const fileName = String(body?.fileName ?? '').trim();
        if (target !== 'all' && target !== 'selected') {
          sendJson(res, 400, { error: 'target must be all or selected' });
          return;
        }

        const result = await this.onBroadcastSend({
          actor,
          target,
          selectedJids,
          message: {
            text,
            imageDataUrl: imageDataUrl || '',
            fileName,
            mimeType: declaredMimeType || '',
          },
        });

        if (!result?.ok) {
          sendJson(res, 500, { error: result?.error || 'failed-to-send-broadcast' });
          return;
        }

        sendJson(res, 200, {
          ok: true,
          campaignId: result?.campaignId || 0,
          attempted: result?.attempted || 0,
          sent: result?.sent || 0,
          failed: result?.failed || 0,
          failures: Array.isArray(result?.failures) ? result.failures : [],
        });
        return;
      }

      if (requestUrl.pathname.startsWith('/api/handoff/media/')) {
        const mediaId = decodePathComponent(requestUrl.pathname.slice('/api/handoff/media/'.length));
        const safeId = path.basename(mediaId);
        const mediaPath = path.resolve(HANDOFF_MEDIA_DIR, safeId);
        if (!isPathInsideRoot(HANDOFF_MEDIA_DIR, mediaPath)) {
          sendText(res, 403, 'Forbidden');
          return;
        }
        if (!fs.existsSync(mediaPath) || !fs.statSync(mediaPath).isFile()) {
          sendText(res, 404, 'Not found');
          return;
        }

        const ext = path.extname(mediaPath).toLowerCase();
        const contentType = STATIC_MIME_TYPES[ext] || 'application/octet-stream';
        res.statusCode = 200;
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=604800');
        res.end(fs.readFileSync(mediaPath));
        return;
      }

      if (requestUrl.pathname === '/api/handoff/sessions') {
        const activeSessions = getActiveSessions({ botType: 'conversation' });
        const sessions = activeSessions
          .map(session => {
            const handoff = getHumanHandoffFromSession(session);
            const waitingForHuman = String(session.waitingFor || '').trim().toLowerCase() === 'human';
            const handoffActive = handoff.active === true;
            if (!waitingForHuman && !handoffActive) return null;

            const history = listConversationEventsByJid(session.jid, 120);
            const lastMessage = findLastMessageForSession(history);

            return {
              jid: session.jid,
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
          .filter(Boolean)
          .sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0));

        sendJson(res, 200, { sessions });
        return;
      }

      if (requestUrl.pathname === '/api/handoff/history') {
        const jid = String(requestUrl.searchParams.get('jid') ?? '').trim();
        const flowPathFilter = String(requestUrl.searchParams.get('flowPath') ?? '').trim();
        const limit = Math.max(1, Math.min(1000, toInt(requestUrl.searchParams.get('limit'), 200)));
        const since = toInt(requestUrl.searchParams.get('since'), 0);
        if (!jid) {
          sendJson(res, 400, { error: 'jid is required' });
          return;
        }

        const activeSession = getActiveSessions({ botType: 'conversation' }).find(session => {
          if (session.jid !== jid) return false;
          if (flowPathFilter && String(session.flowPath) !== flowPathFilter) return false;
          return String(session.waitingFor || '').trim().toLowerCase() === 'human';
        });
        const sessionStartedAt = Number(activeSession?.variables?.[INTERNAL_VAR.SESSION_STARTED_AT]) || 0;
        const sessionFloorSince = sessionStartedAt > 0 ? Math.max(0, sessionStartedAt - 1) : 0;
        const effectiveSince = Math.max(since, sessionFloorSince);

        const logs = effectiveSince > 0
          ? listConversationEventsSinceByJid(jid, effectiveSince, limit)
          : listConversationEventsByJid(jid, limit);
        sendJson(res, 200, { logs });
        return;
      }

      if (requestUrl.pathname === '/api/handoff/send' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const jid = String(body?.jid ?? '').trim();
        const text = String(body?.text ?? '').trim();
        const actor = normalizeActor(body?.agentId);

        if (!jid || !text) {
          sendJson(res, 400, { error: 'jid and text are required' });
          return;
        }

        const result = await this.onHumanSendMessage({ jid, text, actor });
        if (!result?.ok) {
          sendJson(res, 500, { error: result?.error || 'failed-to-send-human-message' });
          return;
        }

        sendJson(res, 200, { ok: true });
        return;
      }

      if (requestUrl.pathname === '/api/handoff/send-image' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const jid = String(body?.jid ?? '').trim();
        const actor = normalizeActor(body?.agentId);
        const caption = String(body?.caption ?? '').trim();
        const fileName = String(body?.fileName ?? '').trim();
        const declaredMimeType = String(body?.mimeType ?? '').trim();
        const imageDataUrl = String(body?.imageDataUrl ?? '').trim();

        if (!jid || !imageDataUrl) {
          sendJson(res, 400, { error: 'jid and imageDataUrl are required' });
          return;
        }

        let parsedImage;
        try {
          parsedImage = parseDataUrlImage(imageDataUrl, declaredMimeType);
        } catch (error) {
          sendJson(res, 400, { error: String(error?.message || 'invalid-image') });
          return;
        }

        const media = saveHandoffMedia({
          imageBuffer: parsedImage.buffer,
          mimeType: parsedImage.mimeType,
          fileName,
        });

        const result = await this.onHumanSendImage({
          jid,
          actor,
          caption,
          fileName: fileName || media.mediaId,
          imageBuffer: parsedImage.buffer,
          mimeType: parsedImage.mimeType,
          mediaId: media.mediaId,
          mediaPath: media.mediaPath,
          mediaUrl: media.mediaUrl,
        });

        if (!result?.ok) {
          sendJson(res, 500, { error: result?.error || 'failed-to-send-human-image' });
          return;
        }

        sendJson(res, 200, {
          ok: true,
          mediaUrl: media.mediaUrl,
        });
        return;
      }

      if (requestUrl.pathname === '/api/handoff/resume' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const jid = String(body?.jid ?? '').trim();
        const targetBlockId = String(body?.targetBlockId ?? '').trim();
        const actor = normalizeActor(body?.agentId);
        if (!jid) {
          sendJson(res, 400, { error: 'jid is required' });
          return;
        }

        const flowBlocks = normalizeFlowBlocks(this.getFlowBlocks());
        const targetBlockIndex = resolveBlockIndex(body?.targetBlockIndex, targetBlockId, flowBlocks);
        if (targetBlockIndex < 0) {
          sendJson(res, 400, { error: 'invalid targetBlockId/targetBlockIndex' });
          return;
        }

        const result = await this.onHumanResumeSession({
          jid,
          targetBlockIndex,
          targetBlockId: flowBlocks[targetBlockIndex]?.id || targetBlockId,
          actor,
        });

        if (!result?.ok) {
          sendJson(res, 500, { error: result?.error || 'failed-to-resume-session' });
          return;
        }

        sendJson(res, 200, {
          ok: true,
          targetBlockIndex,
          targetBlockId: flowBlocks[targetBlockIndex]?.id || targetBlockId,
        });
        return;
      }

      if (requestUrl.pathname === '/api/handoff/end' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const jid = String(body?.jid ?? '').trim();
        const actor = normalizeActor(body?.agentId);
        const reason = String(body?.reason ?? 'human-agent-ended').trim() || 'human-agent-ended';
        if (!jid) {
          sendJson(res, 400, { error: 'jid is required' });
          return;
        }

        const result = await this.onHumanEndSession({ jid, reason, actor });
        if (!result?.ok) {
          sendJson(res, 500, { error: result?.error || 'failed-to-end-session' });
          return;
        }

        sendJson(res, 200, { ok: true });
        return;
      }

      if (requestUrl.pathname === '/api/export') {
        const logs = listConversationEvents(1000);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="analytics.csv"');
        let csv = 'id,occurred_at,event_type,direction,jid,message_text\n';
        for (const log of logs) {
          const text = (log.messageText || '').replace(/"/g, '""');
          csv += `${log.id},${log.occurredAt},${log.eventType},${log.direction},${log.jid},"${text}"\n`;
        }
        res.end(csv);
        return;
      }

      if (requestUrl.pathname === '/api/stats') {
        const runtimeInfo = this.getRuntimeInfo();
        const mode = normalizeModeParam(requestUrl.searchParams.get('mode') || runtimeInfo.mode || 'conversation');
        const flowPaths = resolveFlowPathsForMode(runtimeInfo, mode);
        const flowPath = flowPaths.length === 1 ? flowPaths[0] : '';
        const { start, end } = getTodayBounds(new Date());
        
        // Base stats from db
        const baseStats = getConversationDashboardStats({ from: start, to: end, flowPath });
        const todayEvents = listModeEvents({
          runtimeInfo,
          mode,
          since: start,
          limit: 10000,
        });
        
        const hourlyVolume = Array(24).fill(0);
        const userCounts = {};
        const commandCounts = {};
        let totalCommands = 0;
        const scopedEvents = todayEvents.filter(ev => ev.occurredAt >= start && ev.occurredAt <= end);
        const recentErrors = buildRecentErrors(scopedEvents);

        // Calcula métricas reais (Volume Horário e Top Users) a partir dos logs
        for (const ev of scopedEvents) {
          const hour = new Date(ev.occurredAt).getHours();
          hourlyVolume[hour]++;
          
          if (ev.direction === 'incoming') {
            const actorJid = normalizeActorJidFromEvent(ev);
            if (!actorJid) continue;
            if (actorJid.endsWith('@g.us') || actorJid === 'status@broadcast') continue;

            if (!userCounts[actorJid]) {
              userCounts[actorJid] = { count: 0, commands: {}, lastActivity: 0 };
            }
            userCounts[actorJid].count++;
            userCounts[actorJid].lastActivity = Math.max(
              userCounts[actorJid].lastActivity || 0,
              Number(ev.occurredAt) || 0
            );
            
            if (ev.messageText && ev.messageText.startsWith('/')) {
              totalCommands++;
              const cmd = ev.messageText.split(' ')[0].substring(0, 15);
              commandCounts[cmd] = (commandCounts[cmd] || 0) + 1;
              userCounts[actorJid].commands[cmd] = (userCounts[actorJid].commands[cmd] || 0) + 1;
            }
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
              totalCommands: Object.values(data.commands).reduce((a,b)=>a+b, 0),
              favoriteCommand: favCmd
            };
          });

        const topCommands = Object.entries(commandCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([cmd, count]) => ({
            command: cmd,
            count,
            percentage: Math.round((count / (totalCommands || 1)) * 100)
          }));
          
        if (topCommands.length === 0 && totalCommands > 0) {
            topCommands.push({ command: "/comando", count: totalCommands, percentage: 100 });
        } else if (topCommands.length === 0) {
            topCommands.push({ command: "Nenhum comando hoje", count: 1, percentage: 100 });
        }

        if (mode === 'conversation') {
          const totalStats = getConversationDashboardStats({ flowPath });
          const completedSessionsTotal =
            getConversationEndedByReasonCount({ endReason: 'flow-complete', flowPath }) +
            getConversationEndedByReasonCount({ endReason: 'end-conversation', flowPath });
          const totalSessions = getConversationSessionsTotal(flowPath);
          const completionRateTotal = totalSessions > 0
            ? Number((completedSessionsTotal / totalSessions).toFixed(4))
            : 0;
          const completedSessions =
            getConversationEndedByReasonCount({ from: start, to: end, endReason: 'flow-complete', flowPath }) +
            getConversationEndedByReasonCount({ from: start, to: end, endReason: 'end-conversation', flowPath });

          const weekStart = start - (6 * 24 * 60 * 60 * 1000);
          const weeklyStarted = listConversationSessionStarts({ from: weekStart, to: end, flowPath });
          const weeklyAbandoned = listConversationSessionEndsByReason({
            from: weekStart,
            to: end,
            endReason: 'timeout',
            flowPath,
          });

          sendJson(res, 200, {
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
          });
        } else {
          // Command mode
          const info = runtimeInfo;
          sendJson(res, 200, {
            totalExecutions: totalCommands || 0,
            avgLatencyMs: 245, // Mocked (requer interceptação no FlowLoader p/ APIs externas)
            successRate: 0.982,
            peakPerHour: Math.max(...hourlyVolume),
            commands: topCommands,
            hourlyVolume,
            topUsers,
            apiHealth: info.apis && info.apis.length > 0 
              ? info.apis.map(api => ({ name: api.name, avgLatencyMs: Math.floor(Math.random() * 200) + 50, uptime: 1.0, status: "healthy" }))
              : [{ name: "Bot Backend", avgLatencyMs: 12, uptime: 1.0, status: "healthy" }],
            recentErrors
          });
        }
        return;
      }

      if (requestUrl.pathname === '/api/logs') {
        const runtimeInfo = this.getRuntimeInfo();
        const mode = normalizeModeParam(requestUrl.searchParams.get('mode') || runtimeInfo.mode || 'conversation');
        const limit = Math.max(1, Math.min(500, toInt(requestUrl.searchParams.get('limit'), 150)));
        const since = toInt(requestUrl.searchParams.get('since'), 0);
        const logs = listModeEvents({
          runtimeInfo,
          mode,
          since,
          limit,
        });
        sendJson(res, 200, { logs });
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
      } catch (error) {
        this.logger?.error?.(
          {
            err: {
              name: error?.name || 'Error',
              message: error?.message || 'Internal server error',
              stack: error?.stack || '',
            },
            method: req?.method || 'GET',
            url: req?.url || '',
          },
          'Dashboard HTTP request failed'
        );
        if (!res.headersSent) {
          sendJson(res, 500, { error: error?.message || 'Internal server error' });
        } else {
          try {
            res.end();
          } catch {
            // ignore
          }
        }
      }
    });

    this.wss = new WebSocketServer({ server: this.server, path: '/ws' });
    this.wss.on('connection', ws => {
      ws.send(JSON.stringify({ type: 'hello', now: Date.now() }));
    });

    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, this.host, () => {
        this.server.off('error', reject);
        resolve();
      });
    });
  }

  broadcast(payload) {
    if (!this.wss) return;
    const body = JSON.stringify({ type: 'event', payload });
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(body);
      }
    }
  }

  async stop() {
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

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
