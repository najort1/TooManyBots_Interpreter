/**
 * API Metrics Module
 * Coleta e armazena métricas de latência e uptime de APIs externas
 * Usa RingBuffer para O(1) e mínima pressão de GC
 */

/**
 * RingBuffer circular para manter histórico de métricas em memória
 */
class RingBuffer {
  constructor(size) {
    this.size = size;
    this.buffer = new Array(size);
    this.index = 0;
    this.count = 0;
  }

  push(value) {
    this.buffer[this.index] = value;
    this.index = (this.index + 1) % this.size;
    if (this.count < this.size) this.count++;
  }

  values() {
    const vals = [];
    for (let i = 0; i < this.count; i++) {
      const idx = (this.index - 1 - i + this.size) % this.size;
      vals.push(this.buffer[idx]);
    }
    return vals;
  }

  clear() {
    this.buffer = new Array(this.size);
    this.index = 0;
    this.count = 0;
  }
}

// Store de métricas por API: Map<apiName, RingBuffer>
const metricsStore = new Map();
const DEFAULT_WINDOW_SIZE = 200; // Últimas 200 chamadas

/**
 * Extrai nome da API a partir da URL (host completo)
 * Deve ser compatível com extractApiHostFromTemplateUrl do index.js
 * @param {string} url
 * @returns {string}
 */
export function extractApiName(url) {
  const input = String(url ?? '').trim();
  if (!input) return 'host-desconhecido';

  // Remove template variables {{var}} para parsing
  const normalized = input.replace(/\{\{[^}]+\}\}/g, 'x');

  try {
    const parsed = new URL(normalized);
    return parsed.host || parsed.hostname || 'host-desconhecido';
  } catch {
    try {
      const parsedWithBase = new URL(normalized, 'http://localhost');
      if (parsedWithBase.host && parsedWithBase.host !== 'localhost') {
        return parsedWithBase.host;
      }
    } catch {
      // ignore
    }

    // Fallback: regex simples
    const match = normalized.match(/^(?:[a-z]+:\/\/)?([^\/\s?#]+)/i);
    return match ? match[1] : 'host-desconhecido';
  }
}

/**
 * Registra uma métrica de chamada HTTP
 * @param {Object} params
 * @param {string} params.apiName - Nome da API
 * @param {number} params.latencyMs - Latência em ms
 * @param {boolean} params.success - Se a chamada foi bem-sucedida
 * @param {number} [params.status] - HTTP status code
 * @param {boolean} [params.timeout] - Se foi timeout
 */
export function recordApiMetric({ apiName, latencyMs, success, status = null, timeout = false }) {
  if (!apiName || apiName === 'unknown') return;

  let buffer = metricsStore.get(apiName);
  if (!buffer) {
    buffer = new RingBuffer(DEFAULT_WINDOW_SIZE);
    metricsStore.set(apiName, buffer);
  }

  buffer.push({
    latencyMs,
    success,
    status,
    timeout,
    timestamp: Date.now(),
  });
}

/**
 * Determina se um erro conta como falha de saúde da API
 * 4xx = erro de uso (não conta)
 * 5xx, timeout, erro de rede = falha de saúde (conta)
 * @param {Object} params
 * @param {number} [params.status]
 * @param {boolean} [params.timeout]
 * @returns {boolean}
 */
function isHealthFailure({ status = null, timeout = false }) {
  if (timeout) return true;
  if (!status) return true; // erro de rede/DNS/etc
  if (status >= 500 && status <= 599) return true; // 5xx
  return false;
}

/**
 * Calcula estatísticas de uma lista de latências
 * @param {number[]} latencies
 * @returns {{avg: number|null, p95: number|null}}
 */
function calcStats(latencies) {
  if (!latencies.length) return { avg: null, p95: null };

  const sum = latencies.reduce((a, b) => a + b, 0);
  const avg = sum / latencies.length;

  const sorted = [...latencies].sort((a, b) => a - b);
  const idx95 = Math.floor(0.95 * (sorted.length - 1));
  const p95 = sorted[idx95];

  return { avg: Math.round(avg), p95: Math.round(p95) };
}

/**
 * Obtém métricas calculadas para uma API específica
 * @param {string} apiName
 * @returns {{avgLatencyMs: number, uptime: number, totalCalls: number, healthy: boolean}|null}
 */
export function getApiMetrics(apiName) {
  const buffer = metricsStore.get(apiName);
  if (!buffer || buffer.count === 0) return null;

  const values = buffer.values();
  const latencies = values.map(v => v.latencyMs);
  const stats = calcStats(latencies);

  // Uptime: sucessos / (sucessos + falhas de saúde)
  const healthFailures = values.filter(v => isHealthFailure(v)).length;
  const healthSuccesses = values.length - healthFailures;
  const uptime = values.length > 0 ? healthSuccesses / values.length : 1.0;

  // Health status: se uptime < 80% ou avg latency > 5000ms = degraded
  const healthy = uptime >= 0.8 && (stats.avg === null || stats.avg < 5000);

  return {
    avgLatencyMs: stats.avg ?? 0,
    p95LatencyMs: stats.p95 ?? 0,
    uptime: Math.round(uptime * 100) / 100, // 2 decimais
    totalCalls: values.length,
    healthy,
    lastCall: values[0]?.timestamp || null,
  };
}

/**
 * Lista todas as APIs com métricas disponíveis
 * @returns {Array<{name: string, avgLatencyMs: number, uptime: number, healthy: boolean}>}
 */
export function listApiMetrics() {
  const result = [];
  for (const [apiName, buffer] of metricsStore.entries()) {
    if (buffer.count === 0) continue;
    const metrics = getApiMetrics(apiName);
    if (metrics) {
      result.push({
        name: apiName,
        ...metrics,
      });
    }
  }
  return result;
}

/**
 * Limpa métricas de uma API específica ou todas
 * @param {string} [apiName] - Se omitido, limpa todas
 */
export function clearApiMetrics(apiName = null) {
  if (apiName) {
    metricsStore.delete(apiName);
  } else {
    metricsStore.clear();
  }
}

/**
 * Obtém métricas formatadas para o dashboard (compatível com apiHealth)
 * @returns {Array<{name: string, avgLatencyMs: number, uptime: number, status: string}>}
 */
export function getDashboardApiHealth() {
  const metrics = listApiMetrics();

  if (metrics.length === 0) {
    // Retorna default se não há métricas ainda
    return [{ name: 'Bot Backend', avgLatencyMs: 0, uptime: 1.0, status: 'healthy' }];
  }

  return metrics.map(m => ({
    name: m.name,
    avgLatencyMs: m.avgLatencyMs,
    uptime: m.uptime,
    status: m.healthy ? 'healthy' : 'degraded',
    p95LatencyMs: m.p95LatencyMs,
    totalCalls: m.totalCalls,
  }));
}
