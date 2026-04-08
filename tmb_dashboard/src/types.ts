export type DashboardMode = 'CONVERSATION' | 'COMMAND';

export type DashboardView = 'analytics' | 'handoff' | 'broadcast' | 'settings';

export interface RuntimeHealth {
  status: string;
  uptimeMs: number;
  mode: string;
  flowFile: string;
  flowPath: string;
  availableModes?: string[];
  flowPathsByMode?: {
    conversation?: string[];
    command?: string[];
  };
}

export interface EventLog {
  id?: number;
  occurredAt: number;
  eventType: string;
  direction: string;
  jid: string;
  flowPath?: string;
  messageText?: string;
  metadata?: Record<string, unknown>;
}

export interface ConversationTopContact {
  jid: string;
  name: string;
  messageCount: number;
  lastActivity: number;
}

export interface CommandTopUser {
  jid: string;
  name: string;
  totalCommands: number;
  favoriteCommand: string;
}

export interface CommandSummary {
  command: string;
  count: number;
  percentage?: number;
}

export interface WeeklyTrendPoint {
  date: string;
  started: number;
  abandoned: number;
}

export interface FunnelPoint {
  step: string;
  label: string;
  count: number;
}

export interface RecentError {
  command: string;
  error: string;
  count: number;
}

export interface ApiHealthItem {
  name: string;
  avgLatencyMs: number;
  uptime: number;
  status: string;
}

export interface DashboardStats {
  conversationsStarted?: number;
  abandonedSessions?: number;
  abandonmentRate?: number;
  averageDurationMs?: number;
  avgDurationMs?: number;
  medianDurationMs?: number;
  activeSessions?: number;
  completedSessions?: number;
  hourlyVolume?: number[];
  funnel?: FunnelPoint[];
  topContacts?: ConversationTopContact[];
  weeklyTrend?: WeeklyTrendPoint[];
  totalExecutions?: number;
  avgLatencyMs?: number;
  successRate?: number;
  peakPerHour?: number;
  commands?: CommandSummary[];
  topUsers?: CommandTopUser[];
  recentErrors?: RecentError[];
  apiHealth?: ApiHealthItem[];
}

export interface HandoffBlock {
  index: number;
  id: string;
  type: string;
  name: string;
}

export interface HandoffSession {
  jid: string;
  flowPath?: string;
  botType?: string;
  waitingFor?: string;
  blockIndex?: number;
  status?: string;
  queue?: string;
  reason?: string;
  requestedAt?: number;
  lastMessage?: {
    eventType?: string;
    occurredAt?: number;
    text?: string;
  };
  lastActivityAt?: number;
}

export interface BroadcastContact {
  jid: string;
  lastInteractionAt: number;
  hasActiveSession?: boolean;
}

export interface BroadcastSendResult {
  ok: boolean;
  campaignId: number;
  attempted: number;
  sent: number;
  failed: number;
  failures: Array<{
    jid: string;
    error: string;
  }>;
}
