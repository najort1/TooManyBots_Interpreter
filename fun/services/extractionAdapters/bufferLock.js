/**
 * BufferLock: Gerenciador de concorrência e exclusão mútua assíncrona por escopo (scopeKey).
 *
 * Garante que operações como flush de buffer e reconciliação em um mesmo grupo
 * sejam executadas de forma sequencial, evitando sobreposição e perda de mensagens.
 */

export function createBufferLock() {
  /** @type {Map<string, Promise<any>>} */
  const scopeLocks = new Map();

  /**
   * Executa uma função assíncrona garantindo exclusão mútua para o `scopeKey` fornecido.
   *
   * @template T
   * @param {string} scopeKey
   * @param {() => Promise<T>|T} fn
   * @returns {Promise<T>}
   */
  async function withLock(scopeKey, fn) {
    const key = String(scopeKey || 'global');
    const previousPromise = scopeLocks.get(key) || Promise.resolve();

    let releaseLock;
    const currentPromise = new Promise((resolve) => {
      releaseLock = resolve;
    });

    // Encadeia a execução após a promessa anterior do mesmo escopo
    scopeLocks.set(key, previousPromise.then(() => currentPromise, () => currentPromise));

    try {
      await previousPromise;
      return await fn();
    } finally {
      releaseLock();
      // Limpeza de memória quando a fila do escopo esvazia
      if (scopeLocks.get(key) === currentPromise) {
        scopeLocks.delete(key);
      }
    }
  }

  /**
   * Verifica se há alguma operação em andamento para o escopo.
   *
   * @param {string} scopeKey
   * @returns {boolean}
   */
  function isLocked(scopeKey) {
    return scopeLocks.has(String(scopeKey || 'global'));
  }

  return {
    withLock,
    isLocked,
  };
}
