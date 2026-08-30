/**
 * Factory central de adaptadores de extração do bot Fun.
 * Instancia os adaptadores e wrappers respeitando as feature flags definidas em funConfig.
 */

import { guardBatchFacts } from './parseGuard.js';
import { enrichFactsWithEvidence } from './evidenceEnricher.js';
import { createBufferLock } from './bufferLock.js';
import { dedupBatchBeforeExtract } from './batchDedup.js';
import { buildExpandedPromptContext } from './promptContextBuilder.js';
import { createMetricsRecorder } from './metricsRecorder.js';

export function createExtractionAdapters({
  funConfig = {},
  logger = null,
} = {}) {
  const flags = funConfig.extractionAdapters || {};

  const metricsRecorder = createMetricsRecorder({
    enabled: Boolean(flags.metricsRecorder?.enabled),
    sink: flags.metricsRecorder?.sink || 'stdout',
    logger,
  });

  const bufferLock = flags.bufferLock?.enabled ? createBufferLock() : null;

  return {
    parseGuard: flags.parseGuard?.enabled
      ? (facts, opts) => {
          metricsRecorder.record('parseGuard.invoked', { factsCount: facts?.length || 0 });
          const guarded = guardBatchFacts(facts, opts);
          const warningsCount = guarded.filter((f) => f._parseGuard?.warnings?.length > 0).length;
          metricsRecorder.record('parseGuard.completed', {
            validatedCount: guarded.length,
            warningsCount,
          });
          return guarded;
        }
      : null,

    evidenceEnricher: flags.evidenceEnricher?.enabled
      ? (facts, rawBatch, scopeKey) => {
          metricsRecorder.record('evidenceEnricher.invoked', { factsCount: facts?.length || 0 });
          const enriched = enrichFactsWithEvidence(facts, rawBatch, scopeKey);
          metricsRecorder.record('evidenceEnricher.completed', {
            enrichedCount: enriched.length,
          });
          return enriched;
        }
      : null,

    bufferLock,

    batchDedup: flags.batchDedup?.enabled
      ? (rawMessages, knownFacts, opts) => {
          metricsRecorder.record('batchDedup.invoked', { inputCount: rawMessages?.length || 0 });
          const res = dedupBatchBeforeExtract(rawMessages, knownFacts, {
            minScore: flags.batchDedup?.minScore,
            windowHours: flags.batchDedup?.windowHours,
            ...opts,
          });
          metricsRecorder.record('batchDedup.completed', {
            outputCount: res.filteredBatch?.length || 0,
            droppedCount: res.droppedCount || 0,
          });
          return res;
        }
      : null,

    promptContextBuilder: flags.promptContext?.enabled
      ? (params) => {
          metricsRecorder.record('promptContext.invoked', { scopeKey: params?.scopeKey });
          const block = buildExpandedPromptContext(params);
          metricsRecorder.record('promptContext.completed', {
            blockLength: block?.length || 0,
          });
          return block;
        }
      : null,

    metricsRecorder,
  };
}
