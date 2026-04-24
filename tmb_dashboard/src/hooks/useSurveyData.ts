import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  SurveyDistributionPoint,
  SurveyFilters,
  SurveyFlowMetric,
  SurveyInstanceList,
  SurveyMetricsOverview,
  SurveyTrendPoint,
  SurveyTypeDefinition,
} from '../types';
import {
  fetchSurveyByFlow,
  fetchSurveyDistribution,
  fetchSurveyInstances,
  fetchSurveyOverview,
  fetchSurveyTrend,
  fetchSurveyTypes,
} from '../lib/surveyApi';

interface SurveyDataState {
  loading: boolean;
  error: string;
  types: SurveyTypeDefinition[];
  overview: SurveyMetricsOverview;
  trend: SurveyTrendPoint[];
  distribution: SurveyDistributionPoint[];
  byFlow: SurveyFlowMetric[];
  instances: SurveyInstanceList;
}

const EMPTY_OVERVIEW: SurveyMetricsOverview = {
  totalInstances: 0,
  completedInstances: 0,
  abandonedInstances: 0,
  completionRate: 0,
  abandonmentRate: 0,
  avgDurationSeconds: 0,
  numericResponses: 0,
  avgScore: 0,
  npsScore: 0,
  csatRate: 0,
  lowEffortRate: 0,
  sampleSize: 0,
};

const EMPTY_INSTANCES: SurveyInstanceList = {
  total: 0,
  items: [],
  limit: 20,
  offset: 0,
};

export function useSurveyData({
  filters,
  enabled = true,
  pollMs = 30000,
}: {
  filters: SurveyFilters;
  enabled?: boolean;
  pollMs?: number;
}) {
  const [state, setState] = useState<SurveyDataState>({
    loading: true,
    error: '',
    types: [],
    overview: EMPTY_OVERVIEW,
    trend: [],
    distribution: [],
    byFlow: [],
    instances: EMPTY_INSTANCES,
  });

  const filtersKey = useMemo(() => JSON.stringify(filters || {}), [filters]);
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    const requestId = Date.now();
    requestIdRef.current = requestId;

    setState(previous => ({ ...previous, loading: true, error: '' }));
    try {
      const [types, overview, trend, distribution, byFlow, instances] = await Promise.all([
        fetchSurveyTypes(true),
        fetchSurveyOverview(filters),
        fetchSurveyTrend(filters),
        fetchSurveyDistribution(filters),
        fetchSurveyByFlow(filters),
        fetchSurveyInstances({ ...filters, limit: filters.limit || 20, offset: filters.offset || 0 }),
      ]);

      if (requestIdRef.current !== requestId) return;

      setState({
        loading: false,
        error: '',
        types,
        overview,
        trend,
        distribution,
        byFlow,
        instances,
      });
    } catch (error) {
      if (requestIdRef.current !== requestId) return;
      setState(previous => ({
        ...previous,
        loading: false,
        error: String((error as Error)?.message || error || 'failed-to-load-surveys'),
      }));
    }
  }, [enabled, filters]);

  useEffect(() => {
    void refresh();
  }, [refresh, filtersKey]);

  useEffect(() => {
    if (!enabled || pollMs <= 0) return;
    const timer = window.setInterval(() => {
      void refresh();
    }, pollMs);
    return () => window.clearInterval(timer);
  }, [enabled, pollMs, refresh]);

  return {
    ...state,
    refresh,
  };
}
