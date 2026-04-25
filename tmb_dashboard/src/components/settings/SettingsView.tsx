import { useEffect, useMemo, useState } from 'react';
import type { ChartConfiguration } from 'chart.js';
import { ChartCanvas } from '../charts/ChartCanvas';
import { buttonBaseClass, inputBaseClass, panelClass } from '../../lib/uiTokens';
import type { DatabaseInfo } from '../../types';

interface SettingsViewProps {
  autoReloadFlows: boolean;
  broadcastSendIntervalMs: number;
  theme: 'light' | 'dark';
  dbInfo: DatabaseInfo | null;
  busySaveSettings: boolean;
  busyClearCache: boolean;
  busyRefreshDb: boolean;
  onToggleAutoReload: (value: boolean) => void;
  onUpdateBroadcastSendInterval: (value: number) => void;
  onToggleTheme: (value: 'light' | 'dark') => void;
  onClearCache: () => void;
  onRefreshDbInfo: () => void;
}

const buttonBase = buttonBaseClass;

function formatBytes(value: number) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(2)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function formatMb(value: number) {
  const mb = (Number(value) || 0) / (1024 * 1024);
  return `${mb.toFixed(2)} MB`;
}

function toBrDateLabel(dateKey: string) {
  const match = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return dateKey;
  const [, y, m, d] = match;
  return `${d}/${m}/${y.slice(2)}`;
}

function buildDbGrowthConfig(dbInfo: DatabaseInfo | null): ChartConfiguration<'line'> {
  const history = Array.isArray(dbInfo?.sizeHistory) ? dbInfo.sizeHistory : [];
  const labels = history.map(item => toBrDateLabel(item.date));
  const points = history.map(item => Number((item.totalBytes / (1024 * 1024)).toFixed(2)));

  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Tamanho (MB)',
          data: points,
          borderColor: '#1e63c9',
          backgroundColor: 'rgba(30, 99, 201, 0.15)',
          fill: true,
          borderWidth: 2,
          tension: 0.35,
          pointRadius: 3,
          pointHoverRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => `${Number(ctx.parsed.y || 0).toFixed(2)} MB`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
        },
        y: {
          beginAtZero: true,
          ticks: {
            callback: value => `${Number(value).toFixed(2)} MB`,
          },
        },
      },
    },
  };
}

export function SettingsView({
  autoReloadFlows,
  broadcastSendIntervalMs,
  theme,
  dbInfo,
  busySaveSettings,
  busyClearCache,
  busyRefreshDb,
  onToggleAutoReload,
  onUpdateBroadcastSendInterval,
  onToggleTheme,
  onClearCache,
  onRefreshDbInfo,
}: SettingsViewProps) {
  const dbGrowthConfig = useMemo(() => buildDbGrowthConfig(dbInfo), [dbInfo]);
  const historyLength = Array.isArray(dbInfo?.sizeHistory) ? dbInfo.sizeHistory.length : 0;
  const [broadcastIntervalInput, setBroadcastIntervalInput] = useState(String(Math.max(0, Math.floor(Number(broadcastSendIntervalMs) || 0))));

  useEffect(() => {
    setBroadcastIntervalInput(String(Math.max(0, Math.floor(Number(broadcastSendIntervalMs) || 0))));
  }, [broadcastSendIntervalMs]);

  return (
    <section className="mx-auto grid max-w-[1560px] grid-cols-1 gap-4 xl:grid-cols-2">
      <article className={panelClass}>
        <header className="mb-3">
          <h3 className="text-base font-extrabold">Runtime</h3>
        </header>

        <div className="space-y-3">
          <div className="rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3">
            <p className="m-0 text-sm font-semibold text-slate-700">Auto-reload de flows (.tmb)</p>
            <small className="text-xs text-slate-500">
              Atualiza automaticamente o fluxo ao detectar mudanças em arquivos.
            </small>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className={[
                  buttonBase,
                  autoReloadFlows ? 'border-[#174d9d] bg-[#1e63c9] text-white' : 'border-[#d4e0f1] bg-white text-slate-700',
                ].join(' ')}
                disabled={busySaveSettings}
                onClick={() => onToggleAutoReload(true)}
              >
                Habilitado
              </button>
              <button
                type="button"
                className={[
                  buttonBase,
                  !autoReloadFlows ? 'border-[#174d9d] bg-[#1e63c9] text-white' : 'border-[#d4e0f1] bg-white text-slate-700',
                ].join(' ')}
                disabled={busySaveSettings}
                onClick={() => onToggleAutoReload(false)}
              >
                Desabilitado
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3">
            <p className="m-0 text-sm font-semibold text-slate-700">Tema</p>
            <small className="text-xs text-slate-500">Alterna entre visual claro e escuro no dashboard.</small>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className={[
                  buttonBase,
                  theme === 'light' ? 'border-[#174d9d] bg-[#1e63c9] text-white' : 'border-[#d4e0f1] bg-white text-slate-700',
                ].join(' ')}
                onClick={() => onToggleTheme('light')}
              >
                Claro
              </button>
              <button
                type="button"
                className={[
                  buttonBase,
                  theme === 'dark' ? 'border-[#174d9d] bg-[#1e63c9] text-white' : 'border-[#d4e0f1] bg-white text-slate-700',
                ].join(' ')}
                onClick={() => onToggleTheme('dark')}
              >
                Escuro
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3">
            <p className="m-0 text-sm font-semibold text-slate-700">Intervalo do Anúncio em Massa</p>
            <small className="text-xs text-slate-500">
              Controla o tempo de espera entre cada envio de destinatário no broadcast.
            </small>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                type="number"
                min={0}
                step={50}
                value={broadcastIntervalInput}
                onChange={event => setBroadcastIntervalInput(event.target.value)}
                disabled={busySaveSettings}
                className={`${inputBaseClass} w-32`}
              />
              <span className="text-xs font-semibold text-slate-600">ms entre envios</span>
              <button
                type="button"
                className={`${buttonBase} border-[#174d9d] bg-[#1e63c9] text-white hover:bg-[#174d9d]`}
                disabled={busySaveSettings}
                onClick={() => {
                  const next = Math.max(0, Math.floor(Number(broadcastIntervalInput) || 0));
                  onUpdateBroadcastSendInterval(next);
                }}
              >
                <i className="fa-regular fa-floppy-disk" aria-hidden="true" />
                Salvar intervalo
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3">
            <p className="m-0 text-sm font-semibold text-slate-700">Dados temporarios do runtime</p>
            <small className="text-xs text-slate-500">
              Use quando o dashboard parecer preso em fluxos ou sessoes antigas depois de editar um arquivo .tmb.
              Isso nao apaga conversas nem o banco; apenas forca o runtime a reconstruir dados em memoria.
            </small>
            <div className="mt-2">
              <button
                type="button"
                className={`${buttonBase} border-[#f2c4ca] bg-[#fff5f5] text-[#b4232c] hover:bg-[#ffe4e6]`}
                onClick={onClearCache}
                disabled={busyClearCache}
              >
                <i className="fa-regular fa-trash-can" aria-hidden="true" />
                {busyClearCache ? 'Limpando...' : 'Limpar dados temporarios'}
              </button>
            </div>
          </div>
        </div>
      </article>

      <article className={panelClass}>
        <header className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-base font-extrabold">Armazenamento do banco</h3>
          <button
            type="button"
            className={`${buttonBase} border-[#d4e0f1] bg-white/80 text-slate-700 hover:bg-slate-50`}
            onClick={onRefreshDbInfo}
            disabled={busyRefreshDb}
          >
            {busyRefreshDb ? 'Atualizando...' : 'Atualizar'}
          </button>
        </header>

        {!dbInfo ? (
          <p className="text-sm text-slate-500">Sem dados do banco ainda.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2">
            <div className="rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3 text-sm">
              <strong>Arquivo:</strong> {dbInfo.path}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3 text-sm">
                <strong>Modo de gravacao:</strong>
                <div>{String(dbInfo.journalMode || '').toUpperCase() === 'WAL' ? 'Otimizado para uso continuo' : 'Padrao do SQLite'}</div>
                <small className="text-xs text-slate-500">Valor tecnico: {dbInfo.journalMode}</small>
              </div>
              <div className="rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3 text-sm">
                <strong>Seguranca de escrita:</strong>
                <div>{dbInfo.synchronous || 'padrao'}</div>
                <small className="text-xs text-slate-500">Controle interno do SQLite para gravar dados com seguranca.</small>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3 text-sm">
                <strong>Banco principal</strong>
                <div>{formatBytes(dbInfo.fileSizeBytes)}</div>
              </div>
              <div className="rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3 text-sm">
                <strong>Fila de gravacao</strong>
                <div>{formatBytes(dbInfo.walSizeBytes)}</div>
                <small className="text-xs text-slate-500">Arquivo temporario usado pelo SQLite enquanto grava mudancas.</small>
              </div>
              <div className="rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3 text-sm">
                <strong>Controle interno</strong>
                <div>{formatBytes(dbInfo.shmSizeBytes)}</div>
                <small className="text-xs text-slate-500">Arquivo auxiliar do SQLite para coordenar acesso ao banco.</small>
              </div>
            </div>
            <div className="rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3 text-sm">
              <strong>Total em disco:</strong> {formatMb(dbInfo.totalStorageBytes ?? (dbInfo.fileSizeBytes + dbInfo.walSizeBytes + dbInfo.shmSizeBytes))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3 text-sm">
                <strong>Sessões:</strong> {dbInfo.sessionsTotal} (ativas: {dbInfo.sessionsActive})
              </div>
              <div className="rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3 text-sm">
                <strong>Eventos:</strong> {dbInfo.conversationEventsTotal}
              </div>
              <div className="rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3 text-sm">
                <strong>Conversas:</strong> {dbInfo.conversationSessionsTotal}
              </div>
              <div className="rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3 text-sm">
                <strong>Broadcast:</strong> {dbInfo.broadcastCampaignsTotal} campanhas / {dbInfo.broadcastRecipientsTotal} destinatários
              </div>
            </div>
            <div className="rounded-xl border border-[#dce6f3] bg-white p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <strong className="text-sm text-slate-700">Evolução diária do tamanho do DB</strong>
                <small className="text-xs text-slate-500">Últimos 7 dias</small>
              </div>
              {historyLength >= 2 ? (
                <ChartCanvas config={dbGrowthConfig} height={240} />
              ) : (
                <p className="text-sm text-slate-500">Histórico insuficiente. Aguarde novos snapshots diários.</p>
              )}
            </div>
          </div>
        )}
      </article>
    </section>
  );
}
