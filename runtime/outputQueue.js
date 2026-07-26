import { normalizeInt } from '../utils/normalization.js';

const PRIORITIES = {
  reply: 3,
  announcement: 2,
  flavor: 1,
};

const PRIORITY_KEYS = ['reply', 'announcement', 'flavor'];

function mapPriority(input = 'reply') {
  const key = String(input).trim().toLowerCase();
  if (key === 'flavor' || key === 'low') return PRIORITY_KEYS[2];
  if (key === 'announcement' || key === 'medium') return PRIORITY_KEYS[1];
  return PRIORITY_KEYS[0];
}

export function createOutputQueue({
  globalConcurrency = 4,
  jidGapMs = 600,
  maxCoalesceDelayMs = 2000,
  maxQueueSize = 2000,
} = {}) {
  const normGlobal = normalizeInt(globalConcurrency, 4, { min: 1, max: 32, rounding: 'floor', clampMin: false, clampMax: true });
  const normGap = normalizeInt(jidGapMs, 600, { min: 0, max: 10000, rounding: 'floor', clampMin: false, clampMax: true });
  const normCoalesce = normalizeInt(maxCoalesceDelayMs, 2000, { min: 0, max: 30000, rounding: 'floor', clampMin: false, clampMax: true });
  const normMaxQ = normalizeInt(maxQueueSize, 2000, { min: 1, max: 50000, rounding: 'floor', clampMin: false, clampMax: true });

  const buckets = new Map();
  const readyKeys = [];
  const readyKeySet = new Set();
  const idleWaiters = new Set();

  let runningCount = 0;
  let queuedCount = 0;

  const startedAt = Date.now();
  const counters = {
    accepted: 0,
    rejected: 0,
    sent: 0,
    coalesced: 0,
    failed: 0,
    totalWaitMs: 0,
  };
  const waitTimeSamples = [];

  function currentSnapshot() {
    const uptimeSeconds = Math.max(1, (Date.now() - startedAt) / 1000);
    const sorted = [...waitTimeSamples].sort((a, b) => a - b);
    return {
      globalConcurrency: normGlobal,
      jidGapMs: normGap,
      maxCoalesceDelayMs: normCoalesce,
      queued: queuedCount,
      running: runningCount,
      activeKeys: buckets.size,
      accepted: counters.accepted,
      rejected: counters.rejected,
      sent: counters.sent,
      coalesced: counters.coalesced,
      failed: counters.failed,
      avgWaitMs: safeAverage(counters.totalWaitMs, counters.sent),
      p50WaitMs: toPercentile(sorted, 0.5),
      p95WaitMs: toPercentile(sorted, 0.95),
      acceptedPerSecond: Number((counters.accepted / uptimeSeconds).toFixed(2)),
      sentPerSecond: Number((counters.sent / uptimeSeconds).toFixed(2)),
      startedAt,
      updatedAt: Date.now(),
    };
  }

  function gapForPriority(priority) {
    if (priority === 'reply') return Math.min(100, normGap);
    if (priority === 'announcement') return normGap;
    return Math.max(normGap, Math.round(normGap * 1.5));
  }

  function coalesceDelayForPriority(priority) {
    if (priority === 'reply') return 0;
    if (priority === 'announcement') return normCoalesce;
    return Math.max(normCoalesce, Math.round(normCoalesce * 1.5));
  }

  function scheduleDrain() {
    while (runningCount < normGlobal && readyKeys.length > 0) {
      const key = readyKeys.shift();
      readyKeySet.delete(key);
      const bucket = buckets.get(key);
      if (!bucket || bucket.active || bucket.items.length === 0) {
        if (bucket && !bucket.active && bucket.items.length === 0) buckets.delete(key);
        continue;
      }

      bucket.active = true;
      runningCount += 1;

      const item = bucket.items.shift();
      queuedCount -= 1;

      void (async () => {
        const waitedMs = Math.max(0, Date.now() - item.queuedAt);
        counters.totalWaitMs += waitedMs;
        if (waitTimeSamples.length >= 500) waitTimeSamples.shift();
        waitTimeSamples.push(waitedMs);

        try {
          await item.send();
          counters.sent += 1;
        } catch {
          counters.failed += 1;
        } finally {
          runningCount -= 1;

          if (bucket.items.length > 0) {
            if (!readyKeySet.has(key)) {
              readyKeySet.add(key);
              readyKeys.push(key);
            }
            bucket.active = false;
          } else {
            bucket.active = false;
            buckets.delete(key);
          }

          const gap = gapForPriority(item.priority);
          if (gap > 0 && runningCount < normGlobal) {
            setTimeout(() => scheduleDrain(), gap);
          } else {
            scheduleDrain();
          }
          notifyIdle();
        }
      })();
    }
  }

  function notifyIdle() {
    if (runningCount === 0 && queuedCount === 0) {
      for (const resolve of idleWaiters) {
        try { resolve(); } catch { }
      }
      idleWaiters.clear();
    }
  }

  function enqueue({ jid, send, priority = 'reply', coalesceKey = '' }) {
    const normalizedJid = String(jid ?? '').trim();
    if (!normalizedJid) return { accepted: false, reason: 'no-jid' };
    if (typeof send !== 'function') return { accepted: false, reason: 'no-send' };

    if (queuedCount >= normMaxQ) {
      counters.rejected += 1;
      return { accepted: false, reason: 'queue-overflow' };
    }

    const prio = mapPriority(priority);
    const item = { queuedAt: Date.now(), send, priority: prio, coalesceKey: String(coalesceKey || '') };

    let bucket = buckets.get(normalizedJid);
    if (!bucket) {
      bucket = { items: [], active: false, coalesceTimer: null };
      buckets.set(normalizedJid, bucket);
    }

    if (prio !== 'reply' && coalesceKey && bucket.items.length > 0) {
      const last = bucket.items[bucket.items.length - 1];
      if (last.coalesceKey === item.coalesceKey && last.priority === prio) {
        counters.coalesced += 1;
        last.send = send;
        last.queuedAt = Date.now();
        return { accepted: true, coalesced: true };
      }
    }

    bucket.items.push(item);
    bucket.items.sort((a, b) => PRIORITIES[b.priority] - PRIORITIES[a.priority]);
    queuedCount += 1;
    counters.accepted += 1;

    if (!bucket.active && !readyKeySet.has(normalizedJid)) {
      const effectiveCoalesce = coalesceDelayForPriority(prio);

      if (effectiveCoalesce > 0 && bucket.items.length === 1 && !bucket.coalesceTimer) {
        bucket.coalesceTimer = setTimeout(() => {
          bucket.coalesceTimer = null;
          if (!bucket.active && bucket.items.length > 0 && !readyKeySet.has(normalizedJid)) {
            readyKeySet.add(normalizedJid);
            readyKeys.push(normalizedJid);
            scheduleDrain();
          }
        }, effectiveCoalesce);
        return { accepted: true, scheduled: true, coalesceDelay: effectiveCoalesce };
      }

      if (!bucket.coalesceTimer && bucket.items.length > 0) {
        const deferMs = effectiveCoalesce > 0 ? effectiveCoalesce : 1;
        bucket.coalesceTimer = setTimeout(() => {
          bucket.coalesceTimer = null;
          if (!bucket.active && bucket.items.length > 0 && !readyKeySet.has(normalizedJid)) {
            readyKeySet.add(normalizedJid);
            readyKeys.push(normalizedJid);
            scheduleDrain();
          }
        }, deferMs);
        return { accepted: true, scheduled: true, coalesceDelay: deferMs };
      }
    }

    return { accepted: true, scheduled: true };
  }

  async function onIdle() {
    if (runningCount === 0 && queuedCount === 0) return;
    return new Promise(resolve => { idleWaiters.add(resolve); });
  }

  return {
    enqueue,
    onIdle,
    getSnapshot: currentSnapshot,
    PRIORITIES,
  };
}

function safeAverage(total, count) {
  if (!Number.isFinite(total) || !Number.isFinite(count) || count <= 0) return 0;
  return Number((total / count).toFixed(2));
}

function toPercentile(sorted, pct) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * pct)));
  return sorted[idx];
}
