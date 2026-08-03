import { createHash } from 'crypto';
import { getDb } from '../../db/context.js';
import { ensureFunSchema } from '../schema.js';

const ANALYTICS_SCHEMA = 'analytics';

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400);
}

function hashText(text) {
  return createHash('sha256').update(String(text || '')).digest('hex');
}

function similarity(a, b) {
  const left = new Set(normalizeText(a).split(' ').filter((token) => token.length >= 3));
  const right = new Set(normalizeText(b).split(' ').filter((token) => token.length >= 3));
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function mapEvidence(row, text = null) {
  if (!row) return null;
  return {
    id: Number(row.id), scopeKey: String(row.scope_key), messageId: String(row.message_id),
    authorJid: String(row.author_jid), text: String(row.text_normalized), textHash: String(row.text_hash),
    createdAt: Number(row.created_at), expiresAt: Number(row.expires_at),
    ...(text != null ? { similarity: similarity(text, row.text_normalized) } : {}),
  };
}

export function createFunEvidenceRepository({ getDatabase = getDb } = {}) {
  const ensure = () => ensureFunSchema(getDatabase());
  function insertEvidence({ scopeKey, messageId, authorJid, text, now = Date.now(), retentionDays = 60 }) {
    ensure();
    const normalized = normalizeText(text);
    if (!scopeKey || !messageId || !authorJid || !normalized) return null;
    const createdAt = Number(now) || Date.now();
    const expiresAt = createdAt + Math.max(1, Math.min(365, Number(retentionDays) || 60)) * 86_400_000;
    getDatabase().prepare(`INSERT INTO ${ANALYTICS_SCHEMA}.fun_evidence_log
      (scope_key, message_id, author_jid, text_normalized, text_hash, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(scope_key, message_id) DO NOTHING`)
      .run(String(scopeKey), String(messageId), String(authorJid), normalized, hashText(normalized), createdAt, expiresAt);
    const row = getDatabase().prepare(`SELECT * FROM ${ANALYTICS_SCHEMA}.fun_evidence_log WHERE scope_key = ? AND message_id = ?`).get(String(scopeKey), String(messageId));
    return mapEvidence(row);
  }
  function findByHash(scopeKey, textHash) {
    ensure();
    return getDatabase().prepare(`SELECT * FROM ${ANALYTICS_SCHEMA}.fun_evidence_log WHERE scope_key = ? AND text_hash = ?`).all(String(scopeKey), String(textHash)).map(mapEvidence);
  }
  function findByAuthorAndText(scopeKey, authorJid, text, { since = 0, limit = 50 } = {}) {
    ensure();
    const rows = getDatabase().prepare(`SELECT * FROM ${ANALYTICS_SCHEMA}.fun_evidence_log
      WHERE scope_key = ? AND author_jid = ? AND created_at >= ? ORDER BY created_at DESC LIMIT ?`)
      .all(String(scopeKey), String(authorJid), Number(since) || 0, Math.max(1, Math.min(200, Number(limit) || 50)));
    return rows.map(row => mapEvidence(row, text)).filter(row => row.similarity > 0).sort((a, b) => b.similarity - a.similarity);
  }
  function getById(id, scopeKey = null) {
    ensure();
    const sql = scopeKey ? `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_evidence_log WHERE id = ? AND scope_key = ?` : `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_evidence_log WHERE id = ?`;
    return mapEvidence(getDatabase().prepare(sql).get(...(scopeKey ? [Number(id), String(scopeKey)] : [Number(id)])));
  }
  function countByScope(scopeKey) { ensure(); return Number(getDatabase().prepare(`SELECT COUNT(*) AS n FROM ${ANALYTICS_SCHEMA}.fun_evidence_log WHERE scope_key = ?`).get(String(scopeKey))?.n) || 0; }
  function gcExpired(now = Date.now()) { ensure(); return getDatabase().prepare(`DELETE FROM ${ANALYTICS_SCHEMA}.fun_evidence_log WHERE expires_at < ?`).run(Number(now) || Date.now()).changes; }
  return { insertEvidence, findByHash, findByAuthorAndText, getById, countByScope, gcExpired, normalizeText, hashText, similarity };
}
