function toText(value) {
  return String(value ?? '').trim();
}

function toNumberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeFilters(input = {}) {
  return {
    typeId: toText(input.typeId),
    flowPath: toText(input.flowPath),
    blockId: toText(input.blockId),
    from: toNumberOrNull(input.from),
    to: toNumberOrNull(input.to),
    granularity: toText(input.granularity || input.timeBucket || 'day', 'day'),
    limit: Math.max(1, Math.min(10000, Number(input.limit) || 200)),
    offset: Math.max(0, Number(input.offset) || 0),
    status: toText(input.status),
  };
}

function stringifyError(error, fallback = 'unknown-error') {
  if (error && typeof error === 'object' && typeof error.message === 'string' && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}

export function createDashboardSurveyHandlers({
  listSurveyTypeDefinitions,
  getSurveyTypeDefinitionById,
  listSurveyInstances,
  getSurveyInstanceById,
  calculateSurveyOverview,
  calculateSurveyTrend,
  calculateSurveyDistribution,
  calculateSurveyByFlow,
  listSurveyResponsesForExport,
  recalculateSurveyMetricsCache,
} = {}) {
  return {
    onListSurveyTypes: async ({ activeOnly = true } = {}) => {
      return listSurveyTypeDefinitions({ activeOnly: activeOnly !== false });
    },

    onGetSurveyType: async ({ typeId } = {}) => {
      const normalizedTypeId = toText(typeId);
      if (!normalizedTypeId) {
        return { ok: false, error: 'typeId is required' };
      }
      const item = getSurveyTypeDefinitionById(normalizedTypeId);
      if (!item) {
        return { ok: false, error: 'survey type not found' };
      }
      return { ok: true, data: item };
    },

    onListSurveyInstances: async (input = {}) => {
      const filters = normalizeFilters(input);
      return listSurveyInstances(filters);
    },

    onGetSurveyInstance: async ({ instanceId } = {}) => {
      const normalizedInstanceId = toText(instanceId);
      if (!normalizedInstanceId) {
        return { ok: false, error: 'instanceId is required' };
      }
      const item = getSurveyInstanceById(normalizedInstanceId);
      if (!item) {
        return { ok: false, error: 'survey instance not found' };
      }
      return { ok: true, data: item };
    },

    onGetSurveyMetricsOverview: async (input = {}) => {
      const filters = normalizeFilters(input);
      return calculateSurveyOverview(filters);
    },

    onGetSurveyMetricsTrend: async (input = {}) => {
      const filters = normalizeFilters(input);
      return calculateSurveyTrend(filters);
    },

    onGetSurveyMetricsDistribution: async (input = {}) => {
      const filters = normalizeFilters(input);
      return calculateSurveyDistribution(filters);
    },

    onGetSurveyMetricsByFlow: async (input = {}) => {
      const filters = normalizeFilters(input);
      return calculateSurveyByFlow(filters);
    },

    onExportSurveyResponses: async (input = {}) => {
      const filters = normalizeFilters(input);
      return listSurveyResponsesForExport(filters);
    },

    onRefreshSurveyMetricsCache: async (input = {}) => {
      const filters = normalizeFilters(input);
      try {
        return recalculateSurveyMetricsCache({
          typeId: filters.typeId,
          flowPath: filters.flowPath,
          from: filters.from,
          to: filters.to,
          granularity: filters.granularity,
          force: true,
        });
      } catch (error) {
        return {
          ok: false,
          error: stringifyError(error, 'failed-to-refresh-survey-cache'),
        };
      }
    },
  };
}
