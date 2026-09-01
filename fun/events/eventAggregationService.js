import { buildReminderSchedule } from './eventTime.js';
import { createEventExtractorService } from './eventExtractorService.js';

function text(value) {
  return String(value ?? '').trim();
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

export function createEventAggregationService({ eventRepository, eventExtractorService, getLogger = () => null } = {}) {
  if (!eventRepository) throw new Error('[eventAggregationService] eventRepository required');
  if (!eventExtractorService) throw new Error('[eventAggregationService] eventExtractorService required');

  const logger = getLogger();
  const buffers = new Map();

  function keyOf(scopeKey, userJid) {
    return `${text(scopeKey)}::${text(userJid)}`;
  }

  function readBuffer(scopeKey, userJid, now, funConfig) {
    const key = keyOf(scopeKey, userJid);
    const buffer = buffers.get(key);
    if (!buffer) return [];
    const windowMs = Number(funConfig.groupEventFragmentWindowMs) || 30 * 60_000;
    const cutoff = Number(now) - windowMs;
    const fresh = buffer.filter((entry) => entry.at >= cutoff);
    if (fresh.length) buffers.set(key, fresh);
    else buffers.delete(key);
    return fresh;
  }

  function appendBuffer(entry, funConfig) {
    const key = keyOf(entry.scopeKey, entry.userJid);
    const max = Math.max(2, Math.min(12, Number(funConfig.groupEventFragmentMaxMessages) || 4));
    const current = readBuffer(entry.scopeKey, entry.userJid, entry.msgTimeMs, funConfig);
    const next = [...current, entry].slice(-max);
    buffers.set(key, next);
    return next;
  }

  function clearBuffer(scopeKey, userJid) {
    buffers.delete(keyOf(scopeKey, userJid));
  }

  async function observeMessage({
    scopeKey,
    userJid,
    text: messageText,
    messageId,
    quotedText = '',
    mentionedJids = [],
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

    const previous = readBuffer(scope, author, occurredAt, funConfig);
    const fragments = [...previous, {
      scopeKey: scope,
      userJid: author,
      text: content,
      messageId: sourceId,
      at: occurredAt,
    }];
    const fragmentText = previous.map((entry) => entry.text).join('\n');

    // Se há candidato ativo recente do mesmo autor, vale tentar o LLM mesmo
    // sem palavras-chave explícitas (ex: "agora é 21h" atualizando um evento).
    const initialCandidates = eventRepository.findCandidates({
      scopeKey: scope,
      authorJid: author,
      startsAt: 0,
      fingerprint: '',
      now: occurredAt,
      windowMs: funConfig.groupEventFragmentWindowMs,
    });
    const bypassSignalCheck = initialCandidates.length > 0;

    const extraction = await eventExtractorService.extractAnnouncement({
      text: content,
      quotedText,
      mentionedJids,
      msgTimeMs: occurredAt,
      funConfig,
      fragmentText,
      bypassSignalCheck,
    });

    if (!extraction.ok) {
      appendBuffer(fragments[fragments.length - 1], funConfig);
      return extraction;
    }

    const schedule = buildReminderSchedule(funConfig);
    const allSourceIds = fragments.map((entry) => entry.messageId);
    const event = {
      ...extraction.event,
      scopeKey: scope,
      authorJid: author,
      sourceMessageId: previous[0]?.messageId || sourceId,
    };

    const candidates = eventRepository.findCandidates({
      scopeKey: scope,
      authorJid: author,
      startsAt: event.startsAt,
      fingerprint: event.fingerprint,
      now: occurredAt,
      windowMs: funConfig.groupEventFragmentWindowMs,
    });
    const target = candidates.length === 1 ? candidates[0] : null;

    if (extraction.action === 'cancel') {
      if (!target) {
        appendBuffer(fragments[fragments.length - 1], funConfig);
        return { ok: false, reason: candidates.length > 1 ? 'ambiguous-cancel' : 'no-cancel-target' };
      }
      clearBuffer(scope, author);
      return eventRepository.updateEvent(target.id, { status: 'cancelled' }, {
        sourceMessageIds: allSourceIds,
        reminderSchedule: schedule,
        now: occurredAt,
      });
    }

    if ((extraction.action === 'update' || target) && target) {
      clearBuffer(scope, author);
      const patch = mergeEvent(target, event);
      return eventRepository.updateEvent(target.id, patch, {
        sourceMessageIds: allSourceIds,
        reminderSchedule: schedule,
        now: occurredAt,
      });
    }

    if (extraction.action === 'update' && !target) {
      appendBuffer(fragments[fragments.length - 1], funConfig);
      return { ok: false, reason: 'no-update-target' };
    }

    clearBuffer(scope, author);
    return eventRepository.upsertEvent({
      event,
      sourceMessageIds: allSourceIds,
      reminderSchedule: schedule,
      now: occurredAt,
    });
  }

  return {
    observeMessage,
    _buffers: buffers,
    _mergeEvent: mergeEvent,
  };
}
