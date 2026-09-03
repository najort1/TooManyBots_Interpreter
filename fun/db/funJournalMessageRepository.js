import { getDb } from '../../db/context.js';
import { ensureFunSchema } from '../schema.js';
import { isJournalMessageEligible } from '../services/news/journalMessagePolicy.js';

const ANALYTICS_SCHEMA = 'analytics';

function decodeJson(value, fallback) {
  try {
    const parsed = JSON.parse(String(value || ''));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function mapMessage(row) {
  if (!row) return null;
  return {
    scopeKey: String(row.scope_key || ''),
    messageId: String(row.message_id || ''),
    authorJid: String(row.author_jid || ''),
    source: String(row.source || 'human'),
    messageType: String(row.message_type || 'text'),
    text: String(row.message_text || ''),
    quotedText: String(row.quoted_text || ''),
    mentionedJids: decodeJson(row.mentioned_jids_json, []),
    occurredAt: Number(row.occurred_at) || 0,
  };
}

export function createFunJournalMessageRepository({ getDatabase = getDb } = {}) {
  const ensure = () => ensureFunSchema(getDatabase());

  function recordMessage({
    scopeKey,
    messageId,
    authorJid = '',
    source = 'human',
    messageType = 'text',
    text,
    quotedText = '',
    mentionedJids = [],
    now = Date.now(),
    prefix = '/',
  } = {}) {
    ensure();
    const scope = String(scopeKey || '');
    const id = String(messageId || '').trim();
    const origin = source === 'bot' ? 'bot' : 'human';
    const eligibility = isJournalMessageEligible({
      scopeKey: scope,
      text,
      messageType,
      source: origin,
      prefix,
    });
    if (!eligibility.eligible) return { ok: false, reason: eligibility.reason };
    if (!id) return { ok: false, reason: 'missing-message-id' };

    const occurredAt = Number(now) || Date.now();
    const messageText = eligibility.text.slice(0, 1200);
    const cleanQuotedText = String(quotedText || '').trim().slice(0, 600);
    const mentions = Array.isArray(mentionedJids)
      ? [...new Set(mentionedJids.map((jid) => String(jid || '').trim()).filter(Boolean))].slice(0, 30)
      : [];

    const result = getDatabase()
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_journal_messages
          (scope_key, message_id, author_jid, source, message_type, message_text, quoted_text, mentioned_jids_json, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(scope_key, message_id) DO NOTHING`
      )
      .run(
        scope,
        id,
        String(authorJid || ''),
        origin,
        String(messageType || 'text').slice(0, 40),
        messageText,
        cleanQuotedText,
        JSON.stringify(mentions),
        occurredAt
      );

    if (!result.changes) return { ok: false, reason: 'duplicate' };
    return {
      ok: true,
      message: {
        scopeKey: scope,
        messageId: id,
        authorJid: String(authorJid || ''),
        source: origin,
        messageType: String(messageType || 'text'),
        text: messageText,
        quotedText: cleanQuotedText,
        mentionedJids: mentions,
        occurredAt,
      },
    };
  }

  function listBetween(scopeKey, { since = 0, until = Number.MAX_SAFE_INTEGER, limit = 1200 } = {}) {
    ensure();
    const safeLimit = Math.max(1, Math.min(5000, Math.floor(Number(limit) || 1200)));
    return getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_journal_messages
         WHERE scope_key = ? AND occurred_at >= ? AND occurred_at < ?
         ORDER BY occurred_at ASC, message_id ASC
         LIMIT ?`
      )
      .all(
        String(scopeKey || ''),
        Number(since) || 0,
        Number.isFinite(Number(until)) ? Number(until) : Number.MAX_SAFE_INTEGER,
        safeLimit
      )
      .map(mapMessage);
  }

  function countBetween(scopeKey, { since = 0, until = Number.MAX_SAFE_INTEGER } = {}) {
    ensure();
    return (
      Number(
        getDatabase()
          .prepare(
            `SELECT COUNT(*) AS n FROM ${ANALYTICS_SCHEMA}.fun_journal_messages
             WHERE scope_key = ? AND occurred_at >= ? AND occurred_at < ?`
          )
          .get(
            String(scopeKey || ''),
            Number(since) || 0,
            Number.isFinite(Number(until)) ? Number(until) : Number.MAX_SAFE_INTEGER
          )?.n
      ) || 0
    );
  }

  /**
   * Para dias muito ativos, escolhe uma amostra uniforme já no SQLite. Assim o
   * contexto inclui começo, meio e fim do dia sem carregar mensagens ilimitadas.
   */
  function listSampledBetween(scopeKey, { since = 0, until = Number.MAX_SAFE_INTEGER, limit = 1200 } = {}) {
    ensure();
    const scope = String(scopeKey || '');
    const lower = Number(since) || 0;
    const upper = Number.isFinite(Number(until)) ? Number(until) : Number.MAX_SAFE_INTEGER;
    const safeLimit = Math.max(1, Math.min(5000, Math.floor(Number(limit) || 1200)));
    const total = countBetween(scope, { since: lower, until: upper });
    if (total <= safeLimit) {
      return { total, messages: listBetween(scope, { since: lower, until: upper, limit: safeLimit }) };
    }

    const step = Math.ceil(total / safeLimit);
    const rows = getDatabase()
      .prepare(
        `SELECT scope_key, message_id, author_jid, source, message_type, message_text,
                quoted_text, mentioned_jids_json, occurred_at
         FROM (
           SELECT *, ROW_NUMBER() OVER (ORDER BY occurred_at ASC, message_id ASC) AS row_number
           FROM ${ANALYTICS_SCHEMA}.fun_journal_messages
           WHERE scope_key = ? AND occurred_at >= ? AND occurred_at < ?
         )
         WHERE (row_number - 1) % ? = 0
         ORDER BY occurred_at ASC, message_id ASC
         LIMIT ?`
      )
      .all(scope, lower, upper, step, safeLimit);
    return { total, messages: rows.map(mapMessage) };
  }

  function pruneOlderThan(scopeKey, beforeMs) {
    ensure();
    return getDatabase()
      .prepare(
        `DELETE FROM ${ANALYTICS_SCHEMA}.fun_journal_messages
         WHERE scope_key = ? AND occurred_at < ?`
      )
      .run(String(scopeKey || ''), Number(beforeMs) || 0).changes;
  }

  return { recordMessage, listBetween, countBetween, listSampledBetween, pruneOlderThan };
}
