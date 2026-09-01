import { randomUUID } from 'node:crypto';
import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';

const ANALYTICS_SCHEMA = 'analytics';
const EVENT_STATUSES = new Set(['active', 'cancelled', 'past']);
const REMINDER_KINDS = new Set(['three_days', 'three_hours', 'custom']);
const REMINDER_STATUSES = new Set(['pending', 'sending', 'sent', 'skipped_cancelled']);

function toText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function toMs(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(String(value || ''));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function normalizeTextList(value, limit = 20) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const list = [];
  for (const item of value) {
    const text = toText(item);
    const key = text.toLocaleLowerCase('pt-BR');
    if (!text || seen.has(key)) continue;
    seen.add(key);
    list.push(text.slice(0, 240));
    if (list.length >= limit) break;
  }
  return list;
}

function mapEvent(row) {
  if (!row) return null;
  return {
    id: toText(row.id),
    scopeKey: toText(row.scope_key),
    authorJid: toText(row.author_jid),
    status: toText(row.status, 'active'),
    title: toText(row.title),
    eventType: toText(row.event_type, 'other'),
    startsAt: toMs(row.starts_at),
    timezone: toText(row.timezone, 'America/Sao_Paulo'),
    location: toText(row.location),
    items: normalizeTextList(parseJson(row.items_json, [])),
    organizerJid: toText(row.organizer_jid),
    organizerName: toText(row.organizer_name),
    fingerprint: toText(row.fingerprint),
    sourceMessageId: toText(row.source_message_id),
    sourceMessageIds: normalizeTextList(parseJson(row.source_message_ids_json, []), 30),
    extraction: parseJson(row.extraction_json, {}),
    createdAt: toMs(row.created_at),
    updatedAt: toMs(row.updated_at),
    cancelledAt: toMs(row.cancelled_at),
  };
}

function mapReminder(row) {
  if (!row) return null;
  return {
    eventId: toText(row.event_id),
    reminderKind: toText(row.reminder_kind),
    dueAt: toMs(row.due_at),
    status: toText(row.status, 'pending'),
    attemptCount: Math.max(0, Number(row.attempt_count) || 0),
    leaseToken: toText(row.lease_token),
    leaseUntil: toMs(row.lease_until),
    lastError: toText(row.last_error),
    sentAt: toMs(row.sent_at),
    createdAt: toMs(row.created_at),
    updatedAt: toMs(row.updated_at),
  };
}

function isEventStatus(value) {
  return EVENT_STATUSES.has(value);
}

function isReminderKind(value) {
  if (REMINDER_KINDS.has(value)) return true;
  if (typeof value === 'string' && value.startsWith('custom::')) return true;
  return false;
}

export function createEventRepository({ getDatabase = getDb } = {}) {
  function ensureSchema() {
    applyFunSchema(getDatabase());
  }

  function getById(eventId) {
    ensureSchema();
    const row = getDatabase()
      .prepare(`SELECT * FROM ${ANALYTICS_SCHEMA}.fun_group_events WHERE id = ?`)
      .get(toText(eventId));
    return mapEvent(row);
  }

  function getBySourceMessage({ scopeKey, messageId } = {}) {
    ensureSchema();
    const scope = toText(scopeKey);
    const source = toText(messageId);
    if (!scope || !source) return null;
    const row = getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_group_events
         WHERE scope_key = ? AND source_message_id = ?`
      )
      .get(scope, source);
    return mapEvent(row);
  }

  function getByAnySourceMessage({ scopeKey, messageId } = {}) {
    ensureSchema();
    const scope = toText(scopeKey);
    const source = toText(messageId);
    if (!scope || !source) return null;
    const row = getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_group_events
         WHERE scope_key = ?
           AND (source_message_id = ? OR instr(source_message_ids_json, ?) > 0)
         LIMIT 1`
      )
      .get(scope, source, source);
    return mapEvent(row);
  }

  function listByScope(scopeKey, { includePast = true, limit = 100 } = {}) {
    ensureSchema();
    const scope = toText(scopeKey);
    const cap = Math.max(1, Math.min(500, Math.floor(Number(limit) || 100)));
    const rows = getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_group_events
         WHERE scope_key = ? ${includePast ? '' : "AND status = 'active'"}
         ORDER BY starts_at DESC LIMIT ?`
      )
      .all(scope, cap);
    return rows.map(mapEvent);
  }

  function findCandidates({ scopeKey, authorJid, startsAt = 0, now = Date.now(), windowMs = 30 * 60_000, fingerprint = '' } = {}) {
    ensureSchema();
    const scope = toText(scopeKey);
    const author = toText(authorJid);
    if (!scope || !author) return [];
    const eventAt = toMs(startsAt);
    const window = Math.max(60_000, Math.min(6 * 60 * 60_000, Number(windowMs) || 30 * 60_000));
    const announcedAfter = Math.max(0, toMs(now, Date.now()) - window);
    const rows = getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_group_events
         WHERE scope_key = ?
           AND author_jid = ?
           AND status = 'active'
           AND updated_at >= ?
         ORDER BY updated_at DESC LIMIT 8`
      )
      .all(scope, author, announcedAfter)
      .map(mapEvent);

    return rows.filter((event) => {
      if (eventAt && Math.abs(event.startsAt - eventAt) <= 24 * 60 * 60_000) return true;
      const target = toText(fingerprint);
      return Boolean(target && event.fingerprint && event.fingerprint === target);
    });
  }

  function upsertEvent({ event = {}, sourceMessageIds = [], reminderSchedule = {}, now = Date.now() } = {}) {
    ensureSchema();
    const db = getDatabase();
    const timestamp = toMs(now, Date.now());
    const scopeKey = toText(event.scopeKey);
    const authorJid = toText(event.authorJid);
    const sourceMessageId = toText(event.sourceMessageId);
    const startsAt = toMs(event.startsAt);
    if (!scopeKey || !authorJid || !sourceMessageId || !startsAt) {
      return { ok: false, reason: 'invalid-event' };
    }

    const existingBySource = getBySourceMessage({ scopeKey, messageId: sourceMessageId });
    if (existingBySource) return { ok: true, event: existingBySource, created: false, duplicate: true };

    const eventId = toText(event.id, randomUUID());
    const status = isEventStatus(event.status) ? event.status : 'active';
    const sourceIds = normalizeTextList([sourceMessageId, ...sourceMessageIds], 30);
    const items = normalizeTextList(event.items);

    const persist = db.transaction(() => {
      db.prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_group_events
         (id, scope_key, author_jid, status, title, event_type, starts_at, timezone,
          location, items_json, organizer_jid, organizer_name, fingerprint,
          source_message_id, source_message_ids_json, extraction_json, created_at, updated_at, cancelled_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        eventId,
        scopeKey,
        authorJid,
        status,
        toText(event.title).slice(0, 180),
        toText(event.eventType, 'other').slice(0, 48),
        startsAt,
        toText(event.timezone, 'America/Sao_Paulo').slice(0, 80),
        toText(event.location).slice(0, 240),
        JSON.stringify(items),
        toText(event.organizerJid).slice(0, 120),
        toText(event.organizerName).slice(0, 120),
        toText(event.fingerprint).slice(0, 240),
        sourceMessageId,
        JSON.stringify(sourceIds),
        JSON.stringify(event.extraction && typeof event.extraction === 'object' ? event.extraction : {}),
        timestamp,
        timestamp,
        status === 'cancelled' ? timestamp : 0
      );
      syncPendingReminders(eventId, startsAt, reminderSchedule, timestamp);
    });

    try {
      persist();
    } catch (error) {
      const duplicate = getBySourceMessage({ scopeKey, messageId: sourceMessageId });
      if (duplicate) return { ok: true, event: duplicate, created: false, duplicate: true };
      throw error;
    }
    return { ok: true, event: getById(eventId), created: true, duplicate: false };
  }

  function updateEvent(eventId, patch = {}, { sourceMessageIds = [], reminderSchedule = {}, now = Date.now() } = {}) {
    ensureSchema();
    const current = getById(eventId);
    if (!current) return { ok: false, reason: 'not-found' };
    const timestamp = toMs(now, Date.now());
    const next = {
      status: isEventStatus(patch.status) ? patch.status : current.status,
      title: patch.title === undefined ? current.title : toText(patch.title).slice(0, 180),
      eventType: patch.eventType === undefined ? current.eventType : toText(patch.eventType, 'other').slice(0, 48),
      startsAt: patch.startsAt === undefined ? current.startsAt : toMs(patch.startsAt, current.startsAt),
      timezone: patch.timezone === undefined ? current.timezone : toText(patch.timezone, current.timezone).slice(0, 80),
      location: patch.location === undefined ? current.location : toText(patch.location).slice(0, 240),
      items: patch.items === undefined ? current.items : normalizeTextList(patch.items),
      organizerJid: patch.organizerJid === undefined ? current.organizerJid : toText(patch.organizerJid).slice(0, 120),
      organizerName: patch.organizerName === undefined ? current.organizerName : toText(patch.organizerName).slice(0, 120),
      fingerprint: patch.fingerprint === undefined ? current.fingerprint : toText(patch.fingerprint).slice(0, 240),
      extraction: patch.extraction === undefined ? current.extraction : patch.extraction,
      sourceMessageIds: normalizeTextList([...current.sourceMessageIds, ...sourceMessageIds], 30),
    };

    const persist = getDatabase().transaction(() => {
      getDatabase().prepare(
        `UPDATE ${ANALYTICS_SCHEMA}.fun_group_events
         SET status = ?, title = ?, event_type = ?, starts_at = ?, timezone = ?, location = ?,
             items_json = ?, organizer_jid = ?, organizer_name = ?, fingerprint = ?,
             source_message_ids_json = ?, extraction_json = ?, updated_at = ?,
             cancelled_at = CASE WHEN ? = 'cancelled' THEN ? ELSE cancelled_at END
         WHERE id = ?`
      ).run(
        next.status,
        next.title,
        next.eventType,
        next.startsAt,
        next.timezone,
        next.location,
        JSON.stringify(next.items),
        next.organizerJid,
        next.organizerName,
        next.fingerprint,
        JSON.stringify(next.sourceMessageIds),
        JSON.stringify(next.extraction && typeof next.extraction === 'object' ? next.extraction : {}),
        timestamp,
        next.status,
        timestamp,
        current.id
      );

      if (next.status === 'cancelled') {
        getDatabase().prepare(
          `UPDATE ${ANALYTICS_SCHEMA}.fun_group_event_reminders
           SET status = 'skipped_cancelled', lease_token = '', lease_until = 0, updated_at = ?
           WHERE event_id = ? AND status IN ('pending', 'sending')`
        ).run(timestamp, current.id);
      } else {
        syncPendingReminders(current.id, next.startsAt, reminderSchedule, timestamp);
      }
    });
    persist();
    return { ok: true, event: getById(current.id), updated: true };
  }

  function syncPendingReminders(eventId, startsAt, schedule = {}, now = Date.now()) {
    const db = getDatabase();
    const timestamp = toMs(now, Date.now());
    const eventAt = toMs(startsAt);
    if (!eventAt) return;
    const definitions = [
      ['three_days', eventAt - 3 * 24 * 60 * 60_000, schedule.threeDaysEnabled !== false],
      ['three_hours', eventAt - 3 * 60 * 60_000, schedule.threeHoursEnabled !== false],
    ];
    const customReminders = Array.isArray(schedule.customReminders)
      ? schedule.customReminders
      : [];
    for (const custom of customReminders) {
      const dueAt = toMs(custom?.dueAt);
      const key = toText(custom?.key || `custom-${dueAt}`);
      if (!dueAt) continue;
      definitions.push([`custom::${key}`, dueAt, custom?.enabled !== false]);
    }
    const upsert = db.prepare(
      `INSERT INTO ${ANALYTICS_SCHEMA}.fun_group_event_reminders
       (event_id, reminder_kind, due_at, status, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?)
       ON CONFLICT(event_id, reminder_kind) DO UPDATE SET
         due_at = excluded.due_at,
         updated_at = excluded.updated_at
       WHERE ${ANALYTICS_SCHEMA}.fun_group_event_reminders.status = 'pending'`
    );
    for (const [kind, dueAt, enabled] of definitions) {
      if (!enabled || dueAt <= 0) continue;
      upsert.run(toText(eventId), kind, dueAt, timestamp, timestamp);
    }
  }

  function listDueReminders({ scopeKey, now = Date.now(), limit = 12 } = {}) {
    ensureSchema();
    const scope = toText(scopeKey);
    const timestamp = toMs(now, Date.now());
    const cap = Math.max(1, Math.min(100, Math.floor(Number(limit) || 12)));
    const rows = getDatabase().prepare(
      `SELECT r.*, e.scope_key, e.author_jid, e.status AS event_status, e.title, e.event_type,
              e.starts_at, e.timezone, e.location, e.items_json, e.organizer_jid, e.organizer_name
       FROM ${ANALYTICS_SCHEMA}.fun_group_event_reminders r
       JOIN ${ANALYTICS_SCHEMA}.fun_group_events e ON e.id = r.event_id
       WHERE e.scope_key = ?
         AND r.status IN ('pending', 'sending')
         AND r.due_at <= ?
         AND (r.status = 'pending' OR r.lease_until <= ?)
       ORDER BY r.due_at ASC LIMIT ?`
    ).all(scope, timestamp, timestamp, cap);
    return rows.map((row) => ({
      reminder: mapReminder(row),
      event: mapEvent({
        ...row,
        id: row.event_id,
        status: row.event_status,
        source_message_id: '',
        source_message_ids_json: '[]',
        extraction_json: '{}',
        created_at: 0,
        updated_at: 0,
        cancelled_at: 0,
      }),
    }));
  }

  function claimReminder({ eventId, reminderKind, now = Date.now(), leaseMs = 5 * 60_000 } = {}) {
    ensureSchema();
    const id = toText(eventId);
    const kind = toText(reminderKind);
    if (!id || !isReminderKind(kind)) return null;
    const timestamp = toMs(now, Date.now());
    const token = randomUUID();
    const until = timestamp + Math.max(30_000, Math.min(30 * 60_000, Number(leaseMs) || 5 * 60_000));
    const info = getDatabase().prepare(
      `UPDATE ${ANALYTICS_SCHEMA}.fun_group_event_reminders
       SET status = 'sending', lease_token = ?, lease_until = ?, attempt_count = attempt_count + 1,
           last_error = '', updated_at = ?
       WHERE event_id = ? AND reminder_kind = ?
         AND status IN ('pending', 'sending')
         AND (status = 'pending' OR lease_until <= ?)`
    ).run(token, until, timestamp, id, kind, timestamp);
    if (Number(info.changes) !== 1) return null;
    const row = getDatabase().prepare(
      `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_group_event_reminders
       WHERE event_id = ? AND reminder_kind = ?`
    ).get(id, kind);
    return mapReminder(row);
  }

  function markReminderSent({ eventId, reminderKind, leaseToken, now = Date.now() } = {}) {
    ensureSchema();
    const info = getDatabase().prepare(
      `UPDATE ${ANALYTICS_SCHEMA}.fun_group_event_reminders
       SET status = 'sent', sent_at = ?, lease_token = '', lease_until = 0, updated_at = ?
       WHERE event_id = ? AND reminder_kind = ? AND status = 'sending' AND lease_token = ?`
    ).run(toMs(now, Date.now()), toMs(now, Date.now()), toText(eventId), toText(reminderKind), toText(leaseToken));
    return Number(info.changes) === 1;
  }

  function releaseReminder({ eventId, reminderKind, leaseToken, error = '', now = Date.now() } = {}) {
    ensureSchema();
    const info = getDatabase().prepare(
      `UPDATE ${ANALYTICS_SCHEMA}.fun_group_event_reminders
       SET status = 'pending', lease_token = '', lease_until = 0, last_error = ?, updated_at = ?
       WHERE event_id = ? AND reminder_kind = ? AND status = 'sending' AND lease_token = ?`
    ).run(toText(error).slice(0, 400), toMs(now, Date.now()), toText(eventId), toText(reminderKind), toText(leaseToken));
    return Number(info.changes) === 1;
  }

  function markPastEvents(now = Date.now()) {
    ensureSchema();
    const timestamp = toMs(now, Date.now());
    return getDatabase().prepare(
      `UPDATE ${ANALYTICS_SCHEMA}.fun_group_events
       SET status = 'past', updated_at = ?
       WHERE status = 'active' AND starts_at < ?`
    ).run(timestamp, timestamp);
  }

  return {
    ensureSchema,
    getById,
    getBySourceMessage,
    getByAnySourceMessage,
    listByScope,
    findCandidates,
    upsertEvent,
    updateEvent,
    listDueReminders,
    claimReminder,
    markReminderSent,
    releaseReminder,
    markPastEvents,
  };
}
