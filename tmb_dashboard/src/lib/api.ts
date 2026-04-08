import type {
  DashboardStats,
  EventLog,
  HandoffBlock,
  HandoffSession,
  RuntimeHealth,
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
      throw new Error(`Resposta JSON invalida em ${resolvedUrl}: ${String((error as Error)?.message || error)}`);
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
      `Nao foi possivel interpretar resposta da API em ${resolvedUrl}: ${String((error as Error)?.message || error)}`
    );
  }
}

export async function fetchHealth(): Promise<RuntimeHealth> {
  return requestJson<RuntimeHealth>('/api/health');
}

export async function postReloadFlow(): Promise<void> {
  await requestJson('/api/reload', { method: 'POST' });
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
