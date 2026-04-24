import { useMemo } from 'react';
import type { ChartConfiguration } from 'chart.js';
import { ChartCanvas } from '../charts/ChartCanvas';
import { panelClass } from '../../lib/uiTokens';
import type { SurveyDistributionPoint } from '../../types';

export function SurveyDistributionChart({ distribution }: { distribution: SurveyDistributionPoint[] }) {
  const config = useMemo<ChartConfiguration<'bar'>>(() => {
    const labels = distribution.map(item => String(item.value));
    const values = distribution.map(item => Number(item.total || 0));

    return {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Respostas',
            data: values,
            backgroundColor: 'rgba(37, 99, 235, 0.78)',
            borderRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true,
            ticks: { precision: 0 },
          },
        },
      },
    };
  }, [distribution]);

  return (
    <article className={panelClass}>
      <header className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-700">
        <i className="fa-solid fa-bars-progress text-[#2f5f9f]" aria-hidden="true" />
        Distribuicao de respostas
      </header>
      <ChartCanvas config={config} height={260} />
    </article>
  );
}
