/**
 * In-memory circular ring buffer para logs operacionais em tempo real da dashboard.
 * Não depende de arquivos externos, ultra-leve e thread-safe para Node.js single-thread.
 */

class LogBuffer {
  constructor(capacity = 1000) {
    this.capacity = capacity;
    this.buffer = [];
    this.counter = 0;
    this.dropped = 0;

    // Sementes iniciais para contextualizar o dashboard
    this.add({
      level: 'info',
      domain: 'system',
      message: 'Fun Dashboard Server operacional e escutando requisições',
      details: { uptime: Math.floor(process.uptime()), memory: process.memoryUsage().rss },
    });
    this.add({
      level: 'info',
      domain: 'whatsapp',
      message: 'Subsistema de conexão e polling ativo',
    });
    this.add({
      level: 'info',
      domain: 'economy',
      message: 'Regulador econômico e monitor de liquidez inicializados',
    });
  }

  add({ level = 'info', domain = 'system', message = '', scope = '', details = null }) {
    this.counter++;
    const entry = {
      id: `log-${Date.now()}-${this.counter}`,
      timestamp: Date.now(),
      level: String(level).toLowerCase(),
      domain: String(domain).toLowerCase(),
      message: String(message),
      scope: scope ? String(scope) : undefined,
      details: details && typeof details === 'object' ? details : undefined,
    };

    if (this.buffer.length >= this.capacity) {
      this.buffer.shift();
      this.dropped++;
    }
    this.buffer.push(entry);
    return entry;
  }

  getLogs({ since = 0, limit = 100, level, domain, search, scope } = {}) {
    let list = this.buffer;

    if (since > 0) {
      list = list.filter((l) => l.timestamp > since);
    }
    if (level && level !== 'all') {
      const lvl = String(level).toLowerCase();
      list = list.filter((l) => l.level === lvl);
    }
    if (domain && domain !== 'all') {
      const dom = String(domain).toLowerCase();
      list = list.filter((l) => l.domain === dom);
    }
    if (scope && scope !== 'all') {
      list = list.filter((l) => !l.scope || l.scope === scope);
    }
    if (search && search.trim()) {
      const term = search.trim().toLowerCase();
      list = list.filter(
        (l) =>
          l.message.toLowerCase().includes(term) ||
          (l.scope && l.scope.toLowerCase().includes(term)) ||
          l.domain.toLowerCase().includes(term) ||
          l.level.toLowerCase().includes(term)
      );
    }

    const total = list.length;
    const cappedLimit = Math.max(1, Math.min(500, Number(limit) || 100));
    const logs = list.slice(-cappedLimit);

    const lastTimestamp = logs.length > 0
      ? logs[logs.length - 1].timestamp
      : (since > 0 ? Number(since) : (this.buffer.length > 0 ? this.buffer[this.buffer.length - 1].timestamp : Date.now()));

    return {
      logs,
      total,
      bufferCapacity: this.capacity,
      dropped: this.dropped,
      lastTimestamp,
    };
  }

  clear() {
    this.buffer = [];
  }
}

// Singleton global para a instância do dashboard
let globalLogBuffer = null;

export { LogBuffer };
export function getLogBuffer(capacity = 1000) {
  if (!globalLogBuffer) {
    globalLogBuffer = new LogBuffer(capacity);
  }
  return globalLogBuffer;
}
