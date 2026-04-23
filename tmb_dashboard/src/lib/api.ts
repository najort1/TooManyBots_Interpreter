import type {
  DashboardStats,
  EventLog,
  RuntimeSettings,
  DatabaseInfo,
  SessionFlowConfigItem,
  SessionOverview,
  ActiveSessionManagementItem,
  BroadcastContact,
  BroadcastSendProgress,
  BroadcastSendResult,
  HandoffBlock,
  HandoffSession,
  RuntimeHealth,
  RuntimeSetupConfig,
  RuntimeSetupState,
  SetupTargetsResponse,
  BotInfo,
  DbMaintenanceConfig,
  DbMaintenanceInfo,
  DbMaintenanceRunResult,
  ObservabilitySnapshot,
  DashboardTelemetryLevel,
} from '../types';

const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || '').trim();
const inflightByKey = new Map<string, AbortController>();

function resolveApiUrl(url: string): string {
  if (!API_BASE_URL) return url;
  return new URL(url, API_BASE_URL).toString();
}

function stripHtmlPreview(raw: string): string {
  const compact = raw.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  return compact.slice(0, 120);
}

interface RequestJsonOptions {
  requestKey?: string;
}

function inferRecipientType(jid: string): 'individual' | 'group' {
  return String(jid || '').trim().endsWith('@g.us') ? 'group' : 'individual';
}

function normalizeRecipientCounts(raw: unknown) {
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

function normalizeBroadcastMetrics(raw: unknown) {
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

export function isAbortError(error: unknown): boolean {
  if (!error) return false;
  const maybeError = error as { name?: string; message?: string };
  if (String(maybeError?.name || '').toLowerCase() === 'aborterror') return true;
  const message = String(maybeError?.message || '').toLowerCase();
  return message.includes('aborted') || message.includes('aborterror');
}

function toAbortError(): Error {
  const abortError = new Error('request-aborted');
  abortError.name = 'AbortError';
  return abortError;
}

async function requestJson<T>(url: string, init?: RequestInit, options?: RequestJsonOptions): Promise<T> {
  const resolvedUrl = resolveApiUrl(url);
  const requestKey = String(options?.requestKey || '').trim();
  let controller: AbortController | null = null;
  if (requestKey) {
    const previous = inflightByKey.get(requestKey);
    if (previous) {
      previous.abort();
    }
    controller = new AbortController();
    inflightByKey.set(requestKey, controller);
  }

  const signal = init?.signal ?? controller?.signal;
  let response: Response;
  let text = '';
  try {
    response = await fetch(resolvedUrl, { ...(init || {}), signal });
    text = await response.text();
  } catch (error) {
    if (isAbortError(error)) {
      throw toAbortError();
    }
    throw error;
  } finally {
    if (controller && inflightByKey.get(requestKey) === controller) {
      inflightByKey.delete(requestKey);
    }
  }

  if (!response.ok) {
    throw new Error(text || `Request failed: ${response.status}`);
  }

  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(text) as T;
    } catch (error) {
      throw new Error(`Resposta JSON inválida em ${resolvedUrl}: ${String((error as Error)?.message || error)}`);
    }
  }

  const preview = stripHtmlPreview(text);
  const seemsHtml = preview.startsWith('<!doctype') || preview.startsWith('<html') || preview.startsWith('<');
  if (seemsHtml) {
    throw new Error(
      `API respondeu HTML em ${resolvedUrl}. Verifique se o frontend está apontando para o backend correto (/api via proxy ou VITE_API_BASE_URL).`
    );
  }

  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(
      `Não foi possível interpretar resposta da API em ${resolvedUrl}: ${String((error as Error)?.message || error)}`
    );
  }
}

export async function fetchHealth(): Promise<RuntimeHealth> {
  return requestJson<RuntimeHealth>('/api/health');
}

export async function postReloadFlow(): Promise<void> {
  await requestJson('/api/reload', { method: 'POST' });
}

export async function fetchBots(): Promise<BotInfo[]> {
  const data = await requestJson<{ bots?: BotInfo[] }>('/api/bots');
  return Array.isArray(data.bots) ? data.bots : [];
}

export async function fetchStats(mode: 'conversation' | 'command'): Promise<DashboardStats> {
  return requestJson<DashboardStats>(
    `/api/stats?mode=${mode}&period=today`,
    undefined,
    { requestKey: `stats:${mode}` }
  );
}

export async function fetchObservability(): Promise<ObservabilitySnapshot> {
  return requestJson<ObservabilitySnapshot>(
    '/api/observability',
    undefined,
    { requestKey: 'observability' }
  );
}

export async function fetchLogs(mode: 'conversation' | 'command', limit = 50): Promise<EventLog[]> {
  const data = await requestJson<{ logs?: EventLog[] }>(
    `/api/logs?mode=${mode}&limit=${limit}`,
    undefined,
    { requestKey: `logs:${mode}` }
  );
  return Array.isArray(data.logs) ? data.logs : [];
}

export async function fetchHandoffBlocks(): Promise<HandoffBlock[]> {
  const data = await requestJson<{ blocks?: HandoffBlock[] }>('/api/handoff/blocks');
  return Array.isArray(data.blocks) ? data.blocks : [];
}

export async function fetchHandoffSessions(): Promise<HandoffSession[]> {
  const data = await requestJson<{ sessions?: HandoffSession[] }>(
    '/api/handoff/sessions',
    undefined,
    { requestKey: 'handoff-sessions' }
  );
  return Array.isArray(data.sessions) ? data.sessions : [];
}

export async function fetchHandoffHistory(jid: string, limit = 200): Promise<EventLog[]> {
  const params = new URLSearchParams({ jid, limit: String(limit) });
  const data = await requestJson<{ logs?: EventLog[] }>(
    `/api/handoff/history?${params.toString()}`,
    undefined,
    { requestKey: `handoff-history:${jid}` }
  );
  return Array.isArray(data.logs) ? data.logs : [];
}

export async function postHandoffMessage(jid: string, text: string): Promise<void> {
  await requestJson('/api/handoff/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jid, text, agentId: 'dashboard-agent' }),
  });
}

export async function postHandoffImage(
  jid: string,
  imageDataUrl: string,
  options?: { caption?: string; fileName?: string; mimeType?: string }
): Promise<void> {
  await requestJson('/api/handoff/send-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jid,
      imageDataUrl,
      caption: String(options?.caption ?? ''),
      fileName: String(options?.fileName ?? ''),
      mimeType: String(options?.mimeType ?? ''),
      agentId: 'dashboard-agent',
    }),
  });
}

export async function postHandoffResume(jid: string, targetBlockId: string): Promise<void> {
  await requestJson('/api/handoff/resume', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jid, targetBlockId, agentId: 'dashboard-agent' }),
  });
}

export async function postHandoffEnd(jid: string): Promise<void> {
  await requestJson('/api/handoff/end', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jid, reason: 'human-agent-ended', agentId: 'dashboard-agent' }),
  });
}

export async function fetchBroadcastContacts(search = '', limit = 200): Promise<BroadcastContact[]> {
  const params = new URLSearchParams({
    search: String(search || ''),
    limit: String(limit),
  });
  const data = await requestJson<{ contacts?: BroadcastContact[] }>(
    `/api/broadcast/contacts?${params.toString()}`,
    undefined,
    { requestKey: 'broadcast-contacts' }
  );
  if (!Array.isArray(data.contacts)) return [];
  const normalized: BroadcastContact[] = [];
  for (const contact of data.contacts) {
    const jid = String(contact?.jid || '').trim();
    if (!jid) continue;
    const recipientType = String((contact as any)?.recipientType || '').trim().toLowerCase() === 'group'
      ? 'group'
      : inferRecipientType(jid);
    normalized.push({
      ...contact,
      jid,
      recipientType,
      name: String(contact?.name || '').trim() || undefined,
      lastInteractionAt: Number(contact?.lastInteractionAt) || 0,
      hasActiveSession: recipientType === 'group' ? false : Boolean(contact?.hasActiveSession),
    });
  }
  return normalized;
}

export async function postBroadcastSend(payload: {
  target: 'all' | 'selected';
  jids: string[];
  text: string;
  imageDataUrl?: string;
  fileName?: string;
  mimeType?: string;
}): Promise<BroadcastSendResult> {
  const data = await requestJson<BroadcastSendResult>('/api/broadcast/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      target: payload.target,
      jids: payload.jids,
      text: payload.text,
      imageDataUrl: String(payload.imageDataUrl || ''),
      fileName: String(payload.fileName || ''),
      mimeType: String(payload.mimeType || ''),
      agentId: 'dashboard-agent',
    }),
  });
  return {
    ...data,
    campaignId: Number(data?.campaignId) || 0,
    attempted: Number(data?.attempted) || 0,
    sent: Number(data?.sent) || 0,
    failed: Number(data?.failed) || 0,
    cancelled: Number(data?.cancelled) || 0,
    recipientCounts: normalizeRecipientCounts((data as any)?.recipientCounts),
    failures: Array.isArray(data?.failures)
      ? data.failures.map(item => ({
          jid: String(item?.jid || ''),
          recipientType: String((item as any)?.recipientType || '').trim().toLowerCase() === 'group'
            ? 'group'
            : inferRecipientType(String(item?.jid || '')),
          error: String(item?.error || ''),
        }))
      : [],
    metrics: normalizeBroadcastMetrics((data as any)?.metrics),
  };
}

export interface BroadcastStatusResponse {
  ok: boolean;
  active: boolean;
  campaign: BroadcastSendProgress | null;
}

export async function fetchBroadcastStatus(): Promise<BroadcastStatusResponse> {
  const data = await requestJson<BroadcastStatusResponse>('/api/broadcast/status', undefined, {
    requestKey: 'broadcast-status',
  });
  if (!data?.campaign) return { ok: Boolean(data?.ok), active: Boolean(data?.active), campaign: null };
  const campaign = data.campaign;
  const jid = String(campaign.jid || '').trim();
  return {
    ok: Boolean(data.ok),
    active: Boolean(data.active),
    campaign: {
      ...campaign,
      campaignId: Number(campaign.campaignId) || 0,
      attempted: Number(campaign.attempted) || 0,
      processed: Number(campaign.processed) || 0,
      sent: Number(campaign.sent) || 0,
      failed: Number(campaign.failed) || 0,
      cancelled: Number(campaign.cancelled) || 0,
      remaining: Number(campaign.remaining) || 0,
      percent: Number(campaign.percent) || 0,
      jid,
      recipientType: String((campaign as any).recipientType || '').trim().toLowerCase() === 'group'
        ? 'group'
        : (jid ? inferRecipientType(jid) : ''),
      recipientCounts: normalizeRecipientCounts((campaign as any).recipientCounts),
      metrics: normalizeBroadcastMetrics((campaign as any).metrics),
    },
  };
}

async function postBroadcastControl(action: 'pause' | 'resume' | 'cancel'): Promise<BroadcastStatusResponse> {
  return requestJson<BroadcastStatusResponse>(`/api/broadcast/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
}

export function postBroadcastPause(): Promise<BroadcastStatusResponse> {
  return postBroadcastControl('pause');
}

export function postBroadcastResume(): Promise<BroadcastStatusResponse> {
  return postBroadcastControl('resume');
}

export function postBroadcastCancel(): Promise<BroadcastStatusResponse> {
  return postBroadcastControl('cancel');
}

export async function fetchRuntimeSettings(): Promise<RuntimeSettings> {
  return requestJson<RuntimeSettings>('/api/settings');
}

export async function fetchSetupState(): Promise<RuntimeSetupState> {
  return requestJson<RuntimeSetupState>('/api/setup-state');
}

export async function postSetupState(input: Partial<RuntimeSetupConfig>): Promise<RuntimeSetupState> {
  return requestJson<RuntimeSetupState>('/api/setup-state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function fetchSetupTargets(search = '', limit = 300): Promise<SetupTargetsResponse> {
  const params = new URLSearchParams({
    search: String(search || ''),
    limit: String(limit),
  });
  return requestJson<SetupTargetsResponse>(
    `/api/setup/targets?${params.toString()}`,
    undefined,
    { requestKey: 'setup-targets' }
  );
}

export async function postRuntimeSettings(input: {
  autoReloadFlows?: boolean;
  broadcastSendIntervalMs?: number;
  dashboardTelemetryLevel?: DashboardTelemetryLevel;
  dbMaintenanceEnabled?: boolean;
  dbMaintenanceIntervalMinutes?: number;
  dbRetentionDays?: number;
  dbRetentionArchiveEnabled?: boolean;
  dbEventBatchEnabled?: boolean;
  dbEventBatchFlushMs?: number;
  dbEventBatchSize?: number;
}): Promise<RuntimeSettings> {
  return requestJson<RuntimeSettings>('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(input.autoReloadFlows !== undefined ? { autoReloadFlows: input.autoReloadFlows } : {}),
      ...(input.broadcastSendIntervalMs !== undefined
        ? { broadcastSendIntervalMs: input.broadcastSendIntervalMs }
        : {}),
      ...(input.dashboardTelemetryLevel !== undefined
        ? { dashboardTelemetryLevel: input.dashboardTelemetryLevel }
        : {}),
      ...(input.dbMaintenanceEnabled !== undefined
        ? { dbMaintenanceEnabled: input.dbMaintenanceEnabled }
        : {}),
      ...(input.dbMaintenanceIntervalMinutes !== undefined
        ? { dbMaintenanceIntervalMinutes: input.dbMaintenanceIntervalMinutes }
        : {}),
      ...(input.dbRetentionDays !== undefined
        ? { dbRetentionDays: input.dbRetentionDays }
        : {}),
      ...(input.dbRetentionArchiveEnabled !== undefined
        ? { dbRetentionArchiveEnabled: input.dbRetentionArchiveEnabled }
        : {}),
      ...(input.dbEventBatchEnabled !== undefined
        ? { dbEventBatchEnabled: input.dbEventBatchEnabled }
        : {}),
      ...(input.dbEventBatchFlushMs !== undefined
        ? { dbEventBatchFlushMs: input.dbEventBatchFlushMs }
        : {}),
      ...(input.dbEventBatchSize !== undefined
        ? { dbEventBatchSize: input.dbEventBatchSize }
        : {}),
    }),
  });
}

export async function postClearRuntimeCache(): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>('/api/settings/cache/clear', {
    method: 'POST',
  });
}

export async function fetchDatabaseInfo(): Promise<DatabaseInfo> {
  return requestJson<DatabaseInfo>('/api/settings/db');
}

export async function fetchDbMaintenanceInfo(): Promise<DbMaintenanceInfo> {
  return requestJson<DbMaintenanceInfo>('/api/settings/db/maintenance');
}

export async function postDbMaintenanceConfig(input: Partial<DbMaintenanceConfig>): Promise<DbMaintenanceInfo> {
  return requestJson<DbMaintenanceInfo>('/api/settings/db/maintenance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(input.dbMaintenanceEnabled !== undefined
        ? { dbMaintenanceEnabled: input.dbMaintenanceEnabled }
        : {}),
      ...(input.dbMaintenanceIntervalMinutes !== undefined
        ? { dbMaintenanceIntervalMinutes: input.dbMaintenanceIntervalMinutes }
        : {}),
      ...(input.dbRetentionDays !== undefined
        ? { dbRetentionDays: input.dbRetentionDays }
        : {}),
      ...(input.dbRetentionArchiveEnabled !== undefined
        ? { dbRetentionArchiveEnabled: input.dbRetentionArchiveEnabled }
        : {}),
      ...(input.dbEventBatchEnabled !== undefined
        ? { dbEventBatchEnabled: input.dbEventBatchEnabled }
        : {}),
      ...(input.dbEventBatchFlushMs !== undefined
        ? { dbEventBatchFlushMs: input.dbEventBatchFlushMs }
        : {}),
      ...(input.dbEventBatchSize !== undefined
        ? { dbEventBatchSize: input.dbEventBatchSize }
        : {}),
    }),
  });
}

export async function postRunDbMaintenance(force = true): Promise<DbMaintenanceRunResult> {
  return requestJson<DbMaintenanceRunResult>('/api/settings/db/maintenance/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ force }),
  });
}

export async function fetchSessionOverview(): Promise<SessionOverview> {
  return requestJson<SessionOverview>('/api/sessions/overview');
}

export async function fetchSessionFlows(): Promise<SessionFlowConfigItem[]> {
  const data = await requestJson<{ flows?: SessionFlowConfigItem[] }>('/api/sessions/flows');
  return Array.isArray(data.flows) ? data.flows : [];
}

export async function fetchActiveSessionsForManagement(search = '', limit = 200): Promise<ActiveSessionManagementItem[]> {
  const params = new URLSearchParams({
    search: String(search || ''),
    limit: String(limit),
  });
  const data = await requestJson<{ sessions?: ActiveSessionManagementItem[] }>(
    `/api/sessions/active?${params.toString()}`,
    undefined,
    { requestKey: 'sessions-active' }
  );
  return Array.isArray(data.sessions) ? data.sessions : [];
}

export async function postClearAllActiveSessions(): Promise<{ ok: boolean; removed: number }> {
  return requestJson<{ ok: boolean; removed: number }>('/api/sessions/clear-all', {
    method: 'POST',
  });
}

export async function postClearFlowSessions(flowPath: string): Promise<{ ok: boolean; removed: number }> {
  return requestJson<{ ok: boolean; removed: number }>('/api/sessions/clear-flow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ flowPath }),
  });
}

export async function postResetSessionByJid(jid: string): Promise<{ ok: boolean; removed: number }> {
  return requestJson<{ ok: boolean; removed: number }>('/api/sessions/reset-jid', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jid }),
  });
}

export async function postUpdateFlowSessionTimeout(
  flowPath: string,
  sessionTimeoutMinutes: number
): Promise<{ ok: boolean; flowPath: string; sessionTimeoutMinutes: number }> {
  return requestJson<{ ok: boolean; flowPath: string; sessionTimeoutMinutes: number }>('/api/sessions/timeout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ flowPath, sessionTimeoutMinutes }),
  });
}
