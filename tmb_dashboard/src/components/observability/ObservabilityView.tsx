import { useMemo } from 'react';
import type { ChartConfiguration } from 'chart.js';
import type { DashboardTelemetryLevel, ObservabilitySnapshot } from '../../types';
import { buttonBaseClass, panelClass } from '../../lib/uiTokens';
import { fmtDuration, fmtTime } from '../../lib/format';
import { KpiCard } from '../KpiCard';
import { ChartCanvas } from '../charts/ChartCanvas';

interface ObservabilityViewProps {
  snapshot: ObservabilitySnapshot | null;
  telemetryLevel: DashboardTelemetryLevel;
  busySaveSettings: boolean;
  onTelemetryLevelChange: (level: DashboardTelemetryLevel) => void;
  onRefresh: () => void;
}

const TELEMETRY_OPTIONS: Array<{ value: DashboardTelemetryLevel; label: string }> = [
  { value: 'minimum', label: 'Mínimo' },
  { value: 'operational', label: 'Operacional' },
  { value: 'diagnostic', label: 'Diagnóstico' },
  { value: 'verbose', label: 'Verbose temporario' },
];

function toCpuUsagePercent(snapshot: ObservabilitySnapshot | null): number {
  if (!snapshot) return 0;
  const totalMicros =
    Number(snapshot.process?.cpuUsageMicros?.user || 0) +
    Number(snapshot.process?.cpuUsageMicros?.system || 0);
  const uptimeMs = Math.max(1, Number(snapshot.uptimeMs) || 1);
  return Math.max(0, Number(((totalMicros / 1000 / uptimeMs) * 100).toFixed(1)));
}

function toMemoryMb(snapshot: ObservabilitySnapshot | null): number {
  if (!snapshot) return 0;
  const rss = Number(snapshot.process?.memory?.rss || 0);
  return Number((rss / 1024 / 1024).toFixed(1));
}

function buildWsChartConfig(snapshot: ObservabilitySnapshot | null): ChartConfiguration<'line'> {
  const fallback = {
    labels: ['Agora'],
    values: [Number(snapshot?.websocket?.eventsPerMinute || 0)],
  };
  const series = Array.isArray(snapshot?.websocket?.eventsPerMinuteSeries)
    ? snapshot.websocket.eventsPerMinuteSeries
    : [];
  const normalized = series.length > 0
    ? {
      labels: series.map(item => fmtTime(Number(item.minuteTs) || 0)),
      values: series.map(item => Number(item.events) || 0),
    }
    : fallback;

  return {
    type: 'line',
    data: {
      labels: normalized.labels,
      datasets: [
        {
          label: 'Eventos WS/min',
          data: normalized.values,
          borderColor: '#2563eb',
          backgroundColor: 'rgba(37, 99, 235, 0.12)',
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, ticks: { precision: 0 } },
      },
    },
  };
}

export function ObservabilityView({
  snapshot,
  telemetryLevel,
  busySaveSettings,
  onTelemetryLevelChange,
  onRefresh,
}: ObservabilityViewProps) {
  const cpuPercent = useMemo(() => toCpuUsagePercent(snapshot), [snapshot]);
  const memoryMb = useMemo(() => toMemoryMb(snapshot), [snapshot]);
  const wsChartConfig = useMemo(() => buildWsChartConfig(snapshot), [snapshot]);
  const handlers = snapshot?.runtime?.errorsByHandler ?? [];
  const routes = snapshot?.http?.routes ?? [];
  const queries = snapshot?.sqlite?.queries ?? [];

  return (
    <section className="mx-auto max-w-[1560px]">
      <div className={`${panelClass} mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between`}>
        <div>
          <h2 className="text-lg font-extrabold text-[#16365b]">Observabilidade e Capacidade</h2>
          <p className="mt-1 text-sm text-slate-600">
            Telemetria ativa: <strong>{telemetryLevel}</strong>
            {snapshot?.dashboard?.isolationMode ? ` | isolamento: ${snapshot.dashboard.isolationMode}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={telemetryLevel}
            className="h-9 rounded-xl border border-[#cfdcec] bg-white px-3 text-sm"
            onChange={event => onTelemetryLevelChange(event.target.value as DashboardTelemetryLevel)}
            disabled={busySaveSettings}
          >
            {TELEMETRY_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <button
            type="button"
            className={`${buttonBaseClass} border-[#d4e0f1] bg-white/80 text-slate-700 hover:bg-slate-50`}
            onClick={onRefresh}
          >
            <i className="fa-solid fa-rotate" aria-hidden="true" /> Atualizar
          </button>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="CPU média"
          value={cpuPercent}
          icon="fa-solid fa-microchip"
          color="amber"
          formatValue={value => `${value.toFixed(1)}%`}
        />
        <KpiCard
          title="Memória RSS"
          value={memoryMb}
          icon="fa-solid fa-memory"
          color="blue"
          formatValue={value => `${value.toFixed(1)} MB`}
        />
        <KpiCard
          title="Backlog total"
          value={Number(snapshot?.runtime?.backlog?.ingestionQueue || 0) + Number(snapshot?.runtime?.backlog?.dispatchQueue || 0)}
          icon="fa-solid fa-list-check"
          color="red"
        />
        <KpiCard
          title="Sessões ativas"
          value={Number(snapshot?.runtime?.sessionsActive || 0)}
          icon="fa-solid fa-users"
          color="emerald"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <article className={`${panelClass} xl:col-span-2`}>
          <header className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-extrabold">Throughput por minuto</h3>
            <span className="text-xs text-slate-500">
              Broadcast/min: {Number(snapshot?.runtime?.broadcastThroughputPerMinute || 0)}
            </span>
          </header>
          <ChartCanvas config={wsChartConfig} height={260} />
        </article>

        <article className={`${panelClass} xl:col-start-3 xl:row-start-1`}>
          <header className="mb-3">
            <h3 className="text-base font-extrabold">Saúde do runtime</h3>
          </header>
          <div className="grid grid-cols-1 gap-2 text-sm">
            <div className="rounded-xl border border-[#e5edf7] bg-[#f8fbff] p-3">
              <span className="text-slate-500">Latência média por mensagem</span>
              <strong className="block text-lg">{Number(snapshot?.runtime?.messageLatencyAvgMs || 0).toFixed(1)} ms</strong>
            </div>
            <div className="rounded-xl border border-[#e5edf7] bg-[#f8fbff] p-3">
              <span className="text-slate-500">Latência p95 por mensagem</span>
              <strong className="block text-lg">{Number(snapshot?.runtime?.messageLatencyP95Ms || 0).toFixed(1)} ms</strong>
            </div>
            <div className="rounded-xl border border-[#e5edf7] bg-[#f8fbff] p-3">
              <span className="text-slate-500">Tempo médio query sqlite</span>
              <strong className="block text-lg">{Number(snapshot?.runtime?.sqliteQueryAvgMs || 0).toFixed(2)} ms</strong>
            </div>
            <div className="rounded-xl border border-[#e5edf7] bg-[#f8fbff] p-3">
              <span className="text-slate-500">Reconexões socket (24h)</span>
              <strong className="block text-lg">{Number(snapshot?.runtime?.socketReconnectRatePerDay || 0)}</strong>
            </div>
          </div>
        </article>

        <article className={`${panelClass} xl:col-start-3 xl:row-start-2`}>
          <header className="mb-3">
            <h3 className="text-base font-extrabold">Filas e backlog</h3>
          </header>
          <div className="space-y-2 text-sm">
            <div className="rounded-xl border border-[#e5edf7] bg-[#f8fbff] p-3">
              <span className="text-slate-500">Fila de ingestão</span>
              <strong className="block text-lg">{Number(snapshot?.runtime?.backlog?.ingestionQueue || 0)}</strong>
            </div>
            <div className="rounded-xl border border-[#e5edf7] bg-[#f8fbff] p-3">
              <span className="text-slate-500">Fila de dispatch</span>
              <strong className="block text-lg">{Number(snapshot?.runtime?.backlog?.dispatchQueue || 0)}</strong>
            </div>
            <div className="rounded-xl border border-[#e5edf7] bg-[#f8fbff] p-3">
              <span className="text-slate-500">Eventos WS/min</span>
              <strong className="block text-lg">{Number(snapshot?.websocket?.eventsPerMinute || 0)}</strong>
            </div>
          </div>
        </article>

        <article className={`${panelClass} xl:col-start-3 xl:row-start-3`}>
          <header className="mb-3">
            <h3 className="text-base font-extrabold">Erros por subsistema</h3>
          </header>
          <div className="max-h-[260px] overflow-auto xl:max-h-none">
            {handlers.length === 0 ? (
              <p className="text-sm text-slate-500">Sem erros por handler no nível atual.</p>
            ) : (
              handlers.map(item => (
                <div key={item.handlerType} className="mb-2 rounded-xl border border-[#ebf1f8] p-2 text-sm last:mb-0">
                  <strong className="block">{item.handlerType}</strong>
                  <span className="text-slate-600">falhas: {item.failed} | total: {item.count}</span>
                </div>
              ))
            )}
          </div>
        </article>

        <article className={`${panelClass} flex flex-col xl:col-span-2 xl:row-start-2 xl:row-span-2`}>
          <header className="mb-3">
            <h3 className="text-base font-extrabold">Saúde do banco local</h3>
          </header>
          <div className="min-h-[260px] flex-1 overflow-auto rounded-xl border border-[#e5edf7]">
            <table className="w-full border-collapse text-[0.8rem]">
              <thead>
                <tr>
                  <th className="border-b border-[#e5edf7] p-2 text-left">Query</th>
                  <th className="border-b border-[#e5edf7] p-2 text-left">Média</th>
                  <th className="border-b border-[#e5edf7] p-2 text-left">P95</th>
                  <th className="border-b border-[#e5edf7] p-2 text-left">Max</th>
                  <th className="border-b border-[#e5edf7] p-2 text-left">Contagem</th>
                </tr>
              </thead>
              <tbody>
                {queries.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-3 text-center text-slate-500">Sem consultas amostradas no nível atual.</td>
                  </tr>
                ) : queries.map(item => (
                  <tr key={item.query}>
                    <td className="border-b border-[#eef3fb] p-2 font-mono text-[0.72rem]">{item.query}</td>
                    <td className="border-b border-[#eef3fb] p-2">{item.avgMs.toFixed(2)} ms</td>
                    <td className="border-b border-[#eef3fb] p-2">{item.p95Ms.toFixed(2)} ms</td>
                    <td className="border-b border-[#eef3fb] p-2">{item.maxMs.toFixed(2)} ms</td>
                    <td className="border-b border-[#eef3fb] p-2">{item.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className={`${panelClass} xl:col-span-3`}>
          <header className="mb-3">
            <h3 className="text-base font-extrabold">Tempo de resposta do motor e rotas HTTP</h3>
          </header>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-[#e5edf7] bg-[#f8fbff] p-3 text-sm">
              <span className="text-slate-500">HTTP requests</span>
              <strong className="block text-lg">{Number(snapshot?.http?.totalRequests || 0)}</strong>
            </div>
            <div className="rounded-xl border border-[#e5edf7] bg-[#f8fbff] p-3 text-sm">
              <span className="text-slate-500">HTTP errors</span>
              <strong className="block text-lg">{Number(snapshot?.http?.totalErrors || 0)}</strong>
            </div>
            <div className="rounded-xl border border-[#e5edf7] bg-[#f8fbff] p-3 text-sm">
              <span className="text-slate-500">WS conexões abertas</span>
              <strong className="block text-lg">{Number(snapshot?.websocket?.connectionsOpened || 0)}</strong>
            </div>
            <div className="rounded-xl border border-[#e5edf7] bg-[#f8fbff] p-3 text-sm">
              <span className="text-slate-500">Uptime dashboard</span>
              <strong className="block text-lg">{fmtDuration(Number(snapshot?.uptimeMs || 0))}</strong>
            </div>
          </div>
          <div className="mt-3 max-h-[220px] overflow-auto rounded-xl border border-[#e5edf7]">
            <table className="w-full border-collapse text-[0.8rem]">
              <thead>
                <tr>
                  <th className="border-b border-[#e5edf7] p-2 text-left">Rota</th>
                  <th className="border-b border-[#e5edf7] p-2 text-left">Média</th>
                  <th className="border-b border-[#e5edf7] p-2 text-left">P95</th>
                  <th className="border-b border-[#e5edf7] p-2 text-left">Erros</th>
                  <th className="border-b border-[#e5edf7] p-2 text-left">Último</th>
                </tr>
              </thead>
              <tbody>
                {routes.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-3 text-center text-slate-500">Sem rotas amostradas no nível atual.</td>
                  </tr>
                ) : routes.map(route => (
                  <tr key={route.route}>
                    <td className="border-b border-[#eef3fb] p-2 font-mono text-[0.72rem]">{route.route}</td>
                    <td className="border-b border-[#eef3fb] p-2">{route.avgMs.toFixed(2)} ms</td>
                    <td className="border-b border-[#eef3fb] p-2">{route.p95Ms.toFixed(2)} ms</td>
                    <td className="border-b border-[#eef3fb] p-2">{route.errors}</td>
                    <td className="border-b border-[#eef3fb] p-2">{route.lastAt ? fmtTime(route.lastAt) : '--:--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </div>
    </section>
  );
}
