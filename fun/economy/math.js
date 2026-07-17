/**
 * Helpers matemáticos do motor econômico (determinístico).
 */

export function clamp(n, lo, hi) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.min(hi, Math.max(lo, x));
}

export function lerp(a, b, t) {
  return a + (b - a) * clamp(t, 0, 1);
}

export function tanh(x) {
  const v = Number(x) || 0;
  if (v > 20) return 1;
  if (v < -20) return -1;
  const e2 = Math.exp(2 * v);
  return (e2 - 1) / (e2 + 1);
}

/** Box-Muller a partir de random() ∈ [0,1). */
export function gauss(random = Math.random) {
  let u = 0;
  let v = 0;
  // evita loop infinito se random() degenerar em 0
  for (let i = 0; i < 20 && u === 0; i++) u = random();
  for (let i = 0; i < 20 && v === 0; i++) v = random();
  if (u <= 0) u = 1e-12;
  if (v <= 0) v = 1e-12;
  if (u >= 1) u = 1 - 1e-12;
  if (v >= 1) v = 1 - 1e-12;
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function sampleRange([lo, hi], random = Math.random) {
  const a = Number(lo);
  const b = Number(hi);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  if (a === b) return a;
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  return min + random() * (max - min);
}

export function pickWeighted(entries, random = Math.random) {
  const list = (entries || []).filter((e) => e && (e.weight ?? 1) > 0);
  if (!list.length) return null;
  const total = list.reduce((s, e) => s + Number(e.weight || 1), 0);
  let r = random() * total;
  for (const e of list) {
    r -= Number(e.weight || 1);
    if (r <= 0) return e;
  }
  return list[list.length - 1];
}

export function fingerprintText(title = '', body = '') {
  const raw = `${title}\n${body}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = raw.split(' ').filter((w) => w.length > 3).slice(0, 12);
  return words.join('|').slice(0, 120);
}
