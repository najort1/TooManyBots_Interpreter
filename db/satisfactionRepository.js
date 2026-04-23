import { getStmts } from './context.js';

function normalizeFlowPath(flowPath = '') {
  return String(flowPath ?? '').trim();
}

function normalizeJid(jid = '') {
  return String(jid ?? '').trim();
}

/**
 * Persists a satisfaction survey outcome.
 *
 * @param {{
 *   jid: string,
 *   flowPath?: string,
 *   sessionId?: string,
 *   questionType?: string,
 *   scale?: number,
 *   rating?: number | null,
 *   timedOut?: boolean,
 *   thankYouMessage?: string,
 *   createdAt?: number,
 *   answeredAt?: number | null,
 * }} payload
 * @returns {number} inserted row id
 */
export function saveSatisfactionSurveyResponse(payload) {
  const stmts = getStmts();
  const jid = normalizeJid(payload?.jid);
  if (!jid) return 0;

  const flowPath = normalizeFlowPath(payload?.flowPath);
  const sessionId = String(payload?.sessionId ?? '').trim();
  const questionType = String(payload?.questionType ?? 'rating-scale').trim().toLowerCase() || 'rating-scale';
  const scale = Math.max(1, Math.min(10, Math.floor(Number(payload?.scale) || 5)));
  const ratingValue = payload?.rating;
  const hasRatingValue =
    ratingValue !== null &&
    ratingValue !== undefined &&
    !(typeof ratingValue === 'string' && ratingValue.trim() === '');
  const rating = hasRatingValue && Number.isFinite(Number(ratingValue))
    ? Math.floor(Number(ratingValue))
    : null;
  const timedOut = payload?.timedOut ? 1 : 0;
  const thankYouMessage = String(payload?.thankYouMessage ?? '').trim();
  const createdAt = Number(payload?.createdAt) || Date.now();
  const answeredAtRaw = payload?.answeredAt;
  const hasAnsweredAt =
    answeredAtRaw !== null &&
    answeredAtRaw !== undefined &&
    !(typeof answeredAtRaw === 'string' && answeredAtRaw.trim() === '');
  const answeredAt = hasAnsweredAt && Number.isFinite(Number(answeredAtRaw)) ? Number(answeredAtRaw) : null;

  const result = stmts.insertSatisfactionSurvey.run(
    jid,
    flowPath,
    sessionId,
    questionType,
    scale,
    rating,
    timedOut,
    thankYouMessage,
    createdAt,
    answeredAt
  );
  return Number(result?.lastInsertRowid) || 0;
}

/**
 * Lists survey rows for diagnostics and tests.
 *
 * @param {{
 *   jid?: string,
 *   flowPath?: string,
 *   limit?: number,
 * }} [options={}]
 * @returns {Array<{
 *   id: number,
 *   jid: string,
 *   flowPath: string,
 *   sessionId: string,
 *   questionType: string,
 *   scale: number,
 *   rating: number | null,
 *   timedOut: boolean,
 *   thankYouMessage: string,
 *   createdAt: number,
 *   answeredAt: number | null,
 * }>}
 */
export function listSatisfactionSurveyResponses(options = {}) {
  const stmts = getStmts();
  const jid = normalizeJid(options?.jid);
  const flowPath = normalizeFlowPath(options?.flowPath);
  const limit = Math.max(1, Math.min(2000, Number(options?.limit) || 200));

  let rows = [];
  if (jid && flowPath) {
    rows = stmts.listSatisfactionSurveyByJidAndFlowPath.all(jid, flowPath, limit);
  } else if (jid) {
    rows = stmts.listSatisfactionSurveyByJid.all(jid, limit);
  } else if (flowPath) {
    rows = stmts.listSatisfactionSurveyByFlowPath.all(flowPath, limit);
  } else {
    rows = stmts.listSatisfactionSurvey.all(limit);
  }

  return rows.map(row => ({
    id: Number(row?.id) || 0,
    jid: normalizeJid(row?.jid),
    flowPath: normalizeFlowPath(row?.flow_path),
    sessionId: String(row?.session_id || '').trim(),
    questionType: String(row?.question_type || '').trim().toLowerCase(),
    scale: Number(row?.scale) || 0,
    rating: row?.rating == null ? null : Number(row?.rating),
    timedOut: Number(row?.timed_out) === 1,
    thankYouMessage: String(row?.thank_you_message || ''),
    createdAt: Number(row?.created_at) || 0,
    answeredAt: row?.answered_at == null ? null : Number(row?.answered_at),
  }));
}
