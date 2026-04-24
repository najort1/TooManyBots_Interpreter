export function toText(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

export function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') return false;
  }
  return fallback;
}

function toRoundFn(mode = 'trunc') {
  const normalizedMode = String(mode ?? 'trunc').trim().toLowerCase();
  if (normalizedMode === 'floor') return Math.floor;
  if (normalizedMode === 'ceil') return Math.ceil;
  if (normalizedMode === 'round') return Math.round;
  return Math.trunc;
}

export function normalizeInt(
  value,
  fallback,
  {
    min = Number.MIN_SAFE_INTEGER,
    max = Number.MAX_SAFE_INTEGER,
    rounding = 'trunc',
    clamp = false,
    clampMin = clamp,
    clampMax = clamp,
  } = {}
) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;

  const roundFn = toRoundFn(rounding);
  const normalized = roundFn(n);

  if (normalized < min) {
    return clampMin ? min : fallback;
  }

  if (normalized > max) {
    return clampMax ? max : fallback;
  }

  return normalized;
}

export function normalizeNumberInRange(
  value,
  fallback,
  { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}
) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < min || n > max) return fallback;
  return n;
}

export function toPositiveNumber(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}
