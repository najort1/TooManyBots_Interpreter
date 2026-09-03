import { createEventBatchExtractor } from './eventBatchExtractor.js';
import { buildReminderSchedule } from './eventTime.js';

const RECENT_MESSAGE_ID_LIMIT = 240;

function text(value) {
  return String(value ?? '').trim();
}

function normalizeIdentity(value) {
  return text(value)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function mergeItems(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const value of Array.isArray(list) ? list : []) {
      const item = text(value);
      const key = item.toLocaleLowerCase('pt-BR');
      if (!item || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out.slice(0, 20);
}

function mergeEvent(current, next) {
  return {
    title: next.title || current.title,
    eventType: next.eventType || current.eventType,
    startsAt: next.startsAt || current.startsAt,
    timezone: next.timezone || current.timezone,
    location: next.location || current.location,
    items: mergeItems(current.items, next.items),
    organizerJid: next.organizerJid || current.organizerJid,
    organizerName: next.organizerName || current.organizerName,
    fingerprint: next.fingerprint || current.fingerprint,
    extraction: { ...(current.extraction || {}), ...(next.extraction || {}) },
  };
}

function isSameEventIdentity(current, next) {
  if (next.fingerprint && current.fingerprint === next.fingerprint) return true;
  return Boolean(
    normalizeIdentity(current.title) &&
    normalizeIdentity(current.title) === normalizeIdentity(next.title) &&
    normalizeIdentity(current.eventType) === normalizeIdentity(next.eventType)
  );
}

export function createEventAggregationService({
  eventRepository,
  eventBatchExtractor,
  getLogger = () => null,
} = {}) {
  if (!eventRepository) throw new Error('[eventAggregationService] eventRepository required');

  const logger = getLogger();
  const extractor = eventBatchExtractor || createEventBatchExtractor({ getLogger });
  const buffers = new Map();

  function opts(funConfig = {}) {
    return {
      batchSize: Math.max(40, Math.min(40, Number(funConfig.groupEventBatchSize) || 40)),
      contextMessages: Math.max(0, Math.min(20, Number(funConfig.groupEventBatchContextMessages) || 10)),
    };
  }

  function bufferFor(scopeKey) {
    const scope = text(scopeKey);
    if (!buffers.has(scope)) {
      buffers.set(scope, {
        messages: [],
        contextTail: [],
        recentMessageIds: new Set(),
        flushing: false,
        lastFlushAt: 0,
      });
    }
    return buffers.get(scope);
  }

  function rememberMessageId(buffer, messageId) {
    if (!messageId || buffer.recentMessageIds.has(messageId)) return false;
    buffer.recentMessageIds.add(messageId);
    while (buffer.recentMessageIds.size > RECENT_MESSAGE_ID_LIMIT) {
      buffer.recentMessageIds.delete(buffer.recentMessageIds.values().next().value);
    }
    return true;
  }

  function sourceMessages(batch, operation, contextCount) {
    return operation.messageIndices
      .filter((index) => index >= contextCount)
      .map((index) => batch[index])
      .filter(Boolean);
  }

  function resolveTarget(scopeKey, operation, now, funConfig) {
    if (operation.targetEventId) {
      const target = eventRepository.getById(operation.targetEventId);
      if (
        target &&
        target.scopeKey === scopeKey &&
        target.status === 'active' &&
        target.authorJid === operation.authorJid
      ) {
        return { target, reason: '' };
      }
      return { target: null, reason: 'invalid-target' };
    }

    const candidates = eventRepository
      .findCandidates({
        scopeKey,
        authorJid: operation.authorJid,
        startsAt: operation.event.startsAt,
        fingerprint: operation.event.fingerprint,
        now,
        windowMs: funConfig.groupEventFragmentWindowMs,
      })
      .filter((candidate) => isSameEventIdentity(candidate, operation.event));

    if (candidates.length === 1) return { target: candidates[0], reason: '' };
    return { target: null, reason: candidates.length > 1 ? 'ambiguous-target' : 'no-target' };
  }

  function applyOperation({ scopeKey, batch, contextCount, operation, now, funConfig }) {
    const references = sourceMessages(batch, operation, contextCount);
    if (!references.length) return { ok: false, reason: 'no-new-evidence' };
    if (references.some((message) => eventRepository.getByAnySourceMessage({ scopeKey, messageId: message.messageId }))) {
      return { ok: true, skipped: true, reason: 'duplicate-message' };
    }

    const sourceMessageIds = references.map((message) => message.messageId);
    const schedule = buildReminderSchedule(funConfig);

    if (operation.action === 'create') {
      const primary = references[0];
      return eventRepository.upsertEvent({
        event: {
          ...operation.event,
          scopeKey,
          authorJid: operation.authorJid,
          sourceMessageId: primary.messageId,
        },
        sourceMessageIds,
        reminderSchedule: schedule,
        now,
      });
    }

    const resolved = resolveTarget(scopeKey, operation, now, funConfig);
    if (!resolved.target) return { ok: false, reason: resolved.reason };

    if (operation.action === 'cancel') {
      return eventRepository.updateEvent(
        resolved.target.id,
        { status: 'cancelled' },
        { sourceMessageIds, reminderSchedule: schedule, now }
      );
    }

    if (operation.action === 'update') {
      return eventRepository.updateEvent(
        resolved.target.id,
        mergeEvent(resolved.target, operation.event),
        { sourceMessageIds, reminderSchedule: schedule, now }
      );
    }

    return { ok: false, reason: 'unsupported-action' };
  }

  function reconcileBatch({ scopeKey, batch, contextCount, operations, now, funConfig }) {
    const sorted = [...operations].sort((left, right) => {
      const byMessage = left.messageIndices[0] - right.messageIndices[0];
      if (byMessage) return byMessage;
      return left.action.localeCompare(right.action);
    });
    const applied = [];
    const skipped = [];

    for (const operation of sorted) {
      const result = applyOperation({ scopeKey, batch, contextCount, operation, now, funConfig });
      if (result.ok && !result.skipped) applied.push({ action: operation.action, eventId: result.event?.id || '' });
      else skipped.push({ action: operation.action, reason: result.reason || 'skipped' });
    }

    return { applied, skipped };
  }

  async function flushScope(scopeKey, funConfig = {}, now = Date.now()) {
    const scope = text(scopeKey);
    const buffer = bufferFor(scope);
    const o = opts(funConfig);
    if (funConfig.groupEventsEnabled === false) return { ok: false, reason: 'disabled' };
    if (buffer.flushing) return { ok: false, reason: 'busy' };
    if (buffer.messages.length < o.batchSize) return { ok: false, reason: 'too-few' };

    buffer.flushing = true;
    const snapshot = buffer.messages.splice(0, o.batchSize);
    const context = buffer.contextTail.slice(-o.contextMessages);
    const batch = [...context, ...snapshot];
    const contextCount = context.length;
    const timestamp = Number(now) || Date.now();

    try {
      eventRepository.markPastEvents(timestamp);
      const activeEvents = eventRepository.listByScope(scope, { includePast: false, limit: 100 });
      const extracted = await extractor.extractBatch({
        batch,
        contextCount,
        activeEvents,
        funConfig,
        now: timestamp,
      });
      if (!extracted?.ok) {
        buffer.messages.unshift(...snapshot);
        return { ok: false, reason: extracted?.reason || 'extract-failed', requeued: snapshot.length };
      }

      const reconciled = reconcileBatch({
        scopeKey: scope,
        batch,
        contextCount,
        operations: extracted.operations || [],
        now: timestamp,
        funConfig,
      });
      buffer.contextTail = snapshot.slice(-o.contextMessages);
      buffer.lastFlushAt = timestamp;
      return {
        ok: true,
        batchSize: snapshot.length,
        contextCount,
        operationCount: (extracted.operations || []).length,
        ...reconciled,
      };
    } catch (error) {
      buffer.messages.unshift(...snapshot);
      logger?.warn?.('[eventAggregation] lote reencadeado: %s', String(error?.message || error));
      return { ok: false, reason: 'llm-error', requeued: snapshot.length };
    } finally {
      buffer.flushing = false;
    }
  }

  async function drainScope(scopeKey, funConfig = {}, now = Date.now()) {
    const results = [];
    while (bufferFor(scopeKey).messages.length >= opts(funConfig).batchSize) {
      const result = await flushScope(scopeKey, funConfig, now);
      results.push(result);
      if (!result.ok) break;
    }
    return results;
  }

  function scheduleDrain(scopeKey, funConfig, now) {
    void drainScope(scopeKey, funConfig, now).catch((error) => {
      logger?.warn?.('[eventAggregation] drenagem falhou: %s', String(error?.message || error));
    });
  }

  async function observeMessage({
    scopeKey,
    userJid,
    text: messageText,
    messageId,
    quotedText = '',
    mentionedJids = [],
    getContactDisplayName = null,
    msgTimeMs = Date.now(),
    funConfig = {},
    isGroup = false,
  } = {}) {
    const scope = text(scopeKey);
    const author = text(userJid);
    const content = text(messageText);
    const sourceId = text(messageId);
    const occurredAt = Number(msgTimeMs) || Date.now();
    if (funConfig.groupEventsEnabled === false) return { ok: false, reason: 'disabled' };
    if (!isGroup || !scope.endsWith('@g.us')) return { ok: false, reason: 'not-group' };
    if (!author || !sourceId || !content) return { ok: false, reason: 'invalid-message' };
    if (String(funConfig.prefix || '/') && content.startsWith(String(funConfig.prefix || '/'))) {
      return { ok: false, reason: 'command' };
    }
    if (eventRepository.getByAnySourceMessage({ scopeKey: scope, messageId: sourceId })) {
      return { ok: true, duplicate: true, reason: 'duplicate-message' };
    }

    const buffer = bufferFor(scope);
    if (!rememberMessageId(buffer, sourceId)) return { ok: true, duplicate: true, reason: 'duplicate-buffered-message' };
    buffer.messages.push({
      messageId: sourceId,
      userJid: author,
      name: text(typeof getContactDisplayName === 'function' ? getContactDisplayName(author) : '', author),
      text: content,
      quotedText: text(quotedText),
      mentionedJids: Array.isArray(mentionedJids) ? mentionedJids.slice(0, 12) : [],
      at: occurredAt,
    });

    const flushScheduled = !buffer.flushing && buffer.messages.length >= opts(funConfig).batchSize;
    if (flushScheduled) scheduleDrain(scope, funConfig, occurredAt);
    return { ok: true, buffered: true, flushScheduled, bufferedCount: buffer.messages.length };
  }

  async function flushDueScopes(funConfig = {}, now = Date.now()) {
    const results = [];
    for (const [scopeKey, buffer] of buffers.entries()) {
      if (buffer.flushing || buffer.messages.length < opts(funConfig).batchSize) continue;
      const drained = await drainScope(scopeKey, funConfig, now);
      results.push(...drained.map((result) => ({ scopeKey, kind: 'group-event-batch', ...result })));
    }
    return { ok: true, flushed: results.filter((result) => result.ok).length, results };
  }

  return {
    observeMessage,
    flushScope,
    flushDueScopes,
    _buffers: buffers,
    _mergeEvent: mergeEvent,
    _reconcileBatch: reconcileBatch,
  };
}
