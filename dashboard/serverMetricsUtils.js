export const DASHBOARD_TELEMETRY_LEVELS = new Set([
  'minimum',
  'operational',
  'diagnostic',
  'verbose',
]);

export const WS_IMMEDIATE_EVENT_TYPES = new Set([
  'engine-error',
  'flow-error',
  'message-outgoing-error',
  'human-handoff-requested',
  'human-handoff-resolved',
  'human-handoff-ended',
]);

export const CONVERSATION_COMPLETED_END_REASONS = Object.freeze([
  'flow-complete',
  'end-conversation',
  'satisfaction-completed',
  'satisfaction-timeout',
]);

export function pad2(value) {
  return String(value).padStart(2, '0');
}

export function toDateKeyLocal(ts) {
  const date = new Date(Number(ts) || Date.now());
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function startOfDayTsLocal(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function weekdayShortPtBr(date) {
  return date.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
}

export function buildWeeklyTrend({ now = new Date(), days = 7, startedTimestamps = [], abandonedTimestamps = [] } = {}) {
  const totalDays = Math.max(1, Math.min(14, Number(days) || 7));
  const baseline = startOfDayTsLocal(now);
  const buckets = new Map();

  for (let offset = totalDays - 1; offset >= 0; offset -= 1) {
    const dayTs = baseline - (offset * 24 * 60 * 60 * 1000);
    const key = toDateKeyLocal(dayTs);
    buckets.set(key, { dayTs, started: 0, abandoned: 0 });
  }

  for (const ts of startedTimestamps) {
    const key = toDateKeyLocal(ts);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.started += 1;
  }

  for (const ts of abandonedTimestamps) {
    const key = toDateKeyLocal(ts);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.abandoned += 1;
  }

  return [...buckets.values()]
    .sort((a, b) => a.dayTs - b.dayTs)
    .map(item => ({
      day: weekdayShortPtBr(new Date(item.dayTs)),
      date: weekdayShortPtBr(new Date(item.dayTs)),
      started: item.started,
      abandoned: item.abandoned,
      abandonmentRate: item.started > 0 ? Number((item.abandoned / item.started).toFixed(4)) : 0,
    }));
}

export function buildConversationFunnel({ started = 0, abandoned = 0, completed = 0 } = {}) {
  const safeStarted = Math.max(0, Number(started) || 0);
  const safeAbandoned = Math.max(0, Number(abandoned) || 0);
  const safeCompleted = Math.max(0, Number(completed) || 0);
  const safeActive = Math.max(0, safeStarted - safeCompleted - safeAbandoned);
  return [
    { step: 'started', label: 'Iniciadas', count: safeStarted },
    { step: 'active', label: 'Ativas', count: safeActive },
    { step: 'completed', label: 'Concluidas', count: safeCompleted },
    { step: 'abandoned', label: 'Abandonadas', count: safeAbandoned },
  ];
}

export function isConversationCompletedEndReason(endReason = '') {
  const normalized = String(endReason || '').trim().toLowerCase();
  return CONVERSATION_COMPLETED_END_REASONS.includes(normalized);
}

export function normalizeActorJidFromEvent(event) {
  const actorJid = String(event?.metadata?.actorJid || event?.jid || '').trim();
  if (!actorJid) return '';
  if (actorJid.startsWith('parallel-') || actorJid.startsWith('keycheck-')) return '';
  return actorJid;
}

export function extractPhoneFromJid(jid) {
  const value = String(jid || '').trim();
  if (!value) return '';
  const local = value.split('@')[0] || '';
  if (!local) return '';
  return local.replace(/[^0-9]/g, '');
}

export function formatActorLabel(getContactName, jid) {
  const cleanJid = String(jid || '').trim();
  if (!cleanJid) return 'Desconhecido';
  const contactName = String(getContactName?.(cleanJid) || '').trim();
  const phone = extractPhoneFromJid(cleanJid);

  if (contactName && phone && contactName !== phone) {
    return `${contactName} (${phone})`;
  }
  if (contactName) return contactName;
  if (phone) return phone;
  return cleanJid;
}

export function normalizeChatJidFromEvent(event) {
  const metadataChat = String(event?.metadata?.chatJid || '').trim();
  if (metadataChat) return metadataChat;
  return String(event?.jid || '').trim();
}

export function extractCommandToken(text) {
  const value = String(text || '').trim();
  if (!value.startsWith('/')) return '';
  const token = value.split(/\s+/)[0] || '';
  return token.slice(0, 40);
}

export function normalizeCommandName(command) {
  const value = String(command || '').trim();
  if (!value) return '';
  return value.startsWith('/') ? value : `/${value}`;
}

export function looksLikeErrorMessage(text) {
  const normalized = String(text || '').trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized.includes('erro') ||
    normalized.includes('error') ||
    normalized.includes('falha') ||
    normalized.includes('exception') ||
    normalized.includes('timeout')
  );
}

export function buildRecentErrors(events = []) {
  const result = [];
  const seen = new Set();

  for (let idx = events.length - 1; idx >= 0; idx -= 1) {
    const event = events[idx];
    const eventType = String(event?.eventType || '').trim();
    const messageText = String(event?.messageText || '').trim();
    if (!eventType) continue;

    const explicitErrorType = eventType === 'engine-error' || eventType === 'flow-error' || eventType === 'message-outgoing-error';
    const inferredError = eventType === 'message-outgoing' && looksLikeErrorMessage(messageText);
    if (!explicitErrorType && !inferredError) continue;

    const occurredAt = Number(event?.occurredAt) || 0;
    const key = `${eventType}::${messageText}::${occurredAt}`;
    if (seen.has(key)) continue;
    seen.add(key);

    result.push({
      eventType,
      occurredAt,
      message: messageText || 'Erro sem mensagem',
      jid: String(normalizeChatJidFromEvent(event) || '').trim(),
    });

    if (result.length >= 20) break;
  }

  return result;
}

export function buildStatsCacheKey({ mode, flowPaths = [], dayStart = 0 }) {
  const safeMode = String(mode || 'conversation').trim().toLowerCase() || 'conversation';
  const safeDayStart = Number(dayStart) || 0;
  const normalizedPaths = [...new Set((Array.isArray(flowPaths) ? flowPaths : []).map(item => String(item || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  return `${safeMode}::${safeDayStart}::${normalizedPaths.join('|')}`;
}

export function readFreshCacheEntry(entry, nowTs = Date.now()) {
  if (!entry || typeof entry !== 'object') return null;
  const expiresAt = Number(entry.expiresAt) || 0;
  if (expiresAt <= nowTs) return null;
  return entry.value ?? null;
}

export function resolveClientAddress(req) {
  const header = String(req?.headers?.['x-forwarded-for'] || '').trim();
  if (header) {
    const first = header.split(',')[0]?.trim();
    if (first) return first;
  }
  const socketAddress = String(req?.socket?.remoteAddress || '').trim();
  if (socketAddress) return socketAddress;
  return 'unknown-client';
}

export function safeAverage(total, count) {
  const safeCount = Math.max(0, Number(count) || 0);
  if (safeCount <= 0) return 0;
  return Number((Number(total || 0) / safeCount).toFixed(2));
}

export function toPercentile(samples = [], percentile = 0.95) {
  if (!Array.isArray(samples) || samples.length === 0) return 0;
  const sorted = [...samples].map(item => Number(item) || 0).sort((a, b) => a - b);
  const safePercentile = Math.max(0, Math.min(1, Number(percentile) || 0));
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * safePercentile)));
  return Number(sorted[idx] || 0);
}

export function normalizeTelemetryLevel(value, fallback = 'operational') {
  const normalized = String(value || '').trim().toLowerCase();
  if (DASHBOARD_TELEMETRY_LEVELS.has(normalized)) return normalized;
  return DASHBOARD_TELEMETRY_LEVELS.has(String(fallback || '').trim().toLowerCase())
    ? String(fallback).trim().toLowerCase()
    : 'operational';
}

export function defaultWsClientState() {
  return {
    mode: 'all',
    flowPaths: new Set(),
    channels: new Set(['all']),
    lastEventId: 0,
    batch: [],
    batchTimer: null,
  };
}

export function normalizeWsMode(value, fallback = 'all') {
  const normalized = String(value || fallback || 'all').trim().toLowerCase();
  if (normalized === 'conversation' || normalized === 'command' || normalized === 'all') {
    return normalized;
  }
  return 'all';
}

export function normalizeWsChannels(input = []) {
  const source = Array.isArray(input) ? input : [input];
  const channels = new Set();
  for (const value of source) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) continue;
    if (normalized === 'all' || normalized === 'conversation' || normalized === 'command' || normalized === 'system') {
      channels.add(normalized);
    }
  }
  if (channels.size === 0) channels.add('all');
  return channels;
}

export function inferEventChannel(payload = {}) {
  const flowPath = String(payload?.flowPath || '').trim();
  if (!flowPath) return 'system';
  const eventType = String(payload?.eventType || '').trim().toLowerCase();
  if (eventType.startsWith('command-') || eventType === 'command-executed') {
    return 'command';
  }
  return 'conversation';
}

export function isWsImmediateEvent(payload = {}) {
  const eventType = String(payload?.eventType ?? '').trim().toLowerCase();
  return WS_IMMEDIATE_EVENT_TYPES.has(eventType);
}
