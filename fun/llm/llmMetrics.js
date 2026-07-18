/**
 * Contadores em memória: provider × tarefa (zen/ollama/template).
 * Observabilidade leve — sem DB.
 */

const counts = new Map(); // key: `${task}:${provider}` → n
const lastByTask = new Map(); // task → { provider, at, detail }
const MAX_RECENT = 40;
const recentEvents = [];

function key(task, provider) {
  return `${String(task || '?')}:${String(provider || '?')}`;
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
