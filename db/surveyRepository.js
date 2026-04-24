import { randomUUID } from 'node:crypto';
import { getDb } from './context.js';

const ANALYTICS_SCHEMA = 'analytics';

const ALLOWED_TIME_BUCKETS = new Set(['hour', 'day', 'week', 'month']);

const CACHE_TTL_BY_BUCKET_MS = {
  hour: 15 * 60 * 1000,
  day: 60 * 60 * 1000,
  week: 6 * 60 * 60 * 1000,
  month: 12 * 60 * 60 * 1000,
};

function toText(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function toOptionalText(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function toBooleanInt(value, fallback = 0) {
  if (value === true) return 1;
  if (value === false) return 0;
  if (value == null) return fallback;
  return String(value).trim().toLowerCase() === 'true' ? 1 : 0;
}

function toNumberOrNull(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeTimeBucket(value) {
  const bucket = toText(value, 'day').toLowerCase();
  return ALLOWED_TIME_BUCKETS.has(bucket) ? bucket : 'day';
}

function normalizeUnixMs(value, fallback = Date.now()) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function normalizeSurveyTypeDefinitionRow(row) {
  if (!row) return null;
  let schema = {};
  try {
    schema = JSON.parse(String(row.schema_json || '{}'));
  } catch {
    schema = {};
  }

  return {
    typeId: toText(row.type_id),
    name: toText(row.name),
    schema,
    isActive: Number(row.is_active) === 1,
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
  };
}

function normalizeSurveyResponseRow(row) {
  let choiceIds = [];
  try {
    const parsed = JSON.parse(String(row.choice_ids || '[]'));
    if (Array.isArray(parsed)) {
      choiceIds = parsed.map(item => toText(item)).filter(Boolean);
    }
  } catch {
    choiceIds = [];
  }

  return {
    responseId: toText(row.response_id),
    instanceId: toText(row.instance_id),
    questionId: toText(row.question_id),
    questionType: toText(row.question_type),
    numericValue: row.numeric_value == null ? null : Number(row.numeric_value),
    textValue: toText(row.text_value),
    choiceId: toText(row.choice_id),
    choiceIds,
    respondedAt: Number(row.responded_at) || 0,
  };
}

function normalizeSurveyInstanceRow(row) {
  return {
    instanceId: toText(row.instance_id),
    surveyTypeId: toText(row.survey_type_id),
    flowPath: toText(row.flow_path),
    blockId: toText(row.block_id),
    sessionId: toText(row.session_id),
    jid: toText(row.jid),
    startedAt: Number(row.started_at) || 0,
    completedAt: row.completed_at == null ? null : Number(row.completed_at),
    abandonedAt: row.abandoned_at == null ? null : Number(row.abandoned_at),
    abandonmentReason: toText(row.abandonment_reason),
    conversationContext: toText(row.conversation_context),
  };
}

function buildInstanceWhereClause(filters = {}, alias = 'si') {
  const where = [];
  const params = [];

  const typeId = toText(filters.typeId);
  if (typeId) {
    where.push(`${alias}.survey_type_id = ?`);
    params.push(typeId);
  }

  const flowPath = toText(filters.flowPath);
  if (flowPath) {
    where.push(`${alias}.flow_path = ?`);
    params.push(flowPath);
  }

  const blockId = toText(filters.blockId);
  if (blockId) {
    where.push(`${alias}.block_id = ?`);
    params.push(blockId);
  }

  const fromTs = toNumberOrNull(filters.from);
  if (fromTs != null) {
    where.push(`${alias}.started_at >= ?`);
    params.push(fromTs);
  }

  const toTs = toNumberOrNull(filters.to);
  if (toTs != null) {
    where.push(`${alias}.started_at <= ?`);
    params.push(toTs);
  }

  const status = toText(filters.status).toLowerCase();
  if (status === 'completed') {
    where.push(`${alias}.completed_at IS NOT NULL`);
  } else if (status === 'abandoned') {
    where.push(`${alias}.abandoned_at IS NOT NULL`);
  } else if (status === 'pending') {
    where.push(`${alias}.completed_at IS NULL AND ${alias}.abandoned_at IS NULL`);
  }

  if (where.length === 0) {
    return { clause: '', params };
  }

  return {
    clause: `WHERE ${where.join(' AND ')}`,
    params,
  };
}

function bucketExpression(bucket, alias = 'si') {
  const source = `datetime(${alias}.started_at / 1000, 'unixepoch', 'localtime')`;
  if (bucket === 'hour') return `strftime('%Y-%m-%d %H:00', ${source})`;
  if (bucket === 'week') return `strftime('%Y-W%W', ${source})`;
  if (bucket === 'month') return `strftime('%Y-%m', ${source})`;
  return `strftime('%Y-%m-%d', ${source})`;
}

function ttlForBucket(bucket) {
  return CACHE_TTL_BY_BUCKET_MS[bucket] ?? CACHE_TTL_BY_BUCKET_MS.day;
}

export function listSurveyTypeDefinitions({ activeOnly = false } = {}) {
  const db = getDb();
  const sql = activeOnly
    ? `SELECT type_id, name, schema_json, is_active, created_at, updated_at
       FROM ${ANALYTICS_SCHEMA}.survey_type_definitions
       WHERE is_active = 1
       ORDER BY name ASC`
    : `SELECT type_id, name, schema_json, is_active, created_at, updated_at
       FROM ${ANALYTICS_SCHEMA}.survey_type_definitions
       ORDER BY name ASC`;

  const rows = db.prepare(sql).all();
  return rows.map(normalizeSurveyTypeDefinitionRow).filter(Boolean);
}

export function getSurveyTypeDefinitionById(typeId) {
  const normalizedTypeId = toText(typeId);
  if (!normalizedTypeId) return null;
  const db = getDb();
  const row = db.prepare(
    `SELECT type_id, name, schema_json, is_active, created_at, updated_at
     FROM ${ANALYTICS_SCHEMA}.survey_type_definitions
     WHERE type_id = ?
     LIMIT 1`
  ).get(normalizedTypeId);
  return normalizeSurveyTypeDefinitionRow(row);
}

export function upsertSurveyTypeDefinition(definition = {}) {
  const nowTs = Date.now();
  const typeId = toText(definition.typeId);
  const name = toText(definition.name, typeId);
  if (!typeId || !name) {
    throw new Error('typeId and name are required');
  }

  const schemaJson = JSON.stringify(definition.schema && typeof definition.schema === 'object'
    ? definition.schema
    : {});
  const isActive = toBooleanInt(definition.isActive, 1);

  const db = getDb();
  db.prepare(
    `INSERT INTO ${ANALYTICS_SCHEMA}.survey_type_definitions (
      type_id, name, schema_json, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(type_id) DO UPDATE SET
      name = excluded.name,
      schema_json = excluded.schema_json,
      is_active = excluded.is_active,
      updated_at = excluded.updated_at`
  ).run(typeId, name, schemaJson, isActive, nowTs, nowTs);

  return getSurveyTypeDefinitionById(typeId);
}

export function createSurveyInstance(payload = {}) {
  const nowTs = Date.now();
  const instanceId = toText(payload.instanceId, randomUUID());
  const surveyTypeId = toText(payload.surveyTypeId);
  const jid = toText(payload.jid);
  if (!surveyTypeId) throw new Error('surveyTypeId is required');
  if (!jid) throw new Error('jid is required');

  const db = getDb();
  db.prepare(
    `INSERT INTO ${ANALYTICS_SCHEMA}.survey_instances (
      instance_id,
      survey_type_id,
      flow_path,
      block_id,
      session_id,
      jid,
      started_at,
      completed_at,
      abandoned_at,
      abandonment_reason,
      conversation_context
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)`
  ).run(
    instanceId,
    surveyTypeId,
    toText(payload.flowPath),
    toText(payload.blockId),
    toText(payload.sessionId),
    jid,
    normalizeUnixMs(payload.startedAt, nowTs),
    toText(payload.conversationContext)
  );

  return getSurveyInstanceById(instanceId);
}

export function saveSurveyResponse(payload = {}) {
  const responseId = toText(payload.responseId, randomUUID());
  const instanceId = toText(payload.instanceId);
  const questionId = toText(payload.questionId);
  const questionType = toText(payload.questionType, 'text');

  if (!instanceId) throw new Error('instanceId is required');
  if (!questionId) throw new Error('questionId is required');

  const choiceIds = Array.isArray(payload.choiceIds)
    ? payload.choiceIds.map(item => toText(item)).filter(Boolean)
    : [];

  const db = getDb();
  db.prepare(
    `INSERT INTO ${ANALYTICS_SCHEMA}.survey_responses (
      response_id,
      instance_id,
      question_id,
      question_type,
      numeric_value,
      text_value,
      choice_id,
      choice_ids,
      responded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    responseId,
    instanceId,
    questionId,
    questionType,
    toNumberOrNull(payload.numericValue),
    toOptionalText(payload.textValue),
    toOptionalText(payload.choiceId),
    choiceIds.length > 0 ? JSON.stringify(choiceIds) : null,
    normalizeUnixMs(payload.respondedAt)
  );

  return responseId;
}

export function listSurveyResponsesByInstance(instanceId) {
  const normalizedInstanceId = toText(instanceId);
  if (!normalizedInstanceId) return [];
  const db = getDb();
  const rows = db.prepare(
    `SELECT
      response_id,
      instance_id,
      question_id,
      question_type,
      numeric_value,
      text_value,
      choice_id,
      choice_ids,
      responded_at
     FROM ${ANALYTICS_SCHEMA}.survey_responses
     WHERE instance_id = ?
     ORDER BY responded_at ASC`
  ).all(normalizedInstanceId);
  return rows.map(normalizeSurveyResponseRow);
}

export function getSurveyInstanceById(instanceId) {
  const normalizedInstanceId = toText(instanceId);
  if (!normalizedInstanceId) return null;

  const db = getDb();
  const row = db.prepare(
    `SELECT
      instance_id,
      survey_type_id,
      flow_path,
      block_id,
      session_id,
      jid,
      started_at,
      completed_at,
      abandoned_at,
      abandonment_reason,
      conversation_context
     FROM ${ANALYTICS_SCHEMA}.survey_instances
     WHERE instance_id = ?
     LIMIT 1`
  ).get(normalizedInstanceId);

  if (!row) return null;
  const instance = normalizeSurveyInstanceRow(row);
  return {
    ...instance,
    responses: listSurveyResponsesByInstance(normalizedInstanceId),
  };
}

export function listSurveyInstances(filters = {}) {
  const db = getDb();
  const { clause, params } = buildInstanceWhereClause(filters, 'si');
  const limit = Math.max(1, Math.min(1000, Number(filters.limit) || 200));
  const offset = Math.max(0, Number(filters.offset) || 0);

  const rows = db.prepare(
    `SELECT
      si.instance_id,
      si.survey_type_id,
      si.flow_path,
      si.block_id,
      si.session_id,
      si.jid,
      si.started_at,
      si.completed_at,
      si.abandoned_at,
      si.abandonment_reason,
      si.conversation_context
     FROM ${ANALYTICS_SCHEMA}.survey_instances si
     ${clause}
     ORDER BY si.started_at DESC
     LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  const total = Number(db.prepare(
    `SELECT COUNT(*) AS total
     FROM ${ANALYTICS_SCHEMA}.survey_instances si
     ${clause}`
  ).get(...params)?.total ?? 0) || 0;

  return {
    total,
    items: rows.map(normalizeSurveyInstanceRow),
    limit,
    offset,
  };
}

export function markSurveyInstanceCompleted({ instanceId, completedAt = Date.now() } = {}) {
  const normalizedInstanceId = toText(instanceId);
  if (!normalizedInstanceId) return null;

  const db = getDb();
  db.prepare(
    `UPDATE ${ANALYTICS_SCHEMA}.survey_instances
     SET completed_at = ?,
         abandoned_at = NULL,
         abandonment_reason = NULL
     WHERE instance_id = ?`
  ).run(normalizeUnixMs(completedAt), normalizedInstanceId);

  return getSurveyInstanceById(normalizedInstanceId);
}

export function markSurveyInstanceAbandoned({
  instanceId,
  abandonedAt = Date.now(),
  abandonmentReason = 'timeout',
} = {}) {
  const normalizedInstanceId = toText(instanceId);
  if (!normalizedInstanceId) return null;

  const db = getDb();
  db.prepare(
    `UPDATE ${ANALYTICS_SCHEMA}.survey_instances
     SET abandoned_at = ?,
         abandonment_reason = ?,
         completed_at = NULL
     WHERE instance_id = ?`
  ).run(normalizeUnixMs(abandonedAt), toText(abandonmentReason), normalizedInstanceId);

  return getSurveyInstanceById(normalizedInstanceId);
}

export function getSurveyMetricsOverview(filters = {}) {
  const db = getDb();
  const { clause, params } = buildInstanceWhereClause(filters, 'si');

  const base = db.prepare(
    `SELECT
      COUNT(*) AS total_instances,
      SUM(CASE WHEN si.completed_at IS NOT NULL THEN 1 ELSE 0 END) AS completed_instances,
      SUM(CASE WHEN si.abandoned_at IS NOT NULL THEN 1 ELSE 0 END) AS abandoned_instances,
      AVG(CASE WHEN si.completed_at IS NOT NULL THEN (si.completed_at - si.started_at) / 1000.0 ELSE NULL END) AS avg_duration_seconds
     FROM ${ANALYTICS_SCHEMA}.survey_instances si
     ${clause}`
  ).get(...params);

  const numeric = db.prepare(
    `SELECT
      COUNT(*) AS numeric_responses,
      AVG(sr.numeric_value) AS avg_score,
      SUM(CASE WHEN sr.numeric_value >= 9 THEN 1 ELSE 0 END) AS promoters,
      SUM(CASE WHEN sr.numeric_value <= 6 THEN 1 ELSE 0 END) AS detractors,
      SUM(CASE WHEN sr.numeric_value >= 4 THEN 1 ELSE 0 END) AS satisfied,
      SUM(CASE WHEN sr.numeric_value <= 2 THEN 1 ELSE 0 END) AS low_effort
     FROM ${ANALYTICS_SCHEMA}.survey_responses sr
     INNER JOIN ${ANALYTICS_SCHEMA}.survey_instances si
       ON si.instance_id = sr.instance_id
     ${clause}
       ${clause ? 'AND' : 'WHERE'} sr.numeric_value IS NOT NULL`
  ).get(...params);

  const totalInstances = Number(base?.total_instances) || 0;
  const completedInstances = Number(base?.completed_instances) || 0;
  const abandonedInstances = Number(base?.abandoned_instances) || 0;
  const numericResponses = Number(numeric?.numeric_responses) || 0;

  const completionRate = totalInstances > 0
    ? Number((completedInstances / totalInstances).toFixed(4))
    : 0;
  const abandonmentRate = totalInstances > 0
    ? Number((abandonedInstances / totalInstances).toFixed(4))
    : 0;

  const promoterRate = numericResponses > 0
    ? Number((Number(numeric?.promoters || 0) / numericResponses).toFixed(4))
    : 0;
  const detractorRate = numericResponses > 0
    ? Number((Number(numeric?.detractors || 0) / numericResponses).toFixed(4))
    : 0;

  return {
    totalInstances,
    completedInstances,
    abandonedInstances,
    completionRate,
    abandonmentRate,
    avgDurationSeconds: Number(base?.avg_duration_seconds || 0),
    numericResponses,
    avgScore: Number(numeric?.avg_score || 0),
    npsScore: Number(((promoterRate - detractorRate) * 100).toFixed(2)),
    csatRate: numericResponses > 0
      ? Number((Number(numeric?.satisfied || 0) / numericResponses).toFixed(4))
      : 0,
    lowEffortRate: numericResponses > 0
      ? Number((Number(numeric?.low_effort || 0) / numericResponses).toFixed(4))
      : 0,
    sampleSize: numericResponses,
  };
}

export function listSurveyTrend(filters = {}) {
  const db = getDb();
  const bucket = normalizeTimeBucket(filters.granularity || filters.timeBucket || 'day');
  const bucketSql = bucketExpression(bucket, 'si');
  const { clause, params } = buildInstanceWhereClause(filters, 'si');

  const counts = db.prepare(
    `SELECT
      ${bucketSql} AS bucket,
      COUNT(*) AS total_instances,
      SUM(CASE WHEN si.completed_at IS NOT NULL THEN 1 ELSE 0 END) AS completed_instances,
      SUM(CASE WHEN si.abandoned_at IS NOT NULL THEN 1 ELSE 0 END) AS abandoned_instances
     FROM ${ANALYTICS_SCHEMA}.survey_instances si
     ${clause}
     GROUP BY bucket
     ORDER BY bucket ASC`
  ).all(...params);

  const scores = db.prepare(
    `SELECT
      ${bucketSql} AS bucket,
      COUNT(sr.numeric_value) AS numeric_responses,
      AVG(sr.numeric_value) AS avg_score
     FROM ${ANALYTICS_SCHEMA}.survey_instances si
     LEFT JOIN ${ANALYTICS_SCHEMA}.survey_responses sr
       ON sr.instance_id = si.instance_id
     ${clause}
     GROUP BY bucket
     ORDER BY bucket ASC`
  ).all(...params);

  const scoreByBucket = new Map(scores.map(item => [String(item.bucket), item]));
  return counts.map(item => {
    const bucketKey = String(item.bucket || '');
    const score = scoreByBucket.get(bucketKey);
    return {
      bucket: bucketKey,
      timeBucket: bucket,
      totalInstances: Number(item.total_instances) || 0,
      completedInstances: Number(item.completed_instances) || 0,
      abandonedInstances: Number(item.abandoned_instances) || 0,
      numericResponses: Number(score?.numeric_responses || 0),
      avgScore: Number(score?.avg_score || 0),
    };
  });
}

export function listSurveyDistribution(filters = {}) {
  const db = getDb();
  const { clause, params } = buildInstanceWhereClause(filters, 'si');

  const rows = db.prepare(
    `SELECT
      sr.numeric_value AS value,
      COUNT(*) AS total
     FROM ${ANALYTICS_SCHEMA}.survey_responses sr
     INNER JOIN ${ANALYTICS_SCHEMA}.survey_instances si
       ON si.instance_id = sr.instance_id
     ${clause}
       ${clause ? 'AND' : 'WHERE'} sr.numeric_value IS NOT NULL
     GROUP BY sr.numeric_value
     ORDER BY sr.numeric_value ASC`
  ).all(...params);

  return rows.map(row => ({
    value: Number(row.value) || 0,
    total: Number(row.total) || 0,
  }));
}

export function listSurveyMetricsByFlow(filters = {}) {
  const db = getDb();
  const normalizedFilters = {
    ...filters,
    flowPath: '',
  };
  const { clause, params } = buildInstanceWhereClause(normalizedFilters, 'si');

  const baseRows = db.prepare(
    `SELECT
      si.flow_path,
      COUNT(*) AS total_instances,
      SUM(CASE WHEN si.completed_at IS NOT NULL THEN 1 ELSE 0 END) AS completed_instances,
      SUM(CASE WHEN si.abandoned_at IS NOT NULL THEN 1 ELSE 0 END) AS abandoned_instances,
      AVG(CASE WHEN si.completed_at IS NOT NULL THEN (si.completed_at - si.started_at) / 1000.0 ELSE NULL END) AS avg_duration_seconds
     FROM ${ANALYTICS_SCHEMA}.survey_instances si
     ${clause}
     GROUP BY si.flow_path
     ORDER BY total_instances DESC`
  ).all(...params);

  const scoreRows = db.prepare(
    `SELECT
      si.flow_path,
      COUNT(sr.numeric_value) AS numeric_responses,
      AVG(sr.numeric_value) AS avg_score
     FROM ${ANALYTICS_SCHEMA}.survey_instances si
     LEFT JOIN ${ANALYTICS_SCHEMA}.survey_responses sr
       ON sr.instance_id = si.instance_id
     ${clause}
     GROUP BY si.flow_path`
  ).all(...params);

  const scoreByFlow = new Map(scoreRows.map(item => [toText(item.flow_path), item]));

  return baseRows.map(row => {
    const flowPath = toText(row.flow_path);
    const score = scoreByFlow.get(flowPath);
    const totalInstances = Number(row.total_instances) || 0;
    const completedInstances = Number(row.completed_instances) || 0;
    const abandonedInstances = Number(row.abandoned_instances) || 0;

    return {
      flowPath,
      totalInstances,
      completedInstances,
      abandonedInstances,
      completionRate: totalInstances > 0
        ? Number((completedInstances / totalInstances).toFixed(4))
        : 0,
      abandonmentRate: totalInstances > 0
        ? Number((abandonedInstances / totalInstances).toFixed(4))
        : 0,
      avgDurationSeconds: Number(row.avg_duration_seconds || 0),
      numericResponses: Number(score?.numeric_responses || 0),
      avgScore: Number(score?.avg_score || 0),
    };
  });
}

export function listSurveyResponsesForExport(filters = {}) {
  const db = getDb();
  const { clause, params } = buildInstanceWhereClause(filters, 'si');
  const limit = Math.max(1, Math.min(10000, Number(filters.limit) || 2000));
  const offset = Math.max(0, Number(filters.offset) || 0);

  const rows = db.prepare(
    `SELECT
      si.instance_id,
      si.survey_type_id,
      si.flow_path,
      si.block_id,
      si.session_id,
      si.jid,
      si.started_at,
      si.completed_at,
      si.abandoned_at,
      si.abandonment_reason,
      sr.response_id,
      sr.question_id,
      sr.question_type,
      sr.numeric_value,
      sr.text_value,
      sr.choice_id,
      sr.choice_ids,
      sr.responded_at
     FROM ${ANALYTICS_SCHEMA}.survey_instances si
     LEFT JOIN ${ANALYTICS_SCHEMA}.survey_responses sr
       ON sr.instance_id = si.instance_id
     ${clause}
     ORDER BY si.started_at DESC, sr.responded_at ASC
     LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  return rows.map(row => ({
    instanceId: toText(row.instance_id),
    surveyTypeId: toText(row.survey_type_id),
    flowPath: toText(row.flow_path),
    blockId: toText(row.block_id),
    sessionId: toText(row.session_id),
    jid: toText(row.jid),
    startedAt: Number(row.started_at) || 0,
    completedAt: row.completed_at == null ? null : Number(row.completed_at),
    abandonedAt: row.abandoned_at == null ? null : Number(row.abandoned_at),
    abandonmentReason: toText(row.abandonment_reason),
    responseId: toText(row.response_id),
    questionId: toText(row.question_id),
    questionType: toText(row.question_type),
    numericValue: row.numeric_value == null ? null : Number(row.numeric_value),
    textValue: toText(row.text_value),
    choiceId: toText(row.choice_id),
    choiceIds: toText(row.choice_ids),
    respondedAt: Number(row.responded_at) || 0,
  }));
}

function buildCacheEntries({
  filters,
  timeBucket,
  periodStart,
  periodEnd,
  calculatedAt,
  overview,
} = {}) {
  const scopeTypeId = toText(filters?.typeId, 'all');
  const scopeFlowPath = toText(filters?.flowPath, 'all');
  const prefix = `${scopeTypeId}:${scopeFlowPath}:${timeBucket}:${periodStart}:${periodEnd}`;

  const metrics = [
    ['total_instances', overview.totalInstances, overview.totalInstances],
    ['completed_instances', overview.completedInstances, overview.totalInstances],
    ['abandoned_instances', overview.abandonedInstances, overview.totalInstances],
    ['completion_rate', overview.completionRate, overview.totalInstances],
    ['abandonment_rate', overview.abandonmentRate, overview.totalInstances],
    ['avg_duration_seconds', overview.avgDurationSeconds, overview.completedInstances],
    ['avg_score', overview.avgScore, overview.numericResponses],
    ['nps_score', overview.npsScore, overview.numericResponses],
    ['csat_rate', overview.csatRate, overview.numericResponses],
    ['low_effort_rate', overview.lowEffortRate, overview.numericResponses],
  ];

  return metrics.map(([metricName, metricValue, sampleSize]) => ({
    cacheKey: `${prefix}:${metricName}`,
    surveyTypeId: scopeTypeId,
    flowPath: scopeFlowPath,
    timeBucket,
    periodStart,
    periodEnd,
    metricName,
    metricValue: Number(metricValue || 0),
    sampleSize: Number(sampleSize || 0),
    calculatedAt,
    expiresAt: calculatedAt + ttlForBucket(timeBucket),
  }));
}

function upsertSurveyMetricCacheEntries(entries = []) {
  if (!Array.isArray(entries) || entries.length === 0) return 0;
  const db = getDb();
  const upsert = db.prepare(
    `INSERT INTO ${ANALYTICS_SCHEMA}.survey_metrics_cache (
      cache_key,
      survey_type_id,
      flow_path,
      time_bucket,
      period_start,
      period_end,
      metric_name,
      metric_value,
      sample_size,
      calculated_at,
      expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET
      metric_value = excluded.metric_value,
      sample_size = excluded.sample_size,
      calculated_at = excluded.calculated_at,
      expires_at = excluded.expires_at`
  );

  const tx = db.transaction((items) => {
    for (const item of items) {
      upsert.run(
        item.cacheKey,
        item.surveyTypeId,
        item.flowPath,
        item.timeBucket,
        item.periodStart,
        item.periodEnd,
        item.metricName,
        item.metricValue,
        item.sampleSize,
        item.calculatedAt,
        item.expiresAt
      );
    }
  });

  tx(entries);
  return entries.length;
}

export function refreshSurveyMetricsCache({
  typeId = '',
  flowPath = '',
  from = null,
  to = null,
  timeBucket = 'day',
  force = false,
} = {}) {
  const normalizedBucket = normalizeTimeBucket(timeBucket);
  const periodStart = normalizeUnixMs(from, Date.now() - (30 * 24 * 60 * 60 * 1000));
  const periodEnd = normalizeUnixMs(to, Date.now());
  const calculatedAt = Date.now();

  const filters = {
    typeId: toText(typeId),
    flowPath: toText(flowPath),
    from: periodStart,
    to: periodEnd,
  };

  if (!force) {
    const db = getDb();
    const scopeTypeId = toText(typeId, 'all');
    const scopeFlowPath = toText(flowPath, 'all');
    const cachePrefix = `${scopeTypeId}:${scopeFlowPath}:${normalizedBucket}:${periodStart}:${periodEnd}`;
    const fresh = db.prepare(
      `SELECT COUNT(*) AS total
       FROM ${ANALYTICS_SCHEMA}.survey_metrics_cache
       WHERE cache_key LIKE ?
         AND expires_at > ?`
    ).get(`${cachePrefix}:%`, calculatedAt);
    if (Number(fresh?.total) > 0) {
      return {
        ok: true,
        fromCache: true,
        updatedEntries: 0,
        calculatedAt,
      };
    }
  }

  const overview = getSurveyMetricsOverview(filters);
  const entries = buildCacheEntries({
    filters,
    timeBucket: normalizedBucket,
    periodStart,
    periodEnd,
    calculatedAt,
    overview,
  });

  const updatedEntries = upsertSurveyMetricCacheEntries(entries);

  return {
    ok: true,
    fromCache: false,
    updatedEntries,
    calculatedAt,
    overview,
  };
}

export function updateRealtimeSurveyMetrics({
  typeId = '',
  flowPath = '',
  nowTs = Date.now(),
} = {}) {
  const date = new Date(nowTs);
  const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return refreshSurveyMetricsCache({
    typeId,
    flowPath,
    from: startOfDay,
    to: nowTs,
    timeBucket: 'day',
    force: true,
  });
}
