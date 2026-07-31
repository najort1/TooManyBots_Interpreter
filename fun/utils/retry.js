/**
 * Helper de retentativas genérico para promessas.
 *
 * withRetries(maxRetries, attemptFn):
 * - executa attemptFn até `1 + maxRetries` vezes (total = 1 chamada inicial + maxRetries retries).
 * - attemptFn recebe (attemptIndex iniciando em 0, prevFailure) e deve:
 *   - retornar/resolver { ok: true, ...payload } em sucesso,
 *   - retornar/resolver { ok: false, reason, ... } em falha controlada,
 *   - ou throw (capturado e tratado como falha transient, rejeição armazenada em prevFailure.err).
 * - Pode retornar 'break' como reason em prevFailure para parar imediatamente (ex.: provider desabilitado).
 * - Retorna sempre o último resultado (sucesso ou falha final).
 *
 * Não tem delay/backoff — chamadas em série imediatas. Quem chama controla timeouts via budget.
 */

const BREAK = 'break';

/**
 * @template T
 * @param {number} maxRetries número de retentativas após a primeira chamada.
 * @param {(attempt: number, prevFailure: any) => Promise<T> | T} attemptFn
 * @returns {Promise<T>}
 */
export async function withRetries(maxRetries, attemptFn) {
  const total = Math.max(1, Math.floor(Number(maxRetries) || 0) + 1);
  let last = null;
  let lastErr = null;
  for (let attempt = 0; attempt < total; attempt += 1) {
    try {
      const result = await attemptFn(attempt, last);
      if (result && result.ok) return result;
      last = result;
      // sinal de parada imediata (provider desabilitado, cfg off)
      if (result && result.reason === BREAK) return result;
      lastErr = null;
    } catch (err) {
      last = { ok: false, reason: err?.message || 'throw', err };
      lastErr = err;
    }
  }
  // garante retorno de falha consistente
  if (last && typeof last === 'object') return last;
  return { ok: false, reason: lastErr?.message || 'retries-exhausted', err: lastErr };
}

export { BREAK };
