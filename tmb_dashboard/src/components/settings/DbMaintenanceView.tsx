import { useEffect, useMemo, useState } from 'react';
import { buttonBaseClass, inputBaseClass, panelClass } from '../../lib/uiTokens';
import type { DbMaintenanceConfig, DbMaintenanceStatus } from '../../types';

interface DbMaintenanceViewProps {
  config: DbMaintenanceConfig | null;
  status: DbMaintenanceStatus | null;
  busyLoad: boolean;
  busySave: boolean;
  busyRun: boolean;
  onRefresh: () => void;
  onSave: (input: Partial<DbMaintenanceConfig>) => void;
  onRunNow: () => void;
}

function formatDateTime(ts?: number) {
  const value = Number(ts) || 0;
  if (!value) return '-';
  try {
    return new Date(value).toLocaleString('pt-BR');
  } catch {
    return '-';
  }
}

function toNonNegativeInt(value: string, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

export function DbMaintenanceView({
  config,
  status,
  busyLoad,
  busySave,
  busyRun,
  onRefresh,
  onSave,
  onRunNow,
}: DbMaintenanceViewProps) {
  const [maintenanceEnabled, setMaintenanceEnabled] = useState(true);
  const [maintenanceIntervalMinutes, setMaintenanceIntervalMinutes] = useState('30');
  const [retentionDays, setRetentionDays] = useState('30');
  const [retentionArchiveEnabled, setRetentionArchiveEnabled] = useState(true);
  const [eventBatchEnabled, setEventBatchEnabled] = useState(true);
  const [eventBatchFlushMs, setEventBatchFlushMs] = useState('1000');
  const [eventBatchSize, setEventBatchSize] = useState('200');

  useEffect(() => {
    if (!config) return;
    setMaintenanceEnabled(config.dbMaintenanceEnabled !== false);
    setMaintenanceIntervalMinutes(String(Math.max(5, Math.floor(Number(config.dbMaintenanceIntervalMinutes) || 30))));
    setRetentionDays(String(Math.max(1, Math.floor(Number(config.dbRetentionDays) || 30))));
    setRetentionArchiveEnabled(config.dbRetentionArchiveEnabled !== false);
    setEventBatchEnabled(config.dbEventBatchEnabled !== false);
    setEventBatchFlushMs(String(Math.max(100, Math.floor(Number(config.dbEventBatchFlushMs) || 1000))));
    setEventBatchSize(String(Math.max(10, Math.floor(Number(config.dbEventBatchSize) || 200))));
  }, [config]);

  const saveDisabled = busySave || busyLoad;
  const statusSummary = useMemo(() => {
    if (!status) return 'Sem execução registrada ainda.';
    const lastStatus = String(status.lastStatus || 'never');
    const reason = String(status.lastRunReason || '-');
    const durationMs = Number(status.lastDurationMs) || 0;
    if (lastStatus === 'failed') {
      return `Última execução falhou (${reason}) em ${durationMs} ms.`;
    }
    if (lastStatus === 'success') {
      return `Última execução concluída (${reason}) em ${durationMs} ms.`;
    }
    if (lastStatus === 'never') {
      return 'Sem execução registrada ainda.';
    }
    return `Status atual: ${lastStatus}.`;
  }, [status]);

  return (
    <section className="mx-auto grid max-w-[1560px] grid-cols-1 gap-4 xl:grid-cols-2">
      <article className={panelClass}>
        <header className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-base font-extrabold">Política de Manutenção</h3>
          <button
            type="button"
            className={`${buttonBaseClass} border-[#d4e0f1] bg-white/80 text-slate-700 hover:bg-slate-50`}
            onClick={onRefresh}
            disabled={busyLoad || busySave || busyRun}
          >
            {busyLoad ? 'Atualizando...' : 'Atualizar'}
          </button>
        </header>

        <div className="space-y-3">
          <div className="rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3">
            <p className="m-0 text-sm font-semibold text-slate-700">Manutenção automática</p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className={[
                  buttonBaseClass,
                  maintenanceEnabled ? 'border-[#174d9d] bg-[#1e63c9] text-white' : 'border-[#d4e0f1] bg-white text-slate-700',
                ].join(' ')}
                disabled={saveDisabled}
                onClick={() => setMaintenanceEnabled(true)}
              >
                Habilitada
              </button>
              <button
                type="button"
                className={[
                  buttonBaseClass,
                  !maintenanceEnabled ? 'border-[#174d9d] bg-[#1e63c9] text-white' : 'border-[#d4e0f1] bg-white text-slate-700',
                ].join(' ')}
                disabled={saveDisabled}
                onClick={() => setMaintenanceEnabled(false)}
              >
                Desabilitada
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3 text-sm font-semibold text-slate-700">
              Intervalo (min)
              <input
                type="number"
                min={5}
                max={1440}
                step={1}
                value={maintenanceIntervalMinutes}
                disabled={saveDisabled}
                onChange={event => setMaintenanceIntervalMinutes(event.target.value)}
                className={`${inputBaseClass} mt-2 w-full`}
              />
            </label>
            <label className="rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3 text-sm font-semibold text-slate-700">
              Retenção de eventos (dias)
              <input
                type="number"
                min={1}
                max={3650}
                step={1}
                value={retentionDays}
                disabled={saveDisabled}
                onChange={event => setRetentionDays(event.target.value)}
                className={`${inputBaseClass} mt-2 w-full`}
              />
            </label>
          </div>

          <div className="rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3">
            <p className="m-0 text-sm font-semibold text-slate-700">Arquivamento de eventos antigos</p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className={[
                  buttonBaseClass,
                  retentionArchiveEnabled ? 'border-[#174d9d] bg-[#1e63c9] text-white' : 'border-[#d4e0f1] bg-white text-slate-700',
                ].join(' ')}
                disabled={saveDisabled}
                onClick={() => setRetentionArchiveEnabled(true)}
              >
                Habilitado
              </button>
              <button
                type="button"
                className={[
                  buttonBaseClass,
                  !retentionArchiveEnabled ? 'border-[#174d9d] bg-[#1e63c9] text-white' : 'border-[#d4e0f1] bg-white text-slate-700',
                ].join(' ')}
                disabled={saveDisabled}
                onClick={() => setRetentionArchiveEnabled(false)}
              >
                Desabilitado
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3">
            <p className="m-0 text-sm font-semibold text-slate-700">Agrupar eventos antes de gravar</p>
            <p className="mt-1 text-xs text-slate-500">
              Mantem a gravacao mais leve quando muitas mensagens chegam ao mesmo tempo. Na duvida, deixe habilitado.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className={[
                  buttonBaseClass,
                  eventBatchEnabled ? 'border-[#174d9d] bg-[#1e63c9] text-white' : 'border-[#d4e0f1] bg-white text-slate-700',
                ].join(' ')}
                disabled={saveDisabled}
                onClick={() => setEventBatchEnabled(true)}
              >
                Habilitado
              </button>
              <button
                type="button"
                className={[
                  buttonBaseClass,
                  !eventBatchEnabled ? 'border-[#174d9d] bg-[#1e63c9] text-white' : 'border-[#d4e0f1] bg-white text-slate-700',
                ].join(' ')}
                disabled={saveDisabled}
                onClick={() => setEventBatchEnabled(false)}
              >
                Desabilitado
              </button>
            </div>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="text-xs font-semibold text-slate-600">
                Tempo maximo de espera (ms)
                <input
                  type="number"
                  min={100}
                  max={60000}
                  step={50}
                  value={eventBatchFlushMs}
                  disabled={saveDisabled}
                  onChange={event => setEventBatchFlushMs(event.target.value)}
                  className={`${inputBaseClass} mt-1 w-full`}
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Eventos por lote
                <input
                  type="number"
                  min={10}
                  max={5000}
                  step={10}
                  value={eventBatchSize}
                  disabled={saveDisabled}
                  onChange={event => setEventBatchSize(event.target.value)}
                  className={`${inputBaseClass} mt-1 w-full`}
                />
              </label>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`${buttonBaseClass} border-[#174d9d] bg-[#1e63c9] text-white hover:bg-[#174d9d]`}
              disabled={saveDisabled}
              onClick={() => {
                onSave({
                  dbMaintenanceEnabled: maintenanceEnabled,
                  dbMaintenanceIntervalMinutes: toNonNegativeInt(maintenanceIntervalMinutes, 30),
                  dbRetentionDays: toNonNegativeInt(retentionDays, 30),
                  dbRetentionArchiveEnabled: retentionArchiveEnabled,
                  dbEventBatchEnabled: eventBatchEnabled,
                  dbEventBatchFlushMs: toNonNegativeInt(eventBatchFlushMs, 1000),
                  dbEventBatchSize: toNonNegativeInt(eventBatchSize, 200),
                });
              }}
            >
              {busySave ? 'Salvando...' : 'Salvar política'}
            </button>
          </div>
        </div>
      </article>

      <article className={panelClass}>
        <header className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-base font-extrabold">Execução de Manutenção</h3>
          <button
            type="button"
            className={`${buttonBaseClass} border-[#0e6059] bg-[#0f766e] text-white hover:bg-[#0e6059]`}
            disabled={busyRun || busyLoad}
            onClick={onRunNow}
          >
            {busyRun ? 'Executando...' : 'Executar agora'}
          </button>
        </header>

        <div className="space-y-3 text-sm">
          <div className="rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3">
            <p className="m-0 font-semibold text-slate-700">Resumo</p>
            <small className="text-xs text-slate-500">{statusSummary}</small>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3">
              <strong>Última execução:</strong>
              <div>{formatDateTime(status?.lastRunAt)}</div>
            </div>
            <div className="rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3">
              <strong>Último status:</strong>
              <div>{String(status?.lastStatus || 'never')}</div>
            </div>
            <div className="rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3">
              <strong>Otimizacao de consultas:</strong>
              <div>{formatDateTime(status?.lastAnalyzeAt)}</div>
              <small className="text-xs text-slate-500">Atualiza estatisticas internas para buscas mais rapidas.</small>
            </div>
            <div className="rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3">
              <strong>Compactacao do banco:</strong>
              <div>{formatDateTime(status?.lastVacuumAt)}</div>
              <small className="text-xs text-slate-500">Recupera espaco em disco depois de limpezas grandes.</small>
            </div>
            <div className="rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3">
              <strong>Verificacao de integridade:</strong>
              <div>{formatDateTime(status?.lastIntegrityCheckAt)}</div>
              <small className="text-xs text-slate-500">Confirma se o arquivo do banco esta consistente.</small>
            </div>
            <div className="rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3">
              <strong>Retenção aplicada:</strong>
              <div>{formatDateTime(status?.lastRetentionAt)}</div>
            </div>
          </div>

          {String(status?.lastError || '').trim() ? (
            <div className="rounded-xl border border-[#f2c4ca] bg-[#fff5f5] p-3 text-[#b4232c]">
              <strong>Último erro:</strong>
              <div>{String(status?.lastError || '')}</div>
            </div>
          ) : null}
        </div>
      </article>
    </section>
  );
}
