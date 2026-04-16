import { fmtDuration, fmtTime, formatJidPhone } from '../../lib/format';
import { buttonBaseClass, inputBaseClass, panelClass, timelineItemClass } from '../../lib/uiTokens';
import type { ActiveSessionManagementItem, SessionFlowConfigItem, SessionOverview } from '../../types';
import { EmptyStateMascot } from '../feedback/EmptyStateMascot';
import { KpiCard } from '../KpiCard';

interface SessionManagementViewProps {
  overview: SessionOverview | null;
  activeSessions: ActiveSessionManagementItem[];
  flows: SessionFlowConfigItem[];
  search: string;
  selectedFlowPath: string;
  timeoutInputMinutes: string;
  resetJidInput: string;
  busyRefresh: boolean;
  busyAction: boolean;
  onSearchChange: (value: string) => void;
  onRefresh: () => void;
  onClearAll: () => void;
  onClearFlow: () => void;
  onResetJidInputChange: (value: string) => void;
  onResetByJid: () => void;
  onSelectFlowPath: (value: string) => void;
  onTimeoutInputChange: (value: string) => void;
  onUpdateTimeout: () => void;
}

const buttonBase = buttonBaseClass;

export function SessionManagementView({
  overview,
  activeSessions,
  flows,
  search,
  selectedFlowPath,
  timeoutInputMinutes,
  resetJidInput,
  busyRefresh,
  busyAction,
  onSearchChange,
  onRefresh,
  onClearAll,
  onClearFlow,
  onResetJidInputChange,
  onResetByJid,
  onSelectFlowPath,
  onTimeoutInputChange,
  onUpdateTimeout,
}: SessionManagementViewProps) {
  const selectedFlow = flows.find(flow => flow.flowPath === selectedFlowPath) || null;

  return (
    <section className="mx-auto max-w-[1560px] space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard
          title="Sessões Ativas"
          value={overview?.activeSessions ?? 0}
          icon="fa-solid fa-users"
          color="blue"
        />
        <KpiCard
          title="Sessões em Handoff"
          value={overview?.handoffSessions ?? 0}
          icon="fa-solid fa-headset"
          color="amber"
        />
        <KpiCard
          title="Tempo Médio de Sessão"
          value={overview?.averageSessionDurationMs ?? 0}
          icon="fa-regular fa-clock"
          color="emerald"
          formatValue={val => fmtDuration(val)}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_1fr]">
        <article className={panelClass}>
          <header className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-base font-extrabold">Ações de Gestão</h3>
            <button
              type="button"
              className={`${buttonBase} border-[#d4e0f1] bg-white/80 text-slate-700 hover:bg-slate-50`}
              onClick={onRefresh}
              disabled={busyRefresh}
            >
              <i className={busyRefresh ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-arrows-rotate'} aria-hidden="true" />
              {busyRefresh ? 'Atualizando...' : 'Atualizar dados'}
            </button>
          </header>

          <div className="space-y-3">
            <div className="rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3">
              <p className="m-0 text-sm font-semibold text-slate-700">Ações em Massa</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={`${buttonBase} border-[#f2c4ca] bg-[#fff5f5] text-[#b4232c] hover:bg-[#ffe4e6]`}
                  onClick={onClearAll}
                  disabled={busyAction}
                >
                  <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
                  Limpar todas as sessões ativas
                </button>
                <button
                  type="button"
                  className={`${buttonBase} border-[#d4e0f1] bg-white/80 text-slate-700 hover:bg-slate-50`}
                  onClick={onClearFlow}
                  disabled={busyAction || !selectedFlowPath}
                >
                  <i className="fa-solid fa-broom" aria-hidden="true" />
                  Limpar sessões do flow selecionado
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3">
              <p className="m-0 text-sm font-semibold text-slate-700">Reset por JID</p>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
                <input
                  type="text"
                  value={resetJidInput}
                  onChange={event => onResetJidInputChange(event.target.value)}
                  placeholder="Ex.: 5511999999999@s.whatsapp.net"
                  className={inputBaseClass}
                />
                <button
                  type="button"
                  className={`${buttonBase} border-[#174d9d] bg-[#1e63c9] text-white hover:bg-[#174d9d]`}
                  onClick={onResetByJid}
                  disabled={busyAction || !resetJidInput.trim()}
                >
                  <i className="fa-solid fa-rotate-right" aria-hidden="true" />
                  Reset por JID
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3">
              <p className="m-0 text-sm font-semibold text-slate-700">Timeout Configuration</p>
              <small className="text-xs text-slate-500">Ajusta `sessionTimeoutMinutes` do flow selecionado.</small>
              <div className="mt-2 grid grid-cols-1 gap-2">
                <select
                  value={selectedFlowPath}
                  onChange={event => onSelectFlowPath(event.target.value)}
                  className={inputBaseClass}
                >
                  <option value="">Selecione um flow</option>
                  {flows.map(flow => (
                    <option key={flow.flowPath} value={flow.flowPath}>
                      {flow.flowPath} ({flow.botType})
                    </option>
                  ))}
                </select>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={timeoutInputMinutes}
                    onChange={event => onTimeoutInputChange(event.target.value)}
                    placeholder={selectedFlow ? String(selectedFlow.sessionTimeoutMinutes) : 'Minutos'}
                    className={inputBaseClass}
                  />
                  <button
                    type="button"
                    className={`${buttonBase} border-[#0e6059] bg-[#0f766e] text-white hover:bg-[#0e6059]`}
                    onClick={onUpdateTimeout}
                    disabled={busyAction || !selectedFlowPath}
                  >
                    <i className="fa-regular fa-floppy-disk" aria-hidden="true" />
                    Salvar timeout
                  </button>
                </div>
              </div>
            </div>
          </div>
        </article>

        <article className={panelClass}>
          <header className="mb-3">
            <h3 className="text-base font-extrabold">Sessões Ativas</h3>
          </header>
          <input
            type="text"
            value={search}
            onChange={event => onSearchChange(event.target.value)}
            placeholder="Buscar por JID ou flow"
            className={`mb-3 w-full ${inputBaseClass}`}
          />
          <div
            className={[
              'max-h-[560px] overflow-auto rounded-xl p-3',
              activeSessions.length === 0 ? 'border border-[#dce6f3] bg-transparent' : 'border border-[#dce6f3] bg-[#eef3fb]',
            ].join(' ')}
          >
            {activeSessions.length === 0 ? (
              <EmptyStateMascot
                compact
                title="Nenhuma sessão ativa encontrada."
                description="Quando uma nova conversa iniciar, ela aparecerá aqui com flow e duração."
              />
            ) : (
              activeSessions.map(session => (
                <div key={`${session.jid}-${session.flowPath}`} className={`mb-2 ${timelineItemClass} last:mb-0`}>
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-[0.86rem]">
                      {String(session.displayName || '').trim() || formatJidPhone(session.jid)}
                    </strong>
                    <span
                      className={[
                        'rounded-full px-2 py-0.5 text-[0.66rem] font-bold',
                        session.handoffActive ? 'bg-[#fef3c7] text-[#92400e]' : 'bg-[#dcfce7] text-[#166534]',
                      ].join(' ')}
                    >
                      {session.handoffActive ? 'Handoff' : 'Ativa'}
                    </span>
                  </div>
                  <small className="mt-1 block text-[0.72rem] text-slate-500">
                    Flow: {session.flowPath} | Bloco: {session.blockIndex}
                  </small>
                  <small className="block text-[0.72rem] text-slate-500">
                    Início: {session.startedAt ? fmtTime(session.startedAt) : '--:--'} | Última atividade: {session.lastActivityAt ? fmtTime(session.lastActivityAt) : '--:--'}
                  </small>
                  <small className="block text-[0.72rem] text-slate-500">Duração: {fmtDuration(session.durationMs)}</small>
                </div>
              ))
            )}
          </div>
        </article>
      </div>
    </section>
  );
}
