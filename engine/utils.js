/**
 * engine/utils.js
 *
 * Utilitários compartilhados pelo engine e handlers.
 * - safeParseJSON: parse seguro com fallback
 * - LRUCache: cache de tamanho fixo com evicção por TTL e LRU
 * - interpolate: substituição de variáveis em strings (sessão + sistema)
 */

/**
 * Parse seguro de JSON. Nunca lança exceção.
 * @param {string} text   - string JSON
 * @param {*} fallback    - valor retornado em caso de falha (default: null)
 * @returns {*}
 */
export function safeParseJSON(text, fallback = null) {
  if (text == null || text === '') return fallback;
  try {
    return JSON.parse(text);
  } catch {
    console.warn(`[safeParseJSON] Falha ao parsear JSON, usando fallback.`, { text: String(text).substring(0, 100) });
    return fallback;
  }
}

/**
 * Cache LRU com TTL.
 * Substitui a abordagem Set + Array.from().slice() por uma estrutura eficiente O(1).
 */
export class LRUCache {
  /**
   * @param {number} maxSize - Tamanho máximo do cache
   * @param {number} ttlMs   - Tempo de vida em ms (0 = sem TTL)
   */
  constructor(maxSize = 2000, ttlMs = 0) {
    this._maxSize = maxSize;
    this._ttlMs = ttlMs;
    /** @type {Map<string, number>} key → timestamp */
    this._map = new Map();
  }

  /**
   * Verifica se o valor existe (e não expirou).
   */
  has(key) {
    if (!this._map.has(key)) return false;
    if (this._ttlMs > 0) {
      const ts = this._map.get(key);
      if (Date.now() - ts > this._ttlMs) {
        this._map.delete(key);
        return false;
      }
    }
    return true;
  }

  /**
   * Adiciona ao cache. Se estiver cheio, remove o mais antigo (primeiro entry do Map).
   */
  add(key) {
    // Se já existe, atualizar timestamp (mover para o final do Map)
    if (this._map.has(key)) {
      this._map.delete(key);
    }
    this._map.set(key, Date.now());

    // Evicção se exceder tamanho máximo
    if (this._map.size > this._maxSize) {
      // Map mantém ordem de inserção; o primeiro é o mais antigo
      const oldest = this._map.keys().next().value;
      this._map.delete(oldest);
    }
  }

  get size() {
    return this._map.size;
  }
}

/**
 * Substitui placeholders {{variableName}} em uma string com variáveis da sessão.
 */
function pad2(value) {
  return String(value).padStart(2, '0');
}

function getSystemInterpolationVariables(now = new Date()) {
  const year = String(now.getFullYear());
  const month = pad2(now.getMonth() + 1);
  const day = pad2(now.getDate());
  const hour = pad2(now.getHours());
  const minute = pad2(now.getMinutes());
  const second = pad2(now.getSeconds());
  const timestampMs = String(now.getTime());
  const unix = String(Math.floor(now.getTime() / 1000));
  const date = `${year}-${month}-${day}`;
  const time = `${hour}:${minute}:${second}`;
  const datetime = `${date} ${time}`;

  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    timestamp: timestampMs,
    unix,
    date,
    time,
    datetime,
    today: date,
    now: datetime,
    current_year: year,
    current_month: month,
    current_day: day,
    ano: year,
    mes: month,
    dia: day,
  };
}

export function interpolate(text, variables = {}) {
  if (typeof text !== 'string') return text;
  const systemVars = getSystemInterpolationVariables(new Date());

  return text.replace(/\{\{\s*\$?\s*([\w_]+)\s*\}\}/g, (_, key) => {
    const value = variables[key] ?? systemVars[key] ?? '';
    if (value == null) return '';
    return String(value);
  });
}
