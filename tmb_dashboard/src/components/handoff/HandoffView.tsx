import { useEffect, useMemo, useRef } from 'react';
import { fmtTime, formatJidPhone } from '../../lib/format';
import { buttonBaseClass, iconButtonClass, inputBaseClass, panelClass, timelineItemClass } from '../../lib/uiTokens';
import type { EventLog, HandoffBlock, HandoffSession } from '../../types';
import { Select2Field } from '../form/Select2Field';
import { EmptyStateMascot } from '../feedback/EmptyStateMascot';

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

const minimalBtn = buttonBaseClass;

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
  const selectedSession = useMemo(
    () => sessions.find(session => session.jid === selectedJid) || null,
    [sessions, selectedJid]
  );
  const timelineEmptyState = !selectedJid || sortedTimeline.length === 0;

  useEffect(() => {
    if (!selectedJid) return;
    if (busySend || busySendImage) return;
    window.requestAnimationFrame(() => {
      messageInputRef.current?.focus();
    });
  }, [selectedJid, busySend, busySendImage]);

  return (
    <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(260px,320px)_1fr]">
      <article className={`${panelClass} min-w-0`}>
        <header className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-base font-extrabold">Sessoes em Espera</h3>
          <button
            type="button"
            className={`${minimalBtn} ${iconButtonClass} border-[#d4e0f1] bg-white/80 text-slate-700 hover:bg-[#f8fafc]`}
            onClick={onRefreshSessions}
            aria-label="Atualizar sessoes"
            title="Atualizar sessoes"
          >
            <i className="fa-solid fa-arrows-rotate" aria-hidden="true" />
          </button>
        </header>
        <div className="flex max-h-[560px] flex-col gap-2 overflow-auto">
          {sessions.length === 0 ? (
            <EmptyStateMascot
              compact
              title="Nenhuma sessao aguardando atendimento."
              description="Quando um usuario pedir atendimento humano, ele aparecera aqui."
            />
          ) : (
            sessions.map(session => {
              const isActive = selectedJid === session.jid;
              const snippet = session.lastMessage?.text || 'Sem mensagem recente';
              const badge = getSessionBadge(session);
              const sessionLabel = String(session.displayName || '').trim() || formatJidPhone(session.jid);
              return (
                <button
                  type="button"
                  key={session.jid}
                  className={[
                    'rounded-xl border bg-white p-3 text-left transition',
                    isActive
                      ? 'border-[#7ca4db] bg-[#eff6ff]'
                      : 'border-[#dce6f3] hover:border-[#9fb7d8]',
                  ].join(' ')}
                  onClick={() => onSelectSession(session.jid)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <strong>{sessionLabel}</strong>
                    <span
                      className={[
                        'rounded-full px-2 py-0.5 text-[0.66rem] font-bold',
                        badge === 'Respondido'
                          ? 'bg-[#dcfce7] text-[#166534]'
                          : 'bg-[#fef3c7] text-[#92400e]',
                      ].join(' ')}
                    >
                      {badge}
                    </span>
                  </div>
                  <small className="mt-1 block text-xs text-slate-500">
                    Fila: {session.queue || 'default'} · {session.lastActivityAt ? fmtTime(session.lastActivityAt) : '--:--'}
                  </small>
                  <p className="mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm text-slate-700">{snippet}</p>
                </button>
              );
            })
          )}
        </div>
      </article>

      <article className={`${panelClass} min-h-[620px] min-w-0`}>
        <header className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-extrabold">Chat em Tempo Real</h3>
            <small className="mt-1 block text-xs text-slate-500">
              {selectedJid
                ? `Sessao ativa: ${String(selectedSession?.displayName || '').trim() || formatJidPhone(selectedJid)}`
                : 'Selecione uma sessao na lista'}
            </small>
          </div>
          <button
            type="button"
            className={`${minimalBtn} border-[#f2c4ca] bg-[#fff5f5] text-[#b4232c] hover:bg-[#ffe4e6]`}
            onClick={onEnd}
            disabled={!selectedJid || busyEnd}
          >
            <i className="fa-regular fa-circle-xmark" aria-hidden="true" /> {busyEnd ? 'Encerrando...' : 'Encerrar sessao'}
          </button>
        </header>

        <div
          className={[
            'h-[380px] overflow-auto overflow-x-hidden rounded-xl p-3',
            timelineEmptyState ? 'border border-[#dce6f3] bg-transparent' : 'border border-[#dce6f3] bg-[#eef3fb]',
          ].join(' ')}
        >
          {!selectedJid ? (
            <EmptyStateMascot
              compact
              title="Selecione uma sessao para ver as mensagens."
              description="Escolha um contato na lista para abrir o atendimento em tempo real."
            />
          ) : sortedTimeline.length === 0 ? (
            <EmptyStateMascot
              compact
              title="Sem historico para esta sessao."
              description="As novas interacoes desta conversa aparecerao aqui."
            />
          ) : (
            sortedTimeline.map((event, index) => (
              <div key={getTimelineItemKey(event, index)} className={`mb-2 ${timelineItemClass} last:mb-0`}>
                <div className="mb-1 flex items-center justify-between text-[0.72rem] font-bold text-[#59687b]">
                  <span>{getTimelineLabel(event)}</span>
                  <time>{event.occurredAt ? fmtTime(event.occurredAt) : '--:--'}</time>
                </div>
                <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[0.86rem] leading-[1.45]">
                  {event.messageText || `[${event.eventType || 'evento'}]`}
                </p>
                {(() => {
                  const mediaUrl = readMetadataText(event, 'mediaUrl');
                  if (!mediaUrl) return null;
                  const mediaType = readMetadataText(event, 'mediaType').toLowerCase();
                  if (!mediaType.startsWith('image/')) return null;

                  return (
                    <img
                      className="mt-2 max-h-[280px] max-w-full rounded-xl border border-[#d7e3f2] object-cover"
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

        <div className="mt-3 grid gap-2.5">
          <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
            <input
              ref={messageInputRef}
              type="text"
              value={messageText}
              onChange={event => onMessageChange(event.target.value)}
              placeholder="Digite a mensagem do atendente..."
              disabled={!selectedJid}
              className={inputBaseClass}
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
              className={`${minimalBtn} ${iconButtonClass} border-[#174d9d] bg-[#1e63c9] text-white hover:bg-[#174d9d]`}
              onClick={async () => {
                await onSend();
                window.requestAnimationFrame(() => {
                  messageInputRef.current?.focus();
                });
              }}
              disabled={!selectedJid || busySend}
              aria-label={busySend ? 'Enviando mensagem' : 'Enviar mensagem'}
              title={busySend ? 'Enviando mensagem' : 'Enviar mensagem'}
            >
              <i className={busySend ? 'fa-solid fa-spinner fa-spin' : 'fa-regular fa-paper-plane'} aria-hidden="true" />
            </button>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
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
              className={`${minimalBtn} ${iconButtonClass} border-[#d4e0f1] bg-white/80 text-slate-700 hover:bg-slate-50`}
              onClick={() => imageInputRef.current?.click()}
              disabled={!selectedJid || busySendImage}
              aria-label={busySendImage ? 'Enviando imagem' : 'Enviar imagem'}
              title={busySendImage ? 'Enviando imagem' : 'Enviar imagem'}
            >
              <i className={busySendImage ? 'fa-solid fa-spinner fa-spin' : 'fa-regular fa-image'} aria-hidden="true" />
            </button>
          </div>
          <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Select2Field
              value={selectedBlockId}
              onChange={onSelectBlock}
              disabled={!selectedJid || busyResume}
              placeholder="Selecione bloco para retomar"
              options={blocks.map(block => ({
                value: block.id,
                label: `#${block.index} · ${block.name || block.id} (${block.type})`,
              }))}
            />
            <button
              type="button"
              className={`${minimalBtn} border-[#0e6059] bg-[#0f766e] text-white hover:bg-[#0e6059]`}
              onClick={onResume}
              disabled={!selectedJid || busyResume}
            >
              <i className="fa-solid fa-play" aria-hidden="true" /> {busyResume ? 'Retomando...' : 'Retomar'}
            </button>
          </div>
        </div>
      </article>
    </section>
  );
}
