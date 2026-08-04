/**
 * Audit bus — coleta/agrega eventos do runtime do bot fun em um histórico em anel
 * e monta o `AuditSnapshot` consumido pelo renderer (TUI) ou pelo plainLogger.
 *
 * Núcleo testável: tudo é in-memory, sem I/O, sem rede. Injeção de fontes via
 * fábrica (snapshots das filas, métricas LLM, accessors de grupo etc.).
 *
 * Contrato: contracts/audit-events.md
 */

import { isWorldQuietHours } from '../utils/worldQuietHours.js';

/** Categorias válidas de auditoria. */
export const CATEGORIES = Object.freeze([
  'connection', 'world', 'market', 'economy', 'chaos',
  'news', 'self-heal', 'memory', 'persona', 'challenge',
  'restock', 'birthday', 'llm', 'queue', 'system',
]);

/** Mapeamento `results[].kind` → `AuditEntry.category` (relógio do mundo). */
export const KIND_TO_CATEGORY = Object.freeze({
  'self-heal': 'self-heal',
  'memory-extract': 'memory',
  'persona-social-hints': 'persona',
  'group-news': 'news',
  'market': 'market',
  'economy-tick': 'economy',
  'event': 'market',
  'chaos-event-warning': 'chaos',
  'chaos-event': 'chaos',
  'chaos-event-end': 'chaos',
  'challenge-expired': 'challenge',
  'challenge-launched': 'challenge',
  'restock': 'restock',
  'birthday': 'birthday',
});

const VALID_LEVELS = new Set(['ok', 'info', 'warn', 'error']);

/** Palavras/regex de conteúdo sensível — descartadas do detail. */
const NSFW_HINTS = /\b(nsfw|porn|xxx|erotic|explicit|nude)\b/i;
const PII_HINTS = /\d{6,}@s\.whatsapp\.net|@lid\b/i;

/**
 * Trunca um JID de grupo para exibição segura (FR-015).
 * Ex.: `120363abc…5678@g.us` → `…5678@g.us`
 * @param {string} jid
 * @param {number} [head=4]
 * @param {number} [tail=8]
 */
export function truncateJid(jid, head = 4, tail = 8) {
  const s = String(jid || '').trim();
  if (!s) return '';
  const at = s.indexOf('@');
  const domain = at > 0 ? s.slice(at) : '';
  const local = at > 0 ? s.slice(0, at) : s;
  if (local.length <= head + tail) return s;
  return `…${local.slice(-tail)}${domain}`;
}

/**
 * Sanitiza o scope: se for um JID de grupo (termina em @g.us), trunca;
 * se for nome amigável (sem @), mantém.
 * @param {string|null|undefined} scope
 */
export function sanitizeScope(scope) {
  const s = String(scope ?? '').trim();
  if (!s) return null;
  if (s.includes('@g.us')) return truncateJid(s);
  if (s.includes('@s.whatsapp.net') || s.includes('@lid')) return truncateJid(s);
  return s;
}

/**
 * Verifica se `detail` contém indícios de PII/NSFW (descarta entrada inteira).
 * @param {unknown} detail
 * @returns {boolean} true = 内容 sensível detectado
 */
export function hasSensitiveContent(detail) {
  if (detail == null) return false;
  try {
    const text = typeof detail === 'string' ? detail : JSON.stringify(detail);
    if (!text) return false;
    return NSFW_HINTS.test(text) || PII_HINTS.test(text);
  } catch {
    return false;
  }
}

/**
 * @param {object} [opts]
 * @param {number} [opts.maxHistory] limite do ring buffer
 * @param {number} [opts.startedAt] timestamp de início do processo
 * @param {object} [opts.sources] fontes injetadas (getSnapshot, getLlmMetrics, etc.)
 */
export function createAuditBus({
  maxHistory = 200,
  startedAt = Date.now(),
  sources = {},
} = {}) {
  const limit = Math.max(2, Math.min(2000, Math.floor(Number(maxHistory) || 200)));
  const history = [];
  const countersByCategory = new Map();
  const countersByKind = new Map();
  let discardedCount = 0;
  let lastSelfHealSweepAt = null;
  let selfHealCounters = { applied: 0, rejected: 0, pending: 0, failed: 0 };

  /**
   * Registra um evento de auditoria.
   * @param {object} entry
   * @returns {object|null} entrada normalizada ou null se descartada
   */
  function emit(entry = {}) {
    if (!entry || typeof entry !== 'object') return null;
    const ts = Number(entry.ts) || Date.now();
    const category = CATEGORIES.includes(entry.category) ? entry.category : 'system';
    const level = VALID_LEVELS.has(entry.level) ? entry.level : 'info';
    const kind = String(entry.kind || '').slice(0, 64);
    const scope = sanitizeScope(entry.scope);
    const ok = entry.ok == null ? null : Boolean(entry.ok);

    // Guarda contra PII/NSFW no detail
    let detail = null;
    if (entry.detail != null) {
      if (hasSensitiveContent(entry.detail)) {
        discardedCount += 1;
        return null;
      }
      try {
        detail = JSON.parse(JSON.stringify(entry.detail));
      } catch {
        detail = { raw: String(entry.detail) };
      }
    }

    const normalized = { ts, category, level, kind, scope, ok, detail };

    history.push(normalized);
    while (history.length > limit) history.shift();

    const cBy = countersByCategory.get(category) || 0;
    countersByCategory.set(category, cBy + 1);
    if (kind) {
      const kBy = countersByKind.get(kind) || 0;
      countersByKind.set(kind, kBy + 1);
    }

    // Agrega self-heal: se kind_relacionado a self-heal, atualiza counters
    if (category === 'self-heal' && detail && typeof detail === 'object') {
      if (detail.lastSweepAt != null) lastSelfHealSweepAt = Number(detail.lastSweepAt) || null;
      if (detail.applied != null) selfHealCounters.applied = Number(detail.applied) || 0;
      if (detail.rejected != null) selfHealCounters.rejected = Number(detail.rejected) || 0;
      if (detail.pending != null) selfHealCounters.pending = Number(detail.pending) || 0;
      if (detail.failed != null) selfHealCounters.failed = Number(detail.failed) || 0;
    }

    return normalized;
  }

  /**
   * Registra o resultado de um tick do mundo, mapeando cada item de `results`
   * para a `Category` correspondente (FR-003, FR-004, FR-016).
   * @param {object} tickResult `{ fired, results, skipped, tookMs }`
   * @param {number} [tickAt] timestamp do tick
   */
  function recordWorldTick(tickResult = {}, tickAt = Date.now()) {
    const fired = Number(tickResult.fired) || 0;
    const results = Array.isArray(tickResult.results) ? tickResult.results : [];
    const tookMs = Number(tickResult.tookMs) || 0;
    const skipped = Boolean(tickResult.skipped) || tickResult.reason === 'quiet-hours';

    emit({
      ts: tickAt,
      category: 'world',
      level: skipped ? 'info' : (fired > 0 ? 'ok' : 'info'),
      kind: 'world-tick',
      scope: null,
      ok: true,
      detail: { fired, tookMs, skipped },
    });

    for (const r of results) {
      const kind = String(r?.kind || 'unknown');
      const category = KIND_TO_CATEGORY[kind] || 'system';
      const ok = r?.ok == null ? null : Boolean(r.ok);
      const scope = sanitizeScope(r?.scopeKey);
      const reason = r?.ok === false ? String(r.reason || 'unknown') : null;
      emit({
        ts: tickAt,
        category,
        level: ok === false ? 'warn' : (ok === true ? 'ok' : 'info'),
        kind,
        scope,
        ok,
        detail: reason ? { reason } : null,
      });
    }
  }

  /**
   * Monta o `AuditSnapshot` a partir das fontes injetadas + estado interno.
   * @param {object} [opts]
   * @param {object} [opts.funConfig] config normalizado (para quiet hours/flags)
   * @param {number} [opts.now] timestamp atual
   */
  function buildSnapshot({ funConfig = {}, now = Date.now() } = {}) {
    const meta = {
      startedAt,
      now,
      uptimeMs: now - startedAt,
      quietHours: {
        enabled: funConfig.worldQuietHoursEnabled !== false,
        active: isWorldQuietHours(funConfig, now),
        windowLabel: `${funConfig.worldQuietHourStart ?? 1}h–${funConfig.worldQuietHourEnd ?? 6}h`,
      },
    };

    const connection = sources.getConnection?.() || {
      state: 'offline',
      lastReason: null,
      lastStatusCode: null,
      reconnect: { pending: false, nextReconnectAt: null, currentAttempt: 0, lastDelayMs: null },
    };

    const world = sources.getWorld?.() || {
      enabled: Boolean(funConfig.worldAutonomous),
      tickMs: Number(funConfig.worldTickMs) || 45_000,
      lastTick: null,
      resultsByKind: new Map(),
    };

    const queues = sources.getQueues?.() || {
      command: { totalQueued: 0, totalRunning: 0, totalAccepted: 0, totalRejected: 0, totalCompleted: 0, totalFailed: 0 },
      output: { queued: 0, running: 0, accepted: 0, sent: 0, coalesced: 0, failed: 0, avgWaitMs: 0, p95WaitMs: 0, acceptedPerSecond: 0 },
    };

    const llm = sources.getLlm?.() || {
      byTask: {},
      invent: null,
      alert: null,
      lastByTask: null,
    };

    const selfHeal = {
      enabled: Boolean(funConfig.selfHealEnabled),
      dryRun: Boolean(funConfig.selfHealDryRun),
      lastSweepAt: lastSelfHealSweepAt,
      counters: { ...selfHealCounters },
    };

    const dashboard = sources.getDashboard?.() || { enabled: Boolean(funConfig.dashboardEnabled), started: false, url: null };

    const groups = sources.getGroups?.() || [];

    const config = {
      whitelistCount: Array.isArray(funConfig.groupWhitelistJids) ? funConfig.groupWhitelistJids.length : 0,
      worldAutonomous: Boolean(funConfig.worldAutonomous),
      economyEnabled: Boolean(funConfig.economyEnabled),
      propertiesEnabled: Boolean(funConfig.propertiesEnabled),
    };

    return {
      meta,
      connection,
      world,
      queues,
      llm,
      selfHeal,
      dashboard,
      groups,
      config,
      history: history.slice(),
      counters: {
        byCategory: new Map(countersByCategory),
        byKind: new Map(countersByKind),
      },
      discardedCount,
    };
  }

  return {
    emit,
    recordWorldTick,
    buildSnapshot,
    sanitizeScope,
    _internal: {
      history,
      limit,
      discardedCount: () => discardedCount,
      countersByCategory,
      countersByKind,
    },
  };
}
