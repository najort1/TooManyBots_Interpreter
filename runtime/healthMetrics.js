/**
 * runtime/healthMetrics.js
 *
 * Pure utility functions for tracking WhatsApp runtime health metrics.
 * These helpers are stateless — callers own and mutate the data structures.
 *
 * Extracted from index.js to reduce the size of the entry point and to make
 * the metric infrastructure independently testable.
 */

/** Maximum number of numeric samples retained in health sample arrays. */
export const HEALTH_SAMPLE_MAX = 600;

/**
 * Number of per-minute counter buckets retained in memory.
 * 24 * 60 = 1,440 buckets → 24 hours of minute-resolution data.
 */
export const MINUTE_COUNTER_RETENTION = 24 * 60;

/**
 * Increments a string-keyed counter property on a plain object.
 * Creates the key with value 0 if it does not yet exist.
 *
 * @param {Record<string, number>} target
 * @param {string} key
 * @param {number} [delta=1]
 */
export function incrementObjectCounter(target, key, delta = 1) {
  const normalizedKey = String(key || 'unknown');
  const safeDelta = Number.isFinite(Number(delta)) ? Number(delta) : 1;
  target[normalizedKey] = Math.max(0, Number(target[normalizedKey] || 0) + safeDelta);
}

/**
 * Appends a numeric sample to the array, evicting the oldest entry
 * when the array length would exceed `max`.
 *
 * @param {number[]} array
 * @param {number}   value
 * @param {number}   [max=HEALTH_SAMPLE_MAX]
 */
export function pushSample(array, value, max = HEALTH_SAMPLE_MAX) {
  if (!Array.isArray(array)) return;
  array.push(Number(value) || 0);
  while (array.length > max) {
    array.shift();
  }
}

/**
 * Trims timestamps older than `windowMs` milliseconds from the front of a
 * chronologically-sorted array. Used to enforce sliding-window retention.
 *
 * @param {number[]} array   - Sorted ascending array of Unix timestamp ms values.
 * @param {number}   windowMs
 * @param {number}   [nowTs=Date.now()]
 */
export function trimTimestampWindow(array, windowMs, nowTs = Date.now()) {
  if (!Array.isArray(array)) return;
  const minTs = nowTs - Math.max(0, Number(windowMs) || 0);
  while (array.length > 0 && Number(array[0] || 0) < minTs) {
    array.shift();
  }
}

/**
 * Returns the value at the given percentile from an array of numeric samples.
 * Returns 0 if the array is empty.
 *
 * @param {number[]} samples
 * @param {number}   [percentile=0.95]
 * @returns {number}
 */
export function toPercentile(samples, percentile = 0.95) {
  if (!Array.isArray(samples) || samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const safePercentile = Math.min(1, Math.max(0, Number(percentile) || 0));
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * safePercentile)));
  return Number(sorted[idx] || 0);
}

/**
 * Increments the per-minute counter bucket for a given timestamp.
 * Automatically evicts buckets older than MINUTE_COUNTER_RETENTION minutes.
 *
 * @param {Map<number, number>} counter   - Keyed by minute-bucket (Math.floor(ts/60000)).
 * @param {number}              [timestamp=Date.now()]
 * @param {number}              [delta=1]
 */
export function bumpMinuteCounter(counter, timestamp = Date.now(), delta = 1) {
  if (!(counter instanceof Map)) return;
  const ts = Number(timestamp) || Date.now();
  const bucket = Math.floor(ts / 60000);
  counter.set(bucket, Math.max(0, Number(counter.get(bucket) || 0) + (Number(delta) || 1)));
  const minBucket = bucket - MINUTE_COUNTER_RETENTION;
  for (const key of counter.keys()) {
    if (key < minBucket) {
      counter.delete(key);
    }
  }
}

/**
 * Reads the average per-minute event rate over the last `minutes` full minutes.
 *
 * @param {Map<number, number>} counter
 * @param {number}              [minutes=1]
 * @returns {number} Average events per minute, rounded to 2 decimal places.
 */
export function readPerMinute(counter, minutes = 1) {
  if (!(counter instanceof Map)) return 0;
  const span = Math.max(1, Math.floor(Number(minutes) || 1));
  const nowBucket = Math.floor(Date.now() / 60000);
  const minBucket = nowBucket - (span - 1);
  let total = 0;
  for (const [bucket, value] of counter.entries()) {
    if (bucket >= minBucket && bucket <= nowBucket) {
      total += Math.max(0, Number(value) || 0);
    }
  }
  return Number((total / span).toFixed(2));
}

/**
 * Computes queue fill level as a percentage of the configured maximum capacity.
 * The result is clamped to [0, 100].
 *
 * @param {{ queued?: number, maxQueueSize?: number }} snapshot
 * @returns {number} Percentage in [0, 100].
 */
export function computeQueuePressurePercent(snapshot) {
  const queued = Math.max(0, Number(snapshot?.queued) || 0);
  const maxQueueSize = Math.max(1, Number(snapshot?.maxQueueSize) || 1);
  return Math.min(100, Number(((queued / maxQueueSize) * 100).toFixed(2)));
}
