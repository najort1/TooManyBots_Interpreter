import type {
  DashboardStats,
  EventLog,
  HandoffBlock,
  HandoffSession,
  RuntimeHealth,
} from '../types';

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
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
