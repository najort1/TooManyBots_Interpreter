import { sendBroadcastMessage } from './sender.js';
import {
  cancelBroadcastPendingRecipients,
  createBroadcastDispatch,
  listBroadcastContacts,
  markBroadcastRecipientResultsBatch,
} from '../db/index.js';
import { BROADCAST_LIMITS } from '../config/constants.js';
import { createActiveSessionLookup, resolveBroadcastSelection } from './broadcastContactUtils.js';
import { delay } from '../utils/async.js';
import { safeErrorMessage } from '../utils/errors.js';

// Controle interno do ciclo de vida de uma campanha em execucao.
// controlStatus: 'running' | 'paused' | 'cancelling' | 'cancelled' | 'completed'
function createCampaignController() {
  const state = {
    controlStatus: 'running',
    pausedAt: 0,
    pauseWaiters: [],
  };

  function setControlStatus(next) {
    state.controlStatus = next;
  }

  function pause() {
    if (state.controlStatus !== 'running') return false;
    state.controlStatus = 'paused';
    state.pausedAt = Date.now();
    return true;
  }

  function resume() {
    if (state.controlStatus !== 'paused') return false;
    state.controlStatus = 'running';
    state.pausedAt = 0;
    const waiters = state.pauseWaiters.splice(0);
    for (const resolve of waiters) {
      try { resolve(); } catch { /* ignore */ }
    }
    return true;
  }

  function cancel() {
    if (state.controlStatus === 'cancelled' || state.controlStatus === 'completed') return false;
    state.controlStatus = 'cancelling';
    const waiters = state.pauseWaiters.splice(0);
    for (const resolve of waiters) {
      try { resolve(); } catch { /* ignore */ }
    }
    return true;
  }

  function isCancelled() {
    return state.controlStatus === 'cancelling' || state.controlStatus === 'cancelled';
  }

  async function waitIfPaused() {
    while (state.controlStatus === 'paused') {
      await new Promise(resolve => {
        state.pauseWaiters.push(resolve);
        // Failsafe: reacorda periodicamente caso algo escape (cancel externo,
        // shutdown, etc.) sem precisar de temporizador global.
        setTimeout(resolve, BROADCAST_LIMITS.PAUSE_POLL_MS);
      });
    }
  }

  return {
    getControlStatus: () => state.controlStatus,
    getPausedAt: () => state.pausedAt,
    setControlStatus,
    pause,
    resume,
    cancel,
    isCancelled,
    waitIfPaused,
  };
}

function createMetricsTracker() {
  const samples = []; // durations em ms para p95
  const maxSamples = 500;
  const state = {
    totalSendMs: 0,
    sendCount: 0,
    maxSendMs: 0,
    startedAt: Date.now(),
    completedAt: 0,
    recentFailures: [], // timestamps de falhas recentes (para failures/min)
    sentIndividuals: 0,
    sentGroups: 0,
    failedIndividuals: 0,
    failedGroups: 0,
  };

  function recordSend(durationMs, { failed = false, recipientType = 'individual' } = {}) {
    const safeMs = Math.max(0, Number(durationMs) || 0);
    state.totalSendMs += safeMs;
    state.sendCount += 1;
    if (safeMs > state.maxSendMs) state.maxSendMs = safeMs;
    samples.push(safeMs);
    if (samples.length > maxSamples) samples.shift();
    const isGroup = String(recipientType || '').trim().toLowerCase() === 'group';
    if (failed) {
      if (isGroup) {
        state.failedGroups += 1;
      } else {
        state.failedIndividuals += 1;
      }
    } else if (isGroup) {
      state.sentGroups += 1;
    } else {
      state.sentIndividuals += 1;
    }
    if (failed) {
      const nowTs = Date.now();
      state.recentFailures.push(nowTs);
      // Mantem so failures da ultima 1 minuto para calculo de taxa.
      const cutoff = nowTs - 60 * 1000;
      while (state.recentFailures.length > 0 && state.recentFailures[0] < cutoff) {
        state.recentFailures.shift();
      }
    }
  }

  function markCompleted() {
    state.completedAt = Date.now();
  }

  function percentile(sortedArr, p) {
    if (sortedArr.length === 0) return 0;
    const idx = Math.min(sortedArr.length - 1, Math.floor(p * sortedArr.length));
    return sortedArr[idx];
  }

  function snapshot(processedCount = 0) {
    const nowTs = state.completedAt || Date.now();
    const elapsedMs = Math.max(1, nowTs - state.startedAt);
    const sorted = samples.length > 0 ? [...samples].sort((a, b) => a - b) : [];
    const avgSendMs = state.sendCount > 0 ? state.totalSendMs / state.sendCount : 0;
    const p95SendMs = percentile(sorted, 0.95);
    const throughputPerSecond = processedCount > 0 ? (processedCount / (elapsedMs / 1000)) : 0;
    return {
      avgSendMs: Number(avgSendMs.toFixed(1)),
      maxSendMs: Math.round(state.maxSendMs),
      p95SendMs: Math.round(p95SendMs),
      throughputPerSecond: Number(throughputPerSecond.toFixed(2)),
      failuresPerMinute: state.recentFailures.length,
      elapsedMs,
      startedAt: state.startedAt,
      sentIndividuals: state.sentIndividuals,
      sentGroups: state.sentGroups,
      failedIndividuals: state.failedIndividuals,
      failedGroups: state.failedGroups,
    };
  }

  return { recordSend, markCompleted, snapshot };
}

function normalizeRecipientCounts(raw = {}) {
  const counts = raw && typeof raw === 'object' ? raw : {};
  return {
    attemptedIndividuals: Math.max(0, Number(counts.attemptedIndividuals) || 0),
    attemptedGroups: Math.max(0, Number(counts.attemptedGroups) || 0),
    sentIndividuals: Math.max(0, Number(counts.sentIndividuals) || 0),
    sentGroups: Math.max(0, Number(counts.sentGroups) || 0),
    failedIndividuals: Math.max(0, Number(counts.failedIndividuals) || 0),
    failedGroups: Math.max(0, Number(counts.failedGroups) || 0),
    cancelledIndividuals: Math.max(0, Number(counts.cancelledIndividuals) || 0),
    cancelledGroups: Math.max(0, Number(counts.cancelledGroups) || 0),
  };
}

function buildProgressSnapshot(result, {
  status = 'sending',
  jid = '',
  recipientType = '',
  recipientStatus = '',
  error = '',
  controlStatus = 'running',
  metrics = null,
  recipientCounts = null,
} = {}) {
  const attempted = Math.max(0, Number(result?.attempted) || 0);
  const sent = Math.max(0, Number(result?.sent) || 0);
  const failed = Math.max(0, Number(result?.failed) || 0);
  const cancelled = Math.max(0, Number(result?.cancelled) || 0);
  const processed = Math.max(0, Math.min(attempted, sent + failed + cancelled));
  const remaining = Math.max(0, attempted - processed);
  const percent = attempted > 0 ? Math.min(100, Math.round((processed / attempted) * 100)) : 0;
  const normalizedRecipientCounts = normalizeRecipientCounts(result?.recipientCounts || recipientCounts || {});
  return {
    campaignId: Number(result?.campaignId) || 0,
    attempted,
    processed,
    sent,
    failed,
    cancelled,
    remaining,
    percent,
    status: String(status || 'sending'),
    controlStatus: String(controlStatus || 'running'),
    jid: String(jid || ''),
    recipientType: String(recipientType || ''),
    recipientStatus: String(recipientStatus || ''),
    error: String(error || ''),
    metrics: metrics || null,
    recipientCounts: normalizedRecipientCounts,
  };
}

export function createBroadcastService({ logger, getSendDelayMs = null }) {
  const log = logger?.child ? logger.child({ module: 'broadcast-service' }) : logger;
  const activeLookup = createActiveSessionLookup();

  // Estado da campanha ativa (apenas uma de cada vez).
  let activeCampaign = null; // { result, controller, emitProgress, target, actor, startedAt, metrics }

  function buildActiveSnapshot(extra = {}) {
    if (!activeCampaign) return null;
    const controlStatus = activeCampaign.controller.getControlStatus();
    const status = controlStatus === 'cancelled' || controlStatus === 'completed'
      ? 'completed'
      : (controlStatus === 'paused' ? 'sending' : 'sending');
    const processedCount =
      Math.max(0, Number(activeCampaign.result?.sent) || 0) +
      Math.max(0, Number(activeCampaign.result?.failed) || 0) +
      Math.max(0, Number(activeCampaign.result?.cancelled) || 0);
    const metrics = activeCampaign.metrics?.snapshot?.(processedCount) ?? null;
    return {
      ...buildProgressSnapshot(activeCampaign.result, {
        status,
        controlStatus,
        metrics,
        ...extra,
      }),
      actor: activeCampaign.actor,
      target: activeCampaign.target,
      startedAt: activeCampaign.startedAt,
      pausedAt: activeCampaign.controller.getPausedAt(),
    };
  }

  function emitControlProgress() {
    if (!activeCampaign) return;
    const snapshot = buildActiveSnapshot();
    if (snapshot) {
      try {
        activeCampaign.emitProgress(snapshot);
      } catch (error) {
        const errorText = safeErrorMessage(error);
        log?.warn?.({ campaignId: snapshot.campaignId, error: errorText }, 'Broadcast control progress emit failed');
      }
    }
  }

  return {
    listContacts({ search = '', limit = BROADCAST_LIMITS.CONTACT_SEARCH_MAX } = {}) {
      const contacts = listBroadcastContacts({
        search,
        limit,
      });

      return contacts.map(contact => ({
        ...contact,
        recipientType: String(contact?.recipientType || '').trim().toLowerCase() === 'group' ? 'group' : 'individual',
        hasActiveSession: String(contact?.recipientType || '').trim().toLowerCase() === 'group'
          ? false
          : activeLookup.has(contact.jid),
      }));
    },

    getActiveCampaign() {
      return buildActiveSnapshot();
    },

    pause() {
      if (!activeCampaign) return { ok: false, error: 'no-active-campaign' };
      const changed = activeCampaign.controller.pause();
      if (!changed) {
        return { ok: false, error: 'not-running', status: buildActiveSnapshot() };
      }
      emitControlProgress();
      log?.info?.({ campaignId: activeCampaign.result.campaignId }, 'Broadcast campaign paused');
      return { ok: true, status: buildActiveSnapshot() };
    },

    resume() {
      if (!activeCampaign) return { ok: false, error: 'no-active-campaign' };
      const changed = activeCampaign.controller.resume();
      if (!changed) {
        return { ok: false, error: 'not-paused', status: buildActiveSnapshot() };
      }
      emitControlProgress();
      log?.info?.({ campaignId: activeCampaign.result.campaignId }, 'Broadcast campaign resumed');
      return { ok: true, status: buildActiveSnapshot() };
    },

    cancel() {
      if (!activeCampaign) return { ok: false, error: 'no-active-campaign' };
      const changed = activeCampaign.controller.cancel();
      if (!changed) {
        return { ok: false, error: 'not-cancellable', status: buildActiveSnapshot() };
      }
      emitControlProgress();
      log?.info?.({ campaignId: activeCampaign.result.campaignId }, 'Broadcast campaign cancelling');
      return { ok: true, status: buildActiveSnapshot() };
    },

    async send({ sock, actor = 'dashboard-agent', target = 'all', selectedJids = [], message, onProgress = null }) {
      if (activeCampaign) {
        throw new Error('campaign-in-progress');
      }

      const allContacts = listBroadcastContacts({
        search: '',
        limit: BROADCAST_LIMITS.CONTACT_LIST_MAX,
      });
      const selection = resolveBroadcastSelection({
        target,
        selectedJids,
        allContacts,
      });

      if (selection.recipients.length === 0) {
        throw new Error('Nenhum destinatario elegivel para envio');
      }

      const campaign = createBroadcastDispatch({
        actor,
        targetMode: selection.target,
        messageType: message.kind,
        messageText: message.text,
        mediaMimeType: message.mimeType,
        mediaFileName: message.fileName,
        recipients: selection.recipients,
      });

      const result = {
        campaignId: campaign.campaignId,
        target: selection.target,
        attempted: selection.recipients.length,
        sent: 0,
        failed: 0,
        cancelled: 0,
        failures: [],
        recipientCounts: normalizeRecipientCounts({
          attemptedIndividuals: Number(selection?.recipientCounts?.individuals) || 0,
          attemptedGroups: Number(selection?.recipientCounts?.groups) || 0,
        }),
      };
      const processedRecipientJids = new Set();

      const controller = createCampaignController();
      const metrics = createMetricsTracker();

      function metricsSnapshot() {
        const processedCount = result.sent + result.failed + result.cancelled;
        return metrics.snapshot(processedCount);
      }

      const rawEmitProgress = (payload) => {
        if (typeof onProgress !== 'function') return;
        try {
          onProgress(payload);
        } catch (error) {
          const errorText = safeErrorMessage(error);
          log?.warn?.({ campaignId: result.campaignId, error: errorText }, 'Broadcast progress callback failed');
        }
      };

      // Buffer de resultados para persistencia em lote. Reduz fsync do SQLite
      // em campanhas grandes.
      const pendingResults = [];
      let lastFlushAt = Date.now();

      function flushPendingResults(forceFlush = false) {
        if (pendingResults.length === 0) return;
        const shouldFlush =
          forceFlush
          || pendingResults.length >= BROADCAST_LIMITS.PERSIST_BATCH_SIZE
          || (Date.now() - lastFlushAt) >= BROADCAST_LIMITS.PERSIST_FLUSH_MS;
        if (!shouldFlush) return;
        const buffered = pendingResults.splice(0);
        try {
          markBroadcastRecipientResultsBatch({
            campaignId: campaign.campaignId,
            results: buffered,
          });
        } catch (error) {
          const errorText = safeErrorMessage(error);
          log?.warn?.({
            campaignId: campaign.campaignId,
            bufferedCount: buffered.length,
            error: errorText,
          }, 'Broadcast batch persist failed; falling back to per-recipient');
          // Fallback: repersistir um-a-um para nao perder o progresso.
          for (const row of buffered) {
            try {
              markBroadcastRecipientResultsBatch({
                campaignId: campaign.campaignId,
                results: [row],
              });
            } catch {
              // ignore; proxima tentativa de flush pode recuperar.
            }
          }
        }
        lastFlushAt = Date.now();
      }

      // Throttle do callback de progresso para reduzir volume no dashboard.
      // Eventos criticos (forceEmit) ignoram o throttle.
      let lastProgressEmitAt = 0;
      function emitProgress(snapshot, { force = false } = {}) {
        const now = Date.now();
        if (!force && now - lastProgressEmitAt < BROADCAST_LIMITS.PROGRESS_THROTTLE_MS) {
          return;
        }
        lastProgressEmitAt = now;
        rawEmitProgress(snapshot);
      }

      activeCampaign = {
        result,
        controller,
        metrics,
        // emitProgress usado pelos handlers de control (pause/resume/cancel)
        // sempre forca emit para refletir mudanca de estado imediatamente.
        emitProgress: (snapshot) => {
          lastProgressEmitAt = Date.now();
          rawEmitProgress(snapshot);
        },
        target: selection.target,
        actor: String(actor || 'dashboard-agent'),
        startedAt: Date.now(),
      };

      emitProgress(
        buildProgressSnapshot(result, {
          status: 'started',
          controlStatus: controller.getControlStatus(),
          metrics: metricsSnapshot(),
        }),
        { force: true }
      );

      try {
        for (const recipient of selection.recipients) {
          const jid = String(recipient?.jid || '').trim();
          const recipientType = String(recipient?.recipientType || '').trim().toLowerCase() === 'group'
            ? 'group'
            : 'individual';
          if (!jid) continue;

          // Aguarda saida do estado pausado antes de enviar o proximo destinatario.
          if (controller.getControlStatus() === 'paused') {
            // Flush antes de dormir na pausa para deixar o DB consistente.
            flushPendingResults(true);
          }
          await controller.waitIfPaused();
          if (controller.isCancelled()) break;

          let recipientStatus = 'sent';
          let recipientError = '';
          const sendStartedAt = Date.now();

          try {
            await sendBroadcastMessage(sock, jid, message);
            pendingResults.push({
              jid,
              recipientType,
              status: 'sent',
              errorMessage: '',
              sentAt: Date.now(),
            });
            result.sent += 1;
            if (recipientType === 'group') {
              result.recipientCounts.sentGroups += 1;
            } else {
              result.recipientCounts.sentIndividuals += 1;
            }
          } catch (error) {
            recipientStatus = 'failed';
            const errorText = safeErrorMessage(error);
            recipientError = errorText;
            pendingResults.push({
              jid,
              recipientType,
              status: 'failed',
              errorMessage: errorText,
            });
            result.failed += 1;
            if (recipientType === 'group') {
              result.recipientCounts.failedGroups += 1;
            } else {
              result.recipientCounts.failedIndividuals += 1;
            }
            result.failures.push({ jid, recipientType, error: errorText });
            log?.warn?.({ campaignId: campaign.campaignId, jid, recipientType, error: errorText }, 'Broadcast recipient failed');
          }

          processedRecipientJids.add(jid);
          metrics.recordSend(Date.now() - sendStartedAt, {
            failed: recipientStatus === 'failed',
            recipientType,
          });
          flushPendingResults(false);

          // Falhas sao criticas: emite sempre para visibilidade rapida.
          emitProgress(
            buildProgressSnapshot(result, {
              status: 'sending',
              controlStatus: controller.getControlStatus(),
              jid,
              recipientType,
              recipientStatus,
              error: recipientError,
              metrics: metricsSnapshot(),
            }),
            { force: recipientStatus === 'failed' }
          );

          if (controller.isCancelled()) break;

          const configuredDelayMs = typeof getSendDelayMs === 'function'
            ? Number(getSendDelayMs())
            : BROADCAST_LIMITS.SEND_DELAY_MS;
          const sendDelayMs = Number.isFinite(configuredDelayMs) && configuredDelayMs > 0
            ? Math.floor(configuredDelayMs)
            : 0;

          if (sendDelayMs > 0) {
            // Delay respeita cancelamento e pausa: sai cedo se cancelado.
            const deadline = Date.now() + sendDelayMs;
            while (Date.now() < deadline) {
              if (controller.isCancelled()) break;
              const remaining = deadline - Date.now();
              const tick = Math.min(remaining, BROADCAST_LIMITS.PAUSE_POLL_MS);
              if (tick <= 0) break;
              await delay(tick);
              // Checkpoint de progresso durante idle (ex.: delays longos).
              flushPendingResults(false);
              if (controller.getControlStatus() === 'paused') {
                flushPendingResults(true);
                await controller.waitIfPaused();
                break;
              }
            }
          }
        }

        // Flush final antes de marcar conclusao/cancelamento.
        flushPendingResults(true);
        metrics.markCompleted();
        const finalMetrics = metricsSnapshot();

        if (controller.isCancelled()) {
          const pendingRecipients = selection.recipients.filter(item => !processedRecipientJids.has(String(item?.jid || '').trim()));
          let cancelledIndividuals = 0;
          let cancelledGroups = 0;
          for (const pending of pendingRecipients) {
            if (String(pending?.recipientType || '').trim().toLowerCase() === 'group') {
              cancelledGroups += 1;
            } else {
              cancelledIndividuals += 1;
            }
          }
          const { cancelled } = cancelBroadcastPendingRecipients({
            campaignId: campaign.campaignId,
            errorMessage: 'cancelled-by-operator',
          });
          result.cancelled = Math.max(0, Number(cancelled) || 0);
          result.recipientCounts.cancelledIndividuals = cancelledIndividuals;
          result.recipientCounts.cancelledGroups = cancelledGroups;
          controller.setControlStatus('cancelled');
          emitProgress(
            buildProgressSnapshot(result, {
              status: 'completed',
              controlStatus: 'cancelled',
              metrics: finalMetrics,
            }),
            { force: true }
          );
          log?.info?.({
            campaignId: campaign.campaignId,
            sent: result.sent,
            failed: result.failed,
            cancelled: result.cancelled,
            recipientCounts: result.recipientCounts,
            metrics: finalMetrics,
          }, 'Broadcast campaign cancelled');
        } else {
          controller.setControlStatus('completed');
          emitProgress(
            buildProgressSnapshot(result, {
              status: 'completed',
              controlStatus: 'completed',
              metrics: finalMetrics,
            }),
            { force: true }
          );
          log?.info?.({
            campaignId: campaign.campaignId,
            sent: result.sent,
            failed: result.failed,
            recipientCounts: result.recipientCounts,
            metrics: finalMetrics,
          }, 'Broadcast campaign completed');
        }

        result.metrics = {
          ...finalMetrics,
          attemptedIndividuals: result.recipientCounts.attemptedIndividuals,
          attemptedGroups: result.recipientCounts.attemptedGroups,
          cancelledIndividuals: result.recipientCounts.cancelledIndividuals,
          cancelledGroups: result.recipientCounts.cancelledGroups,
        };
        return result;
      } finally {
        // Proteje contra crashes antes de marcar conclusao: garante que o
        // buffer nao fique orfao em memoria.
        flushPendingResults(true);
        activeCampaign = null;
      }
    },
  };
}
