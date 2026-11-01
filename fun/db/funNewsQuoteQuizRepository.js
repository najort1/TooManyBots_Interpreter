/**
 * Repositório da quote vencedora do dia (Jornal das 23:59).
 *
 * Guarda a citação de maior score de cada dia por grupo para alimentar o
 * quiz "Quem disse essa frase?" do Desafio Diário no dia seguinte.
 * Retenção curta (prune no publish do jornal) e NENHUM dado vai para o
 * snapshot diário (política: snapshots nunca guardam citações).
 */

import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';

const ANALYTICS_SCHEMA = 'analytics';

function mapQuote(row) {
  if (!row) return null;
  return {
    scopeKey: String(row.scope_key || ''),
    dayKey: String(row.day_key || ''),
    quoteText: String(row.quote_text || ''),
    authorJid: String(row.author_jid || ''),
    authorName: String(row.author_name || ''),
    score: Number(row.score) || 0,
    createdAt: Number(row.created_at) || 0,
  };
}

export function createFunNewsQuoteQuizRepository({ getDatabase = getDb } = {}) {
  function ensureSchema() {
    applyFunSchema(getDatabase());
  }

  /**
   * Persiste a quote do dia (uma por grupo/dia — regrava em republicação).
   */
  function saveTopQuote({
    scopeKey,
    dayKey,
    quoteText,
    authorJid = '',
    authorName = '',
    score = 0,
    now = Date.now(),
  } = {}) {
    const scope = String(scopeKey || '').trim();
    const day = String(dayKey || '').trim();
    const quote = String(quoteText || '').trim();
    if (!scope || !day || !quote) return null;
    ensureSchema();
    const db = getDatabase();
    db.prepare(
      `INSERT INTO ${ANALYTICS_SCHEMA}.fun_news_quote_quiz
       (scope_key, day_key, quote_text, author_jid, author_name, score, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(scope_key, day_key) DO UPDATE SET
         quote_text = excluded.quote_text,
         author_jid = excluded.author_jid,
         author_name = excluded.author_name,
         score = excluded.score,
         created_at = excluded.created_at`
    ).run(
      scope,
      day,
      quote,
      String(authorJid || ''),
      String(authorName || ''),
      Number(score) || 0,
      Number(now) || Date.now()
    );
    return getLatestQuote(scope, { now: Number(now) || Date.now(), sinceMs: 0 });
  }

  /**
   * Última quote do escopo criada dentro da janela informada (epoch ms —
   * evita matemática de data entre o fuso do jornal e o relógio do servidor).
   */
  function getLatestQuote(scopeKey, { sinceMs = 0, now = Date.now() } = {}) {
    ensureSchema();
    const db = getDatabase();
    const since = Number(sinceMs) || 0;
    const row = db
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_news_quote_quiz
         WHERE scope_key = ? AND created_at >= ? AND created_at <= ?
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(String(scopeKey || ''), since, (Number(now) || Date.now()) + 1);
    return mapQuote(row);
  }

  function pruneOlderThan(scopeKey, beforeMs) {
    ensureSchema();
    const db = getDatabase();
    const info = db
      .prepare(
        `DELETE FROM ${ANALYTICS_SCHEMA}.fun_news_quote_quiz
         WHERE scope_key = ? AND created_at < ?`
      )
      .run(String(scopeKey || ''), Number(beforeMs) || 0);
    return info.changes || 0;
  }

  return { saveTopQuote, getLatestQuote, pruneOlderThan };
}
