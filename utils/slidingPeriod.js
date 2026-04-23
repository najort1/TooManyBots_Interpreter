/**
 * Supported sliding-period labels for start policy checks.
 */
const SLIDING_PERIODS = new Set(['day', 'week', 'month']);

/**
 * Normalizes an arbitrary period label to a supported value.
 *
 * @param {unknown} value
 * @returns {'day' | 'week' | 'month'}
 */
export function normalizeSlidingPeriod(value) {
  const normalized = String(value ?? 'day').trim().toLowerCase();
  if (SLIDING_PERIODS.has(normalized)) {
    return /** @type {'day' | 'week' | 'month'} */ (normalized);
  }
  return 'day';
}

/**
 * Returns the sliding-window start timestamp (inclusive) for a period.
 *
 * @param {'day' | 'week' | 'month' | string} period
 * @param {number} [nowTs=Date.now()]
 * @returns {number}
 */
export function getSlidingPeriodStartTs(period, nowTs = Date.now()) {
  const normalizedPeriod = normalizeSlidingPeriod(period);
  const now = Number.isFinite(Number(nowTs)) ? Number(nowTs) : Date.now();

  if (normalizedPeriod === 'day') {
    return now - (24 * 60 * 60 * 1000);
  }

  if (normalizedPeriod === 'week') {
    return now - (7 * 24 * 60 * 60 * 1000);
  }

  const anchor = new Date(now);
  anchor.setMonth(anchor.getMonth() - 1);
  return anchor.getTime();
}

/**
 * Builds an inclusive/exclusive timestamp window for the selected period.
 *
 * @param {'day' | 'week' | 'month' | string} period
 * @param {number} [nowTs=Date.now()]
 * @returns {{ period: 'day' | 'week' | 'month', startTs: number, endTs: number }}
 */
export function buildSlidingPeriodWindow(period, nowTs = Date.now()) {
  const normalizedPeriod = normalizeSlidingPeriod(period);
  const endTs = Number.isFinite(Number(nowTs)) ? Number(nowTs) : Date.now();
  return {
    period: normalizedPeriod,
    startTs: getSlidingPeriodStartTs(normalizedPeriod, endTs),
    endTs,
  };
}
