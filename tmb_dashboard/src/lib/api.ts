import type {
  DashboardStats,
  EventLog,
  RuntimeSettings,
  DatabaseInfo,
  SessionFlowConfigItem,
  SessionOverview,
  ActiveSessionManagementItem,
  BroadcastContact,
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
} from '../types';

const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || '').trim();

function resolveApiUrl(url: string): string {
  if (!API_BASE_URL) return url;
  return new URL(url, API_BASE_URL).toString();
}

function stripHtmlPreview(raw: string): string {
  const compact = raw.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  return compact.slice(0, 120);
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const resolvedUrl = resolveApiUrl(url);
  const response = await fetch(resolvedUrl, init);
  const text = await response.text().catch(() => '');

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
  return requestJson<DashboardStats>(`/api/stats?mode=${mode}&period=today`);
}

export async function fetchLogs(mode: 'conversation' | 'command', limit = 50): Promise<EventLog[]> {
  const data = await requestJson<{ logs?: EventLog[] }>(`/api/logs?mode=${mode}&limit=${limit}`);
  return Array.isArray(data.logs) ? data.logs : [];
}

export async function fetchHandoffBlocks(): Promise<HandoffBlock[]> {
  const data = await requestJson<{ blocks?: HandoffBlock[] }>('/api/handoff/blocks');
  return Array.isArray(data.blocks) ? data.blocks : [];
}

export async function fetchHandoffSessions(): Promise<HandoffSession[]> {
  const data = await requestJson<{ sessions?: HandoffSession[] }>('/api/handoff/sessions');
  return Array.isArray(data.sessions) ? data.sessions : [];
}

export async function fetchHandoffHistory(jid: string, limit = 200): Promise<EventLog[]> {
  const params = new URLSearchParams({ jid, limit: String(limit) });
  const data = await requestJson<{ logs?: EventLog[] }>(`/api/handoff/history?${params.toString()}`);
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
  const data = await requestJson<{ contacts?: BroadcastContact[] }>(`/api/broadcast/contacts?${params.toString()}`);
  return Array.isArray(data.contacts) ? data.contacts : [];
}

export async function postBroadcastSend(payload: {
  target: 'all' | 'selected';
  jids: string[];
  text: string;
  imageDataUrl?: string;
  fileName?: string;
  mimeType?: string;
}): Promise<BroadcastSendResult> {
  return requestJson<BroadcastSendResult>('/api/broadcast/send', {
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
  return requestJson<SetupTargetsResponse>(`/api/setup/targets?${params.toString()}`);
}

export async function postRuntimeSettings(input: {
  autoReloadFlows?: boolean;
  broadcastSendIntervalMs?: number;
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
  const data = await requestJson<{ sessions?: ActiveSessionManagementItem[] }>(`/api/sessions/active?${params.toString()}`);
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
