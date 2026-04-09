import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchActiveSessionsForManagement,
  fetchBroadcastContacts,
  fetchDatabaseInfo,
  fetchHandoffBlocks,
  fetchHandoffHistory,
  fetchHandoffSessions,
  fetchHealth,
  fetchLogs,
  fetchRuntimeSettings,
  fetchSessionFlows,
  fetchSessionOverview,
  postClearAllActiveSessions,
  postClearFlowSessions,
  postClearRuntimeCache,
  postBroadcastSend,
  postResetSessionByJid,
  postRuntimeSettings,
  fetchStats,
  postHandoffEnd,
  postHandoffImage,
  postHandoffMessage,
  postHandoffResume,
  postUpdateFlowSessionTimeout,
} from './lib/api';
import { isLikelyErrorMessage } from './lib/format';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { AnalyticsView } from './components/analytics/AnalyticsView';
import { BroadcastView } from './components/broadcast/BroadcastView';
import { HandoffView } from './components/handoff/HandoffView';
import { SessionManagementView } from './components/sessions/SessionManagementView';
import { FlowsView } from './components/flows/FlowsView';
import { SettingsView } from './components/settings/SettingsView';
import { Modal } from './components/Modal';
import { ToastCenter } from './components/feedback/ToastCenter';
import type { ToastItem, ToastTone } from './components/feedback/ToastCenter';
import type {
  DashboardMode,
  DashboardStats,
  DashboardView,
  DatabaseInfo,
  EventLog,
  BroadcastContact,
  BroadcastSendResult,
  BroadcastSendProgress,
  HandoffBlock,
  HandoffSession,
  ActiveSessionManagementItem,
  SessionFlowConfigItem,
  SessionOverview,
} from './types';

const WS_REFRESH_EVENT_TYPES = new Set([
  'session-start',
  'session-end',
  'command-executed',
  'flow-error',
  'engine-error',
  'message-outgoing-error',
  'message-outgoing',
  'human-message-outgoing',
  'human-image-outgoing',
]);
const TRANSIENT_WS_EVENT_TYPES = new Set(['broadcast-send-progress']);

function toDashboardMode(mode: string): DashboardMode {
  return String(mode).toLowerCase() === 'command' ? 'COMMAND' : 'CONVERSATION';
}

function modeToQuery(mode: DashboardMode): 'conversation' | 'command' {
  return mode === 'COMMAND' ? 'command' : 'conversation';
}

function trimLogs(logs: EventLog[], max = 200): EventLog[] {
  if (logs.length <= max) return logs;
  return logs.slice(logs.length - max);
}

function readMetadataText(log: EventLog, key: string): string {
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

function sortHistory(logs: EventLog[]): EventLog[] {
  return dedupeLogs([...logs]).sort((a, b) => {
    const aTime = Number(a.occurredAt) || 0;
    const bTime = Number(b.occurredAt) || 0;
    if (aTime !== bTime) return aTime - bTime;
    return (Number(a.id) || 0) - (Number(b.id) || 0);
  });
}

function fileToDataUrl(file: File): Promise<string> {
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

function mapMessageToTone(message: string): ToastTone {
  const normalized = String(message || '').toLowerCase();
  if (normalized.includes('sucesso')) return 'success';
  if (normalized.includes('erro') || normalized.includes('falha')) return 'danger';
  if (normalized.includes('aten') || normalized.includes('aguardando')) return 'warning';
  return 'info';
}

function readMetadataNumber(log: EventLog, key: string, fallback = 0): number {
  const metadata = log.metadata;
  if (!metadata || typeof metadata !== 'object') return fallback;
  const raw = (metadata as Record<string, unknown>)[key];
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function toBroadcastProgress(log: EventLog): BroadcastSendProgress | null {
  if (String(log.eventType || '').trim().toLowerCase() !== 'broadcast-send-progress') {
    return null;
  }

  const attempted = Math.max(0, readMetadataNumber(log, 'attempted', 0));
  const sent = Math.max(0, readMetadataNumber(log, 'sent', 0));
  const failed = Math.max(0, readMetadataNumber(log, 'failed', 0));
  const processed = Math.max(0, Math.min(attempted, readMetadataNumber(log, 'processed', sent + failed)));
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
  const jid = String(log.jid || '').trim();

  return {
    campaignId: Math.max(0, readMetadataNumber(log, 'campaignId', 0)),
    attempted,
    processed,
    sent,
    failed,
    remaining,
    percent,
    status,
    recipientStatus,
    jid: jid || '',
  };
}

type PendingConfirmAction =
  | 'clear-runtime-cache'
  | 'clear-all-sessions'
  | 'clear-flow-sessions'
  | 'reset-session-by-jid'
  | 'send-broadcast';

function App() {
  const [view, setView] = useState<DashboardView>('analytics');
  const [renderedView, setRenderedView] = useState<DashboardView>('analytics');
  const [viewTransition, setViewTransition] = useState<'idle' | 'enter' | 'exit'>('idle');
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
  const [toasts, setToasts] = useState<ToastItem[]>([]);
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
  const [dbInfo, setDbInfo] = useState<DatabaseInfo | null>(null);
  const [busySaveSettings, setBusySaveSettings] = useState(false);
  const [busyClearRuntimeCache, setBusyClearRuntimeCache] = useState(false);
  const [busyRefreshDbInfo, setBusyRefreshDbInfo] = useState(false);
  const [sessionOverview, setSessionOverview] = useState<SessionOverview | null>(null);
  const [sessionFlows, setSessionFlows] = useState<SessionFlowConfigItem[]>([]);
  const [activeManagementSessions, setActiveManagementSessions] = useState<ActiveSessionManagementItem[]>([]);
  const [sessionSearch, setSessionSearch] = useState('');
  const [sessionSelectedFlowPath, setSessionSelectedFlowPath] = useState('');
  const [sessionTimeoutInputMinutes, setSessionTimeoutInputMinutes] = useState('');
  const [sessionResetJidInput, setSessionResetJidInput] = useState('');
  const [busySessionRefresh, setBusySessionRefresh] = useState(false);
  const [busySessionAction, setBusySessionAction] = useState(false);

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
  const busyBroadcastSendRef = useRef(busyBroadcastSend);
  const activeBroadcastCampaignIdRef = useRef<number | null>(null);
  const refreshTimeoutRef = useRef<number | null>(null);
  const toastTimersRef = useRef<Map<string, number>>(new Map());
  const lastCustomerToastByJidRef = useRef<Map<string, number>>(new Map());

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
    busyBroadcastSendRef.current = busyBroadcastSend;
  }, [busyBroadcastSend]);

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

  const dismissToast = useCallback((id: string) => {
    setToasts(previous => previous.filter(item => item.id !== id));
    const timer = toastTimersRef.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      toastTimersRef.current.delete(id);
    }
  }, []);

  const pushToast = useCallback((title: string, message: string, tone: ToastTone = 'info', ttlMs = 4200) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts(previous => [...previous.slice(-4), { id, title, message, tone }]);
    const timer = window.setTimeout(() => {
      dismissToast(id);
    }, ttlMs);
    toastTimersRef.current.set(id, timer);
  }, [dismissToast]);

  const showNotice = useCallback((message: string) => {
    pushToast('Notificação', message, mapMessageToTone(message));
  }, [pushToast]);

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
    const available = Array.isArray(health.availableModes) && health.availableModes.length > 0
      ? health.availableModes.map(item => toDashboardMode(item))
      : [toDashboardMode(health.mode)];
    const uniqueAvailable = [...new Set(available)];
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
  }, []);

  const loadRuntimeSettings = useCallback(async () => {
    const settings = await fetchRuntimeSettings();
    setAutoReloadFlows(settings.autoReloadFlows !== false);
    setBroadcastSendIntervalMs(Math.max(0, Math.floor(Number(settings.broadcastSendIntervalMs ?? 250) || 250)));
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

  const refreshStats = useCallback(async () => {
    const nextStats = await fetchStats(modeQuery);
    setStats(nextStats);

    if (logsRef.current.length === 0) {
      const initialLogs = await fetchLogs(modeQuery, 50);
      const ordered = [...initialLogs].reverse();
      setLogs(trimLogs(sortHistory(ordered)));
    }
  }, [modeQuery]);

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
        await loadHealth();
        await loadRuntimeSettings();
        const blocks = await fetchHandoffBlocks();
        if (!cancelled) setHandoffBlocks(blocks);
        if (!cancelled) {
          await loadDbInfo();
        }
        if (!cancelled) {
          await Promise.all([refreshStats(), refreshHandoffQueue()]);
        }
      } catch (error) {
        if (!cancelled) {
          showNotice(`Falha ao inicializar dashboard: ${String((error as Error)?.message || error)}`);
        }
      }
    };

    void bootstrap();

    const pollTimer = window.setInterval(() => {
      void loadHealth().catch(() => {});
      void refreshStats().catch(() => {});
      void refreshHandoffQueue().catch(() => {});
      if (viewRef.current === 'sessions') {
        void refreshSessionManagement().catch(() => {});
      }
    }, 30000);

    const toastTimers = toastTimersRef.current;
    return () => {
      cancelled = true;
      window.clearInterval(pollTimer);
      if (refreshTimeoutRef.current) window.clearTimeout(refreshTimeoutRef.current);
      for (const timer of toastTimers.values()) {
        window.clearTimeout(timer);
      }
      toastTimers.clear();
    };
  }, [loadDbInfo, loadHealth, loadRuntimeSettings, refreshHandoffQueue, refreshSessionManagement, refreshStats, showNotice]);

  useEffect(() => {
    if (view !== 'broadcast') return;
    const timeout = window.setTimeout(() => {
      void loadBroadcastContacts(broadcastSearch).catch(error => {
        showNotice(`Falha ao carregar contatos para anuncio: ${String((error as Error)?.message || error)}`);
      });
    }, 220);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [broadcastSearch, loadBroadcastContacts, showNotice, view]);

  useEffect(() => {
    if (view !== 'settings') return;
    void loadDbInfo().catch(error => {
      showNotice(`Falha ao carregar informacoes do DB: ${String((error as Error)?.message || error)}`);
    });
  }, [loadDbInfo, showNotice, view]);

  useEffect(() => {
    if (view !== 'sessions') return;
    void refreshSessionManagement().catch(error => {
      showNotice(`Falha ao carregar dados de sessoes: ${String((error as Error)?.message || error)}`);
    });
  }, [refreshSessionManagement, showNotice, view]);

  useEffect(() => {
    if (view !== 'sessions') return;
    const timeout = window.setTimeout(() => {
      void loadSessionActiveSessions(sessionSearch).catch(error => {
        showNotice(`Falha ao buscar sessoes ativas: ${String((error as Error)?.message || error)}`);
      });
    }, 240);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [loadSessionActiveSessions, sessionSearch, showNotice, view]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: number | null = null;

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${protocol}://${window.location.host}/ws`);

      ws.onmessage = event => {
        try {
          const incoming = JSON.parse(event.data) as { type?: string; payload?: EventLog };
          if (incoming.type !== 'event' || !incoming.payload) return;

          const payload = incoming.payload;
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
        } catch {
          // ignore malformed payloads
        }
      };

      ws.onclose = () => {
        reconnectTimeout = window.setTimeout(connect, 3000);
      };
    };

    connect();

    return () => {
      if (reconnectTimeout) window.clearTimeout(reconnectTimeout);
      if (ws && ws.readyState < WebSocket.CLOSING) ws.close();
    };
  }, [mode, pushToast, refreshHandoffQueue, scheduleSoftRefresh]);

  const handleSelectHandoffSession = useCallback(async (jid: string) => {
    setSelectedHandoffJid(jid);
    setResumeBlockId('');
    try {
      await refreshHandoffHistory(jid);
    } catch (error) {
      showNotice(`Falha ao carregar histórico: ${String((error as Error)?.message || error)}`);
    }
  }, [refreshHandoffHistory, showNotice]);

  const handleSendHandoff = useCallback(async () => {
    const jid = selectedJidRef.current;
    const text = handoffMessage.trim();
    if (!jid || !text) return;

    setBusySend(true);
    try {
      await postHandoffMessage(jid, text);
      setHandoffMessage('');
      markSessionAsResponded(jid, text, 'human-message-outgoing');
      await refreshHandoffHistory(jid);
      await refreshHandoffQueue();
    } catch (error) {
      showNotice(`Não foi possível enviar a mensagem: ${String((error as Error)?.message || error)}`);
    } finally {
      setBusySend(false);
    }
  }, [handoffMessage, markSessionAsResponded, refreshHandoffHistory, refreshHandoffQueue, showNotice]);

  const handleSendHandoffImage = useCallback(async (file: File) => {
    const jid = selectedJidRef.current;
    if (!jid) return;

    if (!file.type.startsWith('image/')) {
      showNotice('Selecione um arquivo de imagem válido.');
      return;
    }

    setBusySendImage(true);
    try {
      const imageDataUrl = await fileToDataUrl(file);
      const caption = handoffMessage.trim();
      await postHandoffImage(jid, imageDataUrl, {
        caption,
        fileName: file.name,
        mimeType: file.type,
      });
      setHandoffMessage('');
      markSessionAsResponded(jid, caption || `[Imagem] ${file.name}`, 'human-image-outgoing');
      await refreshHandoffHistory(jid);
      await refreshHandoffQueue();
    } catch (error) {
      showNotice(`Não foi possível enviar a imagem: ${String((error as Error)?.message || error)}`);
    } finally {
      setBusySendImage(false);
    }
  }, [handoffMessage, markSessionAsResponded, refreshHandoffHistory, refreshHandoffQueue, showNotice]);

  const handleResumeHandoff = useCallback(async () => {
    const jid = selectedJidRef.current;
    if (!jid) return;
    if (!resumeBlockId.trim()) {
      showNotice('Selecione um bloco para retomar a sessão.');
      return;
    }

    setBusyResume(true);
    try {
      await postHandoffResume(jid, resumeBlockId);
      await refreshHandoffQueue();
      await refreshStats();
      showNotice('Sessão retomada com sucesso.');
    } catch (error) {
      showNotice(`Não foi possível retomar a sessão: ${String((error as Error)?.message || error)}`);
    } finally {
      setBusyResume(false);
    }
  }, [refreshHandoffQueue, refreshStats, resumeBlockId, showNotice]);

  const handleEndHandoff = useCallback(async () => {
    const jid = selectedJidRef.current;
    if (!jid) return;

    setBusyEnd(true);
    try {
      await postHandoffEnd(jid);
      setSelectedHandoffJid('');
      setSelectedHandoffHistory([]);
      setResumeBlockId('');
      setConfirmEndOpen(false);
      await Promise.all([refreshHandoffQueue(), refreshStats()]);
      showNotice('Sessão encerrada com sucesso.');
    } catch (error) {
      showNotice(`Não foi possível encerrar a sessão: ${String((error as Error)?.message || error)}`);
    } finally {
      setBusyEnd(false);
    }
  }, [refreshHandoffQueue, refreshStats, showNotice]);

  const openEndSessionModal = useCallback(() => {
    if (!selectedJidRef.current) return;
    setConfirmEndOpen(true);
  }, []);

  const openConfirmAction = useCallback((action: PendingConfirmAction) => {
    setPendingConfirmAction(action);
  }, []);

  const openBroadcastSendModal = useCallback(() => {
    const hasText = broadcastMessage.trim().length > 0;
    const hasImage = broadcastImageDataUrl.length > 0;
    if (!hasText && !hasImage) {
      showNotice('Informe texto ou imagem para enviar o anuncio.');
      return;
    }

    if (broadcastRecipientMode === 'selected' && selectedBroadcastJids.length === 0) {
      showNotice('Selecione ao menos um destinatario.');
      return;
    }

    setPendingConfirmAction('send-broadcast');
  }, [broadcastImageDataUrl, broadcastMessage, broadcastRecipientMode, selectedBroadcastJids.length, showNotice]);

  const handleToggleBroadcastRecipient = useCallback((jid: string) => {
    setSelectedBroadcastJids(previous => {
      if (previous.includes(jid)) {
        return previous.filter(item => item !== jid);
      }
      return [...previous, jid];
    });
  }, []);

  const handleSelectAllBroadcastVisible = useCallback(() => {
    setSelectedBroadcastJids(previous => {
      const merged = new Set(previous);
      for (const contact of broadcastContacts) {
        merged.add(contact.jid);
      }
      return [...merged];
    });
  }, [broadcastContacts]);

  const handlePickBroadcastImage = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      showNotice('Selecione um arquivo de imagem valido para o anuncio.');
      return;
    }

    try {
      const dataUrl = await fileToDataUrl(file);
      setBroadcastImageDataUrl(dataUrl);
      setBroadcastImagePreviewUrl(dataUrl);
      setBroadcastImageFileName(file.name);
    } catch (error) {
      showNotice(`Nao foi possivel ler a imagem: ${String((error as Error)?.message || error)}`);
    }
  }, [showNotice]);

  const handleSendBroadcast = useCallback(async () => {
    const hasText = broadcastMessage.trim().length > 0;
    const hasImage = broadcastImageDataUrl.length > 0;
    if (!hasText && !hasImage) {
      showNotice('Informe texto ou imagem para enviar o anuncio.');
      return;
    }

    if (broadcastRecipientMode === 'selected' && selectedBroadcastJids.length === 0) {
      showNotice('Selecione ao menos um destinatario.');
      return;
    }

    const estimatedAttempted = Math.max(
      0,
      broadcastRecipientMode === 'all' ? broadcastContacts.length : selectedBroadcastJids.length
    );

    activeBroadcastCampaignIdRef.current = null;
    setBroadcastProgress({
      campaignId: 0,
      attempted: estimatedAttempted,
      processed: 0,
      sent: 0,
      failed: 0,
      remaining: estimatedAttempted,
      percent: 0,
      status: 'started',
      recipientStatus: '',
      jid: '',
    });
    setBroadcastLastResult(null);
    busyBroadcastSendRef.current = true;
    setBusyBroadcastSend(true);
    try {
      const result = await postBroadcastSend({
        target: broadcastRecipientMode,
        jids: selectedBroadcastJids,
        text: broadcastMessage,
        imageDataUrl: broadcastImageDataUrl || '',
        fileName: broadcastImageFileName || '',
      });
      activeBroadcastCampaignIdRef.current = result.campaignId || null;
      setBroadcastLastResult(result);
      setBroadcastProgress({
        campaignId: result.campaignId,
        attempted: result.attempted,
        processed: result.attempted,
        sent: result.sent,
        failed: result.failed,
        remaining: 0,
        percent: result.attempted > 0 ? 100 : 0,
        status: 'completed',
        recipientStatus: '',
        jid: '',
      });
      showNotice(`Campanha enviada: ${result.sent}/${result.attempted} entregas.`);
      if (result.failed === 0) {
        setBroadcastMessage('');
        setBroadcastImageDataUrl('');
        setBroadcastImagePreviewUrl('');
        setBroadcastImageFileName('');
      }
    } catch (error) {
      activeBroadcastCampaignIdRef.current = null;
      setBroadcastProgress(null);
      showNotice(`Falha ao enviar anuncio: ${String((error as Error)?.message || error)}`);
    } finally {
      busyBroadcastSendRef.current = false;
      setBusyBroadcastSend(false);
    }
  }, [
    broadcastContacts.length,
    broadcastImageDataUrl,
    broadcastImageFileName,
    broadcastMessage,
    broadcastRecipientMode,
    selectedBroadcastJids,
    showNotice,
  ]);

  const handleToggleAutoReload = useCallback(async (value: boolean) => {
    setBusySaveSettings(true);
    try {
      const updated = await postRuntimeSettings({ autoReloadFlows: value });
      setAutoReloadFlows(updated.autoReloadFlows !== false);
      setBroadcastSendIntervalMs(Math.max(0, Math.floor(Number(updated.broadcastSendIntervalMs ?? 250) || 250)));
      showNotice(`Auto-reload ${updated.autoReloadFlows ? 'habilitado' : 'desabilitado'} com sucesso.`);
    } catch (error) {
      showNotice(`Falha ao atualizar auto-reload: ${String((error as Error)?.message || error)}`);
    } finally {
      setBusySaveSettings(false);
    }
  }, [showNotice]);

  const handleUpdateBroadcastSendInterval = useCallback(async (value: number) => {
    const normalized = Math.max(0, Math.floor(Number(value) || 0));
    setBusySaveSettings(true);
    try {
      const updated = await postRuntimeSettings({ broadcastSendIntervalMs: normalized });
      setAutoReloadFlows(updated.autoReloadFlows !== false);
      const effective = Math.max(0, Math.floor(Number(updated.broadcastSendIntervalMs ?? normalized) || normalized));
      setBroadcastSendIntervalMs(effective);
      showNotice(`Intervalo do anuncio em massa atualizado para ${effective} ms.`);
    } catch (error) {
      showNotice(`Falha ao atualizar intervalo do anuncio em massa: ${String((error as Error)?.message || error)}`);
    } finally {
      setBusySaveSettings(false);
    }
  }, [showNotice]);

  const handleClearRuntimeCache = useCallback(async () => {
    setBusyClearRuntimeCache(true);
    try {
      await postClearRuntimeCache();
      showNotice('Cache runtime limpo com sucesso.');
    } catch (error) {
      showNotice(`Falha ao limpar cache runtime: ${String((error as Error)?.message || error)}`);
    } finally {
      setBusyClearRuntimeCache(false);
    }
  }, [showNotice]);

  const handleSelectSessionFlow = useCallback((flowPath: string) => {
    setSessionSelectedFlowPath(flowPath);
    const flow = sessionFlows.find(item => item.flowPath === flowPath);
    setSessionTimeoutInputMinutes(flow ? String(flow.sessionTimeoutMinutes) : '');
  }, [sessionFlows]);

  const handleClearAllSessions = useCallback(async () => {
    setBusySessionAction(true);
    try {
      const result = await postClearAllActiveSessions();
      showNotice(`Sessoes ativas removidas: ${result.removed}.`);
      await refreshSessionManagement();
    } catch (error) {
      showNotice(`Falha ao limpar sessoes ativas: ${String((error as Error)?.message || error)}`);
    } finally {
      setBusySessionAction(false);
    }
  }, [refreshSessionManagement, showNotice]);

  const handleClearSessionsByFlow = useCallback(async () => {
    const flowPath = sessionSelectedFlowPath.trim();
    if (!flowPath) {
      showNotice('Selecione um flow para limpar sessoes.');
      return;
    }
    setBusySessionAction(true);
    try {
      const result = await postClearFlowSessions(flowPath);
      showNotice(`Sessoes removidas do flow selecionado: ${result.removed}.`);
      await refreshSessionManagement();
    } catch (error) {
      showNotice(`Falha ao limpar sessoes do flow: ${String((error as Error)?.message || error)}`);
    } finally {
      setBusySessionAction(false);
    }
  }, [refreshSessionManagement, sessionSelectedFlowPath, showNotice]);

  const handleResetSessionByJid = useCallback(async () => {
    const jid = sessionResetJidInput.trim();
    if (!jid) {
      showNotice('Informe um JID valido.');
      return;
    }
    setBusySessionAction(true);
    try {
      const result = await postResetSessionByJid(jid);
      showNotice(`Sessoes removidas para o JID informado: ${result.removed}.`);
      setSessionResetJidInput('');
      await refreshSessionManagement();
    } catch (error) {
      showNotice(`Falha ao resetar sessao por JID: ${String((error as Error)?.message || error)}`);
    } finally {
      setBusySessionAction(false);
    }
  }, [refreshSessionManagement, sessionResetJidInput, showNotice]);

  const handleUpdateSessionTimeout = useCallback(async () => {
    const flowPath = sessionSelectedFlowPath.trim();
    if (!flowPath) {
      showNotice('Selecione um flow para atualizar timeout.');
      return;
    }
    const timeoutValue = Number(sessionTimeoutInputMinutes);
    if (!Number.isFinite(timeoutValue) || timeoutValue < 0) {
      showNotice('Informe um timeout valido (>= 0).');
      return;
    }
    setBusySessionAction(true);
    try {
      const result = await postUpdateFlowSessionTimeout(flowPath, Math.floor(timeoutValue));
      setSessionFlows(previous =>
        previous.map(flow =>
          flow.flowPath === result.flowPath
            ? { ...flow, sessionTimeoutMinutes: result.sessionTimeoutMinutes }
            : flow
        )
      );
      setSessionTimeoutInputMinutes(String(result.sessionTimeoutMinutes));
      showNotice(`Timeout atualizado para ${result.sessionTimeoutMinutes} min em ${result.flowPath}.`);
      await refreshSessionManagement();
    } catch (error) {
      showNotice(`Falha ao atualizar timeout do flow: ${String((error as Error)?.message || error)}`);
    } finally {
      setBusySessionAction(false);
    }
  }, [refreshSessionManagement, sessionSelectedFlowPath, sessionTimeoutInputMinutes, showNotice]);

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
        description: 'Esta acao remove o cache em memoria de sessoes/blocos para diagnostico.',
        confirmLabel: confirmActionBusy ? 'Limpando...' : 'Limpar cache',
        variant: 'danger' as const,
      };
    }

    if (pendingConfirmAction === 'clear-all-sessions') {
      return {
        title: 'Limpar todas as sessoes ativas',
        description: 'Deseja remover todas as sessoes ativas agora? Esta acao nao pode ser desfeita.',
        confirmLabel: confirmActionBusy ? 'Limpando...' : 'Limpar todas',
        variant: 'danger' as const,
      };
    }

    if (pendingConfirmAction === 'clear-flow-sessions') {
      const flowPath = sessionSelectedFlowPath.trim();
      return {
        title: 'Limpar sessoes do flow',
        description: flowPath
          ? `Deseja remover as sessoes ativas do flow ${flowPath}?`
          : 'Deseja remover as sessoes ativas do flow selecionado?',
        confirmLabel: confirmActionBusy ? 'Limpando...' : 'Limpar flow',
        variant: 'danger' as const,
      };
    }

    if (pendingConfirmAction === 'reset-session-by-jid') {
      const jid = sessionResetJidInput.trim();
      return {
        title: 'Resetar sessao por JID',
        description: jid
          ? `Deseja resetar as sessoes associadas ao JID ${jid}?`
          : 'Deseja resetar as sessoes associadas ao JID informado?',
        confirmLabel: confirmActionBusy ? 'Resetando...' : 'Resetar JID',
        variant: 'danger' as const,
      };
    }

    const recipients = broadcastRecipientMode === 'all' ? broadcastContacts.length : selectedBroadcastJids.length;
    return {
      title: 'Enviar anuncio em massa',
      description: `Confirma envio para ${recipients} destinatario(s)?`,
      confirmLabel: confirmActionBusy ? 'Enviando...' : 'Enviar anuncio',
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

    await handleSendBroadcast();
    setPendingConfirmAction(null);
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
          {renderedView === 'analytics' && (
            <AnalyticsView
              mode={mode}
              stats={stats}
              logs={logs}
              onExport={() => window.open('/api/export?format=csv', '_blank')}
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
                  showNotice(`Falha ao atualizar informacoes do DB: ${String((error as Error)?.message || error)}`);
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
        title={confirmActionConfig?.title || 'Confirmar acao'}
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
