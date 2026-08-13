import { createIngestionQueue } from './ingestionQueue.js';

const QUEUE_CLASSES = {
  FAST: 'fast',
  STATE: 'state',
  HEAVY: 'heavy',
};

const CLASS_ORDER = [QUEUE_CLASSES.FAST, QUEUE_CLASSES.STATE, QUEUE_CLASSES.HEAVY];

const LLM_BOUND_COMMAND_HEADS = new Set([
  'tarot', 'taro', 'vidente',
  'ship',
  'qmp', 'quememaisprovavel', 'maisprovavel', 'mostlikely',
  'roletarussa', 'roleta_russa', 'russianroulette', 'rr',
  'puxar', 'gatilho', 'pull',
  'cancelar', 'cancelamento', 'cancel',
  'fofoca', 'rumor', 'gossip',
  'oraculo', 'oraculomaldito', 'oraculomaluco', 'perguntamaluca',
  'illuminati', 'iluminati', 'conspiracao', 'teoria',
  'roast', 'zoar', 'humilhar',
  'assaltar', 'assalto', 'roubar', 'assault', 'crime',
  'gerar', 'gerarimagem', 'imagem', 'create', 'imaginar', 'imagine', 'desenhar', 'render',
]);

const PER_ACTOR_LLM_COMMAND_HEADS = new Set([
  'tarot', 'taro', 'vidente',
  'ship',
]);

function commandHead(commandText = '') {
  return String(commandText ?? '')
    .trim()
    .replace(/^\//, '')
    .split(/\s+/, 1)[0]
    ?.toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9_]/g, '') || '';
}

export function isLlmBoundCommand(commandText = '') {
  return LLM_BOUND_COMMAND_HEADS.has(commandHead(commandText));
}

export function isPerActorLlmCommand(commandText = '') {
  return PER_ACTOR_LLM_COMMAND_HEADS.has(commandHead(commandText));
}

function computeClass(commandText = '', messageType = '') {
  const text = String(commandText ?? '').trim().toLowerCase();
  if (!text && !messageType) return QUEUE_CLASSES.FAST;

  if (messageType === 'image' || messageType === 'video' || messageType === 'document' || messageType === 'audio') {
    return QUEUE_CLASSES.HEAVY;
  }

  if (isLlmBoundCommand(text)) {
    return QUEUE_CLASSES.HEAVY;
  }

  const heavyPrefixes = ['fig', 'gif', 'imagine', 'draw', 'img', 'sticker', 'toimg', 'togif', 'llm', 'ia', 'ai'];
  for (const p of heavyPrefixes) {
    if (text.startsWith(p) || text.startsWith('/' + p)) {
      return QUEUE_CLASSES.HEAVY;
    }
  }

  const statePrefixes = [
    'bet', 'aposta', 'roll', 'roleta', 'rival', 'duel', 'duelo',
    'buy', 'comprar', 'sell', 'vender', 'invest', 'investir',
    'vote', 'votar', 'bingo', 'leilao',
    'empresa', 'company', 'negocio',
  ];
  for (const p of statePrefixes) {
    if (text.startsWith(p) || text.startsWith('/' + p)) {
      return QUEUE_CLASSES.STATE;
    }
  }

  return QUEUE_CLASSES.FAST;
}

export function createCommandQueueManager({
  maxConcurrency = 8,
  fastConcurrency = 4,
  stateConcurrency = 2,
  heavyConcurrency = 1,
  maxQueueSize = 5000,
  warnThreshold = 1000,
  fastTaskTimeoutMs = 15000,
  stateTaskTimeoutMs = 30000,
  heavyTaskTimeoutMs = 60000,
  fastMaxDurationMs = 10000,
  stateMaxDurationMs = 30000,
  heavyMaxDurationMs = 120000,
  onWarn = null,
} = {}) {
  const queues = {};
  const classConfigs = {
    fast: {
      concurrency: Math.max(1, fastConcurrency),
      maxQueueSize: Math.max(1, Math.ceil(maxQueueSize * 0.5)),
      warnThreshold: Math.max(1, Math.ceil(warnThreshold * 0.5)),
      taskTimeoutMs: Math.max(0, fastTaskTimeoutMs),
      maxTaskDurationMs: Math.max(0, fastMaxDurationMs),
    },
    state: {
      concurrency: Math.max(1, stateConcurrency),
      maxQueueSize: Math.max(1, Math.ceil(maxQueueSize * 0.3)),
      warnThreshold: Math.max(1, Math.ceil(warnThreshold * 0.3)),
      taskTimeoutMs: Math.max(0, stateTaskTimeoutMs),
      maxTaskDurationMs: Math.max(0, stateMaxDurationMs),
    },
    heavy: {
      concurrency: Math.max(1, heavyConcurrency),
      maxQueueSize: Math.max(1, Math.ceil(maxQueueSize * 0.2)),
      warnThreshold: Math.max(1, Math.ceil(warnThreshold * 0.2)),
      taskTimeoutMs: Math.max(0, heavyTaskTimeoutMs),
      maxTaskDurationMs: Math.max(0, heavyMaxDurationMs),
    },
  };

  const totalConcurrencyLimit = Math.max(1, maxConcurrency);

  const serialQueues = new Map();

  function runSerial(serialKey, fn) {
    const prev = serialQueues.get(serialKey) || Promise.resolve();
    const next = prev.then(
      () => fn(),
      () => fn()
    );
    const cleanup = next.catch(() => {}).then(() => {
      if (serialQueues.get(serialKey) === cleanup) {
        serialQueues.delete(serialKey);
      }
    });
    serialQueues.set(serialKey, cleanup);
    return next;
  }

  for (const klass of CLASS_ORDER) {
    const cfg = classConfigs[klass];
    queues[klass] = createIngestionQueue({
      concurrency: cfg.concurrency,
      maxQueueSize: cfg.maxQueueSize,
      warnThreshold: cfg.warnThreshold,
      taskTimeoutMs: cfg.taskTimeoutMs,
      maxTaskDurationMs: cfg.maxTaskDurationMs,
      onWarn: onWarn ? () => onWarn(klass) : null,
    });
  }

  function enqueue({ key, payload, handler, priority = 'high', commandText = '', messageType = '', serializationKey = '' }) {
    const klass = computeClass(commandText, messageType);
    const queue = queues[klass];

    const normalizedSerialKey = String(serializationKey ?? '').trim();
    const wrappedHandler = normalizedSerialKey
      ? (p, ctx) => runSerial(normalizedSerialKey, () => handler(p, ctx))
      : handler;

    const result = queue.enqueue({ key, payload, handler: wrappedHandler, priority });
    return {
      accepted: result.accepted,
      reason: result.accepted ? null : result.reason,
      queueClass: klass,
      serialKey: normalizedSerialKey || null,
      snapshot: result.snapshot,
    };
  }

  function cancelPending(key) {
    let total = 0;
    for (const klass of CLASS_ORDER) {
      total += queues[klass].cancelPending(key);
    }
    return total;
  }

  function resolveQueue(klass) {
    return queues[klass] || null;
  }

  function getSnapshot() {
    const snapshots = {};
    let totalQueued = 0;
    let totalRunning = 0;
    let totalAccepted = 0;
    let totalRejected = 0;
    let totalCompleted = 0;
    let totalFailed = 0;

    for (const klass of CLASS_ORDER) {
      const s = queues[klass].getSnapshot();
      snapshots[klass] = s;
      totalQueued += s.queued;
      totalRunning += s.running;
      totalAccepted += s.accepted;
      totalRejected += s.rejected;
      totalCompleted += s.completed;
      totalFailed += s.failed;
    }

    return {
      queues: snapshots,
      totalQueued,
      totalRunning,
      totalAccepted,
      totalRejected,
      totalCompleted,
      totalFailed,
      totalConcurrencyLimit,
      updatedAt: Date.now(),
    };
  }

  async function onIdle() {
    const promises = CLASS_ORDER.map(klass => queues[klass].onIdle());
    await Promise.all(promises);
  }

  return {
    enqueue,
    cancelPending,
    resolveQueue,
    getSnapshot,
    onIdle,
    computeClass,
    QUEUE_CLASSES,
  };
}
