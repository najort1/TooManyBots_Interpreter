import { useMemo } from 'react';
import type { ChartConfiguration } from 'chart.js';
import { ChartCanvas } from '../charts/ChartCanvas';
import { panelClass } from '../../lib/uiTokens';
import type { SurveyFlowMetric } from '../../types';

export function SurveyFlowBreakdown({ byFlow }: { byFlow: SurveyFlowMetric[] }) {
  const config = useMemo<ChartConfiguration<'bar'>>(() => {
    const topRows = [...byFlow].slice(0, 10);
    const labels = topRows.map(item => item.flowPath || 'sem-flow');
    const values = topRows.map(item => Number(item.avgScore || 0));

    return {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Score medio por flow',
            data: values,
            backgroundColor: 'rgba(14, 116, 144, 0.78)',
            borderRadius: 6,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            beginAtZero: true,
          },
        },
      },
    };
  }, [byFlow]);

  return (
    <article className={panelClass}>
      <header className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-700">
        <i className="fa-solid fa-sitemap text-[#2f5f9f]" aria-hidden="true" />
        Comparativo por flow
      </header>
      <ChartCanvas config={config} height={260} />
    </article>
  );
}
