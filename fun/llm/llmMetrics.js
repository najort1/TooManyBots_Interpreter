/**
 * Contadores em memória: provider × tarefa (zen/ollama/template).
 * Observabilidade leve + persistência durável via funLlmRepository quando configurado.
 */

const counts = new Map(); // key: `${task}:${provider}` → n
const lastByTask = new Map(); // task → { provider, at, detail }
const lastHttpErrorByTask = new Map(); // task → timestamp ms do último erro HTTP
const MAX_RECENT = 40;
const recentEvents = [];

let _llmRepository = null;

export function setLlmMetricsRepository(repo) {
  _llmRepository = repo;
}

export function getLlmMetricsRepository() {
  return _llmRepository;
}

function key(task, provider) {
  return `${String(task || '?')}:${String(provider || '?')}`;
}

/**
 * Registra uma chamada completa de telemetria com tokens, latência e persistência.
 */
export function recordLlmCall({
  createdAt = Date.now(),
  scopeKey = '',
  userJid = '',
  task = 'unknown',
  provider = 'zen',
  model = 'bot-zap',
  status = 'success',
  promptTokens = 0,
  completionTokens = 0,
  totalTokens = 0,
  durationMs = 0,
  promptPreview = '',
  responsePreview = '',
  errorMessage = '',
  costEstimated = null,
} = {}) {
  const t = String(task || 'unknown');
  const p = String(provider || 'unknown');
  const k = key(t, p);
  counts.set(k, (counts.get(k) || 0) + 1);

  const row = {
    task: t,
    provider: p,
    model: String(model || 'bot-zap'),
    status: String(status || 'success'),
    promptTokens: Number(promptTokens) || 0,
    completionTokens: Number(completionTokens) || 0,
    totalTokens: Number(totalTokens) || 0,
    durationMs: Number(durationMs) || 0,
    scopeKey: String(scopeKey || ''),
    userJid: String(userJid || ''),
    at: Number(createdAt) || Date.now(),
  };

  lastByTask.set(t, row);
  recentEvents.push(row);
  while (recentEvents.length > MAX_RECENT) recentEvents.shift();

  if (status === 'error' || status === 'timeout') {
    lastHttpErrorByTask.set(t, Date.now());
  }

  if (_llmRepository && typeof _llmRepository.recordCall === 'function') {
    try {
      _llmRepository.recordCall({
        createdAt,
        scopeKey,
        userJid,
        task: t,
        provider: p,
        model,
        status,
        promptTokens,
        completionTokens,
        totalTokens,
        durationMs,
        promptPreview,
        responsePreview,
        errorMessage,
        costEstimated,
      });
    } catch {
      // Falha de telemetria não pode derrubar o fluxo principal
    }
  }

  return row;
}

export function recordLlmHit(task, provider, detail = {}) {
  const t = String(task || 'unknown');
  const p = String(provider || 'unknown');
  const k = key(t, p);
  counts.set(k, (counts.get(k) || 0) + 1);
  const row = {
    task: t,
    provider: p,
    at: Date.now(),
    ...detail,
  };
  lastByTask.set(t, row);
  recentEvents.push(row);
  while (recentEvents.length > MAX_RECENT) recentEvents.shift();

  // Se for fallback template ou hit explícito não registrado via HTTP client, persiste.
  // Evita duplicar se foi precedido por erro/timeout HTTP recente (já registrado na chamada HTTP)
  if (p.startsWith('template') || detail.recordToDb) {
    const lastErrAt = lastHttpErrorByTask.get(t) || 0;
    const isDirectFallbackFromHttpError = (Date.now() - lastErrAt) < 3000;

    if (!isDirectFallbackFromHttpError && _llmRepository && typeof _llmRepository.recordCall === 'function') {
      try {
        _llmRepository.recordCall({
          createdAt: row.at,
          scopeKey: detail.scopeKey || detail.scope || '',
          userJid: detail.userJid || detail.user || '',
          task: t,
          provider: p,
          model: 'template',
          status: p === 'template-timeout' ? 'timeout' : 'fallback',
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          durationMs: Number(detail.durationMs) || 0,
          promptPreview: detail.scenario ? `Scenario: ${detail.scenario}` : '',
          responsePreview: detail.text || 'Static template response',
        });
      } catch {
        // Safe ignore
      }
    }
  }

  return row;
}

export function getLlmMetrics() {
  const byKey = {};
  for (const [k, n] of counts.entries()) byKey[k] = n;
  const byTask = {};
  for (const [t, row] of lastByTask.entries()) byTask[t] = row;
  // taxas invent
  const inventZen = (counts.get('invent:zen') || 0) + (counts.get('invent:zen-salvage') || 0);
  const inventOllama =
    (counts.get('invent:ollama') || 0) + (counts.get('invent:ollama-salvage') || 0);
  const inventTemplate = counts.get('invent:template') || 0;
  const inventTotal = inventZen + inventOllama + inventTemplate;
  return {
    counts: byKey,
    lastByTask: byTask,
    recent: recentEvents.slice(-20),
    invent: {
      zen: inventZen,
      ollama: inventOllama,
      template: inventTemplate,
      total: inventTotal,
      zenRate: inventTotal ? inventZen / inventTotal : 0,
      templateRate: inventTotal ? inventTemplate / inventTotal : 0,
    },
  };
}

export function resetLlmMetrics() {
  counts.clear();
  lastByTask.clear();
  lastHttpErrorByTask.clear();
  recentEvents.length = 0;
}

/** Alerta simples: invent template alto. */
export function inventTemplateAlert(threshold = 0.4, minSamples = 5) {
  const m = getLlmMetrics().invent;
  if (m.total < minSamples) return null;
  if (m.templateRate >= threshold) {
    return {
      level: 'warn',
      message: `invent templateRate=${(m.templateRate * 100).toFixed(0)}% (${m.template}/${m.total})`,
      ...m,
    };
  }
  return null;
}
