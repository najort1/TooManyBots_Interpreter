import {
  checkSurveyFrequencyRules,
  getSurveyFrequencyRule,
  getSurveyTypeDefinitionById,
} from '../db/index.js';
import {
  buildSurveyConsentPrompt,
  buildSurveyQuestionPrompt,
  normalizeSurveyQuestions,
} from '../utils/surveyRuntime.js';
import { toText } from '../utils/normalization.js';

const TRIGGER_TYPES = new Set(['session_end', 'human_handoff_end', 'timeout', 'manual_broadcast']);

function normalizeTriggerType(value) {
  const normalized = toText(value, 'session_end').toLowerCase();
  if (normalized === 'handoff_end' || normalized === 'human-handoff-end') return 'human_handoff_end';
  if (normalized === 'timeout') return 'timeout';
  return TRIGGER_TYPES.has(normalized) ? normalized : 'session_end';
}

function normalizeTriggerList(value) {
  if (!Array.isArray(value)) return ['session_end'];
  const result = [];
  for (const item of value) {
    const normalized = normalizeTriggerType(item);
    if (!result.includes(normalized)) result.push(normalized);
  }
  return result.length > 0 ? result : ['session_end'];
}

export function normalizeBotSurveyConfig(input = {}) {
  const cfg = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const postSessionSurveyTypeId = toText(
    cfg.postSessionSurveyTypeId ?? cfg.surveyTypeId ?? cfg.surveyId
  );
  const skipWindowHours = Math.max(0, Math.floor(Number(cfg.skipWindowHours ?? 24) || 0));
  return {
    postSessionSurveyTypeId: postSessionSurveyTypeId || null,
    triggerOn: normalizeTriggerList(cfg.triggerOn),
    skipIfRecentlyCompleted: cfg.skipIfRecentlyCompleted !== false,
    skipWindowHours,
  };
}

export function resolveFlowSurveyConfig(flow = {}) {
  return normalizeBotSurveyConfig(
    flow?.surveyConfig
    || flow?.runtimeConfig?.surveyConfig
    || {}
  );
}

export function shouldTriggerPostSessionSurvey({
  flow = {},
  session = {},
  jid = '',
  triggerType = 'session_end',
  nowTs = Date.now(),
  isAdmin = false,
} = {}) {
  const normalizedTrigger = normalizeTriggerType(triggerType);
  const config = resolveFlowSurveyConfig(flow);
  const surveyTypeId = toText(config.postSessionSurveyTypeId);
  if (!surveyTypeId) {
    return { shouldTrigger: false, reason: 'survey-not-configured', config };
  }
  if (!config.triggerOn.includes(normalizedTrigger)) {
    return { shouldTrigger: false, reason: 'trigger-disabled', config };
  }

  const userKey = toText(session?.variables?.__sessionUserKey, jid);
  const persistedRules = getSurveyFrequencyRule(surveyTypeId);
  const frequencyRules = config.skipIfRecentlyCompleted
    ? {
        ...(persistedRules || {}),
        minIntervalSeconds: Math.max(
          Number(persistedRules?.minIntervalSeconds || 0),
          Number(config.skipWindowHours || 0) * 60 * 60
        ),
      }
    : (persistedRules || {});

  const frequency = checkSurveyFrequencyRules({
    surveyTypeId,
    jid: userKey,
    rules: frequencyRules,
    nowTs,
    isAdmin,
  });

  if (!frequency.allowed) {
    return {
      shouldTrigger: false,
      reason: frequency.reason || 'frequency-blocked',
      config,
      frequency,
    };
  }

  return {
    shouldTrigger: true,
    reason: 'allowed',
    config,
    surveyTypeId,
    frequency,
    triggerType: normalizedTrigger,
  };
}

export function buildPostSessionSurveyState({
  surveyTypeId,
  triggerType = 'session_end',
  session = {},
  flow = {},
  nowTs = Date.now(),
  source = 'post-session',
} = {}) {
  const typeId = toText(surveyTypeId);
  if (!typeId) {
    return { ok: false, error: 'surveyTypeId is required' };
  }

  const definition = getSurveyTypeDefinitionById(typeId);
  if (!definition || definition.isActive === false) {
    return { ok: false, error: 'survey-type-not-active' };
  }

  const questions = normalizeSurveyQuestions(definition?.schema?.questions || [], {
    fallbackQuestionType: 'text',
    defaultScale: { min: 0, max: 10 },
  });

  if (questions.length === 0) {
    return { ok: false, error: 'survey-has-no-questions' };
  }

  const schema = definition.schema && typeof definition.schema === 'object' ? definition.schema : {};
  const title = toText(schema.title || definition.name, 'Pesquisa de satisfacao');
  const description = toText(schema.description);
  const consentPrompt = buildSurveyConsentPrompt({
    title,
    description,
    questionCount: questions.length,
    triggerType: normalizeTriggerType(triggerType),
    source,
  });

  return {
    ok: true,
    definition,
    questions,
    firstPrompt: consentPrompt,
    state: {
      mode: 'dedicated',
      source,
      surveyTypeId: typeId,
      title,
      description,
      instanceId: '',
      contextBlockId: '',
      awaitingConsent: true,
      consentPrompt,
      consentInvalidMessage: 'Para responder a pesquisa, envie 1 ou sim. Para recusar, envie 2 ou nao.',
      declineMessage: 'Tudo bem, obrigado pelo seu tempo.',
      questionIndex: 0,
      questions,
      responses: [],
      startedAt: nowTs,
      timeoutMinutes: 0,
      timeoutAt: 0,
      invalidMessage: 'Resposta invalida. Revise a pergunta e tente novamente.',
      thankYouMessage: 'Obrigado pelo seu feedback!',
      timeoutMessage: '',
      nextBlockIndex: null,
      endSessionOnComplete: true,
      triggerType: normalizeTriggerType(triggerType),
      sessionId: toText(session?.variables?.__sessionId),
      flowPath: toText(flow?.flowPath),
    },
  };
}
