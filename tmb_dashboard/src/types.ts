export type DashboardMode = 'CONVERSATION' | 'COMMAND';
export type DashboardTelemetryLevel = 'minimum' | 'operational' | 'diagnostic' | 'verbose';

export type DashboardView = 'setup' | 'analytics' | 'surveys' | 'observability' | 'handoff' | 'broadcast' | 'sessions' | 'settings' | 'flows' | 'dbMaintenance';

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

export interface ObservabilityRouteMetric {
  route: string;
  count: number;
  errors: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  lastStatusCode: number;
  lastAt: number;
}

export interface ObservabilityDbQueryMetric {
  query: string;
  count: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  lastAt: number;
}

export interface ObservabilityHandlerErrorMetric {
  handlerType: string;
  failed: number;
  count: number;
}

export interface ObservabilitySnapshot {
  now: number;
  uptimeMs: number;
  telemetryLevel: DashboardTelemetryLevel;
  process: {
    pid: number;
    memory: {
      rss: number;
      heapTotal: number;
      heapUsed: number;
      external: number;
      arrayBuffers?: number;
    };
    cpuUsageMicros: {
      user: number;
      system: number;
    };
    loadAverage: number[];
    cpuCount: number;
  };
  http: {
    totalRequests: number;
    totalErrors: number;
    routes: ObservabilityRouteMetric[];
  };
  sqlite: {
    queries: ObservabilityDbQueryMetric[];
  };
  websocket: {
    connectedClients: number;
    peakConnectedClients: number;
    connectionsOpened: number;
    connectionsClosed: number;
    eventsSent: number;
    immediateEventsSent: number;
    batchedEventsSent: number;
    batchesSent: number;
    bytesSent: number;
    eventsPerMinute: number;
    eventsPerMinuteSeries?: Array<{
      minuteTs: number;
      events: number;
    }>;
    lastSentAt: number;
  };
  runtime: {
    messageLatencyAvgMs: number;
    messageLatencyP95Ms: number;
    sqliteQueryAvgMs: number;
    backlog: {
      ingestionQueue: number;
      dispatchQueue: number;
    };
    sessionsActive: number;
    errorsByHandler: ObservabilityHandlerErrorMetric[];
    errorsByHandlerSummary?: {
      totalFailed: number;
      totalProcessed: number;
    };
    socketReconnectRatePerDay: number;
    broadcastThroughputPerMinute: number;
    reconnectPending: boolean;
  };
  dashboard?: {
    isolationMode?: string;
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

export type BroadcastRecipientType = 'individual' | 'group';

export interface BroadcastRecipientCounts {
  attemptedIndividuals: number;
  attemptedGroups: number;
  sentIndividuals: number;
  sentGroups: number;
  failedIndividuals: number;
  failedGroups: number;
  cancelledIndividuals: number;
  cancelledGroups: number;
}

export interface BroadcastContact {
  jid: string;
  recipientType: BroadcastRecipientType;
  name?: string;
  lastInteractionAt: number;
  hasActiveSession?: boolean;
}

export interface BroadcastSendMetrics {
  avgSendMs: number;
  maxSendMs: number;
  p95SendMs: number;
  throughputPerSecond: number;
  failuresPerMinute: number;
  elapsedMs: number;
  startedAt: number;
  sentIndividuals?: number;
  sentGroups?: number;
  failedIndividuals?: number;
  failedGroups?: number;
  attemptedIndividuals?: number;
  attemptedGroups?: number;
  cancelledIndividuals?: number;
  cancelledGroups?: number;
}

export interface BroadcastSendResult {
  ok: boolean;
  campaignId: number;
  attempted: number;
  sent: number;
  failed: number;
  cancelled?: number;
  recipientCounts?: BroadcastRecipientCounts | null;
  failures: Array<{
    jid: string;
    recipientType?: BroadcastRecipientType;
    error: string;
  }>;
  metrics?: BroadcastSendMetrics | null;
}

export type BroadcastControlStatus =
  | 'running'
  | 'paused'
  | 'cancelling'
  | 'cancelled'
  | 'completed';

export interface BroadcastSendProgress {
  campaignId: number;
  attempted: number;
  processed: number;
  sent: number;
  failed: number;
  cancelled?: number;
  remaining: number;
  percent: number;
  status: 'started' | 'sending' | 'completed';
  controlStatus?: BroadcastControlStatus;
  recipientType?: BroadcastRecipientType | '';
  recipientStatus?: 'sent' | 'failed' | '';
  recipientCounts?: BroadcastRecipientCounts | null;
  jid?: string;
  actor?: string;
  target?: 'all' | 'selected' | string;
  startedAt?: number;
  pausedAt?: number;
  metrics?: BroadcastSendMetrics | null;
}

export interface RuntimeSettings {
  autoReloadFlows: boolean;
  broadcastSendIntervalMs?: number;
  dashboardTelemetryLevel?: DashboardTelemetryLevel;
  dashboardIsolationMode?: string;
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
  surveyConfigsByFlowPath?: Record<string, BotSurveyConfig>;
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

export interface FlowRuntimeDetails {
  conversationMode?: string;
  interactionScope?: string;
  startPolicy?: string;
  startPolicyLimit?: {
    maxStarts?: number;
    period?: string;
    blockedMessage?: string;
  } | null;
  endBehavior?: {
    sendClosingMessage?: boolean;
  } | null;
  postEnd?: {
    reentryPolicy?: string;
    cooldownMinutes?: number;
    cooldownMessage?: string;
    blockedMessage?: string;
  } | null;
  sessionLimits?: {
    maxMessagesPerSession?: number;
    sessionTimeoutPreset?: string;
    sessionTimeoutMinutes?: number;
    timeoutMessage?: string;
  } | null;
  contextPersistence?: {
    variablePersistence?: string;
    globalVariables?: string[];
    memoryModeEnabled?: boolean;
  } | null;
  availability?: {
    restrictBySchedule?: boolean;
    allowedDays?: string[];
    timeRangeStart?: string;
    timeRangeEnd?: string;
    includeBrazilNationalHolidays?: boolean;
    timezone?: string;
    outsideScheduleMessage?: string;
  } | null;
}

export interface BotInfo {
  fileName: string;
  flowPath: string;
  botType: string;
  totalBlocks: number;
  syntaxValid: boolean;
  syntaxError: string | null;
  status: 'active' | 'inactive' | 'error';
  runtimeConfig?: FlowRuntimeDetails | null;
}

export interface SurveyQuestionDefinition {
  id: string;
  text: string;
  type: 'scale' | 'text' | 'choice' | 'multiple' | 'nps' | 'scale_0_5' | 'boolean' | string;
  required?: boolean;
  maxLength?: number;
  scale?: {
    min: number;
    max: number;
  };
  choices?: Array<{
    id: string;
    label: string;
    value?: string;
  }>;
}

export interface SurveyTypeDefinition {
  typeId: string;
  name: string;
  schema: {
    title?: string;
    description?: string;
    questions?: SurveyQuestionDefinition[];
    scoringRules?: Record<string, unknown>;
    visualizations?: string[];
    retentionDays?: number;
  };
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  status?: 'draft' | 'active' | 'inactive' | string;
  title?: string;
  description?: string;
  questions?: SurveyQuestionDefinition[];
  frequency?: SurveyFrequencyRules | null;
}

export interface SurveyFrequencyRules {
  maxResponsesPerUser: number | null;
  periodUnit: 'hour' | 'day' | 'week' | 'month' | 'year' | string;
  periodValue: number;
  minIntervalSeconds: number;
  minIntervalDays?: number;
  skipForAdmins: boolean;
}

export interface BotSurveyConfig {
  postSessionSurveyTypeId: string | null;
  triggerOn: Array<'session_end' | 'human_handoff_end' | 'timeout' | string>;
  skipIfRecentlyCompleted: boolean;
  skipWindowHours: number;
}

export interface SurveyBroadcastResult {
  ok: boolean;
  surveyTypeId: string;
  attempted: number;
  sent: number;
  failed: number;
  failures: Array<{ jid: string; error: string }>;
  blockedGroups?: string[];
}

export interface SurveyResponseRecord {
  responseId: string;
  instanceId: string;
  questionId: string;
  questionType: string;
  numericValue: number | null;
  textValue: string;
  choiceId: string;
  choiceIds: string[];
  respondedAt: number;
}

export interface SurveyInstance {
  instanceId: string;
  surveyTypeId: string;
  flowPath: string;
  blockId: string;
  sessionId: string;
  jid: string;
  startedAt: number;
  completedAt: number | null;
  abandonedAt: number | null;
  abandonmentReason: string;
  conversationContext: string;
  responses?: SurveyResponseRecord[];
}

export interface SurveyInstanceList {
  total: number;
  items: SurveyInstance[];
  limit: number;
  offset: number;
}

export interface SurveyMetricsOverview {
  totalInstances: number;
  completedInstances: number;
  abandonedInstances: number;
  completionRate: number;
  abandonmentRate: number;
  avgDurationSeconds: number;
  numericResponses: number;
  avgScore: number;
  npsScore: number;
  csatRate: number;
  lowEffortRate: number;
  sampleSize: number;
  keyMetricName?: string;
  keyMetricValue?: number;
  secondaryMetricName?: string;
  secondaryMetricValue?: number;
}

export interface SurveyTrendPoint {
  bucket: string;
  timeBucket: 'hour' | 'day' | 'week' | 'month' | string;
  totalInstances: number;
  completedInstances: number;
  abandonedInstances: number;
  numericResponses: number;
  avgScore: number;
}

export interface SurveyDistributionPoint {
  value: number;
  total: number;
}

export interface SurveyFlowMetric {
  flowPath: string;
  totalInstances: number;
  completedInstances: number;
  abandonedInstances: number;
  completionRate: number;
  abandonmentRate: number;
  avgDurationSeconds: number;
  numericResponses: number;
  avgScore: number;
}

export interface SurveyFilters {
  typeId?: string;
  flowPath?: string;
  blockId?: string;
  from?: number | null;
  to?: number | null;
  granularity?: 'hour' | 'day' | 'week' | 'month' | string;
  limit?: number;
  offset?: number;
  status?: 'completed' | 'abandoned' | 'pending' | string;
}
