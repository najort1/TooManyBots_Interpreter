import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';

const ANALYTICS_SCHEMA = 'analytics';

function parseJson(value, fallback = []) {
  try {
    const parsed = JSON.parse(String(value || ''));
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function clean(value, maxChars) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, maxChars);
}

function mapMessage(row) {
  if (!row) return null;
  return {
    scopeKey: String(row.scope_key || ''),
    messageId: String(row.message_id || ''),
    authorJid: String(row.author_jid || ''),
    authorLabel: String(row.author_label || ''),
    source: String(row.source || 'human'),
    messageType: String(row.message_type || 'text'),
    text: String(row.message_text || ''),
    quotedText: String(row.quoted_text || ''),
    mentionedJids: parseJson(row.mentioned_jids_json),
    occurredAt: Number(row.occurred_at) || 0,
  };
}

/**
 * Histórico conversacional curto da persona.
 *
 * Não é o jornal diário: existe exclusivamente para a persona recuperar a
 * conversa imediatamente anterior a um gatilho, inclusive após restart.
 */
export function createFunPersonaRecentMessageRepository({ getDatabase = getDb } = {}) {
  const ensureSchema = () => applyFunSchema(getDatabase());

  function recordMessage({
    scopeKey,
    messageId,
    authorJid = '',
    authorLabel = '',
    source = 'human',
    messageType = 'text',
    text = '',
    quotedText = '',
    mentionedJids = [],
    now = Date.now(),
  } = {}) {
    ensureSchema();
    const scope = String(scopeKey || '').trim();
    const id = String(messageId || '').trim();
    if (!scope.endsWith('@g.us') || !id) return { ok: false, reason: 'invalid' };

    const body = clean(text, 4_000);
    if (!body) return { ok: false, reason: 'empty' };

    const origin = source === 'bot' ? 'bot' : 'human';
    const occurredAt = Number(now) || Date.now();
    const message = {
      scopeKey: scope,
      messageId: id,
      authorJid: clean(authorJid, 120),
      authorLabel: clean(authorLabel, 120),
      source: origin,
      messageType: clean(messageType, 40) || 'text',
      text: body,
      quotedText: clean(quotedText, 1_200),
      mentionedJids: Array.isArray(mentionedJids)
        ? [...new Set(mentionedJids.map((jid) => clean(jid, 120)).filter(Boolean))].slice(0, 30)
        : [],
      occurredAt,
    };

    const result = getDatabase().prepare(
      `INSERT INTO ${ANALYTICS_SCHEMA}.fun_persona_recent_messages (
        scope_key, message_id, author_jid, author_label, source, message_type,
        message_text, quoted_text, mentioned_jids_json, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope_key, message_id) DO NOTHING`
    ).run(
      message.scopeKey,
      message.messageId,
      message.authorJid,
      message.authorLabel,
      message.source,
      message.messageType,
      message.text,
      message.quotedText,
      JSON.stringify(message.mentionedJids),
      message.occurredAt
    );

    return result.changes ? { ok: true, message } : { ok: false, reason: 'duplicate' };
  }

  function listRecentBefore(scopeKey, {
    beforeAt = Date.now(),
    beforeMessageId = '',
    windowMs = 24 * 60 * 60_000,
    limit = 120,
  } = {}) {
    ensureSchema();
    const scope = String(scopeKey || '').trim();
    const until = Number(beforeAt) || Date.now();
    const beforeId = String(beforeMessageId || '').trim();
    const since = until - Math.max(60_000, Number(windowMs) || 24 * 60 * 60_000);
    const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 120)));

    const rows = getDatabase().prepare(
      `SELECT * FROM (
        SELECT * FROM ${ANALYTICS_SCHEMA}.fun_persona_recent_messages
        WHERE scope_key = ?
          AND occurred_at >= ?
          AND (occurred_at < ? OR (occurred_at = ? AND (? = '' OR message_id <> ?)))
        ORDER BY occurred_at DESC, message_id DESC
        LIMIT ?
      ) ORDER BY occurred_at ASC, message_id ASC`
    ).all(scope, since, until, until, beforeId, beforeId, safeLimit);

    return rows.map(mapMessage);
  }

  function listHumanAfter(scopeKey, {
    afterAt = 0,
    afterMessageId = '',
    beforeAt = Date.now(),
    windowMs = 24 * 60 * 60_000,
    limit = 30,
  } = {}) {
    ensureSchema();
    const scope = String(scopeKey || '').trim();
    const since = Math.max(Number(afterAt) || 0, (Number(beforeAt) || Date.now()) - Math.max(60_000, Number(windowMs) || 24 * 60 * 60_000));
    const until = Number(beforeAt) || Date.now();
    const anchorId = String(afterMessageId || '').trim();
    const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 30)));
    const rows = getDatabase().prepare(
      `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_persona_recent_messages
       WHERE scope_key = ?
         AND source = 'human'
         AND occurred_at <= ?
         AND (occurred_at > ? OR (occurred_at = ? AND (? = '' OR message_id > ?)))
       ORDER BY occurred_at ASC, message_id ASC
       LIMIT ?`
    ).all(scope, until, since, since, anchorId, anchorId, safeLimit);
    return rows.map(mapMessage);
  }

  function pruneOlderThan(scopeKey, beforeAt) {
    ensureSchema();
    return getDatabase().prepare(
      `DELETE FROM ${ANALYTICS_SCHEMA}.fun_persona_recent_messages
       WHERE scope_key = ? AND occurred_at < ?`
    ).run(String(scopeKey || ''), Number(beforeAt) || 0).changes;
  }

  return { recordMessage, listRecentBefore, listHumanAfter, pruneOlderThan };
}
