import type {
  SurveyDistributionPoint,
  SurveyFilters,
  SurveyFlowMetric,
  SurveyInstance,
  SurveyInstanceList,
  SurveyMetricsOverview,
  SurveyFrequencyRules,
  SurveyBroadcastResult,
  SurveyTrendPoint,
  SurveyTypeDefinition,
  BotSurveyConfig,
} from '../types';

const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || '').trim();

function resolveApiUrl(path: string): string {
  if (!API_BASE_URL) return path;
  return new URL(path, API_BASE_URL).toString();
}

function buildQuery(filters: SurveyFilters = {}): string {
  const params = new URLSearchParams();
  const append = (key: string, value: unknown) => {
    if (value == null) return;
    const normalized = String(value).trim();
    if (!normalized) return;
    params.set(key, normalized);
  };

  append('typeId', filters.typeId);
  append('flowPath', filters.flowPath);
  append('blockId', filters.blockId);
  append('from', filters.from);
  append('to', filters.to);
  append('granularity', filters.granularity);
  append('limit', filters.limit);
  append('offset', filters.offset);
  append('status', filters.status);

  const query = params.toString();
  return query ? `?${query}` : '';
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(resolveApiUrl(path), init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Request failed: ${response.status}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(`Invalid JSON response from ${path}: ${String((error as Error)?.message || error)}`);
  }
}

function readData<T>(payload: unknown, fallback: T): T {
  if (!payload || typeof payload !== 'object') return fallback;
  const body = payload as { ok?: boolean; data?: unknown };
  if (body.ok !== true) return fallback;
  return (body.data as T) ?? fallback;
}

export async function fetchSurveyTypes(activeOnly = true): Promise<SurveyTypeDefinition[]> {
  const payload = await requestJson('/api/surveys/types?activeOnly=' + (activeOnly ? '1' : '0'));
  const data = readData<SurveyTypeDefinition[]>(payload, []);
  return Array.isArray(data) ? data : [];
}

export async function createSurveyDefinition(input: {
  name: string;
  title?: string;
  description?: string;
  status: 'draft' | 'active' | 'inactive';
  questions: unknown[];
  frequency?: Partial<SurveyFrequencyRules>;
}): Promise<SurveyTypeDefinition> {
  const payload = await requestJson<{ ok?: boolean; data?: SurveyTypeDefinition; error?: string }>(
    '/api/surveys',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }
  );
  if (!payload?.ok || !payload.data) throw new Error(payload?.error || 'failed-to-create-survey');
  return payload.data;
}

export async function updateSurveyDefinition(typeId: string, input: {
  name: string;
  title?: string;
  description?: string;
  status: 'draft' | 'active' | 'inactive';
  questions: unknown[];
  frequency?: Partial<SurveyFrequencyRules>;
}): Promise<SurveyTypeDefinition> {
  const payload = await requestJson<{ ok?: boolean; data?: SurveyTypeDefinition; error?: string }>(
    `/api/surveys/${encodeURIComponent(typeId)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }
  );
  if (!payload?.ok || !payload.data) throw new Error(payload?.error || 'failed-to-update-survey');
  return payload.data;
}

export async function duplicateSurveyDefinition(typeId: string): Promise<SurveyTypeDefinition> {
  const payload = await requestJson<{ ok?: boolean; data?: SurveyTypeDefinition; error?: string }>(
    `/api/surveys/${encodeURIComponent(typeId)}/duplicate`,
    { method: 'POST' }
  );
  if (!payload?.ok || !payload.data) throw new Error(payload?.error || 'failed-to-duplicate-survey');
  return payload.data;
}

export async function setSurveyDefinitionStatus(
  typeId: string,
  status: 'active' | 'inactive'
): Promise<SurveyTypeDefinition> {
  const payload = await requestJson<{ ok?: boolean; data?: SurveyTypeDefinition; error?: string }>(
    `/api/surveys/${encodeURIComponent(typeId)}/${status === 'active' ? 'activate' : 'deactivate'}`,
    { method: 'POST' }
  );
  if (!payload?.ok || !payload.data) throw new Error(payload?.error || 'failed-to-change-survey-status');
  return payload.data;
}

export async function linkSurveyToBot(
  botId: string,
  surveyConfig: BotSurveyConfig
): Promise<{ ok: boolean; flowPath?: string; surveyConfig?: BotSurveyConfig; error?: string }> {
  return requestJson(`/api/bots/${encodeURIComponent(botId)}/link-survey`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ surveyConfig }),
  });
}

export async function broadcastSurvey(
  typeId: string,
  jids: string[]
): Promise<SurveyBroadcastResult> {
  return requestJson<SurveyBroadcastResult>(`/api/surveys/${encodeURIComponent(typeId)}/broadcast`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jids, agentId: 'dashboard-agent' }),
  });
}

export async function fetchSurveyTypeById(typeId: string): Promise<SurveyTypeDefinition | null> {
  if (!String(typeId || '').trim()) return null;
  const payload = await requestJson(`/api/surveys/types/${encodeURIComponent(typeId)}`);
  return readData<SurveyTypeDefinition | null>(payload, null);
}

export async function fetchSurveyInstances(filters: SurveyFilters = {}): Promise<SurveyInstanceList> {
  const payload = await requestJson(`/api/surveys/instances${buildQuery(filters)}`);
  return readData<SurveyInstanceList>(payload, {
    total: 0,
    items: [],
    limit: Number(filters.limit) || 200,
    offset: Number(filters.offset) || 0,
  });
}

export async function fetchSurveyInstanceById(instanceId: string): Promise<SurveyInstance | null> {
  if (!String(instanceId || '').trim()) return null;
  const payload = await requestJson(`/api/surveys/instances/${encodeURIComponent(instanceId)}`);
  return readData<SurveyInstance | null>(payload, null);
}

export async function fetchSurveyOverview(filters: SurveyFilters = {}): Promise<SurveyMetricsOverview> {
  const payload = await requestJson(`/api/surveys/metrics/overview${buildQuery(filters)}`);
  return readData<SurveyMetricsOverview>(payload, {
    totalInstances: 0,
    completedInstances: 0,
    abandonedInstances: 0,
    completionRate: 0,
    abandonmentRate: 0,
    avgDurationSeconds: 0,
    numericResponses: 0,
    avgScore: 0,
    npsScore: 0,
    csatRate: 0,
    lowEffortRate: 0,
    sampleSize: 0,
  });
}

export async function fetchSurveyTrend(filters: SurveyFilters = {}): Promise<SurveyTrendPoint[]> {
  const payload = await requestJson(`/api/surveys/metrics/trend${buildQuery(filters)}`);
  const data = readData<SurveyTrendPoint[]>(payload, []);
  return Array.isArray(data) ? data : [];
}

export async function fetchSurveyDistribution(filters: SurveyFilters = {}): Promise<SurveyDistributionPoint[]> {
  const payload = await requestJson(`/api/surveys/metrics/distribution${buildQuery(filters)}`);
  const data = readData<SurveyDistributionPoint[]>(payload, []);
  return Array.isArray(data) ? data : [];
}

export async function fetchSurveyByFlow(filters: SurveyFilters = {}): Promise<SurveyFlowMetric[]> {
  const payload = await requestJson(`/api/surveys/metrics/by-flow${buildQuery(filters)}`);
  const data = readData<SurveyFlowMetric[]>(payload, []);
  return Array.isArray(data) ? data : [];
}

export async function fetchSurveyExportJson(filters: SurveyFilters = {}): Promise<Record<string, unknown>[]> {
  const payload = await requestJson(`/api/surveys/export${buildQuery(filters)}`);
  const data = readData<Record<string, unknown>[]>(payload, []);
  return Array.isArray(data) ? data : [];
}

export function buildSurveyExportUrl(filters: SurveyFilters = {}, format: 'json' | 'csv' = 'csv'): string {
  const query = buildQuery(filters);
  const separator = query ? '&' : '?';
  const relativeUrl = `/api/surveys/export${query}${separator}format=${format}`;
  return resolveApiUrl(relativeUrl);
}

export async function postRefreshSurveyMetricsCache(filters: SurveyFilters = {}): Promise<{ ok: boolean; error?: string }> {
  const payload = await requestJson<{ ok?: boolean; error?: string }>(
    '/api/surveys/admin/cache/refresh',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(filters || {}),
    }
  );
  return {
    ok: payload?.ok === true,
    error: String(payload?.error || ''),
  };
}
