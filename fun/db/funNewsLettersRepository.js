/**
 * Repositório do Correio dos Leitores (/carta — Jornal The Group Times).
 *
 * Guarda as cartas enviadas pelos usuários para a redação do jornal, com
 * retenção curta (prune no publish). NENHUM texto de carta vai para o
 * snapshot diário (política: snapshots nunca guardam citações/conteúdo bruto).
 */

import { randomUUID } from 'node:crypto';

import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';

const ANALYTICS_SCHEMA = 'analytics';

function mapLetter(row) {
  if (!row) return null;
  return {
    id: String(row.id || ''),
    scopeKey: String(row.scope_key || ''),
    authorJid: String(row.author_jid || ''),
    text: String(row.text || ''),
    dayKey: String(row.day_key || ''),
    createdAt: Number(row.created_at) || 0,
  };
}

export function createFunNewsLettersRepository({ getDatabase = getDb } = {}) {
  function ensureSchema() {
    applyFunSchema(getDatabase());
  }

  /**
   * Registra uma carta. `id` pode ser informado (dedupe em testes); sem id,
   * gera um UUID — o par (escopo, dia) aceita várias cartas por design.
   */
  function recordLetter({
    scopeKey,
    authorJid,
    text,
    dayKey,
    id = '',
    now = Date.now(),
  } = {}) {
    const scope = String(scopeKey || '').trim();
    const author = String(authorJid || '').trim();
    const body = String(text || '').trim();
    const day = String(dayKey || '').trim();
    if (!scope || !author || !body || !day) return null;
    ensureSchema();
    const db = getDatabase();
    const createdAt = Number(now) || Date.now();
    const letterId = String(id || `ltr_${randomUUID()}`);
    db.prepare(
      `INSERT INTO ${ANALYTICS_SCHEMA}.fun_news_letters
       (id, scope_key, author_jid, text, day_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(letterId, scope, author, body, day, createdAt);
    return {
      id: letterId,
      scopeKey: scope,
      authorJid: author,
      text: body,
      dayKey: day,
      createdAt,
    };
  }

  /** Cartas do dia do jornal (mais antigas primeiro, limite padrão 10). */
  function listLettersForDay(scopeKey, { dayKey, limit = 10 } = {}) {
    ensureSchema();
    const db = getDatabase();
    const max = Math.max(1, Math.floor(Number(limit) || 10));
    const rows = db
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_news_letters
         WHERE scope_key = ? AND day_key = ?
         ORDER BY created_at ASC LIMIT ?`
      )
      .all(String(scopeKey || ''), String(dayKey || ''), max);
    return rows.map(mapLetter);
  }

  /** Quantidade de cartas do autor no dia (rate-limit diário). */
  function countByAuthorOnDay(scopeKey, { authorJid, dayKey } = {}) {
    ensureSchema();
    const db = getDatabase();
    const row = db
      .prepare(
        `SELECT COUNT(*) AS total FROM ${ANALYTICS_SCHEMA}.fun_news_letters
         WHERE scope_key = ? AND author_jid = ? AND day_key = ?`
      )
      .get(String(scopeKey || ''), String(authorJid || ''), String(dayKey || ''));
    return Number(row?.total) || 0;
  }

  /** Última carta do autor no escopo (rate-limit de intervalo mínimo). */
  function getLastLetterByAuthor(scopeKey, authorJid) {
    ensureSchema();
    const db = getDatabase();
    const row = db
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_news_letters
         WHERE scope_key = ? AND author_jid = ?
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(String(scopeKey || ''), String(authorJid || ''));
    return mapLetter(row);
  }

  function pruneOlderThan(scopeKey, beforeMs) {
    ensureSchema();
    const db = getDatabase();
    const info = db
      .prepare(
        `DELETE FROM ${ANALYTICS_SCHEMA}.fun_news_letters
         WHERE scope_key = ? AND created_at < ?`
      )
      .run(String(scopeKey || ''), Number(beforeMs) || 0);
    return info.changes || 0;
  }

  return { recordLetter, listLettersForDay, countByAuthorOnDay, getLastLetterByAuthor, pruneOlderThan };
}
