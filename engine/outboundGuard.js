/**
 * Proteção de saída WhatsApp — rate limit + gap + anti-texto-idêntico.
 * Reduz risco de ban por flood (msgs/min, msgs/hora, rajada no mesmo chat).
 */

import { createHash } from 'node:crypto';
import { delay } from '../utils/async.js';

function envInt(name, fallback, { min = 0, max = 1_000_000 } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function envBool(name, fallback = true) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const t = String(raw).trim().toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(t)) return false;
  if (['1', 'true', 'yes', 'on'].includes(t)) return true;
  return fallback;
}

/** Defaults conservadores para bot de grupo. Override via env. */
export function getOutboundGuardConfig() {
  return {
    enabled: envBool('TMB_OUTBOUND_GUARD', true),
    /** teto global (todas as conversas) */
    maxPerMinute: envInt('TMB_OUTBOUND_MAX_PER_MIN', 25, { min: 1, max: 500 }),
    maxPerHour: envInt('TMB_OUTBOUND_MAX_PER_HOUR', 400, { min: 10, max: 50_000 }),
    /** teto por JID (grupo ou PV) */
    maxPerJidPerMinute: envInt('TMB_OUTBOUND_MAX_PER_JID_MIN', 12, { min: 1, max: 120 }),
    maxPerJidPerHour: envInt('TMB_OUTBOUND_MAX_PER_JID_HOUR', 120, { min: 5, max: 5_000 }),
    /** intervalo mínimo entre dois envios pro mesmo JID */
    minGapMs: envInt('TMB_OUTBOUND_MIN_GAP_MS', 900, { min: 0, max: 30_000 }),
    /** bloquear texto byte-a-byte idêntico no mesmo JID por N ms */
    identicalCooldownMs: envInt('TMB_OUTBOUND_IDENTICAL_MS', 8_000, { min: 0, max: 300_000 }),
    /** indicador "digitando…" antes de texto */
    typingEnabled: envBool('TMB_OUTBOUND_TYPING', true),
    typingMinMs: envInt('TMB_OUTBOUND_TYPING_MIN_MS', 350, { min: 0, max: 5_000 }),
    typingMaxMs: envInt('TMB_OUTBOUND_TYPING_MAX_MS', 1_800, { min: 0, max: 8_000 }),
    /** ms de espera quando o limite estoura (em vez de drop silencioso) */
    waitCapMs: envInt('TMB_OUTBOUND_WAIT_CAP_MS', 15_000, { min: 0, max: 120_000 }),
  };
}

function textFingerprint(text) {
  const s = String(text ?? '');
  if (!s) return '';
  return createHash('sha1').update(s).digest('hex').slice(0, 16);
}

function prune(timestamps, now, windowMs) {
  const cut = now - windowMs;
  while (timestamps.length && timestamps[0] < cut) timestamps.shift();
}

/**
 * @returns {{
 *   acquire: (jid: string, meta?: { text?: string, kind?: string, skipTyping?: boolean }) => Promise<{ ok: boolean, waitedMs: number, reason?: string, typingMs?: number }>,
 *   record: (jid: string, meta?: { text?: string }) => void,
 *   stats: () => object,
 *   reset: () => void,
 *   config: () => object,
 * }}
 */
export function createOutboundGuard(options = {}) {
  const cfg = { ...getOutboundGuardConfig(), ...options };
  /** @type {number[]} */
  const globalTs = [];
  /** @type {Map<string, number[]>} */
  const jidTs = new Map();
  /** @type {Map<string, number>} */
  const lastSendAt = new Map();
  /** @type {Map<string, { hash: string, at: number }>} */
  const lastText = new Map();
  let dropped = 0;
  let waitedTotal = 0;

  function listFor(jid) {
    const key = String(jid || '');
    if (!jidTs.has(key)) jidTs.set(key, []);
    return jidTs.get(key);
  }

  function typingMsFor(text) {
    if (!cfg.typingEnabled) return 0;
    const len = String(text || '').length;
    if (len <= 0) return 0;
    // ~28ms/char, clamp
    const raw = Math.floor(len * 28);
    return Math.min(cfg.typingMaxMs, Math.max(cfg.typingMinMs, raw));
  }

  /**
   * Espera o slot liberar (ou falha se waitCap).
   */
  async function acquire(jid, meta = {}) {
    if (!cfg.enabled) {
      return { ok: true, waitedMs: 0, typingMs: typingMsFor(meta.text) };
    }

    const key = String(jid || '');
    const hash = meta.text != null ? textFingerprint(meta.text) : '';
    let waitedMs = 0;
    const started = Date.now();

    // anti-idêntico imediato
    if (hash && cfg.identicalCooldownMs > 0) {
      const prev = lastText.get(key);
      if (prev && prev.hash === hash && started - prev.at < cfg.identicalCooldownMs) {
        dropped += 1;
        return {
          ok: false,
          waitedMs: 0,
          reason: 'identical-text',
          typingMs: 0,
        };
      }
    }

    // espera rate limits (com cap)
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const now = Date.now();
      // rebuild global prune for minute
      prune(globalTs, now, 3_600_000);
      const gMin = globalTs.filter((t) => t >= now - 60_000);
      const gHour = globalTs;
      const jArr = listFor(key);
      prune(jArr, now, 3_600_000);
      const jMin = jArr.filter((t) => t >= now - 60_000);
      const jHour = jArr;

      let need = 0;
      if (gMin.length >= cfg.maxPerMinute) need = Math.max(need, gMin[0] + 60_000 - now);
      if (gHour.length >= cfg.maxPerHour) need = Math.max(need, gHour[0] + 3_600_000 - now);
      if (jMin.length >= cfg.maxPerJidPerMinute) need = Math.max(need, jMin[0] + 60_000 - now);
      if (jHour.length >= cfg.maxPerJidPerHour) need = Math.max(need, jHour[0] + 3_600_000 - now);
      const last = lastSendAt.get(key) || 0;
      if (cfg.minGapMs > 0 && last > 0) {
        need = Math.max(need, last + cfg.minGapMs - now);
      }

      if (need <= 0) break;

      if (waitedMs + need > cfg.waitCapMs) {
        dropped += 1;
        return {
          ok: false,
          waitedMs,
          reason: 'rate-limit',
          typingMs: 0,
        };
      }
      const sleep = Math.min(need, 2_000);
      await delay(sleep);
      waitedMs = Date.now() - started;
    }

    waitedTotal += waitedMs;
    return {
      ok: true,
      waitedMs,
      typingMs: meta.skipTyping ? 0 : typingMsFor(meta.text),
    };
  }

  function record(jid, meta = {}) {
    if (!cfg.enabled) return;
    const now = Date.now();
    const key = String(jid || '');
    globalTs.push(now);
    prune(globalTs, now, 3_600_000);
    const arr = listFor(key);
    arr.push(now);
    prune(arr, now, 3_600_000);
    lastSendAt.set(key, now);
    if (meta.text != null) {
      lastText.set(key, { hash: textFingerprint(meta.text), at: now });
    }
  }

  function stats() {
    return {
      globalLastMinute: globalTs.filter((t) => t >= Date.now() - 60_000).length,
      globalLastHour: globalTs.filter((t) => t >= Date.now() - 3_600_000).length,
      dropped,
      waitedTotalMs: waitedTotal,
      config: { ...cfg },
    };
  }

  function reset() {
    globalTs.length = 0;
    jidTs.clear();
    lastSendAt.clear();
    lastText.clear();
    dropped = 0;
    waitedTotal = 0;
  }

  return {
    acquire,
    record,
    stats,
    reset,
    config: () => ({ ...cfg }),
  };
}

/** Singleton de processo — shared entre Fun e TMB se usarem engine/sender. */
let defaultGuard = null;

export function getDefaultOutboundGuard() {
  if (!defaultGuard) defaultGuard = createOutboundGuard();
  return defaultGuard;
}

export function resetDefaultOutboundGuard() {
  defaultGuard?.reset();
  defaultGuard = null;
}
