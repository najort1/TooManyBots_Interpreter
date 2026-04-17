function normalizePositiveInt(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const normalized = Math.floor(n);
  if (normalized < min || normalized > max) return fallback;
  return normalized;
}

function normalizeNumberInRange(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < min || n > max) return fallback;
  return n;
}

function applyJitter(delayMs, jitterRatio) {
  const safeDelay = Math.max(0, Math.floor(Number(delayMs) || 0));
  const safeJitter = normalizeNumberInRange(jitterRatio, 0, { min: 0, max: 1 });
  if (safeDelay === 0 || safeJitter === 0) return safeDelay;
  const jitterWindow = Math.floor(safeDelay * safeJitter);
  if (jitterWindow <= 0) return safeDelay;
  const offset = Math.floor((Math.random() * ((jitterWindow * 2) + 1)) - jitterWindow);
  return Math.max(0, safeDelay + offset);
}

export function createReconnectController({
  minDelayMs = 3000,
  maxDelayMs = 60000,
  backoffMultiplier = 2,
  jitterRatio = 0.2,
  attemptWindowMs = 10 * 60 * 1000,
  maxAttemptsPerWindow = 12,
  cooldownMs = 2 * 60 * 1000,
} = {}) {
  const normalizedMinDelayMs = normalizePositiveInt(minDelayMs, 3000, { min: 100, max: 10 * 60 * 1000 });
  const normalizedMaxDelayMs = normalizePositiveInt(
    maxDelayMs,
    60000,
    { min: normalizedMinDelayMs, max: 60 * 60 * 1000 }
  );
  const normalizedBackoffMultiplier = normalizeNumberInRange(backoffMultiplier, 2, { min: 1, max: 5 });
  const normalizedJitterRatio = normalizeNumberInRange(jitterRatio, 0.2, { min: 0, max: 1 });
  const normalizedAttemptWindowMs = normalizePositiveInt(attemptWindowMs, 10 * 60 * 1000, {
    min: 60 * 1000,
    max: 24 * 60 * 60 * 1000,
  });
  const normalizedMaxAttemptsPerWindow = normalizePositiveInt(maxAttemptsPerWindow, 12, { min: 1, max: 10000 });
  const normalizedCooldownMs = normalizePositiveInt(cooldownMs, 2 * 60 * 1000, { min: 1000, max: 60 * 60 * 1000 });

  let pendingTimer = null;
  let currentAttempt = 0;
  let nextReconnectAt = 0;
  let lastDelayMs = 0;
  let lastReason = 'none';
  let lastStatusCode = 0;

  const attemptsInWindow = [];
  const counters = {
    scheduled: 0,
    alreadyPendingSkipped: 0,
    cooldownApplied: 0,
  };

  const trimAttempts = (nowTs = Date.now()) => {
    const minTs = nowTs - normalizedAttemptWindowMs;
    while (attemptsInWindow.length > 0 && attemptsInWindow[0] < minTs) {
      attemptsInWindow.shift();
    }
  };

  const clearPending = () => {
    if (!pendingTimer) return;
    clearTimeout(pendingTimer);
    pendingTimer = null;
    nextReconnectAt = 0;
  };

  const reset = () => {
    clearPending();
    currentAttempt = 0;
    attemptsInWindow.length = 0;
    lastDelayMs = 0;
    lastReason = 'none';
    lastStatusCode = 0;
  };

  const getSnapshot = () => ({
    pending: Boolean(pendingTimer),
    currentAttempt,
    attemptsInWindow: attemptsInWindow.length,
    attemptWindowMs: normalizedAttemptWindowMs,
    nextReconnectAt,
    lastDelayMs,
    lastReason,
    lastStatusCode,
    counters: {
      ...counters,
    },
    config: {
      minDelayMs: normalizedMinDelayMs,
      maxDelayMs: normalizedMaxDelayMs,
      backoffMultiplier: normalizedBackoffMultiplier,
      jitterRatio: normalizedJitterRatio,
      maxAttemptsPerWindow: normalizedMaxAttemptsPerWindow,
      cooldownMs: normalizedCooldownMs,
    },
  });

  const schedule = ({
    connect,
    reason = 'unspecified',
    statusCode = 0,
  } = {}) => {
    if (typeof connect !== 'function') {
      throw new Error('ReconnectController.schedule requires connect function');
    }

    if (pendingTimer) {
      counters.alreadyPendingSkipped += 1;
      return {
        scheduled: false,
        reason: 'already-pending',
        snapshot: getSnapshot(),
      };
    }

    const nowTs = Date.now();
    trimAttempts(nowTs);

    const baseDelayMs = Math.min(
      normalizedMaxDelayMs,
      Math.floor(normalizedMinDelayMs * (normalizedBackoffMultiplier ** currentAttempt))
    );
    currentAttempt += 1;

    let computedDelayMs = baseDelayMs;
    if (attemptsInWindow.length >= normalizedMaxAttemptsPerWindow) {
      counters.cooldownApplied += 1;
      computedDelayMs = Math.max(computedDelayMs, normalizedCooldownMs);
    }

    attemptsInWindow.push(nowTs);
    computedDelayMs = applyJitter(computedDelayMs, normalizedJitterRatio);

    lastDelayMs = computedDelayMs;
    lastReason = String(reason || 'unspecified');
    lastStatusCode = Number(statusCode) || 0;
    nextReconnectAt = nowTs + computedDelayMs;
    counters.scheduled += 1;

    pendingTimer = setTimeout(() => {
      clearPending();
      try {
        const result = connect();
        if (result && typeof result.then === 'function') {
          void result.catch(() => {});
        }
      } catch {
        // next disconnection will reschedule
      }
    }, computedDelayMs);

    if (typeof pendingTimer?.unref === 'function') {
      pendingTimer.unref();
    }

    return {
      scheduled: true,
      delayMs: computedDelayMs,
      snapshot: getSnapshot(),
    };
  };

  const close = () => {
    clearPending();
  };

  return {
    schedule,
    reset,
    close,
    getSnapshot,
  };
}
