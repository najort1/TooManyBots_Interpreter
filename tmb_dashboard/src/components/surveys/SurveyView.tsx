import { useCallback, useMemo, useState } from 'react';
import { panelClass } from '../../lib/uiTokens';
import type { SurveyFilters } from '../../types';
import { postRefreshSurveyMetricsCache } from '../../lib/surveyApi';
import { useSurveyData } from '../../hooks/useSurveyData';
import { useSurveyRealtime } from '../../hooks/useSurveyRealtime';
import { useSurveyExport } from '../../hooks/useSurveyExport';
import { SurveyKpiCards } from './SurveyKpiCards';
import { SurveyFilters as SurveyFiltersPanel } from './SurveyFilters';
import { SurveyTrendChart } from './SurveyTrendChart';
import { SurveyDistributionChart } from './SurveyDistributionChart';
import { SurveyComparisonChart } from './SurveyComparisonChart';
import { SurveyFlowBreakdown } from './SurveyFlowBreakdown';
import { SurveyResponseTable } from './SurveyResponseTable';
import { SurveyEmptyState } from './SurveyEmptyState';

function lastDays(days: number) {
  const now = Date.now();
  return {
    from: now - (days * 24 * 60 * 60 * 1000),
    to: now,
  };
}

export function SurveyView({ onShowNotice }: { onShowNotice: (message: string) => void }) {
  const defaults = useMemo(() => lastDays(30), []);
  const [filters, setFilters] = useState<SurveyFilters>({
    typeId: '',
    flowPath: '',
    from: defaults.from,
    to: defaults.to,
    granularity: 'day',
    limit: 20,
    offset: 0,
  });

  const { exportCsv, exportJson } = useSurveyExport(filters);

  const {
    loading,
    error,
    types,
    overview,
    trend,
    distribution,
    byFlow,
    instances,
    refresh,
  } = useSurveyData({
    filters,
    enabled: true,
    pollMs: 30000,
  });

  useSurveyRealtime(() => {
    void refresh();
  }, { enabled: true, debounceMs: 500 });

  const updateFilters = useCallback((patch: Partial<SurveyFilters>) => {
    setFilters(previous => ({
      ...previous,
      ...patch,
      offset: 0,
    }));
  }, []);

  const handleRefreshCache = useCallback(async () => {
    const result = await postRefreshSurveyMetricsCache(filters);
    if (!result.ok) {
      onShowNotice(`Falha ao recalcular cache de pesquisas: ${result.error || 'erro desconhecido'}`);
      return;
    }
    onShowNotice('Cache de pesquisas recalculado com sucesso.');
    await refresh();
  }, [filters, onShowNotice, refresh]);

  const shouldShowEmpty = !loading && !error && Number(overview.totalInstances || 0) === 0;

  return (
    <section className="mx-auto max-w-[1560px] space-y-4">
      <SurveyFiltersPanel
        types={types}
        filters={filters}
        busy={loading}
        onChange={updateFilters}
        onRefresh={() => {
          void refresh();
        }}
        onExportCsv={exportCsv}
        onExportJson={() => {
          void exportJson().catch(err => {
            onShowNotice(`Falha ao exportar JSON de pesquisas: ${String((err as Error)?.message || err)}`);
          });
        }}
        onRefreshCache={() => {
          void handleRefreshCache();
        }}
      />

      {error ? (
        <article className={`${panelClass} border-red-200 bg-red-50 text-red-700`}>
          Falha ao carregar dashboard de pesquisas: {error}
        </article>
      ) : null}

      {shouldShowEmpty ? (
        <SurveyEmptyState />
      ) : (
        <>
          <SurveyKpiCards overview={overview} />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <SurveyTrendChart trend={trend} />
            <SurveyComparisonChart overview={overview} />
            <SurveyDistributionChart distribution={distribution} />
            <SurveyFlowBreakdown byFlow={byFlow} />
          </div>

          <SurveyResponseTable instances={instances} loading={loading} />
        </>
      )}
    </section>
  );
}
