import { useEffect, useState } from 'react';
import { buttonBaseClass } from '../../lib/uiTokens';
import { Modal } from '../Modal';
import type { BotInfo, FlowRuntimeDetails } from '../../types';

interface FlowDetailsModalProps {
  bot: BotInfo | null;
  open: boolean;
  selected: boolean;
  runtimeMode: string;
  botRuntimeMode: string;
  onClose: () => void;
}

const DAY_LABELS: Record<string, string> = {
  sunday: 'Domingo',
  monday: 'Segunda',
  tuesday: 'Terca',
  wednesday: 'Quarta',
  thursday: 'Quinta',
  friday: 'Sexta',
  saturday: 'Sabado',
};

function statusLabel(status: BotInfo['status']): string {
  if (status === 'active') return 'Ativo';
  if (status === 'error') return 'Erro';
  return 'Inativo';
}

function statusClass(status: BotInfo['status']): string {
  if (status === 'active') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'error') return 'border-red-200 bg-red-50 text-red-700';
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

function readableBoolean(value: boolean | undefined, trueLabel = 'Sim', falseLabel = 'Nao'): string {
  return value ? trueLabel : falseLabel;
}

function readablePeriod(value: string | undefined): string {
  if (value === 'hour') return 'hora';
  if (value === 'week') return 'semana';
  if (value === 'month') return 'mes';
  if (value === 'year') return 'ano';
  return 'dia';
}

function formatDays(days: string[] | undefined): string {
  if (!Array.isArray(days) || days.length === 0) return 'Nenhum dia configurado';
  return days.map(day => DAY_LABELS[String(day)] || String(day)).join(', ');
}

function buildAvailabilitySummary(config: FlowRuntimeDetails | null | undefined): string {
  const availability = config?.availability;
  if (!availability?.restrictBySchedule) return 'Sem restricao por horario';
  const start = String(availability.timeRangeStart || '--:--');
  const end = String(availability.timeRangeEnd || '--:--');
  return `${start} as ${end} (${availability.timezone || 'timezone padrao'})`;
}

function buildStartPolicySummary(config: FlowRuntimeDetails | null | undefined): string {
  if (config?.startPolicy !== 'max-per-period') {
    return config?.startPolicy || 'allow-always';
  }
  const limit = config.startPolicyLimit;
  return `${Number(limit?.maxStarts) || 0} inicios por ${readablePeriod(limit?.period)}`;
}

function DetailRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0 rounded-xl border border-[#e5edf7] bg-[#f8fbff] p-3">
      <dt className="text-[11px] font-bold uppercase tracking-[0.06em] text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold text-slate-800">{value}</dd>
    </div>
  );
}

function MessageBlock({ label, value }: { label: string; value: string | undefined }) {
  const text = String(value || '').trim();
  if (!text) return null;

  return (
    <div className="rounded-xl border border-[#e5edf7] bg-white p-3">
      <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-slate-500">{label}</p>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">{text}</p>
    </div>
  );
}

export function FlowDetailsModal({
  bot,
  open,
  selected,
  runtimeMode,
  botRuntimeMode,
  onClose,
}: FlowDetailsModalProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (open) setShowAdvanced(false);
  }, [open, bot?.fileName]);

  if (!bot) return null;

  const runtimeConfig = bot.runtimeConfig || null;
  const startPolicyLimit = runtimeConfig?.startPolicyLimit || null;
  const sessionLimits = runtimeConfig?.sessionLimits || null;
  const postEnd = runtimeConfig?.postEnd || null;
  const contextPersistence = runtimeConfig?.contextPersistence || null;
  const availability = runtimeConfig?.availability || null;
  const globalVariables = Array.isArray(contextPersistence?.globalVariables)
    ? contextPersistence.globalVariables
    : [];

  return (
    <Modal
      open={open}
      title="Detalhes do flow"
      description="Resumo operacional do arquivo carregado no runtime e sua configuracao ativa no setup."
      onClose={onClose}
      maxWidthClass="max-w-[760px]"
      actions={[{ label: 'Fechar', onClick: onClose, variant: 'ghost' }]}
    >
      <div className="max-h-[72vh] space-y-4 overflow-y-auto pr-1">
        <div className="flex flex-col gap-3 rounded-xl border border-[#dce6f3] bg-white p-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="truncate text-base font-extrabold text-slate-900">{bot.fileName}</p>
            <p className="mt-1 break-all text-xs text-slate-500">{bot.flowPath}</p>
          </div>
          <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-xs font-bold ${statusClass(bot.status)}`}>
            {statusLabel(bot.status)}
          </span>
        </div>

        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <DetailRow label="Tipo" value={bot.botType || 'unknown'} />
          <DetailRow label="Blocos" value={Number(bot.totalBlocks) || 0} />
          <DetailRow label="Sintaxe" value={bot.syntaxValid ? 'Valida' : 'Invalida'} />
          <DetailRow label="Selecionado no setup" value={selected ? 'Sim' : 'Nao'} />
          <DetailRow label="Arquitetura ativa" value={botRuntimeMode || 'single-flow'} />
          <DetailRow label="Modo de execucao" value={runtimeMode || 'production'} />
          <DetailRow label="Modo da conversa" value={runtimeConfig?.conversationMode || bot.botType || 'unknown'} />
          <DetailRow label="Escopo de interacao" value={runtimeConfig?.interactionScope || 'padrao'} />
          <DetailRow label="Politica de inicio" value={buildStartPolicySummary(runtimeConfig)} />
          <DetailRow label="Timeout de sessao" value={`${Number(sessionLimits?.sessionTimeoutMinutes) || 0} min`} />
          <DetailRow label="Disponibilidade" value={buildAvailabilitySummary(runtimeConfig)} />
          <DetailRow
            label="Mensagem de encerramento"
            value={readableBoolean(runtimeConfig?.endBehavior?.sendClosingMessage, 'Habilitada', 'Desabilitada')}
          />
        </dl>

        {!bot.syntaxValid ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3">
            <p className="text-xs font-bold uppercase tracking-[0.06em] text-red-600">Erro de sintaxe</p>
            <p className="mt-1 break-words text-sm text-red-800">
              {bot.syntaxError || 'Erro nao identificado.'}
            </p>
          </div>
        ) : null}

        <div className="rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3">
          <button
            type="button"
            className={`${buttonBaseClass} w-full justify-between border-[#d4e0f1] bg-white text-slate-700 hover:bg-slate-50`}
            aria-expanded={showAdvanced}
            onClick={() => setShowAdvanced(previous => !previous)}
          >
            <span>Configuracao avancada</span>
            <i className={`fa-solid fa-chevron-${showAdvanced ? 'up' : 'down'}`} aria-hidden="true" />
          </button>

          {showAdvanced ? (
            <div className="mt-3 space-y-3">
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <DetailRow label="Limite de inicios" value={`${Number(startPolicyLimit?.maxStarts) || 0} por ${readablePeriod(startPolicyLimit?.period)}`} />
                <DetailRow label="Reentrada pos-fim" value={postEnd?.reentryPolicy || 'allow-always'} />
                <DetailRow label="Cooldown pos-fim" value={`${Number(postEnd?.cooldownMinutes) || 0} min`} />
                <DetailRow label="Preset de timeout" value={sessionLimits?.sessionTimeoutPreset || 'custom'} />
                <DetailRow label="Max. mensagens por sessao" value={Number(sessionLimits?.maxMessagesPerSession) || 0} />
                <DetailRow label="Persistencia de variaveis" value={contextPersistence?.variablePersistence || 'never'} />
                <DetailRow
                  label="Modo memoria"
                  value={readableBoolean(contextPersistence?.memoryModeEnabled, 'Habilitado', 'Desabilitado')}
                />
                <DetailRow label="Variaveis globais" value={globalVariables.length ? globalVariables.join(', ') : 'Nenhuma'} />
                <DetailRow
                  label="Restricao por agenda"
                  value={readableBoolean(availability?.restrictBySchedule, 'Habilitada', 'Desabilitada')}
                />
                <DetailRow label="Dias permitidos" value={formatDays(availability?.allowedDays)} />
                <DetailRow label="Feriados nacionais" value={readableBoolean(availability?.includeBrazilNationalHolidays, 'Incluidos', 'Ignorados')} />
                <DetailRow label="Timezone" value={availability?.timezone || 'padrao'} />
              </dl>

              <div className="grid grid-cols-1 gap-3">
                <MessageBlock label="Mensagem de limite de inicios" value={startPolicyLimit?.blockedMessage} />
                <MessageBlock label="Mensagem de cooldown" value={postEnd?.cooldownMessage} />
                <MessageBlock label="Mensagem de bloqueio pos-fim" value={postEnd?.blockedMessage} />
                <MessageBlock label="Mensagem de timeout" value={sessionLimits?.timeoutMessage} />
                <MessageBlock label="Mensagem fora do horario" value={availability?.outsideScheduleMessage} />
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
