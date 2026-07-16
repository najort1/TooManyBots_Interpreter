/**
 * Rate limit in-memory por IP (básico, single-process).
 * Reinicia com o processo Next.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX = 60;

export function rateLimit(
  key: string,
  opts?: { windowMs?: number; max?: number }
): { ok: boolean; remaining: number; resetAt: number; limit: number } {
  const windowMs = opts?.windowMs ?? DEFAULT_WINDOW_MS;
  const max = opts?.max ?? DEFAULT_MAX;
  const now = Date.now();

  let b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }

  b.count += 1;
  const remaining = Math.max(0, max - b.count);
  return {
    ok: b.count <= max,
    remaining,
    resetAt: b.resetAt,
    limit: max,
  };
}

/** Evita Map crescer sem limite */
export function pruneRateLimitBuckets() {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (now >= b.resetAt) buckets.delete(k);
  }
}

// prune ocasional
if (typeof setInterval !== "undefined") {
  setInterval(pruneRateLimitBuckets, 5 * 60_000).unref?.();
}
