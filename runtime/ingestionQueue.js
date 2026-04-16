function safeAverage(total, count) {
  if (!Number.isFinite(total) || !Number.isFinite(count) || count <= 0) return 0;
  return Number((total / count).toFixed(2));
}

function normalizePositiveInt(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const normalized = Math.floor(n);
  if (normalized < min) return fallback;
  return Math.min(normalized, max);
}

export function createIngestionQueue({
  concurrency = 8,
  maxQueueSize = 5000,
  warnThreshold = 1000,
  onWarn = null,
} = {}) {
  const normalizedConcurrency = normalizePositiveInt(concurrency, 8, { min: 1, max: 64 });
  const normalizedMaxQueueSize = normalizePositiveInt(maxQueueSize, 5000, { min: 1, max: 200000 });
  const normalizedWarnThreshold = Math.max(
    1,
    Math.min(normalizedMaxQueueSize, normalizePositiveInt(warnThreshold, 1000, { min: 1, max: normalizedMaxQueueSize }))
  );

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
    started: 0,
    completed: 0,
    failed: 0,
    maxQueuedObserved: 0,
    totalWaitMs: 0,
    totalProcessMs: 0,
  };

  function notifyIdleIfNeeded() {
    if (runningCount > 0 || queuedCount > 0) return;
    for (const resolve of idleWaiters) {
      try {
        resolve();
      } catch {
        // ignore idle waiter errors
      }
    }
    idleWaiters.clear();
  }

  function currentSnapshot() {
    const nowTs = Date.now();
    const uptimeSeconds = Math.max(1, (nowTs - startedAt) / 1000);
    return {
      concurrency: normalizedConcurrency,
      maxQueueSize: normalizedMaxQueueSize,
      warnThreshold: normalizedWarnThreshold,
      queued: queuedCount,
      running: runningCount,
      activeKeys: buckets.size,
      accepted: counters.accepted,
      rejected: counters.rejected,
      started: counters.started,
      completed: counters.completed,
      failed: counters.failed,
      maxQueuedObserved: counters.maxQueuedObserved,
      avgWaitMs: safeAverage(counters.totalWaitMs, counters.started),
      avgProcessMs: safeAverage(counters.totalProcessMs, counters.completed + counters.failed),
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

  function scheduleDrain() {
    while (runningCount < normalizedConcurrency && readyKeys.length > 0) {
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

      const item = bucket.high.length > 0
        ? bucket.high.shift()
        : bucket.low.shift();
      if (!item) continue;

      bucket.active = true;
      runningCount += 1;
      queuedCount -= 1;
      maybeWarnThreshold();
      counters.started += 1;
      counters.totalWaitMs += Math.max(0, Date.now() - item.queuedAt);

      void (async () => {
        const processStartedAt = Date.now();
        try {
          await item.handler(item.payload);
          counters.completed += 1;
        } catch {
          counters.failed += 1;
        } finally {
          counters.totalProcessMs += Math.max(0, Date.now() - processStartedAt);
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
    onIdle,
    getSnapshot: currentSnapshot,
  };
}
