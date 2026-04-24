import { useMemo } from 'react';
import type { ChartConfiguration } from 'chart.js';
import { ChartCanvas } from '../charts/ChartCanvas';
import { panelClass } from '../../lib/uiTokens';
import type { SurveyTrendPoint } from '../../types';

export function SurveyTrendChart({ trend }: { trend: SurveyTrendPoint[] }) {
  const config = useMemo<ChartConfiguration<'line'>>(() => {
    const labels = trend.map(item => item.bucket);
    const avgScore = trend.map(item => Number(item.avgScore || 0));
    const completed = trend.map(item => Number(item.completedInstances || 0));

    return {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Score medio',
            data: avgScore,
            borderColor: '#1e63c9',
            backgroundColor: 'rgba(30, 99, 201, 0.14)',
            tension: 0.35,
            fill: true,
            pointRadius: 2,
            yAxisID: 'y',
          },
          {
            label: 'Concluidas',
            data: completed,
            borderColor: '#0f766e',
            backgroundColor: 'rgba(15, 118, 110, 0.14)',
            tension: 0.3,
            fill: false,
            pointRadius: 2,
            yAxisID: 'y1',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true,
            position: 'left',
            grid: { color: 'rgba(148, 163, 184, 0.2)' },
          },
          y1: {
            beginAtZero: true,
            position: 'right',
            grid: { display: false },
            ticks: { precision: 0 },
          },
          x: {
            grid: { display: false },
          },
        },
      },
    };
  }, [trend]);

  return (
    <article className={panelClass}>
      <header className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-700">
        <i className="fa-solid fa-chart-line text-[#2f5f9f]" aria-hidden="true" />
        Evolucao temporal
      </header>
      <ChartCanvas config={config} height={280} />
    </article>
  );
}
