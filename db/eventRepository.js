/**
 * db/eventRepository.js
 *
 * Conversation event ingestion and query operations.
 * Extracted from db/index.js to reduce monolithic responsibilities.
 */

import { mapConversationEventRow, normalizeMetadata } from './helpers.js';

export function createEventRepository({
  getDb,
  getStmts,
  getDbRuntimeState,
  getEventBuffer,
  getConversationEventListeners,
  flushConversationEventBuffer,
  ensureEventBufferFlushedForRead,
  getDynamicStatement,
  analyticsSchema,
}) {
  function normalizeConversationEventInput({
    occurredAt = Date.now(),
    eventType = 'message',
    direction = 'system',
    jid = 'unknown',
    flowPath = '',
    messageText = '',
    metadata = {},
  } = {}) {
    const safeMessage = messageText == null ? '' : String(messageText);
    return {
      occurredAt: Number(occurredAt) || Date.now(),
      eventType: String(eventType || 'message'),
      direction: String(direction || 'system'),
      jid: String(jid || 'unknown'),
      flowPath: String(flowPath || ''),
      messageText: safeMessage,
      metadata: normalizeMetadata(metadata),
    };
  }

  function addConversationEvent({
    occurredAt = Date.now(),
    eventType = 'message',
    direction = 'system',
    jid = 'unknown',
    flowPath = '',
    messageText = '',
    metadata = {},
  } = {}) {
    const db = getDb();
    const stmts = getStmts();
    if (!db || !stmts.insertConversationEvent) return;

    const event = normalizeConversationEventInput({
      occurredAt,
      eventType,
      direction,
      jid,
      flowPath,
      messageText,
      metadata,
    });

    const dbRuntimeState = getDbRuntimeState();
    if (dbRuntimeState.config.eventBatchingEnabled) {
      const eventBuffer = getEventBuffer();
      eventBuffer.push(event);
      const maxBatchSize = Math.max(1, Number(dbRuntimeState.config.eventBatchSize) || 1);
      if (eventBuffer.length >= maxBatchSize) {
        flushConversationEventBuffer({ reason: 'batch-size-threshold' });
      }
    } else {
      stmts.insertConversationEvent.run(
        event.occurredAt,
        event.eventType,
        event.direction,
        event.jid,
        event.flowPath,
        event.messageText,
        JSON.stringify(event.metadata || {})
      );
    }

    for (const listener of getConversationEventListeners()) {
      try {
        listener(event);
      } catch {
        // ignore listener errors
      }
    }
  }

  function listConversationEvents(limit = 200) {
    const stmts = getStmts();
    ensureEventBufferFlushedForRead();
    const normalizedLimit = Math.max(1, Math.min(1000, Number(limit) || 200));
    const rows = stmts.listConversationEvents.all(normalizedLimit);
    return rows.map(mapConversationEventRow);
  }

  function listConversationEventsByFlowPath(flowPath, limit = 200) {
    const stmts = getStmts();
    ensureEventBufferFlushedForRead();
    const normalizedFlowPath = String(flowPath ?? '').trim();
    if (!normalizedFlowPath) return [];
    const normalizedLimit = Math.max(1, Math.min(1000, Number(limit) || 200));
    const rows = stmts.listConversationEventsByFlowPath.all(normalizedFlowPath, normalizedLimit);
    return rows.map(mapConversationEventRow);
  }

  function listConversationEventsByJid(jid, limit = 200) {
    const stmts = getStmts();
    ensureEventBufferFlushedForRead();
    const normalizedJid = String(jid ?? '').trim();
    if (!normalizedJid) return [];
    const normalizedLimit = Math.max(1, Math.min(1000, Number(limit) || 200));
    const rows = stmts.listConversationEventsByJid.all(normalizedJid, normalizedLimit);
    return rows.map(mapConversationEventRow);
  }

  function listConversationEventsByJids(jids = [], limitPerJid = 120) {
    ensureEventBufferFlushedForRead();
    const normalizedLimitPerJid = Math.max(1, Math.min(200, Number(limitPerJid) || 120));
    const normalizedJids = [...new Set(
      (Array.isArray(jids) ? jids : [])
        .map(item => String(item ?? '').trim())
        .filter(Boolean)
    )];
    if (normalizedJids.length === 0) return {};

    const byJid = new Map();
    const chunkSize = 250;
    for (let offset = 0; offset < normalizedJids.length; offset += chunkSize) {
      const chunk = normalizedJids.slice(offset, offset + chunkSize);
      if (chunk.length === 0) continue;

      const placeholders = chunk.map(() => '?').join(', ');
      const sql = `
        SELECT id, occurred_at, event_type, direction, jid, flow_path, message_text, metadata
        FROM (
          SELECT
            id,
            occurred_at,
            event_type,
            direction,
            jid,
            flow_path,
            message_text,
            metadata,
            ROW_NUMBER() OVER (
              PARTITION BY jid
              ORDER BY occurred_at DESC, id DESC
            ) AS rn
          FROM ${analyticsSchema}.conversation_events
          WHERE jid IN (${placeholders})
        ) ranked
        WHERE rn <= ?
        ORDER BY jid ASC, occurred_at DESC, id DESC
      `;
      const rows = getDynamicStatement(sql).all(...chunk, normalizedLimitPerJid);
      for (const row of rows) {
        const jid = String(row?.jid ?? '').trim();
        if (!jid) continue;
        const current = byJid.get(jid) ?? [];
        current.push(mapConversationEventRow(row));
        byJid.set(jid, current);
      }
    }

    return Object.fromEntries(byJid.entries());
  }

  function listConversationEventsSince(sinceTimestamp, limit = 500) {
    const stmts = getStmts();
    ensureEventBufferFlushedForRead();
    const normalizedLimit = Math.max(1, Math.min(2000, Number(limit) || 500));
    const since = Number(sinceTimestamp) || 0;
    const rows = stmts.listConversationEventsSince.all(since, normalizedLimit);
    return rows.map(mapConversationEventRow);
  }

  function listConversationEventsSinceByFlowPath(flowPath, sinceTimestamp, limit = 500) {
    const stmts = getStmts();
    ensureEventBufferFlushedForRead();
    const normalizedFlowPath = String(flowPath ?? '').trim();
    if (!normalizedFlowPath) return [];
    const normalizedLimit = Math.max(1, Math.min(2000, Number(limit) || 500));
    const since = Number(sinceTimestamp) || 0;
    const rows = stmts.listConversationEventsSinceByFlowPath.all(normalizedFlowPath, since, normalizedLimit);
    return rows.map(mapConversationEventRow);
  }

  function listConversationEventsSinceByJid(jid, sinceTimestamp, limit = 500) {
    const stmts = getStmts();
    ensureEventBufferFlushedForRead();
    const normalizedJid = String(jid ?? '').trim();
    if (!normalizedJid) return [];
    const normalizedLimit = Math.max(1, Math.min(2000, Number(limit) || 500));
    const since = Number(sinceTimestamp) || 0;
    const rows = stmts.listConversationEventsSinceByJid.all(normalizedJid, since, normalizedLimit);
    return rows.map(mapConversationEventRow);
  }

  function onConversationEvent(listener) {
    const listeners = getConversationEventListeners();
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  return {
    addConversationEvent,
    listConversationEvents,
    listConversationEventsByFlowPath,
    listConversationEventsByJid,
    listConversationEventsByJids,
    listConversationEventsSince,
    listConversationEventsSinceByFlowPath,
    listConversationEventsSinceByJid,
    onConversationEvent,
  };
}
