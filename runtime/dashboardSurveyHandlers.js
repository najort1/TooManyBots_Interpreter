import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { normalizeBotSurveyConfig } from './sessionEndSurveyTrigger.js';
import { toText } from '../utils/normalization.js';

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

function normalizeSurveyQuestion(raw = {}, index = 0) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const rawType = toText(source.type || 'text').toLowerCase();
  const type = ['text', 'nps', 'scale_0_5', 'boolean', 'scale', 'choice', 'multiple'].includes(rawType)
    ? rawType
    : 'text';
  const text = toText(source.text || source.question || source.prompt);
  if (!text) {
    throw new Error(`question ${index + 1} text is required`);
  }
  const question = {
    id: toText(source.id, `q_${index + 1}`),
    text,
    type,
    required: source.required !== false,
  };
  if (type === 'text') {
    const maxLength = Number(source.maxLength);
    if (Number.isFinite(maxLength) && maxLength > 0) {
      question.maxLength = Math.floor(maxLength);
    }
  }
  if (type === 'nps') {
    question.scale = { min: 0, max: 10 };
  } else if (type === 'scale_0_5') {
    question.scale = { min: 0, max: 5 };
  } else if (type === 'scale' && source.scale && typeof source.scale === 'object') {
    question.scale = {
      min: Number(source.scale.min) || 1,
      max: Number(source.scale.max) || 5,
    };
  }
  return question;
}

function normalizeSurveyStatus(value) {
  const status = toText(value, 'draft').toLowerCase();
  if (status === 'active' || status === 'inactive' || status === 'draft') return status;
  return 'draft';
}

function decorateSurveyDefinition(definition, frequency = null) {
  if (!definition) return null;
  const schema = definition.schema && typeof definition.schema === 'object' ? definition.schema : {};
  const status = normalizeSurveyStatus(schema.status || (definition.isActive ? 'active' : 'inactive'));
  return {
    ...definition,
    status,
    title: toText(schema.title || definition.name),
    description: toText(schema.description),
    questions: Array.isArray(schema.questions) ? schema.questions : [],
    frequency,
  };
}

function normalizeSurveyPayload(input = {}, existing = null) {
  const body = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const typeId = toText(body.typeId || body.surveyTypeId, existing?.typeId || `survey_${randomUUID()}`);
  const name = toText(body.name, existing?.name || '');
  if (!name) throw new Error('name is required');
  const title = toText(body.title ?? body.schema?.title, existing?.schema?.title || name);
  const description = toText(body.description ?? body.schema?.description, existing?.schema?.description || '');
  const status = normalizeSurveyStatus(body.status || existing?.schema?.status || 'draft');
  const questionsSource = Array.isArray(body.questions)
    ? body.questions
    : (Array.isArray(body.schema?.questions) ? body.schema.questions : existing?.schema?.questions);
  const questions = (Array.isArray(questionsSource) ? questionsSource : [])
    .map((question, index) => normalizeSurveyQuestion(question, index));
  if (questions.length === 0) {
    throw new Error('at least one question is required');
  }

  return {
    typeId,
    name,
    schema: {
      ...(existing?.schema && typeof existing.schema === 'object' ? existing.schema : {}),
      ...(body.schema && typeof body.schema === 'object' && !Array.isArray(body.schema) ? body.schema : {}),
      status,
      title: title || name,
      description,
      questions,
      visualizations: ['trend', 'distribution', 'by-flow'],
      retentionDays: Math.max(1, Number(body.retentionDays || body.schema?.retentionDays || existing?.schema?.retentionDays || 365)),
    },
    isActive: status === 'active',
    frequency: body.frequency || null,
  };
}

function resolveConfigFlowPath(config = {}, botId = '') {
  const decoded = toText(botId);
  if (!decoded) return '';
  const normalizedDecoded = decoded.replace(/\\/g, '/');
  const configured = [
    ...(Array.isArray(config.flowPaths) ? config.flowPaths : []),
    config.flowPath,
  ].map(item => toText(item)).filter(Boolean);
  const match = configured.find(flowPath => {
    const normalized = flowPath.replace(/\\/g, '/');
    return normalized === normalizedDecoded || path.basename(normalized) === normalizedDecoded;
  });
  return match || (normalizedDecoded.includes('/') ? decoded : `./bots/${decoded}`);
}

export function createDashboardSurveyHandlers({
  listSurveyTypeDefinitions,
  getSurveyTypeDefinitionById,
  upsertSurveyTypeDefinition,
  getSurveyFrequencyRule,
  upsertSurveyFrequencyRule,
  listSurveyInstances,
  getSurveyInstanceById,
  calculateSurveyOverview,
  calculateSurveyTrend,
  calculateSurveyDistribution,
  calculateSurveyByFlow,
  listSurveyResponsesForExport,
  recalculateSurveyMetricsCache,
  applyRuntimeConfigFromDashboard,
  getConfig,
  getCurrentSocket,
  getDashboardFlow,
  getSurveyBroadcastService,
  logConversationEvent,
} = {}) {
  return {
    onListSurveyTypes: async ({ activeOnly = true } = {}) => {
      return listSurveyTypeDefinitions({ activeOnly: activeOnly !== false })
        .map(item => decorateSurveyDefinition(item, getSurveyFrequencyRule?.(item.typeId) || null));
    },

    onCreateSurvey: async (input = {}) => {
      try {
        const payload = normalizeSurveyPayload(input);
        const saved = upsertSurveyTypeDefinition(payload);
        const frequency = payload.frequency
          ? upsertSurveyFrequencyRule(saved.typeId, payload.frequency)
          : getSurveyFrequencyRule(saved.typeId);
        return { ok: true, data: decorateSurveyDefinition(saved, frequency) };
      } catch (error) {
        return { ok: false, error: stringifyError(error, 'failed-to-create-survey') };
      }
    },

    onUpdateSurvey: async ({ typeId, ...input } = {}) => {
      const normalizedTypeId = toText(typeId);
      if (!normalizedTypeId) return { ok: false, error: 'typeId is required' };
      try {
        const existing = getSurveyTypeDefinitionById(normalizedTypeId);
        if (!existing) return { ok: false, error: 'survey type not found' };
        const payload = normalizeSurveyPayload({ ...input, typeId: normalizedTypeId }, existing);
        const saved = upsertSurveyTypeDefinition(payload);
        const frequency = payload.frequency
          ? upsertSurveyFrequencyRule(saved.typeId, payload.frequency)
          : getSurveyFrequencyRule(saved.typeId);
        return { ok: true, data: decorateSurveyDefinition(saved, frequency) };
      } catch (error) {
        return { ok: false, error: stringifyError(error, 'failed-to-update-survey') };
      }
    },

    onSetSurveyStatus: async ({ typeId, status } = {}) => {
      const normalizedTypeId = toText(typeId);
      if (!normalizedTypeId) return { ok: false, error: 'typeId is required' };
      const existing = getSurveyTypeDefinitionById(normalizedTypeId);
      if (!existing) return { ok: false, error: 'survey type not found' };
      const nextStatus = normalizeSurveyStatus(status);
      const saved = upsertSurveyTypeDefinition({
        typeId: existing.typeId,
        name: existing.name,
        schema: {
          ...(existing.schema || {}),
          status: nextStatus,
        },
        isActive: nextStatus === 'active',
      });
      return { ok: true, data: decorateSurveyDefinition(saved, getSurveyFrequencyRule(saved.typeId)) };
    },

    onDuplicateSurvey: async ({ typeId } = {}) => {
      const normalizedTypeId = toText(typeId);
      if (!normalizedTypeId) return { ok: false, error: 'typeId is required' };
      const existing = getSurveyTypeDefinitionById(normalizedTypeId);
      if (!existing) return { ok: false, error: 'survey type not found' };
      const duplicateId = `survey_${randomUUID()}`;
      const saved = upsertSurveyTypeDefinition({
        typeId: duplicateId,
        name: `${existing.name} (copia)`,
        schema: {
          ...(existing.schema || {}),
          status: 'draft',
        },
        isActive: false,
      });
      const existingFrequency = getSurveyFrequencyRule(existing.typeId);
      const frequency = existingFrequency ? upsertSurveyFrequencyRule(duplicateId, existingFrequency) : null;
      return { ok: true, data: decorateSurveyDefinition(saved, frequency) };
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

    onGetSurveyFrequency: async ({ typeId } = {}) => {
      const normalizedTypeId = toText(typeId);
      if (!normalizedTypeId) return { ok: false, error: 'typeId is required' };
      return { ok: true, data: getSurveyFrequencyRule(normalizedTypeId) };
    },

    onUpdateSurveyFrequency: async ({ typeId, frequency } = {}) => {
      const normalizedTypeId = toText(typeId);
      if (!normalizedTypeId) return { ok: false, error: 'typeId is required' };
      try {
        return { ok: true, data: upsertSurveyFrequencyRule(normalizedTypeId, frequency || {}) };
      } catch (error) {
        return { ok: false, error: stringifyError(error, 'failed-to-update-frequency') };
      }
    },

    onListAvailableSurveysForBot: async () => {
      return listSurveyTypeDefinitions({ activeOnly: true })
        .map(item => decorateSurveyDefinition(item, getSurveyFrequencyRule(item.typeId)));
    },

    onLinkSurveyToBot: async ({ botId, surveyConfig } = {}) => {
      if (typeof applyRuntimeConfigFromDashboard !== 'function') {
        return { ok: false, error: 'setup-controller-not-ready' };
      }
      const currentConfig = getConfig?.() || {};
      const flowPath = resolveConfigFlowPath(currentConfig, botId);
      if (!flowPath) return { ok: false, error: 'botId is required' };
      const normalizedSurveyConfig = normalizeBotSurveyConfig(surveyConfig);
      if (!normalizedSurveyConfig.postSessionSurveyTypeId) {
        return { ok: false, error: 'postSessionSurveyTypeId is required' };
      }
      const survey = getSurveyTypeDefinitionById(normalizedSurveyConfig.postSessionSurveyTypeId);
      if (!survey || survey.isActive === false) {
        return { ok: false, error: 'survey type not active' };
      }
      const nextSurveyConfigs = {
        ...(currentConfig.surveyConfigsByFlowPath || {}),
        [flowPath]: normalizedSurveyConfig,
      };
      const result = await applyRuntimeConfigFromDashboard({
        surveyConfigsByFlowPath: nextSurveyConfigs,
      });
      if (!result?.ok) return result;
      return {
        ok: true,
        flowPath,
        surveyConfig: normalizedSurveyConfig,
        config: result.config || null,
      };
    },

    onUnlinkSurveyFromBot: async ({ botId } = {}) => {
      if (typeof applyRuntimeConfigFromDashboard !== 'function') {
        return { ok: false, error: 'setup-controller-not-ready' };
      }
      const currentConfig = getConfig?.() || {};
      const flowPath = resolveConfigFlowPath(currentConfig, botId);
      if (!flowPath) return { ok: false, error: 'botId is required' };
      const nextSurveyConfigs = { ...(currentConfig.surveyConfigsByFlowPath || {}) };
      delete nextSurveyConfigs[flowPath];
      const result = await applyRuntimeConfigFromDashboard({
        surveyConfigsByFlowPath: nextSurveyConfigs,
      });
      if (!result?.ok) return result;
      return { ok: true, flowPath, config: result.config || null };
    },

    onBroadcastSurvey: async ({ typeId, selectedJids, actor } = {}) => {
      const sock = getCurrentSocket?.();
      const flow = getDashboardFlow?.();
      const service = getSurveyBroadcastService?.();
      if (!sock) return { ok: false, error: 'socket-not-ready' };
      if (!flow) return { ok: false, error: 'flow-not-ready' };
      if (!service) return { ok: false, error: 'survey-broadcast-service-not-ready' };
      try {
        const result = await service.send({
          sock,
          flow,
          surveyTypeId: typeId,
          selectedJids,
          actor,
        });
        logConversationEvent?.({
          eventType: 'survey-broadcast-dispatch',
          direction: 'system',
          jid: 'system',
          flowPath: flow.flowPath,
          messageText: `Pesquisa ${typeId}: ${result.sent}/${result.attempted} envios`,
          metadata: result,
        });
        return result;
      } catch (error) {
        return { ok: false, error: stringifyError(error, 'survey-broadcast-failed') };
      }
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
