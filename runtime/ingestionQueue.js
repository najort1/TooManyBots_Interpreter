import { normalizeInt } from '../utils/normalization.js';

function safeAverage(total, count) {
  if (!Number.isFinite(total) || !Number.isFinite(count) || count <= 0) return 0;
  return Number((total / count).toFixed(2));
}

function normalizePositiveInt(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  return normalizeInt(value, fallback, {
    min,
    max,
    rounding: 'floor',
    clampMin: false,
    clampMax: true,
  });
}

function toPercentile(sorted, pct) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * pct)));
  return sorted[idx];
}

export function createIngestionQueue({
  concurrency = 8,
  maxQueueSize = 5000,
  warnThreshold = 1000,
  taskTimeoutMs = 0,
  maxTaskDurationMs = 0,
  onWarn = null,
} = {}) {
  const normalizedConcurrency = normalizePositiveInt(concurrency, 8, { min: 1, max: 64 });
  const normalizedMaxQueueSize = normalizePositiveInt(maxQueueSize, 5000, { min: 1, max: 200000 });
  const normalizedWarnThreshold = Math.max(
    1,
    Math.min(normalizedMaxQueueSize, normalizePositiveInt(warnThreshold, 1000, { min: 1, max: normalizedMaxQueueSize }))
  );
  const normalizedTaskTimeout = Math.max(0, normalizePositiveInt(taskTimeoutMs, 0, { min: 0, max: 300000 }));
  const normalizedMaxDuration = Math.max(0, normalizePositiveInt(maxTaskDurationMs, 0, { min: 0, max: 600000 }));

  const buckets = new Map();
  const readyKeys = [];
  const readyKeySet = new Set();
  const idleWaiters = new Set();

  let runningCount = 0;
  let queuedCount = 0;
  let thresholdWarningActive = false;

  const startedAt = Date.now();
  const counters = {
    accepted: 0,
    rejected: 0,
    rejectedTimeout: 0,
    rejectedDuration: 0,
    started: 0,
    completed: 0,
    failed: 0,
    maxQueuedObserved: 0,
    totalWaitMs: 0,
    totalProcessMs: 0,
  };

  const waitTimeSamples = [];
  const processTimeSamples = [];

  function notifyIdleIfNeeded() {
    if (runningCount > 0 || queuedCount > 0) return;
    for (const resolve of idleWaiters) {
      try {
        resolve();
      } catch {

      }
    }
    idleWaiters.clear();
  }

  function currentSnapshot() {
    const nowTs = Date.now();
    const uptimeSeconds = Math.max(1, (nowTs - startedAt) / 1000);
    const sortedWait = [...waitTimeSamples].sort((a, b) => a - b);
    const sortedProcess = [...processTimeSamples].sort((a, b) => a - b);
    return {
      concurrency: normalizedConcurrency,
      maxQueueSize: normalizedMaxQueueSize,
      warnThreshold: normalizedWarnThreshold,
      taskTimeoutMs: normalizedTaskTimeout,
      maxTaskDurationMs: normalizedMaxDuration,
      queued: queuedCount,
      running: runningCount,
      activeKeys: buckets.size,
      accepted: counters.accepted,
      rejected: counters.rejected,
      rejectedTimeout: counters.rejectedTimeout,
      rejectedDuration: counters.rejectedDuration,
      started: counters.started,
      completed: counters.completed,
      failed: counters.failed,
      maxQueuedObserved: counters.maxQueuedObserved,
      avgWaitMs: safeAverage(counters.totalWaitMs, counters.started),
      avgProcessMs: safeAverage(counters.totalProcessMs, counters.completed + counters.failed + counters.rejectedDuration),
      p50WaitMs: toPercentile(sortedWait, 0.5),
      p95WaitMs: toPercentile(sortedWait, 0.95),
      p99WaitMs: toPercentile(sortedWait, 0.99),
      p50ProcessMs: toPercentile(sortedProcess, 0.5),
      p95ProcessMs: toPercentile(sortedProcess, 0.95),
      p99ProcessMs: toPercentile(sortedProcess, 0.99),
      acceptedPerSecond: Number((counters.accepted / uptimeSeconds).toFixed(2)),
      processedPerSecond: Number(((counters.completed + counters.failed) / uptimeSeconds).toFixed(2)),
      droppedPerSecond: Number((counters.rejected / uptimeSeconds).toFixed(2)),
      startedAt,
      updatedAt: nowTs,
    };
  }

  function maybeWarnThreshold() {
    if (queuedCount >= normalizedWarnThreshold && !thresholdWarningActive) {
      thresholdWarningActive = true;
      if (typeof onWarn === 'function') {
        onWarn(currentSnapshot());
      }
      return;
    }
    if (queuedCount < normalizedWarnThreshold && thresholdWarningActive) {
      thresholdWarningActive = false;
    }
  }

  function findNextItem() {
    while (readyKeys.length > 0) {
      const key = readyKeys.shift();
      readyKeySet.delete(key);

      const bucket = buckets.get(key);
      const bucketLength = (bucket?.high?.length || 0) + (bucket?.low?.length || 0);
      if (!bucket || bucket.active || bucketLength === 0) {
        if (bucket && !bucket.active && bucketLength === 0) {
          buckets.delete(key);
        }
        continue;
      }

      const now = Date.now();
      let popped = false;
      for (const arr of [bucket.high, bucket.low]) {
        while (arr.length > 0) {
          const item = arr[0];
          if (normalizedTaskTimeout > 0 && now - item.queuedAt >= normalizedTaskTimeout) {
            arr.shift();
            queuedCount -= 1;
            counters.rejectedTimeout += 1;
            counters.rejected += 1;
            maybeWarnThreshold();
            continue;
          }
          arr.shift();
          popped = true;
          queuedCount -= 1;
          item._bucketKey = key;
          return { key, item, bucket };
        }
      }

      if (!popped) {
        if (bucketLength === 0) buckets.delete(key);
        continue;
      }
    }
    return null;
  }

  function scheduleDrain() {
    while (runningCount < normalizedConcurrency) {
      const next = findNextItem();
      if (!next) {
        notifyIdleIfNeeded();
        return;
      }

      const { key, item, bucket } = next;
      bucket.active = true;
      runningCount += 1;
      maybeWarnThreshold();
      counters.started += 1;
      const waitMs = Math.max(0, Date.now() - item.queuedAt);
      counters.totalWaitMs += waitMs;
      if (waitTimeSamples.length >= 1000) waitTimeSamples.shift();
      waitTimeSamples.push(waitMs);

      let abortController = null;
      let abortSignal = undefined;
      let abortTimer = null;
      let wasAborted = false;
      if (normalizedMaxDuration > 0) {
        abortController = new AbortController();
        abortSignal = abortController.signal;
        abortTimer = setTimeout(() => {
          wasAborted = true;
          try { abortController.abort(); } catch {}
        }, normalizedMaxDuration);
      }

      void (async () => {
        const processStartedAt = Date.now();
        try {
          await item.handler(item.payload, { signal: abortSignal });
          if (wasAborted) {
            counters.rejectedDuration += 1;
            counters.failed += 1;
          } else {
            if (abortTimer) clearTimeout(abortTimer);
            counters.completed += 1;
          }
        } catch {
          if (!wasAborted) {
            if (abortTimer) clearTimeout(abortTimer);
          } else {
            counters.rejectedDuration += 1;
          }
          counters.failed += 1;
        } finally {
          const processMs = Math.max(0, Date.now() - processStartedAt);
          counters.totalProcessMs += processMs;
          if (processTimeSamples.length >= 1000) processTimeSamples.shift();
          processTimeSamples.push(processMs);

          runningCount -= 1;
          bucket.active = false;

          const pendingInBucket = bucket.high.length + bucket.low.length;
          if (pendingInBucket > 0) {
            if (!readyKeySet.has(key)) {
              readyKeySet.add(key);
              readyKeys.push(key);
            }
          } else {
            buckets.delete(key);
          }

          notifyIdleIfNeeded();
          scheduleDrain();
        }
      })();
    }
  }

  function enqueue({ key, payload, handler, priority = 'high' }) {
    if (typeof handler !== 'function') {
      throw new Error('ingestion-queue handler is required');
    }

    if (queuedCount >= normalizedMaxQueueSize) {
      counters.rejected += 1;
      return { accepted: false, reason: 'queue-overflow', snapshot: currentSnapshot() };
    }

    const normalizedKey = String(key ?? '').trim() || 'unknown';
    const normalizedPriority = String(priority ?? 'high').trim().toLowerCase() === 'low'
      ? 'low'
      : 'high';
    const bucket = buckets.get(normalizedKey) ?? { high: [], low: [], active: false };
    if (!buckets.has(normalizedKey)) {
      buckets.set(normalizedKey, bucket);
    }

    bucket[normalizedPriority].push({
      queuedAt: Date.now(),
      payload,
      handler,
    });
    queuedCount += 1;
    counters.accepted += 1;
    counters.maxQueuedObserved = Math.max(counters.maxQueuedObserved, queuedCount);
    maybeWarnThreshold();

    if (!bucket.active && !readyKeySet.has(normalizedKey)) {
      readyKeySet.add(normalizedKey);
      readyKeys.push(normalizedKey);
    }

    scheduleDrain();
    return { accepted: true, snapshot: currentSnapshot() };
  }

  function cancelPending(key) {
    const normalizedKey = String(key ?? '').trim();
    if (!normalizedKey) return 0;
    const bucket = buckets.get(normalizedKey);
    if (!bucket) return 0;
    const count = bucket.high.length + bucket.low.length;
    bucket.high.length = 0;
    bucket.low.length = 0;
    buckets.delete(normalizedKey);
    queuedCount -= count;
    counters.rejected += count;
    return count;
  }

  function onIdle() {
    if (runningCount === 0 && queuedCount === 0) {
      return Promise.resolve();
    }
    return new Promise(resolve => {
      idleWaiters.add(resolve);
    });
  }

  return {
    enqueue,
    cancelPending,
    onIdle,
    getSnapshot: currentSnapshot,
  };
}
