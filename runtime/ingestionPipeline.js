export function createIngestionPipelineController({
  getConfig,
  getLogger,
  getRuntimeGuardState,
  getIngestionRuntimeCounters,
  getPostProcessQueue,
  getMediaPipelineQueue,
  getDispatchScheduler,
  getIngestionQueue,
  getContactCache,
  getWhatsappHealthState,
  getWarnedMissingTestTargets,
  setWarnedMissingTestTargets,
  maybeLogThroughputPressure,
  noteQueueLag,
  evaluateRuntimeGuardState,
  logConversationEvent,
  captureIncomingImageForDashboard,
  mergeContactCacheEntry,
  parseMessage,
  getMessageDebugInfo,
  resolveIncomingActorJid,
  getGroupWhitelistJids,
  getAllowedTestJids,
  normalizeInteractionScope,
  isGroupWhitelistScope,
  shouldProcessByInteractionScope,
  getFlowBotType,
  getSession,
  getActiveFlows,
  handleIncoming,
  formatError,
  bumpMinuteCounter,
}) {
  function resolveQueueJidFromIncomingMessage(msg) {
    const messageKey = msg?.key && typeof msg.key === 'object' ? msg.key : {};
    const remoteJid = String(messageKey.remoteJid ?? messageKey.remote_jid ?? '').trim();
    if (!remoteJid) return '';
    const senderPn = String(messageKey.senderPn ?? messageKey.sender_pn ?? '').trim();
    if (remoteJid.endsWith('@lid') && senderPn) {
      return senderPn;
    }
    return remoteJid;
  }

  function enqueuePostProcessTask({ key = 'post', taskName = 'post-task', task }) {
    if (typeof task !== 'function') return;

    const runtimeGuardState = getRuntimeGuardState();
    const config = getConfig();
    const ingestionRuntimeCounters = getIngestionRuntimeCounters();

    const isConversationEventTask = String(taskName || '').startsWith('conversation-event:');
    if (
      runtimeGuardState.degradedMode &&
      config?.runtimeDegradedDropConversationEvents !== false &&
      isConversationEventTask
    ) {
      runtimeGuardState.droppedPostTasks += 1;
      ingestionRuntimeCounters.postTasksDroppedByDegradedMode += 1;
      return;
    }

    ingestionRuntimeCounters.postTasksQueued += 1;

    const postProcessQueue = getPostProcessQueue();
    if (!postProcessQueue) {
      try {
        task();
      } catch (error) {
        ingestionRuntimeCounters.postTasksFailed += 1;
        getLogger()?.error?.(
          {
            taskName,
            err: {
              name: error?.name || 'Error',
              message: error?.message || 'post-task-failed',
              stack: error?.stack || '',
            },
          },
          'Post-process task failed (direct execution)'
        );
      }
      return;
    }

    const result = postProcessQueue.enqueue({
      key: String(key || 'post'),
      priority: 'low',
      payload: null,
      handler: async () => {
        try {
          await task();
        } catch (error) {
          ingestionRuntimeCounters.postTasksFailed += 1;
          getLogger()?.error?.(
            {
              taskName,
              err: {
                name: error?.name || 'Error',
                message: error?.message || 'post-task-failed',
                stack: error?.stack || '',
              },
            },
            'Post-process task failed'
          );
        }
      },
    });

    if (!result?.accepted) {
      ingestionRuntimeCounters.postTasksDropped += 1;
      const dropped = ingestionRuntimeCounters.postTasksDropped;
      if (dropped === 1 || dropped % 100 === 0) {
        getLogger()?.warn?.(
          {
            taskName,
            dropped,
            queued: Number(result?.snapshot?.queued ?? 0),
            maxQueueSize: Number(result?.snapshot?.maxQueueSize ?? 0),
          },
          'Post-process task dropped due to queue overflow'
        );
      }
    }
  }

  function logConversationEventAsync(event, { key = '' } = {}) {
    const queueKey = String(key || event?.jid || 'post');
    enqueuePostProcessTask({
      key: queueKey,
      taskName: `conversation-event:${String(event?.eventType || 'unknown')}`,
      task: () => {
        logConversationEvent(event);
      },
    });
  }

  function enqueueIncomingMediaCapture({
    sock,
    msg,
    jid,
    actorJid,
    id,
    mediaMimeType,
    mediaFileName,
    flowPaths = [],
  }) {
    const runtimeGuardState = getRuntimeGuardState();
    const ingestionRuntimeCounters = getIngestionRuntimeCounters();

    if (runtimeGuardState.degradedMode) {
      runtimeGuardState.droppedMediaTasks += 1;
      ingestionRuntimeCounters.mediaDroppedByDegradedMode += 1;
      return;
    }

    ingestionRuntimeCounters.mediaQueued += 1;
    const queueKey = String(jid || 'media');

    const mediaPipelineQueue = getMediaPipelineQueue();
    if (!mediaPipelineQueue) {
      void (async () => {
        try {
          const media = await captureIncomingImageForDashboard({
            msg,
            sock,
            mimeType: mediaMimeType,
            fileName: mediaFileName || `incoming-${id || Date.now()}`,
          });
          if (!media) return;
          ingestionRuntimeCounters.mediaCaptured += 1;
          for (const flowPath of flowPaths) {
            logConversationEventAsync({
              eventType: 'message-media-captured',
              direction: 'system',
              jid: actorJid || jid,
              flowPath,
              messageText: '[Imagem armazenada para dashboard]',
              metadata: {
                id: id || null,
                actorJid: actorJid || null,
                chatJid: jid,
                mediaType: mediaMimeType || null,
                mediaUrl: media.mediaUrl || null,
                mediaId: media.mediaId || null,
              },
            }, { key: jid });
          }
        } catch (err) {
          ingestionRuntimeCounters.mediaCaptureFailed += 1;
          getLogger()?.warn?.(
            { error: String(err?.message || err) },
            'Inline media capture failed'
          );
        }
      })();
      return;
    }

    const enqueueResult = mediaPipelineQueue.enqueue({
      key: queueKey,
      priority: 'low',
      payload: null,
      handler: async () => {
        try {
          const media = await captureIncomingImageForDashboard({
            msg,
            sock,
            mimeType: mediaMimeType,
            fileName: mediaFileName || `incoming-${id || Date.now()}`,
          });
          if (!media) return;
          ingestionRuntimeCounters.mediaCaptured += 1;
          for (const flowPath of flowPaths) {
            logConversationEventAsync({
              eventType: 'message-media-captured',
              direction: 'system',
              jid: actorJid || jid,
              flowPath,
              messageText: '[Imagem armazenada para dashboard]',
              metadata: {
                id: id || null,
                actorJid: actorJid || null,
                chatJid: jid,
                mediaType: mediaMimeType || null,
                mediaUrl: media.mediaUrl || null,
                mediaId: media.mediaId || null,
              },
            }, { key: jid });
          }
        } catch (err) {
          ingestionRuntimeCounters.mediaCaptureFailed += 1;
          getLogger()?.warn?.(
            { error: String(err?.message || err) },
            'Queued media capture failed'
          );
        }
      },
    });

    if (!enqueueResult?.accepted) {
      ingestionRuntimeCounters.mediaQueueDropped += 1;
      const dropped = ingestionRuntimeCounters.mediaQueueDropped;
      if (dropped === 1 || dropped % 50 === 0) {
        getLogger()?.warn?.(
          {
            dropped,
            queued: Number(enqueueResult?.snapshot?.queued ?? 0),
            maxQueueSize: Number(enqueueResult?.snapshot?.maxQueueSize ?? 0),
          },
          'Incoming media capture dropped due to media pipeline queue overflow'
        );
      }
    }
  }

  function resolveDispatchPriority({ messageType }) {
    if (messageType === 'unknown') return 'low';
    return 'high';
  }

  async function processIncomingUpsertMessage({ sock, msg, type }) {
    const totalStartedAt = Date.now();
    const rawMessageKey = msg?.key && typeof msg.key === 'object' ? msg.key : {};
    mergeContactCacheEntry(getContactCache(), {
      ...msg,
      key: rawMessageKey,
      notify:
        rawMessageKey.notify ??
        rawMessageKey.Notify ??
        msg?.notify ??
        msg?.Notify ??
        msg?.pushName ??
        msg?.pushname ??
        '',
      verifiedName:
        rawMessageKey.verifiedBizName ??
        rawMessageKey.verifiedName ??
        msg?.verifiedBizName ??
        msg?.verifiedName ??
        '',
    });

    const activeFlows = getActiveFlows();
    if (activeFlows.length === 0) return;

    const config = getConfig();
    const ingestionRuntimeCounters = getIngestionRuntimeCounters();

    if (config.debugMode) {
      console.log('Incoming raw', getMessageDebugInfo(msg, type));
    }

    const parseStartedAt = Date.now();
    const parsed = parseMessage(msg);
    ingestionRuntimeCounters.parseMsTotal += Math.max(0, Date.now() - parseStartedAt);
    if (!parsed) {
      ingestionRuntimeCounters.parseDropped += 1;
      if (config.debugMode) {
        console.log('Dropped by parser', getMessageDebugInfo(msg, type));
      }
      return;
    }

    const { id, jid, text, listId, isGroup, messageKey, messageType, mediaMimeType, mediaFileName } = parsed;
    const actorJid = resolveIncomingActorJid(parsed);

    const groupWhitelist = getGroupWhitelistJids(config);
    const allowedTestJids = getAllowedTestJids(config);

    if (config.testMode) {
      if (allowedTestJids.size === 0) {
        if (!getWarnedMissingTestTargets()) {
          console.warn('testMode ativo, mas nenhum contato/grupo permitido foi selecionado.');
          setWarnedMissingTestTargets(true);
        }
        ingestionRuntimeCounters.filteredOut += 1;
        return;
      }
      if (!allowedTestJids.has(jid)) {
        ingestionRuntimeCounters.filteredOut += 1;
        return;
      }
    }

    const incomingText = String(text ?? '').trim();
    const hasCommandPrefix = incomingText.startsWith('/');
    const dispatchFlows = [];
    const routingStartedAt = Date.now();

    for (const flow of activeFlows) {
      const interactionScope = normalizeInteractionScope(flow);
      const requiresGroupWhitelist = isGroupWhitelistScope(flow);
      if (!shouldProcessByInteractionScope(isGroup, flow)) {
        continue;
      }

      if (requiresGroupWhitelist && isGroup) {
        if (groupWhitelist.size === 0) continue;
        if (!groupWhitelist.has(jid)) continue;
      }

      const scope = { flowPath: flow.flowPath, botType: getFlowBotType(flow) };
      const existingSession = getSession(jid, scope);
      const hasActiveSession = existingSession?.status === 'active';
      const botType = getFlowBotType(flow);

      if (botType === 'command') {
        if (!hasActiveSession && !hasCommandPrefix) continue;
        dispatchFlows.push(flow);
        continue;
      }

      if (hasActiveSession || !hasCommandPrefix) {
        dispatchFlows.push(flow);
      }

      if (config.debugMode) {
        console.log('Decision', {
          id,
          jid,
          flowPath: flow.flowPath,
          botType,
          actorJid: actorJid || null,
          textLength: incomingText.length,
          listId,
          isGroup,
          interactionScope,
          requiresGroupWhitelist,
          hasActiveSession,
          groupWhitelistCount: groupWhitelist.size,
          testMode: config.testMode,
          testJidsCount: allowedTestJids.size,
          passesTestMode: !config.testMode || allowedTestJids.has(jid),
        });
      }
    }
    ingestionRuntimeCounters.routingMsTotal += Math.max(0, Date.now() - routingStartedAt);

    if (dispatchFlows.length === 0) {
      ingestionRuntimeCounters.filteredOut += 1;
      return;
    }

    if (messageType === 'image') {
      enqueueIncomingMediaCapture({
        sock,
        msg,
        jid,
        actorJid,
        id,
        mediaMimeType,
        mediaFileName,
        flowPaths: dispatchFlows.map(item => item.flowPath),
      });
    }

    const resolvedMessageText =
      incomingText ||
      (messageType === 'image' ? '[Imagem recebida]' : '');

    const mediaState = messageType === 'image' ? 'queued' : 'none';
    for (const flow of dispatchFlows) {
      logConversationEventAsync({
        eventType: 'message-incoming',
        direction: 'incoming',
        jid: actorJid || jid,
        flowPath: flow.flowPath,
        messageText: resolvedMessageText,
        metadata: {
          id,
          listId: listId ?? null,
          isGroup,
          actorJid: actorJid || null,
          chatJid: jid,
          kind: messageType || 'unknown',
          mediaType: messageType === 'image' ? mediaMimeType || null : null,
          mediaState,
          mediaUrl: null,
          mediaId: null,
          routedFlowPath: flow.flowPath,
          routedFlowBotType: getFlowBotType(flow),
          routedFlowPaths: dispatchFlows.map(item => item.flowPath),
        },
      }, { key: jid });
    }

    if (config.debugMode) {
      console.log(`Mensagem de ${jid}: "${text}" ${listId ? `(listId: ${listId})` : ''} [ID msg: ${id || 'unknown'}]`);
    }

    const dispatchPriority = resolveDispatchPriority({ messageType });
    const taskPromises = [];
    for (const flow of dispatchFlows) {
      const dispatchScheduler = getDispatchScheduler();
      if (!dispatchScheduler) {
        taskPromises.push(handleIncoming(sock, jid, text, listId, flow, id, messageKey, actorJid || null));
        continue;
      }

      const scheduled = dispatchScheduler.enqueue({
        jid,
        flowPath: flow.flowPath,
        priority: dispatchPriority,
        payload: null,
        handler: async () => {
          await handleIncoming(sock, jid, text, listId, flow, id, messageKey, actorJid || null);
        },
      });

      if (!scheduled?.accepted) {
        getLogger()?.warn?.(
          {
            jid,
            flowPath: flow.flowPath,
            queued: Number(scheduled?.snapshot?.queued ?? 0),
            maxQueueSize: Number(scheduled?.snapshot?.maxQueueSize ?? 0),
          },
          'Dispatch task dropped due to scheduler overflow'
        );
        continue;
      }
      taskPromises.push(scheduled.promise);
    }

    try {
      await Promise.all(taskPromises);
      ingestionRuntimeCounters.processedMessages += 1;
    } catch (err) {
      ingestionRuntimeCounters.processingFailed += 1;
      console.error(`Erro no motor para ${jid}:`, err);
      logConversationEventAsync({
        eventType: 'engine-error',
        direction: 'system',
        jid,
        messageText: 'Erro no motor ao processar mensagem',
        metadata: {
          id,
          actorJid: actorJid || null,
          chatJid: jid,
          error: formatError(err),
        },
      }, { key: jid });
    } finally {
      ingestionRuntimeCounters.totalMsTotal += Math.max(0, Date.now() - totalStartedAt);
    }
  }

  function enqueueIncomingUpsertMessage({ sock, msg, type }) {
    const ingestionRuntimeCounters = getIngestionRuntimeCounters();

    ingestionRuntimeCounters.received += 1;
    bumpMinuteCounter(getWhatsappHealthState().minuteCounters.incoming, Date.now());
    maybeLogThroughputPressure();

    const ingestionQueue = getIngestionQueue();
    if (!ingestionQueue) {
      noteQueueLag(0);
      void processIncomingUpsertMessage({ sock, msg, type });
      return;
    }

    const queueKey = resolveQueueJidFromIncomingMessage(msg);
    const quickMessage = msg?.message && typeof msg.message === 'object' ? msg.message : {};
    const isLikelyMedia = Boolean(
      quickMessage.imageMessage ||
      quickMessage.videoMessage ||
      quickMessage.documentMessage
    );

    const enqueueResult = ingestionQueue.enqueue({
      key: queueKey || 'unknown',
      priority: isLikelyMedia ? 'low' : 'high',
      payload: { sock, msg, type, receivedAt: Date.now() },
      handler: async (payload) => {
        try {
          noteQueueLag(Math.max(0, Date.now() - Number(payload?.receivedAt || Date.now())));
          await processIncomingUpsertMessage(payload);
        } catch (error) {
          getLogger()?.error?.(
            {
              queueKey: queueKey || 'unknown',
              err: {
                name: error?.name || 'Error',
                message: error?.message || 'ingestion-queue-task-failed',
                stack: error?.stack || '',
              },
            },
            'Ingestion queue task failed'
          );
          throw error;
        }
      },
    });

    if (!enqueueResult?.accepted) {
      ingestionRuntimeCounters.queueOverflowDropped += 1;
      const rejectedCount = Number(enqueueResult?.snapshot?.rejected ?? 0);
      if (rejectedCount === 1 || rejectedCount % 100 === 0) {
        getLogger()?.warn?.(
          {
            queueKey: queueKey || 'unknown',
            rejected: rejectedCount,
            queued: Number(enqueueResult?.snapshot?.queued ?? 0),
            maxQueueSize: Number(enqueueResult?.snapshot?.maxQueueSize ?? 0),
          },
          'Incoming message dropped due to ingestion queue overflow'
        );
      }
    }

    evaluateRuntimeGuardState();
  }

  return {
    logConversationEventAsync,
    enqueueIncomingUpsertMessage,
  };
}
