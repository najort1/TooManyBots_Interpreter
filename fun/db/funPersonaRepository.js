import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';

const ANALYTICS_SCHEMA = 'analytics';

function parseJsonArray(raw) {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function parseJsonObject(raw) {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

function mapProfileRow(row) {
  if (!row) return null;
  return {
    scopeKey: String(row.scope_key || ''),
    topTokens: parseJsonArray(row.top_tokens),
    emojis: parseJsonArray(row.emojis),
    avgLen: Number(row.avg_len) || 0,
    styleLines: parseJsonArray(row.style_lines),
    sampleTs: Number(row.sample_ts) || 0,
    updatedAt: Number(row.updated_at) || 0,
    // contagens ponderadas acumuladas { token: weight } — raw, ainda sem decay aplicado.
    tokenCounts: parseJsonObject(row.token_counts_json),
  };
}

function parseAnchorMessageIds(raw) {
  const value = String(raw || '').trim();
  if (!value) return [];
  if (!value.startsWith('[')) return [value];
  return parseJsonArray(value).map((id) => String(id || '').trim()).filter(Boolean);
}

function mapThreadRow(row) {
  if (!row) return null;
  const anchorMessageIds = parseAnchorMessageIds(row.anchor_message_id);
  return {
    id: Number(row.id) || 0,
    scopeKey: String(row.scope_key || ''),
    turnCount: Number(row.turn_count) || 0,
    maxTurns: Number(row.max_turns) || 0,
    lastActivityAt: Number(row.last_activity_at) || 0,
    context: parseJsonArray(row.context),
    anchorMessageId: anchorMessageIds[0] || '',
    anchorMessageIds,
    anchorText: String(row.anchor_text || ''),
    createdAt: Number(row.created_at) || 0,
  };
}

export function createFunPersonaRepository({ getDatabase = getDb } = {}) {
  function ensureSchema() {
    applyFunSchema(getDatabase());
  }

  // ---- Profile ----

  function getProfile(scopeKey) {
    ensureSchema();
    const db = getDatabase();
    const row = db
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_persona_profile WHERE scope_key = ?`
      )
      .get(String(scopeKey || ''));
    return mapProfileRow(row);
  }

  function upsertProfile({ scopeKey, topTokens = [], emojis = [], avgLen = 0, styleLines = [], sampleTs = 0, now = Date.now(), tokenCounts = null } = {}) {
    ensureSchema();
    const db = getDatabase();
    const s = String(scopeKey || '');
    if (!s.endsWith('@g.us')) return { ok: false, reason: 'invalid' };

    const tt = JSON.stringify(Array.isArray(topTokens) ? topTokens.slice(0, 60) : []);
    const em = JSON.stringify(Array.isArray(emojis) ? emojis.slice(0, 10) : []);
    const sl = JSON.stringify(Array.isArray(styleLines) ? styleLines.slice(0, 3) : []);
    const tc = JSON.stringify(tokenCounts && typeof tokenCounts === 'object' && !Array.isArray(tokenCounts) ? tokenCounts : {});

    db.prepare(
      `INSERT INTO ${ANALYTICS_SCHEMA}.fun_persona_profile (
        scope_key, top_tokens, emojis, avg_len, style_lines, sample_ts, updated_at, token_counts_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope_key) DO UPDATE SET
        top_tokens = excluded.top_tokens,
        emojis = excluded.emojis,
        avg_len = excluded.avg_len,
        style_lines = excluded.style_lines,
        sample_ts = excluded.sample_ts,
        token_counts_json = excluded.token_counts_json,
        updated_at = excluded.updated_at`
    ).run(s, tt, em, Number(avgLen) || 0, sl, Number(sampleTs) || 0, Number(now) || Date.now(), tc);

    return { ok: true, profile: getProfile(s) };
  }

  // ---- Threads ----

  function getActiveThread(scopeKey, { now = Date.now(), ttlMs = 30 * 60_000 } = {}) {
    ensureSchema();
    const db = getDatabase();
    const row = db
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_persona_thread
        WHERE scope_key = ?
        ORDER BY last_activity_at DESC
        LIMIT 1`
      )
      .get(String(scopeKey || ''));
    if (!row) return null;
    const thread = mapThreadRow(row);
    if (now - thread.lastActivityAt > ttlMs) return null;
    return thread;
  }

  function getActiveThreadByAnchor(scopeKey, {
    quotedMessageId = '',
    quotedText = '',
    now = Date.now(),
    ttlMs = 30 * 60_000,
  } = {}) {
    ensureSchema();
    const id = String(quotedMessageId || '').trim();
    const text = String(quotedText || '').trim();
    const rows = getDatabase().prepare(
      `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_persona_thread
       WHERE scope_key = ?
       ORDER BY last_activity_at DESC`
    ).all(String(scopeKey || ''));
    for (const row of rows) {
      const thread = mapThreadRow(row);
      if (Number(now) - thread.lastActivityAt > Number(ttlMs)) continue;
      const idMatches = id && thread.anchorMessageIds.includes(id);
      const textMatches = text && thread.anchorText === text;
      // Alguns clients não expõem messageId/texto no quote. Esse caso legado
      // já foi confirmado como reply do bot pelo detector e usa a thread ativa.
      const legacyQuotedBot = !id && !text;
      if (idMatches || textMatches || legacyQuotedBot) return thread;
    }
    return null;
  }

  // maxTurns 0 = sem limite de turnos (chat infinito).
  function openThread({ scopeKey, maxTurns = 0, context = [], now = Date.now() }) {
    ensureSchema();
    const db = getDatabase();
    const s = String(scopeKey || '');
    if (!s.endsWith('@g.us')) return { ok: false, reason: 'invalid' };

    const ctxJson = JSON.stringify(Array.isArray(context) ? context : []);
    const result = db
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_persona_thread (
          scope_key, turn_count, max_turns, last_activity_at, context, created_at
        ) VALUES (?, 0, ?, ?, ?, ?)`
      )
      .run(s, Number(maxTurns) || 0, Number(now) || Date.now(), ctxJson, Number(now) || Date.now());

    return getThreadById(Number(result.lastInsertRowid));
  }

  function continueThread({ threadId, context = [], now = Date.now() }) {
    ensureSchema();
    const db = getDatabase();
    const id = Number(threadId) || 0;
    if (!id) return { ok: false, reason: 'invalid' };

    const existing = getThreadById(id);
    if (!existing) return { ok: false, reason: 'not_found' };
    if (existing.maxTurns > 0 && existing.turnCount >= existing.maxTurns) return { ok: false, reason: 'limit' };

    const ctxJson = JSON.stringify(Array.isArray(context) ? context : []);
    db.prepare(
      `UPDATE ${ANALYTICS_SCHEMA}.fun_persona_thread
        SET turn_count = turn_count + 1, last_activity_at = ?, context = ?
        WHERE id = ?`
    ).run(Number(now) || Date.now(), ctxJson, id);

    return { ok: true, thread: getThreadById(id) };
  }

  function getThreadById(id) {
    ensureSchema();
    const db = getDatabase();
    const row = db
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_persona_thread WHERE id = ?`
      )
      .get(Number(id) || 0);
    return mapThreadRow(row);
  }

  /**
   * Grava todas as âncoras da última resposta da persona nesta thread.
   * Respostas multi-balão persistem cada messageId em JSON na coluna legada;
   * respostas simples continuam armazenadas como string para compatibilidade.
   */
  function setAnchor({
    threadId,
    anchorMessageId = '',
    anchorMessageIds = [],
    anchorText = '',
    now = Date.now(),
  } = {}) {
    ensureSchema();
    const db = getDatabase();
    const id = Number(threadId) || 0;
    if (!id) return { ok: false, reason: 'invalid' };

    const ids = [...new Set([
      ...(Array.isArray(anchorMessageIds) ? anchorMessageIds : []),
      anchorMessageId,
    ].map((value) => String(value || '').trim()).filter(Boolean))];
    const storedAnchor = ids.length > 1 ? JSON.stringify(ids) : (ids[0] || '');
    const text = String(anchorText || '').trim();
    if (!storedAnchor && !text) return { ok: false, reason: 'invalid' };

    db.prepare(
      `UPDATE ${ANALYTICS_SCHEMA}.fun_persona_thread
        SET anchor_message_id = ?, anchor_text = ?, last_activity_at = ?
        WHERE id = ?`
    ).run(storedAnchor, text.slice(0, 400), Number(now) || Date.now(), id);
    return { ok: true, thread: getThreadById(id) };
  }

  function closeExpiredThreads({ scopeKey, now = Date.now(), ttlMs = 30 * 60_000 } = {}) {
    ensureSchema();
    const db = getDatabase();
    const s = String(scopeKey || '');
    const cutoff = (Number(now) || Date.now()) - (Number(ttlMs) || 30 * 60_000);
    db.prepare(
      `DELETE FROM ${ANALYTICS_SCHEMA}.fun_persona_thread
        WHERE scope_key = ? AND last_activity_at < ?`
    ).run(s, cutoff);
    return { ok: true };
  }

  return {
    getProfile,
    upsertProfile,
    getActiveThread,
    getActiveThreadByAnchor,
    openThread,
    continueThread,
    getThreadById,
    setAnchor,
    closeExpiredThreads,
  };
}
