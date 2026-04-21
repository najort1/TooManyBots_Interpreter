export function createRuntimeDiagnosticsController({
  disconnectReasonNameByCode,
  getConfig,
  getLogger,
  getWhatsappHealthState,
  readPerMinute,
  bumpMinuteCounter,
  pushSample,
} = {}) {
  let lastThroughputWarningAt = 0;

  function normalizeErrorCategory(error) {
    const rawMessage = String(error?.message || '').toLowerCase();
    if (rawMessage.includes('timed out') || rawMessage.includes('timeout')) return 'timeout';
    if (rawMessage.includes('rate') && rawMessage.includes('limit')) return 'rate-limit';
    if (rawMessage.includes('forbidden') || rawMessage.includes('not-authorized')) return 'forbidden';
    if (rawMessage.includes('network') || rawMessage.includes('socket') || rawMessage.includes('econn')) return 'network';
    if (rawMessage.includes('disconnect')) return 'disconnect';
    return 'unknown';
  }

  function resolveDisconnectReasonName(statusCode) {
    return disconnectReasonNameByCode.get(Number(statusCode) || 0) || 'unknown';
  }

  function classifyDisconnectCategory(statusCode) {
    const reasonName = resolveDisconnectReasonName(statusCode).toLowerCase();
    if (reasonName === 'loggedout') return 'persistent-auth';
    if (reasonName === 'badsession' || reasonName === 'multidevicemismatch') return 'persistent-auth';
    if (reasonName === 'restartrequired' || reasonName === 'connectionreplaced') return 'persistent-runtime';
    if (reasonName === 'connectionclosed' || reasonName === 'connectionlost' || reasonName === 'timedout') {
      return 'transient-network';
    }
    return 'unknown';
  }

  function maybeLogThroughputPressure() {
    const nowTs = Date.now();
    if (nowTs - lastThroughputWarningAt < 30 * 1000) return;

    const config = getConfig();
    const whatsappHealthState = getWhatsappHealthState();
    const inboundNow = readPerMinute(whatsappHealthState.minuteCounters.incoming, 1);
    const serviceOutNow = readPerMinute(whatsappHealthState.minuteCounters.outgoingService, 1);
    const broadcastOutNow = readPerMinute(whatsappHealthState.minuteCounters.outgoingBroadcast, 1);

    const inboundLimit = Math.max(1, Number(config?.whatsappMaxInboundPerMinute ?? 600));
    const serviceLimit = Math.max(1, Number(config?.whatsappMaxServiceOutboundPerMinute ?? 300));
    const broadcastLimit = Math.max(1, Number(config?.whatsappMaxBroadcastOutboundPerMinute ?? 120));

    const exceeds =
      inboundNow >= inboundLimit ||
      serviceOutNow >= serviceLimit ||
      broadcastOutNow >= broadcastLimit;

    if (!exceeds) return;
    lastThroughputWarningAt = nowTs;

    getLogger()?.warn?.(
      {
        inboundPerMinute: inboundNow,
        outboundServicePerMinute: serviceOutNow,
        outboundBroadcastPerMinute: broadcastOutNow,
        limits: {
          inboundPerMinute: inboundLimit,
          outboundServicePerMinute: serviceLimit,
          outboundBroadcastPerMinute: broadcastLimit,
        },
      },
      'WhatsApp throughput reached configured operational limit'
    );
  }

  function noteSocketEvent(eventName) {
    const whatsappHealthState = getWhatsappHealthState();
    const normalizedName = String(eventName || 'unknown');
    if (normalizedName === 'connection.update') {
      whatsappHealthState.events.connectionUpdate += 1;
      bumpMinuteCounter(whatsappHealthState.minuteCounters.connectionUpdate, Date.now());
    } else if (normalizedName === 'messages.upsert') {
      whatsappHealthState.events.messagesUpsert += 1;
      bumpMinuteCounter(whatsappHealthState.minuteCounters.messagesUpsert, Date.now());
    } else if (normalizedName === 'creds.update') {
      whatsappHealthState.events.credsUpdate += 1;
      bumpMinuteCounter(whatsappHealthState.minuteCounters.credsUpdate, Date.now());
    }
    bumpMinuteCounter(whatsappHealthState.minuteCounters.events, Date.now());
  }

  function noteSocketCallbackDuration(durationMs) {
    const whatsappHealthState = getWhatsappHealthState();
    const safeDuration = Math.max(0, Number(durationMs) || 0);
    whatsappHealthState.callback.calls += 1;
    whatsappHealthState.callback.totalMs += safeDuration;
    whatsappHealthState.callback.maxMs = Math.max(whatsappHealthState.callback.maxMs, safeDuration);
    whatsappHealthState.callback.lastMs = safeDuration;
    pushSample(whatsappHealthState.callback.samples, safeDuration);
  }

  function noteQueueLag(durationMs) {
    const whatsappHealthState = getWhatsappHealthState();
    const safeDuration = Math.max(0, Number(durationMs) || 0);
    whatsappHealthState.queueLag.count += 1;
    whatsappHealthState.queueLag.totalMs += safeDuration;
    whatsappHealthState.queueLag.maxMs = Math.max(whatsappHealthState.queueLag.maxMs, safeDuration);
    pushSample(whatsappHealthState.queueLag.samples, safeDuration);
  }

  return {
    normalizeErrorCategory,
    resolveDisconnectReasonName,
    classifyDisconnectCategory,
    maybeLogThroughputPressure,
    noteSocketEvent,
    noteSocketCallbackDuration,
    noteQueueLag,
  };
}
