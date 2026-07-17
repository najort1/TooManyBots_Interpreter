/**
 * Persistência de lore seletiva por grupo.
 */

import { randomUUID } from 'crypto';
import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';

const ANALYTICS_SCHEMA = 'analytics';

const KINDS = new Set([
  'running_gag',
  'rivalry',
  'catchphrase',
  'epic_fail',
  'ship_lore',
  'nickname',
  'event',
]);

function parseJsonArray(raw) {
  try {
    const v = JSON.parse(String(raw || '[]'));
    return Array.isArray(v) ? v.map((x) => String(x || '').trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function mapFact(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    scopeKey: String(row.scope_key || ''),
    kind: String(row.kind || 'event'),
    summary: String(row.summary || ''),
    subjects: parseJsonArray(row.subjects_json),
    keywords: parseJsonArray(row.keywords_json),
    score: Number(row.score) || 0,
    hits: Number(row.hits) || 1,
    source: String(row.source || 'chat'),
    createdAt: Number(row.created_at) || 0,
    lastSeenAt: Number(row.last_seen_at) || 0,
  };
}

export function createFunMemoryRepository({ getDatabase = getDb } = {}) {
  function ensureSchema() {
    applyFunSchema(getDatabase());
  }

  function insertFact({
    scopeKey,
    kind = 'event',
    summary,
    subjects = [],
    keywords = [],
    score = 50,
    source = 'chat',
    now = Date.now(),
    id = null,
  }) {
    ensureSchema();
    const factId = id || randomUUID();
    const ts = Number(now) || Date.now();
    const k = KINDS.has(String(kind)) ? String(kind) : 'event';
    const sum = String(summary || '').trim().slice(0, 200);
    if (!sum || !scopeKey) return null;

    getDatabase()
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_group_memories
         (id, scope_key, kind, summary, subjects_json, keywords_json, score, hits, source, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
      )
      .run(
        factId,
        String(scopeKey),
        k,
        sum,
        JSON.stringify((subjects || []).map(String).slice(0, 8)),
        JSON.stringify((keywords || []).map(String).slice(0, 12)),
        Math.max(0, Math.min(100, Math.round(Number(score) || 50))),
        String(source || 'chat'),
        ts,
        ts
      );
    return getFact(factId);
  }

  function getFact(id) {
    ensureSchema();
    const row = getDatabase()
      .prepare(`SELECT * FROM ${ANALYTICS_SCHEMA}.fun_group_memories WHERE id = ?`)
      .get(String(id || ''));
    return mapFact(row);
  }

  function listFacts(scopeKey, { limit = 50, minScore = 0 } = {}) {
    ensureSchema();
    const rows = getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_group_memories
         WHERE scope_key = ? AND score >= ?
         ORDER BY score DESC, last_seen_at DESC
         LIMIT ?`
      )
      .all(String(scopeKey || ''), Math.max(0, Number(minScore) || 0), Math.max(1, Math.min(200, Number(limit) || 50)));
    return rows.map(mapFact).filter(Boolean);
  }

  function countFacts(scopeKey) {
    ensureSchema();
    const row = getDatabase()
      .prepare(
        `SELECT COUNT(*) AS n FROM ${ANALYTICS_SCHEMA}.fun_group_memories WHERE scope_key = ?`
      )
      .get(String(scopeKey || ''));
    return Number(row?.n) || 0;
  }

  function reinforceFact(id, { summary, score, keywords, now = Date.now() } = {}) {
    ensureSchema();
    const current = getFact(id);
    if (!current) return null;
    const ts = Number(now) || Date.now();
    const nextSummary = summary
      ? String(summary).trim().slice(0, 200)
      : current.summary;
    const nextScore = Math.max(
      current.score,
      Math.min(100, Math.round(Number(score != null ? score : current.score) || current.score))
    );
    const nextKeywords =
      Array.isArray(keywords) && keywords.length
        ? [...new Set([...current.keywords, ...keywords.map(String)])].slice(0, 12)
        : current.keywords;

    getDatabase()
      .prepare(
        `UPDATE ${ANALYTICS_SCHEMA}.fun_group_memories
         SET summary = ?, score = ?, hits = hits + 1, keywords_json = ?, last_seen_at = ?
         WHERE id = ?`
      )
      .run(nextSummary, nextScore, JSON.stringify(nextKeywords), ts, String(id));
    return getFact(id);
  }

  function deleteFact(id) {
    ensureSchema();
    const r = getDatabase()
      .prepare(`DELETE FROM ${ANALYTICS_SCHEMA}.fun_group_memories WHERE id = ?`)
      .run(String(id || ''));
    return r.changes > 0;
  }

  function deleteByScope(scopeKey) {
    ensureSchema();
    const r = getDatabase()
      .prepare(`DELETE FROM ${ANALYTICS_SCHEMA}.fun_group_memories WHERE scope_key = ?`)
      .run(String(scopeKey || ''));
    return r.changes || 0;
  }

  function deleteBySubject(scopeKey, userJid) {
    ensureSchema();
    const facts = listFacts(scopeKey, { limit: 200, minScore: 0 });
    const target = String(userJid || '');
    let n = 0;
    for (const f of facts) {
      if (f.subjects.includes(target)) {
        if (deleteFact(f.id)) n += 1;
      }
    }
    return n;
  }

  /** Remove os de menor score até ficar em maxFacts. */
  function pruneToCap(scopeKey, maxFacts = 50) {
    ensureSchema();
    const cap = Math.max(5, Math.floor(Number(maxFacts) || 50));
    const count = countFacts(scopeKey);
    if (count <= cap) return 0;
    const overflow = count - cap;
    const rows = getDatabase()
      .prepare(
        `SELECT id FROM ${ANALYTICS_SCHEMA}.fun_group_memories
         WHERE scope_key = ?
         ORDER BY score ASC, last_seen_at ASC
         LIMIT ?`
      )
      .all(String(scopeKey || ''), overflow);
    let n = 0;
    const del = getDatabase().prepare(
      `DELETE FROM ${ANALYTICS_SCHEMA}.fun_group_memories WHERE id = ?`
    );
    for (const row of rows) {
      del.run(row.id);
      n += 1;
    }
    return n;
  }

  /** Score decai e remove velhos com score baixo. */
  function decayAndPurge(scopeKey, { ttlDays = 45, minScore = 35, now = Date.now() } = {}) {
    ensureSchema();
    const ttlMs = Math.max(1, Number(ttlDays) || 45) * 24 * 60 * 60_000;
    const cutoff = (Number(now) || Date.now()) - ttlMs;
    const r = getDatabase()
      .prepare(
        `DELETE FROM ${ANALYTICS_SCHEMA}.fun_group_memories
         WHERE scope_key = ? AND last_seen_at < ? AND score < ?`
      )
      .run(String(scopeKey || ''), cutoff, Math.max(0, Number(minScore) || 35));
    return r.changes || 0;
  }

  function getPersona(scopeKey) {
    ensureSchema();
    const row = getDatabase()
      .prepare(`SELECT * FROM ${ANALYTICS_SCHEMA}.fun_group_persona WHERE scope_key = ?`)
      .get(String(scopeKey || ''));
    if (!row) {
      return { scopeKey: String(scopeKey || ''), personaText: '', factCount: 0, updatedAt: 0 };
    }
    return {
      scopeKey: String(row.scope_key || ''),
      personaText: String(row.persona_text || ''),
      factCount: Number(row.fact_count) || 0,
      updatedAt: Number(row.updated_at) || 0,
    };
  }

  function setPersona(scopeKey, personaText, factCount = 0, now = Date.now()) {
    ensureSchema();
    const ts = Number(now) || Date.now();
    getDatabase()
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_group_persona
         (scope_key, persona_text, fact_count, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(scope_key) DO UPDATE SET
           persona_text = excluded.persona_text,
           fact_count = excluded.fact_count,
           updated_at = excluded.updated_at`
      )
      .run(
        String(scopeKey || ''),
        String(personaText || '').slice(0, 800),
        Math.max(0, Math.floor(Number(factCount) || 0)),
        ts
      );
    return getPersona(scopeKey);
  }

  function clearPersona(scopeKey) {
    ensureSchema();
    getDatabase()
      .prepare(`DELETE FROM ${ANALYTICS_SCHEMA}.fun_group_persona WHERE scope_key = ?`)
      .run(String(scopeKey || ''));
  }

  return {
    KINDS,
    insertFact,
    getFact,
    listFacts,
    countFacts,
    reinforceFact,
    deleteFact,
    deleteByScope,
    deleteBySubject,
    pruneToCap,
    decayAndPurge,
    getPersona,
    setPersona,
    clearPersona,
  };
}
