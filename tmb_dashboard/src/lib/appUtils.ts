import { isAbortError } from './api';
import type { ToastTone } from '../components/feedback/ToastCenter';
import type {
  BroadcastSendProgress,
  DashboardMode,
  EventLog,
} from '../types';

export const WS_REFRESH_EVENT_TYPES = new Set([
  'session-start',
  'session-end',
  'command-executed',
  'flow-error',
  'engine-error',
  'message-outgoing-error',
  'message-outgoing',
  'human-message-outgoing',
  'human-image-outgoing',
  'survey:response:completed',
  'survey:response:abandoned',
  'survey:metrics:updated',
]);

export const TRANSIENT_WS_EVENT_TYPES = new Set(['broadcast-send-progress']);

export function toDashboardMode(mode: string): DashboardMode {
  return String(mode).toLowerCase() === 'command' ? 'COMMAND' : 'CONVERSATION';
}

export function modeToQuery(mode: DashboardMode): 'conversation' | 'command' {
  return mode === 'COMMAND' ? 'command' : 'conversation';
}

export function trimLogs(logs: EventLog[], max = 200): EventLog[] {
  if (logs.length <= max) return logs;
  return logs.slice(logs.length - max);
}

export function readMetadataText(log: EventLog, key: string): string {
  const metadata = log.metadata;
  if (!metadata || typeof metadata !== 'object') return '';
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'string' ? value.trim() : '';
}

function getEventDedupKey(log: EventLog): string {
  if (Number.isFinite(log.id)) return `db:${log.id}`;

  const messageId = readMetadataText(log, 'id');
  if (messageId) {
    return `wa:${messageId}:${log.eventType || ''}:${log.jid || ''}`;
  }

  const actorJid = readMetadataText(log, 'actorJid');
  const chatJid = readMetadataText(log, 'chatJid');
  const listId = readMetadataText(log, 'listId');

  return [
    log.occurredAt || 0,
    log.eventType || '',
    log.direction || '',
    log.jid || '',
    log.messageText || '',
    actorJid,
    chatJid,
    listId,
  ].join('|');
}

function dedupeLogs(logs: EventLog[]): EventLog[] {
  const deduped = new Map<string, EventLog>();
  for (const log of logs) {
    const key = getEventDedupKey(log);
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, log);
      continue;
    }

    const existingScore = Number(existing.id) || 0;
    const nextScore = Number(log.id) || 0;
    if (nextScore > existingScore) {
      deduped.set(key, log);
    }
  }
  return [...deduped.values()];
}

export function sortHistory(logs: EventLog[]): EventLog[] {
  return dedupeLogs([...logs]).sort((a, b) => {
    const aTime = Number(a.occurredAt) || 0;
    const bTime = Number(b.occurredAt) || 0;
    if (aTime !== bTime) return aTime - bTime;
    return (Number(a.id) || 0) - (Number(b.id) || 0);
  });
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string' || !result.startsWith('data:')) {
        reject(new Error('Falha ao converter imagem para envio.'));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => {
      reject(new Error('Falha ao ler o arquivo selecionado.'));
    };
    reader.readAsDataURL(file);
  });
}

export function mapMessageToTone(message: string): ToastTone {
  const normalized = String(message || '').toLowerCase();
  if (normalized.includes('sucesso')) return 'success';
  if (normalized.includes('erro') || normalized.includes('falha')) return 'danger';
  if (normalized.includes('aten') || normalized.includes('aguardando')) return 'warning';
  return 'info';
}

export function shouldIgnoreRequestError(error: unknown): boolean {
  return isAbortError(error);
}

function readMetadataNumber(log: EventLog, key: string, fallback = 0): number {
  const metadata = log.metadata;
  if (!metadata || typeof metadata !== 'object') return fallback;
  const raw = (metadata as Record<string, unknown>)[key];
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function normalizeBroadcastControlStatus(raw: string): BroadcastSendProgress['controlStatus'] {
  const value = String(raw || '').toLowerCase();
  if (value === 'paused' || value === 'cancelling' || value === 'cancelled' || value === 'completed') {
    return value;
  }
  return 'running';
}

function toBroadcastMetrics(raw: unknown): BroadcastSendProgress['metrics'] {
  if (!raw || typeof raw !== 'object') return null;
  const metrics = raw as Record<string, unknown>;
  const numeric = (key: string): number => {
    const value = Number(metrics[key]);
    return Number.isFinite(value) ? value : 0;
  };
  return {
    avgSendMs: numeric('avgSendMs'),
    maxSendMs: numeric('maxSendMs'),
    p95SendMs: numeric('p95SendMs'),
    throughputPerSecond: numeric('throughputPerSecond'),
    failuresPerMinute: numeric('failuresPerMinute'),
    elapsedMs: numeric('elapsedMs'),
    startedAt: numeric('startedAt'),
    sentIndividuals: numeric('sentIndividuals'),
    sentGroups: numeric('sentGroups'),
    failedIndividuals: numeric('failedIndividuals'),
    failedGroups: numeric('failedGroups'),
    attemptedIndividuals: numeric('attemptedIndividuals'),
    attemptedGroups: numeric('attemptedGroups'),
    cancelledIndividuals: numeric('cancelledIndividuals'),
    cancelledGroups: numeric('cancelledGroups'),
  };
}

function toBroadcastRecipientCounts(raw: unknown): BroadcastSendProgress['recipientCounts'] {
  if (!raw || typeof raw !== 'object') return null;
  const counts = raw as Record<string, unknown>;
  const numeric = (key: string): number => {
    const value = Number(counts[key]);
    return Number.isFinite(value) ? value : 0;
  };
  return {
    attemptedIndividuals: numeric('attemptedIndividuals'),
    attemptedGroups: numeric('attemptedGroups'),
    sentIndividuals: numeric('sentIndividuals'),
    sentGroups: numeric('sentGroups'),
    failedIndividuals: numeric('failedIndividuals'),
    failedGroups: numeric('failedGroups'),
    cancelledIndividuals: numeric('cancelledIndividuals'),
    cancelledGroups: numeric('cancelledGroups'),
  };
}

export function toBroadcastProgress(log: EventLog): BroadcastSendProgress | null {
  if (String(log.eventType || '').trim().toLowerCase() !== 'broadcast-send-progress') {
    return null;
  }

  const attempted = Math.max(0, readMetadataNumber(log, 'attempted', 0));
  const sent = Math.max(0, readMetadataNumber(log, 'sent', 0));
  const failed = Math.max(0, readMetadataNumber(log, 'failed', 0));
  const cancelled = Math.max(0, readMetadataNumber(log, 'cancelled', 0));
  const processed = Math.max(0, Math.min(attempted, readMetadataNumber(log, 'processed', sent + failed + cancelled)));
  const remaining = Math.max(0, readMetadataNumber(log, 'remaining', attempted - processed));
  const percent = attempted > 0
    ? Math.max(0, Math.min(100, readMetadataNumber(log, 'percent', Math.round((processed / attempted) * 100))))
    : 0;
  const statusRaw = readMetadataText(log, 'status').toLowerCase();
  const status: BroadcastSendProgress['status'] =
    statusRaw === 'completed'
      ? 'completed'
      : (statusRaw === 'started' ? 'started' : 'sending');
  const recipientStatusRaw = readMetadataText(log, 'recipientStatus').toLowerCase();
  const recipientStatus: BroadcastSendProgress['recipientStatus'] =
    recipientStatusRaw === 'failed'
      ? 'failed'
      : (recipientStatusRaw === 'sent' ? 'sent' : '');
  const recipientTypeRaw = readMetadataText(log, 'recipientType').toLowerCase();
  const recipientType: BroadcastSendProgress['recipientType'] =
    recipientTypeRaw === 'group'
      ? 'group'
      : (recipientTypeRaw === 'individual' ? 'individual' : '');
  const jid = String(log.jid || '').trim();
  const controlStatus = normalizeBroadcastControlStatus(readMetadataText(log, 'controlStatus'));
  const metadata = (log.metadata && typeof log.metadata === 'object') ? log.metadata as Record<string, unknown> : null;
  const metrics = toBroadcastMetrics(metadata?.metrics);
  const recipientCounts = toBroadcastRecipientCounts(metadata?.recipientCounts);

  return {
    campaignId: Math.max(0, readMetadataNumber(log, 'campaignId', 0)),
    attempted,
    processed,
    sent,
    failed,
    cancelled,
    remaining,
    percent,
    status,
    controlStatus,
    recipientType,
    recipientStatus,
    recipientCounts,
    jid: jid || '',
    metrics,
  };
}
