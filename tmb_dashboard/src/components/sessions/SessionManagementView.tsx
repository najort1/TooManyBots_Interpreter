import { fmtDuration, fmtTime, formatJidPhone } from '../../lib/format';
import type { ActiveSessionManagementItem, SessionFlowConfigItem, SessionOverview } from '../../types';

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

const panel = 'rounded-2xl border border-[#d8e2ef] bg-white p-4 shadow-[0_10px_32px_rgba(18,32,51,0.08)]';
const buttonBase =
  'inline-flex h-9 items-center justify-center rounded-full border px-3 text-[0.78rem] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60';

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
        <article className={panel}>
          <p className="text-[0.78rem] uppercase tracking-[0.06em] text-slate-500">Sessoes Ativas</p>
          <p className="mt-1 text-[1.8rem] font-extrabold">{overview?.activeSessions ?? 0}</p>
        </article>
        <article className={panel}>
          <p className="text-[0.78rem] uppercase tracking-[0.06em] text-slate-500">Sessoes em Handoff</p>
          <p className="mt-1 text-[1.8rem] font-extrabold">{overview?.handoffSessions ?? 0}</p>
        </article>
        <article className={panel}>
          <p className="text-[0.78rem] uppercase tracking-[0.06em] text-slate-500">Tempo Medio de Sessao</p>
          <p className="mt-1 text-[1.8rem] font-extrabold">{fmtDuration(overview?.averageSessionDurationMs ?? 0)}</p>
        </article>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_1fr]">
        <article className={panel}>
          <header className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-base font-extrabold">Acoes de Gestao</h3>
            <button
              type="button"
              className={`${buttonBase} border-[#d4e0f1] bg-white/80 text-slate-700 hover:bg-slate-50`}
              onClick={onRefresh}
              disabled={busyRefresh}
            >
              {busyRefresh ? 'Atualizando...' : 'Atualizar dados'}
            </button>
          </header>

          <div className="space-y-3">
            <div className="rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3">
              <p className="m-0 text-sm font-semibold text-slate-700">Acoes em Massa</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={`${buttonBase} border-[#f2c4ca] bg-[#fff5f5] text-[#b4232c] hover:bg-[#ffe4e6]`}
                  onClick={onClearAll}
                  disabled={busyAction}
                >
                  Limpar todas as sessoes ativas
                </button>
                <button
                  type="button"
                  className={`${buttonBase} border-[#d4e0f1] bg-white text-slate-700 hover:bg-slate-50`}
                  onClick={onClearFlow}
                  disabled={busyAction || !selectedFlowPath}
                >
                  Limpar sessoes do flow selecionado
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
                  className="rounded-[10px] border border-[#cfdcec] bg-white px-3 py-2 text-sm outline-none focus:border-[#7ca4db] focus:ring-2 focus:ring-[rgba(30,99,201,0.15)]"
                />
                <button
                  type="button"
                  className={`${buttonBase} border-[#174d9d] bg-[#1e63c9] text-white hover:bg-[#174d9d]`}
                  onClick={onResetByJid}
                  disabled={busyAction || !resetJidInput.trim()}
                >
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
                  className="rounded-[10px] border border-[#cfdcec] bg-white px-3 py-2 text-sm outline-none focus:border-[#7ca4db] focus:ring-2 focus:ring-[rgba(30,99,201,0.15)]"
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
                    className="rounded-[10px] border border-[#cfdcec] bg-white px-3 py-2 text-sm outline-none focus:border-[#7ca4db] focus:ring-2 focus:ring-[rgba(30,99,201,0.15)]"
                  />
                  <button
                    type="button"
                    className={`${buttonBase} border-[#0e6059] bg-[#0f766e] text-white hover:bg-[#0e6059]`}
                    onClick={onUpdateTimeout}
                    disabled={busyAction || !selectedFlowPath}
                  >
                    Salvar timeout
                  </button>
                </div>
              </div>
            </div>
          </div>
        </article>

        <article className={panel}>
          <header className="mb-3">
            <h3 className="text-base font-extrabold">Sessoes Ativas</h3>
          </header>
          <input
            type="text"
            value={search}
            onChange={event => onSearchChange(event.target.value)}
            placeholder="Buscar por JID ou flow"
            className="mb-3 w-full rounded-[10px] border border-[#cfdcec] bg-white px-3 py-2 text-sm outline-none focus:border-[#7ca4db] focus:ring-2 focus:ring-[rgba(30,99,201,0.15)]"
          />
          <div className="max-h-[560px] overflow-auto rounded-xl border border-[#dce6f3] bg-[#eef3fb] p-2">
            {activeSessions.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-500">Nenhuma sessao ativa encontrada.</p>
            ) : (
              activeSessions.map(session => (
                <div key={`${session.jid}-${session.flowPath}`} className="mb-2 rounded-[10px] border border-[#e5edf7] bg-white p-2.5 last:mb-0">
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-[0.86rem]">{formatJidPhone(session.jid)}</strong>
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
                    Inicio: {session.startedAt ? fmtTime(session.startedAt) : '--:--'} | Ultima atividade: {session.lastActivityAt ? fmtTime(session.lastActivityAt) : '--:--'}
                  </small>
                  <small className="block text-[0.72rem] text-slate-500">Duracao: {fmtDuration(session.durationMs)}</small>
                </div>
              ))
            )}
          </div>
        </article>
      </div>
    </section>
  );
}
