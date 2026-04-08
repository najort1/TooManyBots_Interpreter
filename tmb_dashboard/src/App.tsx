import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchHandoffBlocks,
  fetchHandoffHistory,
  fetchHandoffSessions,
  fetchHealth,
  fetchLogs,
  fetchStats,
  postHandoffEnd,
  postHandoffImage,
  postHandoffMessage,
  postHandoffResume,
  postReloadFlow,
} from './lib/api';
import { isLikelyErrorMessage } from './lib/format';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { AnalyticsView } from './components/analytics/AnalyticsView';
import { HandoffView } from './components/handoff/HandoffView';
import { Modal } from './components/Modal';
import { ToastCenter } from './components/feedback/ToastCenter';
import type { ToastItem, ToastTone } from './components/feedback/ToastCenter';
import type {
  DashboardMode,
  DashboardStats,
  DashboardView,
  EventLog,
  HandoffBlock,
  HandoffSession,
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

function App() {
  const [view, setView] = useState<DashboardView>('analytics');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mode, setMode] = useState<DashboardMode>('CONVERSATION');
  const [botName, setBotName] = useState('...');
  const [flowPath, setFlowPath] = useState('');
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

  const modeQuery = useMemo(() => modeToQuery(mode), [mode]);

  const flowPathRef = useRef(flowPath);
  const logsRef = useRef(logs);
  const selectedJidRef = useRef(selectedHandoffJid);
  const handoffSessionsRef = useRef(handoffSessions);
  const refreshTimeoutRef = useRef<number | null>(null);
  const toastTimersRef = useRef<Map<string, number>>(new Map());
  const lastCustomerToastByJidRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    flowPathRef.current = flowPath;
  }, [flowPath]);

  useEffect(() => {
    logsRef.current = logs;
  }, [logs]);

  useEffect(() => {
    selectedJidRef.current = selectedHandoffJid;
  }, [selectedHandoffJid]);

  useEffect(() => {
    handoffSessionsRef.current = handoffSessions;
  }, [handoffSessions]);

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
    setMode(toDashboardMode(health.mode));
    setBotName(health.flowFile || 'Desconhecido');
    setFlowPath(String(health.flowPath || ''));
    setUptimeMs(Number(health.uptimeMs || 0));
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
        const blocks = await fetchHandoffBlocks();
        if (!cancelled) setHandoffBlocks(blocks);
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
  }, [loadHealth, refreshHandoffQueue, refreshStats, showNotice]);

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
          if (flowPathRef.current && payload.flowPath && payload.flowPath !== flowPathRef.current) {
            return;
          }

          setLogs(previous => trimLogs(sortHistory([...previous, payload])));

          if (selectedJidRef.current && payload.jid === selectedJidRef.current) {
            setSelectedHandoffHistory(previous => trimLogs(sortHistory([...previous, payload]), 300));
          }

          const eventType = String(payload.eventType || '');
          const chatJidFromMetadata = readMetadataText(payload, 'chatJid');
          const sessionJid = String(chatJidFromMetadata || payload.jid || '').trim();
          const outgoingErrorByText =
            eventType === 'message-outgoing' && isLikelyErrorMessage(String(payload.messageText || ''));
          const shouldRefresh =
            WS_REFRESH_EVENT_TYPES.has(eventType) || outgoingErrorByText || eventType.includes('human-handoff');

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
  }, [pushToast, refreshHandoffQueue, scheduleSoftRefresh]);

  const handleReload = useCallback(async () => {
    try {
      await postReloadFlow();
      showNotice('Flow recarregado com sucesso.');
      await Promise.all([loadHealth(), refreshStats(), refreshHandoffQueue()]);
    } catch (error) {
      showNotice(`Falha ao recarregar flow: ${String((error as Error)?.message || error)}`);
    }
  }, [loadHealth, refreshHandoffQueue, refreshStats, showNotice]);

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

  return (
    <div className="app-shell">
      <Sidebar
        currentView={view}
        onNavigate={setView}
        mobileOpen={sidebarOpen}
        onCloseMobile={() => setSidebarOpen(false)}
      />
      <div className="app-main">
        <TopBar
          mode={mode}
          botName={botName}
          uptimeMs={uptimeMs}
          onReload={handleReload}
          onOpenSettings={() => setView('settings')}
          onOpenSidebar={() => setSidebarOpen(true)}
        />

        <ToastCenter items={toasts} onDismiss={dismissToast} />

        <main className="app-content">
          {view === 'analytics' && (
            <AnalyticsView
              mode={mode}
              stats={stats}
              logs={logs}
              onExport={() => window.open('/api/export?format=csv', '_blank')}
            />
          )}

          {view === 'handoff' && (
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

          {view === 'settings' && (
            <section className="view-section">
              <article className="panel">
                <header className="panel-header">
                  <h3>Configurações</h3>
                </header>
                <p className="settings-placeholder">
                  Esta área está pronta para receber controles avançados de runtime, alertas e preferências da equipe.
                </p>
              </article>
            </section>
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
    </div>
  );
}

export default App;

