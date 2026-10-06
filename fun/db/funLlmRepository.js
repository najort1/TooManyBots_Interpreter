import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';

const ANALYTICS_SCHEMA = 'analytics';

/**
 * Trunca texto com segurança sem estourar limite do SQLite.
 */
function sanitizePreview(text, maxLen = 300) {
  if (text == null) return '';
  const s = String(text)
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen)}...`;
}

/**
 * Estima custo em USD baseado em taxas aproximadas de mercado por 1M tokens.
 */
function estimateCostUsd(model, promptTokens, completionTokens) {
  const m = String(model || '').toLowerCase();
  const p = Math.max(0, Number(promptTokens) || 0);
  const c = Math.max(0, Number(completionTokens) || 0);

  let pRate = 0.15; // $/1M prompt
  let cRate = 0.60; // $/1M completion

  if (m.includes('gpt-4o-mini')) {
    pRate = 0.15;
    cRate = 0.60;
  } else if (m.includes('gpt-4o')) {
    pRate = 2.50;
    cRate = 10.00;
  } else if (m.includes('claude-3-5') || m.includes('sonnet')) {
    pRate = 3.00;
    cRate = 15.00;
  } else if (m.includes('deepseek')) {
    pRate = 0.14;
    cRate = 0.28;
  } else if (m.includes('bot-zap') || m.includes('local') || m.includes('gemma') || m.includes('llama') || m.includes('qwen')) {
    // Modelos locais ou proxys self-hosted (custo nominal zero de API externa)
    pRate = 0.0;
    cRate = 0.0;
  }

  const cost = (p * pRate + c * cRate) / 1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

/**
 * Factory do repositório de telemetria e métricas de LLM.
 *
 * @param {object} [deps]
 * @param {() => import('better-sqlite3').Database} [deps.getDatabase]
 */
export function createFunLlmRepository({ getDatabase = getDb } = {}) {
  function ensureSchema() {
    applyFunSchema(getDatabase());
  }

  /**
   * Registra uma chamada de LLM ou fallback no banco de dados.
   */
  function recordCall({
    createdAt = Date.now(),
    scopeKey = '',
    userJid = '',
    task = 'unknown',
    provider = 'zen',
    model = 'bot-zap',
    status = 'success',
    promptTokens = 0,
    completionTokens = 0,
    totalTokens = 0,
    durationMs = 0,
    promptPreview = '',
    responsePreview = '',
    errorMessage = '',
    costEstimated = null,
  } = {}) {
    ensureSchema();
    const db = getDatabase();

    const pTokens = Math.max(0, Math.floor(Number(promptTokens) || 0));
    const cTokens = Math.max(0, Math.floor(Number(completionTokens) || 0));
    const tTokens = Math.max(pTokens + cTokens, Math.floor(Number(totalTokens) || 0));
    const durMs = Math.max(0, Math.floor(Number(durationMs) || 0));
    const cost = costEstimated !== null && Number.isFinite(Number(costEstimated))
      ? Number(costEstimated)
      : estimateCostUsd(model, pTokens, cTokens);

    const stmt = db.prepare(`
      INSERT INTO ${ANALYTICS_SCHEMA}.fun_llm_calls (
        created_at, scope_key, user_jid, task, provider, model,
        status, prompt_tokens, completion_tokens, total_tokens,
        duration_ms, prompt_preview, response_preview, error_message, cost_estimated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      Number(createdAt) || Date.now(),
      String(scopeKey || '').trim(),
      String(userJid || '').trim(),
      String(task || 'unknown').trim(),
      String(provider || 'zen').trim(),
      String(model || 'bot-zap').trim(),
      String(status || 'success').trim(),
      pTokens,
      cTokens,
      tTokens,
      durMs,
      sanitizePreview(promptPreview),
      sanitizePreview(responsePreview),
      sanitizePreview(errorMessage),
      cost
    );

    return {
      id: Number(result.lastInsertRowid),
      ok: true,
    };
  }

  /**
   * Obtém agregação completa de métricas de LLM para o dashboard.
   *
   * @param {object} [options]
   * @param {string} [options.scopeKey] - Filtrar por grupo específico
   * @param {number} [options.fromTimestamp] - Timestamp inicial em ms
   * @param {number} [options.toTimestamp] - Timestamp final em ms
   * @param {number} [options.limitRecent] - Quantidade de registros recentes
   */
  function getStats({
    scopeKey = '',
    fromTimestamp = 0,
    toTimestamp = 0,
    limitRecent = 50,
  } = {}) {
    ensureSchema();
    const db = getDatabase();

    const whereClauses = [];
    const params = [];

    if (scopeKey && String(scopeKey).trim()) {
      whereClauses.push('scope_key = ?');
      params.push(String(scopeKey).trim());
    }

    if (fromTimestamp && Number(fromTimestamp) > 0) {
      whereClauses.push('created_at >= ?');
      params.push(Number(fromTimestamp));
    }

    if (toTimestamp && Number(toTimestamp) > 0) {
      whereClauses.push('created_at <= ?');
      params.push(Number(toTimestamp));
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // 1. Resumo Geral (KPIs)
    const summaryRow = db.prepare(`
      SELECT
        COUNT(*) as total_calls,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful_calls,
        SUM(CASE WHEN status IN ('error', 'timeout') THEN 1 ELSE 0 END) as error_calls,
        SUM(CASE WHEN status = 'fallback' OR provider LIKE 'template%' THEN 1 ELSE 0 END) as fallback_calls,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
        COALESCE(SUM(completion_tokens), 0) as completion_tokens,
        COALESCE(AVG(CASE WHEN duration_ms > 0 THEN duration_ms ELSE NULL END), 0) as avg_duration_ms,
        COALESCE(SUM(duration_ms), 0) as total_duration_ms,
        COALESCE(SUM(cost_estimated), 0.0) as estimated_cost_usd
      FROM ${ANALYTICS_SCHEMA}.fun_llm_calls
      ${whereSql}
    `).get(...params) || {};

    const totalCalls = Number(summaryRow.total_calls) || 0;
    const successfulCalls = Number(summaryRow.successful_calls) || 0;
    const errorCalls = Number(summaryRow.error_calls) || 0;
    const fallbackCalls = Number(summaryRow.fallback_calls) || 0;
    const totalTokens = Number(summaryRow.total_tokens) || 0;
    const promptTokens = Number(summaryRow.prompt_tokens) || 0;
    const completionTokens = Number(summaryRow.completion_tokens) || 0;
    const avgDurationMs = Math.round(Number(summaryRow.avg_duration_ms) || 0);
    const totalDurationMs = Number(summaryRow.total_duration_ms) || 0;
    const estimatedCostUsd = Math.round((Number(summaryRow.estimated_cost_usd) || 0) * 10000) / 10000;

    // Percentil 95 de latência (método de posto mais próximo / Nearest Rank)
    let p95DurationMs = avgDurationMs;
    if (totalCalls > 0) {
      const p95Rank = Math.max(1, Math.min(totalCalls, Math.ceil(totalCalls * 0.95)));
      const p95Offset = p95Rank - 1;
      const p95Row = db.prepare(`
        SELECT duration_ms FROM ${ANALYTICS_SCHEMA}.fun_llm_calls
        ${whereSql}
        ORDER BY duration_ms ASC
        LIMIT 1 OFFSET ?
      `).get(...params, p95Offset);
      if (p95Row?.duration_ms !== undefined && p95Row?.duration_ms !== null) {
        p95DurationMs = Number(p95Row.duration_ms);
      }
    }

    const summary = {
      totalCalls,
      successfulCalls,
      errorCalls,
      fallbackCalls,
      successRate: totalCalls > 0 ? Math.round((successfulCalls / totalCalls) * 1000) / 1000 : 1,
      fallbackRate: totalCalls > 0 ? Math.round((fallbackCalls / totalCalls) * 1000) / 1000 : 0,
      totalTokens,
      promptTokens,
      completionTokens,
      avgTokensPerCall: totalCalls > 0 ? Math.round(totalTokens / totalCalls) : 0,
      avgDurationMs,
      p95DurationMs,
      totalDurationMs,
      estimatedCostUsd,
    };

    // 2. Histórico Diário (Série Temporal)
    const dailyRows = db.prepare(`
      SELECT
        strftime('%Y-%m-%d', datetime(created_at / 1000, 'unixepoch', '-3 hours')) as date,
        COUNT(*) as calls,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success,
        SUM(CASE WHEN status IN ('error', 'timeout') THEN 1 ELSE 0 END) as errors,
        SUM(CASE WHEN status = 'fallback' OR provider LIKE 'template%' THEN 1 ELSE 0 END) as fallbacks,
        COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
        COALESCE(SUM(completion_tokens), 0) as completion_tokens,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COALESCE(AVG(CASE WHEN duration_ms > 0 THEN duration_ms ELSE NULL END), 0) as avg_duration_ms
      FROM ${ANALYTICS_SCHEMA}.fun_llm_calls
      ${whereSql}
      GROUP BY date
      ORDER BY date ASC
    `).all(...params);

    const daily = dailyRows.map((r) => ({
      date: String(r.date || ''),
      calls: Number(r.calls) || 0,
      success: Number(r.success) || 0,
      errors: Number(r.errors) || 0,
      fallbacks: Number(r.fallbacks) || 0,
      promptTokens: Number(r.prompt_tokens) || 0,
      completionTokens: Number(r.completion_tokens) || 0,
      totalTokens: Number(r.total_tokens) || 0,
      avgDurationMs: Math.round(Number(r.avg_duration_ms) || 0),
    }));

    // 3. Breakdown por Tarefa / Função (Qual função mais chama IA)
    const taskRows = db.prepare(`
      SELECT
        task,
        COUNT(*) as calls,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
        COALESCE(SUM(completion_tokens), 0) as completion_tokens,
        COALESCE(AVG(CASE WHEN duration_ms > 0 THEN duration_ms ELSE NULL END), 0) as avg_duration_ms,
        SUM(CASE WHEN status IN ('error', 'timeout') THEN 1 ELSE 0 END) as errors
      FROM ${ANALYTICS_SCHEMA}.fun_llm_calls
      ${whereSql}
      GROUP BY task
      ORDER BY calls DESC
      LIMIT 25
    `).all(...params);

    const byTask = taskRows.map((r) => {
      const calls = Number(r.calls) || 0;
      return {
        task: String(r.task || 'unknown'),
        calls,
        totalTokens: Number(r.total_tokens) || 0,
        promptTokens: Number(r.prompt_tokens) || 0,
        completionTokens: Number(r.completion_tokens) || 0,
        avgDurationMs: Math.round(Number(r.avg_duration_ms) || 0),
        errors: Number(r.errors) || 0,
        percentage: totalCalls > 0 ? Math.round((calls / totalCalls) * 1000) / 10 : 0,
      };
    });

    // 4. Breakdown por Provedor (Zen vs Ollama vs Template)
    const providerRows = db.prepare(`
      SELECT
        provider,
        COUNT(*) as calls,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COALESCE(AVG(CASE WHEN duration_ms > 0 THEN duration_ms ELSE NULL END), 0) as avg_duration_ms
      FROM ${ANALYTICS_SCHEMA}.fun_llm_calls
      ${whereSql}
      GROUP BY provider
      ORDER BY calls DESC
    `).all(...params);

    const byProvider = providerRows.map((r) => {
      const calls = Number(r.calls) || 0;
      return {
        provider: String(r.provider || 'unknown'),
        calls,
        totalTokens: Number(r.total_tokens) || 0,
        avgDurationMs: Math.round(Number(r.avg_duration_ms) || 0),
        percentage: totalCalls > 0 ? Math.round((calls / totalCalls) * 1000) / 10 : 0,
      };
    });

    // 5. Breakdown por Modelo
    const modelRows = db.prepare(`
      SELECT
        model,
        COUNT(*) as calls,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COALESCE(AVG(CASE WHEN duration_ms > 0 THEN duration_ms ELSE NULL END), 0) as avg_duration_ms
      FROM ${ANALYTICS_SCHEMA}.fun_llm_calls
      ${whereSql}
      GROUP BY model
      ORDER BY calls DESC
    `).all(...params);

    const byModel = modelRows.map((r) => {
      const calls = Number(r.calls) || 0;
      return {
        model: String(r.model || 'unknown'),
        calls,
        totalTokens: Number(r.total_tokens) || 0,
        avgDurationMs: Math.round(Number(r.avg_duration_ms) || 0),
        percentage: totalCalls > 0 ? Math.round((calls / totalCalls) * 1000) / 10 : 0,
      };
    });

    // 6. Distribuição Horária (0h - 23h: Horários de pico)
    const hourRows = db.prepare(`
      SELECT
        CAST(strftime('%H', datetime(created_at / 1000, 'unixepoch', '-3 hours')) AS INTEGER) as hour,
        COUNT(*) as calls,
        COALESCE(AVG(CASE WHEN duration_ms > 0 THEN duration_ms ELSE NULL END), 0) as avg_duration_ms
      FROM ${ANALYTICS_SCHEMA}.fun_llm_calls
      ${whereSql}
      GROUP BY hour
      ORDER BY hour ASC
    `).all(...params);

    const hourMap = new Map();
    for (const r of hourRows) {
      hourMap.set(Number(r.hour), {
        calls: Number(r.calls) || 0,
        avgDurationMs: Math.round(Number(r.avg_duration_ms) || 0),
      });
    }

    const byHour = Array.from({ length: 24 }, (_, h) => {
      const data = hourMap.get(h) || { calls: 0, avgDurationMs: 0 };
      return {
        hour: h,
        calls: data.calls,
        avgDurationMs: data.avgDurationMs,
      };
    });

    // 7. Consumo por Grupo / Scope
    const groupWhereSql = whereClauses.length > 0
      ? `WHERE ${whereClauses.join(' AND ')} AND scope_key != ''`
      : `WHERE scope_key != ''`;

    const groupRows = db.prepare(`
      SELECT
        scope_key,
        COUNT(*) as calls,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COALESCE(AVG(CASE WHEN duration_ms > 0 THEN duration_ms ELSE NULL END), 0) as avg_duration_ms
      FROM ${ANALYTICS_SCHEMA}.fun_llm_calls
      ${groupWhereSql}
      GROUP BY scope_key
      ORDER BY calls DESC
      LIMIT 15
    `).all(...params);

    const byGroup = groupRows.map((r) => ({
      scopeKey: String(r.scope_key || ''),
      calls: Number(r.calls) || 0,
      totalTokens: Number(r.total_tokens) || 0,
      avgDurationMs: Math.round(Number(r.avg_duration_ms) || 0),
    }));

    // 8. Top Usuários
    const userWhereSql = whereClauses.length > 0
      ? `WHERE ${whereClauses.join(' AND ')} AND user_jid != ''`
      : `WHERE user_jid != ''`;

    const userRows = db.prepare(`
      SELECT
        user_jid,
        COUNT(*) as calls,
        COALESCE(SUM(total_tokens), 0) as total_tokens
      FROM ${ANALYTICS_SCHEMA}.fun_llm_calls
      ${userWhereSql}
      GROUP BY user_jid
      ORDER BY calls DESC
      LIMIT 10
    `).all(...params);

    const topUsers = userRows.map((r) => ({
      userJid: String(r.user_jid || ''),
      calls: Number(r.calls) || 0,
      totalTokens: Number(r.total_tokens) || 0,
    }));

    // 9. Chamadas Recentes (Audit Trail)
    const recentLimit = Math.max(5, Math.min(200, Number(limitRecent) || 50));
    const recentRows = db.prepare(`
      SELECT
        id, created_at, scope_key, user_jid, task, provider,
        model, status, prompt_tokens, completion_tokens, total_tokens,
        duration_ms, prompt_preview, response_preview, error_message, cost_estimated
      FROM ${ANALYTICS_SCHEMA}.fun_llm_calls
      ${whereSql}
      ORDER BY created_at DESC
      LIMIT ?
    `).all(...params, recentLimit);

    const recentCalls = recentRows.map((r) => ({
      id: Number(r.id),
      createdAt: Number(r.created_at),
      scopeKey: String(r.scope_key || ''),
      userJid: String(r.user_jid || ''),
      task: String(r.task || ''),
      provider: String(r.provider || ''),
      model: String(r.model || ''),
      status: String(r.status || 'success'),
      promptTokens: Number(r.prompt_tokens) || 0,
      completionTokens: Number(r.completion_tokens) || 0,
      totalTokens: Number(r.total_tokens) || 0,
      durationMs: Number(r.duration_ms) || 0,
      promptPreview: String(r.prompt_preview || ''),
      responsePreview: String(r.response_preview || ''),
      errorMessage: r.error_message ? String(r.error_message) : null,
      costEstimated: Number(r.cost_estimated) || 0,
    }));

    return {
      summary,
      daily,
      byTask,
      byProvider,
      byModel,
      byHour,
      byGroup,
      topUsers,
      recentCalls,
    };
  }

  /**
   * Remove registros mais antigos que retentionDays para manter banco rápido e limpo.
   */
  function pruneOldCalls(retentionDays = 90) {
    ensureSchema();
    const db = getDatabase();
    const thresholdMs = Date.now() - Math.max(1, Number(retentionDays) || 90) * 86_400_000;
    const res = db.prepare(`
      DELETE FROM ${ANALYTICS_SCHEMA}.fun_llm_calls
      WHERE created_at < ?
    `).run(thresholdMs);
    return {
      deleted: res.changes,
    };
  }

  return {
    recordCall,
    getStats,
    pruneOldCalls,
  };
}
