import { useEffect, useMemo, useRef } from 'react';
import { fmtTime, formatJidPhone } from '../../lib/format';
import type { EventLog, HandoffBlock, HandoffSession } from '../../types';

interface HandoffViewProps {
  sessions: HandoffSession[];
  blocks: HandoffBlock[];
  selectedJid: string;
  history: EventLog[];
  messageText: string;
  selectedBlockId: string;
  busySend: boolean;
  busySendImage: boolean;
  busyResume: boolean;
  busyEnd: boolean;
  onMessageChange: (value: string) => void;
  onSelectBlock: (value: string) => void;
  onSelectSession: (jid: string) => void;
  onRefreshSessions: () => void;
  onSend: () => Promise<void> | void;
  onSendImage: (file: File) => Promise<void> | void;
  onResume: () => void;
  onEnd: () => void;
}

function getSessionBadge(session: HandoffSession): string {
  const eventType = String(session.lastMessage?.eventType || '').toLowerCase();
  if (eventType === 'human-message-outgoing' || eventType === 'human-image-outgoing') {
    return 'Respondido';
  }
  return 'Aguardando';
}

function getTimelineLabel(event: EventLog): string {
  const eventType = String(event.eventType || '').toLowerCase();
  const direction = String(event.direction || '').toLowerCase();
  if (direction === 'incoming' || eventType === 'message-incoming') return 'Usuario';
  if (direction === 'outgoing' || eventType === 'human-message-outgoing' || eventType === 'message-outgoing') {
    return 'Atendente/Bot';
  }
  return 'Sistema';
}

function readMetadataValue(event: EventLog, key: string): unknown {
  const metadata = event.metadata;
  if (!metadata || typeof metadata !== 'object') return undefined;
  return (metadata as Record<string, unknown>)[key];
}

function readMetadataText(event: EventLog, key: string): string {
  const value = readMetadataValue(event, key);
  return typeof value === 'string' ? value.trim() : '';
}

function getTimelineItemKey(event: EventLog, index: number): string {
  if (Number.isFinite(event.id)) return `event-${event.id}`;

  const messageId = readMetadataText(event, 'id');
  if (messageId) {
    return `message-${messageId}-${event.eventType || 'event'}-${event.jid || 'unknown'}`;
  }

  return [
    'fallback',
    event.occurredAt || 0,
    event.eventType || '',
    event.direction || '',
    event.jid || '',
    index,
  ].join('-');
}

export function HandoffView({
  sessions,
  blocks,
  selectedJid,
  history,
  messageText,
  selectedBlockId,
  busySend,
  busySendImage,
  busyResume,
  busyEnd,
  onMessageChange,
  onSelectBlock,
  onSelectSession,
  onRefreshSessions,
  onSend,
  onSendImage,
  onResume,
  onEnd,
}: HandoffViewProps) {
  const messageInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const sortedTimeline = useMemo(
    () => [...history].sort((a, b) => (a.occurredAt || 0) - (b.occurredAt || 0)),
    [history]
  );

  useEffect(() => {
    if (!selectedJid) return;
    if (busySend || busySendImage) return;
    window.requestAnimationFrame(() => {
      messageInputRef.current?.focus();
    });
  }, [selectedJid, busySend, busySendImage]);

  return (
    <section className="handoff-grid">
      <article className="panel">
        <header className="panel-header panel-header-space">
          <h3>Sessoes em Espera</h3>
          <button type="button" className="ghost-btn" onClick={onRefreshSessions}>Atualizar</button>
        </header>
        <div className="handoff-session-list">
          {sessions.length === 0 ? (
            <p className="empty-hint">Nenhuma sessao aguardando atendimento.</p>
          ) : (
            sessions.map(session => {
              const isActive = selectedJid === session.jid;
              const snippet = session.lastMessage?.text || 'Sem mensagem recente';
              const badge = getSessionBadge(session);
              return (
                <button
                  type="button"
                  key={session.jid}
                  className={`handoff-session-item ${isActive ? 'is-active' : ''}`}
                  onClick={() => onSelectSession(session.jid)}
                >
                  <div className="handoff-session-top">
                    <strong>{formatJidPhone(session.jid)}</strong>
                    <span className={`queue-tag ${badge === 'Respondido' ? 'is-answered' : ''}`}>{badge}</span>
                  </div>
                  <small>Fila: {session.queue || 'default'} · {session.lastActivityAt ? fmtTime(session.lastActivityAt) : '--:--'}</small>
                  <p>{snippet}</p>
                </button>
              );
            })
          )}
        </div>
      </article>

      <article className="panel panel-handoff-chat">
        <header className="panel-header panel-header-space">
          <div>
            <h3>Chat em Tempo Real</h3>
            <small>
              {selectedJid ? `Sessao ativa: ${formatJidPhone(selectedJid)}` : 'Selecione uma sessao na lista'}
            </small>
          </div>
          <button type="button" className="danger-btn" onClick={onEnd} disabled={!selectedJid || busyEnd}>
            {busyEnd ? 'Encerrando...' : 'Encerrar sessao'}
          </button>
        </header>

        <div className="handoff-history">
          {!selectedJid ? (
            <p className="empty-hint">Selecione uma sessao para ver as mensagens.</p>
          ) : sortedTimeline.length === 0 ? (
            <p className="empty-hint">Sem historico para esta sessao.</p>
          ) : (
            sortedTimeline.map((event, index) => (
              <div className="handoff-line" key={getTimelineItemKey(event, index)}>
                <div className="handoff-line-header">
                  <span>{getTimelineLabel(event)}</span>
                  <time>{event.occurredAt ? fmtTime(event.occurredAt) : '--:--'}</time>
                </div>
                <p>{event.messageText || `[${event.eventType || 'evento'}]`}</p>
                {(() => {
                  const mediaUrl = readMetadataText(event, 'mediaUrl');
                  if (!mediaUrl) return null;
                  const mediaType = readMetadataText(event, 'mediaType').toLowerCase();
                  if (!mediaType.startsWith('image/')) return null;

                  return (
                    <img
                      className="handoff-line-image"
                      src={mediaUrl}
                      alt={event.messageText || 'Imagem da conversa'}
                      loading="lazy"
                    />
                  );
                })()}
              </div>
            ))
          )}
        </div>

        <div className="handoff-actions">
          <div className="handoff-send">
            <input
              ref={messageInputRef}
              type="text"
              value={messageText}
              onChange={event => onMessageChange(event.target.value)}
              placeholder="Digite a mensagem do atendente..."
              disabled={!selectedJid}
              onKeyDown={async event => {
                if (busySend || !selectedJid) return;
                if (event.key === 'Enter') {
                  event.preventDefault();
                  await onSend();
                  window.requestAnimationFrame(() => {
                    messageInputRef.current?.focus();
                  });
                }
              }}
            />
            <button
              type="button"
              className="primary-btn"
              onClick={async () => {
                await onSend();
                window.requestAnimationFrame(() => {
                  messageInputRef.current?.focus();
                });
              }}
              disabled={!selectedJid || busySend}
            >
              {busySend ? 'Enviando...' : 'Enviar'}
            </button>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              className="handoff-file-input"
              onChange={async event => {
                const file = event.target.files?.[0];
                if (!file) return;
                await onSendImage(file);
                event.target.value = '';
                window.requestAnimationFrame(() => {
                  messageInputRef.current?.focus();
                });
              }}
            />
            <button
              type="button"
              className="ghost-btn"
              onClick={() => imageInputRef.current?.click()}
              disabled={!selectedJid || busySendImage}
            >
              {busySendImage ? 'Enviando imagem...' : 'Enviar imagem'}
            </button>
          </div>
          <div className="handoff-resume">
            <select
              value={selectedBlockId}
              onChange={event => onSelectBlock(event.target.value)}
              disabled={!selectedJid || busyResume}
            >
              <option value="">Selecione bloco para retomar</option>
              {blocks.map(block => (
                <option key={block.id} value={block.id}>
                  #{block.index} · {block.name || block.id} ({block.type})
                </option>
              ))}
            </select>
            <button type="button" className="success-btn" onClick={onResume} disabled={!selectedJid || busyResume}>
              {busyResume ? 'Retomando...' : 'Retomar'}
            </button>
          </div>
        </div>
      </article>
    </section>
  );
}
