export function createMessageTelemetryController({
  addConversationEvent,
  currentPrimaryFlowPathForLogs,
  broadcastDashboardEvent,
} = {}) {
  function logConversationEvent({
    occurredAt = Date.now(),
    eventType = 'message',
    direction = 'system',
    jid = 'unknown',
    flowPath = '',
    messageText = '',
    metadata = {},
  }) {
    addConversationEvent({
      occurredAt: Number(occurredAt) || Date.now(),
      eventType,
      direction,
      jid,
      flowPath: String(flowPath || '').trim() || currentPrimaryFlowPathForLogs(),
      messageText,
      metadata,
    });
  }

  function emitDashboardBroadcastProgress({
    actor = 'dashboard-agent',
    target = 'all',
    campaignId = 0,
    attempted = 0,
    processed = 0,
    sent = 0,
    failed = 0,
    cancelled = 0,
    remaining = 0,
    percent = 0,
    status = 'sending',
    controlStatus = 'running',
    jid = '',
    recipientType = '',
    recipientStatus = '',
    recipientCounts = null,
    error = '',
    metrics = null,
  } = {}) {
    const attemptedSafe = Math.max(0, Number(attempted) || 0);
    const processedSafe = Math.max(0, Math.min(attemptedSafe, Number(processed) || 0));
    const sentSafe = Math.max(0, Number(sent) || 0);
    const failedSafe = Math.max(0, Number(failed) || 0);
    const cancelledSafe = Math.max(0, Number(cancelled) || 0);
    const remainingSafe = Math.max(0, Number(remaining) || 0);
    const percentSafe = Math.max(0, Math.min(100, Number(percent) || 0));
    const statusSafe = String(status || 'sending');
    const controlStatusSafe = String(controlStatus || 'running');

    broadcastDashboardEvent({
      occurredAt: Date.now(),
      eventType: 'broadcast-send-progress',
      direction: 'system',
      jid: String(jid || 'system'),
      flowPath: currentPrimaryFlowPathForLogs(),
      messageText: `Broadcast ${sentSafe}/${attemptedSafe}`,
      metadata: {
        source: 'dashboard-broadcast',
        actor: String(actor || 'dashboard-agent'),
        target: String(target || 'all'),
        campaignId: Number(campaignId) || 0,
        attempted: attemptedSafe,
        processed: processedSafe,
        sent: sentSafe,
        failed: failedSafe,
        cancelled: cancelledSafe,
        remaining: remainingSafe,
        percent: percentSafe,
        status: statusSafe,
        controlStatus: controlStatusSafe,
        recipientType: String(recipientType || ''),
        recipientStatus: String(recipientStatus || ''),
        recipientCounts: recipientCounts && typeof recipientCounts === 'object'
          ? {
              attemptedIndividuals: Number(recipientCounts.attemptedIndividuals) || 0,
              attemptedGroups: Number(recipientCounts.attemptedGroups) || 0,
              sentIndividuals: Number(recipientCounts.sentIndividuals) || 0,
              sentGroups: Number(recipientCounts.sentGroups) || 0,
              failedIndividuals: Number(recipientCounts.failedIndividuals) || 0,
              failedGroups: Number(recipientCounts.failedGroups) || 0,
              cancelledIndividuals: Number(recipientCounts.cancelledIndividuals) || 0,
              cancelledGroups: Number(recipientCounts.cancelledGroups) || 0,
            }
          : null,
        error: String(error || ''),
        metrics: metrics && typeof metrics === 'object' ? {
          avgSendMs: Number(metrics.avgSendMs) || 0,
          maxSendMs: Number(metrics.maxSendMs) || 0,
          p95SendMs: Number(metrics.p95SendMs) || 0,
          throughputPerSecond: Number(metrics.throughputPerSecond) || 0,
          failuresPerMinute: Number(metrics.failuresPerMinute) || 0,
          elapsedMs: Number(metrics.elapsedMs) || 0,
          startedAt: Number(metrics.startedAt) || 0,
          sentIndividuals: Number(metrics.sentIndividuals) || 0,
          sentGroups: Number(metrics.sentGroups) || 0,
          failedIndividuals: Number(metrics.failedIndividuals) || 0,
          failedGroups: Number(metrics.failedGroups) || 0,
          attemptedIndividuals: Number(metrics.attemptedIndividuals) || 0,
          attemptedGroups: Number(metrics.attemptedGroups) || 0,
          cancelledIndividuals: Number(metrics.cancelledIndividuals) || 0,
          cancelledGroups: Number(metrics.cancelledGroups) || 0,
        } : null,
      },
    });
  }

  function extractOutgoingMessageText(content) {
    if (!content || typeof content !== 'object') return '';
    if (typeof content.text === 'string' && content.text.trim()) return content.text;
    if (content.image?.caption) return String(content.image.caption);
    if (content.image) return '[imagem]';
    if (content.react?.text) return `[react] ${content.react.text}`;
    if (content.listMessage?.description) return content.listMessage.description;
    if (content.listMessage?.title) return content.listMessage.title;
    if (content.buttonsMessage?.contentText) return content.buttonsMessage.contentText;
    return '';
  }

  function extractOutgoingKind(content) {
    if (!content || typeof content !== 'object') return 'unknown';
    if (content.text) return 'text';
    if (content.image) return 'image';
    if (content.react) return 'reaction';
    if (content.listMessage) return 'list';
    if (content.buttons) return 'buttons';
    return Object.keys(content)[0] || 'unknown';
  }

  function extractApiHostFromTemplateUrl(rawUrl) {
    const input = String(rawUrl ?? '').trim();
    if (!input) return 'host-desconhecido';

    const normalized = input.replace(/\{\{[^}]+\}\}/g, 'x');

    try {
      const parsed = new URL(normalized);
      return parsed.host || parsed.hostname || 'host-desconhecido';
    } catch {
      try {
        const parsedWithBase = new URL(normalized, 'http://localhost');
        if (parsedWithBase.host && parsedWithBase.host !== 'localhost') {
          return parsedWithBase.host;
        }
      } catch {
        // ignore
      }

      const match = normalized.match(/^(?:[a-z]+:\/\/)?([^\/\s?#]+)/i);
      return String(match?.[1] ?? 'host-desconhecido');
    }
  }

  return {
    logConversationEvent,
    emitDashboardBroadcastProgress,
    extractOutgoingMessageText,
    extractOutgoingKind,
    extractApiHostFromTemplateUrl,
  };
}
