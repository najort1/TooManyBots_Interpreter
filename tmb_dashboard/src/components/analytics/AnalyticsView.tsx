import { useMemo, useState } from 'react';
import type { ChartConfiguration } from 'chart.js';
import { ChartCanvas } from '../charts/ChartCanvas';
import { fmtDuration, fmtTime, formatJidPhone, isLikelyErrorMessage } from '../../lib/format';
import { getLogPresentation } from '../../lib/appUtils';
import { buttonBaseClass, panelClass } from '../../lib/uiTokens';
import type { DashboardMode, DashboardStats, EventLog } from '../../types';
import { KpiCard } from '../KpiCard';

interface AnalyticsViewProps {
  mode: DashboardMode;
  stats: DashboardStats | null;
  logs: EventLog[];
  onExport: () => void;
}

function buildChartMotionOptions(prefersReducedMotion: boolean) {
  if (prefersReducedMotion) {
    return { animation: false as const };
  }

  return {
    animation: {
      duration: 460,
      easing: 'easeOutCubic' as const,
    },
    transitions: {
      active: {
        animation: {
          duration: 320,
          easing: 'easeOutQuart' as const,
        },
      },
      show: {
        animations: {
          x: { from: 0, duration: 420, easing: 'easeOutCubic' as const },
          y: { from: 0, duration: 420, easing: 'easeOutCubic' as const },
        },
      },
    },
  };
}

function getPrimaryChartConfig(mode: DashboardMode, stats: DashboardStats, prefersReducedMotion: boolean): ChartConfiguration {
  const motionOptions = buildChartMotionOptions(prefersReducedMotion);
  if (mode === 'CONVERSATION') {
    const fallbackFunnel = [{ step: 'start', label: 'Início', count: stats.conversationsStarted ?? 0 }];
    const rawFunnel = (stats as DashboardStats & { funnel?: unknown }).funnel;
    const funnel = Array.isArray(rawFunnel)
      ? rawFunnel
      : (rawFunnel && typeof rawFunnel === 'object'
        ? [
            { step: 'started', label: 'Iniciadas', count: Number((rawFunnel as { started?: number }).started ?? 0) },
            { step: 'active', label: 'Ativas', count: Number((rawFunnel as { active?: number }).active ?? 0) },
            { step: 'completed', label: 'Concluídas', count: Number((rawFunnel as { completed?: number }).completed ?? 0) },
            { step: 'abandoned', label: 'Abandonadas', count: Number((rawFunnel as { abandoned?: number }).abandoned ?? 0) },
          ]
        : fallbackFunnel);
    return {
      type: 'bar',
      data: {
        labels: funnel.map(item => item.label),
        datasets: [
          {
            label: 'Usuários',
            data: funnel.map(item => item.count),
            backgroundColor: 'rgba(30, 99, 201, 0.85)',
            borderRadius: 6,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        ...motionOptions,
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true } },
      },
    } as unknown as ChartConfiguration;
  }

  const commandSlices = stats.commands ?? [];
  const colors = ['#2563eb', '#0f766e', '#d97706', '#b91c1c', '#0f172a', '#0369a1', '#4d7c0f'];
  return {
    type: 'doughnut',
    data: {
      labels: commandSlices.map(item => item.command),
      datasets: [
        {
          data: commandSlices.map(item => item.count),
          backgroundColor: colors.slice(0, Math.max(1, commandSlices.length)),
          borderWidth: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      ...motionOptions,
      plugins: {
        legend: {
          position: 'right',
          labels: { boxWidth: 12, color: '#334155' },
        },
      },
    },
  } as unknown as ChartConfiguration;
}

function getVolumeChartConfig(mode: DashboardMode, stats: DashboardStats, prefersReducedMotion: boolean): ChartConfiguration<'line'> {
  const motionOptions = buildChartMotionOptions(prefersReducedMotion);
  const labels = Array.from({ length: 24 }, (_, index) => `${index}h`);
  const hourlyVolume = stats.hourlyVolume ?? Array(24).fill(0);
  const isConversation = mode === 'CONVERSATION';

  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Volume',
          data: hourlyVolume,
          borderColor: isConversation ? '#2563eb' : '#0f766e',
          backgroundColor: isConversation ? 'rgba(37, 99, 235, 0.12)' : 'rgba(15, 118, 110, 0.12)',
          borderWidth: 2,
          fill: true,
          tension: 0.35,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      ...motionOptions,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, ticks: { precision: 0 } },
      },
    },
  };
}

function getBottomChartConfig(stats: DashboardStats, prefersReducedMotion: boolean): ChartConfiguration<'bar'> {
  const motionOptions = buildChartMotionOptions(prefersReducedMotion);
  const trend = stats.weeklyTrend ?? [];
  const labels = trend.length ? trend.map(item => item.date) : ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
  const started = trend.length ? trend.map(item => item.started) : [0, 0, 0, 0, 0, 0, 0];
  const abandoned = trend.length ? trend.map(item => item.abandoned) : [0, 0, 0, 0, 0, 0, 0];

  return {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Iniciadas', data: started, backgroundColor: '#2563eb' },
        { label: 'Abandonadas', data: abandoned, backgroundColor: '#dc2626' },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      ...motionOptions,
      scales: {
        x: { stacked: true },
        y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } },
      },
    },
  };
}

function PanelTitle({ icon, text }: { icon: string; text: string }) {
  return (
    <h3 className="inline-flex items-center gap-1 text-base font-extrabold">
      <i className={`${icon} text-[0.9rem] text-[#2f5f9f]`} aria-hidden="true" />
      <span>{text}</span>
    </h3>
  );
}

export function AnalyticsView({
  mode,
  stats,
  logs,
  onExport,
}: AnalyticsViewProps) {
  const [showTechnicalLogs, setShowTechnicalLogs] = useState(false);
  const prefersReducedMotion = useMemo(
    () => (typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false),
    []
  );
  const safeStats = useMemo(() => stats ?? {}, [stats]);
  const primaryChartConfig = useMemo(
    () => getPrimaryChartConfig(mode, safeStats, prefersReducedMotion),
    [mode, prefersReducedMotion, safeStats]
  );
  const volumeChartConfig = useMemo(
    () => getVolumeChartConfig(mode, safeStats, prefersReducedMotion),
    [mode, prefersReducedMotion, safeStats]
  );
  const bottomChartConfig = useMemo(
    () => getBottomChartConfig(safeStats, prefersReducedMotion),
    [prefersReducedMotion, safeStats]
  );

  const avgDuration = safeStats.avgDurationMs ?? safeStats.averageDurationMs ?? 0;
  const avgDurationTotal = safeStats.averageDurationTotalMs ?? safeStats.averageDurationMs ?? 0;
  const completed = Number(safeStats.completedSessions ?? 0);
  const started = Number(safeStats.conversationsStarted ?? 0);
  const abandoned = Number(safeStats.abandonedSessions ?? 0);
  const conversionRate = started > 0 ? (completed / started) * 100 : 0;
  const recentErrors = safeStats.recentErrors ?? [];
  const apiHealth = safeStats.apiHealth ?? [];
  const visibleLogs = useMemo(
    () => logs.filter(log => showTechnicalLogs || !getLogPresentation(log).isTechnical),
    [logs, showTechnicalLogs]
  );

  return (
    <section className="mx-auto max-w-[1560px]">
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {mode === 'CONVERSATION' ? (
          <>
            <KpiCard
              title="Taxa de Conclusão Total"
              value={Number((safeStats.completionRateTotal ?? 0) * 100)}
              icon="fa-regular fa-circle-check"
              color="emerald"
              formatValue={value => `${value.toFixed(1)}%`}
            />
            <KpiCard
              title="Abandono Total"
              value={Number((safeStats.abandonmentRateTotal ?? safeStats.abandonmentRate ?? 0) * 100)}
              icon="fa-solid fa-person-walking-arrow-right"
              color="red"
              formatValue={value => `${value.toFixed(1)}%`}
            />
            <KpiCard
              title="Tempo Médio Total"
              value={Number(avgDurationTotal)}
              icon="fa-regular fa-clock"
              color="blue"
              formatValue={value => fmtDuration(Math.max(0, Math.round(value)))}
            />
            <KpiCard title="Total de Sessões" value={safeStats.totalSessions ?? 0} icon="fa-solid fa-layer-group" color="emerald" />
          </>
        ) : (
          <>
            <KpiCard title="Execuções Hoje" value={safeStats.totalExecutions ?? 0} icon="fa-solid fa-bolt" color="blue" />
            <KpiCard
              title="Latência Média"
              value={Number(safeStats.avgLatencyMs ?? 0)}
              icon="fa-solid fa-gauge-high"
              color="amber"
              formatValue={value => `${Math.max(0, Math.round(value))}ms`}
            />
            <KpiCard
              title="Sucesso"
              value={Number((safeStats.successRate ?? 0) * 100)}
              icon="fa-regular fa-circle-check"
              color="emerald"
              formatValue={value => `${value.toFixed(1)}%`}
            />
            <KpiCard title="Pico / Hora" value={safeStats.peakPerHour ?? 0} icon="fa-solid fa-chart-line" color="purple" />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <article className={`${panelClass} xl:col-span-2`}>
          <header className="mb-3">
            <PanelTitle
              icon={mode === 'CONVERSATION' ? 'fa-solid fa-filter-circle-dollar' : 'fa-solid fa-fire'}
              text={mode === 'CONVERSATION' ? 'Funil de Conversação' : 'Comandos Populares'}
            />
          </header>
          <ChartCanvas config={primaryChartConfig} height={320} />
        </article>

        <article className={panelClass}>
          <header className="mb-3">
            <PanelTitle icon="fa-regular fa-clock" text="Volume Horário" />
          </header>
          <ChartCanvas config={volumeChartConfig} height={320} />
        </article>

        <article className={panelClass}>
          <header className="mb-3">
            <PanelTitle
              icon={mode === 'CONVERSATION' ? 'fa-solid fa-users' : 'fa-solid fa-user-group'}
              text={mode === 'CONVERSATION' ? 'Contatos Mais Ativos' : 'Usuários Mais Ativos'}
            />
          </header>
          <div className="max-h-[320px] overflow-auto">
            {mode === 'CONVERSATION' ? (
              (safeStats.topContacts ?? []).length === 0 ? (
                <p className="py-4 text-center text-sm text-slate-500">Nenhum dado ainda.</p>
              ) : (
                (safeStats.topContacts ?? []).map((item, index) => (
                  <div key={`${item.jid}-${index}`} className="flex items-center gap-3 border-b border-[#edf2f7] py-2 last:border-b-0">
                    <div className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#dbeafe] text-sm font-bold text-[#1d4ed8]">
                      {index + 1}
                    </div>
                    <div className="min-w-0">
                      <strong className="block truncate text-[0.86rem]">{item.name || item.jid}</strong>
                      <small className="text-[0.74rem] text-slate-500">
                        Última atividade: {item.lastActivity ? fmtTime(item.lastActivity) : '--:--'}
                      </small>
                    </div>
                    <span className="ml-auto text-xs font-bold text-slate-700">{item.messageCount} msgs</span>
                  </div>
                ))
              )
            ) : (
              (safeStats.topUsers ?? []).length === 0 ? (
                <p className="py-4 text-center text-sm text-slate-500">Nenhum dado ainda.</p>
              ) : (
                (safeStats.topUsers ?? []).map(item => (
                  <div key={item.jid} className="flex items-start justify-between gap-3 border-b border-[#edf2f7] py-2 last:border-b-0">
                    <div>
                      <strong className="block text-[0.86rem]">{item.name || item.jid}</strong>
                      <small className="text-[0.74rem] text-slate-500">Favorito: {item.favoriteCommand || 'N/A'}</small>
                    </div>
                    <span className="text-xs font-bold text-slate-700">{item.totalCommands} cmd</span>
                  </div>
                ))
              )
            )}
          </div>
        </article>

        <article className={`${panelClass} xl:col-span-2 min-h-[420px]`}>
          <header className="mb-3 flex items-center justify-between gap-3">
            <PanelTitle icon="fa-regular fa-rectangle-list" text={mode === 'CONVERSATION' ? 'Logs em Tempo Real' : 'Logs de Comandos'} />
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className={`${buttonBaseClass} border-[#d4e0f1] bg-white/80 text-slate-700 hover:bg-slate-50`}
                onClick={() => setShowTechnicalLogs(previous => !previous)}
              >
                <i className={showTechnicalLogs ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye'} aria-hidden="true" />
                {showTechnicalLogs ? 'Ocultar eventos técnicos' : 'Eventos técnicos'}
              </button>
              <button
                type="button"
                className={`${buttonBaseClass} border-[#d4e0f1] bg-white/80 text-slate-700 hover:bg-slate-50`}
                onClick={onExport}
              >
                <i className="fa-solid fa-file-export" aria-hidden="true" /> Exportar CSV
              </button>
            </div>
          </header>
          <div className="max-h-[360px] overflow-auto rounded-xl border border-[#dce6f2] bg-[#eef3fb] p-3">
            {visibleLogs.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-500">Aguardando mensagens...</p>
            ) : mode === 'CONVERSATION' ? (
              visibleLogs.map((log, index) => {
                const presentation = getLogPresentation(log);
                return (
                  <div
                    key={`${log.occurredAt}-${index}`}
                    className={[
                      'mb-1 grid grid-cols-[68px_1fr] gap-2 rounded-xl p-3',
                      presentation.isError
                        ? 'border border-red-200 bg-red-50'
                        : presentation.isSystem
                          ? 'bg-[#f8fafc]'
                          : presentation.isOutgoing
                            ? 'bg-[#e2e8f0]'
                            : 'bg-white',
                    ].join(' ')}
                  >
                    <time className="text-xs text-slate-500">{fmtTime(log.occurredAt)}</time>
                    <p className="text-[0.84rem] leading-[1.45]">
                      <strong>{presentation.label}:</strong> {presentation.text}
                      {!presentation.isSystem && log.jid ? (
                        <small className="mt-1 block text-[0.72rem] text-slate-500">{formatJidPhone(log.jid)}</small>
                      ) : null}
                    </p>
                  </div>
                );
              })
            ) : (
              <table className="w-full border-collapse text-[0.77rem]">
                <thead>
                  <tr>
                    <th className="border-b border-[#e2e8f0] p-2 text-left font-bold text-slate-500">Hora</th>
                    <th className="border-b border-[#e2e8f0] p-2 text-left font-bold text-slate-500">Contato</th>
                    <th className="border-b border-[#e2e8f0] p-2 text-left font-bold text-slate-500">Comando</th>
                    <th className="border-b border-[#e2e8f0] p-2 text-left font-bold text-slate-500">Res</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleLogs.map((log, index) => {
                    const commandFromMetadata = String(log.metadata?.commandName ?? log.metadata?.command ?? '').trim();
                    const command = commandFromMetadata || String(log.messageText || '').trim().split(/\s+/)[0] || 'n/a';
                    const failed = log.eventType.includes('error') || isLikelyErrorMessage(String(log.messageText ?? ''));
                    const presentation = getLogPresentation(log);
                    return (
                      <tr key={`${log.occurredAt}-${index}`}>
                        <td className="border-b border-[#e2e8f0] p-2">{fmtTime(log.occurredAt)}</td>
                        <td className="border-b border-[#e2e8f0] p-2">
                          <span className="block font-semibold text-slate-700">{presentation.displayName || formatJidPhone(log.jid)}</span>
                          <small className="text-slate-500">{formatJidPhone(log.jid)}</small>
                        </td>
                        <td className="border-b border-[#e2e8f0] p-2">{command}</td>
                        <td className="border-b border-[#e2e8f0] p-2">{failed ? 'ERRO' : 'OK'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </article>

        {mode === 'CONVERSATION' ? (
          <>
            <article className={`${panelClass} xl:col-span-2`}>
              <header className="mb-3">
                <PanelTitle icon="fa-solid fa-chart-column" text="Tendência Semanal" />
              </header>
              <ChartCanvas config={bottomChartConfig} height={260} />
            </article>
            <article className={panelClass}>
              <header className="mb-3">
                <PanelTitle icon="fa-solid fa-chart-simple" text="Métricas Avançadas" />
              </header>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-[#dce7f5] bg-[#f8fbff] p-3">
                  <span className="block text-xs text-slate-500">Taxa de Conversão</span>
                  <strong className="mt-1 block text-xl">{conversionRate.toFixed(1)}%</strong>
                </div>
                <div className="rounded-xl border border-[#dce7f5] bg-[#f8fbff] p-3">
                  <span className="block text-xs text-slate-500">Tempo Mediano</span>
                  <strong className="mt-1 block text-xl">{fmtDuration(safeStats.medianDurationMs ?? avgDuration)}</strong>
                </div>
                <div className="rounded-xl border border-[#dce7f5] bg-[#f8fbff] p-3">
                  <span className="block text-xs text-slate-500">Concluídas</span>
                  <strong className="mt-1 block text-xl">{completed}</strong>
                </div>
                <div className="rounded-xl border border-[#dce7f5] bg-[#f8fbff] p-3">
                  <span className="block text-xs text-slate-500">Abandonadas</span>
                  <strong className="mt-1 block text-xl">{abandoned}</strong>
                </div>
              </div>
            </article>
          </>
        ) : (
          <>
            <article className={`${panelClass} xl:col-span-2`}>
              <header className="mb-3">
                <PanelTitle icon="fa-solid fa-triangle-exclamation" text="Erros Recentes" />
              </header>
              <div className="max-h-[250px] overflow-auto">
                {recentErrors.length === 0 ? (
                  <p className="py-4 text-center text-sm text-slate-500">Nenhum erro recente.</p>
                ) : (
                  recentErrors.map((item, index) => (
                    <div key={`${item.command}-${index}`} className="flex items-start justify-between gap-3 border-b border-[#ebf1f8] py-2 last:border-b-0">
                      <div>
                        <strong className="block text-[0.85rem] text-[#b4232c]">{item.command}</strong>
                        <p className="mt-1 text-[0.76rem] text-[#7f1d1d]">{item.error}</p>
                      </div>
                      <span>{item.count}x</span>
                    </div>
                  ))
                )}
              </div>
            </article>
            <article className={panelClass}>
              <header className="mb-3">
                <PanelTitle icon="fa-solid fa-heart-pulse" text="Saúde das APIs" />
              </header>
              <div className="max-h-[250px] overflow-auto">
                {apiHealth.length === 0 ? (
                  <p className="py-4 text-center text-sm text-slate-500">Sem integrações mapeadas.</p>
                ) : (
                  apiHealth.map((item, index) => (
                    <div key={`${item.name}-${index}`} className="flex items-start justify-between gap-3 border-b border-[#ebf1f8] py-2 last:border-b-0">
                      <div>
                        <strong className="block text-[0.85rem]">{item.name}</strong>
                        <p className="mt-1 text-[0.76rem] text-slate-500">{item.avgLatencyMs}ms · {(item.uptime * 100).toFixed(0)}% uptime</p>
                      </div>
                      <span className={item.status === 'healthy' ? 'font-bold text-[#0f766e]' : 'font-bold text-[#c62828]'}>
                        {item.status === 'healthy' ? 'OK' : 'ALERTA'}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </article>
          </>
        )}
      </div>
    </section>
  );
}


