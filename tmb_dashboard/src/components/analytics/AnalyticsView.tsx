import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChartConfiguration } from 'chart.js';
import { ChartCanvas } from '../charts/ChartCanvas';
import { fmtDuration, fmtTime, isLikelyErrorMessage } from '../../lib/format';
import type { DashboardMode, DashboardStats, EventLog } from '../../types';

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
    const funnel = stats.funnel ?? [{ step: 'start', label: 'Inicio', count: stats.conversationsStarted ?? 0 }];
    return {
      type: 'bar',
      data: {
        labels: funnel.map(item => item.label),
        datasets: [
          {
            label: 'Usuarios',
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
  const labels = trend.length ? trend.map(item => item.date) : ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab', 'Dom'];
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
    <h3 className="inline-flex items-center gap-2 text-base font-extrabold">
      <i className={`${icon} text-[0.9rem] text-[#2f5f9f]`} aria-hidden="true" />
      <span>{text}</span>
    </h3>
  );
}

function useCountUp(target: number, durationMs = 420): number {
  const [displayValue, setDisplayValue] = useState(target);
  const previousValueRef = useRef(target);
  const prefersReducedMotion = useMemo(
    () => (typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false),
    []
  );

  useEffect(() => {
    const startValue = previousValueRef.current;
    const endValue = Number.isFinite(target) ? target : 0;
    previousValueRef.current = endValue;

    if (prefersReducedMotion) {
      setDisplayValue(endValue);
      return;
    }

    const delta = endValue - startValue;
    if (Math.abs(delta) < 0.001) {
      setDisplayValue(endValue);
      return;
    }

    let rafId = 0;
    const startAt = performance.now();
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

    const tick = (now: number) => {
      const progress = Math.min((now - startAt) / durationMs, 1);
      const nextValue = startValue + (delta * easeOut(progress));
      setDisplayValue(nextValue);
      if (progress < 1) {
        rafId = window.requestAnimationFrame(tick);
      }
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [durationMs, prefersReducedMotion, target]);

  return displayValue;
}

function KpiCard({
  title,
  value,
  icon,
  valueClass = '',
  formatValue,
}: {
  title: string;
  value: number;
  icon: string;
  valueClass?: string;
  formatValue?: (value: number) => string;
}) {
  const animatedValue = useCountUp(Number(value) || 0);
  const renderedValue = formatValue
    ? formatValue(animatedValue)
    : `${Math.max(0, Math.round(animatedValue))}`;

  return (
    <article className="rounded-2xl border border-[#d8e2ef] bg-white p-4 shadow-[0_10px_32px_rgba(18,32,51,0.08)]">
      <p className="inline-flex items-center gap-2 text-[0.78rem] uppercase tracking-[0.06em] text-slate-500">
        <i className={`${icon} text-[0.78rem] text-[#2b5ea5]`} aria-hidden="true" />
        <span>{title}</span>
      </p>
      <p className={`mt-1 text-[1.78rem] font-extrabold ${valueClass}`.trim()}>{renderedValue}</p>
    </article>
  );
}

const panel = 'rounded-2xl border border-[#d8e2ef] bg-white p-4 shadow-[0_10px_32px_rgba(18,32,51,0.08)]';

export function AnalyticsView({
  mode,
  stats,
  logs,
  onExport,
}: AnalyticsViewProps) {
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
  const completed = Number(safeStats.completedSessions ?? 0);
  const started = Number(safeStats.conversationsStarted ?? 0);
  const abandoned = Number(safeStats.abandonedSessions ?? 0);
  const conversionRate = started > 0 ? (completed / started) * 100 : 0;
  const recentErrors = safeStats.recentErrors ?? [];
  const apiHealth = safeStats.apiHealth ?? [];

  return (
    <section className="mx-auto max-w-[1560px]">
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {mode === 'CONVERSATION' ? (
          <>
            <KpiCard title="Conversas Hoje" value={safeStats.conversationsStarted ?? 0} icon="fa-regular fa-comments" />
            <KpiCard
              title="Abandono"
              value={Number((safeStats.abandonmentRate ?? 0) * 100)}
              icon="fa-solid fa-person-walking-arrow-right"
              valueClass="text-[#c62828]"
              formatValue={value => `${value.toFixed(1)}%`}
            />
            <KpiCard
              title="Tempo Medio"
              value={Number(avgDuration)}
              icon="fa-regular fa-clock"
              formatValue={value => fmtDuration(Math.max(0, Math.round(value)))}
            />
            <KpiCard title="Sessoes Ativas" value={safeStats.activeSessions ?? 0} icon="fa-solid fa-signal" valueClass="text-[#0f766e]" />
          </>
        ) : (
          <>
            <KpiCard title="Execucoes Hoje" value={safeStats.totalExecutions ?? 0} icon="fa-solid fa-bolt" />
            <KpiCard
              title="Latencia Media"
              value={Number(safeStats.avgLatencyMs ?? 0)}
              icon="fa-solid fa-gauge-high"
              formatValue={value => `${Math.max(0, Math.round(value))}ms`}
            />
            <KpiCard
              title="Sucesso"
              value={Number((safeStats.successRate ?? 0) * 100)}
              icon="fa-regular fa-circle-check"
              valueClass="text-[#0f766e]"
              formatValue={value => `${value.toFixed(1)}%`}
            />
            <KpiCard title="Pico / Hora" value={safeStats.peakPerHour ?? 0} icon="fa-solid fa-chart-line" />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <article className={`${panel} xl:col-span-2`}>
          <header className="mb-3">
            <PanelTitle
              icon={mode === 'CONVERSATION' ? 'fa-solid fa-filter-circle-dollar' : 'fa-solid fa-fire'}
              text={mode === 'CONVERSATION' ? 'Funil de Conversacao' : 'Comandos Populares'}
            />
          </header>
          <ChartCanvas config={primaryChartConfig} height={320} />
        </article>

        <article className={panel}>
          <header className="mb-3">
            <PanelTitle icon="fa-regular fa-clock" text="Volume Horario" />
          </header>
          <ChartCanvas config={volumeChartConfig} height={320} />
        </article>

        <article className={panel}>
          <header className="mb-3">
            <PanelTitle
              icon={mode === 'CONVERSATION' ? 'fa-solid fa-users' : 'fa-solid fa-user-group'}
              text={mode === 'CONVERSATION' ? 'Contatos Mais Ativos' : 'Usuarios Mais Ativos'}
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
                        Ultima atividade: {item.lastActivity ? fmtTime(item.lastActivity) : '--:--'}
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

        <article className={`${panel} xl:col-span-2 min-h-[420px]`}>
          <header className="mb-3 flex items-center justify-between gap-3">
            <PanelTitle icon="fa-regular fa-rectangle-list" text={mode === 'CONVERSATION' ? 'Logs em Tempo Real' : 'Logs de Comandos'} />
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-full border border-[#d4e0f1] bg-white/80 px-3 py-1.5 text-[0.78rem] font-semibold text-slate-700 transition hover:bg-slate-50"
              onClick={onExport}
            >
              <i className="fa-solid fa-file-export" aria-hidden="true" /> Exportar CSV
            </button>
          </header>
          <div className="max-h-[360px] overflow-auto rounded-[10px] border border-[#dce6f2] bg-[#eef3fb] p-2.5">
            {logs.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-500">Aguardando mensagens...</p>
            ) : mode === 'CONVERSATION' ? (
              logs.map((log, index) => {
                const eventType = String(log.eventType || '').toLowerCase();
                const isOutgoing =
                  log.direction === 'outgoing' ||
                  eventType.includes('outgoing') ||
                  eventType.startsWith('human-');
                const label = isOutgoing ? 'Bot/Atendente' : 'Usuario';
                const text = log.messageText || '[Evento de sistema]';
                return (
                  <div
                    key={`${log.occurredAt}-${index}`}
                    className={`mb-1 grid grid-cols-[68px_1fr] gap-2 rounded-[10px] p-2 ${isOutgoing ? 'bg-[#e2e8f0]' : 'bg-white'}`}
                  >
                    <time className="text-xs text-slate-500">{fmtTime(log.occurredAt)}</time>
                    <p className="text-[0.84rem] leading-[1.45]">
                      <strong>{label}:</strong> {text}
                    </p>
                  </div>
                );
              })
            ) : (
              <table className="w-full border-collapse text-[0.77rem]">
                <thead>
                  <tr>
                    <th className="border-b border-[#e2e8f0] p-2 text-left font-bold text-slate-500">Hora</th>
                    <th className="border-b border-[#e2e8f0] p-2 text-left font-bold text-slate-500">JID</th>
                    <th className="border-b border-[#e2e8f0] p-2 text-left font-bold text-slate-500">Comando</th>
                    <th className="border-b border-[#e2e8f0] p-2 text-left font-bold text-slate-500">Res</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log, index) => {
                    const commandFromMetadata = String(log.metadata?.commandName ?? log.metadata?.command ?? '').trim();
                    const command = commandFromMetadata || String(log.messageText || '').trim().split(/\s+/)[0] || 'n/a';
                    const failed = log.eventType.includes('error') || isLikelyErrorMessage(String(log.messageText ?? ''));
                    return (
                      <tr key={`${log.occurredAt}-${index}`}>
                        <td className="border-b border-[#e2e8f0] p-2">{fmtTime(log.occurredAt)}</td>
                        <td className="border-b border-[#e2e8f0] p-2">{log.jid}</td>
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
            <article className={`${panel} xl:col-span-2`}>
              <header className="mb-3">
                <PanelTitle icon="fa-solid fa-chart-column" text="Tendencia Semanal" />
              </header>
              <ChartCanvas config={bottomChartConfig} height={260} />
            </article>
            <article className={panel}>
              <header className="mb-3">
                <PanelTitle icon="fa-solid fa-chart-simple" text="Metricas Avancadas" />
              </header>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-[#dce7f5] bg-[#f8fbff] p-3">
                  <span className="block text-xs text-slate-500">Taxa de Conversao</span>
                  <strong className="mt-1 block text-xl">{conversionRate.toFixed(1)}%</strong>
                </div>
                <div className="rounded-xl border border-[#dce7f5] bg-[#f8fbff] p-3">
                  <span className="block text-xs text-slate-500">Tempo Mediano</span>
                  <strong className="mt-1 block text-xl">{fmtDuration(safeStats.medianDurationMs ?? avgDuration)}</strong>
                </div>
                <div className="rounded-xl border border-[#dce7f5] bg-[#f8fbff] p-3">
                  <span className="block text-xs text-slate-500">Concluidas</span>
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
            <article className={`${panel} xl:col-span-2`}>
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
            <article className={panel}>
              <header className="mb-3">
                <PanelTitle icon="fa-solid fa-heart-pulse" text="Saude das APIs" />
              </header>
              <div className="max-h-[250px] overflow-auto">
                {apiHealth.length === 0 ? (
                  <p className="py-4 text-center text-sm text-slate-500">Sem integracoes mapeadas.</p>
                ) : (
                  apiHealth.map((item, index) => (
                    <div key={`${item.name}-${index}`} className="flex items-start justify-between gap-3 border-b border-[#ebf1f8] py-2 last:border-b-0">
                      <div>
                        <strong className="block text-[0.85rem]">{item.name}</strong>
                        <p className="mt-1 text-[0.76rem] text-slate-500">{item.avgLatencyMs}ms � {(item.uptime * 100).toFixed(0)}% uptime</p>
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


