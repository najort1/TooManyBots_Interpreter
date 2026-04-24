import { sendTextMessage } from '../engine/sender.js';
import { interpolate } from '../engine/utils.js';
import { getSurveyTypeDefinitionById, upsertSurveyTypeDefinition } from '../db/index.js';
import { INTERNAL_VAR, WAIT_TYPE } from '../config/constants.js';
import {
  buildSurveyQuestionPrompt,
  normalizeSurveyQuestions,
} from '../utils/surveyRuntime.js';

function toText(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function toInt(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.floor(numeric);
}

function resolveSurveyTypeId(block, cfg) {
  const direct = toText(cfg.surveyTypeId || cfg.typeId || cfg.surveyId);
  if (direct) return direct;
  const blockId = toText(block?.id, 'survey');
  return `custom_${blockId}`;
}

function ensureSurveyTypeDefinition(typeId, cfg, questions) {
  const existing = getSurveyTypeDefinitionById(typeId);
  if (existing) return existing;
  if (!Array.isArray(questions) || questions.length === 0) return null;

  return upsertSurveyTypeDefinition({
    typeId,
    name: toText(cfg.surveyName || cfg.title || typeId, typeId),
    schema: {
      questions,
      scoringRules: {
        formula: toText(cfg.scoringFormula || 'custom', 'custom'),
      },
      visualizations: ['trend', 'distribution', 'by-flow'],
      retentionDays: Math.max(1, toInt(cfg.retentionDays, 365)),
    },
    isActive: true,
  });
}

export async function handleSurvey({ block, session, sock, jid }) {
  const cfg = block?.config && typeof block.config === 'object' ? block.config : {};
  const surveyTypeId = resolveSurveyTypeId(block, cfg);

  const initialTypeDefinition = getSurveyTypeDefinitionById(surveyTypeId);
  const schemaQuestions = Array.isArray(initialTypeDefinition?.schema?.questions)
    ? initialTypeDefinition.schema.questions
    : [];

  const fallbackQuestionType = toText(cfg.questionType, 'scale');
  const fallbackScale = Math.max(1, Math.min(10, toInt(cfg.scale, 5)));

  const questions = normalizeSurveyQuestions(
    Array.isArray(cfg.questions) && cfg.questions.length > 0
      ? cfg.questions
      : schemaQuestions,
    {
      fallbackQuestionType,
      fallbackScale,
      defaultScale: fallbackQuestionType === 'scale'
        ? { min: fallbackQuestionType === 'nps' ? 0 : 1, max: fallbackScale }
        : { min: 1, max: fallbackScale },
    }
  );

  const normalizedQuestions = questions.length > 0
    ? questions
    : normalizeSurveyQuestions([
      {
        id: 'q_1',
        text: toText(cfg.questionText || cfg.text || cfg.prompt, 'Como voce avalia seu atendimento?'),
        type: fallbackQuestionType,
        scale: { min: fallbackQuestionType === 'nps' ? 0 : 1, max: fallbackScale },
        required: true,
      },
    ], {
      fallbackQuestionType,
      fallbackScale,
      defaultScale: { min: fallbackQuestionType === 'nps' ? 0 : 1, max: fallbackScale },
    });

  const ensuredDefinition = ensureSurveyTypeDefinition(surveyTypeId, cfg, normalizedQuestions);
  const resolvedTypeId = toText(ensuredDefinition?.typeId, surveyTypeId);

  const timeoutMinutes = Math.max(0, Math.min(24 * 60, toInt(cfg.timeoutMinutes, 5)));
  const nowTs = Date.now();
  const timeoutAt = timeoutMinutes > 0 ? nowTs + (timeoutMinutes * 60 * 1000) : nowTs;
  const invalidMessage = toText(
    cfg.invalidMessage,
    'Resposta invalida. Revise a pergunta e tente novamente.'
  );
  const thankYouMessage = toText(cfg.thankYouMessage || cfg.finishMessage || cfg.onCompleteMessage);
  const timeoutMessage = toText(cfg.timeoutMessage || cfg.onTimeoutMessage);

  const firstQuestion = normalizedQuestions[0];
  const firstPrompt = interpolate(
    buildSurveyQuestionPrompt(firstQuestion, { index: 0, total: normalizedQuestions.length }),
    session.variables || {}
  );

  await sendTextMessage(sock, jid, firstPrompt);

  return {
    nextBlockIndex: null,
    sessionPatch: {
      waitingFor: WAIT_TYPE.SATISFACTION_SURVEY,
      variables: {
        ...session.variables,
        [INTERNAL_VAR.SATISFACTION_SURVEY_STATE]: {
          mode: 'block',
          surveyTypeId: resolvedTypeId,
          instanceId: '',
          contextBlockId: toText(block?.id),
          questionIndex: 0,
          questions: normalizedQuestions,
          responses: [],
          startedAt: nowTs,
          timeoutMinutes,
          timeoutAt,
          invalidMessage,
          thankYouMessage,
          timeoutMessage,
          nextBlockIndex: session.blockIndex + 1,
        },
      },
    },
    done: false,
  };
}
