import { useMemo } from 'react';
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

function getPrimaryChartConfig(mode: DashboardMode, stats: DashboardStats): ChartConfiguration {
  if (mode === 'CONVERSATION') {
    const funnel = stats.funnel ?? [{ step: 'start', label: 'Início', count: stats.conversationsStarted ?? 0 }];
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
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true } },
      },
    } as ChartConfiguration;
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
      plugins: {
        legend: {
          position: 'right',
          labels: { boxWidth: 12, color: '#334155' },
        },
      },
    },
  } as ChartConfiguration;
}

function getVolumeChartConfig(mode: DashboardMode, stats: DashboardStats): ChartConfiguration<'line'> {
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
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, ticks: { precision: 0 } },
      },
    },
  };
}

function getBottomChartConfig(stats: DashboardStats): ChartConfiguration<'bar'> {
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
      scales: {
        x: { stacked: true },
        y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } },
      },
    },
  };
}

export function AnalyticsView({
  mode,
  stats,
  logs,
  onExport,
}: AnalyticsViewProps) {
  const safeStats = useMemo(() => stats ?? {}, [stats]);
  const primaryChartConfig = useMemo(() => getPrimaryChartConfig(mode, safeStats), [mode, safeStats]);
  const volumeChartConfig = useMemo(() => getVolumeChartConfig(mode, safeStats), [mode, safeStats]);
  const bottomChartConfig = useMemo(() => getBottomChartConfig(safeStats), [safeStats]);

  const avgDuration = safeStats.avgDurationMs ?? safeStats.averageDurationMs ?? 0;
  const completed = Number(safeStats.completedSessions ?? 0);
  const started = Number(safeStats.conversationsStarted ?? 0);
  const abandoned = Number(safeStats.abandonedSessions ?? 0);
  const conversionRate = started > 0 ? (completed / started) * 100 : 0;
  const recentErrors = safeStats.recentErrors ?? [];
  const apiHealth = safeStats.apiHealth ?? [];

  return (
    <section className="view-section">
      <div className="kpi-grid">
        {mode === 'CONVERSATION' ? (
          <>
            <article className="kpi-card">
              <p className="kpi-title">Conversas Hoje</p>
              <p className="kpi-value">{safeStats.conversationsStarted ?? 0}</p>
            </article>
            <article className="kpi-card">
              <p className="kpi-title">Abandono</p>
              <p className="kpi-value text-danger">{((safeStats.abandonmentRate ?? 0) * 100).toFixed(1)}%</p>
            </article>
            <article className="kpi-card">
              <p className="kpi-title">Tempo Médio</p>
              <p className="kpi-value">{fmtDuration(avgDuration)}</p>
            </article>
            <article className="kpi-card">
              <p className="kpi-title">Sessões Ativas</p>
              <p className="kpi-value text-success">{safeStats.activeSessions ?? 0}</p>
            </article>
          </>
        ) : (
          <>
            <article className="kpi-card">
              <p className="kpi-title">Execuções Hoje</p>
              <p className="kpi-value">{safeStats.totalExecutions ?? 0}</p>
            </article>
            <article className="kpi-card">
              <p className="kpi-title">Latência Média</p>
              <p className="kpi-value">{safeStats.avgLatencyMs ?? 0}ms</p>
            </article>
            <article className="kpi-card">
              <p className="kpi-title">Sucesso</p>
              <p className="kpi-value text-success">{((safeStats.successRate ?? 0) * 100).toFixed(1)}%</p>
            </article>
            <article className="kpi-card">
              <p className="kpi-title">Pico / Hora</p>
              <p className="kpi-value">{safeStats.peakPerHour ?? 0}</p>
            </article>
          </>
        )}
      </div>

      <div className="analytics-grid">
        <article className="panel panel-primary">
          <header className="panel-header">
            <h3>{mode === 'CONVERSATION' ? 'Funil de Conversação' : 'Comandos Populares'}</h3>
          </header>
          <ChartCanvas config={primaryChartConfig} height={320} />
        </article>

        <article className="panel">
          <header className="panel-header">
            <h3>Volume Horário</h3>
          </header>
          <ChartCanvas config={volumeChartConfig} height={320} />
        </article>

        <article className="panel panel-list">
          <header className="panel-header">
            <h3>{mode === 'CONVERSATION' ? 'Contatos Mais Ativos' : 'Usuários Mais Ativos'}</h3>
          </header>
          <div className="list-scroll">
            {mode === 'CONVERSATION' ? (
              (safeStats.topContacts ?? []).length === 0 ? (
                <p className="empty-hint">Nenhum dado ainda.</p>
              ) : (
                (safeStats.topContacts ?? []).map((item, index) => (
                  <div className="list-row" key={`${item.jid}-${index}`}>
                    <div className="list-rank">{index + 1}</div>
                    <div className="list-content">
                      <strong>{item.name || item.jid}</strong>
                      <small>Última atividade: {item.lastActivity ? fmtTime(item.lastActivity) : '--:--'}</small>
                    </div>
                    <span className="list-stat">{item.messageCount} msgs</span>
                  </div>
                ))
              )
            ) : (
              (safeStats.topUsers ?? []).length === 0 ? (
                <p className="empty-hint">Nenhum dado ainda.</p>
              ) : (
                (safeStats.topUsers ?? []).map(item => (
                  <div className="list-row compact" key={item.jid}>
                    <div className="list-content">
                      <strong>{item.name || item.jid}</strong>
                      <small>Favorito: {item.favoriteCommand || 'N/A'}</small>
                    </div>
                    <span className="list-stat">{item.totalCommands} cmd</span>
                  </div>
                ))
              )
            )}
          </div>
        </article>

        <article className="panel panel-logs">
          <header className="panel-header panel-header-space">
            <h3>{mode === 'CONVERSATION' ? 'Logs em Tempo Real' : 'Logs de Comandos'}</h3>
            <button type="button" className="ghost-btn" onClick={onExport}>Exportar CSV</button>
          </header>
          <div className="logs-scroll">
            {logs.length === 0 ? (
              <p className="empty-hint">Aguardando mensagens...</p>
            ) : mode === 'CONVERSATION' ? (
              logs.map((log, index) => {
                const isOutgoing = log.direction === 'outgoing';
                const label = isOutgoing ? 'Bot/Atendente' : 'Usuário';
                const text = log.messageText || '[Evento de sistema]';
                return (
                  <div key={`${log.occurredAt}-${index}`} className={`log-line ${isOutgoing ? 'is-outgoing' : ''}`}>
                    <time>{fmtTime(log.occurredAt)}</time>
                    <p>
                      <strong>{label}:</strong> {text}
                    </p>
                  </div>
                );
              })
            ) : (
              <table className="logs-table">
                <thead>
                  <tr>
                    <th>Hora</th>
                    <th>JID</th>
                    <th>Comando</th>
                    <th>Res</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log, index) => {
                    const commandFromMetadata = String(log.metadata?.commandName ?? log.metadata?.command ?? '').trim();
                    const command = commandFromMetadata || String(log.messageText || '').trim().split(/\s+/)[0] || 'n/a';
                    const failed = log.eventType.includes('error') || isLikelyErrorMessage(String(log.messageText ?? ''));
                    return (
                      <tr key={`${log.occurredAt}-${index}`}>
                        <td>{fmtTime(log.occurredAt)}</td>
                        <td>{log.jid}</td>
                        <td>{command}</td>
                        <td>{failed ? 'ERRO' : 'OK'}</td>
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
            <article className="panel panel-primary">
              <header className="panel-header">
                <h3>Tendência Semanal</h3>
              </header>
              <ChartCanvas config={bottomChartConfig} height={260} />
            </article>
            <article className="panel">
              <header className="panel-header">
                <h3>Métricas Avançadas</h3>
              </header>
              <div className="metric-grid">
                <div className="metric-card">
                  <span>Taxa de Conversão</span>
                  <strong>{conversionRate.toFixed(1)}%</strong>
                </div>
                <div className="metric-card">
                  <span>Tempo Mediano</span>
                  <strong>{fmtDuration(safeStats.medianDurationMs ?? avgDuration)}</strong>
                </div>
                <div className="metric-card">
                  <span>Concluídas</span>
                  <strong>{completed}</strong>
                </div>
                <div className="metric-card">
                  <span>Abandonadas</span>
                  <strong>{abandoned}</strong>
                </div>
              </div>
            </article>
          </>
        ) : (
          <>
            <article className="panel panel-primary">
              <header className="panel-header">
                <h3>Erros Recentes</h3>
              </header>
              <div className="status-stack">
                {recentErrors.length === 0 ? (
                  <p className="empty-hint">Nenhum erro recente.</p>
                ) : (
                  recentErrors.map((item, index) => (
                    <div className="status-row danger" key={`${item.command}-${index}`}>
                      <div>
                        <strong>{item.command}</strong>
                        <p>{item.error}</p>
                      </div>
                      <span>{item.count}x</span>
                    </div>
                  ))
                )}
              </div>
            </article>
            <article className="panel">
              <header className="panel-header">
                <h3>Saúde das APIs</h3>
              </header>
              <div className="status-stack">
                {apiHealth.length === 0 ? (
                  <p className="empty-hint">Sem integrações mapeadas.</p>
                ) : (
                  apiHealth.map((item, index) => (
                    <div className="status-row" key={`${item.name}-${index}`}>
                      <div>
                        <strong>{item.name}</strong>
                        <p>{item.avgLatencyMs}ms · {(item.uptime * 100).toFixed(0)}% uptime</p>
                      </div>
                      <span className={item.status === 'healthy' ? 'status-ok' : 'status-fail'}>
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
