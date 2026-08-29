export function percentile(values, ratio) {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.min(ordered.length - 1, Math.max(0, Math.ceil(ordered.length * ratio) - 1));
  return ordered[index];
}

export function summarizeFrameDurations(values) {
  if (!values.length) return { averageFps: 0, p95FrameMs: 0, samples: 0 };
  const averageFrameMs = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    averageFps: averageFrameMs > 0 ? 1000 / averageFrameMs : 0,
    p95FrameMs: percentile(values, 0.95),
    samples: values.length,
  };
}
