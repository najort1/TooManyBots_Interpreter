import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtTime, formatJidPhone } from '../../lib/format';
import { buttonBaseClass, iconButtonClass, inputBaseClass, panelClass, timelineItemClass } from '../../lib/uiTokens';
import type { BroadcastContact, BroadcastSendProgress, BroadcastSendResult } from '../../types';
import { EmptyStateMascot } from '../feedback/EmptyStateMascot';

interface BroadcastViewProps {
  contacts: BroadcastContact[];
  loadingContacts: boolean;
  recipientMode: 'all' | 'selected';
  selectedJids: string[];
  search: string;
  messageText: string;
  imageFileName: string;
  imagePreviewUrl: string;
  busySend: boolean;
  lastResult: BroadcastSendResult | null;
  sendProgress: BroadcastSendProgress | null;
  broadcastSendIntervalMs: number;
  onRecipientModeChange: (value: 'all' | 'selected') => void;
  onSearchChange: (value: string) => void;
  onRefreshContacts: () => void;
  onToggleRecipient: (jid: string) => void;
  onSelectAllVisible: () => void;
  onClearSelection: () => void;
  onMessageChange: (value: string) => void;
  onPickImage: (file: File) => void;
  onClearImage: () => void;
  onSend: () => void;
}

const buttonBase = buttonBaseClass;

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function cubicPoint(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const omt = 1 - t;
  return omt * omt * omt * p0 + 3 * omt * omt * t * p1 + 3 * omt * t * t * p2 + t * t * t * p3;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function easeInOutCubic(value: number): number {
  const t = clamp01(value);
  if (t < 0.5) return 4 * t * t * t;
  return 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function BroadcastView({
  contacts,
  loadingContacts,
  recipientMode,
  selectedJids,
  search,
  messageText,
  imageFileName,
  imagePreviewUrl,
  busySend,
  lastResult,
  sendProgress,
  broadcastSendIntervalMs,
  onRecipientModeChange,
  onSearchChange,
  onRefreshContacts,
  onToggleRecipient,
  onSelectAllVisible,
  onClearSelection,
  onMessageChange,
  onPickImage,
  onClearImage,
  onSend,
}: BroadcastViewProps) {
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const selected = useMemo(() => new Set(selectedJids), [selectedJids]);
  const recipientsCount = recipientMode === 'all' ? contacts.length : selectedJids.length;
  const progressAttempted = Math.max(0, Number(sendProgress?.attempted || recipientsCount));
  const progressSent = Math.max(0, Number(sendProgress?.sent || 0));
  const progressRemaining = Math.max(
    0,
    Number(sendProgress?.remaining ?? Math.max(0, progressAttempted - progressSent))
  );
  const progressFailed = Math.max(0, Number(sendProgress?.failed || 0));
  const progressPercent = Math.max(0, Math.min(100, Number(sendProgress?.percent || 0)));
  const progressStatus = sendProgress?.status || 'idle';
  const progressSending = busySend || progressStatus === 'sending' || progressStatus === 'started';
  const progressCompleted = progressStatus === 'completed' && progressAttempted > 0;
  const currentCampaignId = Math.max(0, Number(sendProgress?.campaignId || 0));
  const progressTargetRatio = clamp01(progressPercent / 100);
  const progressRafRef = useRef<number | null>(null);
  const progressTargetRef = useRef(0);
  const progressSendingRef = useRef(progressSending);
  const [visualProgressRatio, setVisualProgressRatio] = useState(0);
  const visualProgressRatioRef = useRef(0);
  const returnRafRef = useRef<number | null>(null);
  const [returnProgressRatio, setReturnProgressRatio] = useState(0);
  const [returningCampaignId, setReturningCampaignId] = useState<number | null>(null);
  const [returnedCampaignId, setReturnedCampaignId] = useState<number | null>(null);
  const showReturnFlight = returningCampaignId != null && returningCampaignId > 0 && returningCampaignId === currentCampaignId;
  const hasReturnedForCurrentCampaign =
    progressCompleted && currentCampaignId > 0 && returnedCampaignId === currentCampaignId;
  const outboundSettling = progressCompleted && visualProgressRatio < 0.995;
  const showOutboundPlane = progressSending || outboundSettling;
  const showParkedPlane =
    !showOutboundPlane &&
    !showReturnFlight &&
    (!progressCompleted || currentCampaignId <= 0 || hasReturnedForCurrentCampaign);
  const contactsEmpty = !loadingContacts && contacts.length === 0;

  const runwayStartX = 9;
  const runwayStartY = 83;
  const skyTargetX = 87;
  const skyTargetY = 18;
  const orbCenterX = 84;
  const orbCenterY = 17;
  const orbRadius = 16;

  const outboundX = runwayStartX + (skyTargetX - runwayStartX) * visualProgressRatio;
  const outboundY = runwayStartY + (skyTargetY - runwayStartY) * visualProgressRatio;
  const outboundRotate = -2 - visualProgressRatio * 25;
  const outboundScale = 1 - visualProgressRatio * 0.26;
  const outboundTrailOpacity = showOutboundPlane
    ? Math.max(0.18, Math.min(0.68, visualProgressRatio * 0.9))
    : 0;

  // Return flight: 3 phases — orbit around orb, then descend to runway
  const returnT = clamp01(returnProgressRatio);
  const orbitPhaseEnd = 0.55;
  const descentPhaseStart = 0.50;

  let returnX: number;
  let returnY: number;
  let returnRotate: number;
  let returnScale: number;
  let returnTrailOpacity: number;

  if (returnT <= orbitPhaseEnd) {
    // Phase 1: Full orbit around the orb (moon/sun)
    const orbitT = clamp01(returnT / orbitPhaseEnd);
    const easedOrbitT = easeInOutCubic(orbitT);
    // Start from the arrival point (skyTargetX, skyTargetY) and orbit 360° around the orb
    const startAngle = Math.atan2(skyTargetY - orbCenterY, skyTargetX - orbCenterX);
    const angle = startAngle + easedOrbitT * Math.PI * 2;
    // Radius shrinks slightly at the far side for perspective depth
    const dynamicRadius = orbRadius * (1 - 0.12 * Math.sin(easedOrbitT * Math.PI));
    returnX = orbCenterX + Math.cos(angle) * dynamicRadius * 1.15;
    returnY = orbCenterY + Math.sin(angle) * dynamicRadius * 0.85;
    // Point the plane tangent to the orbit
    const tangentAngle = angle + Math.PI / 2;
    returnRotate = (tangentAngle * 180) / Math.PI;
    returnScale = 0.62 + 0.12 * Math.sin(easedOrbitT * Math.PI);
    returnTrailOpacity = 0.5 + 0.2 * Math.sin(easedOrbitT * Math.PI);
  } else {
    // Phase 2: Smooth curve descent from near orb orbit-end back to runway
    const descentT = clamp01((returnT - descentPhaseStart) / (1 - descentPhaseStart));
    const easedDescentT = easeInOutCubic(descentT);
    // Start position at end of orbit (same as skyTarget)
    const descentStartX = skyTargetX;
    const descentStartY = skyTargetY;
    // Cubic Bézier descent to runway with a wide arc
    returnX = cubicPoint(descentStartX, 72, 38, runwayStartX, easedDescentT);
    returnY = cubicPoint(descentStartY, 10, 52, runwayStartY, easedDescentT);
    // Smooth rotation from flight angle to level landing
    returnRotate = lerp(-20, 2, easedDescentT) + Math.sin(easedDescentT * Math.PI) * 6;
    returnScale = 0.68 + easedDescentT * 0.32;
    returnTrailOpacity = 0.55 - easedDescentT * 0.35;
  }

  const renderPlaneSprite = () => (
    <svg
      className="broadcast-flight-plane-sprite"
      viewBox="0 0 64 36"
      role="presentation"
      focusable="false"
    >
      {/* Main body — crisp triangular fuselage */}
      <path d="M2 19L58 4L42 32L30 22L2 19Z" fill="#fdfefe" />
      {/* Shaded wing underside */}
      <path d="M58 4L42 32L38 18L58 4Z" fill="#deebf8" />
      {/* Tail fold shadow */}
      <path d="M30 22L22 25L2 19L30 22Z" fill="#d0e0f2" />
      {/* Center fold crease */}
      <path d="M58 4L30 22" stroke="#8da6c3" strokeWidth="1.2" strokeLinecap="round" />
      {/* Outline */}
      <path d="M2 19L58 4L42 32L30 22L2 19Z" fill="none" stroke="#6a86a6" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );

  useEffect(() => {
    progressSendingRef.current = progressSending;
  }, [progressSending]);

  useEffect(() => {
    progressTargetRef.current = progressTargetRatio;
    if (progressRafRef.current != null) return;

    const tick = () => {
      const current = visualProgressRatioRef.current;
      const target = progressTargetRef.current;
      const diff = target - current;
      let next = current;

      if (Math.abs(diff) < 0.0015) {
        next = target;
      } else {
        next = clamp01(current + diff * 0.1 + Math.sign(diff) * 0.0015);
      }

      if (Math.abs(next - visualProgressRatioRef.current) > 0.0004) {
        visualProgressRatioRef.current = next;
        setVisualProgressRatio(next);
      }

      if (progressSendingRef.current || Math.abs(target - next) > 0.0015) {
        progressRafRef.current = window.requestAnimationFrame(tick);
      } else {
        progressRafRef.current = null;
      }
    };

    progressRafRef.current = window.requestAnimationFrame(tick);
  }, [progressTargetRatio]);

  useEffect(() => {
    if (showOutboundPlane) {
      if (returnRafRef.current) {
        window.cancelAnimationFrame(returnRafRef.current);
        returnRafRef.current = null;
      }
      setReturningCampaignId(null);
      setReturnProgressRatio(0);
      return;
    }

    if (!progressCompleted || currentCampaignId <= 0) return;
    if (visualProgressRatio < 0.995) return;
    if (returnedCampaignId === currentCampaignId) return;
    if (returningCampaignId === currentCampaignId) return;

    setReturningCampaignId(currentCampaignId);
    setReturnProgressRatio(0);
    const startedAt = performance.now();
    const durationMs = 3600;
    const animateReturn = (now: number) => {
      const raw = clamp01((now - startedAt) / durationMs);
      const eased = easeInOutCubic(raw);
      setReturnProgressRatio(eased);
      if (raw < 1) {
        returnRafRef.current = window.requestAnimationFrame(animateReturn);
        return;
      }
      returnRafRef.current = null;
      setReturningCampaignId(null);
      setReturnedCampaignId(currentCampaignId);
      setReturnProgressRatio(0);
    };
    returnRafRef.current = window.requestAnimationFrame(animateReturn);
  }, [
    currentCampaignId,
    progressCompleted,
    returnedCampaignId,
    returningCampaignId,
    showOutboundPlane,
    visualProgressRatio,
  ]);

  useEffect(() => () => {
    if (progressRafRef.current) {
      window.cancelAnimationFrame(progressRafRef.current);
      progressRafRef.current = null;
    }
    if (returnRafRef.current) {
      window.cancelAnimationFrame(returnRafRef.current);
      returnRafRef.current = null;
    }
  }, []);

  return (
    <section className="mx-auto grid max-w-[1560px] grid-cols-1 gap-4 xl:grid-cols-[minmax(320px,460px)_1fr]">
      <article className={`${panelClass} min-w-0`}>
        <header className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-base font-extrabold">Destinatários</h3>
          <button
            type="button"
            className={`${buttonBase} ${iconButtonClass} border-[#d4e0f1] bg-white/80 text-slate-700 hover:bg-slate-50`}
            onClick={onRefreshContacts}
            aria-label="Atualizar contatos"
            title="Atualizar contatos"
          >
            <i className="fa-solid fa-arrows-rotate" aria-hidden="true" />
          </button>
        </header>

        <div className="mb-3 grid grid-cols-2 gap-2 rounded-xl border border-[#dce6f3] bg-[#f5f9ff] p-2">
          <button
            type="button"
            className={[
              'h-9 rounded-xl px-3 text-sm font-semibold transition',
              recipientMode === 'all' ? 'bg-[#1e63c9] text-white' : 'bg-white text-slate-700 hover:bg-slate-50',
            ].join(' ')}
            onClick={() => onRecipientModeChange('all')}
          >
            Todos ({contacts.length})
          </button>
          <button
            type="button"
            className={[
              'h-9 rounded-xl px-3 text-sm font-semibold transition',
              recipientMode === 'selected' ? 'bg-[#1e63c9] text-white' : 'bg-white text-slate-700 hover:bg-slate-50',
            ].join(' ')}
            onClick={() => onRecipientModeChange('selected')}
          >
            Selecionados ({selectedJids.length})
          </button>
        </div>

        <label className="mb-2 block text-xs font-bold uppercase tracking-[0.06em] text-slate-500" htmlFor="broadcast-search">
          Buscar contato
        </label>
        <input
          id="broadcast-search"
          type="text"
          value={search}
          onChange={event => onSearchChange(event.target.value)}
          placeholder="Filtrar por nome ou JID"
          className={`mb-3 w-full ${inputBaseClass}`}
        />

        <div className="mb-2 flex items-center gap-2">
          <button
            type="button"
            className={`${buttonBase} border-[#d4e0f1] bg-white/80 text-slate-700 hover:bg-slate-50`}
            onClick={onSelectAllVisible}
            disabled={contacts.length === 0}
          >
            <i className="fa-solid fa-list-check" aria-hidden="true" />
            Selecionar lista
          </button>
          <button
            type="button"
            className={`${buttonBase} border-[#f2c4ca] bg-[#fff5f5] text-[#b4232c] hover:bg-[#ffe4e6]`}
            onClick={onClearSelection}
            disabled={selectedJids.length === 0}
          >
            <i className="fa-solid fa-eraser" aria-hidden="true" />
            Limpar
          </button>
        </div>

        <div
          className={[
            'max-h-[520px] overflow-auto rounded-xl p-3',
            contactsEmpty ? 'border border-[#dce6f3] bg-transparent' : 'border border-[#dce6f3] bg-[#eef3fb]',
          ].join(' ')}
        >
          {loadingContacts ? (
            <p className="py-4 text-center text-sm text-slate-500">Carregando contatos...</p>
          ) : contacts.length === 0 ? (
            <EmptyStateMascot
              compact
              title="Nenhum contato encontrado."
              description="Sincronize ou ajuste o filtro para exibir destinatários nesta lista."
            />
          ) : (
            contacts.map(contact => (
              <label
                key={contact.jid}
                className={`mb-2 flex cursor-pointer items-start gap-2 ${timelineItemClass} last:mb-0`}
              >
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-[#1e63c9]"
                  checked={selected.has(contact.jid)}
                  onChange={() => onToggleRecipient(contact.jid)}
                />
                <span className="min-w-0 flex-1">
                  <strong className="block text-[0.85rem]">
                    {String(contact.name || '').trim() || formatJidPhone(contact.jid)}
                  </strong>
                  <small className="block text-[0.72rem] text-slate-500">{contact.jid}</small>
                  <small className="block text-[0.73rem] text-slate-500">
                    Última interação: {contact.lastInteractionAt ? fmtTime(contact.lastInteractionAt) : '--:--'}
                  </small>
                  {contact.hasActiveSession ? (
                    <small className="mt-1 inline-block rounded-full bg-[#dcfce7] px-2 py-0.5 text-[0.66rem] font-bold text-[#166534]">
                      Sessão ativa
                    </small>
                  ) : null}
                </span>
              </label>
            ))
          )}
        </div>
      </article>

      <article className={`${panelClass} min-w-0`}>
        <header className="mb-3">
          <h3 className="text-base font-extrabold">Novo Anúncio</h3>
          <small className="mt-1 block text-xs text-slate-500">
            Destinatários atuais: {recipientsCount} | modo {recipientMode === 'all' ? 'todos' : 'selecionados'}
          </small>
          <small className="mt-1 block text-[0.74rem] text-[#1d4e89]">
            Intervalo atual de envio: {Math.max(0, Math.floor(Number(broadcastSendIntervalMs) || 0))} ms. Configure em Configurações &gt; Runtime.
          </small>
          {recipientMode === 'all' && search.trim() ? (
            <small className="mt-1 block text-[0.72rem] text-amber-700">
              O filtro de busca não limita o envio no modo "todos".
            </small>
          ) : null}
        </header>

        <section
          className={[
            'broadcast-flight-scene',
            progressSending ? 'is-sending' : '',
            progressCompleted ? 'is-complete' : '',
            showReturnFlight ? 'is-returning' : '',
          ].join(' ')}
          aria-live="polite"
        >
          <div className="broadcast-flight-progress">
            <span style={{ width: `${progressPercent}%` }} />
          </div>
          <div className="broadcast-flight-stage">
            <div className="broadcast-flight-orb" aria-hidden="true" />
            <div className="broadcast-flight-cloud-layer layer-back" aria-hidden="true" />
            <div className="broadcast-flight-cloud-layer layer-front" aria-hidden="true" />
            <div className="broadcast-flight-runway" aria-hidden="true" />
            <div className="broadcast-flight-runway-strip" aria-hidden="true" />
            {showOutboundPlane || showParkedPlane ? (
              <div
                className="broadcast-flight-plane-anchor"
                style={{
                  left: `${showParkedPlane ? runwayStartX : outboundX}%`,
                  top: `${showParkedPlane ? runwayStartY : outboundY}%`,
                  transform: `translate(-50%, -50%) rotate(${showParkedPlane ? 0 : outboundRotate}deg) scale(${showParkedPlane ? 1 : outboundScale})`,
                  opacity: 1,
                }}
                aria-hidden="true"
              >
                <span
                  className="broadcast-flight-trail"
                  style={{
                    opacity: showParkedPlane ? 0 : outboundTrailOpacity,
                  }}
                />
                {renderPlaneSprite()}
              </div>
            ) : null}
            {showReturnFlight ? (
              <div
                className="broadcast-flight-plane-anchor is-returning"
                style={{
                  left: `${returnX}%`,
                  top: `${returnY}%`,
                  transform: `translate(-50%, -50%) rotate(${returnRotate}deg) scale(${returnScale})`,
                }}
                aria-hidden="true"
              >
                <span className="broadcast-flight-trail" style={{ opacity: returnTrailOpacity }} />
                {renderPlaneSprite()}
              </div>
            ) : null}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <p className="broadcast-flight-pill">
              <strong>{progressSent}</strong> enviados
            </p>
            <p className="broadcast-flight-pill">
              <strong>{progressRemaining}</strong> faltando
            </p>
            <p className="broadcast-flight-pill col-span-2 sm:col-span-1">
              <strong>{progressFailed}</strong> falhas
            </p>
          </div>
        </section>

        <label className="mb-2 block text-xs font-bold uppercase tracking-[0.06em] text-slate-500" htmlFor="broadcast-message">
          Mensagem
        </label>
        <textarea
          id="broadcast-message"
          value={messageText}
          onChange={event => onMessageChange(event.target.value)}
          placeholder="Digite o texto do anúncio (opcional se enviar apenas imagem)"
          className="min-h-[180px] w-full rounded-xl border border-[#cfdcec] bg-white px-3 py-2 text-sm outline-none focus:border-[#7ca4db] focus:ring-2 focus:ring-[rgba(30,99,201,0.15)]"
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={event => {
              const file = event.target.files?.[0];
              if (!file) return;
              onPickImage(file);
              event.target.value = '';
            }}
          />
          <button
            type="button"
            className={`${buttonBase} border-[#d4e0f1] bg-white/80 text-slate-700 hover:bg-slate-50`}
            onClick={() => imageInputRef.current?.click()}
          >
            <i className="fa-regular fa-image" aria-hidden="true" /> Anexar imagem
          </button>
          <button
            type="button"
            className={`${buttonBase} border-[#f2c4ca] bg-[#fff5f5] text-[#b4232c] hover:bg-[#ffe4e6]`}
            onClick={onClearImage}
            disabled={!imageFileName}
          >
            <i className="fa-regular fa-trash-can" aria-hidden="true" />
            Remover imagem
          </button>
          <button
            type="button"
            className={`${buttonBase} border-[#174d9d] bg-[#1e63c9] text-white hover:bg-[#174d9d]`}
            onClick={onSend}
            disabled={busySend || recipientsCount <= 0}
          >
            <i className={busySend ? 'fa-solid fa-spinner fa-spin' : 'fa-regular fa-paper-plane'} aria-hidden="true" />{' '}
            {busySend ? 'Enviando...' : 'Enviar anúncio'}
          </button>
        </div>

        {imageFileName ? (
          <div className="mt-3 rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3">
            <small className="block text-xs text-slate-500">Imagem selecionada: {imageFileName}</small>
            {imagePreviewUrl ? (
              <img
                src={imagePreviewUrl}
                alt="Preview da imagem de anúncio"
                className="mt-2 max-h-[240px] rounded-xl border border-[#d7e3f2] object-contain"
              />
            ) : null}
          </div>
        ) : null}

        {lastResult ? (
          <div className="mt-3 rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3">
            <p className="m-0 text-sm font-semibold text-slate-700">
              Campanha #{lastResult.campaignId}: {lastResult.sent}/{lastResult.attempted} enviados
            </p>
            <small className="block text-xs text-slate-500">Falhas: {lastResult.failed}</small>
          </div>
        ) : null}
      </article>
    </section>
  );
}
