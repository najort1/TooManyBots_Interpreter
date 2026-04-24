import { useMemo } from 'react';
import type { ChartConfiguration } from 'chart.js';
import { ChartCanvas } from '../charts/ChartCanvas';
import { panelClass } from '../../lib/uiTokens';
import type { SurveyMetricsOverview } from '../../types';

export function SurveyComparisonChart({ overview }: { overview: SurveyMetricsOverview }) {
  const config = useMemo<ChartConfiguration<'doughnut'>>(() => {
    const pending = Math.max(
      0,
      Number(overview.totalInstances || 0) - Number(overview.completedInstances || 0) - Number(overview.abandonedInstances || 0)
    );

    return {
      type: 'doughnut',
      data: {
        labels: ['Concluidas', 'Abandonadas', 'Pendentes'],
        datasets: [
          {
            data: [
              Number(overview.completedInstances || 0),
              Number(overview.abandonedInstances || 0),
              pending,
            ],
            backgroundColor: ['#0f766e', '#b91c1c', '#1d4ed8'],
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
            position: 'bottom',
          },
        },
      },
    };
  }, [overview]);

  return (
    <article className={panelClass}>
      <header className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-700">
        <i className="fa-solid fa-chart-pie text-[#2f5f9f]" aria-hidden="true" />
        Estado das pesquisas
      </header>
      <ChartCanvas config={config} height={260} />
    </article>
  );
}
