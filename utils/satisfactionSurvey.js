import { normalizeBoolean, normalizeInt } from './normalization.js';

/**
 * Normalizes the survey configuration while keeping backward compatibility
 * with the legacy boolean `sendSatisfactionSurvey` shape.
 *
 * @param {unknown} rawSurvey
 * @param {{ legacyScaleMax?: unknown }} [options={}]
 * @returns {{
 *   enabled: boolean,
 *   questionType: string,
 *   scale: number,
 *   timeoutMinutes: number,
 *   thankYouMessage: string
 * }}
 */
export function normalizeSatisfactionSurveyConfig(rawSurvey, options = {}) {
  const legacyScaleMax = normalizeInt(options.legacyScaleMax, 5, {
    min: 1,
    max: 10,
    rounding: 'floor',
  });

  const defaults = {
    enabled: false,
    questionType: 'rating-scale',
    scale: legacyScaleMax,
    timeoutMinutes: 5,
    thankYouMessage: 'Obrigado pelo seu feedback!',
  };

  if (typeof rawSurvey === 'boolean') {
    return {
      ...defaults,
      enabled: rawSurvey,
    };
  }

  if (!rawSurvey || typeof rawSurvey !== 'object' || Array.isArray(rawSurvey)) {
    return defaults;
  }

  const survey = /** @type {Record<string, unknown>} */ (rawSurvey);
  return {
    enabled: normalizeBoolean(survey.enabled, defaults.enabled),
    questionType: String(survey.questionType ?? defaults.questionType).trim().toLowerCase() || defaults.questionType,
    scale: normalizeInt(survey.scale, defaults.scale, { min: 1, max: 10, rounding: 'floor' }),
    timeoutMinutes: normalizeInt(survey.timeoutMinutes, defaults.timeoutMinutes, {
      min: 0,
      max: 24 * 60,
      rounding: 'floor',
    }),
    thankYouMessage: String(survey.thankYouMessage ?? defaults.thankYouMessage).trim() || defaults.thankYouMessage,
  };
}

/**
 * Builds a default survey question text according to the configured type.
 *
 * @param {{
 *   questionType?: string,
 *   scale?: number
 * }} surveyConfig
 * @returns {string}
 */
export function buildSatisfactionSurveyQuestion(surveyConfig = {}) {
  const questionType = String(surveyConfig.questionType ?? 'rating-scale').trim().toLowerCase();
  const scale = normalizeInt(surveyConfig.scale, 5, { min: 1, max: 10, rounding: 'floor' });

  if (questionType === 'nps') {
    return `De 0 a ${scale}, qual a chance de nos recomendar? Responda apenas com um numero.`;
  }

  return `De 1 a ${scale}, como voce avalia seu atendimento? Responda apenas com um numero.`;
}

/**
 * Parses a numeric satisfaction answer and validates scale bounds.
 *
 * @param {unknown} message
 * @param {{ scale?: number, min?: number }} options
 * @returns {{ valid: true, value: number } | { valid: false, reason: string }}
 */
export function parseSatisfactionSurveyResponse(message, { scale = 5, min = 1 } = {}) {
  const normalizedScale = normalizeInt(scale, 5, { min: 1, max: 10, rounding: 'floor' });
  const normalizedMin = normalizeInt(min, 1, { min: 0, max: normalizedScale, rounding: 'floor' });
  const trimmed = String(message ?? '').trim();

  if (!trimmed) {
    return { valid: false, reason: 'empty' };
  }

  if (!/^-?\d+$/.test(trimmed)) {
    return { valid: false, reason: 'not-integer' };
  }

  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return { valid: false, reason: 'nan' };
  }

  if (value < normalizedMin || value > normalizedScale) {
    return { valid: false, reason: 'out-of-range' };
  }

  return { valid: true, value };
}
