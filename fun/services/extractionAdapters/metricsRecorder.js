/**
 * Gravador de métricas e telemetria para o pipeline de extração e seus adaptadores.
 */

export function createMetricsRecorder({
  enabled = false,
  sink = 'stdout',
  logger = null,
} = {}) {
  const events = [];

  function record(metricName, data = {}) {
    if (!enabled) return;

    const entry = {
      metric: String(metricName || 'unknown'),
      data,
      at: Date.now(),
    };

    events.push(entry);
    if (events.length > 500) events.shift(); // buffer circular

    if (sink === 'stdout' || sink === 'console') {
      const formatted = `[extract-metrics] ${entry.metric}: ${JSON.stringify(data)}`;
      if (logger?.debug) {
        logger.debug(formatted);
      } else if (logger?.info) {
        logger.info(formatted);
      }
    }
  }

  function getMetrics() {
    return [...events];
  }

  function clear() {
    events.length = 0;
  }

  return {
    record,
    getMetrics,
    clear,
    isEnabled: () => Boolean(enabled),
  };
}
