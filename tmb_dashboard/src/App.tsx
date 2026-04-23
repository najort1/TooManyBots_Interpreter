import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToastManager } from './hooks/useToastManager';
import { useHandoffActions } from './hooks/useHandoffActions';
import { useBroadcastActions } from './hooks/useBroadcastActions';
import { useSettingsActions } from './hooks/useSettingsActions';
import { useSessionManagementActions } from './hooks/useSessionManagementActions';
import {
  fetchActiveSessionsForManagement,
  fetchBots,
  fetchBroadcastContacts,
  fetchDatabaseInfo,
  fetchDbMaintenanceInfo,
  fetchHandoffBlocks,
  fetchHandoffHistory,
  fetchHandoffSessions,
  fetchHealth,
  fetchObservability,
  fetchLogs,
  fetchRuntimeSettings,
  fetchSetupState,
  fetchSetupTargets,
  fetchSessionFlows,
  fetchSessionOverview,
  fetchBroadcastStatus,
  postSetupState,
  fetchStats,
} from './lib/api';
import {
  WS_REFRESH_EVENT_TYPES,
  TRANSIENT_WS_EVENT_TYPES,
  modeToQuery,
  readMetadataText,
  shouldIgnoreRequestError,
  sortHistory,
  toBroadcastProgress,
  toDashboardMode,
  trimLogs,
} from './lib/appUtils';
import { isLikelyErrorMessage } from './lib/format';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { AnalyticsView } from './components/analytics/AnalyticsView';
import { ObservabilityView } from './components/observability/ObservabilityView';
import { BroadcastView } from './components/broadcast/BroadcastView';
import { HandoffView } from './components/handoff/HandoffView';
import { SessionManagementView } from './components/sessions/SessionManagementView';
import { FlowsView } from './components/flows/FlowsView';
import { SettingsView } from './components/settings/SettingsView';
import { DbMaintenanceView } from './components/settings/DbMaintenanceView';
import { SetupView } from './components/setup/SetupView';
import { Modal } from './components/Modal';
import { ToastCenter } from './components/feedback/ToastCenter';
import type {
  DashboardMode,
  DashboardStats,
  DashboardView,
  DatabaseInfo,
  EventLog,
  BotInfo,
  BroadcastContact,
  BroadcastSendResult,
  BroadcastSendProgress,
  HandoffBlock,
  HandoffSession,
  ActiveSessionManagementItem,
  SessionFlowConfigItem,
  SessionOverview,
  RuntimeSetupConfig,
  SetupTargetsResponse,
  DbMaintenanceConfig,
  DbMaintenanceStatus,
  DashboardTelemetryLevel,
  ObservabilitySnapshot,
} from './types';

type PendingConfirmAction =
  | 'clear-runtime-cache'
  | 'clear-all-sessions'
  | 'clear-flow-sessions'
  | 'reset-session-by-jid'
  | 'send-broadcast';

const DASHBOARD_VIEW_STORAGE_KEY = 'tmb_dashboard_view';

function isDashboardView(value: string): value is DashboardView {
  return value === 'setup'
    || value === 'analytics'
    || value === 'observability'
    || value === 'handoff'
    || value === 'broadcast'
    || value === 'sessions'
    || value === 'settings'
    || value === 'flows'
    || value === 'dbMaintenance';
}

function getInitialDashboardView(): DashboardView {
  const stored = String(window.localStorage.getItem(DASHBOARD_VIEW_STORAGE_KEY) || '').trim();
  return isDashboardView(stored) ? stored : 'analytics';
}

function App() {
  const [view, setView] = useState<DashboardView>(() => getInitialDashboardView());
  const [renderedView, setRenderedView] = useState<DashboardView>(() => getInitialDashboardView());
  const [viewTransition, setViewTransition] = useState<'idle' | 'enter' | 'exit'>('idle');
  const [needsInitialSetup, setNeedsInitialSetup] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mode, setMode] = useState<DashboardMode>('CONVERSATION');
  const [availableModes, setAvailableModes] = useState<DashboardMode[]>(['CONVERSATION']);
  const [botName, setBotName] = useState('...');
  const [flowPath, setFlowPath] = useState('');
  const [flowPathsByMode, setFlowPathsByMode] = useState<{ conversation: string[]; command: string[] }>({
    conversation: [],
    command: [],
  });
  const [uptimeMs, setUptimeMs] = useState(0);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [logs, setLogs] = useState<EventLog[]>([]);
  const [handoffBlocks, setHandoffBlocks] = useState<HandoffBlock[]>([]);
  const [handoffSessions, setHandoffSessions] = useState<HandoffSession[]>([]);
  const [selectedHandoffJid, setSelectedHandoffJid] = useState('');
  const [selectedHandoffHistory, setSelectedHandoffHistory] = useState<EventLog[]>([]);
  const [handoffMessage, setHandoffMessage] = useState('');
  const [resumeBlockId, setResumeBlockId] = useState('');
  const [busySend, setBusySend] = useState(false);
  const [busySendImage, setBusySendImage] = useState(false);
  const [busyResume, setBusyResume] = useState(false);
  const [busyEnd, setBusyEnd] = useState(false);
  const [confirmEndOpen, setConfirmEndOpen] = useState(false);
  const [pendingConfirmAction, setPendingConfirmAction] = useState<PendingConfirmAction | null>(null);
  const [broadcastContacts, setBroadcastContacts] = useState<BroadcastContact[]>([]);
  const [broadcastSearch, setBroadcastSearch] = useState('');
  const [broadcastRecipientMode, setBroadcastRecipientMode] = useState<'all' | 'selected'>('all');
  const [selectedBroadcastJids, setSelectedBroadcastJids] = useState<string[]>([]);
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [broadcastImageDataUrl, setBroadcastImageDataUrl] = useState('');
  const [broadcastImagePreviewUrl, setBroadcastImagePreviewUrl] = useState('');
  const [broadcastImageFileName, setBroadcastImageFileName] = useState('');
  const [busyBroadcastSend, setBusyBroadcastSend] = useState(false);
  const [broadcastLoadingContacts, setBroadcastLoadingContacts] = useState(false);
  const [broadcastLastResult, setBroadcastLastResult] = useState<BroadcastSendResult | null>(null);
  const [broadcastProgress, setBroadcastProgress] = useState<BroadcastSendProgress | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const stored = String(window.localStorage.getItem('tmb_theme') || '').trim().toLowerCase();
    return stored === 'dark' ? 'dark' : 'light';
  });
  const [autoReloadFlows, setAutoReloadFlows] = useState(true);
  const [broadcastSendIntervalMs, setBroadcastSendIntervalMs] = useState(250);
  const [dashboardTelemetryLevel, setDashboardTelemetryLevel] = useState<DashboardTelemetryLevel>('operational');
  const [observabilitySnapshot, setObservabilitySnapshot] = useState<ObservabilitySnapshot | null>(null);
  const [dbInfo, setDbInfo] = useState<DatabaseInfo | null>(null);
  const [dbMaintenanceConfig, setDbMaintenanceConfig] = useState<DbMaintenanceConfig | null>(null);
  const [dbMaintenanceStatus, setDbMaintenanceStatus] = useState<DbMaintenanceStatus | null>(null);
  const [busySaveSettings, setBusySaveSettings] = useState(false);
  const [busyClearRuntimeCache, setBusyClearRuntimeCache] = useState(false);
  const [busyRefreshDbInfo, setBusyRefreshDbInfo] = useState(false);
  const [busyRefreshDbMaintenance, setBusyRefreshDbMaintenance] = useState(false);
  const [busySaveDbMaintenance, setBusySaveDbMaintenance] = useState(false);
  const [busyRunDbMaintenance, setBusyRunDbMaintenance] = useState(false);
  const [sessionOverview, setSessionOverview] = useState<SessionOverview | null>(null);
  const [sessionFlows, setSessionFlows] = useState<SessionFlowConfigItem[]>([]);
  const [activeManagementSessions, setActiveManagementSessions] = useState<ActiveSessionManagementItem[]>([]);
  const [sessionSearch, setSessionSearch] = useState('');
  const [sessionSelectedFlowPath, setSessionSelectedFlowPath] = useState('');
  const [sessionTimeoutInputMinutes, setSessionTimeoutInputMinutes] = useState('');
  const [sessionResetJidInput, setSessionResetJidInput] = useState('');
  const [busySessionRefresh, setBusySessionRefresh] = useState(false);
  const [busySessionAction, setBusySessionAction] = useState(false);
  const [setupConfig, setSetupConfig] = useState<RuntimeSetupConfig | null>(null);
  const [setupBots, setSetupBots] = useState<BotInfo[]>([]);
  const [busySetupLoad, setBusySetupLoad] = useState(false);
  const [busySetupTargets, setBusySetupTargets] = useState(false);
  const [busySetupSave, setBusySetupSave] = useState(false);
  const [setupTargets, setSetupTargets] = useState<SetupTargetsResponse | null>(null);
  const [wsConnected, setWsConnected] = useState(false);

  const modeQuery = useMemo(() => modeToQuery(mode), [mode]);
  const prefersReducedMotion = useMemo(
    () => (typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false),
    []
  );

  const flowPathRef = useRef(flowPath);
  const flowPathsByModeRef = useRef(flowPathsByMode);
  const logsRef = useRef(logs);
  const selectedJidRef = useRef(selectedHandoffJid);
  const handoffSessionsRef = useRef(handoffSessions);
  const viewRef = useRef(view);
  const needsInitialSetupRef = useRef(needsInitialSetup);
  const busyBroadcastSendRef = useRef(busyBroadcastSend);
  const wsConnectedRef = useRef(wsConnected);
  const activeBroadcastCampaignIdRef = useRef<number | null>(null);
  const refreshTimeoutRef = useRef<number | null>(null);
  const lastCustomerToastByJidRef = useRef<Map<string, number>>(new Map());
  const { toasts, dismissToast, pushToast, showNotice } = useToastManager();

  useEffect(() => {
    flowPathRef.current = flowPath;
  }, [flowPath]);

  useEffect(() => {
    flowPathsByModeRef.current = flowPathsByMode;
  }, [flowPathsByMode]);

  useEffect(() => {
    logsRef.current = logs;
  }, [logs]);

  useEffect(() => {
    selectedJidRef.current = selectedHandoffJid;
  }, [selectedHandoffJid]);

  useEffect(() => {
    handoffSessionsRef.current = handoffSessions;
  }, [handoffSessions]);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    needsInitialSetupRef.current = needsInitialSetup;
  }, [needsInitialSetup]);

  useEffect(() => {
    busyBroadcastSendRef.current = busyBroadcastSend;
  }, [busyBroadcastSend]);

  useEffect(() => {
    wsConnectedRef.current = wsConnected;
  }, [wsConnected]);

  useEffect(() => {
    window.localStorage.setItem(DASHBOARD_VIEW_STORAGE_KEY, view);
  }, [view]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('theme-dark', theme === 'dark');
    window.localStorage.setItem('tmb_theme', theme);
    if (!prefersReducedMotion) {
      root.classList.add('theme-transitioning');
      const timer = window.setTimeout(() => {
        root.classList.remove('theme-transitioning');
      }, 420);
      return () => {
        window.clearTimeout(timer);
        root.classList.remove('theme-transitioning');
      };
    }
  }, [prefersReducedMotion, theme]);

  useEffect(() => {
    if (view === renderedView) return;
    if (prefersReducedMotion) {
      setRenderedView(view);
      setViewTransition('idle');
      return;
    }

    setViewTransition('exit');
    const switchTimer = window.setTimeout(() => {
      setRenderedView(view);
      setViewTransition('enter');
      window.requestAnimationFrame(() => setViewTransition('idle'));
    }, 180);

    return () => {
      window.clearTimeout(switchTimer);
    };
  }, [prefersReducedMotion, renderedView, view]);

  useEffect(() => {
    if (needsInitialSetup && view !== 'setup') {
      setView('setup');
    }
  }, [needsInitialSetup, view]);

  const markSessionAsResponded = useCallback((jid: string, text: string, eventType: string) => {
    const nowTs = Date.now();
    setHandoffSessions(previous =>
      previous.map(session => {
        if (session.jid !== jid) return session;
        return {
          ...session,
          lastMessage: {
            eventType,
            occurredAt: nowTs,
            text: text || session.lastMessage?.text || '',
          },
          lastActivityAt: nowTs,
        };
      })
    );
  }, []);

  const loadHealth = useCallback(async () => {
    const health = await fetchHealth();
    const nextNeedsInitialSetup = health.needsInitialSetup === true;
    const available = Array.isArray(health.availableModes) && health.availableModes.length > 0
      ? health.availableModes.map(item => toDashboardMode(item))
      : [toDashboardMode(health.mode)];
    const uniqueAvailable = [...new Set(available)];
    setNeedsInitialSetup(nextNeedsInitialSetup);
    if (nextNeedsInitialSetup) {
      setView('setup');
    }
    setAvailableModes(uniqueAvailable);
    setMode(previous => (uniqueAvailable.includes(previous) ? previous : toDashboardMode(health.mode)));
    setBotName(health.flowFile || 'Desconhecido');
    setFlowPath(String(health.flowPath || ''));
    setFlowPathsByMode({
      conversation: Array.isArray(health.flowPathsByMode?.conversation)
        ? health.flowPathsByMode.conversation.map(item => String(item))
        : [],
      command: Array.isArray(health.flowPathsByMode?.command)
        ? health.flowPathsByMode.command.map(item => String(item))
        : [],
    });
    setUptimeMs(Number(health.uptimeMs || 0));
    return nextNeedsInitialSetup;
  }, []);

  const loadRuntimeSettings = useCallback(async () => {
    const settings = await fetchRuntimeSettings();
    setAutoReloadFlows(settings.autoReloadFlows !== false);
    setBroadcastSendIntervalMs(Math.max(0, Math.floor(Number(settings.broadcastSendIntervalMs ?? 250) || 250)));
    const nextTelemetryLevel = String(settings.dashboardTelemetryLevel || '').trim().toLowerCase();
    if (nextTelemetryLevel === 'minimum' || nextTelemetryLevel === 'operational' || nextTelemetryLevel === 'diagnostic' || nextTelemetryLevel === 'verbose') {
      setDashboardTelemetryLevel(nextTelemetryLevel);
    } else {
      setDashboardTelemetryLevel('operational');
    }
  }, []);

  const loadSetupState = useCallback(async () => {
    const state = await fetchSetupState();
    setSetupConfig(state.config || null);
    const nextNeedsInitialSetup = state.needsInitialSetup === true;
    setNeedsInitialSetup(nextNeedsInitialSetup);
    if (nextNeedsInitialSetup) {
      setView('setup');
    }
    return nextNeedsInitialSetup;
  }, []);

  const loadSetupBots = useCallback(async () => {
    setBusySetupLoad(true);
    try {
      const bots = await fetchBots();
      setSetupBots(bots);
    } finally {
      setBusySetupLoad(false);
    }
  }, []);

  const loadSetupTargets = useCallback(async (search = '') => {
    setBusySetupTargets(true);
    try {
      const targets = await fetchSetupTargets(search, 400);
      setSetupTargets(targets);
    } finally {
      setBusySetupTargets(false);
    }
  }, []);

  const loadDbInfo = useCallback(async () => {
    setBusyRefreshDbInfo(true);
    try {
      const info = await fetchDatabaseInfo();
      setDbInfo(info);
    } finally {
      setBusyRefreshDbInfo(false);
    }
  }, []);

  const loadDbMaintenance = useCallback(async () => {
    setBusyRefreshDbMaintenance(true);
    try {
      const info = await fetchDbMaintenanceInfo();
      setDbMaintenanceConfig(info?.config || null);
      setDbMaintenanceStatus(info?.maintenanceStatus || null);
    } finally {
      setBusyRefreshDbMaintenance(false);
    }
  }, []);

  const refreshStats = useCallback(async () => {
    const nextStats = await fetchStats(modeQuery);
    setStats(nextStats);

    if (logsRef.current.length === 0) {
      const initialLogs = await fetchLogs(modeQuery, 50);
      const ordered = [...initialLogs].reverse();
      setLogs(trimLogs(sortHistory(ordered)));
    }
  }, [modeQuery]);

  const refreshObservability = useCallback(async () => {
    const snapshot = await fetchObservability();
    setObservabilitySnapshot(snapshot);
    const nextLevel = String(snapshot?.telemetryLevel || '').trim().toLowerCase();
    if (nextLevel === 'minimum' || nextLevel === 'operational' || nextLevel === 'diagnostic' || nextLevel === 'verbose') {
      setDashboardTelemetryLevel(nextLevel);
    }
  }, []);

  const refreshHandoffHistory = useCallback(async (jid: string) => {
    if (!jid) return;
    const history = await fetchHandoffHistory(jid, 200);
    setSelectedHandoffHistory(sortHistory(history));
  }, []);

  const refreshHandoffQueue = useCallback(async () => {
    const sessions = await fetchHandoffSessions();
    setHandoffSessions(sessions);

    const selected = selectedJidRef.current;
    if (!selected) return;

    const stillExists = sessions.some(session => session.jid === selected);
    if (!stillExists) {
      setSelectedHandoffJid('');
      setSelectedHandoffHistory([]);
      return;
    }

    await refreshHandoffHistory(selected);
  }, [refreshHandoffHistory]);

  const loadBroadcastContacts = useCallback(async (search = '') => {
    setBroadcastLoadingContacts(true);
    try {
      const contacts = await fetchBroadcastContacts(search, search ? 200 : 500);
      setBroadcastContacts(contacts);
    } finally {
      setBroadcastLoadingContacts(false);
    }
  }, []);

  const loadSessionOverviewAndFlows = useCallback(async () => {
    const [overview, flows] = await Promise.all([fetchSessionOverview(), fetchSessionFlows()]);
    setSessionOverview(overview);
    setSessionFlows(flows);
    setSessionSelectedFlowPath(previous => {
      if (previous && flows.some(flow => flow.flowPath === previous)) {
        return previous;
      }
      return flows[0]?.flowPath || '';
    });
    setSessionTimeoutInputMinutes(previous => {
      if (previous.trim()) return previous;
      const currentFlow = flows.find(flow => flow.flowPath === sessionSelectedFlowPath) || flows[0];
      return currentFlow ? String(currentFlow.sessionTimeoutMinutes) : '';
    });
  }, [sessionSelectedFlowPath]);

  const loadSessionActiveSessions = useCallback(async (search = '') => {
    const sessions = await fetchActiveSessionsForManagement(search, 350);
    setActiveManagementSessions(sessions);
  }, []);

  const refreshSessionManagement = useCallback(async (search = sessionSearch) => {
    setBusySessionRefresh(true);
    try {
      await Promise.all([loadSessionOverviewAndFlows(), loadSessionActiveSessions(search)]);
    } finally {
      setBusySessionRefresh(false);
    }
  }, [loadSessionActiveSessions, loadSessionOverviewAndFlows, sessionSearch]);

  const scheduleSoftRefresh = useCallback(() => {
    if (refreshTimeoutRef.current) {
      window.clearTimeout(refreshTimeoutRef.current);
    }

    refreshTimeoutRef.current = window.setTimeout(() => {
      void refreshStats();
      void refreshHandoffQueue();
    }, 2000);
  }, [refreshStats, refreshHandoffQueue]);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        const [needsSetupByHealth, needsSetupByState] = await Promise.all([
          loadHealth(),
          loadSetupState(),
        ]);
        await Promise.all([loadRuntimeSettings(), loadSetupBots(), loadSetupTargets()]);
        const needsSetup = Boolean(needsSetupByHealth || needsSetupByState);

        if (!needsSetup) {
          const blocks = await fetchHandoffBlocks();
          if (!cancelled) setHandoffBlocks(blocks);
          if (!cancelled) {
            await Promise.all([loadDbInfo(), loadDbMaintenance()]);
          }
          if (!cancelled) {
            await Promise.all([refreshStats(), refreshHandoffQueue(), refreshObservability()]);
          }
        }
      } catch (error) {
        if (!cancelled) {
          showNotice(`Falha ao inicializar dashboard: ${String((error as Error)?.message || error)}`);
        }
      }
    };

    void bootstrap();

    let pollTick = 0;
    const pollTimer = window.setInterval(() => {
      pollTick += 1;
      void loadHealth().catch(() => {});
      void loadSetupState().catch(() => {});
      if (needsInitialSetupRef.current || viewRef.current === 'setup') {
        void loadSetupTargets().catch(() => {});
      }
      if (needsInitialSetupRef.current) {
        return;
      }
      const wsOnline = wsConnectedRef.current;
      const shouldRunHeavyPolling = !wsOnline || (pollTick % 3 === 0);
      if (shouldRunHeavyPolling) {
        void refreshStats().catch(() => {});
        void refreshHandoffQueue().catch(() => {});
      }
      if (viewRef.current === 'observability' || shouldRunHeavyPolling) {
        void refreshObservability().catch(() => {});
      }
      if (viewRef.current === 'sessions') {
        void refreshSessionManagement().catch(() => {});
      }
      if (viewRef.current === 'dbMaintenance') {
        void loadDbMaintenance().catch(() => {});
      }
    }, 10000);

    return () => {
      cancelled = true;
      window.clearInterval(pollTimer);
      if (refreshTimeoutRef.current) window.clearTimeout(refreshTimeoutRef.current);
    };
  }, [
    loadDbInfo,
    loadDbMaintenance,
    loadHealth,
    loadRuntimeSettings,
    loadSetupBots,
    loadSetupState,
    loadSetupTargets,
    refreshHandoffQueue,
    refreshSessionManagement,
    refreshObservability,
    refreshStats,
    showNotice,
  ]);

  useEffect(() => {
    if (view !== 'broadcast') return;
    const timeout = window.setTimeout(() => {
      void loadBroadcastContacts(broadcastSearch).catch(error => {
        if (shouldIgnoreRequestError(error)) return;
        showNotice(`Falha ao carregar contatos para anúncio: ${String((error as Error)?.message || error)}`);
      });
    }, 220);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [broadcastSearch, loadBroadcastContacts, showNotice, view]);

  // Reatacha ao estado de uma campanha ja em andamento (reload/outro navegador).
  useEffect(() => {
    if (view !== 'broadcast') return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetchBroadcastStatus();
        if (cancelled) return;
        if (response?.active && response.campaign) {
          const campaign = response.campaign;
          activeBroadcastCampaignIdRef.current = campaign.campaignId || null;
          setBroadcastProgress(campaign);
          const controlStatus = campaign.controlStatus || 'running';
          const stillRunning =
            controlStatus === 'running' ||
            controlStatus === 'paused' ||
            controlStatus === 'cancelling';
          busyBroadcastSendRef.current = stillRunning;
          setBusyBroadcastSend(stillRunning);
        }
      } catch (error) {
        if (shouldIgnoreRequestError(error)) return;
        // Falha silenciosa: status e nao critico.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [view]);

  useEffect(() => {
    if (view !== 'settings') return;
    void loadDbInfo().catch(error => {
      showNotice(`Falha ao carregar informações do DB: ${String((error as Error)?.message || error)}`);
    });
  }, [loadDbInfo, showNotice, view]);

  useEffect(() => {
    if (view !== 'observability') return;
    void refreshObservability().catch(error => {
      if (shouldIgnoreRequestError(error)) return;
      showNotice(`Falha ao carregar observabilidade: ${String((error as Error)?.message || error)}`);
    });
  }, [refreshObservability, showNotice, view]);

  useEffect(() => {
    if (view !== 'dbMaintenance') return;
    void loadDbMaintenance().catch(error => {
      showNotice(`Falha ao carregar política de manutenção: ${String((error as Error)?.message || error)}`);
    });
  }, [loadDbMaintenance, showNotice, view]);

  useEffect(() => {
    if (view !== 'sessions') return;
    void refreshSessionManagement().catch(error => {
      if (shouldIgnoreRequestError(error)) return;
      showNotice(`Falha ao carregar dados de sessões: ${String((error as Error)?.message || error)}`);
    });
  }, [refreshSessionManagement, showNotice, view]);

  useEffect(() => {
    if (view !== 'sessions') return;
    const timeout = window.setTimeout(() => {
      void loadSessionActiveSessions(sessionSearch).catch(error => {
        if (shouldIgnoreRequestError(error)) return;
        showNotice(`Falha ao buscar sessões ativas: ${String((error as Error)?.message || error)}`);
      });
    }, 240);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [loadSessionActiveSessions, sessionSearch, showNotice, view]);

  useEffect(() => {
    if (view !== 'setup' && !needsInitialSetup) return;

    void loadSetupTargets().catch(error => {
      if (shouldIgnoreRequestError(error)) return;
      showNotice(`Falha ao carregar alvos do setup: ${String((error as Error)?.message || error)}`);
    });

    const timer = window.setInterval(() => {
      void loadSetupTargets().catch(() => {});
    }, 4000);

    return () => {
      window.clearInterval(timer);
    };
  }, [loadSetupTargets, needsInitialSetup, showNotice, view]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: number | null = null;
    let closedByClient = false;

    const processIncomingPayload = (payload: EventLog) => {
      const eventType = String(payload.eventType || '');
      const isTransientEvent = TRANSIENT_WS_EVENT_TYPES.has(eventType);
      const isBroadcastProgressEvent = eventType === 'broadcast-send-progress';
      if (!isBroadcastProgressEvent) {
        const currentModeQuery = modeToQuery(mode);
        const activeModeFlowPaths = flowPathsByModeRef.current[currentModeQuery] || [];
        if (activeModeFlowPaths.length > 0) {
          const payloadFlowPath = String(payload.flowPath || '');
          if (!payloadFlowPath || !activeModeFlowPaths.includes(payloadFlowPath)) {
            return;
          }
        } else if (flowPathRef.current && payload.flowPath && payload.flowPath !== flowPathRef.current) {
          return;
        }
      }

      if (isBroadcastProgressEvent) {
        const progress = toBroadcastProgress(payload);
        if (progress) {
          const trackedCampaignId = activeBroadcastCampaignIdRef.current;
          const campaignMatches = trackedCampaignId != null && trackedCampaignId > 0 && trackedCampaignId === progress.campaignId;
          if (busyBroadcastSendRef.current || campaignMatches) {
            if ((trackedCampaignId == null || trackedCampaignId <= 0) && progress.campaignId > 0) {
              activeBroadcastCampaignIdRef.current = progress.campaignId;
            }
            setBroadcastProgress(progress);
          }
        }
      }

      if (!isTransientEvent) {
        setLogs(previous => trimLogs(sortHistory([...previous, payload])));

        if (selectedJidRef.current && payload.jid === selectedJidRef.current) {
          setSelectedHandoffHistory(previous => trimLogs(sortHistory([...previous, payload]), 300));
        }
      }

      const chatJidFromMetadata = readMetadataText(payload, 'chatJid');
      const sessionJid = String(chatJidFromMetadata || payload.jid || '').trim();
      const outgoingErrorByText =
        eventType === 'message-outgoing' && isLikelyErrorMessage(String(payload.messageText || ''));
      const shouldRefresh =
        !isTransientEvent && (WS_REFRESH_EVENT_TYPES.has(eventType) || outgoingErrorByText || eventType.includes('human-handoff'));

      if (eventType === 'human-handoff-requested') {
        pushToast(
          'Novo Atendimento Humano',
          `${payload.jid || 'Usuário'} entrou na fila de atendimento.`,
          'warning',
          5200
        );
      }

      if (eventType === 'engine-error' || eventType === 'flow-error' || eventType === 'message-outgoing-error') {
        pushToast(
          'Erro no Sistema',
          String(payload.messageText || 'Ocorreu um erro durante o processamento.'),
          'danger',
          6200
        );
      }

      if (eventType === 'message-incoming' && sessionJid) {
        const inHandoffQueue = handoffSessionsRef.current.some(session => session.jid === sessionJid);
        const focusedSession = selectedJidRef.current === sessionJid;
        if (inHandoffQueue && !focusedSession) {
          const nowTs = Date.now();
          const lastToastAt = lastCustomerToastByJidRef.current.get(sessionJid) || 0;
          if (nowTs - lastToastAt > 4000) {
            lastCustomerToastByJidRef.current.set(sessionJid, nowTs);
            pushToast(
              'Nova Mensagem do Cliente',
              `${sessionJid} enviou uma nova mensagem.`,
              'info',
              4500
            );
          }
        }
      }

      if (eventType.includes('human-handoff')) {
        void refreshHandoffQueue();
      }

      if (shouldRefresh) {
        scheduleSoftRefresh();
      }
    };

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${protocol}://${window.location.host}/ws`);

      ws.onopen = () => {
        setWsConnected(true);
        const currentModeQuery = modeToQuery(mode);
        const modeFlowPaths = flowPathsByModeRef.current[currentModeQuery] || [];
        const activeFlowPaths = modeFlowPaths.length > 0
          ? modeFlowPaths
          : (flowPathRef.current ? [flowPathRef.current] : []);
        const lastEventId = logsRef.current.reduce((maxId, item) => (
          Math.max(maxId, Number(item.id) || 0)
        ), 0);

        try {
          ws?.send(JSON.stringify({
            type: 'subscribe',
            payload: {
              mode: currentModeQuery,
              flowPaths: activeFlowPaths,
              channels: ['all'],
              lastEventId,
            },
          }));
        } catch {
          // ignore subscribe send failures
        }
      };

      ws.onmessage = event => {
        try {
          const incoming = JSON.parse(event.data) as { type?: string; payload?: EventLog | EventLog[] };
          const type = String(incoming?.type || '').trim().toLowerCase();
          if (type === 'event' && incoming.payload && !Array.isArray(incoming.payload)) {
            processIncomingPayload(incoming.payload);
            return;
          }
          if (type === 'events' && Array.isArray(incoming.payload)) {
            for (const payload of incoming.payload) {
              if (!payload || typeof payload !== 'object') continue;
              processIncomingPayload(payload);
            }
          }
        } catch {
          // ignore malformed payloads
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (closedByClient) return;
        reconnectTimeout = window.setTimeout(connect, 3000);
      };
    };

    connect();

    return () => {
      closedByClient = true;
      setWsConnected(false);
      if (reconnectTimeout) window.clearTimeout(reconnectTimeout);
      if (ws && ws.readyState < WebSocket.CLOSING) ws.close();
    };
  }, [mode, pushToast, refreshHandoffQueue, scheduleSoftRefresh]);

  const {
    handleSelectHandoffSession,
    handleSendHandoff,
    handleSendHandoffImage,
    handleResumeHandoff,
    handleEndHandoff,
    openEndSessionModal,
  } = useHandoffActions({
    selectedJidRef,
    handoffMessage,
    resumeBlockId,
    setBusySend,
    setBusySendImage,
    setBusyResume,
    setBusyEnd,
    setHandoffMessage,
    setSelectedHandoffJid,
    setSelectedHandoffHistory,
    setResumeBlockId,
    setConfirmEndOpen,
    refreshHandoffHistory,
    refreshHandoffQueue,
    refreshStats,
    markSessionAsResponded,
    showNotice,
  });

  const {
    openBroadcastSendModal,
    handleToggleBroadcastRecipient,
    handleSelectAllBroadcastVisible,
    handlePickBroadcastImage,
    handleSendBroadcast,
    handlePauseBroadcast,
    handleResumeBroadcast,
    handleCancelBroadcast,
  } = useBroadcastActions({
    broadcastMessage,
    broadcastImageDataUrl,
    broadcastImageFileName,
    broadcastRecipientMode,
    selectedBroadcastJids,
    broadcastContacts,
    setPendingConfirmAction,
    setSelectedBroadcastJids,
    setBroadcastImageDataUrl,
    setBroadcastImagePreviewUrl,
    setBroadcastImageFileName,
    setBroadcastProgress,
    setBroadcastLastResult,
    setBusyBroadcastSend,
    setBroadcastMessage,
    activeBroadcastCampaignIdRef,
    busyBroadcastSendRef,
    showNotice,
  });

  const {
    handleToggleAutoReload,
    handleUpdateBroadcastSendInterval,
    handleUpdateTelemetryLevel,
    handleClearRuntimeCache,
    handleSaveDbMaintenance,
    handleRunDbMaintenanceNow,
  } = useSettingsActions({
    loadRuntimeSettings,
    loadDbInfo,
    loadDbMaintenance,
    refreshObservability,
    setAutoReloadFlows,
    setBroadcastSendIntervalMs,
    setDashboardTelemetryLevel,
    setDbMaintenanceConfig,
    setDbMaintenanceStatus,
    setBusySaveSettings,
    setBusyClearRuntimeCache,
    setBusySaveDbMaintenance,
    setBusyRunDbMaintenance,
    showNotice,
  });

  const {
    handleSelectSessionFlow,
    handleClearAllSessions,
    handleClearSessionsByFlow,
    handleResetSessionByJid,
    handleUpdateSessionTimeout,
  } = useSessionManagementActions({
    sessionFlows,
    sessionSelectedFlowPath,
    sessionTimeoutInputMinutes,
    sessionResetJidInput,
    refreshSessionManagement,
    setSessionSelectedFlowPath,
    setSessionTimeoutInputMinutes,
    setBusySessionAction,
    setSessionResetJidInput,
    setSessionFlows,
    showNotice,
  });

  const openConfirmAction = useCallback((action: PendingConfirmAction) => {
    setPendingConfirmAction(action);
  }, []);

  const handleSaveSetup = useCallback(async (input: Partial<RuntimeSetupConfig>) => {
    setBusySetupSave(true);
    try {
      const next = await postSetupState(input);
      setSetupConfig(next.config || null);
      setNeedsInitialSetup(next.needsInitialSetup === true);
      await Promise.all([loadHealth(), loadRuntimeSettings(), loadSetupBots(), loadSetupTargets(), loadDbMaintenance()]);
      const blocks = await fetchHandoffBlocks();
      setHandoffBlocks(blocks);

      if (next.needsInitialSetup) {
        setView('setup');
        showNotice('Configuração salva. Finalize os campos obrigatórios para iniciar o runtime.');
      } else {
        if (viewRef.current === 'setup') {
          setView('analytics');
        }
        await Promise.all([refreshStats(), refreshHandoffQueue(), refreshObservability()]);
        showNotice('Configuração aplicada com sucesso.');
      }
    } catch (error) {
      showNotice(`Falha ao aplicar setup: ${String((error as Error)?.message || error)}`);
    } finally {
      setBusySetupSave(false);
    }
  }, [
    loadHealth,
    loadDbMaintenance,
    loadRuntimeSettings,
    loadSetupBots,
    loadSetupTargets,
    refreshHandoffQueue,
    refreshObservability,
    refreshStats,
    showNotice,
  ]);

  const confirmActionBusy =
    pendingConfirmAction === 'send-broadcast'
      ? busyBroadcastSend
      : pendingConfirmAction === 'clear-runtime-cache'
        ? busyClearRuntimeCache
        : pendingConfirmAction === 'clear-all-sessions' || pendingConfirmAction === 'clear-flow-sessions' || pendingConfirmAction === 'reset-session-by-jid'
          ? busySessionAction
          : false;

  const confirmActionConfig = useMemo(() => {
    if (!pendingConfirmAction) return null;

    if (pendingConfirmAction === 'clear-runtime-cache') {
      return {
        title: 'Limpar cache runtime',
        description: 'Esta ação remove o cache em memória de sessões/blocos para diagnóstico.',
        confirmLabel: confirmActionBusy ? 'Limpando...' : 'Limpar cache',
        variant: 'danger' as const,
      };
    }

    if (pendingConfirmAction === 'clear-all-sessions') {
      return {
        title: 'Limpar todas as sessões ativas',
        description: 'Deseja remover todas as sessões ativas agora? Esta ação não pode ser desfeita.',
        confirmLabel: confirmActionBusy ? 'Limpando...' : 'Limpar todas',
        variant: 'danger' as const,
      };
    }

    if (pendingConfirmAction === 'clear-flow-sessions') {
      const flowPath = sessionSelectedFlowPath.trim();
      return {
        title: 'Limpar sessões do flow',
        description: flowPath
          ? `Deseja remover as sessões ativas do flow ${flowPath}?`
          : 'Deseja remover as sessões ativas do flow selecionado?',
        confirmLabel: confirmActionBusy ? 'Limpando...' : 'Limpar flow',
        variant: 'danger' as const,
      };
    }

    if (pendingConfirmAction === 'reset-session-by-jid') {
      const jid = sessionResetJidInput.trim();
      return {
        title: 'Resetar sessão por JID',
        description: jid
          ? `Deseja resetar as sessões associadas ao JID ${jid}?`
          : 'Deseja resetar as sessões associadas ao JID informado?',
        confirmLabel: confirmActionBusy ? 'Resetando...' : 'Resetar JID',
        variant: 'danger' as const,
      };
    }

    const recipients = broadcastRecipientMode === 'all' ? broadcastContacts.length : selectedBroadcastJids.length;
    return {
      title: 'Enviar anúncio em massa',
      description: `Confirma envio para ${recipients} destinatário(s)?`,
      confirmLabel: confirmActionBusy ? 'Enviando...' : 'Enviar anúncio',
      variant: 'primary' as const,
    };
  }, [
    broadcastContacts.length,
    broadcastRecipientMode,
    confirmActionBusy,
    pendingConfirmAction,
    selectedBroadcastJids.length,
    sessionResetJidInput,
    sessionSelectedFlowPath,
  ]);

  const handleConfirmPendingAction = useCallback(async () => {
    if (!pendingConfirmAction) return;

    if (pendingConfirmAction === 'clear-runtime-cache') {
      await handleClearRuntimeCache();
      setPendingConfirmAction(null);
      return;
    }

    if (pendingConfirmAction === 'clear-all-sessions') {
      await handleClearAllSessions();
      setPendingConfirmAction(null);
      return;
    }

    if (pendingConfirmAction === 'clear-flow-sessions') {
      await handleClearSessionsByFlow();
      setPendingConfirmAction(null);
      return;
    }

    if (pendingConfirmAction === 'reset-session-by-jid') {
      await handleResetSessionByJid();
      setPendingConfirmAction(null);
      return;
    }

    setPendingConfirmAction(null);
    await handleSendBroadcast();
  }, [
    handleClearAllSessions,
    handleClearRuntimeCache,
    handleClearSessionsByFlow,
    handleResetSessionByJid,
    handleSendBroadcast,
    pendingConfirmAction,
  ]);

  return (
    <div className="flex min-h-screen">
      <Sidebar
        currentView={view}
        onNavigate={setView}
        mobileOpen={sidebarOpen}
        onCloseMobile={() => setSidebarOpen(false)}
        needsInitialSetup={needsInitialSetup}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          mode={mode}
          availableModes={availableModes}
          onModeChange={setMode}
          botName={botName}
          uptimeMs={uptimeMs}
          onOpenSidebar={() => setSidebarOpen(true)}
        />

        <ToastCenter items={toasts} onDismiss={dismissToast} />

        <main
          className={[
            'flex-1 overflow-auto p-3 sm:p-5',
            'view-stage',
            viewTransition === 'enter' ? 'view-stage-enter' : '',
            viewTransition === 'exit' ? 'view-stage-exit' : '',
          ].join(' ')}
        >
          {renderedView === 'setup' && (
            <SetupView
              key={[
                setupConfig?.flowPath || '',
                setupConfig?.runtimeMode || '',
                setupConfig?.botRuntimeMode || '',
                (setupConfig?.flowPaths || []).join('|'),
                (setupConfig?.testJids || []).join('|'),
                (setupConfig?.groupWhitelistJids || []).join('|'),
              ].join('::')}
              needsInitialSetup={needsInitialSetup}
              bots={setupBots}
              setupConfig={setupConfig}
              busyLoad={busySetupLoad}
              busyTargets={busySetupTargets}
              busySave={busySetupSave}
              setupTargets={setupTargets}
              onReloadBots={() => {
                void loadSetupBots();
              }}
              onRefreshTargets={() => {
                void loadSetupTargets();
              }}
              onSave={input => {
                void handleSaveSetup(input);
              }}
              onShowNotice={showNotice}
            />
          )}

          {renderedView === 'analytics' && (
            <AnalyticsView
              mode={mode}
              stats={stats}
              logs={logs}
              onExport={() => window.open('/api/export?format=csv', '_blank')}
            />
          )}

          {renderedView === 'observability' && (
            <ObservabilityView
              snapshot={observabilitySnapshot}
              telemetryLevel={dashboardTelemetryLevel}
              busySaveSettings={busySaveSettings}
              onTelemetryLevelChange={level => {
                void handleUpdateTelemetryLevel(level);
              }}
              onRefresh={() => {
                void refreshObservability().catch(error => {
                  if (shouldIgnoreRequestError(error)) return;
                  showNotice(`Falha ao atualizar observabilidade: ${String((error as Error)?.message || error)}`);
                });
              }}
            />
          )}

          {renderedView === 'handoff' && (
            <HandoffView
              sessions={handoffSessions}
              blocks={handoffBlocks}
              selectedJid={selectedHandoffJid}
              history={selectedHandoffHistory}
              messageText={handoffMessage}
              selectedBlockId={resumeBlockId}
              busySend={busySend}
              busySendImage={busySendImage}
              busyResume={busyResume}
              busyEnd={busyEnd}
              onMessageChange={setHandoffMessage}
              onSelectBlock={setResumeBlockId}
              onSelectSession={handleSelectHandoffSession}
              onRefreshSessions={() => {
                void refreshHandoffQueue();
              }}
              onSend={handleSendHandoff}
              onSendImage={handleSendHandoffImage}
              onResume={() => {
                void handleResumeHandoff();
              }}
              onEnd={openEndSessionModal}
            />
          )}

          {renderedView === 'broadcast' && (
            <BroadcastView
              contacts={broadcastContacts}
              loadingContacts={broadcastLoadingContacts}
              recipientMode={broadcastRecipientMode}
              selectedJids={selectedBroadcastJids}
              search={broadcastSearch}
              messageText={broadcastMessage}
              imageFileName={broadcastImageFileName}
              imagePreviewUrl={broadcastImagePreviewUrl}
              busySend={busyBroadcastSend}
              lastResult={broadcastLastResult}
              sendProgress={broadcastProgress}
              broadcastSendIntervalMs={broadcastSendIntervalMs}
              onRecipientModeChange={setBroadcastRecipientMode}
              onSearchChange={setBroadcastSearch}
              onRefreshContacts={() => {
                void loadBroadcastContacts(broadcastSearch);
              }}
              onToggleRecipient={handleToggleBroadcastRecipient}
              onSelectAllVisible={handleSelectAllBroadcastVisible}
              onClearSelection={() => setSelectedBroadcastJids([])}
              onMessageChange={setBroadcastMessage}
              onPickImage={file => {
                void handlePickBroadcastImage(file);
              }}
              onClearImage={() => {
                setBroadcastImageDataUrl('');
                setBroadcastImagePreviewUrl('');
                setBroadcastImageFileName('');
              }}
              onSend={() => {
                void openBroadcastSendModal();
              }}
              onPause={() => {
                void handlePauseBroadcast();
              }}
              onResume={() => {
                void handleResumeBroadcast();
              }}
              onCancel={() => {
                void handleCancelBroadcast();
              }}
            />
          )}

          {renderedView === 'sessions' && (
            <SessionManagementView
              overview={sessionOverview}
              activeSessions={activeManagementSessions}
              flows={sessionFlows}
              search={sessionSearch}
              selectedFlowPath={sessionSelectedFlowPath}
              timeoutInputMinutes={sessionTimeoutInputMinutes}
              resetJidInput={sessionResetJidInput}
              busyRefresh={busySessionRefresh}
              busyAction={busySessionAction}
              onSearchChange={setSessionSearch}
              onRefresh={() => {
                void refreshSessionManagement();
              }}
              onClearAll={() => {
                openConfirmAction('clear-all-sessions');
              }}
              onClearFlow={() => {
                openConfirmAction('clear-flow-sessions');
              }}
              onResetJidInputChange={setSessionResetJidInput}
              onResetByJid={() => {
                openConfirmAction('reset-session-by-jid');
              }}
              onSelectFlowPath={handleSelectSessionFlow}
              onTimeoutInputChange={setSessionTimeoutInputMinutes}
              onUpdateTimeout={() => {
                void handleUpdateSessionTimeout();
              }}
            />
          )}

          {renderedView === 'flows' && (
            <FlowsView 
              onShowNotice={showNotice}
            />
          )}

          {renderedView === 'dbMaintenance' && (
            <DbMaintenanceView
              config={dbMaintenanceConfig}
              status={dbMaintenanceStatus}
              busyLoad={busyRefreshDbMaintenance}
              busySave={busySaveDbMaintenance}
              busyRun={busyRunDbMaintenance}
              onRefresh={() => {
                void Promise.all([loadDbMaintenance(), loadDbInfo()]).catch(error => {
                  showNotice(`Falha ao atualizar painel de manutenção: ${String((error as Error)?.message || error)}`);
                });
              }}
              onSave={input => {
                void handleSaveDbMaintenance(input);
              }}
              onRunNow={() => {
                void handleRunDbMaintenanceNow();
              }}
            />
          )}

          {renderedView === 'settings' && (
            <SettingsView
              autoReloadFlows={autoReloadFlows}
              broadcastSendIntervalMs={broadcastSendIntervalMs}
              theme={theme}
              dbInfo={dbInfo}
              busySaveSettings={busySaveSettings}
              busyClearCache={busyClearRuntimeCache}
              busyRefreshDb={busyRefreshDbInfo}
              onToggleAutoReload={value => {
                void handleToggleAutoReload(value);
              }}
              onUpdateBroadcastSendInterval={value => {
                void handleUpdateBroadcastSendInterval(value);
              }}
              onToggleTheme={setTheme}
              onClearCache={() => {
                openConfirmAction('clear-runtime-cache');
              }}
              onRefreshDbInfo={() => {
                void loadDbInfo().catch(error => {
                  showNotice(`Falha ao atualizar informações do DB: ${String((error as Error)?.message || error)}`);
                });
              }}
            />
          )}
        </main>
      </div>

      <Modal
        open={confirmEndOpen}
        title="Encerrar sessão"
        description="Deseja encerrar esta sessão agora?"
        onClose={() => setConfirmEndOpen(false)}
        actions={[
          {
            label: 'Cancelar',
            variant: 'ghost',
            onClick: () => setConfirmEndOpen(false),
            disabled: busyEnd,
          },
          {
            label: busyEnd ? 'Encerrando...' : 'Encerrar',
            variant: 'danger',
            onClick: () => {
              void handleEndHandoff();
            },
            disabled: busyEnd,
          },
        ]}
      />

      <Modal
        open={pendingConfirmAction !== null && confirmActionConfig !== null}
        title={confirmActionConfig?.title || 'Confirmar ação'}
        description={confirmActionConfig?.description || ''}
        onClose={() => {
          if (!confirmActionBusy) setPendingConfirmAction(null);
        }}
        actions={[
          {
            label: 'Cancelar',
            variant: 'ghost',
            onClick: () => setPendingConfirmAction(null),
            disabled: confirmActionBusy,
          },
          {
            label: confirmActionConfig?.confirmLabel || 'Confirmar',
            variant: confirmActionConfig?.variant || 'primary',
            onClick: () => {
              void handleConfirmPendingAction();
            },
            disabled: confirmActionBusy,
          },
        ]}
      />
    </div>
  );
}

export default App;


