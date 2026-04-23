function stringifyError(error, fallback = 'unknown-error') {
  if (error && typeof error === 'object' && typeof error.message === 'string' && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}

export function createDashboardInteractionHandlers({
  normalizeRuntimeInfo,
  getRequiresInitialSetup,
  getActiveFlows,
  extractApiHostFromTemplateUrl,
  getApiMetrics,
  getDashboardFlow,
  resolveContactDisplayName,
  reloadFlow,
  getCurrentSocket,
  sendTextMessage,
  sendImageMessage,
  logConversationEvent,
  resumeSessionFromHumanHandoff,
  endSessionFromDashboard,
  getBroadcastService,
  buildBroadcastMessage,
  emitDashboardBroadcastProgress,
  getLogger,
  getHasSavedConfigAtBoot,
  buildSetupConfigSnapshot,
  applyRuntimeConfigFromDashboard,
  listSetupSelectableTargets,
} = {}) {
  return {
    getRuntimeInfo: () => ({
      ...normalizeRuntimeInfo(),
      needsInitialSetup: getRequiresInitialSetup(),
      apis: getActiveFlows()
        .flatMap(flow => flow.blocks || [])
        ?.filter(b => b.type === 'http-request')
        .map(b => {
          const apiName = extractApiHostFromTemplateUrl(b.config?.url);
          const metrics = getApiMetrics(apiName);
          return {
            name: apiName,
            url: b.config?.url || 'Desconhecida',
            avgLatencyMs: metrics?.avgLatencyMs ?? 0,
            uptime: metrics?.uptime ?? 1.0,
            status: metrics ? (metrics.healthy ? 'healthy' : 'degraded') : 'unknown',
          };
        }) || [],
    }),

    getFlowBlocks: () => getDashboardFlow()?.blocks ?? [],

    getContactName: jid => {
      const name = resolveContactDisplayName(jid);
      return name || null;
    },

    onReload: async () => await reloadFlow({ source: 'dashboard' }),

    onHumanSendMessage: async ({ jid, text, actor }) => {
      const sock = getCurrentSocket();
      if (!sock) {
        return { ok: false, error: 'socket-not-ready' };
      }

      try {
        await sendTextMessage(sock, jid, text, { __skipConversationLog: true });
        logConversationEvent({
          eventType: 'human-message-outgoing',
          direction: 'outgoing',
          jid,
          messageText: text,
          metadata: {
            kind: 'text',
            actor,
            source: 'dashboard-human-support',
          },
        });
        return { ok: true };
      } catch (error) {
        return { ok: false, error: stringifyError(error, 'send-failed') };
      }
    },

    onHumanSendImage: async ({ jid, actor, caption, imageBuffer, mimeType, mediaId, mediaUrl, fileName }) => {
      const sock = getCurrentSocket();
      if (!sock) {
        return { ok: false, error: 'socket-not-ready' };
      }

      try {
        await sendImageMessage(sock, jid, {
          imageBuffer,
          caption: String(caption || '').trim() || undefined,
          mimeType: mimeType || '',
        }, { __skipConversationLog: true });

        logConversationEvent({
          eventType: 'human-image-outgoing',
          direction: 'outgoing',
          jid,
          messageText: String(caption || '').trim() || `[Imagem] ${fileName || mediaId || ''}`.trim(),
          metadata: {
            kind: 'image',
            actor,
            source: 'dashboard-human-support',
            mediaId: mediaId || null,
            mediaUrl: mediaUrl || null,
            mediaType: mimeType || null,
            fileName: fileName || null,
          },
        });
        return { ok: true };
      } catch (error) {
        return { ok: false, error: stringifyError(error, 'send-image-failed') };
      }
    },

    onHumanResumeSession: async ({ jid, targetBlockIndex, targetBlockId, actor }) => {
      const sock = getCurrentSocket();
      const flow = getDashboardFlow();
      if (!sock || !flow) {
        return { ok: false, error: 'runtime-not-ready' };
      }

      const result = await resumeSessionFromHumanHandoff({
        sock,
        jid,
        flow,
        targetBlockIndex,
        actor,
      });

      if (!result?.ok) return result;

      logConversationEvent({
        eventType: 'human-handoff-resume-request',
        direction: 'system',
        jid,
        messageText: `Retomada solicitada para bloco ${targetBlockId || targetBlockIndex}`,
        metadata: {
          actor,
          targetBlockId: targetBlockId || null,
          targetBlockIndex,
          source: 'dashboard-human-support',
        },
      });

      return result;
    },

    onHumanEndSession: async ({ jid, reason, actor }) => {
      const flow = getDashboardFlow();
      if (!flow) {
        return { ok: false, error: 'runtime-not-ready' };
      }

      const result = await endSessionFromDashboard({ jid, flow, reason, actor });
      if (!result?.ok) return result;

      logConversationEvent({
        eventType: 'human-handoff-ended',
        direction: 'system',
        jid,
        messageText: 'Sessao encerrada manualmente pela equipe',
        metadata: {
          actor,
          reason,
          source: 'dashboard-human-support',
        },
      });

      return result;
    },

    onBroadcastListContacts: async ({ search, limit }) => {
      const broadcastService = getBroadcastService();
      if (!broadcastService) {
        return [];
      }
      const contacts = broadcastService.listContacts({ search, limit });
      return contacts.map(contact => ({
        ...contact,
        name: String(contact?.name || '').trim() || resolveContactDisplayName(contact?.jid),
      }));
    },

    onBroadcastSend: async ({ actor, target, selectedJids, message }) => {
      const sock = getCurrentSocket();
      if (!sock) {
        return { ok: false, error: 'socket-not-ready' };
      }
      const broadcastService = getBroadcastService();
      if (!broadcastService) {
        return { ok: false, error: 'broadcast-service-not-ready' };
      }

      try {
        const builtMessage = buildBroadcastMessage({
          text: message?.text ?? '',
          imageDataUrl: message?.imageDataUrl ?? '',
          mimeType: message?.mimeType ?? '',
          fileName: message?.fileName ?? '',
        });

        const result = await broadcastService.send({
          sock,
          actor,
          target,
          selectedJids,
          message: builtMessage,
          onProgress: progress => {
            emitDashboardBroadcastProgress({
              actor,
              target,
              ...progress,
            });
          },
        });

        const cancelledCount = Math.max(0, Number(result?.cancelled) || 0);
        const sentSummaryText = cancelledCount > 0
          ? `Campanha #${result.campaignId}: ${result.sent}/${result.attempted} envios (cancelada, ${cancelledCount} pendente(s))`
          : `Campanha #${result.campaignId}: ${result.sent}/${result.attempted} envios`;
        logConversationEvent({
          eventType: 'broadcast-dispatch',
          direction: 'system',
          jid: 'system',
          messageText: sentSummaryText,
          metadata: {
            actor,
            target: result.target,
            attempted: result.attempted,
            sent: result.sent,
            failed: result.failed,
            cancelled: cancelledCount,
            campaignId: result.campaignId,
            recipientCounts: result.recipientCounts || null,
            metrics: result.metrics || null,
          },
        });

        return { ok: true, ...result };
      } catch (error) {
        getLogger()?.error?.(
          {
            err: {
              name: error?.name || 'Error',
              message: error?.message || 'broadcast-send-failed',
              stack: error?.stack || '',
            },
            actor,
            target,
          },
          'Broadcast send failed'
        );
        return { ok: false, error: stringifyError(error, 'broadcast-send-failed') };
      }
    },

    onBroadcastStatus: async () => {
      const broadcastService = getBroadcastService();
      if (!broadcastService) {
        return { active: false, campaign: null };
      }
      const snapshot = broadcastService.getActiveCampaign();
      return {
        active: Boolean(snapshot),
        campaign: snapshot,
      };
    },

    onBroadcastPause: async () => {
      const broadcastService = getBroadcastService();
      if (!broadcastService) {
        return { ok: false, error: 'broadcast-service-not-ready' };
      }
      return broadcastService.pause();
    },

    onBroadcastResume: async () => {
      const broadcastService = getBroadcastService();
      if (!broadcastService) {
        return { ok: false, error: 'broadcast-service-not-ready' };
      }
      return broadcastService.resume();
    },

    onBroadcastCancel: async () => {
      const broadcastService = getBroadcastService();
      if (!broadcastService) {
        return { ok: false, error: 'broadcast-service-not-ready' };
      }
      return broadcastService.cancel();
    },

    onGetSetupState: async () => ({
      needsInitialSetup: getRequiresInitialSetup(),
      hasSavedConfig: getHasSavedConfigAtBoot() || !getRequiresInitialSetup(),
      config: buildSetupConfigSnapshot(),
    }),

    onApplySetupState: async input => {
      const result = await applyRuntimeConfigFromDashboard(input);
      return result;
    },

    onListSetupTargets: async ({ search, limit }) => (
      listSetupSelectableTargets({ search, limit })
    ),
  };
}
