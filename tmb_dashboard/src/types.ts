export type DashboardMode = 'CONVERSATION' | 'COMMAND';

export type DashboardView = 'setup' | 'analytics' | 'handoff' | 'broadcast' | 'sessions' | 'settings' | 'flows' | 'dbMaintenance';

export interface RuntimeHealth {
  status: string;
  uptimeMs: number;
  mode: string;
  flowFile: string;
  flowPath: string;
  needsInitialSetup?: boolean;
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
  totalSessions?: number;
  conversationsTotal?: number;
  abandonmentRateTotal?: number;
  averageDurationTotalMs?: number;
  completionRateTotal?: number;
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
  displayName?: string;
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
  name?: string;
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

export interface BroadcastSendProgress {
  campaignId: number;
  attempted: number;
  processed: number;
  sent: number;
  failed: number;
  remaining: number;
  percent: number;
  status: 'started' | 'sending' | 'completed';
  recipientStatus?: 'sent' | 'failed' | '';
  jid?: string;
}

export interface RuntimeSettings {
  autoReloadFlows: boolean;
  broadcastSendIntervalMs?: number;
  runtimeMode?: string;
  dbMaintenanceEnabled?: boolean;
  dbMaintenanceIntervalMinutes?: number;
  dbRetentionDays?: number;
  dbRetentionArchiveEnabled?: boolean;
  dbEventBatchEnabled?: boolean;
  dbEventBatchFlushMs?: number;
  dbEventBatchSize?: number;
}

export interface RuntimeSetupConfig {
  botRuntimeMode: 'single-flow' | 'multi-bot' | string;
  flowPath: string;
  flowPaths: string[];
  runtimeMode: 'production' | 'development' | 'restricted-test' | string;
  autoReloadFlows: boolean;
  broadcastSendIntervalMs: number;
  testTargetMode?: string;
  testJid?: string;
  testJids: string[];
  groupWhitelistJids: string[];
  dashboardHost?: string;
  dashboardPort?: number;
}

export interface RuntimeSetupState {
  ok?: boolean;
  needsInitialSetup: boolean;
  hasSavedConfig: boolean;
  config: RuntimeSetupConfig;
}

export interface SetupSelectableTarget {
  jid: string;
  name: string;
  source?: string;
  participants?: number;
}

export interface SetupTargetsResponse {
  contacts: SetupSelectableTarget[];
  groups: SetupSelectableTarget[];
  socketReady: boolean;
  updatedAt: number;
}

export interface DatabaseInfo {
  path: string;
  journalMode: string;
  synchronous: string;
  journalModeAnalytics?: string;
  synchronousAnalytics?: string;
  fileSizeBytes: number;
  walSizeBytes: number;
  shmSizeBytes: number;
  totalStorageBytes?: number;
  splitDatabases?: boolean;
  dailyGrowthBytes?: number;
  files?: {
    runtime?: {
      path: string;
      fileSizeBytes: number;
      walSizeBytes: number;
      shmSizeBytes: number;
      totalStorageBytes: number;
    };
    analytics?: {
      path: string;
      fileSizeBytes: number;
      walSizeBytes: number;
      shmSizeBytes: number;
      totalStorageBytes: number;
    };
  };
  sizeHistory?: Array<{
    date: string;
    totalBytes: number;
    capturedAt: number;
  }>;
  sessionsTotal: number;
  sessionsActive: number;
  conversationEventsTotal: number;
  conversationSessionsTotal: number;
  broadcastCampaignsTotal: number;
  broadcastRecipientsTotal: number;
  maintenance?: DbMaintenanceStatus;
  runtimeConfig?: Record<string, unknown>;
  operationalLimits?: Record<string, unknown>;
}

export interface DbMaintenanceConfig {
  dbMaintenanceEnabled: boolean;
  dbMaintenanceIntervalMinutes: number;
  dbRetentionDays: number;
  dbRetentionArchiveEnabled: boolean;
  dbEventBatchEnabled: boolean;
  dbEventBatchFlushMs: number;
  dbEventBatchSize: number;
}

export interface DbMaintenanceStatus {
  inProgress?: boolean;
  lastRunAt?: number;
  lastRunReason?: string;
  lastDurationMs?: number;
  lastStatus?: string;
  lastError?: string;
  lastSummary?: Record<string, unknown> | null;
  lastRetentionAt?: number;
  lastAnalyzeAt?: number;
  lastVacuumAt?: number;
  lastIntegrityCheckAt?: number;
}

export interface DbMaintenanceInfo {
  ok: boolean;
  config: DbMaintenanceConfig;
  runtimeConfig?: Record<string, unknown>;
  maintenanceStatus?: DbMaintenanceStatus;
}

export interface DbMaintenanceRunResult {
  ok: boolean;
  skipped?: boolean;
  durationMs?: number;
  error?: string;
  summary?: Record<string, unknown>;
  status?: DbMaintenanceStatus;
}

export interface SessionFlowConfigItem {
  flowPath: string;
  botType: string;
  sessionTimeoutMinutes: number;
}

export interface SessionOverview {
  activeSessions: number;
  handoffSessions: number;
  averageSessionDurationMs: number;
  byFlow: Array<{
    flowPath: string;
    activeCount: number;
  }>;
}

export interface ActiveSessionManagementItem {
  jid: string;
  displayName?: string;
  flowPath: string;
  botType: string;
  waitingFor?: string | null;
  blockIndex: number;
  startedAt: number;
  lastActivityAt: number;
  durationMs: number;
  handoffActive: boolean;
}

export interface BotInfo {
  fileName: string;
  flowPath: string;
  botType: string;
  totalBlocks: number;
  syntaxValid: boolean;
  syntaxError: string | null;
  status: 'active' | 'inactive' | 'error';
}
