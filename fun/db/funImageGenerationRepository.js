import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';

const ANALYTICS_SCHEMA = 'analytics';

/**
 * Repositorio de geracoes de imagem (API /v1/images/generations).
 *
 * Contagem GLOBAL (todos os grupos) por date_str (timezone America/Sao_Paulo).
 * Limite padrao: 25 imagens/dia. Reset automatico ao virar o dia (00h SP).
 *
 * @param {object} deps
 * @param {() => import('better-sqlite3').Database} [deps.getDatabase]
 */
export function createFunImageGenerationRepository({ getDatabase = getDb } = {}) {
  function ensureSchema() {
    applyFunSchema(getDatabase());
  }

  function mapRow(row) {
    if (!row) return null;
    return {
      id: Number(row.id) || 0,
      scopeKey: String(row.scope_key || ''),
      userJid: String(row.user_jid || ''),
      prompt: String(row.prompt || ''),
      command: String(row.command || ''),
      imageUrl: String(row.image_url || ''),
      created_at: Number(row.created_at) || 0,
      dateStr: String(row.date_str || ''),
    };
  }

  /** Conta geracoes globais (todos os escopos) para a data fornecida. */
  function countByDate(dateStr) {
    ensureSchema();
    const db = getDatabase();
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n FROM ${ANALYTICS_SCHEMA}.fun_image_generations
         WHERE date_str = ?`
      )
      .get(String(dateStr || ''));
    return Number(row?.n || 0);
  }

  /**
   * Registra uma geracao. Retorna { id, used, remaining } ou null em falha.
   * Nao valida limite aqui — a regra de quota fica no servico (atomico).
   */
  function register({ scopeKey, userJid, prompt, command, imageUrl, dateStr, now = Date.now() }) {
    ensureSchema();
    const db = getDatabase();
    const info = db
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_image_generations
            (scope_key, user_jid, prompt, command, image_url, created_at, date_str)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        String(scopeKey || ''),
        String(userJid || ''),
        String(prompt || ''),
        String(command || ''),
        String(imageUrl || ''),
        Number(now) || Date.now(),
        String(dateStr || '')
      );
    if (!info || info.changes === 0) return null;
    return { id: Number(info.lastInsertRowid || 0), used: 0, remaining: 0 };
  }

  function listByDate(dateStr, limit = 100) {
    ensureSchema();
    const db = getDatabase();
    const rows = db
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_image_generations
         WHERE date_str = ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(String(dateStr || ''), Math.max(1, Math.min(1000, Number(limit) || 100)));
    return rows.map(mapRow);
  }

  function pruneBefore(beforeMs) {
    ensureSchema();
    const db = getDatabase();
    const info = db
      .prepare(
        `DELETE FROM ${ANALYTICS_SCHEMA}.fun_image_generations WHERE created_at < ?`
      )
      .run(Number(beforeMs) || 0);
    return Number(info?.changes || 0);
  }

  return {
    countByDate,
    register,
    listByDate,
    pruneBefore,
  };
}

export default createFunImageGenerationRepository;
