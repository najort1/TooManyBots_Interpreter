import { KpiCard } from '../KpiCard';
import type { SurveyMetricsOverview } from '../../types';

function toPercent(value: number) {
  return `${(Math.max(0, value) * 100).toFixed(1)}%`;
}

function toSeconds(value: number) {
  return `${Math.max(0, Math.round(value))}s`;
}

function formatKeyMetric(overview: SurveyMetricsOverview) {
  const key = String(overview.keyMetricName || '').trim();
  const value = Number(overview.keyMetricValue || 0);

  if (key === 'npsScore') return `${value.toFixed(1)}`;
  if (key === 'csatRate' || key === 'lowEffortRate') return toPercent(value);
  return value.toFixed(2);
}

function keyMetricTitle(overview: SurveyMetricsOverview) {
  const key = String(overview.keyMetricName || '').trim();
  if (key === 'npsScore') return 'NPS';
  if (key === 'csatRate') return 'CSAT';
  if (key === 'lowEffortRate') return 'Baixo Esforco';
  return 'Score Medio';
}

export function SurveyKpiCards({ overview }: { overview: SurveyMetricsOverview }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        title={keyMetricTitle(overview)}
        value={formatKeyMetric(overview)}
        icon="fa-solid fa-chart-line"
        color="blue"
      />
      <KpiCard
        title="Taxa de Resposta"
        value={overview.completionRate}
        formatValue={toPercent}
        icon="fa-regular fa-circle-check"
        color="emerald"
      />
      <KpiCard
        title="Volume"
        value={overview.totalInstances}
        icon="fa-solid fa-layer-group"
        color="indigo"
      />
      <KpiCard
        title="Tempo Medio"
        value={overview.avgDurationSeconds}
        formatValue={toSeconds}
        icon="fa-regular fa-clock"
        color="amber"
      />
    </div>
  );
}
