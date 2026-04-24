import { getDb } from './context.js';

const ANALYTICS_SCHEMA = 'analytics';
const PERIOD_UNITS = new Set(['hour', 'day', 'week', 'month', 'year']);

function toText(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function toPositiveIntOrNull(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.floor(numeric);
}

function toNonNegativeInt(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return fallback;
  return Math.floor(numeric);
}

function toBooleanInt(value, fallback = 0) {
  if (value === true) return 1;
  if (value === false) return 0;
  if (value == null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'sim', 's'].includes(normalized) ? 1 : 0;
}

function normalizePeriodUnit(value) {
  const normalized = toText(value, 'month').toLowerCase();
  return PERIOD_UNITS.has(normalized) ? normalized : 'month';
}

function periodUnitToMs(unit, value = 1) {
  const multiplier = Math.max(1, Number(value) || 1);
  if (unit === 'hour') return multiplier * 60 * 60 * 1000;
  if (unit === 'day') return multiplier * 24 * 60 * 60 * 1000;
  if (unit === 'week') return multiplier * 7 * 24 * 60 * 60 * 1000;
  if (unit === 'year') return multiplier * 365 * 24 * 60 * 60 * 1000;
  return multiplier * 30 * 24 * 60 * 60 * 1000;
}

export function normalizeSurveyFrequencyRule(input = {}) {
  const rules = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const minIntervalSeconds = rules.minIntervalSeconds != null
    ? toNonNegativeInt(rules.minIntervalSeconds, 0)
    : Math.max(0, toNonNegativeInt(rules.minIntervalDays, 0) * 24 * 60 * 60);

  return {
    maxResponsesPerUser: toPositiveIntOrNull(rules.maxResponsesPerUser ?? rules.max_responses_per_user),
    periodUnit: normalizePeriodUnit(rules.periodUnit ?? rules.period_unit),
    periodValue: Math.max(1, toNonNegativeInt(rules.periodValue ?? rules.period_value, 1)),
    minIntervalSeconds,
    skipForAdmins: Boolean(toBooleanInt(rules.skipForAdmins ?? rules.skip_for_admins, 0)),
  };
}

function normalizeRuleRow(row) {
  if (!row) return null;
  const minIntervalSeconds = toNonNegativeInt(row.min_interval_seconds, 0);
  return {
    surveyTypeId: toText(row.survey_type_id),
    maxResponsesPerUser: row.max_responses_per_user == null ? null : toPositiveIntOrNull(row.max_responses_per_user),
    periodUnit: normalizePeriodUnit(row.period_unit),
    periodValue: Math.max(1, toNonNegativeInt(row.period_value, 1)),
    minIntervalSeconds,
    minIntervalDays: Math.floor(minIntervalSeconds / (24 * 60 * 60)),
    skipForAdmins: Number(row.skip_for_admins) === 1,
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
  };
}

export function getSurveyFrequencyRule(surveyTypeId) {
  const typeId = toText(surveyTypeId);
  if (!typeId) return null;
  const db = getDb();
  const row = db.prepare(
    `SELECT survey_type_id, max_responses_per_user, period_unit, period_value,
            min_interval_seconds, skip_for_admins, created_at, updated_at
     FROM ${ANALYTICS_SCHEMA}.survey_frequency_rules
     WHERE survey_type_id = ?
     LIMIT 1`
  ).get(typeId);
  return normalizeRuleRow(row);
}

export function upsertSurveyFrequencyRule(surveyTypeId, input = {}) {
  const typeId = toText(surveyTypeId);
  if (!typeId) throw new Error('surveyTypeId is required');
  const rule = normalizeSurveyFrequencyRule(input);
  const nowTs = Date.now();
  const db = getDb();
  db.prepare(
    `INSERT INTO ${ANALYTICS_SCHEMA}.survey_frequency_rules (
      survey_type_id, max_responses_per_user, period_unit, period_value,
      min_interval_seconds, skip_for_admins, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(survey_type_id) DO UPDATE SET
      max_responses_per_user = excluded.max_responses_per_user,
      period_unit = excluded.period_unit,
      period_value = excluded.period_value,
      min_interval_seconds = excluded.min_interval_seconds,
      skip_for_admins = excluded.skip_for_admins,
      updated_at = excluded.updated_at`
  ).run(
    typeId,
    rule.maxResponsesPerUser,
    rule.periodUnit,
    rule.periodValue,
    rule.minIntervalSeconds,
    rule.skipForAdmins ? 1 : 0,
    nowTs,
    nowTs
  );
  return getSurveyFrequencyRule(typeId);
}

export function deleteSurveyFrequencyRule(surveyTypeId) {
  const typeId = toText(surveyTypeId);
  if (!typeId) return { deleted: 0 };
  const db = getDb();
  const info = db.prepare(
    `DELETE FROM ${ANALYTICS_SCHEMA}.survey_frequency_rules
     WHERE survey_type_id = ?`
  ).run(typeId);
  return { deleted: Number(info?.changes) || 0 };
}

export function recordSurveyUserResponse({
  surveyTypeId,
  jid,
  instanceId = '',
  triggerType = '',
  respondedAt = Date.now(),
} = {}) {
  const typeId = toText(surveyTypeId);
  const normalizedJid = toText(jid);
  if (!typeId || !normalizedJid) return null;
  const nowTs = Number(respondedAt) || Date.now();
  const db = getDb();
  const info = db.prepare(
    `INSERT INTO ${ANALYTICS_SCHEMA}.survey_user_response_log (
      survey_type_id, jid, instance_id, trigger_type, responded_at
    ) VALUES (?, ?, ?, ?, ?)`
  ).run(typeId, normalizedJid, toText(instanceId), toText(triggerType), nowTs);
  return {
    id: Number(info?.lastInsertRowid) || 0,
    surveyTypeId: typeId,
    jid: normalizedJid,
    instanceId: toText(instanceId),
    triggerType: toText(triggerType),
    respondedAt: nowTs,
  };
}

export function getSurveyUserResponseFrequency({
  surveyTypeId,
  jid,
  fromTs = 0,
  toTs = Date.now(),
} = {}) {
  const typeId = toText(surveyTypeId);
  const normalizedJid = toText(jid);
  if (!typeId || !normalizedJid) {
    return { count: 0, lastRespondedAt: 0 };
  }
  const db = getDb();
  const row = db.prepare(
    `SELECT COUNT(*) AS total, MAX(responded_at) AS last_responded_at
     FROM ${ANALYTICS_SCHEMA}.survey_user_response_log
     WHERE survey_type_id = ?
       AND jid = ?
       AND responded_at >= ?
       AND responded_at <= ?`
  ).get(typeId, normalizedJid, Number(fromTs) || 0, Number(toTs) || Date.now());
  return {
    count: Number(row?.total) || 0,
    lastRespondedAt: Number(row?.last_responded_at) || 0,
  };
}

export function checkSurveyFrequencyRules({
  surveyTypeId,
  jid,
  rules = null,
  nowTs = Date.now(),
  isAdmin = false,
} = {}) {
  const typeId = toText(surveyTypeId);
  const normalizedJid = toText(jid);
  if (!typeId || !normalizedJid) {
    return { allowed: false, reason: 'missing-survey-or-jid' };
  }

  const resolvedRules = rules
    ? normalizeSurveyFrequencyRule(rules)
    : normalizeSurveyFrequencyRule(getSurveyFrequencyRule(typeId) || {});

  if (resolvedRules.skipForAdmins && isAdmin) {
    return { allowed: true, reason: 'admin-bypass', rules: resolvedRules };
  }

  const periodMs = periodUnitToMs(resolvedRules.periodUnit, resolvedRules.periodValue);
  const periodStart = Math.max(0, nowTs - periodMs);
  const frequency = getSurveyUserResponseFrequency({
    surveyTypeId: typeId,
    jid: normalizedJid,
    fromTs: periodStart,
    toTs: nowTs,
  });

  if (
    resolvedRules.maxResponsesPerUser != null
    && frequency.count >= resolvedRules.maxResponsesPerUser
  ) {
    return {
      allowed: false,
      reason: 'max-responses-per-period',
      rules: resolvedRules,
      count: frequency.count,
      retryAfterMs: Math.max(0, periodStart + periodMs - nowTs),
    };
  }

  if (resolvedRules.minIntervalSeconds > 0 && frequency.lastRespondedAt > 0) {
    const nextAllowedAt = frequency.lastRespondedAt + (resolvedRules.minIntervalSeconds * 1000);
    if (nowTs < nextAllowedAt) {
      return {
        allowed: false,
        reason: 'min-interval-not-reached',
        rules: resolvedRules,
        lastRespondedAt: frequency.lastRespondedAt,
        retryAfterMs: Math.max(0, nextAllowedAt - nowTs),
      };
    }
  }

  return {
    allowed: true,
    reason: 'allowed',
    rules: resolvedRules,
    count: frequency.count,
    lastRespondedAt: frequency.lastRespondedAt,
  };
}

export function createSurveyBroadcastDispatch({
  surveyTypeId,
  actor = 'dashboard-agent',
  recipientCount = 0,
  createdAt = Date.now(),
} = {}) {
  const typeId = toText(surveyTypeId);
  if (!typeId) throw new Error('surveyTypeId is required');
  const nowTs = Number(createdAt) || Date.now();
  const db = getDb();
  const info = db.prepare(
    `INSERT INTO ${ANALYTICS_SCHEMA}.survey_broadcast_dispatches (
      survey_type_id, actor, recipient_count, sent_count, failed_count, created_at, completed_at
    ) VALUES (?, ?, ?, 0, 0, ?, NULL)`
  ).run(
    typeId,
    toText(actor, 'dashboard-agent'),
    toNonNegativeInt(recipientCount, 0),
    nowTs
  );

  return {
    id: Number(info?.lastInsertRowid) || 0,
    surveyTypeId: typeId,
    actor: toText(actor, 'dashboard-agent'),
    recipientCount: toNonNegativeInt(recipientCount, 0),
    sentCount: 0,
    failedCount: 0,
    createdAt: nowTs,
    completedAt: 0,
  };
}

export function completeSurveyBroadcastDispatch({
  id,
  sentCount = 0,
  failedCount = 0,
  completedAt = Date.now(),
} = {}) {
  const dispatchId = Math.floor(Number(id) || 0);
  if (dispatchId <= 0) return { updated: 0 };
  const nowTs = Number(completedAt) || Date.now();
  const db = getDb();
  const info = db.prepare(
    `UPDATE ${ANALYTICS_SCHEMA}.survey_broadcast_dispatches
     SET sent_count = ?, failed_count = ?, completed_at = ?
     WHERE id = ?`
  ).run(
    toNonNegativeInt(sentCount, 0),
    toNonNegativeInt(failedCount, 0),
    nowTs,
    dispatchId
  );

  return {
    updated: Number(info?.changes) || 0,
    id: dispatchId,
    sentCount: toNonNegativeInt(sentCount, 0),
    failedCount: toNonNegativeInt(failedCount, 0),
    completedAt: nowTs,
  };
}
