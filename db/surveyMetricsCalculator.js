import {
  getSurveyMetricsOverview,
  listSurveyTrend,
  listSurveyDistribution,
  listSurveyMetricsByFlow,
  refreshSurveyMetricsCache,
} from './surveyRepository.js';
import { toText } from '../utils/normalization.js';

function normalizeMetricByType(typeId, overview) {
  const normalizedType = toText(typeId).toLowerCase();
  if (normalizedType === 'nps') {
    return {
      keyMetricName: 'npsScore',
      keyMetricValue: Number(overview.npsScore || 0),
      secondaryMetricName: 'completionRate',
      secondaryMetricValue: Number(overview.completionRate || 0),
    };
  }

  if (normalizedType === 'csat') {
    return {
      keyMetricName: 'csatRate',
      keyMetricValue: Number(overview.csatRate || 0),
      secondaryMetricName: 'avgScore',
      secondaryMetricValue: Number(overview.avgScore || 0),
    };
  }

  if (normalizedType === 'ces') {
    return {
      keyMetricName: 'lowEffortRate',
      keyMetricValue: Number(overview.lowEffortRate || 0),
      secondaryMetricName: 'avgScore',
      secondaryMetricValue: Number(overview.avgScore || 0),
    };
  }

  return {
    keyMetricName: 'avgScore',
    keyMetricValue: Number(overview.avgScore || 0),
    secondaryMetricName: 'completionRate',
    secondaryMetricValue: Number(overview.completionRate || 0),
  };
}

export function calculateSurveyOverview({
  typeId = '',
  flowPath = '',
  blockId = '',
  from = null,
  to = null,
} = {}) {
  const overview = getSurveyMetricsOverview({ typeId, flowPath, blockId, from, to });
  return {
    ...overview,
    ...normalizeMetricByType(typeId, overview),
  };
}

export function calculateSurveyTrend({
  typeId = '',
  flowPath = '',
  blockId = '',
  from = null,
  to = null,
  granularity = 'day',
} = {}) {
  return listSurveyTrend({ typeId, flowPath, blockId, from, to, granularity });
}

export function calculateSurveyDistribution({
  typeId = '',
  flowPath = '',
  blockId = '',
  from = null,
  to = null,
} = {}) {
  return listSurveyDistribution({ typeId, flowPath, blockId, from, to });
}

export function calculateSurveyByFlow({
  typeId = '',
  from = null,
  to = null,
} = {}) {
  return listSurveyMetricsByFlow({ typeId, from, to });
}

export function recalculateSurveyMetricsCache({
  typeId = '',
  flowPath = '',
  from = null,
  to = null,
  granularity = 'day',
  force = true,
} = {}) {
  return refreshSurveyMetricsCache({
    typeId,
    flowPath,
    from,
    to,
    timeBucket: granularity,
    force,
  });
}
