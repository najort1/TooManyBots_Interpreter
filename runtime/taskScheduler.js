function safeAverage(total, count) {
  if (!Number.isFinite(total) || !Number.isFinite(count) || count <= 0) return 0;
  return Number((total / count).toFixed(2));
}

function normalizeInt(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const normalized = Math.floor(n);
  if (normalized < min) return fallback;
  return Math.min(normalized, max);
}

function decMapCounter(map, key) {
  const current = Number(map.get(key) || 0);
  if (current <= 1) {
    map.delete(key);
    return;
  }
  map.set(key, current - 1);
}

export function createTaskScheduler({
  globalConcurrency = 16,
  maxPerJid = 1,
  maxPerFlowPath = 4,
  maxQueueSize = 20000,
  warnThreshold = 5000,
  onWarn = null,
} = {}) {
  const normalizedGlobalConcurrency = normalizeInt(globalConcurrency, 16, { min: 1, max: 256 });
  const normalizedMaxPerJid = normalizeInt(maxPerJid, 1, { min: 1, max: 64 });
  const normalizedMaxPerFlowPath = normalizeInt(maxPerFlowPath, 4, { min: 1, max: 256 });
  const normalizedMaxQueueSize = normalizeInt(maxQueueSize, 20000, { min: 1, max: 500000 });
  const normalizedWarnThreshold = Math.max(
    1,
    Math.min(normalizedMaxQueueSize, normalizeInt(warnThreshold, 5000, { min: 1, max: normalizedMaxQueueSize }))
  );

  const startedAt = Date.now();
  const queueHigh = [];
  const queueLow = [];
  const idleWaiters = new Set();

  const runningByJid = new Map();
  const runningByFlowPath = new Map();
  let runningGlobal = 0;
  let warnActive = false;

  const metrics = {
    accepted: 0,
    rejected: 0,
    started: 0,
    completed: 0,
    failed: 0,
    maxQueuedObserved: 0,
    totalWaitMs: 0,
    totalProcessMs: 0,
  };

  function getQueuedCount() {
    return queueHigh.length + queueLow.length;
  }

  function snapshot() {
    const nowTs = Date.now();
    const uptimeSeconds = Math.max(1, (nowTs - startedAt) / 1000);
    return {
      globalConcurrency: normalizedGlobalConcurrency,
      maxPerJid: normalizedMaxPerJid,
      maxPerFlowPath: normalizedMaxPerFlowPath,
      maxQueueSize: normalizedMaxQueueSize,
      warnThreshold: normalizedWarnThreshold,
      queued: getQueuedCount(),
      running: runningGlobal,
      runningJids: runningByJid.size,
      runningFlowPaths: runningByFlowPath.size,
      accepted: metrics.accepted,
      rejected: metrics.rejected,
      started: metrics.started,
      completed: metrics.completed,
      failed: metrics.failed,
      maxQueuedObserved: metrics.maxQueuedObserved,
      avgWaitMs: safeAverage(metrics.totalWaitMs, metrics.started),
      avgProcessMs: safeAverage(metrics.totalProcessMs, metrics.completed + metrics.failed),
      acceptedPerSecond: Number((metrics.accepted / uptimeSeconds).toFixed(2)),
      processedPerSecond: Number(((metrics.completed + metrics.failed) / uptimeSeconds).toFixed(2)),
      droppedPerSecond: Number((metrics.rejected / uptimeSeconds).toFixed(2)),
      startedAt,
      updatedAt: nowTs,
    };
  }

  function maybeWarn() {
    const queued = getQueuedCount();
    if (queued >= normalizedWarnThreshold && !warnActive) {
      warnActive = true;
      if (typeof onWarn === 'function') {
        onWarn(snapshot());
      }
      return;
    }
    if (queued < normalizedWarnThreshold && warnActive) {
      warnActive = false;
    }
  }

  function canRun(task) {
    if (runningGlobal >= normalizedGlobalConcurrency) return false;
    const jid = task?.jid || '';
    const flowPath = task?.flowPath || '';
    if (jid) {
      const jidRunning = Number(runningByJid.get(jid) || 0);
      if (jidRunning >= normalizedMaxPerJid) return false;
    }
    if (flowPath) {
      const flowRunning = Number(runningByFlowPath.get(flowPath) || 0);
      if (flowRunning >= normalizedMaxPerFlowPath) return false;
    }
    return true;
  }

  function shiftRunnable(queue) {
    for (let i = 0; i < queue.length; i++) {
      const task = queue[i];
      if (!canRun(task)) continue;
      queue.splice(i, 1);
      return task;
    }
    return null;
  }

  function notifyIdleIfNeeded() {
    if (runningGlobal > 0 || getQueuedCount() > 0) return;
    for (const resolve of idleWaiters) {
      try {
        resolve();
      } catch {
        // ignore idle waiter errors
      }
    }
    idleWaiters.clear();
  }

  function scheduleDrain() {
    while (runningGlobal < normalizedGlobalConcurrency) {
      const nextTask = shiftRunnable(queueHigh) || shiftRunnable(queueLow);
      if (!nextTask) {
        notifyIdleIfNeeded();
        return;
      }

      runningGlobal += 1;
      if (nextTask.jid) {
        runningByJid.set(nextTask.jid, Number(runningByJid.get(nextTask.jid) || 0) + 1);
      }
      if (nextTask.flowPath) {
        runningByFlowPath.set(nextTask.flowPath, Number(runningByFlowPath.get(nextTask.flowPath) || 0) + 1);
      }

      metrics.started += 1;
      metrics.totalWaitMs += Math.max(0, Date.now() - nextTask.queuedAt);

      void (async () => {
        const runStartedAt = Date.now();
        try {
          const result = await nextTask.handler(nextTask.payload);
          metrics.completed += 1;
          nextTask.resolve(result);
        } catch (error) {
          metrics.failed += 1;
          nextTask.reject(error);
        } finally {
          metrics.totalProcessMs += Math.max(0, Date.now() - runStartedAt);
          runningGlobal -= 1;
          if (nextTask.jid) decMapCounter(runningByJid, nextTask.jid);
          if (nextTask.flowPath) decMapCounter(runningByFlowPath, nextTask.flowPath);
          notifyIdleIfNeeded();
          scheduleDrain();
        }
      })();
    }
  }

  function enqueue({
    jid = '',
    flowPath = '',
    priority = 'high',
    payload = undefined,
    handler,
  }) {
    if (typeof handler !== 'function') {
      throw new Error('task-scheduler handler is required');
    }

    if (getQueuedCount() >= normalizedMaxQueueSize) {
      metrics.rejected += 1;
      maybeWarn();
      return {
        accepted: false,
        reason: 'queue-overflow',
        snapshot: snapshot(),
        promise: Promise.resolve(null),
      };
    }

    const normalizedPriority = String(priority ?? 'high').trim().toLowerCase() === 'low'
      ? 'low'
      : 'high';
    const normalizedJid = String(jid ?? '').trim();
    const normalizedFlowPath = String(flowPath ?? '').trim();

    let resolvePromise;
    let rejectPromise;
    const promise = new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });

    const task = {
      jid: normalizedJid,
      flowPath: normalizedFlowPath,
      priority: normalizedPriority,
      payload,
      handler,
      queuedAt: Date.now(),
      resolve: resolvePromise,
      reject: rejectPromise,
    };

    if (normalizedPriority === 'low') {
      queueLow.push(task);
    } else {
      queueHigh.push(task);
    }

    metrics.accepted += 1;
    metrics.maxQueuedObserved = Math.max(metrics.maxQueuedObserved, getQueuedCount());
    maybeWarn();
    scheduleDrain();

    return {
      accepted: true,
      snapshot: snapshot(),
      promise,
    };
  }

  function onIdle() {
    if (runningGlobal === 0 && getQueuedCount() === 0) {
      return Promise.resolve();
    }
    return new Promise(resolve => {
      idleWaiters.add(resolve);
    });
  }

  return {
    enqueue,
    onIdle,
    getSnapshot: snapshot,
  };
}
