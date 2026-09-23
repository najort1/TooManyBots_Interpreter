import { resolveLayaEndpoint } from './layaEndpoint.js';

export const CIRCUIT_STATE = Object.freeze({
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN',
});

/**
 * Cria o cliente HTTP do Laya Decision Service com timeout e Circuit Breaker.
 *
 * @param {object} options
 * @param {Function} options.getConfig - Função que retorna funConfig atual
 * @param {Function} [options.fetchImpl] - Implementação de fetch (injetável para testes)
 * @param {Function} [options.clock] - Relógio para medição de tempo e cooldowns
 * @param {Function} [options.getLogger] - Getter para logger do sistema
 */
export function createLayaClient({
  getConfig = () => ({}),
  fetchImpl = typeof fetch !== 'undefined' ? fetch : null,
  clock = () => Date.now(),
  getLogger = () => null,
} = {}) {
  let circuitState = CIRCUIT_STATE.CLOSED;
  let consecutiveFailures = 0;
  let lastFailureTime = 0;

  function resetCircuit() {
    circuitState = CIRCUIT_STATE.CLOSED;
    consecutiveFailures = 0;
    lastFailureTime = 0;
  }

  function recordFailure(now, threshold) {
    consecutiveFailures += 1;
    lastFailureTime = now;
    if (consecutiveFailures >= threshold) {
      circuitState = CIRCUIT_STATE.OPEN;
      getLogger()?.warn?.(
        '[layaClient] Circuit Breaker ABERTO após %d falhas consecutivas',
        consecutiveFailures
      );
    }
  }

  function recordSuccess() {
    if (circuitState !== CIRCUIT_STATE.CLOSED) {
      getLogger()?.info?.('[layaClient] Circuit Breaker restaurado para CLOSED');
    }
    resetCircuit();
  }

  async function predict({ task = 'general', state, questions, options = null, timeoutMs = null }) {
    if (!fetchImpl) {
      return { ok: false, provider: 'laya', task, reason: 'fetch-unavailable', fallback: true };
    }

    const config = getConfig() || {};
    const endpoint = resolveLayaEndpoint(config);
    const failureThreshold = Math.max(1, Number(config.layaCircuitFailureThreshold) || 3);
    const cooldownMs = Math.max(1000, Number(config.layaCircuitCooldownMs) || 10_000);
    const effectiveTimeoutMs = timeoutMs ?? endpoint.timeoutMs;
    const now = clock();

    // Verificação do Circuit Breaker
    if (circuitState === CIRCUIT_STATE.OPEN) {
      if (now - lastFailureTime > cooldownMs) {
        circuitState = CIRCUIT_STATE.HALF_OPEN;
        getLogger()?.debug?.('[layaClient] Circuit Breaker em HALF_OPEN — testando sonda');
      } else {
        return { ok: false, provider: 'laya', task, reason: 'circuit-open', fallback: true };
      }
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timer = null;
    if (controller && effectiveTimeoutMs > 0) {
      timer = setTimeout(() => {
        try {
          controller.abort(new Error(`laya-timeout-${effectiveTimeoutMs}ms`));
        } catch {
          // fallback se abort não aceitar argumento
          controller.abort();
        }
      }, effectiveTimeoutMs);
    }

    const t0 = clock();
    try {
      const url = `${endpoint.baseUrl}/predict`;
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'TooManyBots-LayaClient/1.0',
        },
        body: JSON.stringify({
          task,
          state,
          questions,
          options,
        }),
        signal: controller?.signal,
      });

      if (!response.ok) {
        recordFailure(now, failureThreshold);
        return {
          ok: false,
          provider: 'laya',
          task,
          reason: `http-${response.status}`,
          fallback: true,
        };
      }

      const data = await response.json();
      recordSuccess();

      const elapsed = clock() - t0;
      return {
        ok: true,
        provider: 'laya',
        task,
        model: data.model || endpoint.model,
        answers: data.answers || {},
        usage: data.usage || null,
        latencyMs: elapsed,
        fallback: false,
      };
    } catch (err) {
      recordFailure(now, failureThreshold);
      const isTimeout =
        err?.name === 'AbortError' ||
        String(err?.message || '').includes('timeout') ||
        controller?.signal?.aborted;
      const reason = isTimeout ? `timeout-${effectiveTimeoutMs}ms` : (err?.message || 'network-error');

      return {
        ok: false,
        provider: 'laya',
        task,
        reason,
        fallback: true,
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function health({ timeoutMs = 2000 } = {}) {
    if (!fetchImpl) return { ok: false, reason: 'fetch-unavailable' };
    const config = getConfig() || {};
    const endpoint = resolveLayaEndpoint(config);
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timer = null;
    if (controller && timeoutMs > 0) {
      timer = setTimeout(() => controller.abort(), timeoutMs);
    }

    try {
      const resp = await fetchImpl(`${endpoint.baseUrl}/health`, {
        method: 'GET',
        headers: { 'User-Agent': 'TooManyBots-LayaClient/1.0' },
        signal: controller?.signal,
      });
      if (!resp.ok) return { ok: false, status: resp.status };
      const data = await resp.json();
      return { ok: true, data };
    } catch (err) {
      return { ok: false, reason: err?.message || 'error' };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return {
    predict,
    health,
    getCircuitState: () => ({
      state: circuitState,
      failures: consecutiveFailures,
      lastFailureTime,
    }),
    resetCircuit,
  };
}
